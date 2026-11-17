"use client";

import { ExternalLink, Loader2, Megaphone, Plus, Trash2 } from "lucide-react";
import { useState, type FormEvent } from "react";

import NeonCard from "@/components/NeonCard";
import CopyField from "@/components/referrals/CopyField";
import { applyAsPartner, referralLink, type PartnerProgram } from "@/lib/referrals";

interface PartnerCardProps {
  partner: PartnerProgram;
  defaultName?: string;
  defaultEmail?: string;
  onChanged: (partner: PartnerProgram) => void;
}

function ApplyForm({ partner, defaultName, defaultEmail, onChanged }: PartnerCardProps) {
  const [fullName, setFullName] = useState(partner.full_name || defaultName || "");
  const [email, setEmail] = useState(partner.email || defaultEmail || "");
  const [socialLinks, setSocialLinks] = useState<string[]>(
    partner.social_links && partner.social_links.length > 0 ? partner.social_links : [""],
  );
  const [audience, setAudience] = useState(partner.audience || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const updateLink = (index: number, value: string) => {
    setSocialLinks((prev) => prev.map((item, i) => (i === index ? value : item)));
  };

  const addLink = () => {
    if (socialLinks.length >= 10) return;
    setSocialLinks((prev) => [...prev, ""]);
  };

  const removeLink = (index: number) => {
    if (socialLinks.length <= 1) return;
    setSocialLinks((prev) => prev.filter((_, i) => i !== index));
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const cleanedLinks = socialLinks.map((item) => item.trim()).filter(Boolean);
    if (cleanedLinks.length === 0) {
      setError("Add at least one social media profile link.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      onChanged(
        await applyAsPartner({
          full_name: fullName.trim(),
          email: email.trim(),
          social_links: cleanedLinks,
          audience: audience.trim(),
        }),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send your request.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="mt-5 max-w-xl space-y-4">
      {partner.status === "rejected" ? (
        <p className="rounded-xl border border-black/10 bg-black/[0.02] px-3 py-2 text-xs text-ink-muted">
          Your previous request was not accepted. You can update your details and submit a new application.
        </p>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="label mb-1 block">Full name</span>
          <input
            className="field"
            value={fullName}
            minLength={2}
            maxLength={120}
            required
            placeholder="Your full name"
            onChange={(e) => setFullName(e.target.value)}
          />
        </label>

        <label className="block">
          <span className="label mb-1 block">Email</span>
          <input
            type="email"
            className="field"
            value={email}
            maxLength={254}
            required
            placeholder="you@example.com"
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
      </div>

      <div className="space-y-2">
        <span className="label block">Social media links</span>
        {socialLinks.map((link, index) => (
          <div key={index} className="flex items-center gap-2">
            <input
              type="text"
              className="field flex-1"
              value={link}
              maxLength={300}
              required={index === 0}
              placeholder={index === 0 ? "https://youtube.com/@yourchannel or profile URL" : "Another social media profile URL"}
              aria-label={`Social media profile ${index + 1}`}
              onChange={(e) => updateLink(index, e.target.value)}
            />
            {socialLinks.length > 1 ? (
              <button
                type="button"
                onClick={() => removeLink(index)}
                className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-black/10 text-ink-subtle transition hover:border-red-300 hover:bg-red-50 hover:text-red-600"
                aria-label="Remove social media profile"
                title="Remove link"
              >
                <Trash2 className="h-4 w-4" aria-hidden />
              </button>
            ) : null}
          </div>
        ))}
        {socialLinks.length < 10 ? (
          <button
            type="button"
            onClick={addLink}
            className="inline-flex items-center gap-1.5 rounded-lg border border-black/10 bg-black/[0.02] px-3 py-1.5 text-xs font-medium text-ink-muted transition hover:border-meta-500/40 hover:bg-meta-50 hover:text-meta-700"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden />
            Add another social media profile
          </button>
        ) : null}
      </div>

      <label className="block">
        <span className="label mb-1 block">Why do you want to join, who is your audience, and what is your content about?</span>
        <textarea
          className="field min-h-[120px]"
          value={audience}
          required
          minLength={10}
          maxLength={2000}
          placeholder="Explain why you want to join our affiliate program, describe your audience, and tell us what your content covers."
          onChange={(e) => setAudience(e.target.value)}
        />
      </label>

      {error ? <p className="text-xs text-red-600">{error}</p> : null}

      <div className="space-y-2">
        <button type="submit" className="btn-primary !py-2.5 !text-sm" disabled={busy}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
          Submit affiliate request
        </button>
        <p className="text-[11px] text-ink-faint">
          We review each application manually and assign your promo code and Whop affiliate link once approved.
        </p>
      </div>
    </form>
  );
}

/** Partner application and approved Whop link + promo code view. */
export function PartnerCard({ partner, defaultName, defaultEmail, onChanged }: PartnerCardProps) {
  const approved = partner.status === "approved" || partner.status === "suspended";
  const shareLink = partner.affiliate_link?.trim() || (partner.code ? referralLink(partner.code) : "");

  return (
    <NeonCard padding="lg" radius="xl">
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <Megaphone className="h-4 w-4 text-meta-500" aria-hidden />
        <h2 className="text-sm font-semibold tracking-tight text-black">
          {approved ? "Your Affiliate Access" : "Affiliate program request"}
        </h2>
        {partner.status === "pending" ? (
          <span className="chip !border-amber-400/50 !bg-amber-50 !text-[10px] !text-amber-700">In review</span>
        ) : null}
        {partner.status === "approved" ? (
          <span className="chip !border-emerald-300 !bg-emerald-50 !text-[10px] !text-emerald-700">Approved partner</span>
        ) : null}
        {partner.status === "suspended" ? (
          <span className="chip !border-red-300 !bg-red-50 !text-[10px] !text-red-700">Suspended</span>
        ) : null}
      </div>

      <p className="max-w-2xl text-sm text-ink-muted">
        {approved
          ? "Share your affiliate link and promo code with your audience. Clients enter your promo code directly on the Whop checkout page when subscribing to a plan."
          : "Apply to join the ProteusFlow affiliate program by sharing your contact details, social media profiles, and what your content is about."}
      </p>

      {partner.status === "pending" ? (
        <div className="mt-4 max-w-xl space-y-3 rounded-xl border border-black/10 bg-black/[0.02] p-4 text-sm text-ink-muted">
          <p className="font-medium text-black">
            Your application is currently in review. Once approved, your promo code and affiliate link will appear here.
          </p>
          {partner.full_name || partner.email ? (
            <div className="grid gap-1 text-xs text-ink-subtle sm:grid-cols-2">
              {partner.full_name ? (
                <p>
                  <span className="font-medium text-black">Name:</span> {partner.full_name}
                </p>
              ) : null}
              {partner.email ? (
                <p>
                  <span className="font-medium text-black">Email:</span> {partner.email}
                </p>
              ) : null}
            </div>
          ) : null}
          {partner.social_links && partner.social_links.length > 0 ? (
            <div className="space-y-1 text-xs">
              <p className="font-medium text-black">Social profiles</p>
              <ul className="space-y-0.5 text-ink-subtle">
                {partner.social_links.map((item) => (
                  <li key={item} className="flex items-center gap-1.5 break-all">
                    <ExternalLink className="h-3 w-3 shrink-0 text-ink-faint" aria-hidden />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {partner.audience ? (
            <div className="space-y-1 text-xs">
              <p className="font-medium text-black">About your audience &amp; content</p>
              <p className="whitespace-pre-wrap text-ink-subtle">{partner.audience}</p>
            </div>
          ) : null}
        </div>
      ) : !approved ? (
        partner.applications_open ? (
          <ApplyForm partner={partner} defaultName={defaultName} defaultEmail={defaultEmail} onChanged={onChanged} />
        ) : (
          <p className="mt-4 rounded-xl border border-black/10 bg-black/[0.02] px-4 py-3 text-sm text-ink-muted">
            Affiliate applications are closed right now.
          </p>
        )
      ) : (
        <div className="mt-4 space-y-4">
          {partner.status === "suspended" ? (
            <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              Your affiliate access is currently paused. Contact support if you think this is a mistake.
            </p>
          ) : (
            <>
              <div className="grid gap-3 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
                {shareLink ? <CopyField label="Your affiliate link" value={shareLink} /> : null}
                {partner.code ? <CopyField label="Your promo code" value={partner.code} /> : null}
              </div>
              <p className="rounded-xl border border-meta-500/20 bg-meta-50 px-4 py-3 text-xs leading-relaxed text-meta-900">
                Tell your clients to click <span className="font-semibold">Subscribe</span> on one of our plans and enter{" "}
                <span className="font-mono font-semibold text-black">{partner.code || "your promo code"}</span> directly on the
                Whop checkout page.
              </p>
            </>
          )}
        </div>
      )}
    </NeonCard>
  );
}

export default PartnerCard;
