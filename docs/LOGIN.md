# Log in: Google, Apple, email codes

What customers get:

- **Continue with Google** and **Continue with Apple** on the log in and sign-up pages (each button shows once its keys are set).
- Email + password sign-up with a **6-digit code** sent to the email. The account opens only after the code is entered.
- **Forgot password?** on the log in page: a code by email, then a new password.
- Changing the password (plan page) needs a code from the email. Changing the email sends a code to the new address and a notice to the old one.
- A **new sign-in alert** when an account is opened from a browser/device it has not used before.

All of these emails are in Admin > Settings > Customer emails, where their text can be edited. Codes and security notices are always on.

> Codes need working email (docs/EMAIL.md). If email is not set up, sign-ups open straight away without a code, like before.

The address customers come back to is always `https://proteusflow.com/api/v1/auth/oauth/<google|apple>/callback`, so **`ADCAM_PUBLIC_URL=https://proteusflow.com` must be set on the `api` service** and must match what you type at Google and Apple below (bare domain, no `www`, no trailing slash).

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

## Apple (needs the Apple Developer Program, $99/year)

1. Join at <https://developer.apple.com/programs/enroll/> (individual is fine; approval can take 1-2 days).
2. <https://developer.apple.com/account/resources/identifiers/list> > **+** > **App IDs** > App > description `ProteusFlow`, Bundle ID `com.proteusflow.app`, tick **Sign In with Apple**. Register.
3. **+** again > **Services IDs** > description `ProteusFlow web`, identifier `com.proteusflow.web`. Register, open it, tick **Sign In with Apple** > **Configure**:
   - Primary App ID: the one from step 2.
   - Domains: `proteusflow.com`
   - Return URLs: `https://proteusflow.com/api/v1/auth/oauth/apple/callback`
   Next > Done > Continue > Save.
4. **Keys** > **+** > name `ProteusFlow sign in`, tick **Sign in with Apple** > Configure > pick the App ID > Save > Continue > Register. **Download** the `.p8` file (only possible once) and note the **Key ID**.
5. Your **Team ID** is at the top right of the developer site (10 characters).
6. So Apple's "Hide my email" addresses receive our emails: **Services > Sign in with Apple for Email Communication > Configure**, add `proteusflow.com` and the address you send from (e.g. `hello@proteusflow.com`). Your domain must pass SPF (Brevo's setup in docs/EMAIL.md covers it).
7. Railway > `api` > **Variables**:
   - `ADCAM_APPLE_CLIENT_ID` = the Services ID, e.g. `com.proteusflow.web` (not the App ID)
   - `ADCAM_APPLE_TEAM_ID` = Team ID
   - `ADCAM_APPLE_KEY_ID` = Key ID
   - `ADCAM_APPLE_PRIVATE_KEY` = open the `.p8` in a text editor and paste **all** of it, including the `-----BEGIN PRIVATE KEY-----` and `-----END PRIVATE KEY-----` lines
   Click **Deploy**.

Never paste these values in a chat or commit them to the repo.

## Check it

1. Open the site in a private window > Log in. The two buttons show.
2. Continue with Google > pick an account > you land in the workspace. Admin > Users shows the new account.
3. Sign up with an email + password > the code arrives > enter it > the welcome email follows.

If a button sends you back to log in with "Sign-in did not work", the `api` log line starting `google sign-in failed:` / `apple sign-in failed:` says why. The usual causes: a redirect URI that does not match `ADCAM_PUBLIC_URL` exactly, the Apple key pasted without its first/last line, or the App ID used instead of the Services ID.

## How accounts are matched

- Same Google/Apple account again: same customer.
- First time, and an account with that (verified) email exists: Google/Apple is connected to it, and the owner gets a "sign-in added" email. Their password keeps working.
- If that existing account never entered its sign-up code, the password typed at that sign-up is dropped (the Google/Apple owner proved the inbox is theirs). They can set one with Forgot password.
- Otherwise a new account is opened (already verified) and gets the welcome email.
- Admin accounts can use Google too, if the Google account has the admin email.
