"use client";

import { BadgeDollarSign, Home, Layers3, Rocket, Workflow } from "lucide-react";

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
  return (
    <GlassmorphismNavBar
      items={SECTIONS}
      variant={variant}
      className={variant === "header" ? "hidden lg:flex" : "lg:hidden"}
    />
  );
}

export default LandingNav;
