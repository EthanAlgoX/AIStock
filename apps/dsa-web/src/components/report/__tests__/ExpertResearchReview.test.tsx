import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ExpertResearchReview } from '../ExpertResearchReview';
import { UiLanguageProvider } from '../../../contexts/UiLanguageContext';

const first = { expertId: 1, expertName: '张磊', status: 'completed', content: '保留完整原始输出', structured: { stance: 'hold', confidence: 0, conclusion: '便宜不等于低估', claims: [{ claim: '估值低', support: 'PB 0.49', counter_evidence: 'ROE 未知', source: '行情快照' }], risks: ['价值陷阱'], customExtension: '未识别扩展保留' } };
const second = { expertId: 2, expertName: '巴菲特', status: 'completed', structured: { stance: 'hold', confidence: 0.45, conclusion: '先检查账本' } };
const artifacts = [
  { type: 'ExpertOpinion', title: '张磊', content: first },
  { type: 'ExpertOpinion', title: '巴菲特', content: second },
  { type: 'ExpertReview', title: '汇总', content: { opinions: [first, second], structuredConclusion: { conclusion: '持有并等待验证', confidence: { value: 0.43 }, conflictMatrix: [{ issue: '买入标签', originalReport: 'buy', experts: 'hold', moderatorRuling: '条件不足' }] } } },
];

describe('ExpertResearchReview', () => {
  it('supports finalConclusion and topic-keyed comparison matrices', () => {
    render(<ExpertResearchReview artifacts={[{ type: 'ExpertReview', title: '主持汇总', content: { structuredConclusion: null, conclusion: JSON.stringify({ finalConclusion: '观察池不是买入清单', conflictMatrix: { '目标是否匹配': { '专家甲': '不匹配', '专家乙': '需复核' } } }) } }]} />);
    expect(screen.getByText('观察池不是买入清单')).toBeVisible();
    fireEvent.click(screen.getByText('汇总依据与分歧处理'));
    fireEvent.click(screen.getByText('目标是否匹配'));
    expect(screen.getByText('不匹配')).toBeVisible();
    expect(screen.getByText('需复核')).toBeVisible();
  });
  it('formats legacy malformed host JSON without a visible code block', () => {
    const { container } = render(<ExpertResearchReview artifacts={[{ type: 'ExpertReview', title: '汇总', content: { structuredConclusion: null, conclusion: '```json\n{\n  "evidenceQualityComparison": ["包含"错误引号""],\n  "conclusion": "先复核基本面",\n  "consensus": ["不追高"],\n  "risks": ["覆盖不足"]\n}\n```' } }]} />);
    expect(screen.getByText('先复核基本面')).toBeVisible();
    expect(screen.getByRole('status')).toHaveTextContent('格式错误');
    for (const pre of container.querySelectorAll('pre')) expect(pre).not.toBeVisible();
    fireEvent.click(screen.getByText('汇总依据与分歧处理'));
    fireEvent.click(screen.getByText('汇总记录的共同判断'));
    expect(screen.getByText('不追高')).toBeVisible();
    for (const pre of container.querySelectorAll('pre')) expect(pre).not.toBeVisible();
  });
  it('groups duplicate snapshots, preserves source data and switches independent opinions', () => {
    render(<ExpertResearchReview artifacts={artifacts} />);
    expect(screen.getByText('2 份独立意见')).toBeVisible();
    expect(screen.getAllByRole('button')).toHaveLength(2);
    expect(screen.getByText('持有并等待验证')).toBeVisible();
    expect(screen.getByText('PB 0.49')).toBeVisible();
    expect(screen.getByText('ROE 未知')).toBeVisible();
    expect(screen.getAllByRole('meter').some(meter => meter.getAttribute('aria-valuenow') === '0')).toBe(true);
    fireEvent.click(screen.getByText('风险与反证'));
    expect(screen.getByText('价值陷阱')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: /巴菲特/ }));
    expect(screen.getByText('先检查账本')).toBeVisible();
    expect(screen.queryByText('便宜不等于低估')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /张磊/ }));
    fireEvent.click(screen.getAllByText('完整原文与原始记录')[1]);
    expect(screen.getAllByText(/未识别扩展保留/).some(element => element.closest('details')?.open)).toBe(true);
  });
  it('keeps failures and different revisions, and does not invent confidence', () => {
    render(<ExpertResearchReview artifacts={[
      artifacts[0],
      { type: 'ExpertOpinion', title: '张磊', content: { ...first, status: 'failed', content: '请求超时', structured: {} } },
      { type: 'ExpertOpinion', title: '未知', content: { expertName: '未知', structured: { confidence: 45, conclusion: '未记录规范信心' } } },
    ]} />);
    expect(screen.getByText('3 份独立意见')).toBeVisible();
    expect(screen.getAllByRole('meter')).toHaveLength(1);
    fireEvent.click(screen.getByText('失败').closest('button')!);
    expect(screen.getByText('请求超时')).toBeVisible();
  });
  it('localizes UI without rewriting historical expert prose', () => {
    localStorage.setItem('dsa.uiLanguage', 'en');
    const { unmount } = render(<UiLanguageProvider><ExpertResearchReview artifacts={artifacts} /></UiLanguageProvider>);
    expect(screen.getByRole('region', { name: 'Expert review' })).toBeVisible();
    expect(screen.getByText('Host synthesis')).toBeVisible();
    expect(screen.getByText('便宜不等于低估')).toBeVisible();
    expect(screen.getByText('Supporting evidence')).toBeVisible();
    unmount();
    localStorage.removeItem('dsa.uiLanguage');
  });
});
