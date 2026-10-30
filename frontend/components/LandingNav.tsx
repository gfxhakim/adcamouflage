"use client";

import { BadgeDollarSign, Home, Layers3, Rocket, Workflow } from "lucide-react";

import { useCms } from "@/components/cms/ContentProvider";
import { ICONS } from "@/components/cms/icons";
import { GlassmorphismNavBar, type NavItem } from "@/components/ui/glassmorphism-navigation";

/** Section ids live on the landing page (app/page.tsx). */
const SECTIONS: NavItem[] = [
  { name: "Home", url: "#home", icon: Home },
  { name: "Features", url: "#features", icon: Layers3 },
  { name: "How it works", url: "#how-it-works", icon: Workflow },
  { name: "Pricing", url: "#pricing", icon: BadgeDollarSign },
  { name: "Get started", url: "#get-started", icon: Rocket },
];

/** In the header from lg up; docked at the bottom of the screen below that. */
export function LandingNav({ variant }: { variant: "header" | "dock" }) {
  const cms = useCms();
  const items = cms.list("nav.items", SECTIONS, "Menu items", SECTIONS.map((s) => s.name)).map(({ item, key }) => {
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
