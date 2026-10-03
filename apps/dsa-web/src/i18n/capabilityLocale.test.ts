import { describe, expect, it } from 'vitest';
import en from './en.json';
import ja from './ja.json';
import ko from './ko.json';
import traditional from './zh-TW.json';
import { translateSource } from './localize';

const catalogs: Record<string, Record<string, string>> = { en, ja, ko, 'zh-TW': traditional };
const newCopy = [
  '选择研究方法、工具和专家，查看工作区有哪些可用能力。',
  '选择研究、选股和风险检查需要的内置工具。启用后，可在任务中按需使用。',
  '连接外部新闻、公告与计算服务，供研究任务使用。保存连接后，先检查可用性。',
  '选择不同投资视角，或创建自己的研究专家。分析时可邀请专家独立评审，再由投研助理汇总。',
  '正在读取能力目录…', '正在读取工具目录…', '目录尚未读取', '正在保存…',
  '显示上次成功读取的目录。', '目录为空',
  '删除自定义 Skill', '删除 MCP 连接', '删除自定义专家', '登录工作区',
  '删除「{0}」后，将无法用于新任务。已有运行记录保留。',
  '删除计划“{name}”后将停止后续调度；已领取或已启动的运行仍可能继续。',
  '{0} · 按所选策略筛选 · {1} 项能力',
] as const;

describe('Capability and workflow copy language contract', () => {
  it.each(Object.keys(catalogs))('contains the same new static copy and preserves placeholder sets in %s', (language) => {
    for (const source of newCopy) {
      const target = catalogs[language][source];
      expect(target, source).toBeTruthy();
      expect((target.match(/\{(?:\w+)\}/g) ?? []).sort()).toEqual((source.match(/\{(?:\w+)\}/g) ?? []).sort());
    }
  });

  it.each(Object.keys(catalogs))('substitutes both template directions without translating the user object name in %s', (language) => {
    const name = '用户公告方案';
    const capability = translateSource(`删除「${name}」后，将无法用于新任务。已有运行记录保留。`, language);
    const schedule = translateSource(`删除计划“${name}”后将停止后续调度；已领取或已启动的运行仍可能继续。`, language);
    expect(capability).toContain(name); expect(capability).not.toContain('{0}');
    expect(schedule).toContain(name); expect(schedule).not.toContain('{name}');
    if (language === 'en') {
      expect(capability).toContain('Existing run records are retained.');
      expect(schedule).toContain('Claimed or started runs may still continue.');
    }
  });
});
