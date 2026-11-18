"use client";

import { assessPassword } from "@/lib/authValidation";

/** Live strength & memorability bar shared by sign-up, password reset, and settings. */
export function PasswordStrengthMeter({
  password,
  email = "",
}: {
  password: string;
  email?: string;
}) {
  const assessment = assessPassword(password, email);
  const barColors = [
    "bg-line-strong",
    "bg-red-500",
    "bg-amber-500",
    "bg-emerald-600",
  ];

  return (
    <div className="mt-2 space-y-1.5" aria-live="polite">
      <div className="flex items-center gap-1.5">
        {[1, 2, 3].map((step) => (
          <span
            key={step}
            className={`h-1 flex-1 rounded-full transition-colors duration-200 ${
              assessment.score >= step ? barColors[assessment.score] : "bg-ink/10"
            }`}
          />
        ))}
        <span
          className={`ml-1 text-[11px] font-medium ${
            assessment.level === "strong"
              ? "text-emerald-700"
              : assessment.level === "weak"
                ? "text-red-600"
                : assessment.level === "fair"
                  ? "text-amber-700"
                  : "text-ink-muted"
          }`}
        >
          {assessment.label}
        </span>
      </div>
      <p className="text-xs leading-snug text-ink-muted">{assessment.hint}</p>
    </div>
  );
}
