import { describe, expect, it } from 'vitest';
import { readExpertSynthesis } from '../expertSynthesis';

describe('readExpertSynthesis', () => {
  it('prefers the persisted structure', () => {
    expect(readExpertSynthesis({ conclusion: 'saved' }, '{broken}').data.conclusion).toBe('saved');
  });
  it('reads valid fenced JSON without rendering its code wrapper', () => {
    const result = readExpertSynthesis(null, '```json\n{"conclusion":"wait","confidence":0}\n```');
    expect(result.data).toEqual({ conclusion: 'wait', confidence: 0 });
    expect(result.narrative).toBe('');
  });
  it('recovers complete top-level fields but never repairs damaged quoted evidence', () => {
    const raw = '```json\n{\n  "evidenceQualityComparison": ["a "quoted" claim"],\n  "conclusion": "保留原结论",\n  "risks": [{"name":"信息缺失","detail":"待财报确认"}],\n  "confidence": {"综合置信度":"0.4，条件化判断"}\n}\n```';
    const result = readExpertSynthesis(null, raw);
    expect(result.data.conclusion).toBe('保留原结论');
    expect(result.data.risks).toEqual([{ name: '信息缺失', detail: '待财报确认' }]);
    expect(result.omitted).toEqual(['evidenceQualityComparison']);
    expect(result.data.confidence).toEqual({ 综合置信度: '0.4，条件化判断' });
    expect(result.raw).toBe(raw);
    expect(result.narrative).toBe('');
  });
  it('does not expose malformed or truncated JSON as narrative', () => {
    for (const source of ['{broken}', '```json\n{\n  "conclusion":"cut off\n```']) {
      expect(readExpertSynthesis(null, source).narrative).toBe('');
      expect(readExpertSynthesis(null, source).data).toEqual({});
    }
    expect(readExpertSynthesis(null, '普通 Markdown 结论').narrative).toBe('普通 Markdown 结论');
  });
});
