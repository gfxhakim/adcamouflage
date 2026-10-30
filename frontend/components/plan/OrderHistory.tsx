import clsx from "clsx";
import { ExternalLink } from "lucide-react";

import type { Order } from "@/lib/auth";
import { formatDate, formatMoney, formatTokens } from "@/lib/format";
import { paymentProviderName } from "@/lib/types";

interface OrderHistoryProps {
  orders: Order[];
  currency: string;
  /** Labels for plan ids, so a row reads "Pro period" rather than "pro". */
  planLabels: Record<string, string>;
}

const STATUS: Record<Order["status"], { text: string; tone: string }> = {
  paid: { text: "Paid", tone: "!border-emerald-300 !bg-emerald-50 !text-emerald-700" },
  pending: { text: "Awaiting payment", tone: "!border-amber-400/50 !bg-amber-50 !text-amber-700" },
  expired: { text: "Expired", tone: "!border-black/10 !text-ink-faint" },
  invalid: { text: "Invalid", tone: "!border-red-300 !bg-red-50 !text-red-700" },
};

/** Every checkout the user started, newest first, with its outcome. */
export function OrderHistory({ orders, currency, planLabels }: OrderHistoryProps) {
  if (orders.length === 0) {
    return <p className="py-4 text-center text-xs text-ink-faint">No orders yet.</p>;
  }

  return (
    <ul className="divide-y divide-black/[0.06]">
      {orders.map((order) => {
        const status = STATUS[order.status] ?? STATUS.pending;
        const plan = planLabels[order.plan_id] ?? order.plan_id;
        const providerName = paymentProviderName(order.provider);
        // A Volet order pays on this app's own /pay page, so the link is same-origin.
        const external = /^https?:/i.test(order.checkout_url ?? "");
        return (
          <li key={order.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
            <div className="min-w-0">
              <p className="truncate font-medium text-black">
                {order.kind === "subscription" ? `${plan} period` : `${formatMoney(order.amount, currency)} top-up on ${plan}`}
              </p>
              <p className="text-xs text-ink-subtle">
                {formatMoney(order.amount, currency)} · {formatTokens(order.tokens)} tokens ·{" "}
                {formatDate(order.paid_at ?? order.created_at)}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {order.status === "pending" && order.checkout_url ? (
                <a
                  href={order.checkout_url}
                  className="inline-flex items-center gap-1 text-xs font-semibold text-meta-600 hover:underline"
                  rel={external ? "noreferrer" : undefined}
                >
                  Pay <ExternalLink className="h-3 w-3" aria-hidden />
                </a>
              ) : null}
              {providerName ? <span className="chip !text-[10px] !text-ink-faint">{providerName}</span> : null}
              <span className={clsx("chip !text-[10px]", status.tone)}>{status.text}</span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export default OrderHistory;
