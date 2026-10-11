import { WalletProviders } from "@/components/wallet-providers";
import { Workspace } from "@/components/workspace";
import { projectIdFromLink } from "@/lib/project-links";
export default async function WorkspacePage({
  searchParams,
}: {
  searchParams: Promise<{
    project?: string | string[];
    role?: string | string[];
  }>;
}) {
  const params = await searchParams;
  const initialProjectId = projectIdFromLink(params.project);
  const initialRole =
    params.role === "client" || params.role === "freelancer"
      ? params.role
      : undefined;
  return (
    <WalletProviders>
      <Workspace
        initialProjectId={initialProjectId}
        initialRole={initialRole}
      />
    </WalletProviders>
  );
}
