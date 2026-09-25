import MarketIntelligenceSection from '../components/market/MarketIntelligenceSection';
import AssetClassTabs from '../components/crypto/AssetClassTabs';
import { useCryptoAssetClass } from '../components/crypto/useCryptoAssetClass';
import CryptoWorkspacePage from './CryptoWorkspacePage';

const MarketIntelligencePage = () => {
  const crypto = useCryptoAssetClass();
  return crypto ? <CryptoWorkspacePage section="market" /> : <div className="mx-auto min-h-full w-full max-w-[1540px] px-4 pb-16 pt-6 sm:px-6 md:pt-8 lg:px-8 xl:px-10">
    <AssetClassTabs />
    <MarketIntelligenceSection />
  </div>;
};

export default MarketIntelligencePage;
