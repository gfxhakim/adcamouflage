import Link from "next/link";
import type { ReactNode } from "react";

/**
 * Renders the small Markdown subset guides use, as plain React elements (no
 * raw HTML, so text saved in Admin can never inject markup or script):
 * ## / ### headings, paragraphs, - / 1. lists, > quotes, **bold**, *italic*,
 * `code` and [links](url).
 */

type Block =
  | { kind: "h2" | "h3" | "p" | "quote"; text: string }
  | { kind: "ul" | "ol"; items: string[] };

export function parseBlocks(source: string): Block[] {
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  let list: { kind: "ul" | "ol"; items: string[] } | null = null;

  const flush = () => {
    if (paragraph.length) blocks.push({ kind: "p", text: paragraph.join(" ") });
    paragraph = [];
    if (list) blocks.push(list);
    list = null;
  };

  for (const raw of source.replace(/\r\n/g, "\n").split("\n")) {
    const line = raw.trim();
    if (!line) {
      flush();
      continue;
    }
    const heading = /^(#{2,3})\s+(.*)$/.exec(line);
    if (heading) {
      flush();
      blocks.push({ kind: heading[1].length === 2 ? "h2" : "h3", text: heading[2] });
      continue;
    }
    if (/^#\s+/.test(line)) {
      // The page title is the only h1; a "# " line becomes a section heading.
      flush();
      blocks.push({ kind: "h2", text: line.replace(/^#\s+/, "") });
      continue;
    }
    const bullet = /^[-*]\s+(.*)$/.exec(line);
    const numbered = /^\d+[.)]\s+(.*)$/.exec(line);
    if (bullet || numbered) {
      const kind = bullet ? "ul" : "ol";
      if (paragraph.length) {
        blocks.push({ kind: "p", text: paragraph.join(" ") });
        paragraph = [];
      }
      if (!list || list.kind !== kind) {
        if (list) blocks.push(list);
        list = { kind, items: [] };
      }
      list.items.push((bullet || numbered)![1]);
      continue;
    }
    if (line.startsWith(">")) {
      flush();
      blocks.push({ kind: "quote", text: line.replace(/^>\s?/, "") });
      continue;
    }
    if (list) {
      // A wrapped list line continues the last item.
      list.items[list.items.length - 1] += ` ${line}`;
      continue;
    }
    paragraph.push(line);
  }
  flush();
  return blocks;
}

function safeHref(href: string): string | null {
  const value = href.trim();
  if (value.startsWith("/") || value.startsWith("#") || /^https?:\/\//i.test(value) || /^mailto:/i.test(value)) return value;
  return null;
}

const INLINE = /(\*\*[^*]+\*\*|\*[^*\s][^*]*\*|`[^`]+`|\[[^\]]+\]\([^)\s]+\))/g;

export function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let index = 0;
  for (const match of text.matchAll(INLINE)) {
    const token = match[0];
    const at = match.index ?? 0;
    if (at > last) out.push(text.slice(last, at));
    const key = `i${index++}`;
    if (token.startsWith("**")) out.push(<strong key={key}>{token.slice(2, -2)}</strong>);
    else if (token.startsWith("`")) out.push(<code key={key}>{token.slice(1, -1)}</code>);
    else if (token.startsWith("[")) {
      const [, label, href] = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(token) ?? [];
      const safe = href ? safeHref(href) : null;
      if (!safe) out.push(label ?? token);
      else if (safe.startsWith("/")) out.push(<Link key={key} href={safe}>{label}</Link>);
      else out.push(<a key={key} href={safe} rel="noopener" target={safe.startsWith("#") ? undefined : "_blank"}>{label}</a>);
    } else out.push(<em key={key}>{token.slice(1, -1)}</em>);
    last = at + token.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** Plain text of a guide body (for meta descriptions and structured data). */
export function plainText(source: string): string {
  return parseBlocks(source)
    .map((b) => ("text" in b ? b.text : b.items.join(" ")))
    .join(" ")
    .replace(/\*\*|`|\*/g, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
}

export default function Markdown({ source }: { source: string }) {
  return (
    <>
      {parseBlocks(source).map((block, i) => {
        switch (block.kind) {
          case "h2":
            return <h2 key={i}>{inline(block.text)}</h2>;
          case "h3":
            return <h3 key={i}>{inline(block.text)}</h3>;
          case "quote":
            return <blockquote key={i}>{inline(block.text)}</blockquote>;
          case "ul":
            return <ul key={i}>{block.items.map((item, j) => <li key={j}>{inline(item)}</li>)}</ul>;
          case "ol":
            return <ol key={i}>{block.items.map((item, j) => <li key={j}>{inline(item)}</li>)}</ol>;
          default:
            return <p key={i}>{inline(block.text)}</p>;
        }
      })}
    </>
  );
}
