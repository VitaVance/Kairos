import { beforeEach, describe, expect, it } from 'vitest';
import { i18n, initI18n } from '@todolist/ui';
import { resetCopy, resetLossLine } from '../src/data/DataTransferPanel';

/**
 * The reset button deletes every row, so its wording is a correctness concern,
 * not copy polish: it must never imply it removes only the demo. The copy now
 * lives in the `misc` catalog, so these assertions read it through the same
 * translator the panel uses (English locale, the source-of-truth catalog).
 */
beforeEach(() => {
  initI18n('en');
});

const tEn = () => i18n.getFixedT('en', 'misc');

describe('reset copy', () => {
  it('says it clears everything and never claims to remove only the demo', () => {
    const copy = resetCopy(tEn());
    const all = Object.values(copy).join('\n');
    expect(all).toContain('every');
    expect(all).toMatch(/including the ones you added yourself/);
    expect(all).toMatch(/cannot be undone/);

    // The dishonest label the brief explicitly forbids.
    expect(all).not.toContain('Clear sample data');
    // "Sample data" may appear only to explain what the demo *was*, never as
    // the object of the delete. The button and confirmation must not contain it.
    expect(copy.trigger).not.toContain('sample data');
    expect(copy.confirmAction).not.toContain('sample data');
  });

  it('keeps the same promises in the Chinese catalog', () => {
    const copy = resetCopy(i18n.getFixedT('zh-CN', 'misc'));
    const all = Object.values(copy).join('\n');
    expect(all).toMatch(/全部/);
    expect(all).toMatch(/也包括你自己添加的/);
    expect(all).toMatch(/无法撤销/);
    expect(copy.trigger).not.toContain('示例');
    expect(copy.confirmAction).not.toContain('示例');
  });

  it('describes the actual loss with live counts', () => {
    const en = resetLossLine(tEn(), { tasks: 17, lists: 4, events: 12 });
    expect(en).toBe(
      'About to delete: 17 tasks · 4 lists · 12 events. Export a JSON backup first just in case.',
    );
    // Plural forms come from the catalog, not string concatenation.
    const one = resetLossLine(tEn(), { tasks: 1, lists: 1, events: 1 });
    expect(one).toContain('1 task · 1 list · 1 event');
  });
});
