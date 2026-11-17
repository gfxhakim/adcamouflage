# Log in: Google and email codes

What customers get:

- **Continue with Google** on the log in and sign-up pages (shows once its keys are set).
- Email + password sign-up with a **6-digit code** sent to the email. The account opens only after the code is entered.
- **Forgot password?** on the log in page: a code by email, then a new password.
- Changing the password (plan page) needs a code from the email. Changing the email sends a code to the new address and a notice to the old one.
- A **new sign-in alert** when an account is opened from a browser/device it has not used before.

All of these emails are in Admin > Settings > Customer emails, where their text can be edited. Codes and security notices are always on.

> Codes need working email (docs/EMAIL.md). If email is not set up, sign-ups open straight away without a code, like before.

The address customers come back to is always `https://proteusflow.com/api/v1/auth/oauth/google/callback`, so **`ADCAM_PUBLIC_URL=https://proteusflow.com` must be set on the `api` service** and must match what you type at Google below (bare domain, no `www`, no trailing slash).

---

## Google (free, about 10 minutes)

1. Open <https://console.cloud.google.com/> and sign in. Top bar > project picker > **New project**, name it `ProteusFlow`, Create, then select it.
2. Menu > **APIs & Services > OAuth consent screen** (or "Google Auth Platform > Branding"). Get started:
   - App name `ProteusFlow`, support email = your email.
   - Audience: **External**.
   - Contact email = your email. Agree and Create.
3. **Branding**: add the logo (frontend/public/brand/proteusflow-mark.png), home page `https://proteusflow.com`, privacy `https://proteusflow.com/privacy`, terms `https://proteusflow.com/terms`, authorised domain `proteusflow.com`. Save.
4. **Audience**: press **Publish app** (otherwise only test users can log in). Basic scopes (email, profile) do not need Google's review.
5. **Clients > Create client**:
   - Application type: **Web application**, name `ProteusFlow web`.
   - Authorised JavaScript origins: `https://proteusflow.com`
   - Authorised redirect URIs: `https://proteusflow.com/api/v1/auth/oauth/google/callback`
   - Create. Copy the **Client ID** and **Client secret** (download the JSON to keep them).
6. Railway > `api` service > **Variables**, add:
   - `ADCAM_GOOGLE_CLIENT_ID` = the Client ID (ends with `.apps.googleusercontent.com`)
   - `ADCAM_GOOGLE_CLIENT_SECRET` = the Client secret
   Click **Deploy** on the changes bar.

## Check it

1. Open the site in a private window > Log in. The two buttons show.
2. Continue with Google > pick an account > you land in the workspace. Admin > Users shows the new account.
3. Sign up with an email + password > the code arrives > enter it > the welcome email follows.

If the button sends you back to log in with "Sign-in did not work", the `api` log line starting `google sign-in failed:` says why. The usual cause: a redirect URI that does not match `ADCAM_PUBLIC_URL` exactly.

## How accounts are matched

- Same Google account again: same customer.
- First time, and an account with that (verified) email exists: Google is connected to it, and the owner gets a "sign-in added" email. Their password keeps working.
- If that existing account never entered its sign-up code, the password typed at that sign-up is dropped (the Google owner proved the inbox is theirs). They can set one with Forgot password.
- Otherwise a new account is opened (already verified) and gets the welcome email.
- Admin accounts can use Google too, if the Google account has the admin email.
