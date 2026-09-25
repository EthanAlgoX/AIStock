import { Link, useLocation } from 'react-router-dom';
import { useUiLanguage } from '../../contexts/UiLanguageContext';
import { useCryptoAssetClass } from './useCryptoAssetClass';

export default function AssetClassTabs() {
  const { pathname, search } = useLocation();
  const crypto = useCryptoAssetClass();
  const { localize: l } = useUiLanguage();
  return <nav aria-label={l('资产类别', 'Asset class')} className="mb-5 flex gap-2">
    <Link to={crypto ? pathname : pathname + search} aria-current={!crypto ? 'page' : undefined} className={`rounded-lg border px-4 py-2 text-sm font-medium ${!crypto ? 'border-primary bg-primary/10 text-primary' : 'border-border text-secondary-text hover:text-foreground'}`}>{l('股票', 'Stocks')}</Link>
    <Link to={crypto ? pathname + search : `${pathname}?asset=crypto`} aria-current={crypto ? 'page' : undefined} className={`rounded-lg border px-4 py-2 text-sm font-medium ${crypto ? 'border-primary bg-primary/10 text-primary' : 'border-border text-secondary-text hover:text-foreground'}`}>{l('加密货币', 'Crypto')}</Link>
  </nav>;
}
