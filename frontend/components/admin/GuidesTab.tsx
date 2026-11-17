"use client";

import { ExternalLink, Eye, EyeOff, Loader2, Plus, RotateCcw, Save, Trash2, Upload } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import NeonCard from "@/components/NeonCard";
import { deleteSavedGuide, listSavedGuides, saveGuide, type GuideEdit, type SavedGuide } from "@/lib/admin";
import { BUILT_IN_GUIDES } from "@/lib/guides";
import { contentAdmin } from "@/lib/siteContent";

interface Row extends GuideEdit {
  slug: string;
  builtin: boolean;
  saved: boolean;
  updated_at?: string;
}

const EMPTY: GuideEdit = { title: "", description: "", body: "", category: "", cover: "", cover_alt: "", published: true };

function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/g, "");
}

/** Admin > Guides: write, edit, hide and delete the public /guides articles. */
export default function GuidesTab() {
  const [saved, setSaved] = useState<SavedGuide[] | null>(null);
  const [selected, setSelected] = useState<string | "new" | null>(null);
  const [form, setForm] = useState<GuideEdit>(EMPTY);
  const [slug, setSlug] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setSaved((await listSavedGuides()).guides);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load the guides.");
      setSaved([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const rows: Row[] = useMemo(() => {
    const bySlug = new Map<string, Row>();
    for (const g of BUILT_IN_GUIDES) {
      bySlug.set(g.slug, {
        slug: g.slug,
        title: g.title,
        description: g.description,
        body: g.body,
        category: g.category ?? "",
        cover: g.cover ?? "",
        cover_alt: g.cover_alt ?? "",
        published: true,
        builtin: true,
        saved: false,
      });
    }
    for (const g of saved ?? []) {
      bySlug.set(g.slug, { ...g, builtin: BUILT_IN_GUIDES.some((b) => b.slug === g.slug), saved: true });
    }
    return Array.from(bySlug.values()).sort((a, b) => a.title.localeCompare(b.title));
  }, [saved]);

  const current = selected && selected !== "new" ? rows.find((r) => r.slug === selected) : undefined;

  function open(row: Row | "new") {
    setError(null);
    setNotice(null);
    if (row === "new") {
      setSelected("new");
      setSlug("");
      setForm(EMPTY);
    } else {
      setSelected(row.slug);
      setSlug(row.slug);
      const { title, description, body, category, cover, cover_alt, published } = row;
      setForm({ title, description, body, category, cover, cover_alt, published });
    }
  }

  async function save() {
    const target = selected === "new" ? slugify(slug || form.title) : (selected as string);
    if (!target) {
      setError("Give the guide a title first.");
      return;
    }
    if (selected === "new" && rows.some((r) => r.slug === target)) {
      setError("A guide with this address already exists. Change the address.");
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await saveGuide(target, form);
      await load();
      setSelected(target);
      setSlug(target);
      setNotice(form.published ? "Saved. The guide is live." : "Saved as hidden. Visitors and Google will not see it.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!current?.saved) return;
    const question = current.builtin
      ? "Undo your edits and go back to the original text of this guide?"
      : "Delete this guide for good? Its page will stop working.";
    if (!window.confirm(question)) return;
    setBusy(true);
    setError(null);
    try {
      await deleteSavedGuide(current.slug);
      await load();
      if (current.builtin) {
        const original = BUILT_IN_GUIDES.find((g) => g.slug === current.slug)!;
        setForm({ ...EMPTY, title: original.title, description: original.description, body: original.body, category: original.category ?? "" });
        setNotice("Back to the original text.");
      } else {
        setSelected(null);
        setNotice("Guide deleted.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete.");
    } finally {
      setBusy(false);
    }
  }

  async function upload(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const { url } = await contentAdmin.upload(file);
      setForm((f) => ({ ...f, cover: url }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setBusy(false);
    }
  }

  const set = (patch: Partial<GuideEdit>) => setForm((f) => ({ ...f, ...patch }));
  const descriptionLength = form.description.length;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
      <NeonCard padding="md" radius="xl" className="h-fit">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-semibold text-slate-100">Guides ({rows.length})</p>
          <button type="button" className="btn-primary !px-3 !py-1.5 text-xs" onClick={() => open("new")}>
            <Plus className="h-3.5 w-3.5" aria-hidden /> New guide
          </button>
        </div>
        <p className="mt-2 text-xs leading-relaxed text-slate-400">
          Helpful articles at <a href="/guides" target="_blank" rel="noreferrer" className="underline">/guides</a>. Google finds them through the sitemap. Write for people: one clear topic per guide, honest and useful.
        </p>
        {saved === null ? (
          <p className="mt-4 flex items-center gap-2 text-xs text-slate-400">
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> Loading…
          </p>
        ) : (
          <ul className="mt-4 space-y-1.5">
            {rows.map((row) => (
              <li key={row.slug}>
                <button
                  type="button"
                  onClick={() => open(row)}
                  className={`w-full rounded-xl border px-3 py-2 text-left text-xs transition ${
                    selected === row.slug ? "border-meta-400 bg-meta-500/10" : "border-white/10 hover:bg-white/[0.04]"
                  }`}
                >
                  <span className="flex items-center gap-1.5 font-semibold text-slate-100">
                    {row.published ? null : <EyeOff className="h-3.5 w-3.5 shrink-0 text-amber-300" aria-label="Hidden" />}
                    <span className="line-clamp-2">{row.title}</span>
                  </span>
                  <span className="mt-0.5 block font-mono text-[10px] text-slate-500">
                    /guides/{row.slug}
                    {row.builtin ? (row.saved ? " · edited" : " · original") : " · yours"}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </NeonCard>

      <NeonCard padding="lg" radius="xl">
        {selected === null ? (
          <p className="text-sm text-slate-400">Pick a guide on the left to edit it, or write a new one.</p>
        ) : (
          <div className="space-y-4">
            <label className="block">
              <span className="label">Title (the headline and the title Google shows)</span>
              <input className="field mt-1" value={form.title} maxLength={140} onChange={(e) => set({ title: e.target.value })} />
              <span className="mt-1 block text-[11px] text-slate-500">{form.title.length}/60 shown in search results</span>
            </label>

            <label className="block">
              <span className="label">Page address</span>
              <div className="mt-1 flex items-center gap-1 font-mono text-xs text-slate-400">
                /guides/
                <input
                  className="field flex-1 font-mono"
                  value={selected === "new" ? slug || slugify(form.title) : slug}
                  disabled={selected !== "new"}
                  maxLength={80}
                  onChange={(e) => setSlug(slugify(e.target.value))}
                />
              </div>
              {selected !== "new" ? (
                <span className="mt-1 block text-[11px] text-slate-500">The address can&apos;t change once saved, so links and Google keep working.</span>
              ) : null}
            </label>

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block">
                <span className="label">Category</span>
                <input className="field mt-1" value={form.category} maxLength={60} placeholder="e.g. Formats" onChange={(e) => set({ category: e.target.value })} />
              </label>
              <label className="flex items-center gap-2 self-end pb-2 text-sm text-slate-200">
                <input type="checkbox" className="h-5 w-5 accent-meta-500" checked={form.published} onChange={(e) => set({ published: e.target.checked })} />
                {form.published ? <Eye className="h-4 w-4" aria-hidden /> : <EyeOff className="h-4 w-4" aria-hidden />}
                Live on the site
              </label>
            </div>

            <label className="block">
              <span className="label">Short description (shown under the title in Google)</span>
              <textarea className="field mt-1 min-h-[72px] resize-y" value={form.description} maxLength={320} onChange={(e) => set({ description: e.target.value })} />
              <span className={`mt-1 block text-[11px] ${descriptionLength > 160 ? "text-amber-300" : "text-slate-500"}`}>
                {descriptionLength}/155 ideal
              </span>
            </label>

            <label className="block">
              <span className="label">Article</span>
              <textarea
                className="field mt-1 min-h-[420px] resize-y font-mono text-[13px] leading-relaxed"
                value={form.body}
                maxLength={60000}
                onChange={(e) => set({ body: e.target.value })}
              />
              <span className="mt-1 block text-[11px] leading-relaxed text-slate-500">
                Leave an empty line between paragraphs. <code>## Heading</code>, <code>### Smaller heading</code>, <code>- list item</code>,{" "}
                <code>1. numbered item</code>, <code>**bold**</code>, <code>*italic*</code>, <code>[link text](/guides/other-guide)</code>.
              </span>
            </label>

            <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
              <label className="block">
                <span className="label">Cover picture (optional)</span>
                <input className="field mt-1" value={form.cover} placeholder="Upload or paste an https:// link" onChange={(e) => set({ cover: e.target.value })} />
              </label>
              <label className="btn-ghost cursor-pointer !px-3">
                <Upload className="h-4 w-4" aria-hidden /> Upload
                <input type="file" accept="image/*" className="sr-only" onChange={(e) => void upload(e.target.files?.[0])} />
              </label>
            </div>
            {form.cover ? (
              <label className="block">
                <span className="label">Describe the picture (for Google Images and screen readers)</span>
                <input className="field mt-1" value={form.cover_alt} maxLength={200} onChange={(e) => set({ cover_alt: e.target.value })} />
              </label>
            ) : null}

            {error ? <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</p> : null}
            {notice ? <p className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300">{notice}</p> : null}

            <div className="flex flex-wrap items-center gap-2">
              <button type="button" className="btn-primary" disabled={busy || form.title.trim().length < 3} onClick={() => void save()}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Save className="h-4 w-4" aria-hidden />} Save
              </button>
              {current && current.published ? (
                <a href={`/guides/${current.slug}`} target="_blank" rel="noreferrer" className="btn-ghost">
                  <ExternalLink className="h-4 w-4" aria-hidden /> View page
                </a>
              ) : null}
              {current?.saved ? (
                <button type="button" className="btn-ghost text-red-300" disabled={busy} onClick={() => void remove()}>
                  {current.builtin ? <RotateCcw className="h-4 w-4" aria-hidden /> : <Trash2 className="h-4 w-4" aria-hidden />}
                  {current.builtin ? "Back to original" : "Delete"}
                </button>
              ) : null}
            </div>
          </div>
        )}
      </NeonCard>
    </div>
  );
}
