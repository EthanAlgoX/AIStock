import type { Portfolio } from '../../api/portfolios';
import { useUiLiteral } from '../../hooks/useUiLiteral';

/** Explain recorded outcomes without treating an opinion as an executed order. */
export function PortfolioRunExplanation({ portfolio }: { portfolio: Portfolio }) {
  const t = useUiLiteral();
  const latest = portfolio.days?.at(-1);
  const opinions = latest?.opinions ?? [];
  const fills = latest?.trades.filter(trade => trade.status === 'filled') ?? [];
  const rejected = latest?.trades.filter(trade => trade.status === 'rejected') ?? [];
  const incomplete = portfolio.mode === 'backtest' && portfolio.status !== 'completed';
  const emptyTarget = opinions.length > 0 && opinions.every(opinion => opinion.targetWeight === 0);
  const emptyAccount = latest?.holdings.length === 0;
  const outcome = !latest ? '尚无已完成的交易日记录。'
    : fills.length ? '最近记账日已有模拟成交，详情见买卖记录。'
    : rejected.length ? '最近记账日有订单未成交，请查看下方拒绝原因。'
    : latest.paused ? '该记账日已暂停交易，仅更新持仓估值。'
    : !opinions.length ? '该记账日没有新决策，不能据此判断买卖条件是否满足。'
    : emptyTarget && emptyAccount ? '当前空仓，最近决策的目标仓位均为 0，没有生成买入计划。'
    : '最近记账日没有成交；下列目标仓位是决策结果，不代表已经下单或成交。';
  return (
    <section aria-label={t('运行说明')} className="mb-5 space-y-3 border-y border-border py-4 text-sm">
      <h3 className="font-semibold">{t('运行说明')}</h3>
      {incomplete && <p className="font-medium">{t(portfolio.error && !portfolio.busy
        ? '历史验证已中断，以下仅为已完成日期的部分结果，不代表完整回测。'
        : '历史验证尚未完成，当前指标仅覆盖已记账日期。')}</p>}
      {incomplete && portfolio.error && !portfolio.busy && <p>{t('排查错误详情后，可点击“运行回测”从未完成的日期继续；继续运行会调用模型。')}</p>}
      <p>{latest && <span className="mr-2 tabular-nums">{latest.date}</span>}{t(outcome)}</p>
      {!!opinions.length && !latest?.paused && (
        <ul className="space-y-3">
          {opinions.map(opinion => <li key={opinion.code} className="break-words">
            <p className="font-medium">{opinion.code} · {t('目标仓位')} {opinion.targetWeight == null ? '—' : `${(opinion.targetWeight * 100).toFixed(1)}%`}</p>
            <p className="mt-1 text-secondary-text">{opinion.decisionBackend === "jev"
              ? `JEV · ${t(opinion.decision === "buy" ? "买入" : opinion.decision === "sell" ? "卖出" : "不动")}`
              : opinion.reason}</p>
          </li>)}
        </ul>
      )}
      {rejected.map((trade, index) => <p key={`${trade.code}-${index}`} className="break-words text-danger">{trade.code} · {trade.reason}</p>)}
      {portfolio.mode === 'paper' && <p className="text-secondary-text">{t('这是日线模拟：收盘至少 20 分钟后检查新交易日；决策按后续交易日开盘价模拟成交，成交记录在该日收盘数据处理后显示。')}</p>}
      {!!opinions.length && <p className="text-xs text-secondary-text">{t('决策说明保留生成时的语言，切换界面语言不会重新生成历史内容。')}</p>}
    </section>
  );
}
