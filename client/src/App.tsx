import { Switch, Route, Router } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { Member } from "@shared/schema";
import LoginPage from "@/pages/login";
import { Shell, TodayPage, CalendarPage, SettingsPage } from "@/pages/main";
import { Loader2 } from "lucide-react";

function Gate() {
  const me = useQuery<Member | null>({
    queryKey: ["/api/me"],
    queryFn: async () => {
      const { apiRequest } = await import("./lib/queryClient");
      try {
        const r = await apiRequest("GET", "/api/me");
        return await r.json();
      } catch (e: any) {
        if (e?.status === 401) return null;
        throw e;
      }
    },
  });
  if (me.isLoading) {
    return (
      <div className="min-h-[100dvh] grid place-items-center text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin" aria-label="Betöltés" />
      </div>
    );
  }
  if (!me.data) return <LoginPage />;
  return (
    <Shell me={me.data}>
      <Switch>
        <Route path="/">{() => <TodayPage me={me.data!} />}</Route>
        <Route path="/naptar">{() => <CalendarPage me={me.data!} />}</Route>
        <Route path="/beallitasok">{() => <SettingsPage me={me.data!} />}</Route>
        <Route>{() => <TodayPage me={me.data!} />}</Route>
      </Switch>
    </Shell>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Router hook={useHashLocation}>
          <Gate />
        </Router>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
