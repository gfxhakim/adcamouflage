"use client";

import clsx from "clsx";
import { ArrowLeft, Bell, Headset, Loader2, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";

import AdminSidebar, { ADMIN_TABS } from "@/components/admin/AdminSidebar";
import AffiliatesTab from "@/components/admin/AffiliatesTab";
import AnalyticsTab from "@/components/admin/AnalyticsTab";
import GuidesTab from "@/components/admin/GuidesTab";
import ContentEditor from "@/components/admin/ContentEditor";
import OverviewTab from "@/components/admin/OverviewTab";
import SalesTab from "@/components/admin/SalesTab";
import SettingsTab from "@/components/admin/SettingsTab";
import SupportTab from "@/components/admin/SupportTab";
import UserSearch from "@/components/admin/UserSearch";
import UserPanel from "@/components/admin/UserPanel";
import UsersTab from "@/components/admin/UsersTab";
import BrandLogo from "@/components/BrandLogo";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import NotFound from "@/app/not-found";
import { getOverview, getPlans, type Overview, type PlanInfo } from "@/lib/admin";
import { fetchMe, signOut, type UserProfile } from "@/lib/auth";
import { cancelJump, jumpToTitle, type AdminSearchEntry, type AdminTabId } from "@/lib/admin-search";
import { ADMIN_SIDEBAR_COOKIE, readSidebarOpen } from "@/lib/sidebarCookie";
import { getAdminSupportNotifications, type AdminSupportNotifications } from "@/lib/support";

const REFRESH_MS = 30000;
const SUPPORT_POLL_MS = 8000;

const TABS = ADMIN_TABS;

const WORKSPACE_PAGES = [
  { path: "/app", label: "Workspace · step flow" },
  { path: "/app/history", label: "History" },
  { path: "/app/plan", label: "My plan" },
];

type TabId = AdminTabId;

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
  const [supportNotifs, setSupportNotifs] = useState<AdminSupportNotifications | null>(null);
  const [activeSupportThreadId, setActiveSupportThreadId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [usersQuery, setUsersQuery] = useState("");
  // Bumped whenever data changes, so each tab re-reads what it shows.
  const [refreshKey, setRefreshKey] = useState(0);

  // --- who is looking ----------------------------------------------------
  // A sidebar search result that is still on its way to a title (see jumpTo).
  const jumpTimer = useRef(0);
  const dropJump = useCallback(() => {
    window.clearTimeout(jumpTimer.current);
    cancelJump();
  }, []);

  useEffect(() => {
    const syncTab = () => {
      dropJump();
      setTab(tabFromHash());
    };
    setTab(tabFromHash());
    window.addEventListener("hashchange", syncTab);
    return () => {
      window.removeEventListener("hashchange", syncTab);
      dropJump();
    };
  }, [dropJump]);

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
  const loadSupportNotifs = useCallback(async () => {
    try {
      const notifs = await getAdminSupportNotifications();
      setSupportNotifs(notifs);
    } catch {
      /* ignore transient notification poll errors */
    }
  }, []);

  const loadShared = useCallback(async () => {
    try {
      const [ov, planList] = await Promise.all([getOverview(), getPlans()]);
      setOverview(ov);
      setPlans(planList);
      setError(null);
      void loadSupportNotifs();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load the admin data.");
    }
  }, [loadSupportNotifs]);

  useEffect(() => {
    if (!allowed) return;
    void loadShared();
    const timer = setInterval(() => {
      void loadShared();
      setRefreshKey((k) => k + 1);
    }, REFRESH_MS);
    const supportTimer = setInterval(() => {
      void loadSupportNotifs();
    }, SUPPORT_POLL_MS);
    return () => {
      clearInterval(timer);
      clearInterval(supportTimer);
    };
  }, [allowed, loadShared, loadSupportNotifs]);

  const refreshAll = useCallback(() => {
    void loadShared();
    setRefreshKey((k) => k + 1);
  }, [loadShared]);

  const openTab = useCallback(
    (id: TabId) => {
      dropJump();
      setTab(id);
      setUsersQuery("");
      window.history.replaceState(null, "", `#${id}`);
    },
    [dropJump],
  );

  // "See all" under the dashboard search: the Users page opens on the same search.
  const openUsersWith = useCallback(
    (query: string) => {
      openTab("users");
      setUsersQuery(query);
    },
    [openTab],
  );

  const openSupportThread = useCallback(
    (threadId: number) => {
      setActiveSupportThreadId(threadId);
      openTab("support");
    },
    [openTab],
  );

  // A sidebar search result: open its page, then scroll to the title.
  const jumpTo = useCallback(
    (entry: AdminSearchEntry) => {
      openTab(entry.tab);
      jumpTimer.current = window.setTimeout(
        () => jumpToTitle(entry, document.getElementById("admin-main") ?? document),
        80,
      );
    },
    [openTab],
  );

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
      <div className="deck deck-fixed grid min-h-screen place-items-center text-slate-500">
        <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
      </div>
    );
  }

  if (!allowed) {
    return <NotFound />;
  }

  const currency = overview?.currency ?? "USD";
  const activeTab = TABS.find((t) => t.id === tab);
  const editing = tab === "landing" || tab === "workspace";
  const unreadSupport = supportNotifs?.unread_total ?? 0;
  const escalatedCount = supportNotifs?.escalated_count ?? 0;

  return (
    <SidebarProvider
      defaultOpen={readSidebarOpen(ADMIN_SIDEBAR_COOKIE)}
      cookieName={ADMIN_SIDEBAR_COOKIE}
      className="deck deck-fixed"
      style={{ "--sidebar-width": "17rem", "--sidebar-width-icon": "3.5rem" } as CSSProperties}
    >
      <AdminSidebar
        active={tab}
        onOpen={openTab}
        onJump={jumpTo}
        supportBadge={unreadSupport || escalatedCount}
        name={me?.display_name ?? null}
        email={me?.email ?? ""}
        onSignOut={handleSignOut}
      />

      <SidebarInset className="min-w-0 bg-transparent">
        <header className="sticky top-0 z-40 border-b border-white/10 bg-[#070b14]/85 backdrop-blur-xl">
          <div className="flex items-center justify-between gap-3 px-4 py-3 sm:px-6 lg:px-8">
            <div className="flex min-w-0 items-center gap-3">
              <SidebarTrigger
                className="h-9 w-9 shrink-0 rounded-lg border border-white/10 text-slate-300 hover:bg-white/10 hover:text-white [&>svg]:h-4 [&>svg]:w-4"
                aria-label="Open or close the menu"
              />
              <Link href="/" className="flex min-w-0 items-center lg:hidden" aria-label="ProteusFlow home">
                <BrandLogo onDark />
              </Link>
              <span className="hidden truncate text-sm font-semibold text-slate-300 lg:block">{activeTab?.label}</span>
            </div>
            <nav className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => openTab("support")}
                className={clsx(
                  "btn-ghost relative !px-2.5 !py-2",
                  (unreadSupport > 0 || escalatedCount > 0) &&
                    "!border-amber-400/50 !bg-amber-500/15 !text-amber-200",
                )}
                aria-label="Live support notifications"
              >
                <Headset className="h-4 w-4" aria-hidden />
                <span className="hidden sm:inline">Live Support</span>
                {unreadSupport > 0 || escalatedCount > 0 ? (
                  <span className="ml-1 grid h-5 min-w-[20px] place-items-center rounded-full bg-amber-400 px-1.5 font-mono text-[10px] font-bold text-slate-950">
                    {unreadSupport || escalatedCount}
                  </span>
                ) : null}
              </button>
              <button type="button" className="btn-ghost !px-2.5 !py-2" onClick={refreshAll} aria-label="Refresh">
                <RefreshCw className="h-4 w-4" aria-hidden />
                <span className="hidden sm:inline">Refresh</span>
              </button>
              <Link href="/app" className="btn-ghost !px-2.5 !py-2 sm:!px-4" aria-label="Workspace">
                <ArrowLeft className="h-4 w-4" aria-hidden />
                <span className="hidden sm:inline">Workspace</span>
              </Link>
            </nav>
          </div>
        </header>

        <div
          id="admin-main"
          className={clsx("mx-auto w-full min-w-0 px-4 pb-16 pt-6 sm:px-6 sm:pt-8 lg:px-8", editing ? "max-w-[1800px]" : "max-w-7xl")}
        >
          {/* Live Support Escalation Notification Banner when admin opens panel */}
          {tab !== "support" &&
          supportNotifs &&
          supportNotifs.recent_escalations.length > 0 &&
          (supportNotifs.unread_total > 0 || supportNotifs.escalated_count > 0) ? (
            <div className="mb-6 rounded-2xl border border-amber-400/50 bg-gradient-to-r from-amber-500/15 via-orange-500/10 to-slate-900/80 p-4 shadow-lg">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-start gap-3">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-amber-400 text-slate-950">
                    <Bell className="h-5 w-5" aria-hidden />
                  </span>
                  <div>
                    <p className="text-sm font-semibold text-amber-200">
                      {(supportNotifs.overdue_count ?? 0) > 0
                        ? `${supportNotifs.overdue_count} ticket(s) waiting 30+ min with no agent reply — ${supportNotifs.escalated_count} open in total`
                        : supportNotifs.escalated_count > 0
                        ? `${supportNotifs.escalated_count} customer(s) requested a Live Agent from the ProteusFlow Bot (≤30min response window)`
                        : `${supportNotifs.unread_total} unread customer support message(s)`}
                    </p>
                    <p className="mt-0.5 text-xs text-slate-300">
                      Click a ticket below to view all customer account details, what they told the bot, and reply with text, screenshots, or video recordings.
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => openTab("support")}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-amber-400 px-3.5 py-2 text-xs font-semibold text-slate-950 transition hover:bg-amber-300"
                >
                  <Headset className="h-4 w-4" aria-hidden />
                  Open Support Console
                </button>
              </div>

              <div className="mt-3 grid gap-2.5 sm:grid-cols-2">
                {supportNotifs.recent_escalations.slice(0, 4).map((item) => (
                  <div
                    key={item.id}
                    className="flex flex-col justify-between rounded-xl border border-white/10 bg-slate-950/65 p-3 text-xs"
                  >
                    <div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-white">
                          #{item.id} · {item.customer.display_name || item.customer.email}
                        </span>
                        <span className="rounded-full bg-amber-500/20 px-2 py-0.5 font-mono text-[10px] text-amber-300">
                          {item.customer.plan_label} · {item.customer.usable_tokens} tok
                        </span>
                      </div>
                      <p className="mt-1 font-mono text-[10px] text-slate-400">
                        {item.customer.email} · {item.customer.batch_count} batches ({item.customer.files_total} files)
                      </p>
                      <p className="mt-1.5 line-clamp-2 whitespace-pre-line rounded-lg bg-white/[0.04] p-2 font-mono text-[11px] text-amber-100/90">
                        {item.issue_summary || item.last_message_preview}
                      </p>
                    </div>
                    <div className="mt-2.5 flex items-center justify-between gap-2">
                      <span className="font-mono text-[10px] text-slate-400">
                        {item.bot_attempts} bot attempts
                      </span>
                      <button
                        type="button"
                        onClick={() => openSupportThread(item.id)}
                        className="rounded-lg bg-emerald-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-emerald-500"
                      >
                        Reply to Customer →
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          <div className="mb-5 flex items-center gap-2">
            {activeTab ? <activeTab.icon className="h-4 w-4 text-meta-300" aria-hidden /> : null}
            <h1 className="font-display text-2xl font-normal leading-tight text-slate-50 sm:text-3xl">
              {activeTab?.label}
            </h1>
          </div>

          {error ? (
            <p className="mb-6 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</p>
          ) : null}

          {tab === "overview" ? (
            <UserSearch onSelectUser={setSelected} onOpenUsers={openUsersWith} />
          ) : null}

          {tab === "overview" ? (
            <OverviewTab
              overview={overview}
              refreshKey={refreshKey}
              onSelectUser={setSelected}
              onOpenAnalytics={() => openTab("analytics")}
            />
          ) : tab === "support" ? (
            <SupportTab
              refreshKey={refreshKey}
              initialThreadId={activeSupportThreadId}
              onSelectUser={setSelected}
              // A stable function: a new one on every render makes the tab reload its ticket in a loop.
              onNotificationsChanged={loadSupportNotifs}
            />
          ) : tab === "users" ? (
            <UsersTab
              plans={plans}
              currency={currency}
              refreshKey={refreshKey}
              onSelectUser={setSelected}
              onChanged={() => void loadShared()}
              initialQuery={usersQuery}
            />
          ) : tab === "sales" ? (
            <SalesTab refreshKey={refreshKey} onSelectUser={setSelected} />
          ) : tab === "affiliates" ? (
            <AffiliatesTab refreshKey={refreshKey} currency={currency} onSelectUser={setSelected} />
          ) : tab === "analytics" ? (
            <AnalyticsTab refreshKey={refreshKey} onSelectUser={setSelected} />
          ) : tab === "landing" ? (
            <ContentEditor key="landing" namespace="landing" pages={[{ path: "/", label: "Landing page" }]} />
          ) : tab === "workspace" ? (
            <ContentEditor key="workspace" namespace="workspace" pages={WORKSPACE_PAGES} />
          ) : tab === "guides" ? (
            <GuidesTab />
          ) : (
            <SettingsTab plans={plans} onPlansChanged={refreshAll} />
          )}
        </div>
      </SidebarInset>

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
    </SidebarProvider>
  );
}
