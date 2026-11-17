import type { Metadata } from "next";
import { cookies } from "next/headers";
import type { ReactNode } from "react";

import { ContentProvider } from "@/components/cms/ContentProvider";
import { SidebarStateProvider } from "@/components/SidebarState";
import { SIDEBAR_COOKIE } from "@/lib/sidebarCookie";
import { loadPublishedContent } from "@/lib/siteContent";

// Admin > Workspace edits these pages: every label, the logo, colours, fonts
// and which tools show. Read on each request so a publish shows at once.
export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const meta = (await loadPublishedContent("workspace")).meta ?? {};
  return {
    robots: { index: false, follow: false },
    ...(meta.title ? { title: meta.title } : {}),
    ...(meta.description ? { description: meta.description } : {}),
    ...(meta.favicon ? { icons: { icon: meta.favicon } } : {}),
  };
}

export default async function WorkspaceLayout({ children }: { children: ReactNode }) {
  const content = await loadPublishedContent("workspace");
  // The sidebar remembers open / collapsed in a cookie, so the page arrives in the right shape.
  const sidebarOpen = cookies().get(SIDEBAR_COOKIE)?.value !== "false";
  return (
    <ContentProvider namespace="workspace" initial={content} autoText>
      <SidebarStateProvider initialOpen={sidebarOpen}>{children}</SidebarStateProvider>
    </ContentProvider>
  );
}
