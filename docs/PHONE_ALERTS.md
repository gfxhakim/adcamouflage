# Phone alerts (Telegram or ntfy)

Get an instant message on your phone when:

| Alert | When |
|---|---|
| 👀 **Plan click** | a visitor presses **Choose** on a pricing card on the landing page |
| 🛒 **Checkout started** | a signed-in customer presses Subscribe / Renew / Top up and an order opens |
| ✅ **PAID** | Volet or BTCPay confirms the money and the plan turns on |
| ⚠️ **Payment needs a look** | a payment notification was set aside (wrong amount, currency or gateway) |

Each message shows the plan, the amount, the customer's email (or "visitor" if not signed in) and the order number
(the `BC-XXXX-XXXX` transaction ID once transaction IDs are live, otherwise `#` + the first 8 characters of the order).

Alerts are **off** until you set the variables below. They never slow down or block a checkout: if Telegram is
down, the alert is just skipped and logged. The same alert (same person, same plan) is sent at most once every
2 minutes, and at most 20 alerts go out per minute, so nobody can flood your phone by clicking a button over and over.

---

## Option A: Telegram (recommended, free)

1. In Telegram, open **@BotFather**, send `/newbot`, pick a name and a username ending in `bot`.
   BotFather replies with a **token** like `123456789:AA...`. Keep it secret.
2. Open your new bot (BotFather gives the link) and press **Start**. A bot can only message people who started it.
3. Get your **chat ID**: open **@userinfobot** in Telegram and press **Start**. It replies with your `Id`, a number
   like `5123456789`.
   *(For a group instead: add the bot to the group, send a message in it, then open
   `https://api.telegram.org/bot<TOKEN>/getUpdates` in a browser and copy `chat.id`, it starts with `-`.)*
4. In Railway → **api** service → **Variables**, add:

   | Variable | Value |
   |---|---|
   | `ADCAM_NOTIFY_TELEGRAM_BOT_TOKEN` | the token from step 1 |
   | `ADCAM_NOTIFY_TELEGRAM_CHAT_ID` | the number from step 3 |

5. Click **Deploy** on the changes bar and wait for the api to restart.
6. In the app: **Admin → Settings → Phone alerts** shows **On: telegram**. Press **Send test alert**; the message
   should arrive in a few seconds.

## Option B: ntfy (no account needed)

1. Install the **ntfy** app (Android / iPhone) and **subscribe to a topic**. Use a long random name, for example
   `blucloack-7f3k9q2xw8`: anyone who knows the topic name can read it, and alerts contain customer emails.
2. In Railway → **api** → **Variables**, add `ADCAM_NOTIFY_NTFY_TOPIC` = that topic name. Deploy.
3. Admin → Settings → Phone alerts → **Send test alert**.

Optional for a private or self-hosted ntfy server: `ADCAM_NOTIFY_NTFY_URL` (default `https://ntfy.sh`) and
`ADCAM_NOTIFY_NTFY_TOKEN` (access token). You can set Telegram **and** ntfy; each alert then goes to both.

---

## Choosing which alerts you get

`ADCAM_NOTIFY_EVENTS` (optional), comma separated. Empty or not set = all of them.

- `plan_click,checkout,paid,review` everything (default)
- `checkout,paid` skip landing clicks
- `paid` only real money

`ADCAM_NOTIFY_DEDUPE_SECONDS` (optional, default `120`): how long the same alert stays quiet after it was sent.

## Turning it off

Delete the variables (or clear their values) on the api service and deploy.

## If nothing arrives

- **Admin → Settings → Phone alerts says Off**: the variables are not on the **api** service, or it was not redeployed.
- **The test shows "Telegram answered 401"**: the bot token is wrong. **"400 chat not found"**: wrong chat ID, or
  you did not press **Start** on your bot.
- Railway → api → **Deploy logs**: failed alerts are logged as `Telegram alert failed: ...` / `ntfy alert failed: ...`.

Never paste the bot token in a chat or a screenshot. If it leaks, open @BotFather → `/revoke` and put the new
token on Railway.
