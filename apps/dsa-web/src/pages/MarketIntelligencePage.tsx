import MarketIntelligenceSection from '../components/market/MarketIntelligenceSection';
import CryptoWorkspaceLink from '../components/crypto/CryptoWorkspaceLink';

const MarketIntelligencePage = () => (
  <div className="mx-auto min-h-full w-full max-w-[1540px] px-4 pb-16 pt-6 sm:px-6 md:pt-8 lg:px-8 xl:px-10">
    <div className="mb-4"><CryptoWorkspaceLink /></div>
    <MarketIntelligenceSection />
  </div>
);

export default MarketIntelligencePage;
