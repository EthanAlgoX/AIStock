import { isValidElement, type ReactNode } from 'react';
import { parseAnalysisChart } from '../../utils/analysisChart';
import { AnalysisChart } from './AnalysisChart';

export function ChartCodeBlock({children}:{children?:ReactNode}) {
  if(isValidElement<{className?:string;children?:ReactNode}>(children)&&children.props.className==='language-analysis-chart') {
    const raw=String(children.props.children||'');
    const chart=parseAnalysisChart(raw);
    if(chart) return <AnalysisChart key={raw} chart={chart}/>;
    return <details className="not-prose my-4 border border-border p-3"><summary className="cursor-pointer text-sm text-secondary-text">图表数据尚未完整或格式无效 · 查看原文 / Chart data incomplete or invalid</summary><pre className="mt-3 overflow-auto whitespace-pre-wrap text-xs">{raw}</pre></details>;
  }
  return <pre>{children}</pre>;
}
