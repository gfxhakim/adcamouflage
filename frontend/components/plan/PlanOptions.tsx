"use client";

import clsx from "clsx";
import { Check, Clock, Loader2, Send } from "lucide-react";
import { useState } from "react";

import NeonCard from "@/components/NeonCard";
import { requestPlan, type PlanOption, type PlanRequest } from "@/lib/auth";
import { formatDate, formatMoney } from "@/lib/format";

interface PlanOptionsProps {
  plans: PlanOption[];
  currentId: string;
  expired: boolean;
  currency: string;
  pending: PlanRequest | null;
  onRequested: (request: PlanRequest) => void;
}

function quotaLine(quota: number | null): string {
  return quota === null ? "Unlimited files every month" : `${quota.toLocaleString()} files every month`;
}

/**
 * Every plan side by side. There is no checkout: choosing one sends a request
 * that support acts on, and the account updates here once they do.
 */
export function PlanOptions({ plans, currentId, expired, currency, pending, onRequested }: PlanOptionsProps) {
  const [choosing, setChoosing] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const current = plans.find((p) => p.id === currentId);

  const send = async (planId: string) => {
    setSending(true);
    setError(null);
    try {
      onRequested(await requestPlan(planId, note));
      setChoosing(null);
      setNote("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send the request.");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="space-y-4">
      {pending ? (
        <div className="flex items-start gap-3 rounded-xl border border-meta-500/30 bg-meta-50 px-4 py-3">
          <Clock className="mt-0.5 h-4 w-4 shrink-0 text-meta-600" aria-hidden />
          <p className="text-sm leading-relaxed text-meta-900">
            Your request for <span className="font-semibold">{pending.plan_label}</span> was sent on{" "}
            {formatDate(pending.created_at)}. Our team will switch your plan and it will show here.
          </p>
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {plans.map((plan) => {
          const isCurrent = plan.id === currentId;
          const isPending = pending?.plan_id === plan.id;
          const bigger =
            current &&
            (plan.monthly_quota === null
              ? current.monthly_quota !== null
              : current.monthly_quota !== null && plan.monthly_quota > current.monthly_quota);
          const action = isCurrent ? (expired ? "Request renewal" : null) : bigger ? "Request upgrade" : "Request switch";

          return (
            <NeonCard
              key={plan.id}
              glow={isCurrent}
              tone={isCurrent ? "default" : "muted"}
              interactive={!isCurrent}
              padding="md"
              radius="lg"
              className="h-full"
              innerClassName="flex h-full flex-col"
            >
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-semibold text-black">{plan.label}</p>
                {isCurrent ? (
                  <span
                    className={clsx(
                      "chip !text-[10px]",
                      expired ? "!border-red-300 !bg-red-50 !text-red-700" : "!border-meta-500/40 !bg-meta-50 !text-meta-700",
                    )}
                  >
                    {expired ? "Expired" : "Current plan"}
                  </span>
                ) : null}
              </div>
              <p className="mt-3 text-2xl font-bold tracking-tight text-black">
                {formatMoney(plan.price, currency)}
                {plan.price ? <span className="text-xs font-medium text-ink-subtle"> / month</span> : null}
              </p>
              <p className="mt-2 flex items-center gap-1.5 text-xs text-ink-muted">
                <Check className="h-3.5 w-3.5 text-meta-500" aria-hidden />
                {quotaLine(plan.monthly_quota)}
              </p>
              <p className="mt-1 flex items-center gap-1.5 text-xs text-ink-muted">
                <Check className="h-3.5 w-3.5 text-meta-500" aria-hidden />
                Every camouflage layer and overlay
              </p>

              <div className="mt-auto pt-4">
                {action ? (
                  isPending ? (
                    <p className="flex items-center justify-center gap-1.5 rounded-xl border border-meta-500/30 bg-meta-50 py-2 text-xs font-semibold text-meta-700">
                      <Clock className="h-3.5 w-3.5" aria-hidden /> Requested
                    </p>
                  ) : choosing === plan.id ? (
                    <div className="space-y-2">
                      <textarea
                        className="field min-h-[64px] resize-none !text-xs"
                        placeholder="Anything we should know? (optional)"
                        maxLength={500}
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                      />
                      <div className="flex gap-2">
                        <button
                          type="button"
                          className="btn-primary flex-1 !py-2 !text-xs"
                          disabled={sending}
                          onClick={() => void send(plan.id)}
                        >
                          {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Send className="h-3.5 w-3.5" aria-hidden />}
                          Send
                        </button>
                        <button
                          type="button"
                          className="btn-ghost !py-2 !text-xs"
                          disabled={sending}
                          onClick={() => setChoosing(null)}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      className={clsx("w-full !py-2 !text-xs", bigger || isCurrent ? "btn-primary" : "btn-ghost")}
                      onClick={() => {
                        setChoosing(plan.id);
                        setError(null);
                      }}
                    >
                      {action}
                    </button>
                  )
                ) : (
                  <p className="py-2 text-center text-xs font-medium text-ink-faint">You are on this plan</p>
                )}
              </div>
            </NeonCard>
          );
        })}
      </div>

      {error ? (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>
      ) : null}
      <p className="text-[11px] leading-relaxed text-ink-faint">
        No card needed. Requests go straight to our team, who switch your plan by hand; nothing is charged
        automatically.
      </p>
    </div>
  );
}

export default PlanOptions;
