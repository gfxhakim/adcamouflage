# Security

What protects the app and its database, and the few settings the owner sets on
Railway. Never paste a secret into a chat, a ticket or a commit: type it only
into Railway → service → **Variables**.

## Railway variables (service `api`)

| Variable | What to put | Why |
| --- | --- | --- |
| `ADCAM_SECRET_KEY` | A long random string (Railway's "Generate" button, 48+ characters) | Signs sign-in sessions and download links. If it is missing the app now makes one and keeps it on the `/data` volume, but setting it yourself is safer. Changing it signs everyone out. |
| `ADCAM_ENVIRONMENT` | `production` | Labels the deploy. |
| `ADCAM_COOKIE_SECURE` | `true` | Session cookie only travels over HTTPS. (The app also adds this flag automatically when a request arrives over HTTPS.) |
| `ADCAM_ADMIN_PASSWORD` | A strong password (16+ characters, not used anywhere else) | The admin login. |
| `ADCAM_ENABLE_DOCS` | leave unset | Keeps the API reference page (`/api/docs`) hidden; it lists every route. |
| `ADCAM_CORS_ORIGINS` | your site, e.g. `https://blucloack.online,https://www.blucloack.online` | Only your own site may call the API from a browser. |

Payment provider secrets (`ADCAM_VOLET_SCI_SECRET`, `ADCAM_BTCPAY_API_KEY`,
`ADCAM_BTCPAY_WEBHOOK_SECRET`) stay as described in `VOLET.md` / `BTCPAY.md`.

Database: use Railway's Postgres **private** URL (`DATABASE_URL` referencing
`${{Postgres.DATABASE_URL}}`) and keep the Postgres service without a public
TCP proxy, so the database is reachable only from inside the project.

## What the code does

* **Sign-in / sign-up**: bcrypt password hashes; the same error for a wrong
  email or password; limits on failed sign-ins per address+email (8 / 5 min),
  per account from any address (20 / 15 min) and per address across accounts
  (40 / 15 min); sign-up limited to 10 per hour per address; password change
  limited and signs out other devices.
* **Sessions**: HttpOnly, SameSite=Lax cookie (blocks cross-site form attacks),
  Secure over HTTPS, signed JWT that is invalidated on password change.
* **Admin**: every admin route answers 404 to anyone who is not an admin.
* **Rate limits** on support chat (messages, uploads, escalations), payment
  check and payment proofs.
* **Headers**: `nosniff`, frame blocking, strict referrer, HSTS over HTTPS,
  `no-store` on account/billing/admin answers; the web app also sends a
  `frame-ancestors`/`base-uri`/`object-src` policy.
* **Body size**: JSON/form bodies over 10 MB are refused; file uploads stream
  to disk with their own caps (support 150 MB, payment screenshots 10 MB).
* **Uploads**: checked by their first bytes, not just the file name; stored
  under random names; support files and payment screenshots are only served
  to their owner or an admin; chat messages can only link files uploaded
  through the chat.
* **Database**: every query goes through SQLAlchemy with bound parameters;
  no user text is ever pasted into SQL.
* **Payment notifications**: BTCPay webhooks are HMAC-checked; Volet
  notifications are hash-checked and must come from Volet's addresses.
* **Logs**: no passwords, session tokens or payment secrets are logged.

## Payments: how a plan turns on

1. The customer picks a plan; the app creates an order with its own id.
2. They pay. Volet/BTCPay tells the app, the order is marked paid and the plan
   and tokens are applied at once (exactly once, even if told twice).
3. If that has not happened, the customer can paste the transaction id under
   **My plan → Payment check**, or in the support chat: the bot looks it up
   and confirms when the payment is recorded.
4. If it is still not found, they send the transaction id with a screenshot
   (**I paid: send proof**). It is saved with their account and shows up in
   **Admin → Payments**; **Approve & activate** turns the plan on. A screenshot
   alone never activates anything, because it can be faked.

## Rate limits and the visitor's address

Limits key on the `X-Real-IP` header that Railway's edge sets, falling back to
the connecting address. If the domain is switched to Cloudflare's proxy
(orange cloud), set `ADCAM_CLIENT_IP_HEADER=cf-connecting-ip` on `api`,
otherwise every visitor would share Cloudflare's addresses and hit the limits
together. With the grey cloud ("DNS only") leave it unset.
