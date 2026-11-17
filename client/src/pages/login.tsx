import { useState } from "react";
import { apiRequest, queryClient, setAuthToken } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";
import { SittingCat } from "@/components/cat-art";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const r = await apiRequest("POST", "/api/login", { email, password });
      const data = await r.json();
      setAuthToken(data.token);
      queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== "/api/me" });
      queryClient.setQueryData(["/api/me"], data.member);
    } catch (err: any) {
      setError(err?.message || "Nem sikerült bejelentkezni.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative min-h-[100dvh] overflow-hidden">
    <div className="pointer-events-none absolute inset-0 cat-bg-paws" aria-hidden />
    <SittingCat className="pointer-events-none absolute -right-10 -bottom-6 w-72 text-[hsl(216_45%_20%)] opacity-70" />
    <div className="relative min-h-[100dvh] flex flex-col justify-center px-6 py-10 max-w-sm mx-auto">
      <div className="mb-8">
        <img src="./icon.svg" alt="" className="h-12 w-12 mb-5" />
        <h1 className="text-xl font-bold tracking-tight">Ki jön ma?</h1>
        <p className="text-muted-foreground mt-1 text-sm">Családi beosztás a macskawc pucolásához.</p>
      </div>
      <form onSubmit={submit} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="email">E-mail cím</Label>
          <Input
            id="email"
            type="email"
            autoComplete="username"
            inputMode="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="h-12 text-base"
            data-testid="input-email"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="password">Jelszó</Label>
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="h-12 text-base"
            data-testid="input-password"
          />
        </div>
        {error && (
          <p className="text-sm text-destructive" role="alert" data-testid="text-login-error">
            {error}
          </p>
        )}
        <Button type="submit" className="w-full h-12 text-base font-semibold" disabled={busy} data-testid="button-login">
          {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : "Belépés"}
        </Button>
      </form>
      <p className="text-xs text-muted-foreground mt-8">
        Hozzáférést a család adminisztrátora tud adni a Beállítások menüben.
      </p>
    </div>
    </div>
  );
}
