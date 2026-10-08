"use client";

import clsx from "clsx";
import { ArrowLeft, BarChart3, LayoutDashboard, Loader2, LogOut, RefreshCw, Settings2, ShieldHalf, Users } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import AnalyticsTab from "@/components/admin/AnalyticsTab";
import OverviewTab from "@/components/admin/OverviewTab";
import SettingsTab from "@/components/admin/SettingsTab";
import UserPanel from "@/components/admin/UserPanel";
import UsersTab from "@/components/admin/UsersTab";
import NotFound from "@/app/not-found";
import { getOverview, getPlans, type Overview, type PlanInfo } from "@/lib/admin";
import { fetchMe, signOut, type UserProfile } from "@/lib/auth";

const REFRESH_MS = 30000;

const TABS = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "users", label: "Users", icon: Users },
  { id: "analytics", label: "Analytics", icon: BarChart3 },
  { id: "settings", label: "Settings", icon: Settings2 },
] as const;

type TabId = (typeof TABS)[number]["id"];

function tabFromHash(): TabId {
  if (typeof window === "undefined") return "overview";
  const hash = window.location.hash.replace("#", "");
  return (TABS.find((t) => t.id === hash)?.id ?? "overview") as TabId;
}

export default function AdminPage() {
  const [me, setMe] = useState<UserProfile | null>(null);
  const [checked, setChecked] = useState(false);

  const [tab, setTab] = useState<TabId>("overview");
  const [overview, setOverview] = useState<Overview | null>(null);
  const [plans, setPlans] = useState<PlanInfo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  // Bumped whenever data changes, so each tab re-reads what it shows.
  const [refreshKey, setRefreshKey] = useState(0);

  // --- who is looking ----------------------------------------------------
  useEffect(() => {
    const syncTab = () => setTab(tabFromHash());
    syncTab();
    window.addEventListener("hashchange", syncTab);
    return () => window.removeEventListener("hashchange", syncTab);
  }, []);

  // Anyone who is not a signed-in admin sees the ordinary "page not found"
  // screen, with no redirect to sign-in, so customers cannot tell this page
  // exists. The admin API answers them with a plain 404 too.
  const [allowed, setAllowed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const profile = await fetchMe();
        if (!profile) return;
        const planList = await getPlans();
        if (cancelled) return;
        setMe(profile);
        setPlans(planList);
        setAllowed(true);
      } catch {
        /* Not an admin, or not signed in: stay on the not-found screen. */
      } finally {
        if (!cancelled) setChecked(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // --- shared data ---------------------------------------------------------
  const loadShared = useCallback(async () => {
    try {
      const [ov, planList] = await Promise.all([getOverview(), getPlans()]);
      setOverview(ov);
      setPlans(planList);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load the admin data.");
    }
  }, []);

  useEffect(() => {
    if (!allowed) return;
    void loadShared();
    const timer = setInterval(() => {
      void loadShared();
      setRefreshKey((k) => k + 1);
    }, REFRESH_MS);
    return () => clearInterval(timer);
  }, [allowed, loadShared]);

  const refreshAll = useCallback(() => {
    void loadShared();
    setRefreshKey((k) => k + 1);
  }, [loadShared]);

  const openTab = useCallback((id: TabId) => {
    setTab(id);
    window.history.replaceState(null, "", `#${id}`);
  }, []);

  const closePanel = useCallback(() => setSelected(null), []);

  const handleSignOut = async () => {
    try {
      await signOut();
    } finally {
      window.location.assign("/");
    }
  };

  // --- gate --------------------------------------------------------------
  if (!checked) {
    return (
      <div className="grid min-h-screen place-items-center text-ink-faint">
        <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
      </div>
    );
  }

  if (!allowed) {
    return <NotFound />;
  }

  const currency = overview?.currency ?? "USD";

  return (
    <>
      <header className="sticky top-0 z-40 border-b border-black/[0.07] bg-white/[0.85] backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-3 sm:px-6 lg:px-8">
          <Link href="/" className="flex min-w-0 items-center gap-3" aria-label="AdCamouflage home">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-meta-500/30 bg-meta-50">
              <ShieldHalf className="h-5 w-5 text-meta-500" aria-hidden />
            </span>
            <span className="min-w-0 leading-tight">
              <span className="block text-sm font-semibold tracking-tight text-black">
                Ad<span className="text-gradient">Camouflage</span>
              </span>
              <span className="hidden text-[11px] text-ink-subtle sm:block">Admin panel</span>
            </span>
          </Link>
          <nav className="flex items-center gap-2">
            <button type="button" className="btn-ghost !px-2.5 !py-2" onClick={refreshAll} aria-label="Refresh">
              <RefreshCw className="h-4 w-4" aria-hidden />
              <span className="hidden sm:inline">Refresh</span>
            </button>
            <Link href="/app" className="btn-ghost !px-2.5 !py-2 sm:!px-4">
              <ArrowLeft className="h-4 w-4" aria-hidden />
              <span className="hidden sm:inline">Workspace</span>
            </Link>
            <button type="button" onClick={handleSignOut} className="btn-ghost !px-2.5 !py-2" aria-label="Sign out">
              <LogOut className="h-4 w-4" aria-hidden />
              <span className="hidden sm:inline">Sign out</span>
            </button>
          </nav>
        </div>

        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="-mb-px flex gap-1 overflow-x-auto" role="tablist" aria-label="Admin sections">
            {TABS.map((item) => (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={tab === item.id}
                onClick={() => openTab(item.id)}
                className={clsx(
                  "flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm font-semibold transition-colors",
                  tab === item.id
                    ? "border-meta-500 text-meta-600"
                    : "border-transparent text-ink-muted hover:text-black",
                )}
              >
                <item.icon className="h-4 w-4" aria-hidden />
                {item.label}
              </button>
            ))}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 pb-16 pt-6 sm:px-6 sm:pt-8 lg:px-8">
        {error ? (
          <p className="mb-6 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>
        ) : null}

        {tab === "overview" ? (
          <OverviewTab
            overview={overview}
            refreshKey={refreshKey}
            onSelectUser={setSelected}
            onOpenAnalytics={() => openTab("analytics")}
          />
        ) : tab === "users" ? (
          <UsersTab
            plans={plans}
            currency={currency}
            refreshKey={refreshKey}
            onSelectUser={setSelected}
            onChanged={() => void loadShared()}
          />
        ) : tab === "analytics" ? (
          <AnalyticsTab refreshKey={refreshKey} onSelectUser={setSelected} />
        ) : (
          <SettingsTab plans={plans} onPlansChanged={refreshAll} />
        )}
      </main>

      {selected !== null ? (
        <UserPanel
          userId={selected}
          plans={plans}
          selfId={me?.id ?? null}
          currency={currency}
          onClose={closePanel}
          onChanged={refreshAll}
          onDeleted={refreshAll}
        />
      ) : null}
    </>
  );
}
