# Customer emails

The app can email customers automatically:

| Email | When it goes out | Sent at most |
| --- | --- | --- |
| **Welcome** | Right after someone signs up | once per account |
| **Plan activated** | When a plan payment is applied: Volet, BTCPay, the Admin grant button, or Approve in Telegram | once per paid order |
| **Renewal reminder** | A few days (default 3, you choose 1-14) before a plan period ends | once per period |
| **Plan ended** | Within a day after a period ends without a renewal | once per period |

Top-ups do not send the plan activated email. Renewing starts a new period,
so the next reminder for that new period goes out as normal.

Every email can be switched off, and its subject and message edited, in
**Admin > Settings > Customer emails**. "Send test to me" mails the saved
version to your own admin address with sample values.

## Design and editing

Every email uses the BluCloacking design: a blue header with the shield logo
(white glow), a small top line, one big text (tokens added, days left), then a
white card with the headline, your message and one button. In
**Admin > Settings > Customer emails** you can change, per email: subject,
the three header lines, headline, message and button text (leave a header
line or the button empty to hide it). The **Logo & colours** tab changes the
logo (upload or link), its size, every colour and the footer for all emails.
A live preview shows unsaved edits.

The first line in a message that is only a link (for example `{plan_url}`)
becomes the button. Emails still carry a plain-text version.

Logo and uploaded images load from `ADCAM_PUBLIC_URL`, so set it on the api
service or the logo will not show.

Nothing is sent until a mail server is set up. Until then sign-ups and
payments work exactly as before.

## 1. Pick a mail sender

Any SMTP service works. Easy choices:

- **Brevo** (free tier, ~300 emails/day) or **Mailgun / Amazon SES / Postmark**:
  add and verify your domain `blucloack.online` there (they give you DNS
  records to add in Cloudflare), then copy the SMTP login they show.
- **Zoho Mail / Google Workspace** if you already have a mailbox on the domain.
  Gmail needs an *app password*, not your normal password.

Use a From address on your own domain (for example
`billing@blucloack.online`) and add the SPF/DKIM records the provider gives
you, or the mail will land in spam.

## 2. Add the variables on Railway

Railway > project > **api** service > **Variables**, then press Deploy:

```bash
ADCAM_SMTP_HOST=<smtp host from your provider, e.g. smtp-relay.brevo.com>
ADCAM_SMTP_PORT=587
ADCAM_SMTP_SECURITY=starttls          # or ssl with port 465
ADCAM_SMTP_USERNAME=<smtp login>
ADCAM_SMTP_PASSWORD=<smtp password / key>
ADCAM_EMAIL_FROM="BluCloacking <billing@blucloack.online>"
ADCAM_EMAIL_REPLY_TO=<optional: mailbox that should get customer replies>
ADCAM_PUBLIC_URL=https://blucloack.online   # already set if billing works; used for the links
```

Never paste these values in a chat or a commit.

Already using Resend? `ADCAM_RESEND_API_KEY` still works instead of SMTP. If
both are set, SMTP is used.

## 3. Check it

Open Admin > Settings > Customer emails. The badge should say **On: SMTP**.
Press **Send test to me** on each email. If it fails, the api service logs
say why (wrong password, port blocked, domain not verified).

## How duplicates are avoided

- Welcome: the send is recorded on the account (Activity), and a second
  welcome is never sent to the same account.
- Plan activated: the payment code applies an order exactly once, and only
  then queues the email.
- Reminders: the Celery beat job runs every hour; each reminder is recorded
  with the period end it was for, so it is not sent again for that period.
  A database lock stops two runs from overlapping. A send the mail server
  refuses is not recorded, so it is retried on the next run.
