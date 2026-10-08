"use client";

import clsx from "clsx";
import {
  Activity,
  ArrowLeft,
  BarChart3,
  ChevronLeft,
  ChevronRight,
  Files,
  Loader2,
  LogOut,
  RefreshCw,
  Search,
  ShieldHalf,
  UserPlus,
  Users,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import ActivityFeed from "@/components/admin/ActivityFeed";
import DailyChart from "@/components/admin/DailyChart";
import UsageMeter from "@/components/admin/UsageMeter";
import UserPanel from "@/components/admin/UserPanel";
import NeonCard from "@/components/NeonCard";
import StatTile from "@/components/StatTile";
import {
  getActivity,
  getOverview,
  getPlans,
  listUsers,
  type ActivityEvent,
  type AdminUser,
  type Overview,
  type PlanInfo,
  type UserPage,
} from "@/lib/admin";
import { fetchMe, signOut, type UserProfile } from "@/lib/auth";
import { timeAgo } from "@/lib/format";

const PAGE_SIZE = 25;
const REFRESH_MS = 30000;

function StatusChips({ user }: { user: AdminUser }) {
  return (
    <span className="flex flex-wrap gap-1">
      {user.is_admin ? <span className="chip !px-2 !py-0.5 !border-amber-300 !bg-amber-50 !text-amber-700">Admin</span> : null}
      {!user.is_active ? <span className="chip !px-2 !py-0.5 !border-red-300 !bg-red-50 !text-red-700">Suspended</span> : null}
      {user.plan_expired ? <span className="chip !px-2 !py-0.5 !border-red-300 !bg-red-50 !text-red-700">Expired</span> : null}
    </span>
  );
}

export default function AdminPage() {
  const [me, setMe] = useState<UserProfile | null>(null);
  const [checked, setChecked] = useState(false);

  const [overview, setOverview] = useState<Overview | null>(null);
  const [plans, setPlans] = useState<PlanInfo[]>([]);
  const [activity, setActivity] = useState<ActivityEvent[]>([]);
  const [page, setPage] = useState<UserPage | null>(null);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const [planFilter, setPlanFilter] = useState("");
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);

  const usersRequest = useRef(0);

  // --- who is looking ----------------------------------------------------
  useEffect(() => {
    fetchMe()
      .then((profile) => {
        if (!profile) {
          void signOut()
            .catch(() => undefined)
            .finally(() => window.location.assign("/login?next=%2Fadmin"));
          return;
        }
        setMe(profile);
        setChecked(true);
      })
      .catch(() => setChecked(true));
  }, []);

  const allowed = Boolean(me?.is_admin);

  // --- data --------------------------------------------------------------
  const loadSummary = useCallback(async () => {
    try {
      const [ov, feed] = await Promise.all([getOverview(), getActivity(40)]);
      setOverview(ov);
      setActivity(feed);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load the admin data.");
    }
  }, []);

  const loadUsers = useCallback(async () => {
    const ticket = ++usersRequest.current;
    setLoadingUsers(true);
    try {
      const result = await listUsers(query, planFilter, offset, PAGE_SIZE);
      if (ticket === usersRequest.current) setPage(result);
    } catch (err) {
      if (ticket === usersRequest.current) {
        setError(err instanceof Error ? err.message : "Could not load users.");
      }
    } finally {
      if (ticket === usersRequest.current) setLoadingUsers(false);
    }
  }, [query, planFilter, offset]);

  useEffect(() => {
    if (!allowed) return;
    void getPlans().then(setPlans).catch(() => undefined);
    void loadSummary();
    const timer = setInterval(() => void loadSummary(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [allowed, loadSummary]);

  useEffect(() => {
    if (!allowed) return;
    // Debounced so typing in the search box does not fire a request per key.
    const timer = setTimeout(() => void loadUsers(), 250);
    return () => clearTimeout(timer);
  }, [allowed, loadUsers]);

  const handleChanged = useCallback(
    (updated: AdminUser) => {
      setPage((current) =>
        current
          ? { ...current, users: current.users.map((u) => (u.id === updated.id ? updated : u)) }
          : current,
      );
      void loadSummary();
    },
    [loadSummary],
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
      <div className="grid min-h-screen place-items-center text-ink-faint">
        <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
      </div>
    );
  }

  if (!allowed) {
    return (
      <main className="mx-auto grid min-h-screen max-w-md place-items-center px-4">
        <NeonCard padding="lg" radius="xl" className="w-full text-center">
          <ShieldHalf className="mx-auto h-8 w-8 text-meta-500" aria-hidden />
          <h1 className="mt-3 text-lg font-semibold text-black">Admins only</h1>
          <p className="mt-1 text-sm text-ink-muted">
            {me ? `${me.email} does not have admin access.` : "Sign in with an admin account to continue."}
          </p>
          <Link href="/app" className="btn-primary mt-5">
            <ArrowLeft className="h-4 w-4" aria-hidden />
            Back to workspace
          </Link>
        </NeonCard>
      </main>
    );
  }

  const total = page?.total ?? 0;
  const lastShown = Math.min(offset + PAGE_SIZE, total);

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
      </header>

      <main className="mx-auto max-w-7xl px-4 pb-16 pt-6 sm:px-6 sm:pt-8 lg:px-8">
        <section className="mb-6 flex flex-wrap items-end justify-between gap-3 sm:mb-8">
          <div>
            <p className="label">Admin</p>
            <h1 className="text-2xl font-bold tracking-tight text-black sm:text-3xl">Users &amp; subscriptions</h1>
            <p className="mt-1 max-w-2xl text-sm text-ink-muted">
              See who is using the app, put people on a plan, set their monthly limit, or suspend an account.
            </p>
          </div>
          <button
            type="button"
            className="btn-ghost"
            onClick={() => {
              void loadSummary();
              void loadUsers();
            }}
          >
            <RefreshCw className={clsx("h-4 w-4", loadingUsers && "animate-spin")} aria-hidden />
            Refresh
          </button>
        </section>

        {error ? (
          <p className="mb-6 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>
        ) : null}

        <section className="mb-8 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
          <StatTile
            icon={Users}
            label="Users"
            value={overview ? String(overview.total_users) : "—"}
            hint={overview ? `${overview.suspended_users} suspended` : "loading"}
          />
          <StatTile
            icon={Activity}
            label="Active, 7 days"
            value={overview ? String(overview.active_7d) : "—"}
            hint="signed in or used the app"
            tone="slow"
          />
          <StatTile
            icon={Files}
            label="Files this month"
            value={overview ? String(overview.files_this_month) : "—"}
            hint={overview ? `${overview.batches_today} batches today` : "loading"}
          />
          <StatTile
            icon={UserPlus}
            label="New, 7 days"
            value={overview ? String(overview.signups_7d) : "—"}
            hint="sign-ups"
            tone={overview && overview.signups_7d > 0 ? "success" : "muted"}
          />
        </section>

        <section className="grid gap-6 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
          {/* Users ----------------------------------------------------------- */}
          <NeonCard padding="none" radius="xl">
            <div className="flex flex-col gap-3 border-b border-black/[0.07] p-4 sm:flex-row sm:items-center sm:p-5">
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" aria-hidden />
                <input
                  type="search"
                  className="field !pl-9"
                  placeholder="Search by email or name"
                  value={query}
                  onChange={(event) => {
                    setQuery(event.target.value);
                    setOffset(0);
                  }}
                  aria-label="Search users"
                />
              </div>
              <select
                className="field sm:!w-44"
                value={planFilter}
                onChange={(event) => {
                  setPlanFilter(event.target.value);
                  setOffset(0);
                }}
                aria-label="Filter by plan"
              >
                <option value="">All plans</option>
                {plans.map((plan) => (
                  <option key={plan.id} value={plan.id}>
                    {plan.label}
                    {overview?.plans[plan.id] !== undefined ? ` (${overview.plans[plan.id]})` : ""}
                  </option>
                ))}
              </select>
            </div>

            {!page ? (
              <div className="grid place-items-center py-16 text-ink-faint">
                <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
              </div>
            ) : page.users.length === 0 ? (
              <p className="py-12 text-center text-sm text-ink-faint">No users match.</p>
            ) : (
              <>
                {/* Phones: one tappable card per user. */}
                <ul className="divide-y divide-black/[0.06] md:hidden">
                  {page.users.map((user) => (
                    <li key={user.id}>
                      <button
                        type="button"
                        onClick={() => setSelected(user.id)}
                        className="block w-full px-4 py-3 text-left hover:bg-meta-50/60"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold text-black">{user.email}</p>
                            <p className="text-xs text-ink-faint">
                              {user.plan_label} · active {timeAgo(user.last_seen_at ?? user.last_login_at)}
                            </p>
                          </div>
                          <StatusChips user={user} />
                        </div>
                        <UsageMeter className="mt-2" used={user.used_this_month} quota={user.monthly_quota} />
                      </button>
                    </li>
                  ))}
                </ul>

                {/* Tablets and up: a table. */}
                <div className="hidden overflow-x-auto md:block">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="border-b border-black/[0.07] text-[11px] uppercase tracking-[0.12em] text-ink-subtle">
                        <th className="px-5 py-2.5 font-semibold">User</th>
                        <th className="px-3 py-2.5 font-semibold">Plan</th>
                        <th className="px-3 py-2.5 font-semibold">This month</th>
                        <th className="px-3 py-2.5 font-semibold">Batches</th>
                        <th className="px-5 py-2.5 font-semibold">Last active</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-black/[0.05]">
                      {page.users.map((user) => (
                        <tr
                          key={user.id}
                          className="cursor-pointer hover:bg-meta-50/60"
                          onClick={() => setSelected(user.id)}
                        >
                          <td className="max-w-[260px] px-5 py-3">
                            <button
                              type="button"
                              className="block max-w-full truncate text-left font-semibold text-black hover:text-meta-600"
                              onClick={(event) => {
                                event.stopPropagation();
                                setSelected(user.id);
                              }}
                            >
                              {user.email}
                            </button>
                            <div className="mt-0.5 flex items-center gap-2">
                              {user.display_name ? (
                                <span className="truncate text-xs text-ink-faint">{user.display_name}</span>
                              ) : null}
                              <StatusChips user={user} />
                            </div>
                          </td>
                          <td className="px-3 py-3 text-xs text-black">{user.plan_label}</td>
                          <td className="w-40 px-3 py-3">
                            <UsageMeter used={user.used_this_month} quota={user.monthly_quota} />
                          </td>
                          <td className="px-3 py-3 text-xs tabular-nums text-black">{user.batch_count}</td>
                          <td className="whitespace-nowrap px-5 py-3 text-xs text-ink-muted">
                            {timeAgo(user.last_seen_at ?? user.last_login_at)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="flex items-center justify-between gap-3 border-t border-black/[0.07] px-4 py-3 text-xs text-ink-muted sm:px-5">
                  <span>
                    {total === 0 ? "0" : `${offset + 1}–${lastShown}`} of {total}
                  </span>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className="btn-ghost !p-2"
                      disabled={offset === 0}
                      onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
                      aria-label="Previous page"
                    >
                      <ChevronLeft className="h-4 w-4" aria-hidden />
                    </button>
                    <button
                      type="button"
                      className="btn-ghost !p-2"
                      disabled={lastShown >= total}
                      onClick={() => setOffset(offset + PAGE_SIZE)}
                      aria-label="Next page"
                    >
                      <ChevronRight className="h-4 w-4" aria-hidden />
                    </button>
                  </div>
                </div>
              </>
            )}
          </NeonCard>

          {/* Side column ----------------------------------------------------- */}
          <div className="space-y-6">
            <NeonCard padding="lg" radius="xl" tone="slow">
              <div className="mb-4 flex items-center gap-2">
                <BarChart3 className="h-4 w-4 text-meta-500" aria-hidden />
                <h2 className="text-sm font-semibold tracking-tight text-black">Usage</h2>
              </div>
              {overview ? <DailyChart daily={overview.daily} /> : <div className="h-36" />}
            </NeonCard>

            <NeonCard padding="lg" radius="xl">
              <div className="mb-2 flex items-center gap-2">
                <Activity className="h-4 w-4 text-meta-500" aria-hidden />
                <h2 className="text-sm font-semibold tracking-tight text-black">Live activity</h2>
              </div>
              <div className="max-h-[520px] overflow-y-auto pr-1">
                <ActivityFeed events={activity} onSelectUser={setSelected} />
              </div>
            </NeonCard>
          </div>
        </section>
      </main>

      {selected !== null ? (
        <UserPanel
          userId={selected}
          plans={plans}
          selfId={me?.id ?? null}
          onClose={closePanel}
          onChanged={handleChanged}
        />
      ) : null}
    </>
  );
}
