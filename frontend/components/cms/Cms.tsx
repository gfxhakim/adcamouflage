"use client";

/* eslint-disable @next/next/no-img-element -- admin-supplied media of any size and origin. */
import type { LucideIcon } from "lucide-react";
import Link from "next/link";
import {
  Fragment,
  createElement,
  type CSSProperties,
  type ElementType,
  type ReactNode,
} from "react";

import { ICONS } from "@/components/cms/icons";
import { useCms } from "@/components/cms/ContentProvider";
import { isVideoUrl, type LinkValue, type MediaValue } from "@/lib/siteContent";
import { cn } from "@/lib/utils";

type AnyProps = Record<string, unknown>;

/**
 * Editable text. `children` is the built-in text; the admin can replace it,
 * restyle it or hide it.
 */
export function T({
  k,
  as = "span",
  children,
  long,
  label,
  className,
  style,
  ...rest
}: {
  k: string;
  as?: ElementType;
  children: string;
  long?: boolean;
  label?: string;
  className?: string;
  style?: CSSProperties;
} & AnyProps) {
  const cms = useCms();
  const value = cms.text(k, children, long ? "longtext" : "text", label);
  if (cms.hidden(k)) return null;
  const custom = cms.textStyle(k);
  return createElement(
    as,
    { ...rest, ...cms.mark(k), className, style: custom ? { ...style, ...custom } : style },
    value,
  );
}

/** Plain editable string, for places that need a value rather than an element. */
export function useText(k: string, fallback: string, kind: "text" | "longtext" | "headline" = "text"): string {
  return useCms().text(k, fallback, kind);
}

/** An icon slot: the admin can pick another icon, use an uploaded image, or hide it. */
export function CmsIcon({
  k,
  fallback: Fallback,
  className,
  ...rest
}: {
  k: string;
  fallback: LucideIcon;
  className?: string;
} & AnyProps) {
  const cms = useCms();
  const name = cms.iconName(k, Fallback.displayName ?? "");
  if (cms.hidden(k)) return null;
  if (name && /^(\/|https?:)/.test(name)) {
    return <img src={name} alt="" className={cn("object-contain", className)} {...cms.mark(k)} aria-hidden />;
  }
  const Icon = (name && ICONS[name]) || Fallback;
  return <Icon className={className} {...cms.mark(k)} {...rest} />;
}

function mediaStyle(value: MediaValue, style?: CSSProperties): CSSProperties {
  const css: CSSProperties = { ...style };
  if (value.fit) css.objectFit = value.fit;
  if (value.position) css.objectPosition = value.position;
  if (value.aspect && value.aspect !== "auto") {
    css.aspectRatio = value.aspect.replace("/", " / ");
  }
  if (value.scale && value.scale > 0 && value.scale <= 100) {
    css.width = `${value.scale}%`;
  } else if (value.width) {
    css.width = "100%";
  }
  if (value.width) css.maxWidth = `${value.width}px`;
  if (value.height) css.height = `${value.height}px`;
  if (value.radius !== undefined && value.radius !== null) {
    css.borderRadius = `${value.radius}px`;
  }
  if (value.opacity !== undefined && value.opacity !== null && value.opacity !== 1) {
    css.opacity = value.opacity;
  }
  if (value.background) css.backgroundColor = value.background;
  if (value.padding !== undefined && value.padding !== null && value.padding > 0) {
    css.padding = `${value.padding}px`;
  }
  if (value.frame === "card") {
    css.backgroundColor = value.background || "#0b0f17";
    css.border = "1px solid rgba(255,255,255,0.12)";
    if (!value.padding) css.padding = "12px";
  } else if (value.frame === "glass") {
    css.backgroundColor = value.background || "rgba(255,255,255,0.04)";
    css.border = "1px solid rgba(255,255,255,0.16)";
    if (!value.padding) css.padding = "8px";
  } else if (value.frame === "border") {
    css.border = "1px solid rgba(255,255,255,0.18)";
  } else if (value.frame === "glow") {
    css.border = "1px solid rgba(8,102,255,0.5)";
    css.boxShadow = "0 0 0 1px rgba(8,102,255,0.35), 0 24px 68px -18px rgba(8,102,255,0.55)";
  }
  if (value.shadow && value.shadow !== "none") {
    const shadows: Record<string, string> = {
      sm: "0 8px 20px rgba(0,0,0,0.25)",
      md: "0 18px 42px rgba(0,0,0,0.45)",
      xl: "0 28px 72px rgba(0,0,0,0.7)",
      glow: "0 0 0 1px rgba(8,102,255,0.35), 0 24px 68px -16px rgba(8,102,255,0.6)",
    };
    if (shadows[value.shadow]) css.boxShadow = shadows[value.shadow];
  }
  if (value.align === "center") {
    css.marginLeft = "auto";
    css.marginRight = "auto";
  } else if (value.align === "right") {
    css.marginLeft = "auto";
    css.marginRight = "0";
  } else if (value.align === "left") {
    css.marginLeft = "0";
    css.marginRight = "auto";
  }
  return css;
}

