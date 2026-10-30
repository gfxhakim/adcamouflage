import type { Metadata } from "next";
import type { ReactNode } from "react";

import { ContentProvider } from "@/components/cms/ContentProvider";
import { loadPublishedContent } from "@/lib/siteContent";

// Admin > Workspace edits these pages: every label, the logo, colours, fonts
// and which tools show. Read on each request so a publish shows at once.
export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const meta = (await loadPublishedContent("workspace")).meta ?? {};
  return {
    ...(meta.title ? { title: meta.title } : {}),
    ...(meta.description ? { description: meta.description } : {}),
    ...(meta.favicon ? { icons: { icon: meta.favicon } } : {}),
  };
}

export default async function WorkspaceLayout({ children }: { children: ReactNode }) {
  const content = await loadPublishedContent("workspace");
  return (
    <ContentProvider namespace="workspace" initial={content} autoText>
      {children}
    </ContentProvider>
  );
}
