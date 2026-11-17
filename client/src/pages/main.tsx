import { useMemo, useState, type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient, setAuthToken } from "@/lib/queryClient";
import { CatBackdrop, PeekingCat } from "@/components/cat-art";
import type { CalendarDay, Member, SettingsInfo, TodayInfo } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import {
  Check, X, CalendarDays, Home, Settings, ChevronLeft, ChevronRight, ArrowUp, ArrowDown,
  Bell, LogOut, Undo2, UserX, Trash2, Copy, Loader2,
} from "lucide-react";

// ---------- helpers ----------
const HU_MONTHS = ["január", "február", "március", "április", "május", "június", "július", "augusztus", "szeptember", "október", "november", "december"];
const HU_DAYS = ["vasárnap", "hétfő", "kedd", "szerda", "csütörtök", "péntek", "szombat"];
const HU_DAYS_SHORT = ["H", "K", "Sze", "Cs", "P", "Szo", "V"];

function parseDate(s: string) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}
function longDate(s: string) {
  const d = parseDate(s);
  const day = HU_DAYS[d.getDay()];
  return `${day.charAt(0).toUpperCase() + day.slice(1)}, ${HU_MONTHS[d.getMonth()]} ${d.getDate()}.`;
}
function shortDate(s: string) {
  const d = parseDate(s);
  return `${HU_MONTHS[d.getMonth()].slice(0, 3)}. ${d.getDate()}., ${HU_DAYS[d.getDay()]}`;
}
function timeOf(iso: string | null) {
  if (!iso) return "";
  return new Intl.DateTimeFormat("hu-HU", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Budapest" }).format(new Date(iso));
}

type PubMember = Member;
function useMembers() {
  const q = useQuery<PubMember[]>({ queryKey: ["/api/members"] });
  const byId = useMemo(() => new Map((q.data || []).map((m) => [m.id, m])), [q.data]);
  return { ...q, byId };
}

function Avatar({ m, size = 36, faded = false }: { m?: PubMember; size?: number; faded?: boolean }) {
  const initial = m ? m.name.trim().charAt(0).toUpperCase() : "?";
  return (
    <span
      className="inline-grid place-items-center rounded-full font-bold text-white shrink-0"
      style={{
        width: size, height: size, fontSize: size * 0.42,
        background: m ? m.color : "hsl(var(--muted-foreground))",
        opacity: faded ? 0.55 : 1,
      }}
      aria-hidden
    >
      {initial}
    </span>
  );
}

function invalidateAll() {
  queryClient.invalidateQueries({ queryKey: ["/api/today"] });
  queryClient.invalidateQueries({ queryKey: ["/api/calendar"] });
}

// ---------- Shell with bottom tabs ----------
export function Shell({ me, children }: { me: Member; children: ReactNode }) {
  const [loc] = useLocation();
  const tabs = [
    { href: "/", label: "Ma", icon: Home },
    { href: "/naptar", label: "Naptár", icon: CalendarDays },
    { href: "/beallitasok", label: "Beállítások", icon: Settings },
  ];
  return (
    <div className="min-h-[100dvh] bg-background relative">
      <CatBackdrop />
      <main className="relative z-10 max-w-md mx-auto px-4 pt-[max(1.25rem,env(safe-area-inset-top))] pb-28">{children}</main>
      <nav
        className="fixed bottom-0 inset-x-0 border-t bg-background/95 backdrop-blur z-20"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
        aria-label="Fő menü"
      >
        <div className="max-w-md mx-auto grid grid-cols-3">
          {tabs.map((t) => {
            const active = t.href === "/" ? loc === "/" || loc === "" : loc.startsWith(t.href);
            const Icon = t.icon;
            return (
              <Link
                key={t.href}
                href={t.href}
                className={`flex flex-col items-center gap-1 py-3 text-xs font-medium transition-colors ${active ? "text-primary" : "text-muted-foreground"}`}
                data-testid={`link-tab-${t.label}`}
              >
                <Icon className="h-5 w-5" />
                {t.label}
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}

// ---------- Today ----------
export function TodayPage({ me }: { me: Member }) {
  const { toast } = useToast();
  const today = useQuery<TodayInfo>({ queryKey: ["/api/today"], refetchInterval: 60_000, refetchOnWindowFocus: true, staleTime: 0 });
  const { byId } = useMembers();

  const action = useMutation({
    mutationFn: async (kind: "done" | "skip" | "undo") => (await apiRequest("POST", `/api/today/${kind}`)).json(),
    onSuccess: (r) => {
      toast({ title: r.message });
      invalidateAll();
    },
    onError: (e: any) => toast({ title: e.message, variant: "destructive" }),
  });
  const [confirmSkip, setConfirmSkip] = useState(false);

  if (today.isLoading || !today.data) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-56 w-full rounded-2xl" />
        <Skeleton className="h-40 w-full rounded-2xl" />
      </div>
    );
  }
  const t = today.data;
  const assignee = t.assigneeId != null ? byId.get(t.assigneeId) : undefined;
  const doer = t.doneBy != null ? byId.get(t.doneBy) : undefined;
  const isMine = t.assigneeId === me.id;
  const maxCount = Math.max(1, ...Object.values(t.counts));

  return (
    <div className="space-y-5">
      <header>
        <p className="text-sm text-muted-foreground" data-testid="text-date">{longDate(t.date)}</p>
        <h1 className="text-xl font-bold tracking-tight" data-testid="text-task-name">{t.taskName}</h1>
      </header>

      {/* main card */}
      <div className="relative pt-10">
      <PeekingCat className="absolute top-0 right-6 w-24 text-[hsl(218_40%_24%)]" />
      <section className="relative rounded-2xl border bg-card p-5 shadow-sm" data-testid="card-today">
        {t.status === "done" ? (
          <div className="flex flex-col items-center text-center py-2">
            <span className="grid place-items-center h-16 w-16 rounded-full bg-emerald-500/15 text-emerald-400 mb-3">
              <Check className="h-9 w-9" strokeWidth={3} />
            </span>
            <p className="text-lg font-bold" data-testid="text-status">Mára kész</p>
            <p className="text-sm text-muted-foreground mt-1">
              {doer?.name ?? "Valaki"} elvégezte{t.doneAt ? `, ${timeOf(t.doneAt)}` : ""}.
            </p>
            {(t.doneBy === me.id || me.isAdmin) && (
              <Button variant="ghost" size="sm" className="mt-3" onClick={() => action.mutate("undo")} disabled={action.isPending} data-testid="button-undo">
                <Undo2 className="h-4 w-4 mr-1.5" /> Visszavonás
              </Button>
            )}
          </div>
        ) : assignee ? (
          <div>
            <div className="flex items-center gap-4">
              <Avatar m={assignee} size={56} />
              <div className="min-w-0">
                <p className="text-sm text-muted-foreground">{isMine ? "Ma te következel" : "Ma következik"}</p>
                <p className="text-lg font-bold truncate" data-testid="text-assignee">{isMine ? "Te jössz" : assignee.name}</p>
              </div>
            </div>
            {t.skipped.length > 0 && (
              <p className="text-sm text-muted-foreground mt-4 flex items-start gap-2" data-testid="text-skipped">
                <UserX className="h-4 w-4 mt-0.5 shrink-0" />
                Ma nem ér rá: {t.skipped.map((id) => byId.get(id)?.name ?? "?").join(", ")}
              </p>
            )}
            {isMine ? (
              <div className="mt-5 space-y-2.5">
                <Button className="w-full h-14 text-base font-semibold" onClick={() => action.mutate("done")} disabled={action.isPending} data-testid="button-done">
                  {action.isPending ? <Loader2 className="h-5 w-5 animate-spin" /> : <><Check className="h-5 w-5 mr-2" strokeWidth={3} /> Kész, megcsináltam</>}
                </Button>
                {confirmSkip ? (
                  <div className="rounded-xl bg-secondary p-3 text-sm">
                    <p className="mb-3">Biztosan nem tudod ma elvégezni? A sorban következő kap értesítést, te pedig holnap újra sorra kerülsz.</p>
                    <div className="flex gap-2">
                      <Button variant="outline" className="flex-1" onClick={() => setConfirmSkip(false)} data-testid="button-skip-cancel">Mégsem</Button>
                      <Button variant="destructive" className="flex-1" onClick={() => { setConfirmSkip(false); action.mutate("skip"); }} data-testid="button-skip-confirm">
                        Igen, ma nem tudom
                      </Button>
                    </div>
                  </div>
                ) : (
                  <Button variant="outline" className="w-full h-12" onClick={() => setConfirmSkip(true)} disabled={action.isPending} data-testid="button-skip">
                    Ma nem tudom (nem vagyok itthon)
                  </Button>
                )}
              </div>
            ) : (
              <div className="mt-5">
                <Button variant="secondary" className="w-full h-12" onClick={() => action.mutate("done")} disabled={action.isPending} data-testid="button-done-instead">
                  Átvállaltam, kész
                </Button>
                <p className="text-xs text-muted-foreground mt-2 text-center">Ha te csinálod meg helyette, a sorban hátra kerülsz.</p>
              </div>
            )}
          </div>
        ) : (
          <div className="text-center py-4">
            <p className="font-semibold" data-testid="text-status">Ma mindenki jelezte, hogy nem ér rá.</p>
            <Button variant="secondary" className="mt-4 h-12 w-full" onClick={() => action.mutate("done")} disabled={action.isPending} data-testid="button-done-anyway">
              Mégis megcsináltam
            </Button>
          </div>
        )}
      </section>
      </div>

      {/* upcoming */}
      <section className="rounded-2xl border bg-card p-5" data-testid="section-upcoming">
        <h2 className="text-sm font-semibold mb-3">Következő napok</h2>
        <ul className="divide-y">
          {t.upcoming.map((u) => {
            const m = byId.get(u.memberId);
            return (
              <li key={u.date} className="flex items-center gap-3 py-2.5" data-testid={`row-upcoming-${u.date}`}>
                <Avatar m={m} size={28} />
                <span className="font-medium flex-1 truncate">{m?.id === me.id ? `${m.name} (te)` : m?.name}</span>
                <span className="text-sm text-muted-foreground tabular-nums">{shortDate(u.date)}</span>
              </li>
            );
          })}
          {t.upcoming.length === 0 && <li className="py-2 text-sm text-muted-foreground">Még nincs senki a sorban.</li>}
        </ul>
      </section>

      {/* fairness */}
      <section className="rounded-2xl border bg-card p-5" data-testid="section-counts">
        <h2 className="text-sm font-semibold mb-3">Eddig elvégezve</h2>
        <ul className="space-y-2.5">
          {t.queue.map((id) => {
            const m = byId.get(id);
            const c = t.counts[id] ?? 0;
            return (
              <li key={id} className="flex items-center gap-3" data-testid={`row-count-${id}`}>
                <span className="w-20 truncate text-sm font-medium">{m?.name}</span>
                <span className="flex-1 h-2.5 rounded-full bg-muted overflow-hidden">
                  <span className="block h-full rounded-full" style={{ width: `${(c / maxCount) * 100}%`, background: m?.color }} />
                </span>
                <span className="w-6 text-right text-sm tabular-nums">{c}</span>
              </li>
            );
          })}
        </ul>
      </section>
      <p className="text-xs text-muted-foreground text-center">Az értesítés minden nap {t.notifyHour}:00-kor megy ki.</p>
    </div>
  );
}

// ---------- Calendar ----------
export function CalendarPage({ me }: { me: Member }) {
  const now = new Date();
  const [ym, setYm] = useState({ y: now.getFullYear(), m: now.getMonth() });
  const month = `${ym.y}-${String(ym.m + 1).padStart(2, "0")}`;
  const cal = useQuery<CalendarDay[]>({
    queryKey: ["/api/calendar", month],
    queryFn: async () => (await apiRequest("GET", `/api/calendar?month=${month}`)).json(),
    staleTime: 0,
  });
  const { byId } = useMembers();
  const [selected, setSelected] = useState<string | null>(null);
  const todayKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

  const shift = (d: number) => {
    setSelected(null);
    setYm(({ y, m }) => {
      const nm = m + d;
      return { y: y + Math.floor(nm / 12), m: ((nm % 12) + 12) % 12 };
    });
  };

  const first = new Date(ym.y, ym.m, 1);
  const lead = (first.getDay() + 6) % 7; // Monday first
  const days = cal.data || [];
  const sel = days.find((d) => d.date === selected);

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between">
        <Button variant="ghost" size="icon" onClick={() => shift(-1)} aria-label="Előző hónap" data-testid="button-prev-month">
          <ChevronLeft className="h-5 w-5" />
        </Button>
        <h1 className="text-lg font-bold" data-testid="text-month">{ym.y}. {HU_MONTHS[ym.m]}</h1>
        <Button variant="ghost" size="icon" onClick={() => shift(1)} aria-label="Következő hónap" data-testid="button-next-month">
          <ChevronRight className="h-5 w-5" />
        </Button>
      </header>

      <div className="rounded-2xl border bg-card p-3">
        <div className="grid grid-cols-7 text-center text-xs font-semibold text-muted-foreground mb-1">
          {HU_DAYS_SHORT.map((d) => <div key={d} className="py-1">{d}</div>)}
        </div>
        {cal.isLoading ? (
          <Skeleton className="h-72 w-full" />
        ) : (
          <div className="grid grid-cols-7 gap-1">
            {Array.from({ length: lead }).map((_, i) => <div key={`e${i}`} />)}
            {days.map((d) => {
              const m = d.memberId != null ? byId.get(d.memberId) : undefined;
              const dayNum = parseDate(d.date).getDate();
              const isToday = d.date === todayKey;
              const isSel = d.date === selected;
              return (
                <button
                  key={d.date}
                  onClick={() => setSelected(isSel ? null : d.date)}
                  className={`relative aspect-[4/5] rounded-xl flex flex-col items-center justify-start pt-1.5 gap-1 text-sm transition-colors
                    ${isSel ? "bg-secondary" : "hover:bg-muted/60"} ${isToday ? "ring-2 ring-primary" : ""}`}
                  data-testid={`cell-day-${d.date}`}
                  aria-label={`${d.date} ${m?.name ?? ""} ${d.status}`}
                >
                  <span className={`text-xs tabular-nums ${isToday ? "font-bold text-primary" : "text-muted-foreground"}`}>{dayNum}</span>
                  <span className="relative">
                    {m ? <Avatar m={m} size={26} faded={d.status === "forecast"} /> : <span className="block h-[26px]" />}
                    {d.status === "done" && (
                      <span className="absolute -bottom-1 -right-1.5 grid place-items-center h-4 w-4 rounded-full bg-emerald-500 text-white ring-2 ring-card" data-testid={`icon-done-${d.date}`}>
                        <Check className="h-3 w-3" strokeWidth={3.5} />
                      </span>
                    )}
                    {d.status === "missed" && (
                      <span className="absolute -bottom-1 -right-1.5 grid place-items-center h-4 w-4 rounded-full bg-red-500 text-white ring-2 ring-card" data-testid={`icon-missed-${d.date}`}>
                        <X className="h-3 w-3" strokeWidth={3.5} />
                      </span>
                    )}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {sel && (
        <div className="rounded-2xl border bg-card p-4 text-sm" data-testid="panel-day-detail">
          <p className="font-semibold mb-1">{longDate(sel.date)}</p>
          {sel.status === "done" && <p>Elvégezte: <b>{byId.get(sel.doneBy!)?.name}</b></p>}
          {sel.status === "missed" && <p className="text-red-400">Nem lett készre jelölve. Felelős: {byId.get(sel.memberId!)?.name ?? "senki"}</p>}
          {sel.status === "pending" && <p>Ma: {byId.get(sel.memberId!)?.name ?? "senki"} következik, még nincs kész.</p>}
          {sel.status === "forecast" && <p>A beosztás szerint: <b>{byId.get(sel.memberId!)?.name}</b>{sel.memberId === me.id ? " (te)" : ""}</p>}
          {sel.status === "none" && <p className="text-muted-foreground">Erről a napról nincs adat.</p>}
          {sel.skipped.length > 0 && <p className="text-muted-foreground mt-1">Nem ért rá: {sel.skipped.map((id) => byId.get(id)?.name).join(", ")}</p>}
        </div>
      )}

      <div className="flex flex-wrap gap-x-5 gap-y-2 text-xs text-muted-foreground px-1">
        <span className="flex items-center gap-1.5"><span className="grid place-items-center h-4 w-4 rounded-full bg-emerald-500 text-white"><Check className="h-3 w-3" strokeWidth={3.5} /></span> Elvégezve</span>
        <span className="flex items-center gap-1.5"><span className="grid place-items-center h-4 w-4 rounded-full bg-red-500 text-white"><X className="h-3 w-3" strokeWidth={3.5} /></span> Nem lett kész</span>
        <span className="flex items-center gap-1.5"><span className="h-4 w-4 rounded-full bg-muted-foreground/40" /> Halványan: tervezett beosztás</span>
      </div>
      <p className="text-xs text-muted-foreground px-1">A jövőbeli napok azt mutatják, ki következne, ha mindenki sorra elvégzi. Kihagyás vagy átvállalás esetén a terv automatikusan frissül.</p>
    </div>
  );
}

// ---------- Settings ----------
function CopyField({ value, testId }: { value: string; testId: string }) {
  const { toast } = useToast();
  return (
    <div className="flex gap-2">
      <Input readOnly value={value} className="font-mono text-sm" data-testid={testId} onFocus={(e) => e.currentTarget.select()} />
      <Button
        variant="outline"
        size="icon"
        aria-label="Másolás"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value);
            toast({ title: "Kimásolva" });
          } catch {
            toast({ title: "Jelöld ki és másold ki kézzel." });
          }
        }}
        data-testid={`${testId}-copy`}
      >
        <Copy className="h-4 w-4" />
      </Button>
    </div>
  );
}

function Card({ title, children, testId }: { title: string; children: ReactNode; testId?: string }) {
  return (
    <section className="rounded-2xl border bg-card p-5 space-y-4" data-testid={testId}>
      <h2 className="text-base font-bold">{title}</h2>
      {children}
    </section>
  );
}

export function SettingsPage({ me }: { me: Member }) {
  const { toast } = useToast();
  const [pw, setPw] = useState("");
  const test = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/me/test")).json(),
    onSuccess: (r) => toast({ title: r.ok ? "Teszt értesítés elküldve." : "Nem sikerült elküldeni." }),
  });
  const changePw = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/me/password", { password: pw })).json(),
    onSuccess: () => { setPw(""); toast({ title: "Jelszó megváltoztatva." }); },
    onError: (e: any) => toast({ title: e.message, variant: "destructive" }),
  });
  const logout = async () => {
    try { await apiRequest("POST", "/api/logout"); } catch { /* ignore */ }
    setAuthToken(null);
    queryClient.setQueryData(["/api/me"], null);
    queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== "/api/me" });
  };

  return (
    <div className="space-y-5">
      <header>
        <p className="text-sm text-muted-foreground">Bejelentkezve: {me.email}</p>
        <h1 className="text-xl font-bold tracking-tight">Beállítások</h1>
      </header>

      <Card title="Értesítések a telefonodon" testId="card-notifications">
        <ol className="text-sm space-y-2 list-decimal pl-5">
          <li>Telepítsd az ingyenes <b>ntfy</b> alkalmazást (App Store / Google Play).</li>
          <li>Az appban nyomj a <b>+</b> gombra, és add meg ezt a témanevet (szerver: ntfy.sh):</li>
        </ol>
        <CopyField value={me.ntfyTopic} testId="text-topic" />
        <ol start={3} className="text-sm space-y-2 list-decimal pl-5">
          <li>Engedélyezd az értesítéseket, majd próbáld ki:</li>
        </ol>
        <Button variant="secondary" className="w-full h-12" onClick={() => test.mutate()} disabled={test.isPending} data-testid="button-test-notification">
          <Bell className="h-4 w-4 mr-2" /> Teszt értesítés küldése
        </Button>
        <p className="text-xs text-muted-foreground">Az értesítésben a „Kész” és a „Ma nem tudom” gombbal az alkalmazás megnyitása nélkül is jelezhetsz.</p>
      </Card>

      <Card title="Jelszó módosítása" testId="card-password">
        <div className="flex gap-2">
          <Input type="password" placeholder="Új jelszó (min. 8 karakter)" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" data-testid="input-new-password" />
          <Button onClick={() => changePw.mutate()} disabled={pw.length < 8 || changePw.isPending} data-testid="button-change-password">Mentés</Button>
        </div>
      </Card>

      {me.isAdmin && <AdminSection me={me} />}

      <Button variant="outline" className="w-full h-12" onClick={logout} data-testid="button-logout">
        <LogOut className="h-4 w-4 mr-2" /> Kijelentkezés
      </Button>
    </div>
  );
}

