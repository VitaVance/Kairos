import { describe, expect, it } from 'vitest';
import { DEFAULT_SHORTCUT_BINDINGS } from '../src/shortcuts/ShortcutHelp.js';
import { SHORTCUT_GROUPS } from '../src/settings/SettingsDialog.js';

/**
 * The settings pane renders a subset of `DEFAULT_SHORTCUT_BINDINGS` grouped
 * into 通用 / 导航. This holds the grouping to the cheat-sheet: every binding
 * the sheet lists must belong to exactly one group, or the settings dialog
 * would silently omit a shortcut (or render one twice).
 */
describe('settings shortcut groups cover the cheat-sheet', () => {
  const grouped = SHORTCUT_GROUPS.flatMap((g) => [...g.labelKeys]);

  it('places every catalog label key in a group', () => {
    for (const { labelKey } of DEFAULT_SHORTCUT_BINDINGS) {
      expect(grouped).toContain(labelKey);
    }
  });

  it('groups nothing the catalog does not define', () => {
    const known = new Set(DEFAULT_SHORTCUT_BINDINGS.map((b) => b.labelKey));
    for (const key of grouped) expect(known).toContain(key);
  });

  it('lists each group at most once', () => {
    expect(new Set(grouped).size).toBe(grouped.length);
  });

  it('keeps 通用 before 导航', () => {
    expect(SHORTCUT_GROUPS.map((g) => g.groupKey)).toEqual(['groupCommon', 'groupNavigation']);
  });
});
