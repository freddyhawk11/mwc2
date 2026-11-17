import type { Express, Request, Response, NextFunction } from "express";
import type { Server } from "node:http";
import { z } from "zod";
import crypto from "node:crypto";
import * as S from "./storage";
import type { Member } from "@shared/schema";

declare global {
  namespace Express {
    interface Request {
      member?: Member;
      token?: string;
    }
  }
}

function readToken(req: Request): string | undefined {
  const h = req.headers.authorization;
  if (h && h.startsWith("Bearer ")) return h.slice(7);
  const cookie = req.headers.cookie || "";
  const m = cookie.match(/(?:^|;\s*)__Host-ugyelet=([a-f0-9]+)/);
  return m ? m[1] : undefined;
}

async function auth(req: Request, res: Response, next: NextFunction) {
  const token = readToken(req);
  const member = await S.sessionMember(token);
  if (!member) return res.status(401).json({ message: "Bejelentkezés szükséges." });
  req.member = member;
  req.token = token;
  next();
}
function admin(req: Request, res: Response, next: NextFunction) {
  if (!req.member?.isAdmin) return res.status(403).json({ message: "Csak adminisztrátor teheti meg." });
  next();
}

const publicMember = (m: Member, self: Member) => ({
  id: m.id,
  name: m.name,
  color: m.color,
  isAdmin: m.isAdmin,
  // emails and topics only for self or admin
  email: self.isAdmin || self.id === m.id ? m.email : "",
  ntfyTopic: self.isAdmin || self.id === m.id ? m.ntfyTopic : "",
});

const esc = (t: string) => t.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

// ---- brute-force protection for login (in memory) ----
const fails = new Map<string, { n: number; until: number; first: number }>();
const WINDOW = 15 * 60_000;
function blocked(key: string): number {
  const f = fails.get(key);
  if (!f) return 0;
  if (f.until > Date.now()) return Math.ceil((f.until - Date.now()) / 60_000);
  if (Date.now() - f.first > WINDOW) fails.delete(key);
  return 0;
}
function fail(key: string, limit: number) {
  const now = Date.now();
  const f = fails.get(key) ?? { n: 0, until: 0, first: now };
  if (now - f.first > WINDOW) Object.assign(f, { n: 0, first: now });
  f.n++;
  if (f.n >= limit) f.until = now + WINDOW;
  fails.set(key, f);
}
const clientIp = (req: Request) => String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.socket.remoteAddress || "?";

// mutating API calls must come from our own UI (blocks cross-site form posts)
function sameApp(req: Request, res: Response, next: NextFunction) {
  if (req.method === "GET" || req.method === "HEAD") return next();
  if (req.path.startsWith("/act/")) return next(); // notification buttons: protected by their own secret token
  if (req.headers["x-requested-with"] !== "ugyelet") return res.status(403).json({ message: "Tiltott kérés." });
  next();
}

function actionPage(title: string, msg: string, ok: boolean, extra = "") {
  return `<!doctype html><html lang="hu"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<style>body{font-family:system-ui,sans-serif;background:#0B1220;color:#E2E8F0;display:grid;place-items:center;min-height:100vh;margin:0;padding:24px}
button{font:inherit;font-size:16px;padding:12px 20px;border-radius:10px;border:0;background:#3B82F6;color:#fff;margin-top:12px;width:100%}
.c{max-width:360px;text-align:center}h1{font-size:20px;color:${ok ? "#4ADE80" : "#F87171"}}p{font-size:16px;line-height:1.5}</style></head>
<body><div class="c"><h1>${esc(title)}</h1><p>${esc(msg)}</p>${extra}</div></body></html>`;
}

