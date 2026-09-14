import type { HoldingRecommendationPoint } from '../../api/portfolioResearch';
import { useUiLanguage } from '../../contexts/UiLanguageContext';

const WIDTH = 420;
const HEIGHT = 116;
const PAD = { top: 12, right: 12, bottom: 22, left: 28 };

export default function HoldingRecommendationTrend({ history, trend }: { history: HoldingRecommendationPoint[]; trend: { direction: string; change: number | null; sessions: number } }) {
  const { localize: l } = useUiLanguage();
  if (!history.length) return null;
  const plotWidth = WIDTH - PAD.left - PAD.right;
  const plotHeight = HEIGHT - PAD.top - PAD.bottom;
  const point = (entry: HoldingRecommendationPoint, index: number) => ({
    x: PAD.left + (history.length === 1 ? plotWidth / 2 : index * plotWidth / (history.length - 1)),
    y: PAD.top + (100 - entry.score) * plotHeight / 100,
  });
  const points = history.map(point);
  const direction = {
    rising: l('近周期走强', 'Improving'), falling: l('近周期走弱', 'Weakening'),
    stable: l('近周期持平', 'Stable'), insufficient: l('等待更多独立研究', 'Awaiting more independent runs'),
  }[trend.direction] || l('等待更多独立研究', 'Awaiting more independent runs');
  const change = trend.change == null ? '' : `${trend.change > 0 ? '+' : ''}${trend.change.toFixed(0)}`;
  const labelDate = (entry: HoldingRecommendationPoint) => entry.session?.slice(5, 10) || entry.createdAt?.slice(0, 10) || '—';
  return <section className="mt-4 max-w-[560px] border-t border-border pt-4" aria-label={l('持仓建议轨迹', 'Holding recommendation trajectory')}>
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1"><h4 className="text-sm font-semibold text-foreground">{l('持仓建议轨迹', 'Holding recommendation trajectory')}</h4><p className="text-xs text-secondary-text">{direction}{change && ` · ${change} ${l('分', 'pts')}`}</p></div>
    <p className="mt-1 text-xs leading-5 text-secondary-text">{l('汇总已完成的独立研究结果，不会作为下一次研究输入。', 'Aggregates completed independent reports; never used as input to the next run.')}</p>
    <svg className="mt-3 h-auto w-full" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label={l(`最近 ${history.length} 次研究的持仓建议评分曲线`, `Recommendation score across the latest ${history.length} reports`)}>
      {[20, 50, 80].map(score => <g key={score}><line x1={PAD.left} x2={WIDTH - PAD.right} y1={PAD.top + (100 - score) * plotHeight / 100} y2={PAD.top + (100 - score) * plotHeight / 100} className="stroke-border" strokeDasharray="3 4" /><text x={PAD.left - 6} y={PAD.top + (100 - score) * plotHeight / 100 + 3} textAnchor="end" className="fill-secondary-text text-[9px]">{score}</text></g>)}
      <polyline points={points.map(p => `${p.x},${p.y}`).join(' ')} fill="none" className="stroke-primary" strokeWidth="2" />
      {points.map((p, index) => <circle key={`${history[index].session}-${index}`} cx={p.x} cy={p.y} r="3.5" className="fill-background stroke-primary" strokeWidth="2"><title>{`${labelDate(history[index])} · ${history[index].label} · ${history[index].score}`}</title></circle>)}
      <text x={PAD.left} y={HEIGHT - 5} className="fill-secondary-text text-[9px]">{labelDate(history[0])}</text>
      {history.length > 1 && <text x={WIDTH - PAD.right} y={HEIGHT - 5} textAnchor="end" className="fill-secondary-text text-[9px]">{labelDate(history[history.length - 1])}</text>}
    </svg>
    <table className="sr-only"><caption>{l('持仓建议轨迹明细', 'Holding recommendation trajectory details')}</caption><thead><tr><th>{l('日期', 'Date')}</th><th>{l('建议', 'Recommendation')}</th><th>{l('评分', 'Score')}</th></tr></thead><tbody>{history.map(entry => <tr key={entry.session}><td>{entry.session}</td><td>{entry.label}</td><td>{entry.score}</td></tr>)}</tbody></table>
  </section>;
}
