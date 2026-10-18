"use client";

import PlatformPage from "@/components/platform/PlatformPage";
import { PLATFORMS } from "@/lib/platforms";

export default function MetaPage() {
  return <PlatformPage platform={PLATFORMS.meta} />;
}
