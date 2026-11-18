"use client";

import clsx from "clsx";
import {
  Activity,
  BadgeCheck,
  BadgeDollarSign,
  Check,
  Clock3,
  Copy,
  Download,
  ExternalLink,
  Link2,
  Loader2,
  Megaphone,
  MousePointerClick,
  Plus,
  Search,
  Sparkles,
  Trash2,
  UserCheck,
  UserPlus,
  Users,
  Wallet,
} from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";

import NeonCard from "@/components/NeonCard";
import CopyField from "@/components/referrals/CopyField";
import StatTile from "@/components/StatTile";
import { trustedEmailError } from "@/lib/authValidation";
import { formatDate, formatMoney } from "@/lib/format";
import {
  applyAsPartner,
  cancelWithdrawal,
  referralLink,
  requestWithdrawal,
  savePayoutDetails,
  type PartnerCustomer,
  type PartnerProgram,
} from "@/lib/referrals";

interface PartnerCardProps {
  partner: PartnerProgram;
  currency?: string;
  defaultName?: string;
  defaultEmail?: string;
  onChanged: (partner: PartnerProgram) => void;
}

type DashboardTab = "overview" | "subscribers" | "earnings" | "withdrawals";
type CustomerFilter = "all" | "active" | "promo_code" | "link" | "ended";

const LINE_STATUS: Record<string, { text: string; tone: string }> = {
  pending: { text: "On hold", tone: "!border-amber-400/50 !bg-amber-50 !text-amber-700" },
  payable: { text: "Ready to withdraw", tone: "!border-meta-500/40 !bg-meta-50 !text-meta-700" },
  paid: { text: "Paid", tone: "!border-emerald-300 !bg-emerald-50 !text-emerald-700" },
  void: { text: "Cancelled", tone: "!border-black/10 !text-ink-faint" },
};

const CUSTOMER_STATUS: Record<string, { text: string; tone: string }> = {
  active: { text: "Active", tone: "!border-emerald-300 !bg-emerald-50 !text-emerald-700" },
  cancelling: { text: "Cancelling", tone: "!border-amber-400/50 !bg-amber-50 !text-amber-700" },
  signed_up: { text: "Signed up", tone: "!border-meta-500/30 !bg-meta-50 !text-meta-700" },
  ended: { text: "Ended", tone: "!border-black/10 !bg-black/[0.04] !text-ink-muted" },
  refunded: { text: "Refunded", tone: "!border-red-300 !bg-red-50 !text-red-700" },
  void: { text: "Cancelled", tone: "!border-black/10 !text-ink-faint" },
  blocked: { text: "Blocked", tone: "!border-red-300 !bg-red-50 !text-red-700" },
};

const WITHDRAW_STATUS: Record<string, { text: string; tone: string }> = {
  pending: { text: "Pending review", tone: "!border-amber-400/50 !bg-amber-50 !text-amber-700" },
  paid: { text: "Paid", tone: "!border-emerald-300 !bg-emerald-50 !text-emerald-700" },
  rejected: { text: "Declined", tone: "!border-red-300 !bg-red-50 !text-red-700" },
  cancelled: { text: "Cancelled", tone: "!border-black/10 !text-ink-faint" },
};

const PAYOUT_METHODS = ["USDT (TRC-20)", "USDT (ERC-20)", "PayPal", "Wise / Bank Transfer", "USDC", "Other"];

function monthName(month: string): string {
  const [year, m] = month.split("-").map(Number);
  return new Date(Date.UTC(year, (m || 1) - 1, 1)).toLocaleDateString(undefined, { month: "long", year: "numeric", timeZone: "UTC" });
}

