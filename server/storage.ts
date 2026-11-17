import { createClient, type InArgs } from "@libsql/client";
import crypto from "node:crypto";
import type { Member, CalendarDay, TodayInfo, SettingsInfo } from "@shared/schema";

// Turso (remote) when TURSO_DATABASE_URL is set, otherwise a local SQLite file.
const remoteUrl = process.env.TURSO_DATABASE_URL;
const client = remoteUrl
  ? process.env.TURSO_REPLICA === "0"
    ? createClient({ url: remoteUrl, authToken: process.env.TURSO_AUTH_TOKEN })
    : createClient({
        // embedded replica: fast local reads, writes go to Turso
        url: "file:" + (process.env.REPLICA_PATH || "/tmp/macskawc-replica.db"),
        syncUrl: remoteUrl,
        authToken: process.env.TURSO_AUTH_TOKEN,
        syncInterval: 60,
      })
  : createClient({ url: "file:" + (process.env.DB_PATH || "data.db") });

const db = {
  async get<T>(sql: string, args: InArgs = []): Promise<T | undefined> {
    const r = await client.execute({ sql, args });
    return (r.rows[0] as unknown as T) ?? undefined;
  },
  async all<T>(sql: string, args: InArgs = []): Promise<T[]> {
    const r = await client.execute({ sql, args });
    return r.rows as unknown as T[];
  },
  async run(sql: string, args: InArgs = []) {
    return client.execute({ sql, args });
  },
};

// Serialize all data access (tiny family app, avoids race conditions between requests)
let chain: Promise<unknown> = Promise.resolve();
export function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const r = chain.then(fn, fn);
  chain = r.catch(() => undefined);
  return r;
}

