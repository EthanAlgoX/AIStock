import { useUiLanguage } from '../../contexts/UiLanguageContext';
import { ReportMarkdownBody } from './ReportMarkdownBody';
import { ReviewBody } from './ExpertResearchReview';
import { readExpertSynthesis, splitDiscussionSections } from './expertSynthesis';

const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const words = (value: unknown) => typeof value === 'string' ? value : '';

/** One persisted message, not an aggregate: speaker identity and chronology stay outside. */
export function RoundtableMessageReport({ content, text, summary = false }: { content: unknown; text?: string | null; summary?: boolean }) {
  const { localize: l } = useUiLanguage();
  const envelope = record(content);
  const source = text || words(summary ? envelope.conclusion : envelope.content);
  const parsed = readExpertSynthesis(summary ? envelope.structuredConclusion : envelope.structured, source);
  const data: Record<string, unknown> = { ...parsed.data };
  if (!data.conclusion && (data.finalConclusion || data.final_conclusion)) data.conclusion = data.finalConclusion || data.final_conclusion;
  const { prelude, sections } = splitDiscussionSections(parsed.narrative);
  const riskTitle = (title: string) => /反向|反证|风险|失效|counter|risk|invalidation/i.test(title);
  return <div className="min-w-0 text-foreground [&_.home-markdown-prose]:text-secondary-text [&_.home-markdown-prose_table]:block [&_.home-markdown-prose_table]:overflow-x-auto">
    <p className="mb-4 border-b border-border pb-3 text-xs font-medium text-secondary-text">{summary ? l('本轮总结 · 结论与分歧处理', 'Round synthesis · Conclusion and disagreements') : l('专家观点 · 依据与反证', 'Expert view · Evidence and counterevidence')}{sections.length > 0 && <span className="ml-3">{l(`${sections.length} 个章节`, `${sections.length} sections`)}</span>}</p>
    {parsed.omitted.length > 0 && <p className="mb-4 text-xs leading-6 text-warning">{l('部分历史内容格式损坏，仅展示可完整解析的字段；原文保留在溯源入口。', 'Some historical fields are malformed. Only complete fields are shown; the original remains available below.')}</p>}
    {Object.keys(data).length > 0 ? <ReviewBody data={data} raw={{ ...envelope, originalText: source }} /> : <>
      {prelude && <div className="mb-5"><ReportMarkdownBody content={prelude} /></div>}
      <div className="space-y-3">{sections.map((section, index) => <details key={`${index}-${section.title}`} open={index === 0} className={`min-w-0 rounded-lg border px-4 ${riskTitle(section.title) ? 'border-warning/30' : 'border-border'}`}>
        <summary className={`cursor-pointer py-4 text-sm font-semibold ${riskTitle(section.title) ? 'text-warning' : 'text-foreground'}`}><h4 className="inline text-inherit">{section.title}</h4></summary>
        <div className="min-w-0 border-t border-border pb-4 pt-3"><ReportMarkdownBody content={section.content} /></div>
      </details>)}</div>
      {!source && <p className="text-sm text-secondary-text">{l('该阶段没有正文记录。', 'No message text was recorded.')}</p>}
      {!parsed.narrative && source && <p className="text-sm text-secondary-text">{l('暂无法整理此发言，请查看原始记录或其他专家意见。', 'This message could not be formatted. Review the original record or other expert opinions.')}</p>}
      <details className="mt-5 border-t border-border pt-3"><summary className="cursor-pointer py-2 text-xs text-secondary-text">{l('完整原文与原始记录', 'Full original text and record')}</summary><pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words text-xs text-secondary-text">{source}</pre></details>
    </>}
  </div>;
}
