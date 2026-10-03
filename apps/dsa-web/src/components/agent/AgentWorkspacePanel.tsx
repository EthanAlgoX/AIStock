import { Boxes, Database, FileCheck2, PlugZap, Sparkles, Users } from 'lucide-react';
import { Link } from 'react-router-dom';

import type { SkillInfo } from '../../api/agent';
import { cn } from '../../utils/cn';
import { useUiLanguage } from '../../contexts/UiLanguageContext';
import { translateWorkspaceText } from '../../i18n/translateWorkspaceText';

type AgentWorkspacePanelProps = {
  taskTypeLabel?: string;
  artifactTypes?: string[];
  artifactStatus?: string;
  skills: SkillInfo[];
  selectedSkillIds: string[];
  selectedToolCount: number;
  selectedDataSourceCount: number;
  selectedMcpCount: number;
  selectedExpertCount: number;
  selectedExpertTeamCount: number;
  activeStockCode?: string | null;
  hasConversation: boolean;
  isRunning: boolean;
  onOpenCapabilities: () => void;
};

const capabilityRows = [
  { key: 'skills', label: '研究方法', en: 'Research methods', icon: Sparkles, to: '/capabilities/skills' },
  { key: 'tools', label: '内置工具', en: 'Built-in tools', icon: Boxes, to: '/capabilities/tools' },
  { key: 'mcp', label: 'MCP 服务', en: 'MCP services', icon: PlugZap, to: '/capabilities/mcp' },
  { key: 'data', label: '数据源', en: 'Data sources', icon: Database, to: '/capabilities/data' },
  { key: 'experts', label: '专家', en: 'Experts', icon: Users, to: '/capabilities/experts' },
] as const;

export function AgentWorkspacePanel({
  taskTypeLabel = '自然语言任务', artifactTypes = [], artifactStatus,
  skills, selectedSkillIds, selectedToolCount, selectedDataSourceCount,
  selectedMcpCount, selectedExpertCount, selectedExpertTeamCount,
  activeStockCode, hasConversation, isRunning, onOpenCapabilities,
}: AgentWorkspacePanelProps) {
  const { localize, language } = useUiLanguage();
  const selectedSkillNames = skills.filter((skill) => selectedSkillIds.includes(skill.id))
    .map((skill) => translateWorkspaceText(skill.name, language));
  const counts = { skills: selectedSkillIds.length, tools: selectedToolCount, mcp: selectedMcpCount,
    data: selectedDataSourceCount, experts: selectedExpertCount + selectedExpertTeamCount };
  const status = isRunning ? localize('执行中', 'Running') : hasConversation
    ? localize('可继续', 'Ready to continue') : localize('等待目标', 'Awaiting goal');

  return (
    <aside className="hidden h-full w-[17rem] shrink-0 flex-col overflow-hidden border-l border-border bg-card min-[1680px]:flex"
      aria-label={localize('Agent 工作区上下文', 'Agent workspace context')}>
      <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-4">
        <h2 className="text-sm font-semibold">{localize('本次会话', 'This conversation')}</h2>
        <span className={cn('text-xs', isRunning ? 'text-primary' : 'text-secondary-text')}>{status}</span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <section className="border-b border-border px-5 py-4">
          <dl className="space-y-3 text-xs">
            <div className="flex justify-between gap-3"><dt className="text-secondary-text">{localize('任务类型', 'Task type')}</dt><dd>{taskTypeLabel}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-secondary-text">{localize('研究对象', 'Research target')}</dt><dd className={activeStockCode ? 'font-mono' : 'text-secondary-text'}>{activeStockCode || localize('尚未选择', 'Not selected')}</dd></div>
          </dl>
        </section>
        <section className="border-b border-border py-4">
          <div className="flex items-center justify-between gap-3 px-5">
            <h3 className="text-xs font-semibold">{localize('会话能力', 'Session capabilities')}</h3>
            <button type="button" onClick={onOpenCapabilities} className="min-h-11 text-xs font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">{localize('调整', 'Adjust')}</button>
          </div>
          <div className="divide-y divide-border/60">
            {capabilityRows.map(({ key, label, en, icon: Icon, to }) => (
              <Link key={key} to={to} className="flex min-h-11 items-center gap-3 px-5 py-2 text-xs hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
                <Icon className="h-4 w-4 shrink-0 text-secondary-text" aria-hidden="true" />
                <span className="min-w-0 flex-1">{localize(label, en)}</span><span className="font-mono text-secondary-text">{counts[key]}</span>
              </Link>
            ))}
          </div>
          <p className="mx-5 mt-3 text-xs leading-5 text-secondary-text">{selectedSkillNames.length ? selectedSkillNames.join('、') : localize('当前使用通用分析', 'Using general analysis')}</p>
        </section>
        <section className="px-5 py-5">
          <h3 className="flex items-center gap-2 text-xs font-semibold"><FileCheck2 className="h-4 w-4 text-secondary-text" aria-hidden="true" />{localize('成果与记录', 'Outputs and history')}</h3>
          <p className="mt-3 text-xs leading-5 text-secondary-text">{localize('对话保留在历史中；正式研究和模拟结果可在各工作台查看。', 'Conversations remain in history. View formal research and simulation results in their workspaces.')}</p>
          {artifactTypes.includes('Skill') && artifactStatus ? <p role="status" className="mt-3 text-xs">{localize('策略方法', 'Strategy method')} · {artifactStatus}</p> : null}
          <div className="mt-4 flex flex-col gap-3 text-xs text-primary">
            <Link to="/stock-research" className="hover:underline">{localize('查看研究报告', 'View research reports')}</Link>
            <Link to="/trading" className="hover:underline">{localize('查看交易推演', 'View trade simulations')}</Link>
          </div>
        </section>
      </div>
    </aside>
  );
}