function downloadCsv(filename: string, headers: string[], rows: (string | number)[][]): void {
  const escape = (val: string | number) => {
    const str = String(val ?? "");
    return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
  };
  const body = [headers.map(escape).join(","), ...rows.map((r) => r.map(escape).join(","))].join("\n");
  const blob = new Blob([body], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

/** Pre-approval affiliate intake form (no commission numbers or % shown before approval). */
function ApplyForm({ partner, defaultName, defaultEmail, onChanged }: PartnerCardProps) {
  const [fullName, setFullName] = useState(partner.full_name || defaultName || "");
  const [email, setEmail] = useState(partner.email || defaultEmail || "");
  const [socialLinks, setSocialLinks] = useState<string[]>(
    partner.social_links && partner.social_links.length > 0 ? partner.social_links : [""],
  );
  const [audience, setAudience] = useState(partner.audience || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const updateLink = (index: number, value: string) => {
    setSocialLinks((prev) => prev.map((item, i) => (i === index ? value : item)));
  };

  const addLink = () => {
    if (socialLinks.length >= 10) return;
    setSocialLinks((prev) => [...prev, ""]);
  };

  const removeLink = (index: number) => {
    if (socialLinks.length <= 1) return;
    setSocialLinks((prev) => prev.filter((_, i) => i !== index));
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const emailProblem = trustedEmailError(email.trim());
    if (emailProblem) {
      setError(emailProblem);
      return;
    }
    const cleanedLinks = socialLinks.map((item) => item.trim()).filter(Boolean);
    if (cleanedLinks.length === 0) {
      setError("Add at least one social media profile link.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      onChanged(
        await applyAsPartner({
          full_name: fullName.trim(),
          email: email.trim(),
          social_links: cleanedLinks,
          audience: audience.trim(),
        }),
      );
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
          Your previous request was not accepted. You can update your details and submit a new application.
        </p>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="label mb-1 block">Full name</span>
          <input
            className="field"
            value={fullName}
            minLength={2}
            maxLength={120}
            required
            placeholder="Your full name"
            onChange={(e) => setFullName(e.target.value)}
          />
        </label>

        <label className="block">
          <span className="label mb-1 block">Email</span>
          <input
            type="email"
            className="field"
            value={email}
            maxLength={254}
            required
            placeholder="you@gmail.com"
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
      </div>

      <div className="space-y-2">
        <span className="label block">Social media links</span>
        {socialLinks.map((link, index) => (
          <div key={index} className="flex items-center gap-2">
            <input
              type="text"
              className="field flex-1"
              value={link}
              maxLength={300}
              required={index === 0}
              placeholder={index === 0 ? "https://youtube.com/@yourchannel or profile URL" : "Another social media profile URL"}
              aria-label={`Social media profile ${index + 1}`}
              onChange={(e) => updateLink(index, e.target.value)}
            />
            {socialLinks.length > 1 ? (
              <button
                type="button"
                onClick={() => removeLink(index)}
                className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-black/10 text-ink-subtle transition hover:border-red-300 hover:bg-red-50 hover:text-red-600"
                aria-label="Remove social media profile"
                title="Remove link"
              >
                <Trash2 className="h-4 w-4" aria-hidden />
              </button>
            ) : null}
          </div>
        ))}
        {socialLinks.length < 10 ? (
          <button
            type="button"
            onClick={addLink}
            className="inline-flex items-center gap-1.5 rounded-lg border border-black/10 bg-black/[0.02] px-3 py-1.5 text-xs font-medium text-ink-muted transition hover:border-meta-500/40 hover:bg-meta-50 hover:text-meta-700"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden />
            Add another social media profile
          </button>
        ) : null}
      </div>

      <label className="block">
        <span className="label mb-1 block">Why do you want to join, who is your audience, and what is your content about?</span>
        <textarea
          className="field min-h-[120px]"
          value={audience}
          required
          minLength={10}
          maxLength={2000}
          placeholder="Explain why you want to join our affiliate program, describe your audience, and tell us what your content covers."
          onChange={(e) => setAudience(e.target.value)}
        />
      </label>

      {error ? <p className="text-xs text-red-600">{error}</p> : null}

      <div className="space-y-2">
        <button type="submit" className="btn-primary !py-2.5 !text-sm" disabled={busy}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
          Submit affiliate request
        </button>
        <p className="text-[11px] text-ink-faint">
          We review each application manually and assign your promo code and Whop affiliate link once approved.
        </p>
      </div>
    </form>
  );
}

/** Client-side UTM / landing page link builder + ready-to-share promo copy snippets. */
function MarketingToolkit({ partner }: { partner: PartnerProgram }) {
  const [dest, setDest] = useState<"/" | "/#pricing" | "/signup" | "/login">("/");
  const [source, setSource] = useState("youtube");
  const [campaign, setCampaign] = useState("");
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const code = partner.code || "";
  const origin = typeof window === "undefined" ? "https://www.proteusflow.com" : window.location.origin;

  const customUrl = useMemo(() => {
    const [path, hash] = dest.split("#");
    const params = new URLSearchParams();
    if (code) params.set("ref", code);
    if (source.trim()) params.set("utm_source", source.trim());
    if (campaign.trim()) params.set("utm_campaign", campaign.trim());
    const qs = params.toString();
    return `${origin}${path}${qs ? `?${qs}` : ""}${hash ? `#${hash}` : ""}`;
  }, [campaign, code, dest, origin, source]);

  const whopUrl = partner.affiliate_link?.trim() || "";
  const baseUrl = code ? referralLink(code) : origin;
  const displayLink = whopUrl || baseUrl;

  const snippets = useMemo(
    () => [
      {
        id: "video",
        title: "YouTube / Video description",
        body: `Process unique ad creative variations fast with ProteusFlow.\nStart here: ${displayLink}\n${code ? `Enter promo code ${code} on the Whop checkout page when subscribing.` : ""}`.trim(),
      },
      {
        id: "social",
        title: "Short social post",
        body: `Running paid social creatives? Try ProteusFlow for fast visual & audio variations: ${displayLink}${code ? ` — use code ${code} at checkout.` : ""}`,
      },
      {
        id: "dm",
        title: "Direct client message",
        body: `Here is the ProteusFlow link we discussed: ${displayLink}.${code ? ` When you click Subscribe, enter promo code ${code} right on the Whop checkout page.` : ""}`,
      },
    ],
    [code, displayLink],
  );

  const copyText = async (key: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey((c) => (c === key ? null : c)), 1600);
    } catch {
      /* ignore clipboard error */
    }
  };

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <div className="rounded-xl border border-black/10 bg-black/[0.015] p-4">
        <div className="mb-3 flex items-center gap-2">
          <Link2 className="h-4 w-4 text-meta-500" aria-hidden />
          <p className="text-xs font-semibold uppercase tracking-wider text-black">Campaign link builder</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="block">
            <span className="label mb-1 block">Destination</span>
            <select className="field !py-2 !text-xs" value={dest} onChange={(e) => setDest(e.target.value as typeof dest)}>
              <option value="/">Homepage</option>
              <option value="/#pricing">Pricing section</option>
              <option value="/signup">Sign-up page</option>
              <option value="/login">Login page</option>
            </select>
          </label>
          <label className="block">
            <span className="label mb-1 block">Channel / Source</span>
            <input
              className="field !py-2 !text-xs"
              value={source}
              maxLength={40}
              placeholder="youtube, tiktok, ig"
              onChange={(e) => setSource(e.target.value)}
            />
          </label>
          <label className="block">
            <span className="label mb-1 block">Campaign (optional)</span>
            <input
              className="field !py-2 !text-xs"
              value={campaign}
              maxLength={40}
              placeholder="q4_review"
              onChange={(e) => setCampaign(e.target.value)}
            />
          </label>
        </div>
        <div className="mt-3 flex items-center gap-2 rounded-xl border border-black/10 bg-white px-3 py-2">
          <code className="min-w-0 flex-1 truncate font-mono text-xs text-black">{customUrl}</code>
          <button
            type="button"
            onClick={() => void copyText("builder", customUrl)}
            className="btn-ghost !shrink-0 !py-1.5 !text-xs"
          >
            {copiedKey === "builder" ? <Check className="h-3.5 w-3.5 text-emerald-600" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />}
            {copiedKey === "builder" ? "Copied" : "Copy"}
          </button>
        </div>
        <p className="mt-2 text-[11px] text-ink-faint">
          Tracks clicks under <code className="font-mono text-black">?ref={code || "CODE"}</code> and adds campaign UTM tags for your own analytics.
        </p>
      </div>

      <div className="rounded-xl border border-black/10 bg-black/[0.015] p-4">
        <div className="mb-3 flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-meta-500" aria-hidden />
          <p className="text-xs font-semibold uppercase tracking-wider text-black">Ready-to-share promo copy</p>
        </div>
        <div className="space-y-2.5">
          {snippets.map((snippet) => (
            <div key={snippet.id} className="rounded-xl border border-black/[0.08] bg-white p-3">
              <div className="mb-1 flex items-center justify-between gap-2">
                <p className="text-xs font-semibold text-black">{snippet.title}</p>
                <button
                  type="button"
                  onClick={() => void copyText(snippet.id, snippet.body)}
                  className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium text-meta-600 hover:bg-meta-50"
                >
                  {copiedKey === snippet.id ? <Check className="h-3 w-3 text-emerald-600" aria-hidden /> : <Copy className="h-3 w-3" aria-hidden />}
                  {copiedKey === snippet.id ? "Copied" : "Copy text"}
                </button>
              </div>
              <p className="whitespace-pre-wrap text-xs text-ink-subtle">{snippet.body}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Referred subscribers tracker — strictly exposes subscriber Name ONLY for identity, plus full billing/commission metrics. */
function SubscribersTab({
  customers,
  currency,
}: {
  customers: PartnerCustomer[];
  currency: string;
}) {
  const [filter, setFilter] = useState<CustomerFilter>("all");
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return customers.filter((c) => {
      if (filter === "active" && !c.subscription_active) return false;
      if (filter === "promo_code" && c.source !== "promo_code") return false;
      if (filter === "link" && c.source !== "link") return false;
      if (filter === "ended" && !["ended", "refunded", "void", "blocked", "cancelling"].includes(c.status)) return false;
      if (!q) return true;
      return (
        c.name.toLowerCase().includes(q) ||
        c.plan_label.toLowerCase().includes(q) ||
        c.code.toLowerCase().includes(q) ||
        c.status.toLowerCase().includes(q)
      );
    });
  }, [customers, filter, query]);

  const exportSubscribers = () => {
    downloadCsv(
      "affiliate-subscribers.csv",
      ["Name", "Channel", "Code", "Plan", "Status", "Payments", "Total Paid", "Your Earnings", "Joined", "Last Paid"],
      filtered.map((c) => [
        c.name,
        c.source === "promo_code" ? "Promo code" : "Affiliate link",
        c.code,
        c.plan_label,
        c.status,
        c.payments_count,
        c.total_paid.toFixed(2),
        c.commission_earned.toFixed(2),
        c.joined_at,
        c.last_paid_at ?? "",
      ]),
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1.5">
          {(
            [
              ["all", `All (${customers.length})`],
              ["active", `Active (${customers.filter((c) => c.subscription_active).length})`],
              ["promo_code", "Promo code"],
              ["link", "Affiliate link"],
              ["ended", "Ended / Refunded"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setFilter(id)}
              className={clsx(
                "rounded-lg px-2.5 py-1.5 text-xs font-medium transition",
                filter === id ? "bg-meta-500 text-white" : "bg-black/[0.04] text-ink-muted hover:bg-black/[0.08]",
              )}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-faint" aria-hidden />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search name or plan"
              aria-label="Search referred subscribers"
              className="field !py-1.5 !pl-8 !text-xs"
            />
          </div>
          {filtered.length > 0 ? (
            <button type="button" onClick={exportSubscribers} className="btn-ghost !py-1.5 !text-xs">
              <Download className="h-3.5 w-3.5" aria-hidden />
              Export CSV
            </button>
          ) : null}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-black/15 px-4 py-10 text-center text-xs text-ink-faint">
          {customers.length === 0
            ? "No subscribers attributed to your link or promo code yet."
            : "No subscribers match your current filter."}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-black/10">
          <table className="w-full min-w-[760px] text-left text-xs">
            <thead className="border-b border-black/[0.06] bg-black/[0.02] text-ink-subtle">
              <tr>
                <th className="px-3 py-2.5 font-medium">Subscriber name</th>
                <th className="px-3 py-2.5 font-medium">Subscribed via</th>
                <th className="px-3 py-2.5 font-medium">Plan</th>
                <th className="px-3 py-2.5 font-medium">Status</th>
                <th className="px-3 py-2.5 text-right font-medium">Payments</th>
                <th className="px-3 py-2.5 text-right font-medium">Total paid</th>
                <th className="px-3 py-2.5 text-right font-medium">Your earnings</th>
                <th className="px-3 py-2.5 text-right font-medium">Dates</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black/[0.06]">
              {filtered.map((customer) => {
                const badge = CUSTOMER_STATUS[customer.status] ?? CUSTOMER_STATUS.signed_up;
                return (
                  <tr key={customer.id} className="hover:bg-black/[0.015]">
                    <td className="px-3 py-2.5 font-semibold text-black">{customer.name}</td>
                    <td className="px-3 py-2.5">
                      <span
                        className={clsx(
                          "chip !text-[10px]",
                          customer.source === "promo_code"
                            ? "!border-meta-500/30 !bg-meta-50 !text-meta-700"
                            : "!border-black/10 !bg-black/[0.03] !text-ink-muted",
                        )}
                      >
                        {customer.source === "promo_code" ? "Promo code" : "Affiliate link"} · {customer.code}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 font-medium text-black">{customer.plan_label}</td>
                    <td className="px-3 py-2.5">
                      <span className={clsx("chip !text-[10px]", badge.tone)}>{badge.text}</span>
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-ink-muted">
                      {customer.payments_count}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-black">
                      {formatMoney(customer.total_paid, currency)}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">
                      <p className="font-semibold text-black">{formatMoney(customer.commission_earned, currency)}</p>
                      {customer.commission_payable > 0 || customer.commission_pending > 0 ? (
                        <p className="text-[10px] text-ink-subtle">
                          {customer.commission_payable > 0 ? `${formatMoney(customer.commission_payable, currency)} ready` : ""}
                          {customer.commission_payable > 0 && customer.commission_pending > 0 ? " · " : ""}
                          {customer.commission_pending > 0 ? `${formatMoney(customer.commission_pending, currency)} hold` : ""}
                        </p>
                      ) : null}
                    </td>
                    <td className="px-3 py-2.5 text-right text-[11px] text-ink-subtle">
                      <p>Joined {formatDate(customer.joined_at)}</p>
                      {customer.last_paid_at ? (
                        <p>Last paid {formatDate(customer.last_paid_at)}</p>
                      ) : customer.current_period_end && customer.subscription_active ? (
                        <p>Renews {formatDate(customer.current_period_end)}</p>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** Withdrawal request tab starting from $100 minimum + saved payout settings + request history. */
function WithdrawalsTab({
  partner,
  currency,
  onChanged,
}: {
  partner: PartnerProgram;
  currency: string;
  onChanged: (next: PartnerProgram) => void;
}) {
  const totals = partner.totals ?? { pending: 0, payable: 0, paid: 0, reserved: 0, available: 0 };
  const available = totals.available ?? totals.payable;
  const reserved = totals.reserved ?? 0;
  const minWithdrawal = Math.max(100, partner.min_payout || 100);
  const eligible = partner.status === "approved" && available >= minWithdrawal;
  const progressPct = Math.min(100, Math.round((available / minWithdrawal) * 100));

  const [method, setMethod] = useState(
    PAYOUT_METHODS.includes(partner.payout_method || "") ? partner.payout_method! : partner.payout_method || "USDT (TRC-20)",
  );
  const [address, setAddress] = useState(partner.payout_address || "");
  const [amount, setAmount] = useState(() => (available >= minWithdrawal ? available.toFixed(2) : String(minWithdrawal)));
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [savingDefaults, setSavingDefaults] = useState(false);
  const [cancelBusy, setCancelBusy] = useState<number | null>(null);
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);

  const submitWithdrawal = async (event: FormEvent) => {
    event.preventDefault();
    const parsedAmount = Number(amount);
    if (!Number.isFinite(parsedAmount) || parsedAmount < minWithdrawal) {
      setFeedback({ ok: false, text: `Minimum withdrawal is ${formatMoney(minWithdrawal, currency)}.` });
      return;
    }
    setBusy(true);
    setFeedback(null);
    try {
      const updated = await requestWithdrawal({
        amount: parsedAmount,
        method: method.trim(),
        address: address.trim(),
        note: note.trim(),
      });
      onChanged(updated);
      setNote("");
      const nextAvail = updated.totals?.available ?? 0;
      setAmount(nextAvail >= minWithdrawal ? nextAvail.toFixed(2) : String(minWithdrawal));
      setFeedback({ ok: true, text: `Withdrawal request submitted for ${formatMoney(parsedAmount, currency)}.` });
    } catch (err) {
      setFeedback({ ok: false, text: err instanceof Error ? err.message : "Could not submit withdrawal request." });
    } finally {
      setBusy(false);
    }
  };

  const saveDefaults = async () => {
    setSavingDefaults(true);
    setFeedback(null);
    try {
      const updated = await savePayoutDetails({ payout_method: method.trim(), payout_address: address.trim() });
      onChanged(updated);
      setFeedback({ ok: true, text: "Default payout details saved." });
    } catch (err) {
      setFeedback({ ok: false, text: err instanceof Error ? err.message : "Could not save payout details." });
    } finally {
      setSavingDefaults(false);
    }
  };

  const cancelReq = async (requestId: number) => {
    if (!window.confirm("Cancel this pending withdrawal request and return the amount to your available balance?")) return;
    setCancelBusy(requestId);
    setFeedback(null);
    try {
      onChanged(await cancelWithdrawal(requestId));
      setFeedback({ ok: true, text: "Withdrawal request cancelled." });
    } catch (err) {
      setFeedback({ ok: false, text: err instanceof Error ? err.message : "Could not cancel request." });
    } finally {
      setCancelBusy(null);
    }
  };

  const requests = partner.withdrawal_requests ?? [];

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-black/10 bg-black/[0.02] p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="label">Available to withdraw</p>
            <p className="mt-1 text-2xl font-bold tabular-nums text-black">{formatMoney(available, currency)}</p>
            <p className="mt-0.5 text-xs text-ink-subtle">
              On hold: <strong className="text-black">{formatMoney(totals.pending, currency)}</strong> · Reserved in pending requests:{" "}
              <strong className="text-black">{formatMoney(reserved, currency)}</strong> · Total paid out:{" "}
              <strong className="text-black">{formatMoney(totals.paid, currency)}</strong>
            </p>
          </div>
          <span className="chip !border-meta-500/30 !bg-meta-50 !text-meta-700">
            Minimum withdrawal: {formatMoney(minWithdrawal, currency)}
          </span>
        </div>

        <div className="mt-3">
          <div className="mb-1 flex items-center justify-between text-[11px] text-ink-subtle">
            <span>Progress toward {formatMoney(minWithdrawal, currency)} minimum</span>
            <span className="font-semibold tabular-nums text-black">{progressPct}%</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-black/10">
            <div
              className={clsx("h-full rounded-full transition-all", available >= minWithdrawal ? "bg-emerald-500" : "bg-meta-500")}
              style={{ width: `${progressPct}%` }}
            />
          </div>
          {!eligible ? (
            <p className="mt-1.5 text-[11px] text-ink-muted">
              {partner.status !== "approved"
                ? "Withdrawals are paused while partnership access is suspended."
                : `Earn ${formatMoney(Math.max(0, minWithdrawal - available), currency)} more in cleared earnings to submit your next withdrawal request.`}
            </p>
          ) : null}
        </div>
      </div>

      <form onSubmit={submitWithdrawal} className="rounded-xl border border-black/10 p-4 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold text-black">Request payment withdrawal</h3>
            <p className="text-xs text-ink-subtle">Withdraw cleared earnings starting from {formatMoney(minWithdrawal, currency)}.</p>
          </div>
          <button
            type="button"
            onClick={() => void saveDefaults()}
            disabled={savingDefaults || !address.trim()}
            className="btn-ghost !py-1.5 !text-xs"
          >
            {savingDefaults ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : null}
            Save payout details
          </button>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <label className="block">
            <span className="label mb-1 block">Payout method</span>
            <select className="field" value={PAYOUT_METHODS.includes(method) ? method : "Other"} onChange={(e) => setMethod(e.target.value)}>
              {PAYOUT_METHODS.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          </label>
          <label className="block sm:col-span-2">
            <span className="label mb-1 block">Wallet / Payout account</span>
            <input
              className="field"
              value={address}
              maxLength={300}
              required
              placeholder="TRC-20 address, PayPal email, Wise IBAN..."
              onChange={(e) => setAddress(e.target.value)}
            />
          </label>
        </div>

        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_auto]">
          <label className="block">
            <span className="label mb-1 block">Amount ({currency})</span>
            <div className="flex items-center gap-1.5">
              <input
                type="number"
                className="field tabular-nums"
                min={minWithdrawal}
                max={Math.max(minWithdrawal, available)}
                step="0.01"
                required
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
              {eligible ? (
                <button
                  type="button"
                  onClick={() => setAmount(available.toFixed(2))}
                  className="btn-ghost !shrink-0 !py-2 !text-xs"
                >
                  Max
                </button>
              ) : null}
            </div>
          </label>
          <label className="block">
            <span className="label mb-1 block">Note (optional)</span>
            <input
              className="field"
              value={note}
              maxLength={500}
              placeholder="Invoice note or instructions"
              onChange={(e) => setNote(e.target.value)}
            />
          </label>
          <div className="flex items-end">
            <button type="submit" className="btn-primary w-full !py-2.5 !text-xs sm:w-auto" disabled={busy || !eligible}>
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Wallet className="h-3.5 w-3.5" aria-hidden />}
              Request withdrawal
            </button>
          </div>
        </div>

        {feedback ? (
          <p className={clsx("text-xs font-medium", feedback.ok ? "text-emerald-700" : "text-red-600")}>{feedback.text}</p>
        ) : null}
      </form>

      <div className="grid gap-5 lg:grid-cols-2">
        <div>
          <p className="label mb-2">Withdrawal requests</p>
          {requests.length === 0 ? (
            <p className="rounded-xl border border-dashed border-black/10 px-3 py-6 text-center text-xs text-ink-faint">
              No withdrawal requests yet.
            </p>
          ) : (
            <ul className="divide-y divide-black/[0.06] rounded-xl border border-black/10 text-xs">
              {requests.map((req) => {
                const badge = WITHDRAW_STATUS[req.status] ?? WITHDRAW_STATUS.pending;
                return (
                  <li key={req.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
                    <div className="min-w-0">
                      <p className="font-semibold tabular-nums text-black">
                        {formatMoney(req.amount, currency)}{" "}
                        <span className="font-normal text-ink-subtle">· {req.method}</span>
                      </p>
                      <p className="truncate font-mono text-[11px] text-ink-subtle">{req.address}</p>
                      <p className="text-[11px] text-ink-faint">
                        {formatDate(req.created_at)}
                        {req.reference ? ` · Ref: ${req.reference}` : ""}
                        {req.admin_note ? ` · ${req.admin_note}` : ""}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <span className={clsx("chip !text-[10px]", badge.tone)}>{badge.text}</span>
                      {req.status === "pending" ? (
                        <button
                          type="button"
                          onClick={() => void cancelReq(req.id)}
                          disabled={cancelBusy === req.id}
                          className="text-[11px] font-medium text-red-600 hover:underline disabled:opacity-50"
                        >
                          {cancelBusy === req.id ? "Cancelling..." : "Cancel"}
                        </button>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div>
          <p className="label mb-2">Completed payouts</p>
          {(partner.payouts ?? []).length === 0 ? (
            <p className="rounded-xl border border-dashed border-black/10 px-3 py-6 text-center text-xs text-ink-faint">
              No payouts recorded yet.
            </p>
          ) : (
            <ul className="divide-y divide-black/[0.06] rounded-xl border border-black/10 text-xs">
              {(partner.payouts ?? []).map((payout) => (
                <li key={payout.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
                  <div className="min-w-0">
                    <p className="font-semibold text-black">{formatMoney(payout.amount, currency)}</p>
                    <p className="truncate text-[11px] text-ink-subtle">
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
      </div>
    </div>
  );
}

/** Affiliate application + upgraded Partner Studio Dashboard once approved. */
export function PartnerCard({ partner, currency = "USD", defaultName, defaultEmail, onChanged }: PartnerCardProps) {
  const approved = partner.status === "approved" || partner.status === "suspended";
  const [tab, setTab] = useState<DashboardTab>("overview");

  const stats = partner.stats ?? { clicks: 0, signups: 0, paying: 0 };
  const totals = partner.totals ?? { pending: 0, payable: 0, paid: 0, reserved: 0, available: 0 };
  const customers = partner.customers ?? [];
  const activeSubscribers = partner.active_subscribers ?? customers.filter((c) => c.subscription_active).length;
  const available = totals.available ?? totals.payable;
  const minPayout = Math.max(100, partner.min_payout || 100);
  const pendingWithdrawals = (partner.withdrawal_requests ?? []).filter((r) => r.status === "pending").length;
  const convRate = stats.clicks > 0 ? Math.round((stats.paying / stats.clicks) * 1000) / 10 : stats.signups > 0 ? Math.round((stats.paying / stats.signups) * 1000) / 10 : 0;

  const sortedTiers = [...(partner.tiers ?? [])].sort((a, b) => a.min - b.min);
  const currentMonthCount = partner.month?.customers ?? 0;
  const currentRate = partner.month?.rate_pct ?? sortedTiers[0]?.pct ?? 0;
  const nextTier = sortedTiers.find((t) => t.min > currentMonthCount) ?? null;
  const tierProgressPct = nextTier ? Math.min(100, Math.round((currentMonthCount / nextTier.min) * 100)) : 100;

  const exportEarnings = () => {
    downloadCsv(
      "affiliate-commissions.csv",
      ["Date", "Type", "Month", "Order Amount", "Rate %", "Commission", "Status", "Ready At"],
      (partner.commissions ?? []).map((line) => [
        line.created_at,
        line.kind,
        line.month,
        line.amount.toFixed(2),
        line.rate_pct,
        line.commission.toFixed(2),
        line.status,
        line.payable_at,
      ]),
    );
  };

  return (
    <NeonCard padding="lg" radius="xl">
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <Megaphone className="h-4 w-4 text-meta-500" aria-hidden />
        <h2 className="text-sm font-semibold tracking-tight text-black">
          {approved ? "Affiliate Partner Studio" : "Affiliate program request"}
        </h2>
        {partner.status === "pending" ? (
          <span className="chip !border-amber-400/50 !bg-amber-50 !text-[10px] !text-amber-700">In review</span>
        ) : null}
        {partner.status === "approved" ? (
          <span className="chip !border-emerald-300 !bg-emerald-50 !text-[10px] !text-emerald-700">Approved partner</span>
        ) : null}
        {partner.status === "suspended" ? (
          <span className="chip !border-red-300 !bg-red-50 !text-[10px] !text-red-700">Suspended</span>
        ) : null}
      </div>

      <p className="max-w-3xl text-sm text-ink-muted">
        {approved
          ? "Track every subscriber who joins via your promo code or affiliate link, monitor monthly earnings, generate tagged links, and request withdrawals from $100 minimum."
          : "Apply to join the ProteusFlow affiliate program by sharing your contact details, social media profiles, and what your content is about."}
      </p>

      {partner.status === "pending" ? (
        <div className="mt-4 max-w-xl space-y-3 rounded-xl border border-black/10 bg-black/[0.02] p-4 text-sm text-ink-muted">
          <p className="font-medium text-black">
            Your application is currently in review. Once approved, your full affiliate dashboard, promo code, and tracking tools will unlock here.
          </p>
          {partner.full_name || partner.email ? (
            <div className="grid gap-1 text-xs text-ink-subtle sm:grid-cols-2">
              {partner.full_name ? (
                <p>
                  <span className="font-medium text-black">Name:</span> {partner.full_name}
                </p>
              ) : null}
              {partner.email ? (
                <p>
                  <span className="font-medium text-black">Email:</span> {partner.email}
                </p>
              ) : null}
            </div>
          ) : null}
          {partner.social_links && partner.social_links.length > 0 ? (
            <div className="space-y-1 text-xs">
              <p className="font-medium text-black">Social profiles</p>
              <ul className="space-y-0.5 text-ink-subtle">
                {partner.social_links.map((item) => (
                  <li key={item} className="flex items-center gap-1.5 break-all">
                    <ExternalLink className="h-3 w-3 shrink-0 text-ink-faint" aria-hidden />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {partner.audience ? (
            <div className="space-y-1 text-xs">
              <p className="font-medium text-black">About your audience &amp; content</p>
              <p className="whitespace-pre-wrap text-ink-subtle">{partner.audience}</p>
            </div>
          ) : null}
        </div>
      ) : !approved ? (
        partner.applications_open ? (
          <ApplyForm partner={partner} defaultName={defaultName} defaultEmail={defaultEmail} onChanged={onChanged} />
        ) : (
          <p className="mt-4 rounded-xl border border-black/10 bg-black/[0.02] px-4 py-3 text-sm text-ink-muted">
            Affiliate applications are closed right now.
          </p>
        )
      ) : (
        <div className="mt-5 space-y-6">
          {partner.status === "suspended" ? (
            <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              Your partnership is suspended, so your code is inactive and pending withdrawals/commissions are paused. Contact support if you think this is a mistake.
            </p>
          ) : null}

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatTile icon={MousePointerClick} label="Link clicks" value={String(stats.clicks)} hint={`${stats.signups} signed up`} />
            <StatTile icon={UserPlus} label="Paying subscribers" value={String(stats.paying)} hint={`${convRate}% conversion`} />
            <StatTile icon={UserCheck} label="Active subscribers" value={String(activeSubscribers)} hint={`${currentMonthCount} billed this month`} />
            <StatTile icon={Activity} label="Current rate" value={`${currentRate}%`} hint={`${partner.hold_days}-day clearance hold`} />
            <StatTile icon={Clock3} label="On hold" value={formatMoney(totals.pending, currency)} hint={`Clears after ${partner.hold_days} days`} />
            <StatTile
              icon={Wallet}
              label="Available to withdraw"
              value={formatMoney(available, currency)}
              hint={`Min ${formatMoney(minPayout, currency)}${(totals.reserved ?? 0) > 0 ? ` · ${formatMoney(totals.reserved ?? 0, currency)} pending` : ""}`}
            />
            <StatTile icon={BadgeDollarSign} label="Total paid out" value={formatMoney(totals.paid, currency)} />
            <StatTile icon={BadgeCheck} label="Referred total" value={String(customers.length)} hint="Lifetime referrals" />
          </div>

          <div className="flex flex-wrap gap-1.5 border-b border-black/10 pb-3">
            {(
              [
                { id: "overview", label: "Overview & Tools", icon: Megaphone },
                { id: "subscribers", label: `Subscribers (${customers.length})`, icon: Users },
                { id: "earnings", label: "Earnings & Ledger", icon: BadgeDollarSign },
                { id: "withdrawals", label: pendingWithdrawals > 0 ? `Withdrawals (${pendingWithdrawals} pending)` : "Withdrawals", icon: Wallet },
              ] as const
            ).map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => setTab(id)}
                className={clsx(
                  "inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-semibold transition",
                  tab === id
                    ? "bg-black text-white shadow-sm"
                    : "bg-black/[0.04] text-ink-muted hover:bg-black/[0.08] hover:text-black",
                )}
              >
                <Icon className="h-3.5 w-3.5" aria-hidden />
                {label}
              </button>
            ))}
          </div>

          {tab === "overview" ? (
            <div className="space-y-5">
              <div className="grid gap-3 md:grid-cols-3">
                {partner.affiliate_link?.trim() ? <CopyField label="Your Whop affiliate link" value={partner.affiliate_link.trim()} /> : null}
                {partner.code ? <CopyField label="Your site referral link" value={referralLink(partner.code)} /> : null}
                {partner.code ? <CopyField label="Your Whop promo code" value={partner.code} /> : null}
              </div>

              {partner.code ? (
                <p className="rounded-xl border border-meta-500/20 bg-meta-50 px-4 py-3 text-xs leading-relaxed text-meta-900">
                  Share your link or tell clients to click <span className="font-semibold">Subscribe</span> on any plan and enter{" "}
                  <span className="font-mono font-semibold text-black">{partner.code}</span> right on the Whop checkout page. Both link sign-ups and Whop promo code purchases appear under{" "}
                  <button type="button" onClick={() => setTab("subscribers")} className="font-semibold underline">
                    Subscribers
                  </button>
                  .
                </p>
              ) : null}

              <div className="rounded-xl border border-black/10 bg-black/[0.015] p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="label">Monthly commission tier</p>
                    <p className="mt-1 text-sm font-semibold text-black">
                      {partner.month ? monthName(partner.month.month) : "This month"}: {currentRate}% commission rate
                    </p>
                  </div>
                  <span className="text-xs text-ink-subtle">
                    {nextTier
                      ? `${Math.max(0, nextTier.min - currentMonthCount)} more paying ${nextTier.min - currentMonthCount === 1 ? "customer" : "customers"} this month for ${nextTier.pct}%`
                      : "Top monthly tier reached"}
                  </span>
                </div>
                <div className="mt-2.5 h-2 overflow-hidden rounded-full bg-black/10">
                  <div className="h-full rounded-full bg-meta-500 transition-all" style={{ width: `${tierProgressPct}%` }} />
                </div>
                <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-ink-subtle">
                  {sortedTiers.map((tier, idx) => {
                    const next = sortedTiers[idx + 1];
                    const range = next ? `${tier.min}–${next.min - 1}` : `${tier.min}+`;
                    const activeTier = currentRate === tier.pct;
                    return (
                      <span
                        key={tier.min}
                        className={clsx(
                          "rounded-lg border px-2.5 py-1",
                          activeTier ? "border-meta-500/40 bg-meta-50 font-semibold text-meta-700" : "border-black/10 bg-white",
                        )}
                      >
                        {range} subscribers: {tier.pct}%
                      </span>
                    );
                  })}
                </div>
              </div>

              <MarketingToolkit partner={partner} />
            </div>
          ) : null}

          {tab === "subscribers" ? (
            <SubscribersTab customers={customers} currency={currency} />
          ) : null}

          {tab === "earnings" ? (
            <div className="grid gap-5 lg:grid-cols-2">
              <div>
                <p className="label mb-2">Monthly statement</p>
                {(partner.statement ?? []).length === 0 ? (
                  <p className="rounded-xl border border-dashed border-black/10 px-3 py-8 text-center text-xs text-ink-faint">
                    No paying subscribers yet.
                  </p>
                ) : (
                  <div className="overflow-x-auto rounded-xl border border-black/10">
                    <table className="w-full text-left text-xs">
                      <thead className="border-b border-black/[0.06] bg-black/[0.02] text-ink-subtle">
                        <tr>
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
                            <td className="px-3 py-2 font-medium text-black">{monthName(row.month)}</td>
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
              </div>

              <div>
                <div className="mb-2 flex items-center justify-between gap-2">
                  <p className="label">Commission activity</p>
                  {(partner.commissions ?? []).length > 0 ? (
                    <button type="button" onClick={exportEarnings} className="btn-ghost !py-1 !text-[11px]">
                      <Download className="h-3 w-3" aria-hidden />
                      CSV
                    </button>
                  ) : null}
                </div>
                {(partner.commissions ?? []).length === 0 ? (
                  <p className="rounded-xl border border-dashed border-black/10 px-3 py-8 text-center text-xs text-ink-faint">
                    No commission events yet.
                  </p>
                ) : (
                  <ul className="max-h-96 divide-y divide-black/[0.06] overflow-y-auto rounded-xl border border-black/10 text-xs">
                    {(partner.commissions ?? []).map((line) => {
                      const status = LINE_STATUS[line.status] ?? LINE_STATUS.pending;
                      return (
                        <li key={line.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
                          <div className="min-w-0">
                            <p className="font-semibold tabular-nums text-black">
                              {formatMoney(line.commission, currency)}
                              <span className="font-normal text-ink-subtle">
                                {" "}
                                · {line.rate_pct}% of {formatMoney(line.amount, currency)}
                              </span>
                            </p>
                            <p className="text-[11px] text-ink-subtle">
                              {formatDate(line.created_at)}
                              {line.kind === "clawback"
                                ? " · refund clawback"
                                : line.status === "pending"
                                  ? ` · clears ${formatDate(line.payable_at)}`
                                  : ""}
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
          ) : null}

          {tab === "withdrawals" ? (
            <WithdrawalsTab partner={partner} currency={currency} onChanged={onChanged} />
          ) : null}
        </div>
      )}
    </NeonCard>
  );
}

export default PartnerCard;
