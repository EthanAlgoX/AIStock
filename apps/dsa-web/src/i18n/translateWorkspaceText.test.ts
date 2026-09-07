import { describe, expect, it } from 'vitest';
import { translateWorkspaceText } from './translateWorkspaceText';
import { WORKSPACE_TEXT } from './workspaceText';

describe('workspace UI translation', () => {
  it('translates the expanded expert catalogue without changing custom names', () => {
    for (const name of ['李录', '彼得·林奇', '朱少醒', '谢治宇', '吉姆·柯林斯', '李国飞', '彼得·德鲁克', '马克·米勒维尼', '杰西·利弗莫尔']) {
      expect(translateWorkspaceText(name, 'en')).not.toMatch(/[\u3400-\u9fff]/);
      expect(translateWorkspaceText(name, 'zh')).toBe(name);
    }
  });
  it('preserves unknown user text and report prose', () => {
    const report = '我自己的研究报告：先观察，再核实。';
    expect(translateWorkspaceText(report, 'en')).toBe(report);
    expect(translateWorkspaceText('constructor', 'en')).toBe('constructor');
    expect(translateWorkspaceText('toString', 'en')).toBe('toString');
  });
  it('substitutes values without translating user data or interpreting markup', () => {
    expect(translateWorkspaceText('投给：{0}', 'en', '自定义专家')).toBe('Vote for: 自定义专家');
    expect(translateWorkspaceText('按原始排名深研前 {0} 只', 'zh', 3)).toBe('按原始排名深研前 3 只');
  });
  it('keeps English copy free of Chinese text and preserves every placeholder', () => {
    for (const [source, english] of Object.entries(WORKSPACE_TEXT)) {
      expect(english, source).not.toMatch(/[\u3400-\u9fff]/);
      expect((english.match(/\{\d+\}/g) || []).sort(), source).toEqual((source.match(/\{\d+\}/g) || []).sort());
    }
  });
});
