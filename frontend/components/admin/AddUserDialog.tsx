"use client";

import { Loader2, UserPlus, X } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";

import SecretBox from "@/components/admin/SecretBox";
import NeonCard from "@/components/NeonCard";
import { createUser, type PlanInfo } from "@/lib/admin";

interface AddUserDialogProps {
  plans: PlanInfo[];
  onClose: () => void;
  onCreated: () => void;
}

/** Create an account for a customer by hand, e.g. after they pay you directly. */
export function AddUserDialog({ plans, onClose, onCreated }: AddUserDialogProps) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [plan, setPlan] = useState(plans.find((p) => p.price > 0)?.id ?? plans[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [password, setPassword] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const created = await createUser({ email, display_name: name || undefined, plan });
      setPassword(created.temporary_password);
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the account.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-4" role="dialog" aria-modal="true" aria-label="Add user">
      <button type="button" className="absolute inset-0 bg-black/30 backdrop-blur-[2px]" aria-label="Close" onClick={onClose} />
      <NeonCard padding="lg" radius="xl" className="relative w-full max-w-md">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold text-black">Add a user</h2>
          <button type="button" onClick={onClose} className="btn-ghost !p-2" aria-label="Close">
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>

        {password ? (
          <div className="space-y-4">
            <p className="text-sm text-black">
              <span className="font-semibold">{email}</span> can sign in now with this password:
            </p>
            <SecretBox value={password} note="It is shown only once. Send it to them and ask them to change it after signing in." />
            <button type="button" className="btn-primary w-full" onClick={onClose}>
              Done
            </button>
          </div>
        ) : (
          <form className="space-y-3" onSubmit={submit}>
            <label className="block">
              <span className="label">Email</span>
              <input
                type="email"
                required
                className="field mt-1"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoFocus
              />
            </label>
            <label className="block">
              <span className="label">Name (optional)</span>
              <input className="field mt-1" value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            <label className="block">
              <span className="label">Plan</span>
              <select className="field mt-1" value={plan} onChange={(e) => setPlan(e.target.value)}>
                {plans.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>
            {error ? <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p> : null}
            <button type="submit" className="btn-primary w-full" disabled={busy}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <UserPlus className="h-4 w-4" aria-hidden />}
              Create account
            </button>
            <p className="text-[11px] text-ink-faint">A temporary password is created for them and shown once.</p>
          </form>
        )}
      </NeonCard>
    </div>
  );
}

export default AddUserDialog;
