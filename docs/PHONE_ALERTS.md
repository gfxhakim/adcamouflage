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

### Approve or reject a payment right from Telegram

The 🛒 **Checkout started** and ⚠️ **Payment needs a look** alerts come with two buttons: **✅ Approve** and
**❌ Reject**. The message shows the customer's name and email, the plan, the amount and the order number.

- **Approve** asks once more (**✅ Yes, activate** / **↩️ Back**). **Yes, activate** turns the plan or top-up on the
  same way a confirmed payment does: tokens credited once, the customer's activity log gets a line, Meta gets its
  Purchase event, and the ✅ **PAID** alert follows ("Confirmed by: approved in Telegram").
- **Reject** asks once more, then marks the order invalid. If the payment provider confirms that order later
  anyway, it is still applied.
- Pressing twice, or Volet confirming an order you already approved, never credits twice ("Already active").
- Only use **Approve** when you can see the money arrived (for example in your Volet balance). A screenshot from a
  customer is not proof on its own.

**Turn the buttons on (once):**

1. Telegram alerts work (steps 1-6 above) and `ADCAM_PUBLIC_URL` on the api service is your https address
   (for example `https://blucloack.online`).
2. **Admin → Settings → Phone alerts → Connect buttons.** The card then says *Approve from Telegram: connected*.
   This tells Telegram to send button presses to `https://<your site>/api/v1/notify/telegram` with a secret
   made from your bot token; nothing else to copy or paste.
3. Open a checkout with a test account, press **Approve → Yes, activate** in Telegram, and check the account.

**Who can press:** only you. A press counts only if it comes from Telegram with the secret, from the alert chat,
by an allowed person, on a button the app itself signed for that order. Anyone else gets "Not allowed.".

- Private chat with your bot (chat ID is a positive number): you are the allowed person, nothing to set.
- Group chat (chat ID starts with `-`): set `ADCAM_NOTIFY_TELEGRAM_APPROVER_IDS` to the Telegram user IDs allowed to
  press, comma separated (each person gets theirs from @userinfobot). Without it, nobody can press in a group.

Optional variables: `ADCAM_NOTIFY_TELEGRAM_BUTTONS=false` removes the buttons (alerts still arrive);
`ADCAM_NOTIFY_TELEGRAM_WEBHOOK_SECRET` sets the secret yourself instead of deriving it from the token (then press
**Connect buttons** again).

After you change the bot token, press **Connect buttons** again. Once the buttons are connected, the
`getUpdates` link from step 3 stops working for that bot (Telegram allows one or the other); get group chat IDs
before connecting.

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
- **Buttons spin and nothing happens**: press **Connect buttons** again in Admin → Settings → Phone alerts; check that
  `ADCAM_PUBLIC_URL` is your real https address. Refused presses are logged as `Telegram button press refused: ...`
  or `Telegram webhook refused: ...`.
- Railway → api → **Deploy logs**: failed alerts are logged as `Telegram alert failed: ...` / `ntfy alert failed: ...`.

Never paste the bot token in a chat or a screenshot. If it leaks, open @BotFather → `/revoke` and put the new
token on Railway.
