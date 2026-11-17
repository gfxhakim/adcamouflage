# Taking payments with Whop

ProteusFlow uses **Whop Embedded Checkout** + **Standard Webhooks** as its single
payment processor.

## 1. Environment variables (Railway `api` service)

| Variable | What it is | Example |
|---|---|---|
| `ADCAM_WHOP_API_KEY` | Whop company API key (with `membership:cancel`, `membership:update`, `payment:read`, `payment:refund` permissions) | `whop_...` |
| `ADCAM_WHOP_WEBHOOK_SECRET` | Webhook signing secret from Whop Dashboard (must include `ws_` prefix) | `ws_...` |
| `ADCAM_WHOP_PLAN_SUBSCRIPTION` | Map internal plan ids (`starter`, `pro`, `max`) to Whop `plan_xxx` ids | `{"starter":"plan_xxx","pro":"plan_yyy","max":"plan_zzz"}` |
| `ADCAM_WHOP_PLAN_TOPUP` | Map top-up dollar amounts (`20`, `40`, `80`, `160`, `240`) to Whop `plan_xxx` ids | `{"20":"plan_a","40":"plan_b","80":"plan_c","160":"plan_d","240":"plan_e"}` |
| `ADCAM_PUBLIC_URL` | Your public HTTPS site URL (used for returnUrl, Meta CAPI, Telegram buttons) | `https://proteusflow.com` |

Both `ADCAM_WHOP_PLAN_SUBSCRIPTION` and `ADCAM_WHOP_PLAN_TOPUP` also accept
comma-separated `key=plan_id` format (e.g. `starter=plan_xxx,pro=plan_yyy,max=plan_zzz`).

## 2. Configure the Webhook in Whop

1. In your Whop Dashboard → **Developer → Webhooks**, create a webhook endpoint pointing to:
   ```text
   https://<your-domain>/api/v1/billing/whop/webhook
   ```
2. Subscribe to these 7 events:
   - `payment.succeeded` — settles initial checkouts + recurring `subscription_cycle` renewals
   - `payment.failed` — voids unpaid checkouts and logs/alerts renewal failures
   - `membership.deactivated` — syncs cancellation at period end (keeps days/tokens) or early deactivation
   - `refund.created` — revokes tokens/plan, closes pending request, pauses account, reverses affiliates
   - `refund.updated` — syncs refund completion or sends an alert if a refund fails
   - `dispute.created` — immediately pauses the disputed plan/account and alerts admin
   - `dispute.updated` — resolves disputed state (`lost` finalizes refund + reverses affiliates; `won` notifies admin)
3. Copy the **`ws_...`** signing secret and paste it verbatim into `ADCAM_WHOP_WEBHOOK_SECRET`.

## 3. How Cancellation & Refunds Work

1. **Plan cancellation (Whop rules):** Clicking **Cancel plan** in Account settings calls Whop (`cancel_at_period_end=true`), stopping auto-renewal for next month while remaining days and tokens stay active until `period_end`. Customers can resume before `period_end`.
2. **Refund request + admin Whop refund:** Submitting a refund request in Account settings immediately stops the customer's plan and pauses their account (`is_active=false`, sessions revoked) so they can no longer render. The request appears in **Admin → Sales**. Clicking **Approve & refund via Whop** calls Whop's `payments.refund` API to return the funds to the customer's card/payment method, revokes tokens, and reverses affiliate rewards. Rejecting can optionally reactivate the customer's account.

## 4. How the Checkout Flow Works

1. User clicks **Subscribe / Renew / Upgrade / Top up** on `/app/plan`.
2. Frontend calls `POST /api/v1/billing/checkout { kind, plan_id | amount, provider: "whop" }`.
3. Backend validates the plan/top-up, creates a pending `Order`, looks up the matching `plan_xxx` id via `whop.plan_id_for`, and returns `{ order_id, whop_plan }`.
4. Frontend opens `<WhopCheckout planId={whop_plan} orderId={order_id} returnUrl={...} />`, mounting Whop's Elements script with `metadata: { order_id }`.
5. When the buyer pays on Whop, Whop delivers a signed `payment.succeeded` webhook to `/api/v1/billing/whop/webhook` carrying `data.metadata.order_id`.
6. Backend verifies the Standard Webhooks signature via `whop_sdk.lib.verify_webhook.unwrap`, checks that the paid Whop plan matches the order (if present in payload), stores Whop's `pay_...` id in `order.provider_ref`, and runs `tokens.settle_order` atomically (idempotent — guaranteed to credit at most once).
7. Meanwhile, `/app/plan` polls `GET /api/v1/billing/orders/{order_id}` until `status === "paid"` and immediately updates the balance and shows confirmation.
