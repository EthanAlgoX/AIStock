import ResearchReportsWorkspace from "./ResearchReportsWorkspace";
import CryptoWorkspacePage from './CryptoWorkspacePage';
import AssetClassTabs from '../components/crypto/AssetClassTabs';
import { useCryptoAssetClass } from '../components/crypto/useCryptoAssetClass';

export default function ScreeningWorkspacePage() {
  const crypto = useCryptoAssetClass();
  return crypto ? <CryptoWorkspacePage section="screening" /> : <><div className="mx-auto max-w-[1540px] px-4 pt-6 sm:px-6 lg:px-8"><AssetClassTabs /></div><ResearchReportsWorkspace mode="screening" /></>;
}
