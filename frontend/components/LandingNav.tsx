"use client";

import { Home, Layers3, Rocket, Workflow } from "lucide-react";

import { GlassmorphismNavBar, type NavItem } from "@/components/ui/glassmorphism-navigation";

/** Section ids live on the landing page (app/page.tsx). */
const SECTIONS: NavItem[] = [
  { name: "Home", url: "#home", icon: Home },
  { name: "Features", url: "#features", icon: Layers3 },
  { name: "How it works", url: "#how-it-works", icon: Workflow },
  { name: "Get started", url: "#get-started", icon: Rocket },
];

export function LandingNav() {
  return <GlassmorphismNavBar items={SECTIONS} />;
}

export default LandingNav;