// ---------- Schema (idempotent, additive only) ----------
const SCHEMA = `
CREATE TABLE IF NOT EXISTS members (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  is_admin INTEGER NOT NULL DEFAULT 0,
  color TEXT NOT NULL DEFAULT '#E8590C',
  ntfy_topic TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  member_id INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS days (
  date TEXT PRIMARY KEY,
  assignee_id INTEGER,
  skipped TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'pending',
  done_by INTEGER,
  done_at TEXT,
  notified TEXT NOT NULL DEFAULT '[]',
  queue_before TEXT
);
CREATE TABLE IF NOT EXISTS action_tokens (
  token TEXT PRIMARY KEY,
  date TEXT NOT NULL,
  member_id INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

const OLD_COLORS = ["#C2410C", "#0F766E", "#7C3AED", "#B45309", "#BE185D", "#1D4ED8", "#4D7C0F"];
const COLORS = ["#E8590C", "#0D9488", "#7C5CE6", "#D08A0B", "#D9468F", "#3B82F6", "#5E9C1C"];

export async function initDb() {
  if (remoteUrl && process.env.TURSO_REPLICA !== "0") await client.sync();
  await client.executeMultiple(SCHEMA);
  for (let i = 0; i < OLD_COLORS.length; i++) await db.run("UPDATE members SET color=? WHERE color=?", [COLORS[i], OLD_COLORS[i]]);
  // security migration v2: hashed sessions, long notification topics
  const v = await db.get<{ value: string }>("SELECT value FROM settings WHERE key='sec_v'");
  if (v?.value !== "2") {
    await db.run("DELETE FROM sessions");
    for (const r of await db.all<{ id: number; ntfy_topic: string }>("SELECT id, ntfy_topic FROM members")) {
      if (r.ntfy_topic.length < 30) await db.run("UPDATE members SET ntfy_topic=? WHERE id=?", [`ugyelet-${crypto.randomBytes(12).toString("hex")}`, r.id]);
    }
    await db.run("INSERT INTO settings(key,value) VALUES('sec_v','2') ON CONFLICT(key) DO UPDATE SET value='2'");
  }
  await seedIfEmpty();
}

const SESSION_DAYS = 180;
const sha = (t: string) => crypto.createHash("sha256").update(t).digest("hex");

// ---------- Helpers ----------
const TZ = "Europe/Budapest";

export function todayStr(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}
export function currentHour(now = new Date()): number {
  return parseInt(
    new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", hourCycle: "h23" }).format(now),
    10,
  );
}
export function addDays(date: string, n: number): string {
  const d = new Date(date + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function hashPassword(pw: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(pw, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}
function verifyPassword(pw: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const test = crypto.scryptSync(pw, salt, 64);
  const orig = Buffer.from(hash, "hex");
  return orig.length === test.length && crypto.timingSafeEqual(orig, test);
}
const DUMMY_HASH = hashPassword(crypto.randomBytes(8).toString("hex"));
const rand = (n = 16) => crypto.randomBytes(n).toString("hex");

async function getSetting(key: string, def: string): Promise<string> {
  const row = await db.get("SELECT value FROM settings WHERE key=?", [key]) as { value: string } | undefined;
  return row ? row.value : def;
}
async function setSetting(key: string, value: string) {
  await db.run("INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", [key, value]);
}

type MemberRow = {
  id: number; name: string; email: string; password_hash: string; is_admin: number;
  color: string; ntfy_topic: string; active: number;
};
type DayRow = {
  date: string; assignee_id: number | null; skipped: string; status: string;
  done_by: number | null; done_at: string | null; notified: string; queue_before: string | null;
};

function toMember(r: MemberRow): Member {
  return { id: r.id, name: r.name, email: r.email, isAdmin: !!r.is_admin, color: r.color, ntfyTopic: r.ntfy_topic };
}

// ---------- Members ----------
export async function listMembers(): Promise<Member[]> {
  return (await db.all("SELECT * FROM members WHERE active=1 ORDER BY id") as MemberRow[]).map(toMember);
}
async function memberRow(id: number): Promise<MemberRow | undefined> {
  return await db.get("SELECT * FROM members WHERE id=? AND active=1", [id]) as MemberRow | undefined;
}
export async function getMember(id: number): Promise<Member | undefined> {
  const r = await memberRow(id);
  return r ? toMember(r) : undefined;
}

export async function createMember(name: string, email: string, password: string, isAdmin = false): Promise<Member> {
  const count = (await db.get("SELECT COUNT(*) c FROM members") as { c: number }).c;
  const color = COLORS[count % COLORS.length];
  const topic = `ugyelet-${rand(12)}`;
  const info = await db.run("INSERT INTO members(name,email,password_hash,is_admin,color,ntfy_topic) VALUES(?,?,?,?,?,?)", [name.trim(), email.trim().toLowerCase(), hashPassword(password), isAdmin ? 1 : 0, color, topic]);
  const id = Number(info.lastInsertRowid);
  const q = await getQueue();
  if (!q.includes(id)) q.push(id);
  await setQueue(q);
  return (await getMember(id))!;
}

export async function updateMember(id: number, data: { name?: string; email?: string; password?: string; isAdmin?: boolean; color?: string; keepSession?: string }) {
  if (data.name) await db.run("UPDATE members SET name=? WHERE id=?", [data.name.trim(), id]);
  if (data.email) await db.run("UPDATE members SET email=? WHERE id=?", [data.email.trim().toLowerCase(), id]);
  if (data.password) {
    await db.run("UPDATE members SET password_hash=? WHERE id=?", [hashPassword(data.password), id]);
    // sign out every other device of this member
    if (data.keepSession) await db.run("DELETE FROM sessions WHERE member_id=? AND token<>?", [id, sha(data.keepSession)]);
    else await db.run("DELETE FROM sessions WHERE member_id=?", [id]);
  }
  if (data.isAdmin !== undefined) await db.run("UPDATE members SET is_admin=? WHERE id=?", [data.isAdmin ? 1 : 0, id]);
  if (data.color) await db.run("UPDATE members SET color=? WHERE id=?", [data.color, id]);
}

export async function deactivateMember(id: number) {
  await db.run("UPDATE members SET active=0, email = email || '#deleted-' || id WHERE id=?", [id]);
  await db.run("DELETE FROM sessions WHERE member_id=?", [id]);
  await setQueue((await getQueue()).filter((x) => x !== id));
  // if they were today's assignee, move on to the next person
  const t = todayStr();
  const day = await getDayRow(t);
  if (day && day.status === "pending" && day.assignee_id === id) {
    const skipped = JSON.parse(day.skipped) as number[];
    const next = (await getQueue()).find((m) => !skipped.includes(m)) ?? null;
    await db.run("UPDATE days SET assignee_id=? WHERE date=?", [next, t]);
  }
}

// ---------- Sessions ----------
export async function login(email: string, password: string): Promise<{ token: string; member: Member } | null> {
  const r = await db.get("SELECT * FROM members WHERE email=? AND active=1", [email.trim().toLowerCase()]) as MemberRow | undefined;
  // always run scrypt so response time doesn't reveal whether the e-mail exists
  const ok = verifyPassword(password, r ? r.password_hash : DUMMY_HASH);
  if (!r || !ok) return null;
  const token = rand(32);
  await db.run("INSERT INTO sessions(token,member_id,created_at) VALUES(?,?,?)", [sha(token), r.id, new Date().toISOString()]);
  return { token, member: toMember(r) };
}
export async function sessionMember(token: string | undefined): Promise<Member | undefined> {
  if (!token) return undefined;
  const s = await db.get("SELECT member_id, created_at FROM sessions WHERE token=?", [sha(token)]) as { member_id: number; created_at: string } | undefined;
  if (!s) return undefined;
  if (Date.now() - Date.parse(s.created_at) > SESSION_DAYS * 864e5) {
    await db.run("DELETE FROM sessions WHERE token=?", [sha(token)]);
    return undefined;
  }
  return await getMember(s.member_id);
}
export async function logout(token: string) {
  await db.run("DELETE FROM sessions WHERE token=?", [sha(token)]);
}

// ---------- Queue & settings ----------
export async function getQueue(): Promise<number[]> {
  const active = new Set(
    (await db.all("SELECT id FROM members WHERE active=1") as { id: number }[]).map((r) => r.id),
  );
  const q = Array.from(new Set(JSON.parse(await getSetting("queue", "[]")) as number[])).filter((id) => active.has(id));
  // append any active member missing from queue
  for (const id of Array.from(active)) if (!q.includes(id)) q.push(id);
  return q;
}
async function setQueue(q: number[]) {
  await setSetting("queue", JSON.stringify(q));
}

export async function getSettings(): Promise<SettingsInfo> {
  let cronKey = await getSetting("cron_key", "");
  if (!cronKey) {
    cronKey = rand(12);
    await setSetting("cron_key", cronKey);
  }
  return {
    taskName: await getSetting("task_name", "Macskawc pucolása"),
    notifyHour: parseInt(await getSetting("notify_hour", "17"), 10),
    publicUrl: await getSetting("public_url", process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || ""),
    cronKey,
    queue: await getQueue(),
  };
}
export async function updateSettings(data: Partial<{ taskName: string; notifyHour: number; publicUrl: string; queue: number[] }>) {
  if (data.taskName !== undefined) await setSetting("task_name", data.taskName.trim() || "Macskawc pucolása");
  if (data.notifyHour !== undefined) await setSetting("notify_hour", String(Math.max(0, Math.min(23, data.notifyHour))));
  if (data.publicUrl !== undefined) await setSetting("public_url", data.publicUrl.trim().replace(/\/+$/, ""));
  if (data.queue) {
    const current = await getQueue();
    const valid = data.queue.filter((id) => current.includes(id));
    for (const id of current) if (!valid.includes(id)) valid.push(id);
    await setQueue(valid);
    // re-plan today if nobody acted yet
    const t = todayStr();
    const day = await getDayRow(t);
    if (day && day.status === "pending" && JSON.parse(day.skipped).length === 0) {
      await db.run("UPDATE days SET assignee_id=? WHERE date=?", [valid[0] ?? null, t]);
    }
  }
}

// ---------- Days ----------
async function getDayRow(date: string): Promise<DayRow | undefined> {
  return await db.get("SELECT * FROM days WHERE date=?", [date]) as DayRow | undefined;
}

async function ensureToday(): Promise<DayRow> {
  const t = todayStr();
  // close any past pending day as missed
  await db.run("UPDATE days SET status='missed' WHERE date < ? AND status='pending'", [t]);
  let d = await getDayRow(t);
  if (!d) {
    const q = await getQueue();
    await db.run("INSERT INTO days(date,assignee_id) VALUES(?,?)", [t, q[0] ?? null]);
    d = (await getDayRow(t))!;
  }
  return d;
}

export async function getToday(): Promise<TodayInfo> {
  const d = await ensureToday();
  const s = await getSettings();
  const counts: Record<number, number> = {};
  for (const m of await listMembers()) counts[m.id] = 0;
  for (const r of await db.all("SELECT done_by, COUNT(*) c FROM days WHERE status='done' GROUP BY done_by") as { done_by: number; c: number }[]) {
    if (r.done_by in counts) counts[r.done_by] = r.c;
  }
  const upcoming = await forecast(addDays(d.date, 1), addDays(d.date, 7));
  return {
    date: d.date,
    taskName: s.taskName,
    status: d.status as TodayInfo["status"],
    assigneeId: d.assignee_id,
    doneBy: d.done_by,
    doneAt: d.done_at,
    skipped: JSON.parse(d.skipped),
    notifyHour: s.notifyHour,
    upcoming: upcoming.map((x) => ({ date: x.date, memberId: x.memberId! })).filter((x) => x.memberId != null),
    counts,
    queue: await getQueue(),
  };
}

/** Planned rotation for future days (assuming everyone completes their turn). */
async function forecast(from: string, to: string): Promise<CalendarDay[]> {
  const today = await ensureToday();
  const q = await getQueue();
  if (q.length === 0) return [];
  // queue as it will look after today
  let rot = [...q];
  if (today.status === "pending" && today.assignee_id != null && rot.includes(today.assignee_id)) {
    rot = rot.filter((x) => x !== today.assignee_id);
    rot.push(today.assignee_id);
  }
  const out: CalendarDay[] = [];
  let date = addDays(today.date, 1);
  let i = 0;
  while (date <= to) {
    const memberId = rot[i % rot.length];
    if (date >= from) out.push({ date, status: "forecast", memberId, doneBy: null, skipped: [] });
    i++;
    date = addDays(date, 1);
  }
  return out;
}

export async function calendar(from: string, to: string): Promise<CalendarDay[]> {
  const today = await ensureToday();
  const rows = await db.all("SELECT * FROM days WHERE date>=? AND date<=?", [from, to]) as DayRow[];
  const map = new Map(rows.map((r) => [r.date, r]));
  const fc = new Map((await forecast(from, to)).map((f) => [f.date, f]));
  const out: CalendarDay[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const r = map.get(d);
    if (r) {
      out.push({
        date: d,
        status: r.status as CalendarDay["status"],
        memberId: r.status === "done" ? r.done_by : r.assignee_id,
        doneBy: r.done_by,
        skipped: JSON.parse(r.skipped),
      });
    } else if (d > today.date && fc.has(d)) {
      out.push(fc.get(d)!);
    } else {
      out.push({ date: d, status: "none", memberId: null, doneBy: null, skipped: [] });
    }
  }
  return out;
}

export type ActionResult = { ok: boolean; message: string };

export async function markDone(memberId: number): Promise<ActionResult> {
  const d = await ensureToday();
  if (d.status === "done") return { ok: false, message: "A mai feladat már készre van jelölve." };
  const q = await getQueue();
  const newQ = q.filter((x) => x !== memberId);
  newQ.push(memberId);
  await db.run("UPDATE days SET status='done', done_by=?, done_at=?, queue_before=? WHERE date=?", [memberId, new Date().toISOString(), JSON.stringify(q), d.date]);
  await setQueue(newQ);
  return { ok: true, message: "Köszönjük, a mai feladat kész." };
}

export async function undoDone(memberId: number, isAdmin: boolean): Promise<ActionResult> {
  const d = await ensureToday();
  if (d.status !== "done") return { ok: false, message: "Nincs mit visszavonni." };
  if (d.done_by !== memberId && !isAdmin) return { ok: false, message: "Csak az vonhatja vissza, aki készre jelölte." };
  if (d.queue_before) await setQueue(JSON.parse(d.queue_before));
  await db.run("UPDATE days SET status='pending', done_by=NULL, done_at=NULL, queue_before=NULL WHERE date=?", [d.date]);
  return { ok: true, message: "Visszavonva." };
}

export async function skip(memberId: number): Promise<ActionResult> {
  const d = await ensureToday();
  if (d.status !== "pending") return { ok: false, message: "A mai feladat már le van zárva." };
  if (d.assignee_id !== memberId) return { ok: false, message: "Ma nem te következel." };
  const skipped = JSON.parse(d.skipped) as number[];
  if (!skipped.includes(memberId)) skipped.push(memberId);
  const next = (await getQueue()).find((m) => !skipped.includes(m)) ?? null;
  await db.run("UPDATE days SET skipped=?, assignee_id=? WHERE date=?", [JSON.stringify(skipped), next, d.date]);
  const skipper = await getMember(memberId);
  if (next != null) {
    await notifyAssignee(d.date, next, `${skipper?.name ?? "Valaki"} ma nem tudja elvégezni, ezért te jössz.`);
    return { ok: true, message: `Rendben. ${(await getMember(next))?.name ?? "A következő"} kapott értesítést.` };
  }
  // nobody left – tell everyone
  for (const m of await listMembers()) {
    await sendNtfy(m, "Ma senki nem ér rá", `Mindenki jelezte, hogy ma nem tudja elvégezni: ${(await getSettings()).taskName}.`, []);
  }
  return { ok: true, message: "Mindenki jelezte, hogy ma nem ér rá. Mindenki kapott értesítést." };
}

// ---------- Notifications (ntfy.sh) ----------
export let lastNtfyError = "";
async function sendNtfy(m: Member, title: string, message: string, actions: any[]): Promise<boolean> {
  const s = await getSettings();
  const body: any = { topic: m.ntfyTopic, title, message, priority: 4, actions };
  if (s.publicUrl) body.click = s.publicUrl;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (process.env.NTFY_TOKEN) headers.Authorization = `Bearer ${process.env.NTFY_TOKEN}`;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch("https://ntfy.sh/", { method: "POST", headers, body: JSON.stringify(body), signal: AbortSignal.timeout(10000) });
      if (res.ok) { lastNtfyError = ""; return true; }
      const txt = (await res.text().catch(() => "")).slice(0, 200);
      lastNtfyError = `HTTP ${res.status}${process.env.NTFY_TOKEN ? "" : " (nincs NTFY_TOKEN)"}: ${txt}`;
      console.error(`ntfy error member=${m.id} attempt=${attempt} status=${res.status} token=${process.env.NTFY_TOKEN ? "yes" : "no"} ${txt}`);
      if (res.status < 500 && res.status !== 429) return false;
    } catch (e: any) {
      lastNtfyError = `${e?.name}: ${e?.message}`;
      console.error(`ntfy error member=${m.id} attempt=${attempt} ${e?.name}: ${e?.message}`);
    }
    await new Promise((r) => setTimeout(r, attempt * 2000));
  }
  return false;
}

async function actionToken(date: string, memberId: number): Promise<string> {
  const token = rand(16);
  await db.run("INSERT INTO action_tokens(token,date,member_id) VALUES(?,?,?)", [token, date, memberId]);
  return token;
}

const lastAttempt = new Map<string, number>();
async function notifyAssignee(date: string, memberId: number, intro?: string): Promise<boolean> {
  const m = await getMember(memberId);
  if (!m) return false;
  lastAttempt.set(`${date}:${memberId}`, Date.now());
  const s = await getSettings();
  const actions: any[] = [];
  if (s.publicUrl) {
    const token = await actionToken(date, memberId);
    const base = `${s.publicUrl}/api/act/${token}`;
    actions.push({ action: "http", label: "Kész", url: `${base}/done`, method: "POST", clear: true });
    actions.push({ action: "http", label: "Ma nem tudom", url: `${base}/skip`, method: "POST", clear: true });
  }
  const msg = `${intro ? intro + " " : ""}Ma te következel: ${s.taskName}.`;
  const ok = await sendNtfy(m, `Ma te jössz, ${m.name}`, msg, actions);
  if (!ok) return false;
  const d = await getDayRow(date);
  if (d) {
    const notified = JSON.parse(d.notified) as number[];
    if (!notified.includes(memberId)) notified.push(memberId);
    await db.run("UPDATE days SET notified=? WHERE date=?", [JSON.stringify(notified), date]);
  }
  return true;
}

export async function testNotification(memberId: number): Promise<boolean> {
  const m = await getMember(memberId);
  if (!m) return false;
  return sendNtfy(m, "Teszt értesítés", `Szia ${m.name}, az értesítések működnek.`, []);
}

export async function actByToken(token: string, kind: "done" | "skip"): Promise<ActionResult> {
  const t = await db.get("SELECT * FROM action_tokens WHERE token=?", [token]) as { date: string; member_id: number } | undefined;
  if (!t) return { ok: false, message: "Érvénytelen hivatkozás." };
  if (t.date !== todayStr()) return { ok: false, message: "Ez az értesítés már nem aktuális." };
  return kind === "done" ? await markDone(t.member_id) : skip(t.member_id);
}

/** Periodic job: close past days, create today, send the morning notification. */
let ticking = false;
export async function tick() {
  if (ticking) return;
  ticking = true;
  try {
    const d = await ensureToday();
    const s = await getSettings();
    if (d.status === "pending" && d.assignee_id != null && currentHour() >= s.notifyHour) {
      const notified = JSON.parse(d.notified) as number[];
      // retry failed sends every 10 minutes until delivered
      const last = lastAttempt.get(`${d.date}:${d.assignee_id}`) ?? 0;
      if (!notified.includes(d.assignee_id) && Date.now() - last >= 10 * 60_000) await notifyAssignee(d.date, d.assignee_id);
    }
    // housekeeping: drop old tokens
    await db.run("DELETE FROM action_tokens WHERE date < ?", [addDays(d.date, -3)]);
  } finally {
    ticking = false;
  }
}

// ---------- Seed ----------
export async function seedIfEmpty() {
  const c = (await db.get("SELECT COUNT(*) c FROM members") as { c: number }).c;
  if (c === 0) {
    const email = process.env.ADMIN_EMAIL || "admin@csalad.hu";
    const m = await createMember(process.env.ADMIN_NAME || "Admin", email, process.env.ADMIN_PASSWORD || crypto.randomBytes(16).toString("hex"), true);
    // preferred: only a scrypt hash is stored in .env (ADMIN_PASSWORD_HASH="salt:hash")
    if (process.env.ADMIN_PASSWORD_HASH) await db.run("UPDATE members SET password_hash=? WHERE id=?", [process.env.ADMIN_PASSWORD_HASH, m.id]);
    console.log("Seeded admin account");
  }
}