/** Renders an image or video from a resolved media value. */
export function MediaView({
  value,
  className,
  style,
  mark,
  videoRef,
  onError,
  ...rest
}: {
  value: MediaValue;
  className?: string;
  style?: CSSProperties;
  mark?: AnyProps;
  videoRef?: React.Ref<HTMLVideoElement>;
  onError?: () => void;
} & AnyProps) {
  if (!value.src) return null;
  const video = value.kind ? value.kind === "video" : isVideoUrl(value.src);
  const css = mediaStyle(value, style);
  const mediaEl = video ? (
    <video
      ref={videoRef}
      src={value.src}
      poster={value.poster || undefined}
      className={cn("block", className)}
      style={css}
      muted={value.muted ?? true}
      loop={value.loop ?? true}
      autoPlay={value.autoplay ?? true}
      controls={value.controls ?? false}
      playsInline
      preload="auto"
      aria-label={value.alt || undefined}
      onError={onError}
      {...mark}
      {...rest}
    />
  ) : (
    <img
      src={value.src}
      alt={value.alt ?? ""}
      className={cn("block", className)}
      style={css}
      onError={onError}
      {...mark}
      {...rest}
    />
  );
  const withCaption = value.caption ? (
    <figure className="w-full">
      {mediaEl}
      <figcaption
        className={cn(
          "mt-2.5 font-mono text-xs text-white/60",
          value.align === "left" ? "text-left" : value.align === "right" ? "text-right" : "text-center",
        )}
      >
        {value.caption}
      </figcaption>
    </figure>
  ) : (
    mediaEl
  );
  if (!value.link) return withCaption;
  return (
    <a href={value.link} target={/^https?:/.test(value.link) ? "_blank" : undefined} rel="noreferrer">
      {withCaption}
    </a>
  );
}

/** Editable image or video. */
export function CmsMedia({
  k,
  fallback,
  label,
  className,
  style,
  ...rest
}: {
  k: string;
  fallback: MediaValue;
  label?: string;
  className?: string;
  style?: CSSProperties;
} & AnyProps) {
  const cms = useCms();
  const value = cms.media(k, fallback, label);
  if (cms.hidden(k)) return null;
  return <MediaView value={value} className={className} style={style} mark={cms.mark(k)} {...rest} />;
}

/**
 * A built-in visual (a card, a drawn mock-up) the admin can swap for their
 * own image or video, or hide.
 */
export function CmsSlot({
  k,
  label,
  children,
  className,
}: {
  k: string;
  label?: string;
  children: ReactNode;
  className?: string;
}) {
  const cms = useCms();
  cms.register({ key: k, type: "slot", label, fallback: {} });
  if (cms.hidden(k)) return null;
  const override = cms.content.media?.[k];
  if (override?.src) {
    return <MediaView value={{ fit: "cover", ...override }} className={cn("w-full", className)} mark={cms.mark(k)} />;
  }
  return <Fragment>{children}</Fragment>;
}

/** The resolved inline style for a link that the admin recoloured. */
function linkStyle(value: LinkValue): CSSProperties | undefined {
  const css: CSSProperties = {};
  if (value.color) css.backgroundColor = value.color;
  if (value.textColor) css.color = value.textColor;
  if (value.variant === "outline") {
    css.backgroundColor = "transparent";
    css.boxShadow = `inset 0 0 0 1.5px ${value.color || "currentColor"}`;
    if (value.color && !value.textColor) css.color = value.color;
  }
  if (value.variant === "ghost") css.backgroundColor = "transparent";
  return Object.keys(css).length ? css : undefined;
}

/**
 * Editable button/link: label, destination, new tab, colours. `children`
 * receives the label so the original icons and layout stay.
 */
export function CmsLink({
  k,
  href,
  label,
  account,
  className,
  style,
  children,
  ...rest
}: {
  k: string;
  href: string;
  label: string;
  /**
   * An account button: "signup" ones always open Create account and "login"
   * ones always open Log in. A saved destination that points at either
   * account page is replaced by the right one, so an older edit that sent a
   * start button to /login cannot bring that back; any other destination
   * (a section, a full web address) the admin chose still wins.
   */
  account?: "signup" | "login";
  className?: string;
  style?: CSSProperties;
  children?: (label: string) => ReactNode;
} & AnyProps) {
  const cms = useCms();
  const value = cms.link(k, { href, label });
  if (cms.hidden(k)) return null;
  const css = linkStyle(value);
  const saved = value.href || href;
  const target = account && /^\/(login|signup)(?:[/?#]|$)/.test(saved) ? href : saved;
  const props = {
    ...rest,
    ...cms.mark(k),
    className,
    style: css ? { ...style, ...css } : style,
    ...(value.newTab ? { target: "_blank", rel: "noreferrer" } : {}),
  };
  const body = children ? children(value.label ?? label) : value.label ?? label;
  if (/^(https?:|mailto:|tel:)/.test(target)) {
    return (
      <a href={target} {...props}>
        {body}
      </a>
    );
  }
  return (
    <Link href={target} {...props}>
      {body}
    </Link>
  );
}

/** A section wrapper: the admin can hide it or change its background, colours and spacing. */
export function CmsSection({
  k,
  label,
  as = "section",
  className,
  style,
  children,
  ...rest
}: {
  k: string;
  label?: string;
  as?: ElementType;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
} & AnyProps) {
  const cms = useCms();
  const section = cms.section(k, label);
  if (section.hidden) return null;
  return createElement(
    as,
    { ...rest, ...cms.mark(k), className, style: section.style ? { ...style, ...section.style } : style },
    children,
  );
}

/** Renders blocks in the order (and with the visibility) the admin chose. */
export function CmsOrder({ k, label, items }: { k: string; label?: string; items: { id: string; label?: string; node: ReactNode }[] }) {
  const cms = useCms();
  const ordered = cms.list(k, items, label, items.map((item) => item.label ?? item.id), true);
  return (
    <>
      {ordered.map(({ item, id }) => (
        <Fragment key={id}>{item.node}</Fragment>
      ))}
    </>
  );
}
