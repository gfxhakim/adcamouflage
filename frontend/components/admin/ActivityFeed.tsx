import { Ban, Crown, KeyRound, LogIn, Rocket, ShieldCheck, UserPlus, type LucideIcon } from "lucide-react";

import type { ActivityEvent } from "@/lib/admin";
import { timeAgo } from "@/lib/format";

const KINDS: Record<string, { icon: LucideIcon; tone: string }> = {
  signup: { icon: UserPlus, tone: "text-emerald-600 bg-emerald-50" },
  login: { icon: LogIn, tone: "text-meta-600 dark:text-meta-300 bg-meta-50 dark:bg-meta-500/10" },
  batch: { icon: Rocket, tone: "text-meta-600 dark:text-meta-300 bg-meta-50 dark:bg-meta-500/10" },
  plan_request: { icon: Crown, tone: "text-meta-700 dark:text-meta-300 bg-meta-100 dark:bg-meta-500/20" },
  blocked: { icon: Ban, tone: "text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-500/10" },
  admin: { icon: ShieldCheck, tone: "text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-500/10" },
  password: { icon: KeyRound, tone: "text-ink-muted dark:text-slate-300 bg-black/[0.04] dark:bg-white/[0.04]" },
};

interface ActivityFeedProps {
  events: ActivityEvent[];
  /** Hide the email on each line, e.g. inside one user's panel. */
  hideEmail?: boolean;
  onSelectUser?: (userId: number) => void;
}

export function ActivityFeed({ events, hideEmail = false, onSelectUser }: ActivityFeedProps) {
  if (events.length === 0) {
    return <p className="py-6 text-center text-xs text-ink-faint dark:text-slate-500">No activity yet.</p>;
  }

  return (
    <ul className="divide-y divide-black/[0.06] dark:divide-white/10">
      {events.map((event) => {
        const kind = KINDS[event.kind] ?? KINDS.password;
        const Icon = kind.icon;
        return (
          <li key={event.id} className="flex items-start gap-3 py-2.5">
            <span className={`mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg ${kind.tone}`}>
              <Icon className="h-3.5 w-3.5" aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              {hideEmail ? null : onSelectUser ? (
                <button
                  type="button"
                  onClick={() => onSelectUser(event.user_id)}
                  className="block max-w-full truncate text-left text-xs font-semibold text-black dark:text-slate-100 hover:text-meta-600 dark:hover:text-meta-300"
                >
                  {event.email}
                </button>
              ) : (
                <p className="truncate text-xs font-semibold text-black dark:text-slate-100">{event.email}</p>
              )}
              <p className="text-xs leading-relaxed text-ink-muted dark:text-slate-300 [overflow-wrap:anywhere]">{event.detail.replace(/^\[[^\]]*\]\s*/, "")}</p>
            </div>
            <time
              className="shrink-0 whitespace-nowrap text-[11px] text-ink-faint dark:text-slate-500"
              dateTime={event.created_at}
              title={new Date(event.created_at).toLocaleString()}
            >
              {timeAgo(event.created_at)}
            </time>
          </li>
        );
      })}
    </ul>
  );
}

export default ActivityFeed;
