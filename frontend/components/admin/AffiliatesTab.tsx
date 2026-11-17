"use client";

import clsx from "clsx";
import { BadgeDollarSign, Flag, Gift, Loader2, Megaphone, Plus, Trash2, UserPlus, Wallet } from "lucide-react";
import { useCallback, useEffect, useState, type ReactNode } from "react";

import NeonCard from "@/components/NeonCard";
import StatTile from "@/components/StatTile";
import {
  actOnReferral,
  decidePartner,
  getAffiliateReferrals,
  getAffiliates,
  getPartnerDetail,
  recordPartnerPayout,
  saveAffiliateProgram,
  type AffiliateOverview,
  type AffiliatePartnerDetail,
  type AffiliatePartnerRow,
  type AffiliateProgram,
  type AffiliateReferral,
} from "@/lib/admin";
import { formatDate, formatMoney, formatTokens, timeAgo } from "@/lib/format";

interface AffiliatesTabProps {
  refreshKey: number;
  currency: string;
  onSelectUser: (id: number) => void;
}

const text = "text-black dark:text-slate-100";
const faint = "text-ink-faint dark:text-slate-500";
const line = "border-black/10 dark:border-white/10";
const rows = "divide-y divide-black/[0.06] dark:divide-white/10";

const STATUS_TONE: Record<string, string> = {
  approved: "!border-emerald-300 !bg-emerald-50 !text-emerald-700 dark:!border-emerald-500/40 dark:!bg-emerald-500/10 dark:!text-emerald-300",
  rewarded: "!border-emerald-300 !bg-emerald-50 !text-emerald-700 dark:!border-emerald-500/40 dark:!bg-emerald-500/10 dark:!text-emerald-300",
  active: "!border-emerald-300 !bg-emerald-50 !text-emerald-700 dark:!border-emerald-500/40 dark:!bg-emerald-500/10 dark:!text-emerald-300",
  paid: "!border-emerald-300 !bg-emerald-50 !text-emerald-700 dark:!border-emerald-500/40 dark:!bg-emerald-500/10 dark:!text-emerald-300",
  pending: "!border-amber-300 !bg-amber-50 !text-amber-700 dark:!border-amber-500/40 dark:!bg-amber-500/10 dark:!text-amber-300",
  waiting: "!border-amber-300 !bg-amber-50 !text-amber-700 dark:!border-amber-500/40 dark:!bg-amber-500/10 dark:!text-amber-300",
  payable: "!border-meta-500/40 !bg-meta-50 !text-meta-700 dark:!bg-meta-500/10 dark:!text-meta-300",
  blocked: "!border-red-300 !bg-red-50 !text-red-700 dark:!border-red-500/40 dark:!bg-red-500/10 dark:!text-red-300",
  suspended: "!border-red-300 !bg-red-50 !text-red-700 dark:!border-red-500/40 dark:!bg-red-500/10 dark:!text-red-300",
};

const STATUS_TEXT: Record<string, string> = {
  signed_up: "signed up",
  waiting: "reward on hold",
  capped: "over monthly cap",
  ended: "customer left",
  payable: "ready to pay",
  pending: "on hold",
};

function Chip({ status, label }: { status: string; label?: string }) {
  return <span className={clsx("chip !text-[10px]", STATUS_TONE[status])}>{label ?? STATUS_TEXT[status] ?? status}</span>;
}

function Card({ title, icon, hint, action, children }: { title: string; icon?: ReactNode; hint?: string; action?: ReactNode; children: ReactNode }) {
  return (
    <NeonCard padding="lg" radius="xl" tone="muted">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className={clsx("flex items-center gap-2 text-sm font-semibold tracking-tight", text)}>
            {icon}
            {title}
          </h3>
          {hint ? <p className={clsx("mt-0.5 text-xs", faint)}>{hint}</p> : null}
        </div>
        {action}
      </div>
      <div className="mt-4">{children}</div>
    </NeonCard>
  );
}

