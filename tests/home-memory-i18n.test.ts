import { describe, expect, it } from 'vitest';
import { isMemoryLocale, memoryCopy } from '../src/web/homeMemoryI18n';

describe('home memory i18n copy', () => {
  it('provides English and Chinese explanatory copy for the memory page', () => {
    const english = memoryCopy('en');
    const chinese = memoryCopy('zh');

    expect(english.toolbar.title).toBe('Device-observed memory graph');
    expect(chinese.toolbar.title).toBe('设备观测记忆图谱');
    expect(chinese.whiteBoxStages['Direct evidence']).toMatchObject({
      title: '直接证据',
      description: expect.stringContaining('设备事件')
    });
    expect(chinese.whiteBox.ledgerTitle).toBe('完整计算账本');
    expect(chinese.whiteBox.guidedTitle).toBe('讲解链路');
    expect(chinese.whiteBoxStages['Score ledger']?.title).toBe('评分账本');
    expect(chinese.graph.layers.hypotheses).toBe('结论');
    expect(chinese.llmTrace.purposeTitle).toBe('为什么调用 LLM');
    expect(chinese.llmTrace.purposes[0]?.label).toBe('画像假设解释');
    expect(chinese.llmTrace.purposes[0]?.output).toContain('解释文本');
  });

  it('validates supported memory locales', () => {
    expect(isMemoryLocale('en')).toBe(true);
    expect(isMemoryLocale('zh')).toBe(true);
    expect(isMemoryLocale('fr')).toBe(false);
    expect(isMemoryLocale(null)).toBe(false);
  });
});
