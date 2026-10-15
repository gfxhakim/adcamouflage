"use client";

import { Loader2, Megaphone, Save, Settings2, Tags } from "lucide-react";
import { useEffect, useState } from "react";

import NeonCard from "@/components/NeonCard";
import { editPlan, getSettings, updateSettings, type AppSettings, type PlanInfo } from "@/lib/admin";

interface SettingsTabProps {
  plans: PlanInfo[];
  onPlansChanged: () => void;
}

interface PlanDraft {
  label: string;
  price: string;
  quota: string;
  unlimited: boolean;
}

function draftOf(plan: PlanInfo): PlanDraft {
  return {
    label: plan.label,
    price: String(plan.price),
    quota: plan.monthly_quota === null ? "" : String(plan.monthly_quota),
    unlimited: plan.monthly_quota === null,
  };
}

function Feedback({ error, notice }: { error: string | null; notice: string | null }) {
  if (error) return <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>;
  if (notice) return <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">{notice}</p>;
  return null;
}

export function SettingsTab({ plans, onPlansChanged }: SettingsTabProps) {
  const [current, setCurrent] = useState<AppSettings | null>(null);
  const [form, setForm] = useState<AppSettings | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [drafts, setDrafts] = useState<Record<string, PlanDraft>>({});
  const [planBusy, setPlanBusy] = useState<string | null>(null);
  const [planError, setPlanError] = useState<string | null>(null);
  const [planNotice, setPlanNotice] = useState<string | null>(null);

  useEffect(() => {
    getSettings()
      .then((data) => {
        setCurrent(data);
        setForm(data);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Could not load settings."));
  }, []);

  useEffect(() => {
    setDrafts(Object.fromEntries(plans.map((p) => [p.id, draftOf(p)])));
  }, [plans]);

  const save = async () => {
    if (!form) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const saved = await updateSettings({
        registration_open: form.registration_open,
        default_plan: form.default_plan,
        announcement: form.announcement,
        currency: form.currency,
      });
      setCurrent(saved);
      setForm(saved);
      setNotice("Settings saved.");
      onPlansChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save settings.");
    } finally {
      setBusy(false);
    }
  };

  const savePlan = async (plan: PlanInfo) => {
    const draft = drafts[plan.id];
    if (!draft) return;
    const price = Number.parseFloat(draft.price);
    const quota = draft.unlimited ? null : Number.parseInt(draft.quota, 10);
    if (Number.isNaN(price) || price < 0) {
      setPlanError("Enter a price of 0 or more.");
      return;
    }
    if (!draft.unlimited && (quota === null || Number.isNaN(quota) || quota < 0)) {
      setPlanError("Enter a monthly file limit of 0 or more, or tick Unlimited.");
      return;
    }
    setPlanBusy(plan.id);
    setPlanError(null);
    setPlanNotice(null);
    try {
      await editPlan(plan.id, { label: draft.label.trim() || plan.label, price, monthly_quota: quota, apply_to_users: true });
      setPlanNotice(`${draft.label} saved. Users on its standard limit were moved to the new one.`);
      onPlansChanged();
    } catch (err) {
      setPlanError(err instanceof Error ? err.message : "Could not save the plan.");
    } finally {
      setPlanBusy(null);
    }
  };

  if (!form || !current) {
    return (
      <div className="grid place-items-center py-24 text-ink-faint">
        {error ? <p className="text-sm text-red-600">{error}</p> : <Loader2 className="h-5 w-5 animate-spin" aria-hidden />}
      </div>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
      <NeonCard padding="lg" radius="xl">
        <div className="mb-4 flex items-center gap-2">
          <Settings2 className="h-4 w-4 text-meta-500" aria-hidden />
          <h2 className="text-sm font-semibold tracking-tight text-black">App settings</h2>
        </div>

        <div className="space-y-5">
          <label className="flex items-start justify-between gap-4">
            <span>
              <span className="block text-sm font-semibold text-black">Allow new sign-ups</span>
              <span className="block text-xs text-ink-faint">
                {current.registration_locked
                  ? "Locked off by ADCAM_ALLOW_REGISTRATION on the server."
                  : "Turn off to stop new accounts. You can still add users by hand."}
              </span>
            </span>
            <input
              type="checkbox"
              className="mt-1 h-5 w-5 shrink-0 accent-meta-500"
              checked={form.registration_open}
              disabled={current.registration_locked}
              onChange={(e) => setForm({ ...form, registration_open: e.target.checked })}
            />
          </label>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="label">New users start on</span>
              <select className="field mt-1" value={form.default_plan} onChange={(e) => setForm({ ...form, default_plan: e.target.value })}>
                {plans.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="label">Currency</span>
              <select className="field mt-1" value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })}>
                {Array.from(new Set(["USD", "EUR", "GBP", "MAD", "AED", "SAR", "CAD", form.currency])).map((code) => (
                  <option key={code} value={code}>
                    {code}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label className="block">
            <span className="label flex items-center gap-1.5">
              <Megaphone className="h-3.5 w-3.5" aria-hidden />
              Announcement banner
            </span>
            <textarea
              className="field mt-1 min-h-[84px] resize-y"
              maxLength={500}
              placeholder="e.g. Scheduled maintenance tonight at 23:00. Leave empty for no banner."
              value={form.announcement}
              onChange={(e) => setForm({ ...form, announcement: e.target.value })}
            />
            <span className="mt-1 block text-[11px] text-ink-faint">Shown at the top of every user&apos;s workspace.</span>
          </label>

          <Feedback error={error} notice={notice} />

          <button type="button" className="btn-primary" disabled={busy} onClick={save}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Save className="h-4 w-4" aria-hidden />}
            Save settings
          </button>
        </div>
      </NeonCard>

      <NeonCard padding="lg" radius="xl" tone="slow">
        <div className="mb-1 flex items-center gap-2">
          <Tags className="h-4 w-4 text-meta-500" aria-hidden />
          <h2 className="text-sm font-semibold tracking-tight text-black">Plans &amp; prices</h2>
        </div>
        <p className="mb-4 text-xs text-ink-faint">
          Prices drive the revenue figures. Changing a limit also moves everyone on that plan&apos;s standard limit;
          users you gave a custom number keep it.
        </p>

        <div className="space-y-3">
          {plans.map((plan) => {
            const draft = drafts[plan.id];
            if (!draft) return null;
            const set = (patch: Partial<PlanDraft>) => setDrafts({ ...drafts, [plan.id]: { ...draft, ...patch } });
            return (
              <div key={plan.id} className="rounded-xl border border-black/[0.08] p-3">
                <div className="mb-2 flex items-center justify-between text-xs text-ink-faint">
                  <span className="font-mono">{plan.id}</span>
                  <span>
                    {plan.users} {plan.users === 1 ? "user" : "users"}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-[1.2fr_0.8fr_1fr_auto]">
                  <label className="col-span-2 block sm:col-span-1">
                    <span className="label">Name</span>
                    <input className="field mt-1" value={draft.label} maxLength={40} onChange={(e) => set({ label: e.target.value })} />
                  </label>
                  <label className="block">
                    <span className="label">Price/month</span>
                    <input
                      className="field mt-1"
                      type="number"
                      min={0}
                      step="0.01"
                      inputMode="decimal"
                      value={draft.price}
                      onChange={(e) => set({ price: e.target.value })}
                    />
                  </label>
                  <label className="block">
                    <span className="label">Files/month</span>
                    <input
                      className="field mt-1 disabled:bg-black/[0.03]"
                      type="number"
                      min={0}
                      inputMode="numeric"
                      value={draft.unlimited ? "" : draft.quota}
                      placeholder={draft.unlimited ? "Unlimited" : ""}
                      disabled={draft.unlimited}
                      onChange={(e) => set({ quota: e.target.value })}
                    />
                  </label>
                  <div className="col-span-2 flex items-end justify-between gap-2 sm:col-span-1">
                    <label className="flex items-center gap-1.5 pb-2 text-xs text-black">
                      <input
                        type="checkbox"
                        className="h-4 w-4 accent-meta-500"
                        checked={draft.unlimited}
                        onChange={(e) => set({ unlimited: e.target.checked })}
                      />
                      Unlimited
                    </label>
                    <button type="button" className="btn-ghost !px-3" disabled={planBusy !== null} onClick={() => void savePlan(plan)}>
                      {planBusy === plan.id ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Save className="h-4 w-4" aria-hidden />}
                      Save
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
          <Feedback error={planError} notice={planNotice} />
        </div>
      </NeonCard>
    </div>
  );
}

export default SettingsTab;
