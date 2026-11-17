"use client";

import clsx from "clsx";
import { BadgeCheck, BadgeDollarSign, Clock3, Loader2, Megaphone, MousePointerClick, UserPlus, Wallet } from "lucide-react";
import { useState, type FormEvent } from "react";

import NeonCard from "@/components/NeonCard";
import CopyField from "@/components/referrals/CopyField";
import StatTile from "@/components/StatTile";
import { formatDate, formatMoney } from "@/lib/format";
import { applyAsPartner, referralLink, savePayoutDetails, type PartnerProgram } from "@/lib/referrals";

interface PartnerCardProps {
  partner: PartnerProgram;
  currency: string;
  onChanged: (partner: PartnerProgram) => void;
}

const LINE_STATUS: Record<string, { text: string; tone: string }> = {
  pending: { text: "On hold", tone: "!border-amber-400/50 !bg-amber-50 !text-amber-700" },
  payable: { text: "Ready to pay", tone: "!border-meta-500/40 !bg-meta-50 !text-meta-700" },
  paid: { text: "Paid", tone: "!border-emerald-300 !bg-emerald-50 !text-emerald-700" },
  void: { text: "Cancelled", tone: "!border-black/10 !text-ink-faint" },
};

function monthName(month: string): string {
  const [year, m] = month.split("-").map(Number);
  return new Date(Date.UTC(year, (m || 1) - 1, 1)).toLocaleDateString(undefined, { month: "long", year: "numeric", timeZone: "UTC" });
}

function tierText(tiers: PartnerProgram["tiers"]): string[] {
  return tiers.map((tier, index) => {
    const next = tiers[index + 1];
    const range = next ? (tier.min === 0 ? `Up to ${next.min - 1}` : `${tier.min} to ${next.min - 1}`) : `${tier.min} or more`;
    return `${range} paying customers in a month: ${tier.pct}%`;
  });
}

function Rules({ partner, currency }: { partner: PartnerProgram; currency: string }) {
  return (
    <ul className="list-disc space-y-1 pl-4 text-xs text-ink-subtle">
      {tierText(partner.tiers).map((line) => (
        <li key={line}>{line}</li>
      ))}
      <li>Your share is on what customers actually pay: subscriptions, renewals, upgrades and top-ups, for as long as they stay subscribed.</li>
      <li>Each month is counted by itself, and that month&apos;s rate applies to all of that month&apos;s revenue.</li>
      <li>
        A commission is ready {partner.hold_days} days after the customer pays. Payouts are monthly from{" "}
        {formatMoney(partner.min_payout, currency)}.
      </li>
      <li>A refunded payment earns no commission.</li>
      <li>
        Not allowed: referring yourself, coupon sites, paid ads on our brand name, or promises the product does not make.
      </li>
    </ul>
  );
}

function ApplyForm({ partner, onChanged }: Omit<PartnerCardProps, "currency">) {
  const [code, setCode] = useState(partner.requested_code ?? "");
  const [audience, setAudience] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onChanged(await applyAsPartner({ code: code.trim(), audience: audience.trim(), payout_method: "", payout_address: "" }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send your request.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="mt-5 max-w-xl space-y-4">
      {partner.status === "rejected" ? (
        <p className="rounded-xl border border-black/10 bg-black/[0.02] px-3 py-2 text-xs text-ink-muted">
          Your previous request was not accepted. You can update your audience details and send a new one.
        </p>
      ) : null}
      <label className="block">
        <span className="label mb-1 block">Preferred code (your name or brand works well)</span>
        <input className="field uppercase" value={code} maxLength={24} minLength={3} required placeholder="YOURNAME" onChange={(e) => setCode(e.target.value)} />
        <span className="mt-1 block text-[11px] text-ink-faint">
          Activates your shareable link (<code className="font-mono text-black">?ref=YOURNAME</code>) and Whop promo code once approved.
        </span>
      </label>
      <label className="block">
        <span className="label mb-1 block">Do you have an audience? Why should we accept your request?</span>
        <textarea
          className="field min-h-[112px]"
          value={audience}
          required
          minLength={10}
          maxLength={2000}
          placeholder="Tell us about your channels, community, agency clients, or follower reach, and how you plan to introduce ProteusFlow."
          onChange={(e) => setAudience(e.target.value)}
        />
      </label>
      {error ? <p className="text-xs text-red-600">{error}</p> : null}
      <div className="space-y-2">
        <button type="submit" className="btn-primary !py-2.5 !text-sm" disabled={busy}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
          Request to join affiliate program
        </button>
        <p className="text-[11px] text-ink-faint">
          Once approved, your link, Whop checkout promo code, and monthly commission tracking activate automatically.
        </p>
      </div>
    </form>
  );
}

function PayoutDetails({ partner, onChanged }: Omit<PartnerCardProps, "currency">) {
  const [method, setMethod] = useState(partner.payout_method ?? "");
  const [address, setAddress] = useState(partner.payout_address ?? "");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onChanged(await savePayoutDetails({ payout_method: method.trim(), payout_address: address.trim() }));
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-2">
      <p className="label">Where we pay you</p>
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_auto]">
        <input className="field" value={method} maxLength={40} placeholder="Method, e.g. USDT TRC-20" aria-label="Payout method" onChange={(e) => setMethod(e.target.value)} />
        <input className="field" value={address} maxLength={300} placeholder="Wallet or account" aria-label="Payout wallet or account" onChange={(e) => setAddress(e.target.value)} />
        <button type="submit" className="btn-ghost !py-2 !text-xs" disabled={busy}>
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : null}
          {saved ? "Saved" : "Save"}
        </button>
      </div>
      {error ? <p className="text-xs text-red-600">{error}</p> : null}
    </form>
  );
}

