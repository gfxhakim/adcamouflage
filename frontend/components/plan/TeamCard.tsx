"use client";

import clsx from "clsx";
import { Loader2, LogOut, UserPlus, Users, X } from "lucide-react";
import { useState, type FormEvent } from "react";

import NeonCard from "@/components/NeonCard";
import { addTeamMember, leaveTeam, removeTeamMember, type Team } from "@/lib/auth";
import { timeAgo } from "@/lib/format";

interface TeamCardProps {
  team: Team;
  /** Called with the new team after a change, so the page can refresh its billing data. */
  onChanged: (team: Team) => void;
}

/**
 * Team seats on the plan page. An owner on a multi-user plan adds people by
 * email and they share the plan's tokens; a member sees whose plan they are on.
 */
export function TeamCard({ team, onChanged }: TeamCardProps) {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (key: string, action: () => Promise<Team>) => {
    setBusy(key);
    setError(null);
    try {
      onChanged(await action());
      if (key === "add") setEmail("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(null);
    }
  };

  const add = (event: FormEvent) => {
    event.preventDefault();
    if (email.trim()) void run("add", () => addTeamMember(email.trim()));
  };

  if (team.role === "member") {
    return (
      <NeonCard padding="lg" radius="xl">
        <div className="mb-3 flex items-center gap-2">
          <Users className="h-4 w-4 text-meta-500" aria-hidden />
          <h2 className="text-sm font-semibold tracking-tight text-black">Your team</h2>
        </div>
        <p className="text-sm text-ink-muted">
          You are on <span className="font-medium text-black">{team.owner_email ?? "a team"}</span>&apos;s plan.{" "}
          {team.sharing
            ? "Your generations use the team's shared tokens."
            : "Their plan has no free seat for you right now, so nothing is shared until one opens up."}
        </p>
        {error ? <p className="mt-3 text-xs text-red-600">{error}</p> : null}
        <button
          type="button"
          className="btn-ghost mt-4 !py-2 !text-xs"
          disabled={busy !== null}
          onClick={() => void run("leave", leaveTeam)}
        >
          {busy === "leave" ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <LogOut className="h-3.5 w-3.5" aria-hidden />}
          Leave team
        </button>
      </NeonCard>
    );
  }

  if (team.role !== "owner") return null;
  const full = team.seats_used >= team.seats;

  return (
    <NeonCard padding="lg" radius="xl">
      <div className="mb-1 flex items-center gap-2">
        <Users className="h-4 w-4 text-meta-500" aria-hidden />
        <h2 className="text-sm font-semibold tracking-tight text-black">Team</h2>
        <span className="chip ml-auto !text-[10px]">
          {team.seats_used} / {team.seats} users
        </span>
      </div>
      <p className="mb-4 text-xs text-ink-faint">
        Add people by email. They sign in with their own account and share this plan&apos;s tokens. Someone who has not
        signed up yet joins as soon as they create an account with that email.
      </p>

      <ul className="divide-y divide-black/[0.06]">
        <li className="flex items-center justify-between gap-3 py-2.5 text-sm">
          <span className="font-medium text-black">You</span>
          <span className="chip !text-[10px]">Owner</span>
        </li>
        {team.members.map((member) => (
          <li key={member.email} className="flex items-center justify-between gap-3 py-2.5 text-sm">
            <span className="min-w-0">
              <span className="block truncate font-medium text-black">{member.display_name || member.email}</span>
              <span className="block truncate text-xs text-ink-faint">
                {member.display_name ? `${member.email} · ` : ""}
                {!member.joined
                  ? "Not signed up yet"
                  : member.last_seen_at
                    ? `Active ${timeAgo(member.last_seen_at)}`
                    : "Joined"}
                {member.sharing ? "" : " · no free seat"}
              </span>
            </span>
            <button
              type="button"
              className={clsx(
                "grid h-7 w-7 shrink-0 place-items-center rounded-full text-ink-subtle transition-colors hover:bg-red-50 hover:text-red-600",
                busy !== null && "opacity-50",
              )}
              disabled={busy !== null}
              aria-label={`Remove ${member.email}`}
              onClick={() => void run(member.email, () => removeTeamMember(member.email))}
            >
              {busy === member.email ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <X className="h-3.5 w-3.5" aria-hidden />}
            </button>
          </li>
        ))}
      </ul>

      <form onSubmit={add} className="mt-4 flex flex-col gap-2 sm:flex-row">
        <input
          className="field flex-1"
          type="email"
          placeholder={full ? "All seats are in use" : "teammate@company.com"}
          value={email}
          disabled={full || busy !== null}
          onChange={(e) => setEmail(e.target.value)}
          aria-label="Teammate email"
        />
        <button type="submit" className="btn-primary !py-2 !text-xs" disabled={full || busy !== null || !email.trim()}>
          {busy === "add" ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <UserPlus className="h-3.5 w-3.5" aria-hidden />}
          Add member
        </button>
      </form>
      {error ? <p className="mt-3 text-xs text-red-600">{error}</p> : null}
    </NeonCard>
  );
}

export default TeamCard;
