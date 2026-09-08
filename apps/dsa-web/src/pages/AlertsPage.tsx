import { AppPage, PageHeader } from '../components/common';
import PriceAlertPanel from '../components/portfolio/PriceAlertPanel';
import { useUiLanguage } from '../contexts/UiLanguageContext';

export default function AlertsPage() {
  const { localize: l } = useUiLanguage();
  return <AppPage><PageHeader title={l('告警中心', 'Alert center')} description={l('用价格规则关注变化，通过已配置渠道接收告警简报。服务需保持运行。', 'Watch price changes with explicit rules and receive briefs through configured channels. Keep the server running.')} /><PriceAlertPanel /></AppPage>;
}
