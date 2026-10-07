import { WalletProviders } from "@/components/wallet-providers";
import { Workspace } from "@/components/workspace";
export default function WorkspacePage() {
  return (
    <WalletProviders>
      <Workspace />
    </WalletProviders>
  );
}
