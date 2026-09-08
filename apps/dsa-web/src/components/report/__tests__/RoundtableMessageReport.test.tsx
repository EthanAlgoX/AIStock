import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { RoundtableMessageReport } from '../RoundtableMessageReport';
import { splitDiscussionSections } from '../expertSynthesis';

it('retains full expert chapters and differentiates counterevidence without truncating', () => {
  render(<RoundtableMessageReport content={{}} text={'### 核心判断\n持有观察\n### 支持证据\n现金流改善\n### 反向证据\n需求承压'} />);
  expect(screen.getByText('持有观察', { selector: 'p' })).toBeVisible();
  fireEvent.click(screen.getByText('反向证据'));
  expect(screen.getByText('需求承压', { selector: 'p' })).toBeVisible();
  expect(screen.getByText('反向证据').closest('summary')).toHaveClass('text-warning');
});

it('keeps nested headings and fenced heading-like text within the right chapter', () => {
  const result = splitDiscussionSections('# 标题\n引言\n## 结论\n### 判断\n原文\n```text\n## 不是章节\n```\n## 风险\n尾部');
  expect(result.sections.map(section => section.title)).toEqual(['结论', '风险']);
  expect(result.sections[0].content).toContain('## 不是章节');
  expect(result.prelude).toContain('引言');
});

it('renders structured expert evidence and keeps JSON out of the visible summary', () => {
  const { container } = render(<RoundtableMessageReport summary content={{ conclusion: '```json\n{"finalConclusion":"等待核验","risks":["证据缺口"]}\n```' }} />);
  expect(screen.getByText('等待核验')).toBeVisible();
  for (const pre of container.querySelectorAll('pre')) expect(pre).not.toBeVisible();
  fireEvent.click(screen.getByText('风险与反证'));
  expect(screen.getByText('证据缺口', { selector: 'p' })).toBeVisible();
});
