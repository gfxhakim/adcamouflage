# Security and payment activation

## Railway variables (api service)

| Variable | What to set |
| --- | --- |
| `ADCAM_SECRET_KEY` | A long random value (48+ characters). If unset, one is generated once and kept in the storage volume (`/data/.secret_key`), so sign-ins survive restarts. Setting it yourself is still best. |
| `ADCAM_PUBLIC_URL` | `https://blucloack.online`. With https here the session cookie is sent over https only. |
| `ADCAM_COOKIE_SECURE` | Optional: `true` (automatic when the public URL is https). |
| `ADCAM_CLIENT_IP_HEADER` | Optional. Default `x-real-ip` (Railway). Behind Cloudflare's orange-cloud proxy use `cf-connecting-ip`. |
| `ADCAM_DEBUG` | Leave unset. When `true` the API reference at `/api/docs` is shown. |
| `ADCAM_ADMIN_EMAILS` / `ADCAM_ADMIN_PASSWORD` | Your admin login. Use a long password. |

Never paste these values into chat or commit them to the repo.

## What the app does

- Refuses form posts sent from other websites (checks the browser's `Origin`), except payment callbacks from Volet and BTCPay.
- Limits: 5 sign-ups per visitor and 60 site-wide per 10 minutes; sign-in failures per visitor+email, per account (20 / 15 min) and per visitor (40 / 15 min); password changes; transaction ID checks (10 / 10 min per account); payment screenshots (10 / hour); support uploads (30 / hour).
- JSON/form requests over 10 MB are refused (file uploads keep their own limits).
- Uploaded files are checked by content (a renamed HTML file is not accepted as an image). Payment screenshots are re-encoded and stored privately; support chat files are visible only to that chat and admins.
- Security headers on the web app and API (HSTS, no framing by other sites, no MIME sniffing, Permissions-Policy).
- Passwords are stored with bcrypt; sessions are signed and end when the password changes.

## How a paid plan turns on

1. The buyer gets a transaction ID (`BC-XXXX-XXXX`) on the checkout panel.
2. When Volet or BTCPay confirms the payment, the plan turns on immediately (no one needs to do anything).
3. If it hasn't, the buyer uploads a screenshot. It never activates anything by itself: it appears in **Admin > Payments**. Check the money arrived in your Volet/BTCPay account, then **Approve & activate** (applies the order once) or **Reject** with a note.
4. The buyer can paste the ID to the support bot or press "Check my payment". Only their own orders are searched.
