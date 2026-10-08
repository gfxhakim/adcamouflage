import { Ban, KeyRound, LogIn, Rocket, ShieldCheck, UserPlus, type LucideIcon } from "lucide-react";

import type { ActivityEvent } from "@/lib/admin";
import { timeAgo } from "@/lib/format";

const KINDS: Record<string, { icon: LucideIcon; tone: string }> = {
  signup: { icon: UserPlus, tone: "text-emerald-600 bg-emerald-50" },
  login: { icon: LogIn, tone: "text-meta-600 bg-meta-50" },
  batch: { icon: Rocket, tone: "text-meta-600 bg-meta-50" },
  blocked: { icon: Ban, tone: "text-red-600 bg-red-50" },
  admin: { icon: ShieldCheck, tone: "text-amber-700 bg-amber-50" },
  password: { icon: KeyRound, tone: "text-ink-muted bg-black/[0.04]" },
};

interface ActivityFeedProps {
  events: ActivityEvent[];
  /** Hide the email on each line, e.g. inside one user's panel. */
  hideEmail?: boolean;
  onSelectUser?: (userId: number) => void;
}

export function ActivityFeed({ events, hideEmail = false, onSelectUser }: ActivityFeedProps) {
  if (events.length === 0) {
    return <p className="py-6 text-center text-xs text-ink-faint">No activity yet.</p>;
  }

  return (
    <ul className="divide-y divide-black/[0.06]">
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
                  className="block max-w-full truncate text-left text-xs font-semibold text-black hover:text-meta-600"
                >
                  {event.email}
                </button>
              ) : (
                <p className="truncate text-xs font-semibold text-black">{event.email}</p>
              )}
              <p className="text-xs leading-relaxed text-ink-muted [overflow-wrap:anywhere]">{event.detail}</p>
            </div>
            <time
              className="shrink-0 whitespace-nowrap text-[11px] text-ink-faint"
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
