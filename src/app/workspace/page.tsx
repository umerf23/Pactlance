import { WalletProviders } from "@/components/wallet-providers";
import { Workspace } from "@/components/workspace";
import { projectIdFromLink } from "@/lib/project-links";
export default async function WorkspacePage({
  searchParams,
}: {
  searchParams: Promise<{ project?: string | string[] }>;
}) {
  const initialProjectId = projectIdFromLink((await searchParams).project);
  return (
    <WalletProviders>
      <Workspace initialProjectId={initialProjectId} />
    </WalletProviders>
  );
}
