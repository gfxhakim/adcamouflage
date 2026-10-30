"use client";

import { useEffect, useRef } from "react";

import { textStyleCss, useCms } from "@/components/cms/ContentProvider";

/**
 * Makes every visible label on a page editable without wrapping each one in
 * code: it finds the page's text (and placeholder/tooltip text), keys each
 * distinct string as "ui.<hash>", and applies the admin's replacement text,
 * style or "hide" to it. The same wording is changed everywhere it appears.
 *
 * Runs after React has rendered and re-applies whenever React changes the
 * page, so it never fights hydration. Anything inside [data-cms-skip] (file
 * names, user data) and form fields is left alone.
 */

const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEXTAREA", "CODE", "PRE", "OPTION", "SVG"]);
const ATTRS = ["placeholder", "title"] as const;

function hash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

export function uiKey(text: string): string {
  return `ui.${hash(text.trim())}`;
}

function eligible(text: string): boolean {
  const t = text.trim();
  return t.length >= 2 && t.length <= 600 && /\p{L}{2,}/u.test(t);
}

function skipped(el: Element | null): boolean {
  for (let node = el; node; node = node.parentElement) {
    if (SKIP_TAGS.has(node.tagName.toUpperCase())) return true;
    if (node.hasAttribute("data-cms-skip") || node.hasAttribute("data-cms") || (node as HTMLElement).isContentEditable) return true;
  }
  return false;
}

export function AutoText({ group }: { group: (path: string) => string }) {
  const cms = useCms();
  const cmsRef = useRef(cms);
  cmsRef.current = cms;
  const groupRef = useRef(group);
  groupRef.current = group;

  // Original strings and styles, so an override can be taken back.
  const originals = useRef(new WeakMap<Text, string>());
  const attrOriginals = useRef(new WeakMap<Element, Record<string, string>>());
  const styleOriginals = useRef(new WeakMap<HTMLElement, string>());
  const pass = useRef<() => void>(() => undefined);

  useEffect(() => {
    let frame = 0;
    let applying = false;

    const run = () => {
      const { content, preview, register, mark } = cmsRef.current;
      const text = content.text ?? {};
      const hide = content.hide ?? {};
      const styles = content.style ?? {};
      const page = groupRef.current(window.location.pathname);
      applying = true;

      const styleParent = (el: HTMLElement | null, key: string) => {
        if (!el) return;
        const css = textStyleCss(styles[key]);
        const off = !!hide[key];
        if (!styleOriginals.current.has(el) && (css || off)) styleOriginals.current.set(el, el.style.cssText);
        if (styleOriginals.current.has(el)) {
          el.style.cssText = styleOriginals.current.get(el) ?? "";
          if (css) Object.assign(el.style, css);
          if (off) el.style.display = "none";
        }
        if (preview) {
          const attrs = mark(key);
          if (attrs["data-cms"]) el.setAttribute("data-cms-auto", key);
        }
      };

      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
        const parent = node.parentElement;
        const current = node.nodeValue ?? "";
        let original = originals.current.get(node);
        if (original === undefined) {
          if (!eligible(current) || skipped(parent)) continue;
          original = current;
          originals.current.set(node, original);
        } else {
          const key = uiKey(original);
          const shown = text[key] !== undefined ? original.replace(original.trim(), text[key]) : original;
          // React changed this text since we last looked: that is the new original.
          if (current !== shown && current !== original) {
            if (!eligible(current)) {
              originals.current.delete(node);
              continue;
            }
            original = current;
            originals.current.set(node, original);
          }
        }
        const trimmed = original.trim();
        const key = uiKey(trimmed);
        register({ key, type: trimmed.length > 80 ? "longtext" : "text", fallback: trimmed, group: page });
        const wanted = text[key] !== undefined ? original.replace(trimmed, text[key]) : original;
        if (node.nodeValue !== wanted) node.nodeValue = wanted;
        styleParent(parent, key);
      }

      for (const attr of ATTRS) {
        document.body.querySelectorAll<HTMLElement>(`[${attr}]`).forEach((el) => {
          if (skipped(el.matches("input, textarea, select") ? el.parentElement : el)) return;
          const saved = attrOriginals.current.get(el) ?? {};
          const current = el.getAttribute(attr) ?? "";
          let original = saved[attr];
          if (original === undefined || (current !== original && current !== (text[uiKey(original)] ?? original))) {
            if (!eligible(current)) return;
            original = current;
            attrOriginals.current.set(el, { ...saved, [attr]: original });
          }
          const key = uiKey(original);
          register({ key, type: "text", fallback: original.trim(), label: `${attr === "title" ? "Tooltip" : "Placeholder"}: ${original.trim()}`, group: page });
          const wanted = text[key] ?? original;
          if (current !== wanted) el.setAttribute(attr, wanted);
        });
      }
      applying = false;
    };

    pass.current = run;
    const schedule = () => {
      if (applying || frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        run();
      });
    };
    run();
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: [...ATTRS] });
    return () => {
      observer.disconnect();
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, []);

  // New content (the editor typing in the preview): apply it right away.
  useEffect(() => {
    pass.current();
  }, [cms.content, cms.preview]);

  return null;
}

export default AutoText;