export async function registerRoutes(httpServer: Server, app: Express): Promise<Server> {
  await S.initDb();
  // background scheduler (every minute, while the service is awake)
  S.withLock(() => S.tick()).catch(console.error);
  setInterval(() => S.withLock(() => S.tick()).catch(console.error), 60_000);

  // run the scheduler opportunistically on every API call (covers sandbox wake-ups)
  app.use("/api", sameApp);
  // one API request at a time (holds the lock until the response is sent); runs the scheduler first
  app.use("/api", (_req, res, next) => {
    S.withLock(
      () =>
        new Promise<void>((resolve) => {
          res.on("finish", resolve);
          res.on("close", resolve);
          S.tick()
            .catch(console.error)
            .finally(() => next());
        }),
    );
  });

  // ---- auth ----
  app.post("/api/login", async (req, res) => {
    const body = z.object({ email: z.string().min(3), password: z.string().min(1) }).safeParse(req.body);
    if (!body.success) return res.status(400).json({ message: "Add meg az e-mail címet és a jelszót." });
    const ipKey = "ip:" + clientIp(req);
    const emKey = "em:" + body.data.email.trim().toLowerCase();
    const wait = Math.max(blocked(ipKey), blocked(emKey));
    if (wait) return res.status(429).json({ message: `Túl sok sikertelen próbálkozás. Próbáld újra ${wait} perc múlva.` });
    const r = await S.login(body.data.email, body.data.password.slice(0, 200));
    if (!r) {
      fail(ipKey, 20);
      fail(emKey, 8);
      return res.status(401).json({ message: "Hibás e-mail cím vagy jelszó." });
    }
    fails.delete(emKey);
    res.setHeader(
      "Set-Cookie",
      `__Host-ugyelet=${r.token}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 24 * 365}`,
    );
    res.json({ token: r.token, member: r.member });
  });
  app.post("/api/logout", auth, async (req, res) => {
    if (req.token) await S.logout(req.token);
    res.setHeader("Set-Cookie", `__Host-ugyelet=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0`);
    res.json({ ok: true });
  });
  app.get("/api/me", auth, (req, res) => res.json(req.member));
  app.post("/api/me/password", auth, async (req, res) => {
    const body = z.object({ password: z.string().min(8).max(200) }).safeParse(req.body);
    if (!body.success) return res.status(400).json({ message: "A jelszó legalább 8 karakter legyen." });
    await S.updateMember(req.member!.id, { password: body.data.password, keepSession: req.token });
    res.json({ ok: true });
  });
  app.post("/api/me/test", auth, async (req, res) => {
    const ok = await S.testNotification(req.member!.id);
    res.json({ ok, error: ok ? undefined : S.lastNtfyError });
  });

  // ---- data ----
  app.get("/api/members", auth, async (req, res) => {
    res.json((await S.listMembers()).map((m) => publicMember(m, req.member!)));
  });
  app.get("/api/today", auth, async (_req, res) => {
    res.json(await S.getToday());
  });
  app.get("/api/calendar", auth, async (req, res) => {
    const month = String(req.query.month || "");
    if (!/^\d{4}-\d{2}$/.test(month)) return res.status(400).json({ message: "Hibás hónap." });
    const [y, mo] = month.split("-").map(Number);
    const from = `${month}-01`;
    const last = new Date(Date.UTC(y, mo, 0)).getUTCDate();
    const to = `${month}-${String(last).padStart(2, "0")}`;
    res.json(await S.calendar(from, to));
  });

  // ---- actions ----
  app.post("/api/today/done", auth, async (req, res) => {
    const r = await S.markDone(req.member!.id);
    res.status(r.ok ? 200 : 400).json(r);
  });
  app.post("/api/today/undo", auth, async (req, res) => {
    const r = await S.undoDone(req.member!.id, req.member!.isAdmin);
    res.status(r.ok ? 200 : 400).json(r);
  });
  app.post("/api/today/skip", auth, async (req, res) => {
    const r = await S.skip(req.member!.id);
    res.status(r.ok ? 200 : 400).json(r);
  });

  // notification buttons (no login; secret one-time-per-day token)
  const kindOf = (k: string) => (k === "done" ? "done" : k === "skip" ? "skip" : null);
  // POST performs the action (ntfy button, or the confirm form below)
  app.post("/api/act/:token/:kind", async (req, res) => {
    const kind = kindOf(req.params.kind);
    if (!kind || !/^[a-f0-9]{32}$/.test(req.params.token)) return res.status(404).json({ ok: false, message: "Nincs ilyen művelet." });
    const r = await S.actByToken(req.params.token, kind);
    if (req.is("application/x-www-form-urlencoded")) {
      return res.status(200).type("html").send(actionPage(r.ok ? "Rendben" : "Nem sikerült", r.message, r.ok));
    }
    res.status(r.ok ? 200 : 400).json(r);
  });
  // GET only shows a confirmation page (link previews / prefetch must not change anything)
  app.get("/api/act/:token/:kind", async (req, res) => {
    const kind = kindOf(req.params.kind);
    if (!kind || !/^[a-f0-9]{32}$/.test(req.params.token)) return res.status(404).type("html").send(actionPage("Nem sikerült", "Nincs ilyen művelet.", false));
    const label = kind === "done" ? "Kész, megcsináltam" : "Ma nem tudom";
    res.status(200).type("html").send(
      actionPage("Megerősítés", kind === "done" ? "Jelölöd, hogy elvégezted a mai feladatot?" : "Jelzed, hogy ma nem tudod elvégezni?", true,
        `<form method="post"><button type="submit">${esc(label)}</button></form>`),
    );
  });

  // external cron ping (optional, keeps notifications punctual)
  app.get("/api/cron", async (req, res) => {
    const given = Buffer.from(String(req.query.key || ""));
    const want = Buffer.from((await S.getSettings()).cronKey);
    if (given.length !== want.length || !crypto.timingSafeEqual(given, want)) return res.status(403).json({ ok: false });
    await S.tick();
    res.json({ ok: true, today: S.todayStr() });
  });

  // ---- admin ----
  app.get("/api/settings", auth, admin, async (_req, res) => res.json(await S.getSettings()));
  app.patch("/api/settings", auth, admin, async (req, res) => {
    const body = z
      .object({
        taskName: z.string().max(80).optional(),
        notifyHour: z.number().int().min(0).max(23).optional(),
        publicUrl: z.string().max(200).optional(),
        queue: z.array(z.number().int()).optional(),
      })
      .safeParse(req.body);
    if (!body.success) return res.status(400).json({ message: "Hibás beállítás." });
    await S.updateSettings(body.data);
    res.json((await S.getSettings()));
  });
  app.post("/api/members", auth, admin, async (req, res) => {
    const body = z
      .object({ name: z.string().min(1).max(40), email: z.string().email().max(120), password: z.string().min(8).max(200), isAdmin: z.boolean().optional() })
      .safeParse(req.body);
    if (!body.success) return res.status(400).json({ message: "Név, érvényes e-mail és legalább 8 karakteres jelszó kell." });
    try {
      const m = await S.createMember(body.data.name, body.data.email, body.data.password, body.data.isAdmin);
      res.json(m);
    } catch {
      res.status(400).json({ message: "Ez az e-mail cím már foglalt." });
    }
  });
  app.patch("/api/members/:id", auth, admin, async (req, res) => {
    const body = z
      .object({
        name: z.string().min(1).max(40).optional(),
        email: z.string().email().max(120).optional(),
        password: z.string().min(8).max(200).optional(),
        isAdmin: z.boolean().optional(),
      })
      .safeParse(req.body);
    if (!body.success) return res.status(400).json({ message: "Hibás adatok." });
    try {
      await S.updateMember(Number(req.params.id), body.data);
      res.json({ ok: true });
    } catch {
      res.status(400).json({ message: "Ez az e-mail cím már foglalt." });
    }
  });
  app.delete("/api/members/:id", auth, admin, async (req, res) => {
    const id = Number(req.params.id);
    if (id === req.member!.id) return res.status(400).json({ message: "Saját magadat nem törölheted." });
    await S.deactivateMember(id);
    res.json({ ok: true });
  });
  app.post("/api/members/:id/test", auth, admin, async (req, res) => {
    const ok = await S.testNotification(Number(req.params.id));
    res.json({ ok, error: ok ? undefined : S.lastNtfyError });
  });

  return httpServer;
}
