"use client";

import ThemeDock from "@/components/ThemeDock";
import WorkspaceShell from "@/components/WorkspaceShell";
import WorkspaceTutorialSection from "@/components/help/WorkspaceTutorialSection";
import { useRequireUser } from "@/lib/useRequireUser";

export default function WorkspaceTutorialsPage() {
  const user = useRequireUser();

  return (
    <WorkspaceShell deck user={user}>
      <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-5 px-4 pb-28 pt-6 sm:px-6 sm:pt-8 lg:px-8">
        <WorkspaceTutorialSection />
      </div>
      <ThemeDock />
    </WorkspaceShell>
  );
}
