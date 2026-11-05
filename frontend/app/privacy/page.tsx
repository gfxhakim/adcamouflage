import type { Metadata } from "next";

import LegalPage from "@/components/LegalPage";
import { contactEmail, SITE_NAME } from "@/lib/site";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Privacy policy",
  description: `How ${SITE_NAME} collects, uses and protects your data, including cookies and the Meta Pixel.`,
  alternates: { canonical: "/privacy" },
};

export default function PrivacyPage() {
  const email = contactEmail();
  return (
    <LegalPage title="Privacy policy" updated="5 November 2026">
      <p>
        This policy explains what {SITE_NAME} (&quot;we&quot;) collects when you visit this website or use the app, why,
        and the choices you have. Questions: <a href={`mailto:${email}`}>{email}</a>.
      </p>

      <h2>What we collect</h2>
      <ul>
        <li>
          <b>Account details</b>: your email address, an optional display name and your password (stored only as a
          secure hash).
        </li>
        <li>
          <b>Files you upload</b> and the files the app produces from them. They are used only to run the edits you
          ask for and to let you download the results.
        </li>
        <li>
          <b>Billing records</b>: your plan, token balance and orders (amount, date, status). Payments are handled by
          our payment providers (Volet and/or BTCPay Server); we never see or store card numbers or wallet keys.
        </li>
        <li>
          <b>Technical data</b>: IP address, browser type, pages visited and timestamps, used to keep the service
          secure and working.
        </li>
      </ul>

      <h2 id="cookies">Cookies and the Meta Pixel</h2>
      <p>
        We use a session cookie to keep you signed in and a cookie that remembers your cookie choice. These are needed
        for the site to work.
      </p>
      <p>
        Only if you click <b>Accept</b> on the cookie banner, we also use the <b>Meta Pixel</b> and Meta&apos;s{" "}
        <b>Conversions API</b> to measure our advertising on Facebook and Instagram. This tells Meta when someone who
        saw our ad visits a page, creates an account, starts a checkout or completes a purchase (with the amount and
        currency). We share a hashed (scrambled) version of your email address, your IP address, browser details and
        Meta&apos;s cookie identifiers. Meta processes this data under its own{" "}
        <a href="https://www.facebook.com/privacy/policy" target="_blank" rel="noreferrer">
          privacy policy
        </a>
        . You can change your choice at any time with <b>Cookie settings</b> in the footer. If you decline, none of
        this is sent.
      </p>

      <h2>How we use your data</h2>
      <ul>
        <li>To provide the app: sign-in, processing your files, plans, tokens and payments.</li>
        <li>To send account and billing emails (for example renewal reminders).</li>
        <li>To answer support requests.</li>
        <li>To measure our ads, only with your consent (see above).</li>
        <li>To prevent abuse and keep the service secure.</li>
      </ul>

      <h2>Who we share it with</h2>
      <p>
        Our hosting provider (Railway), our payment providers (Volet, BTCPay Server), our email provider (Resend) and,
        with your consent, Meta. We do not sell your personal data.
      </p>

      <h2>How long we keep it</h2>
      <p>
        Account and billing records are kept while your account is open and as long as the law requires afterwards.
        Uploaded and produced files are deleted automatically after a short period. You can ask us to delete your
        account at any time.
      </p>

      <h2>Your rights</h2>
      <p>
        You can ask to see, correct, export or delete your personal data, and withdraw consent to advertising cookies
        at any time. Write to <a href={`mailto:${email}`}>{email}</a>.
      </p>

      <h2>Changes</h2>
      <p>If this policy changes, we update the date at the top of this page.</p>
    </LegalPage>
  );
}
