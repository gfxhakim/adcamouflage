import type { Metadata } from "next";

import LegalPage from "@/components/LegalPage";
import { contactEmail, SITE_NAME } from "@/lib/site";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Terms of service",
  description: `The terms for using ${SITE_NAME}: accounts, plans and tokens, payments and acceptable use.`,
  alternates: { canonical: "/terms" },
};

export default function TermsPage() {
  const email = contactEmail();
  return (
    <LegalPage title="Terms of service" updated="5 November 2026">
      <p>
        These terms apply when you use {SITE_NAME}, an online tool for editing video and image ad creatives. By
        creating an account you agree to them. Questions: <a href={`mailto:${email}`}>{email}</a>.
      </p>

      <h2>Your account</h2>
      <p>
        Keep your password private; you are responsible for what happens under your account. One account per person
        unless your plan includes team seats.
      </p>

      <h2>Plans, tokens and payments</h2>
      <ul>
        <li>Plans are paid in advance for 30-day periods and give you a number of tokens; each produced file uses tokens.</li>
        <li>
          Top-ups are available to active subscribers. Tokens have no cash value and cannot be transferred. Unused
          tokens roll over only as described on the pricing section for your plan.
        </li>
        <li>
          A plan becomes active once our payment provider confirms the payment. Prices are shown before you pay and
          may change for future periods.
        </li>
        <li>
          If a render fails because of our service, the tokens for it are returned. Other refund requests are handled
          case by case; contact us.
        </li>
      </ul>

      <h2>Your content</h2>
      <p>
        You keep all rights to the files you upload. You confirm you own them or have permission to use them. We use
        them only to provide the service.
      </p>

      <h2>Acceptable use</h2>
      <p>You agree not to use {SITE_NAME} to:</p>
      <ul>
        <li>upload content that is illegal, infringes someone else&apos;s rights, or is deceptive;</li>
        <li>break the law or the terms and advertising policies of the platforms where you publish your ads;</li>
        <li>attack, overload or try to get around the limits of the service.</li>
      </ul>
      <p>We may suspend accounts that break these rules.</p>

      <h2>Service and liability</h2>
      <p>
        We work to keep the service available but provide it &quot;as is&quot;. We are not responsible for how
        advertising platforms review or perform your ads. To the extent the law allows, our liability is limited to
        the amount you paid us in the last 30 days.
      </p>

      <h2>Ending your account</h2>
      <p>You can stop renewing at any time from your plan page. Your plan stays active until the end of the paid period.</p>

      <h2>Changes</h2>
      <p>We may update these terms; the date at the top shows the latest version.</p>
    </LegalPage>
  );
}
