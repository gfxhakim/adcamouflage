"use client";

import clsx from "clsx";
import { Ban, CalendarClock, Loader2, RotateCcw, Save, ShieldCheck, ShieldOff, UserCheck, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import ActivityFeed from "@/components/admin/ActivityFeed";
import UsageMeter from "@/components/admin/UsageMeter";
import NeonCard from "@/components/NeonCard";
import {
  getUser,
  resetUsage,
  updateUser,
  type AdminUser,
  type PlanInfo,
  type UserDetail,
  type UserUpdate,
} from "@/lib/admin";
import { formatDate, timeAgo } from "@/lib/format";

interface UserPanelProps {
  userId: number;
  plans: PlanInfo[];
  /** The signed-in admin, who cannot suspend or demote themselves. */
  selfId: number | null;
  onClose: () => void;
  onChanged: (user: AdminUser) => void;
}

interface PlanForm {
  plan: string;
  unlimited: boolean;
  quota: string;
  expires: string;
}

function formFrom(user: AdminUser): PlanForm {
  return {
    plan: user.plan,
    unlimited: user.monthly_quota === null,
    quota: user.monthly_quota === null ? "" : String(user.monthly_quota),
    expires: user.plan_expires_at ? user.plan_expires_at.slice(0, 10) : "",
  };
}

/** A side sheet (full screen on phones) for one user's plan, usage and history. */
export function UserPanel({ userId, plans, selfId, onClose, onChanged }: UserPanelProps) {
  const [detail, setDetail] = useState<UserDetail | null>(null);
  const [form, setForm] = useState<PlanForm | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await getUser(userId);
      setDetail(data);
      setForm(formFrom(data.user));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load this user.");
    }
  }, [userId]);

  useEffect(() => {
    setDetail(null);
    setNotice(null);
    void load();
  }, [load]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [onClose]);

  const run = async (label: string, action: () => Promise<AdminUser>, done: string) => {
    setBusy(label);
    setError(null);
    setNotice(null);
    try {
      const updated = await action();
      onChanged(updated);
      await load();
      setNotice(done);
    } catch (err) {
      setError(err instanceof Error ? err.message : "That change did not go through.");
    } finally {
      setBusy(null);
    }
  };

  const user = detail?.user;
  const isSelf = user ? user.id === selfId : false;

  const savePlan = () => {
    if (!user || !form) return;
    const changes: UserUpdate = {};
    if (form.plan !== user.plan) changes.plan = form.plan;

    const quota = form.unlimited ? null : Number.parseInt(form.quota, 10);
    if (!form.unlimited && (Number.isNaN(quota) || (quota ?? 0) < 0)) {
      setError("Enter a monthly limit of 0 or more, or tick Unlimited.");
      return;
    }
    // Always send the limit so a custom number survives a plan change.
    changes.monthly_quota = quota;

    const currentExpiry = user.plan_expires_at ? user.plan_expires_at.slice(0, 10) : "";
    if (form.expires !== currentExpiry) {
      // End of the chosen day, UTC, so the plan runs through that whole date.
      changes.plan_expires_at = form.expires ? `${form.expires}T23:59:59Z` : null;
    }
    void run("plan", () => updateUser(user.id, changes), "Plan saved.");
  };

  const pickPlan = (planId: string) => {
    const plan = plans.find((p) => p.id === planId);
    setForm((current) =>
      current
        ? {
            ...current,
            plan: planId,
            unlimited: plan ? plan.monthly_quota === null : current.unlimited,
            quota: plan && plan.monthly_quota !== null ? String(plan.monthly_quota) : "",
          }
        : current,
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label="User details">
      <button
        type="button"
        className="absolute inset-0 bg-black/30 backdrop-blur-[2px]"
        aria-label="Close"
        onClick={onClose}
      />

      <div className="relative h-full w-full overflow-y-auto bg-white p-3 sm:max-w-xl sm:p-4">
        <div className="sticky top-0 z-10 -mx-3 -mt-3 mb-3 flex items-center justify-between gap-3 border-b border-black/[0.07] bg-white/95 px-4 py-3 backdrop-blur sm:-mx-4 sm:-mt-4">
          <div className="min-w-0">
            <p className="label">User</p>
            <p className="truncate text-sm font-semibold text-black">{user?.email ?? "Loading…"}</p>
          </div>
          <button type="button" onClick={onClose} className="btn-ghost !p-2" aria-label="Close">
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>

        {!detail ? (
          <div className="grid place-items-center py-20 text-ink-faint">
            {error ? (
              <p className="text-sm text-red-600">{error}</p>
            ) : (
              <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
            )}
          </div>
        ) : (
          <div className="space-y-4">
            {/* Summary ---------------------------------------------------- */}
            <NeonCard padding="md" radius="lg" tone={user!.is_active ? "default" : "danger"}>
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="chip !border-meta-500/30 !bg-meta-50 !text-meta-700">{user!.plan_label}</span>
                {user!.is_admin ? <span className="chip !border-amber-300 !bg-amber-50 !text-amber-700">Admin</span> : null}
                {!user!.is_active ? <span className="chip !border-red-300 !bg-red-50 !text-red-700">Suspended</span> : null}
                {user!.plan_expired ? <span className="chip !border-red-300 !bg-red-50 !text-red-700">Plan expired</span> : null}
              </div>
              {user!.display_name ? <p className="mt-2 text-sm text-black">{user!.display_name}</p> : null}
              <UsageMeter className="mt-3" used={user!.used_this_month} quota={user!.monthly_quota} />
              <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                <div>
                  <dt className="text-ink-faint">Joined</dt>
                  <dd className="text-black">{formatDate(user!.created_at)}</dd>
                </div>
                <div>
                  <dt className="text-ink-faint">Last active</dt>
                  <dd className="text-black">{timeAgo(user!.last_seen_at ?? user!.last_login_at)}</dd>
                </div>
                <div>
                  <dt className="text-ink-faint">Batches</dt>
                  <dd className="text-black tabular-nums">{user!.batch_count}</dd>
                </div>
                <div>
                  <dt className="text-ink-faint">Files, all time</dt>
                  <dd className="text-black tabular-nums">{user!.files_total}</dd>
                </div>
                <div className="col-span-2">
                  <dt className="text-ink-faint">Plan ends</dt>
                  <dd className="text-black">{user!.plan_expires_at ? formatDate(user!.plan_expires_at) : "No end date"}</dd>
                </div>
              </dl>
            </NeonCard>

            {error ? (
              <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>
            ) : null}
            {notice ? (
              <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">{notice}</p>
            ) : null}

            {/* Subscription ------------------------------------------------ */}
            {form ? (
              <NeonCard padding="md" radius="lg" tone="slow">
                <h3 className="mb-3 text-sm font-semibold text-black">Subscription</h3>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block">
                    <span className="label">Plan</span>
                    <select
                      className="field mt-1"
                      value={form.plan}
                      onChange={(event) => pickPlan(event.target.value)}
                    >
                      {plans.map((plan) => (
                        <option key={plan.id} value={plan.id}>
                          {plan.label}
                          {plan.monthly_quota === null ? " (unlimited)" : ` (${plan.monthly_quota}/month)`}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="block">
                    <span className="label">Plan ends</span>
                    <input
                      type="date"
                      className="field mt-1"
                      value={form.expires}
                      onChange={(event) => setForm({ ...form, expires: event.target.value })}
                    />
                  </label>

                  <label className="block">
                    <span className="label">Files per month</span>
                    <input
                      type="number"
                      min={0}
                      inputMode="numeric"
                      className="field mt-1 disabled:bg-black/[0.03] disabled:text-ink-faint"
                      value={form.unlimited ? "" : form.quota}
                      placeholder={form.unlimited ? "Unlimited" : "e.g. 100"}
                      disabled={form.unlimited}
                      onChange={(event) => setForm({ ...form, quota: event.target.value })}
                    />
                  </label>

                  <label className="flex items-center gap-2 self-end pb-2 text-sm text-black">
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-meta-500"
                      checked={form.unlimited}
                      onChange={(event) => setForm({ ...form, unlimited: event.target.checked })}
                    />
                    Unlimited
                  </label>
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  <button type="button" className="btn-primary" disabled={busy !== null} onClick={savePlan}>
                    {busy === "plan" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Save className="h-4 w-4" aria-hidden />}
                    Save plan
                  </button>
                  {form.expires ? (
                    <button
                      type="button"
                      className="btn-ghost"
                      disabled={busy !== null}
                      onClick={() => setForm({ ...form, expires: "" })}
                    >
                      <CalendarClock className="h-4 w-4" aria-hidden />
                      Clear end date
                    </button>
                  ) : null}
                </div>
                <p className="mt-3 text-[11px] leading-relaxed text-ink-faint">
                  Every uploaded file counts as one, and each extra variant counts again. The count starts over on the
                  1st of each month.
                </p>
              </NeonCard>
            ) : null}

            {/* Account actions --------------------------------------------- */}
            <NeonCard padding="md" radius="lg" tone="muted">
              <h3 className="mb-3 text-sm font-semibold text-black">Account</h3>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="btn-ghost"
                  disabled={busy !== null}
                  onClick={() => void run("reset", () => resetUsage(user!.id), "Usage reset to 0 for this month.")}
                >
                  <RotateCcw className={clsx("h-4 w-4", busy === "reset" && "animate-spin")} aria-hidden />
                  Reset this month&apos;s usage
                </button>

                {user!.is_active ? (
                  <button
                    type="button"
                    className="btn-danger"
                    disabled={busy !== null || isSelf}
                    title={isSelf ? "You cannot suspend yourself" : undefined}
                    onClick={() => {
                      if (window.confirm(`Suspend ${user!.email}? They will be signed out and cannot sign in.`)) {
                        void run("active", () => updateUser(user!.id, { is_active: false }), "Account suspended.");
                      }
                    }}
                  >
                    <Ban className="h-4 w-4" aria-hidden />
                    Suspend
                  </button>
                ) : (
                  <button
                    type="button"
                    className="btn-ghost"
                    disabled={busy !== null}
                    onClick={() => void run("active", () => updateUser(user!.id, { is_active: true }), "Account reactivated.")}
                  >
                    <UserCheck className="h-4 w-4" aria-hidden />
                    Reactivate
                  </button>
                )}

                {user!.is_admin ? (
                  <button
                    type="button"
                    className="btn-ghost"
                    disabled={busy !== null || isSelf || user!.admin_from_settings}
                    title={
                      isSelf
                        ? "You cannot remove your own admin access"
                        : user!.admin_from_settings
                          ? "Set in ADCAM_ADMIN_EMAILS on the server"
                          : undefined
                    }
                    onClick={() => void run("admin", () => updateUser(user!.id, { is_admin: false }), "Admin access removed.")}
                  >
                    <ShieldOff className="h-4 w-4" aria-hidden />
                    Remove admin
                  </button>
                ) : (
                  <button
                    type="button"
                    className="btn-ghost"
                    disabled={busy !== null}
                    onClick={() => {
                      if (window.confirm(`Make ${user!.email} an admin? They will see every user and can change plans.`)) {
                        void run("admin", () => updateUser(user!.id, { is_admin: true }), "Now an admin.");
                      }
                    }}
                  >
                    <ShieldCheck className="h-4 w-4" aria-hidden />
                    Make admin
                  </button>
                )}
              </div>
            </NeonCard>

            {/* History ----------------------------------------------------- */}
            <NeonCard padding="md" radius="lg" tone="muted">
              <h3 className="mb-2 text-sm font-semibold text-black">Recent batches</h3>
              {detail.batches.length === 0 ? (
                <p className="py-3 text-xs text-ink-faint">No batches yet.</p>
              ) : (
                <ul className="divide-y divide-black/[0.06]">
                  {detail.batches.map((batch) => (
                    <li key={batch.id} className="flex items-center justify-between gap-3 py-2 text-xs">
                      <span className="text-black">
                        <span className="font-semibold tabular-nums">{batch.asset_count}</span>{" "}
                        {batch.asset_count === 1 ? "file" : "files"}
                        <span className="text-ink-faint"> · {batch.preset}</span>
                      </span>
                      <time className="text-ink-faint" dateTime={batch.created_at} title={new Date(batch.created_at).toLocaleString()}>
                        {timeAgo(batch.created_at)}
                      </time>
                    </li>
                  ))}
                </ul>
              )}
            </NeonCard>

            <NeonCard padding="md" radius="lg" tone="muted">
              <h3 className="mb-1 text-sm font-semibold text-black">Activity</h3>
              <ActivityFeed events={detail.activity} hideEmail />
            </NeonCard>
          </div>
        )}
      </div>
    </div>
  );
}

export default UserPanel;
