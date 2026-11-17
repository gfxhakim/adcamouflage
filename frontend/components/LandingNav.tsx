"use client";

import { BadgeDollarSign, CircleHelp, Home, PlayCircle, Rocket } from "lucide-react";

import { useCms } from "@/components/cms/ContentProvider";
import { ICONS } from "@/components/cms/icons";
import { GlassmorphismNavBar, type NavItem } from "@/components/ui/glassmorphism-navigation";

/**
 * Section ids live on the landing page (app/page.tsx). `null` keeps the slot
 * of a removed section's link, so menus the admin already saved still line up.
 */
const SECTIONS: (NavItem | null)[] = [
  { name: "Home", url: "#home", icon: Home },
  null, // was "Features"
  null, // was "How it works"
  { name: "Pricing", url: "#pricing", icon: BadgeDollarSign },
  { name: "Get started", url: "#get-started", icon: Rocket },
  { name: "How To", url: "#proof", icon: PlayCircle },
  { name: "FAQ", url: "#faq", icon: CircleHelp },
];

/** Built-in menu order: Home, How To, FAQ, Pricing, Get started. */
const ORDER = [0, 5, 6, 3, 4];

/** In the header from lg up; docked at the bottom of the screen below that. */
export function LandingNav({ variant }: { variant: "header" | "dock" }) {
  const cms = useCms();
  const items = cms.list("nav.items", SECTIONS, "Menu items", SECTIONS.map((s) => s?.name ?? ""), false, ORDER).map(({ item, key }) => {
    const link = cms.link(key, { label: item.name, href: item.url }, item.name);
    const icon = cms.iconName(`${key}.icon`, "");
    return { name: link.label || item.name, url: link.href || item.url, icon: (icon && ICONS[icon]) || item.icon };
  });
  if (cms.hidden("nav")) return null;
  return (
    <GlassmorphismNavBar
      items={items}
      variant={variant}
      className={variant === "header" ? "hidden lg:flex" : "lg:hidden"}
    />
  );
}

export default LandingNav;
