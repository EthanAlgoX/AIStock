import type { PortfolioDecision } from '../../api/portfolioResearch';
import { useUiLiteral } from '../../hooks/useUiLiteral';

export default function JevResearchResult({ decision }: { decision?: PortfolioDecision | null }) {
  const t = useUiLiteral();
  const labels = { buy: '买入', sell: '卖出', hold: '不动', bullish: '看涨', bearish: '看跌', neutral: '中性' };
  return <div className="space-y-2 text-sm" aria-label={t('JEV 分类结果')}>
    <p className="font-medium">JEV · {decision ? t(labels[decision.category]) : t('尚无 JEV 分类结果')}</p>
    {decision && <><p>{t('置信度')} <strong className="tabular-nums">{(decision.confidence * 100).toFixed(1)}%</strong></p><p className="text-xs text-secondary-text">{decision.asOf} · {decision.model}</p></>}
    <p className="text-xs leading-6 text-secondary-text">{t('仅显示 API 返回的分类与置信度，没有生成式报告；置信度不是收益概率或建议仓位。')}</p>
  </div>;
}
