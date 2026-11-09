# Direct USDT (TRC-20) payments that activate by themselves

Customers who pay by sending USDT to your wallet address (for example your
Volet USDT TRC-20 deposit address) leave no order number anywhere, so Volet
cannot tell the app who paid. This way to pay fixes that without Volet:

1. When a customer picks a plan and **USDT (TRC-20)**, the app opens its own
   pay page with your address, a QR code and an **exact amount** for that
   order: the price plus a few cents no other open order uses (for example
   `37.53` for a $37.50 plan).
2. The app reads the confirmed USDT transfers into your address from the
   public TRON blockchain (TronGrid) every minute, and every 15 seconds while
   the customer has the pay page open.
3. A transfer of exactly that amount, made after the order was created and
   within 24 hours, activates the plan at once. The pay page switches to
   "Payment received" and you get the usual PAID phone alert with the
   customer's name, email, plan and amount.

## Set it up (Railway, `api` service)

| Variable | Value |
| --- | --- |
| `ADCAM_USDT_TRC20_ADDRESS` | Your USDT **TRC-20** receiving address (starts with `T`, 34 characters). In Volet: Deposit, USDT, network TRC-20, copy the address. It is public, not a secret. |
| `ADCAM_TRONGRID_API_KEY` | Optional. A free key from trongrid.io raises TronGrid's rate limit. |
| `ADCAM_USDT_PAY_WINDOW_HOURS` | Optional, default `24`. How long after checkout a payment still counts. |

Then redeploy. USDT (TRC-20) becomes the first choice on the plan page.
Admin > Sales > Automatic activation shows it as **on** and lists every
transfer the app saw.

Check once that your Volet deposit address stays the same over time (Volet
shows the same address each time you open Deposit). If Volet ever gives you a
new one, update the variable.

## What never activates by itself

- A different amount (for example an exchange that took its fee out of the
  transfer): you get a "USDT received, no order matched" alert with the
  amount, sender wallet and transaction ID. If the customer pastes their
  transaction ID on the pay page, the alert names the customer and the order
  and has Approve / Reject buttons.
- A transaction that already paid an order: it can never pay a second one.
- A screenshot.
