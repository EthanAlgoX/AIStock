import { useUiLiteral } from '../../hooks/useUiLiteral';
import type { ResearchBackend } from '../../api/portfolioResearch';

export default function ResearchBackendSelect({ value, onChange, disabled = false, watch = false }: {
  value: ResearchBackend; onChange: (value: ResearchBackend) => void; disabled?: boolean; watch?: boolean;
}) {
  const t = useUiLiteral();
  return <div className="space-y-2">
    <label className="block text-sm">{t('分析模型')}<select className="mt-2 h-11 w-full rounded-lg border border-border bg-background px-3 text-sm" value={value} disabled={disabled} onChange={event => onChange(event.target.value as ResearchBackend)}>
      <option value="llm">{t('LLM · 生成研究报告')}</option>
      <option value="jev">{t('JEV · 分类与置信度')}</option>
    </select></label>
    <p className="text-xs leading-6 text-secondary-text">{t(value === 'jev'
      ? watch ? 'JEV 直接返回看涨、看跌或中性及置信度；不读取持仓，不生成报告。' : 'JEV 直接返回买入、卖出或不动及置信度；不生成报告，不自动下单。'
      : 'LLM 生成研究报告与文字解释。保存模型选择不会立即调用模型。')}</p>
    {value === 'jev' && <p className="text-xs leading-6 text-secondary-text">{t('使用设置中的 JEV API 配置。仅使用最近已收盘日线；LLM 研究策略与补充专家不参与 JEV 分类。')}</p>}
  </div>;
}
