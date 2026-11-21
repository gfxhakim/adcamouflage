import type { Metadata } from "next";
import Link from "next/link";

import LegalPage from "@/components/LegalPage";
import { contactEmail, SITE_NAME } from "@/lib/site";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Refund policy & conditions",
  description: `How ${SITE_NAME} works, account conditions, and our remaining-tokens-only refund policy.`,
  alternates: { canonical: "/refund-policy" },
};

export default function RefundPolicyPage() {
  const email = contactEmail();
  return (
    <LegalPage title="Refund policy & conditions" updated="21 November 2026">
      <p>
        This page explains how {SITE_NAME} (&quot;we&quot;) works, the conditions that apply when you create an account,
        and how refunds are calculated. Questions: <a href={`mailto:${email}`}>{email}</a>.
      </p>

      <h2>How {SITE_NAME} works</h2>
      <ul>
        <li>
          <b>Cloud batch production studio</b>: Upload your raw video or image creatives, choose placement presets (Reels,
          TikTok, Shorts, Feed, Snapchat, or Google), apply color grading, audio leveling, logo overlays, and cover
          frames, then batch-render unique variations ready to download or ZIP-export.
        </li>
        <li>
          <b>30-day token plans and top-ups</b>: Paid subscriptions provide a monthly token allowance for a 30-day
          period. Active subscribers can also purchase extra token top-ups that remain available while their plan stays
          active.
        </li>
        <li>
          <b>Token usage &amp; failed renders</b>: Each rendered variation deducts tokens based on the chosen preset and
          plan rate. If a render fails or is cancelled before completion due to our service, those tokens are
          automatically returned to your balance.
        </li>
      </ul>

      <h2>Account &amp; usage conditions</h2>
      <ul>
        <li>
          <b>Accurate account &amp; lawful content</b>: You must provide accurate registration details, keep your login
          secure, and upload only media you own or have rights to use.
        </li>
        <li>
          <b>Platform compliance</b>: You are responsible for reviewing your exported creatives and ensuring your ad
          campaigns comply with Meta, TikTok, YouTube, Snapchat, Google, and applicable advertising laws.
        </li>
        <li>
          <b>Seats &amp; fair use</b>: Team access is limited to the seats included with your plan (up to 5 seats on Max).
          Reselling access, automated scraping, or abusing free/referral systems can result in suspension.
        </li>
        <li>
          <b>Cancel anytime</b>: Turning off renewal in Account settings stops future billing while keeping your
          remaining days and tokens active until the end of the current paid period.
        </li>
      </ul>

      <h2>Refund policy (remaining tokens only)</h2>
      <ul>
        <li>
          <b>Prorated exclusively to unused tokens in your account</b>: Refunds are calculated strictly from the{" "}
          <b>remaining, unused tokens currently available in your account</b> from that eligible order when you submit
          your request.
        </li>
        <li>
          <b>Calculation formula</b>:{" "}
          <code>Refundable Amount = Paid Amount × (Remaining Unused Tokens ÷ Tokens Granted by Order)</code>. For
          example, if an order granted 4,500 tokens for $89 and 1,350 tokens have already been spent (leaving 3,150
          unused tokens, or 70%), only the remaining 3,150 tokens ($62.30) are eligible for refund.
        </li>
        <li>
          <b>Consumed tokens are non-refundable</b>: Once tokens have been used to produce renders—or if 0 tokens from
          the order remain available in your account—no cash refund applies for those spent tokens. Promotional, bonus,
          or rolled-over tokens have no independent cash value.
        </li>
        <li>
          <b>Request window &amp; immediate pause</b>: Eligible payments within the configured refund window (7 days by
          default from Account settings &rarr; <Link href="/app/plan">Your plan</Link>) can be submitted for review.
          Submitting a refund request stops auto-renewal and immediately pauses the account and remaining period so no
          additional tokens can be spent while your refund is processed.
        </li>
        <li>
          <b>How refunds are returned</b>: Card and checkout payments made via Whop are refunded proportionally directly
          back to the original payment method. Approved legacy crypto orders are sent to the wallet address provided in
          the request.
        </li>
      </ul>

      <p>
        See also our <Link href="/terms">Terms of service</Link> and <Link href="/privacy">Privacy policy</Link>.
      </p>
    </LegalPage>
  );
}
