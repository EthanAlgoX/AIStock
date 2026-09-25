import { Link } from 'react-router-dom';
import { useUiLanguage } from '../../contexts/UiLanguageContext';

export default function CryptoWorkspaceLink() {
  const { t } = useUiLanguage();
  return <Link to="/crypto" className="inline-flex min-h-10 items-center rounded-lg border border-primary/30 bg-primary/5 px-3 text-sm font-medium text-primary hover:bg-primary/10">{t('layout.nav.crypto')} · Spot USDT →</Link>;
}
