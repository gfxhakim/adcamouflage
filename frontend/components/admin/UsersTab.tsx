"use client";

import { ChevronLeft, ChevronRight, Download, Loader2, Search, UserPlus } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import AddUserDialog from "@/components/admin/AddUserDialog";
import UsageMeter from "@/components/admin/UsageMeter";
import NeonCard from "@/components/NeonCard";
import { exportUsersUrl, listUsers, type AdminUser, type PlanInfo, type UserPage } from "@/lib/admin";
import { formatMoney, timeAgo } from "@/lib/format";

const PAGE_SIZE = 25;

export function StatusChips({ user }: { user: AdminUser }) {
  return (
    <span className="flex flex-wrap gap-1">
      {user.is_admin ? <span className="chip !px-2 !py-0.5 !border-amber-300 !bg-amber-50 !text-amber-700">Admin</span> : null}
      {!user.is_active ? <span className="chip !px-2 !py-0.5 !border-red-300 !bg-red-50 !text-red-700">Suspended</span> : null}
      {user.plan_expired ? <span className="chip !px-2 !py-0.5 !border-red-300 !bg-red-50 !text-red-700">Expired</span> : null}
    </span>
  );
}

interface UsersTabProps {
  plans: PlanInfo[];
  currency: string;
  /** Bumped when a user changes elsewhere, so the list re-reads. */
  refreshKey: number;
  onSelectUser: (id: number) => void;
  onChanged: () => void;
}

export function UsersTab({ plans, currency, refreshKey, onSelectUser, onChanged }: UsersTabProps) {
  const [query, setQuery] = useState("");
  const [plan, setPlan] = useState("");
  const [state, setState] = useState("");
  const [sort, setSort] = useState("newest");
  const [offset, setOffset] = useState(0);
  const [page, setPage] = useState<UserPage | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const ticket = useRef(0);

  const load = useCallback(async () => {
    const mine = ++ticket.current;
    setLoading(true);
    try {
      const result = await listUsers({ q: query, plan, state, sort }, offset, PAGE_SIZE);
      if (mine === ticket.current) {
        setPage(result);
        setError(null);
      }
    } catch (err) {
      if (mine === ticket.current) setError(err instanceof Error ? err.message : "Could not load users.");
    } finally {
      if (mine === ticket.current) setLoading(false);
    }
  }, [query, plan, state, sort, offset]);

  useEffect(() => {
    // Debounced so typing in the search box does not fire a request per key.
    const timer = setTimeout(() => void load(), 250);
    return () => clearTimeout(timer);
  }, [load, refreshKey]);

  const total = page?.total ?? 0;
  const lastShown = Math.min(offset + PAGE_SIZE, total);
  const resetPage = <T,>(setter: (value: T) => void) => (value: T) => {
    setter(value);
    setOffset(0);
  };

  return (
    <>
      <NeonCard padding="none" radius="xl">
        <div className="space-y-3 border-b border-black/[0.07] p-4 sm:p-5">
          <div className="flex flex-col gap-3 sm:flex-row">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" aria-hidden />
              <input
                type="search"
                className="field !pl-9"
                placeholder="Search by email or name"
                value={query}
                onChange={(event) => resetPage(setQuery)(event.target.value)}
                aria-label="Search users"
              />
            </div>
            <div className="flex gap-2">
              <button type="button" className="btn-primary flex-1 sm:flex-none" onClick={() => setAdding(true)}>
                <UserPlus className="h-4 w-4" aria-hidden />
                Add user
              </button>
              <a
                className="btn-ghost flex-1 sm:flex-none"
                href={exportUsersUrl({ q: query, plan, state })}
                download
              >
                <Download className="h-4 w-4" aria-hidden />
                Export CSV
              </a>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <select className="field" value={plan} onChange={(e) => resetPage(setPlan)(e.target.value)} aria-label="Plan">
              <option value="">All plans</option>
              {plans.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label} ({p.users})
                </option>
              ))}
            </select>
            <select className="field" value={state} onChange={(e) => resetPage(setState)(e.target.value)} aria-label="Status">
              <option value="">Status</option>
              <option value="active">Active</option>
              <option value="suspended">Suspended</option>
              <option value="expired">Plan expired</option>
              <option value="admins">Admins</option>
            </select>
            <select className="field" value={sort} onChange={(e) => resetPage(setSort)(e.target.value)} aria-label="Sort">
              <option value="newest">Newest</option>
              <option value="active">Recently active</option>
              <option value="oldest">Oldest</option>
              <option value="email">Email A–Z</option>
            </select>
          </div>
        </div>

        {error ? <p className="m-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p> : null}

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
                    onClick={() => onSelectUser(user.id)}
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
                    <th className="px-3 py-2.5 font-semibold">Joined</th>
                    <th className="px-5 py-2.5 font-semibold">Last active</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-black/[0.05]">
                  {page.users.map((user) => (
                    <tr key={user.id} className="cursor-pointer hover:bg-meta-50/60" onClick={() => onSelectUser(user.id)}>
                      <td className="max-w-[280px] px-5 py-3">
                        <button
                          type="button"
                          className="block max-w-full truncate text-left font-semibold text-black hover:text-meta-600"
                          onClick={(event) => {
                            event.stopPropagation();
                            onSelectUser(user.id);
                          }}
                        >
                          {user.email}
                        </button>
                        <div className="mt-0.5 flex items-center gap-2">
                          {user.display_name ? <span className="truncate text-xs text-ink-faint">{user.display_name}</span> : null}
                          <StatusChips user={user} />
                        </div>
                      </td>
                      <td className="px-3 py-3 text-xs text-black">
                        {user.plan_label}
                        <span className="block text-ink-faint">{formatMoney(user.price, currency)}/mo</span>
                      </td>
                      <td className="w-40 px-3 py-3">
                        <UsageMeter used={user.used_this_month} quota={user.monthly_quota} />
                      </td>
                      <td className="px-3 py-3 text-xs tabular-nums text-black">{user.batch_count}</td>
                      <td className="whitespace-nowrap px-3 py-3 text-xs text-ink-muted">{timeAgo(user.created_at)}</td>
                      <td className="whitespace-nowrap px-5 py-3 text-xs text-ink-muted">
                        {timeAgo(user.last_seen_at ?? user.last_login_at)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-between gap-3 border-t border-black/[0.07] px-4 py-3 text-xs text-ink-muted sm:px-5">
              <span className="flex items-center gap-2">
                {total === 0 ? "0" : `${offset + 1}–${lastShown}`} of {total}
                {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : null}
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

      {adding ? (
        <AddUserDialog
          plans={plans}
          onClose={() => setAdding(false)}
          onCreated={() => {
            void load();
            onChanged();
          }}
        />
      ) : null}
    </>
  );
}

export default UsersTab;
