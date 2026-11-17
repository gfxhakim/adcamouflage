"use client";

import { Loader2, Search, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { listUsers, type AdminUser } from "@/lib/admin";

interface UserSearchProps {
  onSelectUser: (id: number) => void;
  /** Opens the full Users page, searching for the same words. */
  onOpenUsers: (query: string) => void;
}

/** The small tag on the right of a result: what kind of account it is. */
function accountTag(user: AdminUser): { text: string; tone: string } {
  if (!user.is_active) return { text: "Suspended", tone: "border-red-500/40 text-red-300" };
  if (user.is_admin) return { text: "Admin", tone: "border-amber-500/40 text-amber-300" };
  if (user.billing_mode === "tokens") {
    return user.subscription_active && user.sub_plan
      ? { text: user.sub_plan.replace(/^\w/, (c) => c.toUpperCase()), tone: "border-meta-500/50 text-meta-200" }
      : { text: "No plan", tone: "border-white/10 text-slate-400" };
  }
  return { text: user.plan_label, tone: "border-white/10 text-slate-300" };
}

/** Dashboard search: find a customer by name or email and open their panel. */
export default function UserSearch({ onSelectUser, onOpenUsers }: UserSearchProps) {
  const [query, setQuery] = useState("");
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(0);
  const box = useRef<HTMLDivElement>(null);

  const q = query.trim();

  useEffect(() => {
    if (!q) {
      setUsers([]);
      setTotal(0);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const page = await listUsers({ q, plan: "", state: "", sort: "newest" }, 0, 8);
        if (cancelled) return;
        setUsers(page.users);
        setTotal(page.total);
        setCursor(0);
        setFailed(false);
      } catch {
        if (!cancelled) setFailed(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [q]);

  useEffect(() => {
    const onDown = (ev: MouseEvent) => {
      if (box.current && !box.current.contains(ev.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  const pick = (id: number) => {
    setOpen(false);
    onSelectUser(id);
  };

  return (
    <div ref={box} className="relative mb-6">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" aria-hidden />
        <input
          type="search"
          className="field !h-12 !rounded-xl !pl-10 !pr-10 text-sm [&::-webkit-search-cancel-button]:hidden"
          placeholder="Search a user by name or email..."
          aria-label="Search a user by name or email"
          value={query}
          onFocus={() => setOpen(true)}
          onChange={(ev) => {
            setQuery(ev.target.value);
            setOpen(true);
          }}
          onKeyDown={(ev) => {
            if (ev.key === "Escape") setOpen(false);
            if (ev.key === "ArrowDown") {
              ev.preventDefault();
              setCursor((c) => Math.min(c + 1, users.length - 1));
            }
            if (ev.key === "ArrowUp") {
              ev.preventDefault();
              setCursor((c) => Math.max(c - 1, 0));
            }
            if (ev.key === "Enter" && users[cursor]) pick(users[cursor].id);
          }}
        />
        {loading ? (
          <Loader2 className="absolute right-3.5 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-slate-500" aria-hidden />
        ) : query ? (
          <button
            type="button"
            className="absolute right-2.5 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-md text-slate-500 hover:text-slate-100"
            onClick={() => setQuery("")}
            aria-label="Clear search"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        ) : null}
      </div>

      {open && q ? (
        <div className="absolute inset-x-0 top-full z-30 mt-2 overflow-hidden rounded-xl border border-white/10 bg-[#0c111d] shadow-2xl">
          {failed ? (
            <p className="px-4 py-3 text-xs text-red-300">Could not search right now. Try again.</p>
          ) : users.length === 0 ? (
            <p className="px-4 py-3 text-xs text-slate-400">
              {loading ? "Searching..." : `No user has "${q}" in their name or email.`}
            </p>
          ) : (
            <ul role="listbox" aria-label="Users found">
              {users.map((user, index) => {
                const tag = accountTag(user);
                return (
                  <li key={user.id} role="option" aria-selected={index === cursor}>
                    <button
                      type="button"
                      onMouseEnter={() => setCursor(index)}
                      onClick={() => pick(user.id)}
                      className={`flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                        index === cursor ? "bg-meta-500/15" : ""
                      }`}
                    >
                      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-meta-500/20 text-xs font-bold uppercase text-meta-200">
                        {(user.display_name || user.email).slice(0, 1)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold text-slate-100">
                          {user.display_name || user.email.split("@")[0]}
                        </span>
                        <span className="block truncate font-mono text-[11px] text-slate-400">{user.email}</span>
                      </span>
                      <span className={`shrink-0 rounded-full border px-2 py-0.5 font-mono text-[10px] ${tag.tone}`}>{tag.text}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {total > users.length ? (
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                onOpenUsers(q);
              }}
              className="block w-full border-t border-white/10 px-4 py-2.5 text-left text-xs font-semibold text-meta-300 hover:bg-white/5"
            >
              {total} users match. Open the Users page to see all
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
