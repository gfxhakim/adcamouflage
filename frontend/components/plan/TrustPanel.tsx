import { EyeOff, FileX2, KeyRound, Lock, ShieldCheck, Wallet, type LucideIcon } from "lucide-react";

const POINTS: { icon: LucideIcon; title: string; body: (hours: number) => string }[] = [
  {
    icon: Lock,
    title: "Private to your account",
    body: () => "Only you can see your uploads, outputs and history. Download links are signed and expire.",
  },
  {
    icon: FileX2,
    title: "Auto-deleted",
    body: (hours) => `Every upload and output is erased from our servers ${hours} hours after it is processed.`,
  },
  {
    icon: EyeOff,
    title: "Metadata stripped",
    body: () => "Camera, editor and location tags are removed from your files by default.",
  },
  {
    icon: KeyRound,
    title: "Secure sign-in",
    body: () => "Passwords are stored hashed, and changing yours signs out every other device.",
  },
  {
    icon: Wallet,
    title: "No card on file",
    body: () => "We never store payment details. Plan changes are handled by our team on request.",
  },
  {
    icon: ShieldCheck,
    title: "Fair usage, clearly counted",
    body: () => "Each file and each extra variant counts as one. Your allowance resets on the 1st of every month.",
  },
];

/** The promises behind the service, in plain words. */
export function TrustPanel({ retentionHours }: { retentionHours: number }) {
  return (
    <ul className="grid gap-4 sm:grid-cols-2">
      {POINTS.map(({ icon: Icon, title, body }) => (
        <li key={title} className="flex items-start gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-meta-500/20 bg-meta-50 text-meta-600">
            <Icon className="h-4 w-4" aria-hidden />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-black">{title}</p>
            <p className="mt-0.5 text-xs leading-relaxed text-ink-muted">{body(retentionHours)}</p>
          </div>
        </li>
      ))}
    </ul>
  );
}

export default TrustPanel;