/** The creator side: apply, then a dashboard of clicks, customers, commissions and payouts. */
export function PartnerCard({ partner, currency, onChanged }: PartnerCardProps) {
  const approved = partner.status === "approved" || partner.status === "suspended";
  const totals = partner.totals ?? { pending: 0, payable: 0, paid: 0 };
  const stats = partner.stats ?? { clicks: 0, signups: 0, paying: 0 };

  return (
    <NeonCard padding="lg" radius="xl">
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <Megaphone className="h-4 w-4 text-meta-500" aria-hidden />
        <h2 className="text-sm font-semibold tracking-tight text-black">
          {approved ? "Affiliate Partner Dashboard" : "Affiliate program request"}
        </h2>
        {partner.status === "pending" ? <span className="chip !border-amber-400/50 !bg-amber-50 !text-[10px] !text-amber-700">In review</span> : null}
        {partner.status === "approved" ? <span className="chip !border-emerald-300 !bg-emerald-50 !text-[10px] !text-emerald-700">Active partner</span> : null}
        {partner.status === "suspended" ? <span className="chip !border-red-300 !bg-red-50 !text-[10px] !text-red-700">Suspended</span> : null}
      </div>
      <p className="max-w-2xl text-sm text-ink-muted">
        {approved
          ? `Connected to Whop checkout (${partner.discount_pct}% buyer discount) and automatic ${partner.tiers[0]?.pct}%–${partner.tiers[partner.tiers.length - 1]?.pct}% monthly commission calculation.`
          : `Give your audience ${partner.discount_pct}% off their first plan and earn ${partner.tiers[0]?.pct}%–${partner.tiers[partner.tiers.length - 1]?.pct}% recurring commission automatically once approved.`}
      </p>

      {partner.status === "pending" ? (
        <p className="mt-4 max-w-xl rounded-xl border border-black/10 bg-black/[0.02] px-4 py-3 text-sm text-ink-muted">
          We received your request for the code <span className="font-semibold text-black">{partner.requested_code}</span>.
          Once approved, your partner link and promo code activate automatically with Whop checkout discounts and commission calculation.
        </p>
      ) : !approved ? (
        partner.applications_open ? (
          <ApplyForm partner={partner} onChanged={onChanged} />
        ) : (
          <p className="mt-4 rounded-xl border border-black/10 bg-black/[0.02] px-4 py-3 text-sm text-ink-muted">
            Partner applications are closed right now.
          </p>
        )
      ) : (
        <div className="mt-4 space-y-5">
          {partner.status === "suspended" ? (
            <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              Your partnership is suspended, so your code is off and pending commissions were cancelled. Contact support
              if you think this is a mistake.
            </p>
          ) : partner.code ? (
            <div className="grid gap-3 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
              <CopyField label="Your partner link" value={referralLink(partner.code)} />
              <CopyField label="Your audience code" value={partner.code} />
            </div>
          ) : null}

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
            <StatTile icon={MousePointerClick} label="Clicks" value={String(stats.clicks)} />
            <StatTile icon={UserPlus} label="Sign-ups" value={String(stats.signups)} />
            <StatTile icon={BadgeCheck} label="Paying customers" value={String(stats.paying)} />
            <StatTile icon={Clock3} label="On hold" value={formatMoney(totals.pending, currency)} hint={`${partner.hold_days}-day hold`} />
            <StatTile icon={Wallet} label="Ready to pay" value={formatMoney(totals.payable, currency)} hint={`Paid from ${formatMoney(partner.min_payout, currency)}`} />
            <StatTile icon={BadgeDollarSign} label="Paid out" value={formatMoney(totals.paid, currency)} />
          </div>

          {partner.month ? (
            <p className="rounded-xl border border-meta-500/20 bg-meta-50 px-4 py-3 text-sm text-meta-900">
              {monthName(partner.month.month)}: <span className="font-semibold">{partner.month.customers}</span> paying{" "}
              {partner.month.customers === 1 ? "customer" : "customers"} so far, so this month&apos;s rate is{" "}
              <span className="font-semibold">{partner.month.rate_pct}%</span>.
            </p>
          ) : null}

          <div className="grid gap-5 lg:grid-cols-2">
            <div>
              <p className="label mb-2">By month</p>
              {(partner.statement ?? []).length === 0 ? (
                <p className="rounded-xl border border-dashed border-black/10 px-3 py-6 text-center text-xs text-ink-faint">No paying customers yet.</p>
              ) : (
                <div className="overflow-x-auto rounded-xl border border-black/10">
                  <table className="w-full text-left text-xs">
                    <thead className="text-ink-subtle">
                      <tr className="border-b border-black/[0.06]">
                        <th className="px-3 py-2 font-medium">Month</th>
                        <th className="px-3 py-2 text-right font-medium">Customers</th>
                        <th className="px-3 py-2 text-right font-medium">Revenue</th>
                        <th className="px-3 py-2 text-right font-medium">Rate</th>
                        <th className="px-3 py-2 text-right font-medium">You earn</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-black/[0.06]">
                      {(partner.statement ?? []).map((row) => (
                        <tr key={row.month}>
                          <td className="px-3 py-2 text-black">{monthName(row.month)}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{row.customers}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{formatMoney(row.revenue, currency)}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{row.rate_pct}%</td>
                          <td className="px-3 py-2 text-right font-semibold tabular-nums text-black">{formatMoney(row.commission, currency)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <p className="label mb-2 mt-5">Payouts</p>
              {(partner.payouts ?? []).length === 0 ? (
                <p className="text-xs text-ink-faint">No payouts yet.</p>
              ) : (
                <ul className="divide-y divide-black/[0.06] rounded-xl border border-black/10 text-sm">
                  {(partner.payouts ?? []).map((payout) => (
                    <li key={payout.id} className="flex items-center justify-between gap-3 px-3 py-2">
                      <div className="min-w-0">
                        <p className="font-medium text-black">{formatMoney(payout.amount, currency)}</p>
                        <p className="truncate text-xs text-ink-subtle">
                          {formatDate(payout.created_at)}
                          {payout.method ? ` · ${payout.method}` : ""}
                          {payout.reference ? ` · ${payout.reference}` : ""}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div>
              <p className="label mb-2">Latest commissions</p>
              {(partner.commissions ?? []).length === 0 ? (
                <p className="rounded-xl border border-dashed border-black/10 px-3 py-6 text-center text-xs text-ink-faint">Nothing yet.</p>
              ) : (
                <ul className="max-h-80 divide-y divide-black/[0.06] overflow-y-auto rounded-xl border border-black/10 text-sm">
                  {(partner.commissions ?? []).map((line) => {
                    const status = LINE_STATUS[line.status] ?? LINE_STATUS.pending;
                    return (
                      <li key={line.id} className="flex items-center justify-between gap-3 px-3 py-2">
                        <div className="min-w-0">
                          <p className="font-medium tabular-nums text-black">
                            {formatMoney(line.commission, currency)}
                            <span className="font-normal text-ink-subtle">
                              {" "}
                              · {line.rate_pct}% of {formatMoney(line.amount, currency)}
                            </span>
                          </p>
                          <p className="text-xs text-ink-subtle">
                            {formatDate(line.created_at)}
                            {line.kind === "clawback" ? " · refund taken back" : line.status === "pending" ? ` · ready ${formatDate(line.payable_at)}` : ""}
                          </p>
                        </div>
                        <span className={clsx("chip shrink-0 !text-[10px]", status.tone)}>{status.text}</span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>

          <PayoutDetails partner={partner} onChanged={onChanged} />
          <div>
            <p className="label mb-2">Program rules</p>
            <Rules partner={partner} currency={currency} />
          </div>
        </div>
      )}
    </NeonCard>
  );
}

export default PartnerCard;
