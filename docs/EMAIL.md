# Customer emails

The app can email customers automatically:

| Email | When it goes out | Sent at most |
| --- | --- | --- |
| **Welcome** | Right after someone signs up | once per account |
| **Plan activated** | When a plan payment is applied: Whop webhook, the Admin grant button, or Approve in Telegram | once per paid order |
| **Renewal reminder** | A few days (default 3, you choose 1-14) before a plan period ends | once per period |
| **Plan ended** | Within a day after a period ends without a renewal | once per period |

Top-ups do not send the plan activated email. Renewing starts a new period,
so the next reminder for that new period goes out as normal.

Every email can be switched off, and its subject and message edited, in
**Admin > Settings > Customer emails**. "Send test to me" mails the saved
version to your own admin address with sample values.

## Design and editing

Every email uses the ProteusFlow design: a blue header with the shield logo
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
  add and verify your domain `proteusflow.com` there (they give you DNS
  records to add in Cloudflare), then copy the SMTP login they show.
- **Zoho Mail / Google Workspace** if you already have a mailbox on the domain.
  Gmail needs an *app password*, not your normal password.

Use a From address on your own domain (for example
`hello@proteusflow.com`) and add the SPF/DKIM records the provider gives
you, or the mail will land in spam.

## 2. Add the variables on Railway

Railway > project > **api** service > **Variables**, then press Deploy:

```bash
ADCAM_SMTP_HOST=<smtp host from your provider, e.g. smtp-relay.brevo.com>
ADCAM_SMTP_PORT=587
ADCAM_SMTP_SECURITY=starttls          # or ssl with port 465
ADCAM_SMTP_USERNAME=<smtp login>
ADCAM_SMTP_PASSWORD=<smtp password / key>
ADCAM_EMAIL_FROM="ProteusFlow <hello@proteusflow.com>"
ADCAM_EMAIL_REPLY_TO=support@proteusflow.com   # where customer replies go
ADCAM_PUBLIC_URL=https://proteusflow.com       # used for the links
```

Never paste these values in a chat or a commit.

Already using Resend? `ADCAM_RESEND_API_KEY` still works instead of SMTP. If
both are set, SMTP is used.

## 3. Check it

Open Admin > Settings > Customer emails. The badge should say **On: SMTP**.
Press **Send test to me** on each email. If it fails, the api service logs
say why (wrong password, port blocked, domain not verified).

## Business email on proteusflow.com

Two parts: **receive** mail at `hello@proteusflow.com` (free, Cloudflare), and **send** customer emails from it (Brevo).

### Receive: Cloudflare Email Routing (free)
1. Cloudflare > `proteusflow.com` > **Email > Email Routing** > Get started.
2. Create addresses, e.g. `hello@` and `support@`, each sent to your Gmail. Confirm the email Cloudflare sends to your Gmail.
3. Let Cloudflare add the MX + TXT records it shows (one click). Mail to those addresses now lands in your Gmail.
4. Optional, to reply as hello@proteusflow.com from Gmail: Gmail > Settings > Accounts > **Send mail as** > add `hello@proteusflow.com`, SMTP server `smtp-relay.brevo.com`, port 587, your Brevo SMTP login and key.

### Send: verify the domain in Brevo
1. Brevo > **Senders, domains & dedicated IPs > Domains > Add a domain** > `proteusflow.com`.
2. Choose "Authenticate with Cloudflare" (automatic) or copy the records Brevo shows (Brevo code TXT, DKIM, DMARC) into Cloudflare DNS, all **DNS only** (grey cloud).
3. Wait until Brevo shows the domain as Authenticated, then **Senders > Add a sender**: name `ProteusFlow`, email `hello@proteusflow.com`.
4. Railway > `api` > Variables:
   - `ADCAM_EMAIL_FROM` = `ProteusFlow <hello@proteusflow.com>`
   - `ADCAM_EMAIL_REPLY_TO` = `support@proteusflow.com`
   - `ADCAM_PUBLIC_URL` = `https://proteusflow.com`
   Deploy, then press **Send test** in Admin > Settings > Customer emails.

Change `ADCAM_EMAIL_FROM` only after step 3: Brevo refuses mail from a domain it has not authenticated.

## Every automatic email

| Email | When | Can be switched off |
|---|---|---|
| Sign-up code | Email + password sign-up | No |
| Welcome | Account opened (after the code, or Google) | Yes |
| Password reset code | Forgot password | No |
| Password change code | Changing the password on the plan page | No |
| Password changed | After a change or reset | No |
| Email change code | To the NEW address | No |
| Email changed | To the OLD address | No |
| New sign-in alert | Sign-in from a new browser/device | Yes |
| Google linked | Google connected to an existing account | Yes |
| Plan activated + receipt | Plan payment confirmed or approved | Yes |
| Top-up receipt | Top-up confirmed or approved | Yes |
| Payment not completed | A payment you reject (Admin or Telegram) | Yes |
| Renewal reminder | A few days before the period ends | Yes |
| Plan ended | Within a day after it ends | Yes |

## How duplicates are avoided

- Welcome: the send is recorded on the account (Activity), and a second
  welcome is never sent to the same account.
- Plan activated: the payment code applies an order exactly once, and only
  then queues the email.
- Reminders: the Celery beat job runs every hour; each reminder is recorded
  with the period end it was for, so it is not sent again for that period.
  A database lock stops two runs from overlapping. A send the mail server
  refuses is not recorded, so it is retried on the next run.

## Send to a group

Admin > Settings > Customer emails > **Send to a group** sends one email to the
customers you pick (by group like "Never paid", "Active on Pro", "Plan ended",
"Low on tokens", or one by one).

- Each person gets their own `{name}`, `{plan}`, `{tokens}`, `{end_date}` and links.
- It needs `ADCAM_PUBLIC_URL` on the api service, because every group email has an
  unsubscribe link (and one-click unsubscribe headers for Gmail/Outlook).
  People who unsubscribe never get group emails again; account emails
  (welcome, plan activated, reminders) still reach them.
- Sending is throttled: one email every few seconds, up to a daily limit
  (default 250, editable in the card). Brevo's free plan allows about 300 a day
  in total, account emails included. Whatever is over the limit goes out the
  next day automatically (the worker checks every 2 minutes).
- You type SEND to confirm. Every send, stop and retry is in the admin audit log.
- Nobody is sent the same group email twice, even after a restart.