function Num({ label, value, onChange, step = "1", suffix }: { label: string; value: number; onChange: (v: number) => void; step?: string; suffix?: string }) {
  return (
    <label className="block">
      <span className="label">
        {label}
        {suffix ? ` (${suffix})` : ""}
      </span>
      <input
        className="field mt-1"
        type="number"
        min={0}
        step={step}
        value={Number.isFinite(value) ? value : 0}
        onChange={(e) => onChange(e.target.value === "" ? 0 : Number(e.target.value))}
      />
    </label>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className={clsx("flex cursor-pointer items-center gap-2 text-xs font-medium", text)}>
      <input type="checkbox" className="h-4 w-4 accent-[#0866ff]" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

function PlanChecks({ plans, value, onChange }: { plans: AffiliateOverview["plans"]; value: string[]; onChange: (v: string[]) => void }) {
  return (
    <div>
      <span className="label">Plans the coupon works on</span>
      <div className="mt-1.5 flex flex-wrap gap-3">
        {plans.map((plan) => (
          <Toggle
            key={plan.id}
            label={plan.label}
            checked={value.includes(plan.id)}
            onChange={(on) => onChange(on ? [...value, plan.id] : value.filter((id) => id !== plan.id))}
          />
        ))}
      </div>
    </div>
  );
}

// --------------------------------------------------------------------------
// settings
// --------------------------------------------------------------------------

function SettingsCard({ overview, currency, onSaved }: { overview: AffiliateOverview; currency: string; onSaved: () => void }) {
  const [program, setProgram] = useState<AffiliateProgram>(overview.program);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => setProgram(overview.program), [overview.program]);

  const friend = (patch: Partial<AffiliateProgram["friend"]>) => setProgram((p) => ({ ...p, friend: { ...p.friend, ...patch } }));
  const partner = (patch: Partial<AffiliateProgram["partner"]>) => setProgram((p) => ({ ...p, partner: { ...p.partner, ...patch } }));
  const setTier = (index: number, patch: Partial<AffiliateProgram["partner"]["tiers"][number]>) =>
    partner({ tiers: program.partner.tiers.map((tier, i) => (i === index ? { ...tier, ...patch } : tier)) });

  const save = async () => {
    setBusy(true);
    setMessage(null);
    try {
      await saveAffiliateProgram(program);
      setMessage({ ok: true, text: "Saved. New numbers apply from now on." });
      onSaved();
    } catch (err) {
      setMessage({ ok: false, text: err instanceof Error ? err.message : "Could not save." });
    } finally {
      setBusy(false);
    }
  };

  const price = (pct: number, plans: string[]) =>
    overview.plans
      .filter((plan) => plans.includes(plan.id))
      .map((plan) => `${plan.label} ${formatMoney(Math.round(plan.price * (100 - pct)) / 100, currency)}`)
      .join(" · ");

  return (
    <Card title="Program settings" hint="Every number of the program. Changes apply to new clicks, payments and rewards.">
      <div className="grid gap-6 xl:grid-cols-2">
        <div className={clsx("space-y-4 rounded-xl border p-4", line)}>
          <div className="flex items-center justify-between gap-3">
            <p className={clsx("flex items-center gap-2 text-sm font-semibold", text)}>
              <Gift className="h-4 w-4 text-meta-500" aria-hidden /> Friend referral
            </p>
            <Toggle label="On" checked={program.friend.enabled} onChange={(enabled) => friend({ enabled })} />
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <Num label="Friend's discount" suffix="%" value={program.friend.discount_pct} step="0.5" onChange={(discount_pct) => friend({ discount_pct })} />
            <Num label="Reward after" suffix="days" value={program.friend.hold_days} onChange={(hold_days) => friend({ hold_days })} />
            <Num label="Max rewards" suffix="per month" value={program.friend.monthly_cap} onChange={(monthly_cap) => friend({ monthly_cap })} />
          </div>
          <PlanChecks plans={overview.plans} value={program.friend.plans} onChange={(plans) => friend({ plans })} />
          <p className={clsx("text-[11px]", faint)}>First payment with the coupon: {price(program.friend.discount_pct, program.friend.plans) || "no plan selected"}</p>
          <div>
            <span className="label">Reward tokens for the referrer, by the friend&apos;s plan</span>
            <div className="mt-1 grid gap-3 sm:grid-cols-3">
              {overview.plans.map((plan) => (
                <Num
                  key={plan.id}
                  label={plan.label}
                  value={program.friend.reward_tokens[plan.id] ?? 0}
                  step="50"
                  onChange={(tokens) => friend({ reward_tokens: { ...program.friend.reward_tokens, [plan.id]: tokens } })}
                />
              ))}
            </div>
          </div>
        </div>

        <div className={clsx("space-y-4 rounded-xl border p-4", line)}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className={clsx("flex items-center gap-2 text-sm font-semibold", text)}>
              <Megaphone className="h-4 w-4 text-meta-500" aria-hidden /> Creator partners
            </p>
            <div className="flex gap-4">
              <Toggle label="Applications open" checked={program.partner.applications_open} onChange={(applications_open) => partner({ applications_open })} />
              <Toggle label="On" checked={program.partner.enabled} onChange={(enabled) => partner({ enabled })} />
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <Num label="Audience discount" suffix="%" value={program.partner.discount_pct} step="0.5" onChange={(discount_pct) => partner({ discount_pct })} />
            <Num label="Commission ready after" suffix="days" value={program.partner.hold_days} onChange={(hold_days) => partner({ hold_days })} />
            <Num label="Minimum payout" suffix={currency} value={program.partner.min_payout} step="5" onChange={(min_payout) => partner({ min_payout })} />
          </div>
          <PlanChecks plans={overview.plans} value={program.partner.plans} onChange={(plans) => partner({ plans })} />
          <p className={clsx("text-[11px]", faint)}>First payment with the coupon: {price(program.partner.discount_pct, program.partner.plans) || "no plan selected"}</p>
          <div>
            <span className="label">Commission tiers, by paying customers in the month</span>
            <div className="mt-1 space-y-2">
              {program.partner.tiers.map((tier, index) => (
                <div key={index} className="flex items-end gap-2">
                  <div className="flex-1">
                    <Num label={index === 0 ? "From customers" : ""} value={tier.min} onChange={(min) => setTier(index, { min: index === 0 ? 0 : min })} />
                  </div>
                  <div className="flex-1">
                    <Num label={index === 0 ? "Commission %" : ""} value={tier.pct} step="0.5" onChange={(pct) => setTier(index, { pct })} />
                  </div>
                  <button
                    type="button"
                    className="btn-ghost !px-2.5 !py-2.5"
                    aria-label="Remove tier"
                    disabled={index === 0}
                    onClick={() => partner({ tiers: program.partner.tiers.filter((_, i) => i !== index) })}
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden />
                  </button>
                </div>
              ))}
              <button
                type="button"
                className="btn-ghost !py-1.5 !text-xs"
                onClick={() => {
                  const last = program.partner.tiers[program.partner.tiers.length - 1];
                  partner({ tiers: [...program.partner.tiers, { min: (last?.min ?? 0) + 10, pct: last?.pct ?? 25 }] });
                }}
              >
                <Plus className="h-3.5 w-3.5" aria-hidden /> Add tier
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-end gap-4">
        <div className="w-44">
          <Num label="A link counts for" suffix="days after the click" value={program.link_days} onChange={(link_days) => setProgram((p) => ({ ...p, link_days }))} />
        </div>
        <button type="button" className="btn-primary !py-2.5 !text-sm" disabled={busy} onClick={() => void save()}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
          Save settings
        </button>
        {message ? <p className={clsx("text-xs", message.ok ? "text-emerald-600 dark:text-emerald-300" : "text-red-600 dark:text-red-300")}>{message.text}</p> : null}
      </div>
    </Card>
  );
}

// --------------------------------------------------------------------------
// partners
// --------------------------------------------------------------------------

function PartnerDetail({ userId, currency, onChanged }: { userId: number; currency: string; onChanged: () => void }) {
  const [detail, setDetail] = useState<AffiliatePartnerDetail | null>(null);
  const [method, setMethod] = useState("");
  const [reference, setReference] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const next = await getPartnerDetail(userId);
      setDetail(next);
      setMethod((current) => current || next.partner.payout_method);
    } catch (err) {
      setMessage({ ok: false, text: err instanceof Error ? err.message : "Could not load the partner." });
    }
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!detail) {
    return (
      <p className={clsx("flex items-center gap-2 py-3 text-xs", faint)}>
        {message ? message.text : <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
      </p>
    );
  }

  const payable = detail.partner.totals.payable;

  const pay = async (force: boolean) => {
    const sure = window.confirm(
      `Record a payout of ${formatMoney(payable, currency)} to ${detail.partner.email}?\n\n` +
        "Send the money yourself first. This only marks the commissions as paid; the app does not move money.",
    );
    if (!sure) return;
    setBusy(true);
    setMessage(null);
    try {
      const done = await recordPartnerPayout(userId, { method, reference, note: "", force });
      setMessage({ ok: true, text: `Recorded ${formatMoney(done.amount, currency)} as paid.` });
      setReference("");
      await load();
      onChanged();
    } catch (err) {
      const reason = err instanceof Error ? err.message : "Could not record the payout.";
      if (!force && /minimum/i.test(reason) && window.confirm(`${reason}\n\nPay it anyway?`)) {
        setBusy(false);
        void pay(true);
        return;
      }
      setMessage({ ok: false, text: reason });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={clsx("space-y-4 border-t px-3 py-4", line)}>
      {detail.partner.audience ? (
        <p className={clsx("whitespace-pre-wrap text-xs", faint)}>
          <span className={clsx("font-semibold", text)}>Audience: </span>
          {detail.partner.audience}
        </p>
      ) : null}
      <p className={clsx("text-xs", faint)}>
        <span className={clsx("font-semibold", text)}>Pay to: </span>
        {detail.partner.payout_method || "not set"} {detail.partner.payout_address}
      </p>

      <div className={clsx("rounded-xl border p-3", line)}>
        <p className={clsx("text-xs font-semibold", text)}>
          Ready to pay: {formatMoney(payable, currency)}
          <span className={clsx("font-normal", faint)}>
            {" "}
            · on hold {formatMoney(detail.partner.totals.pending, currency)} · paid so far {formatMoney(detail.partner.totals.paid, currency)}
          </span>
        </p>
        <div className="mt-2 grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_auto]">
          <input className="field" placeholder="Method, e.g. USDT TRC-20" value={method} maxLength={40} onChange={(e) => setMethod(e.target.value)} aria-label="Payout method" />
          <input className="field" placeholder="Transaction id or note" value={reference} maxLength={300} onChange={(e) => setReference(e.target.value)} aria-label="Payout reference" />
          <button type="button" className="btn-primary !py-2 !text-xs" disabled={busy || payable <= 0} onClick={() => void pay(false)}>
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Wallet className="h-3.5 w-3.5" aria-hidden />}
            Mark paid
          </button>
        </div>
        {message ? <p className={clsx("mt-2 text-xs", message.ok ? "text-emerald-600 dark:text-emerald-300" : "text-red-600 dark:text-red-300")}>{message.text}</p> : null}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div>
          <p className="label mb-1">By month</p>
          {detail.statement.length === 0 ? (
            <p className={clsx("text-xs", faint)}>No paying customers yet.</p>
          ) : (
            <ul className={clsx("text-xs", rows)}>
              {detail.statement.map((month) => (
                <li key={month.month} className="flex items-center justify-between gap-3 py-1.5">
                  <span className={text}>
                    {month.month} · {month.customers} {month.customers === 1 ? "customer" : "customers"} · {formatMoney(month.revenue, currency)} at {month.rate_pct}%
                  </span>
                  <span className={clsx("font-semibold tabular-nums", text)}>{formatMoney(month.commission, currency)}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="label mb-1 mt-4">Payouts</p>
          {detail.payouts.length === 0 ? (
            <p className={clsx("text-xs", faint)}>None yet.</p>
          ) : (
            <ul className={clsx("text-xs", rows)}>
              {detail.payouts.map((payout) => (
                <li key={payout.id} className="flex items-center justify-between gap-3 py-1.5">
                  <span className={clsx("min-w-0 truncate", text)}>
                    {formatDate(payout.created_at)} · {payout.method} {payout.reference}
                  </span>
                  <span className={clsx("font-semibold tabular-nums", text)}>{formatMoney(payout.amount, currency)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <p className="label mb-1">Commissions</p>
          {detail.commissions.length === 0 ? (
            <p className={clsx("text-xs", faint)}>Nothing yet.</p>
          ) : (
            <ul className={clsx("max-h-72 overflow-y-auto text-xs", rows)}>
              {detail.commissions.map((row) => (
                <li key={row.id} className="flex items-center justify-between gap-3 py-1.5">
                  <span className="min-w-0">
                    <span className={clsx("block truncate", text)}>{row.customer_email || `customer ${row.customer_id}`}</span>
                    <span className={faint}>
                      {formatDate(row.created_at)} · {row.rate_pct}% of {formatMoney(row.amount, currency)}
                      {row.note ? ` · ${row.note}` : ""}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    <span className={clsx("font-semibold tabular-nums", text)}>{formatMoney(row.commission, currency)}</span>
                    <Chip status={row.status} />
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function PartnersCard({ partners, currency, onChanged, onSelectUser }: { partners: AffiliatePartnerRow[]; currency: string; onChanged: () => void; onSelectUser: (id: number) => void }) {
  const [open, setOpen] = useState<number | null>(null);
  const [codes, setCodes] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const decide = async (partner: AffiliatePartnerRow, action: "approve" | "reject" | "suspend" | "reinstate") => {
    const code = (codes[partner.user_id] ?? partner.code ?? partner.requested_code).trim().toUpperCase();
    const questions: Record<string, string> = {
      approve: `Approve ${partner.email} as a partner with the code ${code}?`,
      reject: `Reject ${partner.email}'s application?`,
      suspend: `Suspend ${partner.email}?\n\nTheir code stops working and commissions still on hold are cancelled. Money already paid is not touched.`,
      reinstate: `Bring ${partner.email} back as a partner? Their code works again.`,
    };
    if (!window.confirm(questions[action])) return;
    setBusy(`${action}-${partner.user_id}`);
    setError(null);
    try {
      await decidePartner(partner.user_id, { action, ...(action === "approve" ? { code } : {}) });
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "That did not go through.");
    } finally {
      setBusy(null);
    }
  };

  const order = { pending: 0, approved: 1, suspended: 2, rejected: 3 } as const;
  const sorted = [...partners].sort((a, b) => order[a.status] - order[b.status]);

  return (
    <Card
      title="Creator partners"
      icon={<Megaphone className="h-4 w-4 text-meta-500" aria-hidden />}
      hint="Applications wait here for your decision. Open a partner to see commissions and record a payout."
    >
      {error ? <p className="mb-3 text-xs text-red-600 dark:text-red-300">{error}</p> : null}
      {sorted.length === 0 ? (
        <p className={clsx("py-3 text-xs", faint)}>No applications yet. Creators apply from Invite &amp; earn in their account.</p>
      ) : (
        <ul className={clsx("rounded-xl border", line, rows)}>
          {sorted.map((partner) => (
            <li key={partner.user_id}>
              <div className="flex flex-wrap items-center gap-3 px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <button type="button" className="block max-w-full truncate text-left text-xs font-semibold text-meta-600 hover:underline dark:text-meta-300" onClick={() => onSelectUser(partner.user_id)}>
                    {partner.email}
                  </button>
                  <p className={clsx("truncate text-[11px]", faint)}>
                    {partner.status === "pending" || partner.status === "rejected"
                      ? `Applied ${timeAgo(partner.created_at)} · wants ${partner.requested_code}`
                      : `${partner.code ?? "no code"} · ${partner.stats.clicks} clicks · ${partner.stats.signups} sign-ups · ${partner.stats.paying} paying · ${partner.month_rate_pct}% this month`}
                  </p>
                  {partner.status === "pending" && partner.audience ? <p className={clsx("mt-1 whitespace-pre-wrap text-[11px]", faint)}>{partner.audience}</p> : null}
                </div>
                {partner.status === "approved" || partner.status === "suspended" ? (
                  <span className={clsx("text-xs tabular-nums", text)}>
                    {formatMoney(partner.totals.payable, currency)} <span className={faint}>ready</span>
                  </span>
                ) : null}
                <Chip status={partner.status} label={partner.status === "pending" ? "needs review" : undefined} />
                <div className="flex flex-wrap items-center gap-2">
                  {partner.status === "pending" || partner.status === "rejected" ? (
                    <>
                      <input
                        className="field !w-32 !py-1.5 !text-xs uppercase"
                        value={codes[partner.user_id] ?? partner.requested_code}
                        maxLength={24}
                        aria-label="Code to approve"
                        onChange={(e) => setCodes((c) => ({ ...c, [partner.user_id]: e.target.value }))}
                      />
                      <button type="button" className="btn-primary !py-1.5 !text-xs" disabled={busy !== null} onClick={() => void decide(partner, "approve")}>
                        Approve
                      </button>
                      {partner.status === "pending" ? (
                        <button type="button" className="btn-ghost !py-1.5 !text-xs" disabled={busy !== null} onClick={() => void decide(partner, "reject")}>
                          Reject
                        </button>
                      ) : null}
                    </>
                  ) : (
                    <>
                      <button type="button" className="btn-ghost !py-1.5 !text-xs" onClick={() => setOpen(open === partner.user_id ? null : partner.user_id)}>
                        {open === partner.user_id ? "Close" : "Commissions & payout"}
                      </button>
                      <button
                        type="button"
                        className="btn-ghost !py-1.5 !text-xs"
                        disabled={busy !== null}
                        onClick={() => void decide(partner, partner.status === "approved" ? "suspend" : "reinstate")}
                      >
                        {partner.status === "approved" ? "Suspend" : "Reinstate"}
                      </button>
                    </>
                  )}
                </div>
              </div>
              {open === partner.user_id ? <PartnerDetail userId={partner.user_id} currency={currency} onChanged={onChanged} /> : null}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

// --------------------------------------------------------------------------
// referrals
// --------------------------------------------------------------------------

const FLAG_TEXT: Record<string, string> = {
  email: "same mailbox",
  device: "same browser",
  ip: "same network",
  payment: "same payment account",
};

function ReferralsCard({ refreshKey, onChanged, onSelectUser }: { refreshKey: number; onChanged: () => void; onSelectUser: (id: number) => void }) {
  const [filter, setFilter] = useState<"all" | "friend" | "partner" | "flagged">("all");
  const [list, setList] = useState<AffiliateReferral[] | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setList(await getAffiliateReferrals(filter === "friend" || filter === "partner" ? filter : undefined, filter === "flagged"));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load referrals.");
    }
  }, [filter]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const act = async (row: AffiliateReferral, action: "void" | "allow" | "reward_now") => {
    const questions = {
      void: `Cancel this referral? ${row.referrer_email} gets nothing for ${row.customer_email}.`,
      allow: `Allow this referral? ${row.customer_email} counts for ${row.referrer_email} again.`,
      reward_now: `Give ${row.referrer_email} the ${formatTokens(row.reward_tokens)} reward tokens now, without waiting?`,
    };
    if (!window.confirm(questions[action])) return;
    setBusy(row.id);
    setError(null);
    try {
      await actOnReferral(row.id, action);
      await load();
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "That did not go through.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card
      title="All referrals"
      icon={<UserPlus className="h-4 w-4 text-meta-500" aria-hidden />}
      hint="Every customer who came through a link or coupon, newest first."
      action={
        <div className="flex gap-1">
          {(["all", "friend", "partner", "flagged"] as const).map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => setFilter(id)}
              className={clsx(
                "rounded-lg px-2.5 py-1 text-xs font-medium capitalize",
                filter === id ? "bg-meta-500 text-white" : clsx("hover:bg-black/5 dark:hover:bg-white/10", faint),
              )}
            >
              {id === "friend" ? "Friends" : id === "partner" ? "Partners" : id}
            </button>
          ))}
        </div>
      }
    >
      {error ? <p className="mb-3 text-xs text-red-600 dark:text-red-300">{error}</p> : null}
      {!list ? (
        <Loader2 className={clsx("h-4 w-4 animate-spin", faint)} aria-hidden />
      ) : list.length === 0 ? (
        <p className={clsx("py-3 text-xs", faint)}>Nothing here yet.</p>
      ) : (
        <div className={clsx("max-h-[28rem] overflow-auto rounded-xl border", line)}>
          <table className="w-full min-w-[640px] text-left text-xs">
            <thead className={clsx("sticky top-0 bg-white dark:bg-slate-900", faint)}>
              <tr className={clsx("border-b", line)}>
                <th className="px-3 py-2 font-medium">Customer</th>
                <th className="px-3 py-2 font-medium">Referred by</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium" />
              </tr>
            </thead>
            <tbody className={rows}>
              {list.map((row) => (
                <tr key={row.id}>
                  <td className="max-w-[200px] px-3 py-2">
                    <button type="button" className="block max-w-full truncate font-medium text-meta-600 hover:underline dark:text-meta-300" onClick={() => onSelectUser(row.customer_id)}>
                      {row.customer_email || `user ${row.customer_id}`}
                    </button>
                    <span className={clsx("block text-[11px]", faint)}>
                      {timeAgo(row.created_at)} · by {row.source}
                    </span>
                  </td>
                  <td className="max-w-[200px] px-3 py-2">
                    <button type="button" className={clsx("block max-w-full truncate hover:underline", text)} onClick={() => onSelectUser(row.referrer_id)}>
                      {row.referrer_email || `user ${row.referrer_id}`}
                    </button>
                    <span className={clsx("block text-[11px]", faint)}>
                      {row.channel === "friend" ? "Friend" : "Partner"} · {row.code}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <span className="flex flex-wrap items-center gap-1.5">
                      <Chip status={row.status} />
                      {row.flags.map((flag) => (
                        <span key={flag} className="chip !border-red-300 !text-[10px] !text-red-700 dark:!border-red-500/40 dark:!text-red-300">
                          <Flag className="h-2.5 w-2.5" aria-hidden /> {FLAG_TEXT[flag] ?? flag}
                        </span>
                      ))}
                    </span>
                    <span className={clsx("mt-0.5 block text-[11px]", faint)}>
                      {row.status === "waiting" && row.reward_due_at
                        ? `${formatTokens(row.reward_tokens)} tokens due ${formatDate(row.reward_due_at)}`
                        : row.status === "rewarded"
                          ? `${formatTokens(row.reward_tokens)} tokens given`
                          : row.note}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right">
                    {busy === row.id ? (
                      <Loader2 className={clsx("ml-auto h-3.5 w-3.5 animate-spin", faint)} aria-hidden />
                    ) : (
                      <span className="flex justify-end gap-3 font-semibold">
                        {row.status === "waiting" || row.status === "capped" ? (
                          <button type="button" className="text-meta-600 hover:underline dark:text-meta-300" onClick={() => void act(row, "reward_now")}>
                            Reward now
                          </button>
                        ) : null}
                        {["blocked", "void", "capped", "ended"].includes(row.status) ? (
                          <button type="button" className="text-meta-600 hover:underline dark:text-meta-300" onClick={() => void act(row, "allow")}>
                            Allow
                          </button>
                        ) : null}
                        {["signed_up", "waiting", "active"].includes(row.status) ? (
                          <button type="button" className="text-red-600 hover:underline dark:text-red-300" onClick={() => void act(row, "void")}>
                            Cancel
                          </button>
                        ) : null}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

// --------------------------------------------------------------------------
// tab
// --------------------------------------------------------------------------

export function AffiliatesTab({ refreshKey, currency, onSelectUser }: AffiliatesTabProps) {
  const [overview, setOverview] = useState<AffiliateOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [bump, setBump] = useState(0);

  const load = useCallback(async () => {
    try {
      setOverview(await getAffiliates());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load the program.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshKey, bump]);

  const changed = useCallback(() => setBump((n) => n + 1), []);

  if (!overview) {
    return (
      <div className={clsx("grid place-items-center py-24", faint)}>
        {error ? <p className="text-sm text-red-600 dark:text-red-400">{error}</p> : <Loader2 className="h-5 w-5 animate-spin" aria-hidden />}
      </div>
    );
  }

  const { summary } = overview;

  return (
    <div className="space-y-6">
      {error ? <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-600 dark:text-red-300">{error}</p> : null}

      <section className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <StatTile icon={Gift} label="Friend referrals" value={String(summary.friend_signups)} hint={`${summary.friend_paying} paid · ${summary.friend_rewards} rewarded`} />
        <StatTile icon={Megaphone} label="Partner customers" value={String(summary.partner_signups)} hint={`${summary.partner_paying} paying`} tone="slow" />
        <StatTile
          icon={BadgeDollarSign}
          label="Commission ready to pay"
          value={formatMoney(summary.commission.payable, currency)}
          hint={`${formatMoney(summary.commission.pending, currency)} on hold · ${formatMoney(summary.commission.paid, currency)} paid`}
        />
        <StatTile
          icon={Flag}
          label="Needs a look"
          value={String(summary.applications + summary.flagged)}
          hint={`${summary.applications} ${summary.applications === 1 ? "application" : "applications"} · ${summary.flagged} flagged`}
          tone="slow"
        />
      </section>
      <p className={clsx("-mt-3 text-xs", faint)}>{formatTokens(summary.friend_reward_tokens)} reward tokens given to referrers so far.</p>

      <PartnersCard partners={overview.partners} currency={currency} onChanged={changed} onSelectUser={onSelectUser} />
      <ReferralsCard refreshKey={refreshKey + bump} onChanged={changed} onSelectUser={onSelectUser} />
      <SettingsCard overview={overview} currency={currency} onSaved={changed} />
    </div>
  );
}

export default AffiliatesTab;