function AdminSection({ me }: { me: Member }) {
  const { toast } = useToast();
  const settings = useQuery<SettingsInfo>({ queryKey: ["/api/settings"] });
  const { data: members = [], byId } = useMembers();
  const [form, setForm] = useState<{ taskName?: string; notifyHour?: number; publicUrl?: string }>({});
  const [nm, setNm] = useState({ name: "", email: "", password: "" });
  const [resetFor, setResetFor] = useState<number | null>(null);
  const [resetPw, setResetPw] = useState("");
  const [confirmDel, setConfirmDel] = useState<number | null>(null);

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/settings"] });
    queryClient.invalidateQueries({ queryKey: ["/api/members"] });
    invalidateAll();
  };
  const onErr = (e: any) => toast({ title: e.message, variant: "destructive" });

  const save = useMutation({
    mutationFn: async (data: any) => (await apiRequest("PATCH", "/api/settings", data)).json(),
    onSuccess: () => { refresh(); setForm({}); toast({ title: "Mentve." }); },
    onError: onErr,
  });
  const addMember = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/members", nm)).json(),
    onSuccess: () => { setNm({ name: "", email: "", password: "" }); refresh(); toast({ title: "Családtag hozzáadva." }); },
    onError: onErr,
  });
  const delMember = useMutation({
    mutationFn: async (id: number) => (await apiRequest("DELETE", `/api/members/${id}`)).json(),
    onSuccess: () => { setConfirmDel(null); refresh(); toast({ title: "Törölve." }); },
    onError: onErr,
  });
  const resetMember = useMutation({
    mutationFn: async () => (await apiRequest("PATCH", `/api/members/${resetFor}`, { password: resetPw })).json(),
    onSuccess: () => { setResetFor(null); setResetPw(""); toast({ title: "Jelszó beállítva." }); },
    onError: onErr,
  });
  const testMember = useMutation({
    mutationFn: async (id: number) => (await apiRequest("POST", `/api/members/${id}/test`)).json(),
    onSuccess: (r) => toast({ title: r.ok ? "Teszt értesítés elküldve." : "Nem sikerült." }),
  });

  if (!settings.data) return <Skeleton className="h-64 w-full rounded-2xl" />;
  const s = settings.data;
  const queue = s.queue;
  const move = (i: number, d: number) => {
    const q = [...queue];
    const j = i + d;
    if (j < 0 || j >= q.length) return;
    [q[i], q[j]] = [q[j], q[i]];
    save.mutate({ queue: q });
  };
  const taskName = form.taskName ?? s.taskName;
  const notifyHour = form.notifyHour ?? s.notifyHour;
  const publicUrl = form.publicUrl ?? s.publicUrl;
  const dirty = form.taskName !== undefined || form.notifyHour !== undefined || form.publicUrl !== undefined;
  const cronUrl = s.publicUrl ? `${s.publicUrl}/api/cron?key=${s.cronKey}` : "";

  return (
    <>
      <Card title="Feladat és időzítés" testId="card-admin-settings">
        <div className="space-y-1.5">
          <Label htmlFor="task">A feladat neve</Label>
          <Input id="task" value={taskName} onChange={(e) => setForm({ ...form, taskName: e.target.value })} data-testid="input-task-name" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="hour">Napi értesítés időpontja</Label>
          <select
            id="hour"
            className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
            value={notifyHour}
            onChange={(e) => setForm({ ...form, notifyHour: Number(e.target.value) })}
            data-testid="select-notify-hour"
          >
            {Array.from({ length: 24 }).map((_, h) => <option key={h} value={h}>{h}:00</option>)}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="url">Az alkalmazás nyilvános címe</Label>
          <Input id="url" placeholder="https://macskawc.onrender.com" value={publicUrl} onChange={(e) => setForm({ ...form, publicUrl: e.target.value })} data-testid="input-public-url" />
          <p className="text-xs text-muted-foreground">Ez kell ahhoz, hogy az értesítés gombjai működjenek.</p>
        </div>
        <Button className="w-full" disabled={!dirty || save.isPending} onClick={() => save.mutate(form)} data-testid="button-save-settings">Mentés</Button>
        {cronUrl && (
          <div className="space-y-1.5">
            <Label>Pontosító időzítő cím (opcionális)</Label>
            <CopyField value={cronUrl} testId="text-cron-url" />
            <p className="text-xs text-muted-foreground">Ha egy ingyenes időzítő szolgáltatás (pl. cron-job.org) óránként megnyitja ezt a címet, a reggeli értesítés biztosan időben megy ki.</p>
          </div>
        )}
      </Card>

      <Card title="Sorrend" testId="card-queue">
        <p className="text-sm text-muted-foreground -mt-2">A lista elején álló következik. Aki elvégzi a feladatot, a sor végére kerül; aki kihagyja, az elöl marad.</p>
        <ol className="space-y-2">
          {queue.map((id, i) => {
            const m = byId.get(id);
            return (
              <li key={id} className="flex items-center gap-3 rounded-xl border p-2.5" data-testid={`row-queue-${id}`}>
                <span className="w-5 text-center text-sm font-semibold text-muted-foreground tabular-nums">{i + 1}.</span>
                <Avatar m={m} size={30} />
                <span className="flex-1 font-medium truncate">{m?.name}</span>
                <Button variant="ghost" size="icon" disabled={i === 0 || save.isPending} onClick={() => move(i, -1)} aria-label="Feljebb" data-testid={`button-up-${id}`}><ArrowUp className="h-4 w-4" /></Button>
                <Button variant="ghost" size="icon" disabled={i === queue.length - 1 || save.isPending} onClick={() => move(i, 1)} aria-label="Lejjebb" data-testid={`button-down-${id}`}><ArrowDown className="h-4 w-4" /></Button>
              </li>
            );
          })}
        </ol>
      </Card>

      <Card title="Családtagok" testId="card-members">
        <ul className="space-y-3">
          {members.map((m) => (
            <li key={m.id} className="rounded-xl border p-3" data-testid={`row-member-${m.id}`}>
              <div className="flex items-center gap-3">
                <Avatar m={m} size={34} />
                <div className="flex-1 min-w-0">
                  <p className="font-semibold truncate">{m.name}{m.isAdmin ? " · admin" : ""}</p>
                  <p className="text-xs text-muted-foreground truncate">{m.email}</p>
                </div>
              </div>
              <p className="text-xs text-muted-foreground mt-2">ntfy téma: <span className="font-mono select-all">{m.ntfyTopic}</span></p>
              <div className="flex flex-wrap gap-2 mt-3">
                <Button size="sm" variant="outline" onClick={() => testMember.mutate(m.id)} data-testid={`button-test-${m.id}`}><Bell className="h-3.5 w-3.5 mr-1" /> Teszt</Button>
                <Button size="sm" variant="outline" onClick={() => { setResetFor(resetFor === m.id ? null : m.id); setResetPw(""); }} data-testid={`button-reset-${m.id}`}>Új jelszó</Button>
                {m.id !== me.id && (
                  confirmDel === m.id ? (
                    <>
                      <Button size="sm" variant="destructive" onClick={() => delMember.mutate(m.id)} data-testid={`button-delete-confirm-${m.id}`}>Biztosan törlöm</Button>
                      <Button size="sm" variant="ghost" onClick={() => setConfirmDel(null)}>Mégsem</Button>
                    </>
                  ) : (
                    <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setConfirmDel(m.id)} data-testid={`button-delete-${m.id}`}><Trash2 className="h-3.5 w-3.5 mr-1" /> Törlés</Button>
                  )
                )}
              </div>
              {resetFor === m.id && (
                <div className="flex gap-2 mt-3">
                  <Input type="password" placeholder="Új jelszó (min. 8 karakter)" value={resetPw} onChange={(e) => setResetPw(e.target.value)} data-testid={`input-reset-${m.id}`} />
                  <Button disabled={resetPw.length < 8 || resetMember.isPending} onClick={() => resetMember.mutate()} data-testid={`button-reset-save-${m.id}`}>Mentés</Button>
                </div>
              )}
            </li>
          ))}
        </ul>

        <div className="rounded-xl bg-secondary p-4 space-y-3">
          <p className="font-semibold text-sm">Új családtag</p>
          <Input placeholder="Név" value={nm.name} onChange={(e) => setNm({ ...nm, name: e.target.value })} data-testid="input-new-name" />
          <Input placeholder="E-mail cím" type="email" value={nm.email} onChange={(e) => setNm({ ...nm, email: e.target.value })} data-testid="input-new-email" />
          <Input placeholder="Kezdő jelszó (min. 8 karakter)" value={nm.password} onChange={(e) => setNm({ ...nm, password: e.target.value })} data-testid="input-new-password-member" />
          <Button className="w-full" disabled={!nm.name || !nm.email || nm.password.length < 8 || addMember.isPending} onClick={() => addMember.mutate()} data-testid="button-add-member">
            Hozzáadás
          </Button>
          <p className="text-xs text-muted-foreground">Az új tag a sor végére kerül. Az e-mail címet és a jelszót add át neki.</p>
        </div>
      </Card>
    </>
  );
}
