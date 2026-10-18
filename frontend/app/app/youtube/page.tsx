"use client";

import PlatformPage from "@/components/platform/PlatformPage";
import { PLATFORMS } from "@/lib/platforms";

export default function YouTubePage() {
  return <PlatformPage platform={PLATFORMS.youtube} />;
}
