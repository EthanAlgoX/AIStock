import { useId, useState } from 'react';
import { Users, MessageSquareText, ShieldAlert, GitCompareArrows } from 'lucide-react';
import { useUiLanguage } from '../../contexts/UiLanguageContext';
import { ReportMarkdownBody } from './ReportMarkdownBody';
import WorkflowArtifact from '../agent/WorkflowArtifact';
import { readExpertSynthesis } from './expertSynthesis';

type Artifact = { id?: string; title: string; type: string; content: unknown; text?: string | null };
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const words = (value: unknown) => typeof value === 'string' ? value : '';
const list = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const present = (value: unknown) => value != null && value !== '' && (Array.isArray(value) ? value.length > 0 : typeof value !== 'object' || Object.keys(value).length > 0);
const field = (data: Record<string, unknown>, camel: string, snake: string) => data[camel] ?? data[snake];

/** Preserve arbitrary expert extensions without flattening objects into JSON prose. */
function EvidenceValue({ value }: { value: unknown }) {
  const { localize: l } = useUiLanguage();
  const labels: Record<string, string> = {
    claim: l('观点', 'Claim'), evidence: l('依据', 'Evidence'), counter_evidence: l('反证', 'Counterevidence'),
    source: l('来源', 'Source'), risk: l('风险', 'Risk'), severity: l('级别', 'Severity'), detail: l('说明', 'Detail'),
    target: l('讨论对象', 'Target'), disagreement: l('分歧', 'Disagreement'), resolution: l('处理结论', 'Resolution'),
    evidence_basis: l('证据依据', 'Evidence basis'), evidenceBasis: l('证据依据', 'Evidence basis'),
    action: l('行动', 'Action'), priority: l('优先级', 'Priority'),
    name: l('名称', 'Name'), condition: l('条件', 'Condition'), status: l('状态', 'Status'), note: l('说明', 'Note'), position: l('意见', 'Position'),
  };
  if (!present(value)) return <p className="text-sm text-secondary-text">{l('未单独记录', 'Not separately recorded')}</p>;
  if (Array.isArray(value)) return <ul className="space-y-4">{value.map((item, index) => <li key={index} className="border-b border-border/60 pb-4 last:border-0 last:pb-0"><EvidenceValue value={item} /></li>)}</ul>;
  if (typeof value === 'object') return <dl className="space-y-3">{Object.entries(record(value)).map(([key, item]) => <div key={key}><dt className="mb-1 text-xs font-medium text-secondary-text">{labels[key] || key.replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2')}</dt><dd className="min-w-0 text-foreground"><EvidenceValue value={item} /></dd></div>)}</dl>;
  return <ReportMarkdownBody content={typeof value === 'boolean' ? (value ? l('是', 'Yes') : l('否', 'No')) : String(value)} />;
}

function Confidence({ value }: { value: unknown }) {
  const { localize: l } = useUiLanguage();
  const score = typeof value === 'number' ? value : record(value).value;
  const valid = typeof score === 'number' && Number.isFinite(score) && score >= 0 && score <= 1;
  return <div className="min-w-28"><div className="flex justify-between gap-3 text-xs text-secondary-text"><span>{l('自评信心', 'Self-rated confidence')}</span><span className="tabular-nums text-foreground">{valid ? `${Math.round(score * 100)}%` : '—'}</span></div>{valid && <div role="meter" aria-label={l('自评信心', 'Self-rated confidence')} aria-valuemin={0} aria-valuemax={100} aria-valuenow={score * 100} className="mt-2 h-1.5 overflow-hidden rounded-full bg-border"><div className="h-full bg-primary" style={{ width: `${score * 100}%` }} /></div>}</div>;
}

export function ReviewBody({ data, raw }: { data: Record<string, unknown>; raw: unknown }) {
  const { localize: l } = useUiLanguage();
  const claims = list(data.claims).map(item => {
    const claim = record(item);
    return { ...claim, evidence: claim.evidence ?? claim.support };
  });
  const conflicts = list(field(data, 'conflictMatrix', 'conflict_matrix'));
  const groups = [
    [l('风险与反证', 'Risks and counterevidence'), data.risks, field(data, 'counterEvidence', 'counter_evidence')],
    [l('分歧与回应', 'Disagreements and responses'), data.disagreements, field(data, 'keyDisagreements', 'key_disagreements'), data.keyDivergences],
    [l('待核实条件与问题', 'Unverified conditions and questions'), field(data, 'unverifiedConditions', 'unverified_conditions'), field(data, 'unresolvedQuestions', 'unresolved_questions')],
    [l('下一步研究', 'Next research steps'), field(data, 'nextSteps', 'next_steps')],
    [l('依据、假设与适用周期', 'Evidence, assumptions and time horizon'), data.evidence, data.assumptions, field(data, 'applicableTimeScale', 'applicable_time_scale'), field(data, 'supplementaryEvidence', 'supplementary_evidence')],
    [l('证据质量与时点', 'Evidence quality and timing'), data.evidenceQualityComparison, data.dataTimingComparison],
    [l('假设强弱与信心说明', 'Assumptions and confidence notes'), data.assumptionStrengthComparison, typeof data.confidence === 'object' ? data.confidence : undefined],
  ];
  return <div className="min-w-0 space-y-6 [&_.home-markdown-prose]:text-secondary-text">
    {Object.keys(record(data.conflictMatrix)).length > 0 && <section><h4 className="mb-4 flex items-center gap-2 font-semibold text-foreground"><GitCompareArrows size={18} aria-hidden="true" />{l('逐议题专家对照', 'Expert comparison by topic')}</h4><div className="space-y-3">{Object.entries(record(data.conflictMatrix)).map(([topic, positions]) => <details key={topic} className="rounded-lg border border-border px-4"><summary className="cursor-pointer py-4 text-sm font-medium text-foreground">{topic}</summary><dl className="grid gap-4 border-t border-border py-4 sm:grid-cols-2">{Object.entries(record(positions)).map(([name, position]) => <div key={name} className="min-w-0"><dt className="mb-2 text-xs font-semibold text-primary">{name}</dt><dd><EvidenceValue value={position} /></dd></div>)}</dl></details>)}</div></section>}
    {present(data.conclusion) && <section><h4 className="mb-3 flex items-center gap-2 text-sm font-semibold"><MessageSquareText size={16} aria-hidden="true" />{l('核心意见', 'Core opinion')}</h4><EvidenceValue value={data.conclusion} /></section>}
    {present(data.consensus) && <details className="border-t border-border pt-4"><summary className="cursor-pointer py-2 font-medium">{l('汇总记录的共同判断', 'Shared views recorded in the synthesis')}</summary><div className="mt-4"><EvidenceValue value={Array.isArray(data.consensus) ? data.consensus : record(data.consensus).points || data.consensus} /></div></details>}
    {conflicts.length > 0 && <section><h4 className="mb-4 flex items-center gap-2 font-semibold"><GitCompareArrows size={18} aria-hidden="true" />{l('原报告与专家意见对照', 'Report and expert comparison')}</h4><div className="space-y-3">{conflicts.map((item, index) => { const row = record(item); return <details key={index} className="rounded-lg border border-border px-4"><summary className="cursor-pointer py-4 text-sm font-medium">{words(row.issue) || l(`议题 ${index + 1}`, `Issue ${index + 1}`)}</summary><div className="grid gap-5 pb-5 lg:grid-cols-3">{[[l('原报告', 'Original report'), field(row, 'originalReport', 'original_report')], [l('专家意见', 'Expert views'), row.experts], [l('主持人处理', 'Host resolution'), field(row, 'moderatorRuling', 'moderator_ruling')]].map(([label, value]) => <section key={String(label)} className="min-w-0"><h5 className="mb-2 text-xs font-semibold text-primary">{String(label)}</h5><EvidenceValue value={value} /></section>)}</div></details>; })}</div></section>}
    {claims.length > 0 && <section><h4 className="mb-4 font-semibold">{l('观点与证据链', 'Claims and evidence')}</h4><div className="space-y-4">{claims.map((item, index) => { const claim = record(item); return <details key={index} className="rounded-lg border border-border px-4" open={index === 0}><summary className="cursor-pointer py-4 text-sm font-medium">{words(claim.claim) || l(`观点 ${index + 1}`, `Claim ${index + 1}`)}</summary><div className="grid gap-5 border-t border-border py-4 md:grid-cols-2"><section className="min-w-0"><h5 className="mb-3 text-xs font-semibold text-primary">{l('支持依据', 'Supporting evidence')}</h5><EvidenceValue value={claim.evidence} /></section><section className="min-w-0"><h5 className="mb-3 flex items-center gap-2 text-xs font-semibold text-warning"><ShieldAlert size={14} aria-hidden="true" />{l('反证与限制', 'Counterevidence and limitations')}</h5><EvidenceValue value={field(claim, 'counterEvidence', 'counter_evidence')} /></section></div>{present(claim.source) && <div className="border-t border-border py-3 text-xs"><span className="text-secondary-text">{l('来源', 'Source')}</span><EvidenceValue value={claim.source} /></div>}</details>; })}</div></section>}
    <div className="divide-y divide-border border-y border-border">{groups.map(([label, ...values]) => { const items = values.filter(present); return items.length ? <details key={String(label)} className="py-2"><summary className="cursor-pointer py-3 text-sm font-medium">{String(label)}</summary><div className="space-y-5 pb-4">{items.map((item, index) => <EvidenceValue key={index} value={item} />)}</div></details> : null; })}</div>
    <details><summary className="cursor-pointer py-2 text-xs text-secondary-text">{l('完整原文与原始记录', 'Full original text and record')}</summary><pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-muted/30 p-4 text-xs text-secondary-text">{typeof raw === 'string' ? raw : JSON.stringify(raw, null, 2)}</pre></details>
  </div>;
}

export function ExpertResearchReview({ artifacts }: { artifacts: Artifact[] }) {
  const { localize: l } = useUiLanguage();
  const id = useId();
  const [selected, setSelected] = useState(0);
  const reviews = artifacts.filter(a => a.type === 'ExpertReview');
  // Aggregate copies are identical snapshots; keep distinct revisions, failures and unknown fields.
  const candidates: Record<string, unknown>[] = [...artifacts.filter(a => a.type === 'ExpertOpinion').map(a => ({ ...record(a.content), title: a.title })), ...reviews.flatMap(a => list(record(a.content).opinions).map(item => record(item)))];
  const seen = new Set<string>();
  const opinions = candidates.filter(opinion => {
    const key = JSON.stringify(Object.fromEntries(Object.entries(opinion).filter(([key]) => key !== 'title').sort(([a], [b]) => a.localeCompare(b))));
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });
  const active = opinions[selected] || opinions[0];
  const activeData = record(active?.structured);
  const stance = (value: unknown) => ({ hold: l('持有 / 观望', 'Hold / Wait'), buy: l('买入倾向', 'Buy view'), sell: l('卖出倾向', 'Sell view'), neutral: l('中性', 'Neutral'), wait: l('等待', 'Wait'), avoid: l('回避', 'Avoid') }[words(value)] || words(value) || l('未记录立场', 'No stance recorded'));
  const name = (opinion: Record<string, unknown>) => words(opinion.expertName) || words(opinion.title) || l('未命名专家', 'Unnamed expert');
  return <section aria-label={l('专家评审', 'Expert review')} className="my-8 min-w-0 border-t border-border pt-8 text-foreground">
    <header className="mb-6"><h3 className="flex items-center gap-3 text-xl font-semibold"><Users size={22} aria-hidden="true" />{l('专家评审', 'Expert review')}<span className="text-sm font-normal text-secondary-text">{l(`${opinions.length} 份独立意见`, `${opinions.length} independent opinions`)}</span></h3><p className="mt-2 text-xs leading-6 text-secondary-text">{l('基于不同投资框架的 AI 专家意见，非本人发言。信心为模型自评，不是获利概率；立场一致不代表事实已验证。', 'AI expert views based on investment frameworks, not statements by the named people. Confidence is self-rated, not a profit probability; agreement is not verification.')}</p></header>
    {reviews.map((review, index) => {
      const envelope = record(review.content);
      const parsed = readExpertSynthesis(envelope.structuredConclusion, words(envelope.conclusion) || review.text || '');
      const data: Record<string, unknown> = { ...parsed.data };
      if (!present(data.conclusion) && present(data.finalConclusion ?? data.final_conclusion)) data.conclusion = data.finalConclusion ?? data.final_conclusion;
      const counts = [[l('共同判断', 'Shared views'), Array.isArray(data.consensus) ? data.consensus : record(data.consensus).points], [l('风险事项', 'Risk items'), data.risks], [l('待核实条件', 'Unverified conditions'), data.unverifiedConditions], [l('下一步', 'Next steps'), data.nextSteps]].filter(([, value]) => Array.isArray(value));
      return <section key={review.id || index} className="mb-8 rounded-xl border border-border bg-muted/20 p-4 sm:p-6 [&_.home-markdown-prose]:text-secondary-text">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-4"><h4 className="font-semibold text-foreground">{l('主持人汇总', 'Host synthesis')}</h4><Confidence value={data.confidence} /></div>
        {parsed.omitted.length > 0 && <p role="status" className="mb-4 rounded-lg border border-warning/30 p-3 text-xs leading-6 text-warning">{l('历史汇总存在格式错误。以下仅展示可完整解析的内容，未解析部分保留在原始记录中。', 'The historical synthesis has formatting errors. Only complete, parseable fields are shown; remaining content is preserved in the original record.')}</p>}
        {Object.keys(data).length ? <>
          {present(data.conclusion) ? <EvidenceValue value={data.conclusion} /> : <p className="text-sm text-secondary-text">{l('未提取到独立结论，请查看下方已记录的判断依据。', 'No standalone conclusion was extracted. Review the recorded evidence below.')}</p>}
          {counts.length > 0 && <dl className="mt-5 grid grid-cols-2 gap-4 border-y border-border py-4 sm:grid-cols-4">{counts.map(([label, value]) => <div key={String(label)}><dt className="text-xs text-secondary-text">{String(label)}</dt><dd className="mt-2 text-xl font-semibold tabular-nums text-foreground">{list(value).length}</dd></div>)}</dl>}
          <details className="mt-5 border-t border-border pt-3"><summary className="cursor-pointer py-2 text-sm font-medium">{l('汇总依据与分歧处理', 'Synthesis evidence and conflict resolution')}</summary><div className="mt-5"><ReviewBody data={{ ...data, conclusion: undefined }} raw={review.content} /></div></details>
        </> : <>
          {parsed.narrative ? <ReportMarkdownBody content={parsed.narrative} /> : <p className="text-sm text-secondary-text">{l('汇总暂无法整理成报告，可继续查看下方独立专家意见。', 'The synthesis could not be formatted as a report. Independent expert opinions remain available below.')}</p>}
          <details className="mt-4"><summary className="cursor-pointer py-2 text-xs text-secondary-text">{l('完整原文与原始记录', 'Full original text and record')}</summary><pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words text-xs text-secondary-text">{parsed.raw}</pre></details>
        </>}
      </section>;
    })}
    {opinions.length > 0 && <><h4 className="mb-3 font-semibold">{l('专家立场 · 选择查看完整意见', 'Expert positions · Select to read')}</h4><div className="mb-6 grid gap-2 sm:grid-cols-2">{opinions.map((opinion, index) => { const data = record(opinion.structured); return <button key={index} type="button" aria-pressed={active === opinion} aria-controls={`${id}-opinion`} onClick={() => setSelected(index)} className={`min-w-0 rounded-lg border p-4 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary ${active === opinion ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/30'}`}><span className="flex flex-wrap justify-between gap-2"><span className="font-semibold">{name(opinion)}</span><span className="text-xs text-secondary-text">{words(opinion.status) === 'completed' ? l('已完成', 'Completed') : words(opinion.status) === 'failed' ? l('失败', 'Failed') : words(opinion.status) || l('状态未记录', 'Status unavailable')}</span></span><span className="mb-3 mt-2 block text-sm text-primary">{stance(data.stance)}</span><Confidence value={data.confidence} /></button>; })}</div><section id={`${id}-opinion`} aria-label={name(active)} className="min-w-0"><h4 className="mb-5 border-b border-border pb-4 text-lg font-semibold">{name(active)}</h4>{Object.keys(activeData).length ? <ReviewBody key={selected} data={activeData} raw={active} /> : <div className="space-y-4"><p className="text-sm text-warning">{l('未生成结构化意见，以下保留原始说明。', 'No structured opinion was produced. Original notes are preserved below.')}</p><EvidenceValue value={active.content || active.error || active.message} /></div>}</section></>}
  </section>;
}

/** Shared report workspaces; standalone discussion surfaces keep their own rendering. */
export function StockResearchArtifacts({ artifacts, researchPresentation = 'memo' }: { artifacts: Artifact[]; researchPresentation?: 'memo' | 'default' }) {
  const experts = artifacts.filter(a => a.type === 'ExpertOpinion' || a.type === 'ExpertReview');
  return <>{artifacts.map((artifact, index) => {
    if (experts.includes(artifact)) {
      if (artifact !== experts[0]) return null;
      return <ExpertResearchReview key="expert-review" artifacts={experts} />;
    }
    return <WorkflowArtifact key={artifact.id || index} artifact={artifact} researchPresentation={researchPresentation === 'memo' ? 'memo' : undefined} />;
  })}</>;
}
