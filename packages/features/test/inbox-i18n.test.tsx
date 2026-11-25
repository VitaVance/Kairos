import { beforeAll, describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Instant, ListId, TaskList } from '@todolist/core';
import { i18n, initI18n } from '@todolist/ui';
import { ListSidebar, listDisplayName } from '../src/lists/ListSidebar';

// Rendering to static markup keeps this a true component test without needing
// a DOM: the sidebar's only state-driven branches are closed on first render,
// and the list names are plain text in the output.
beforeAll(() => {
  initI18n('en');
});

const NOW = '2026-09-06T08:00:00.000Z' as Instant;

function list(overrides: Partial<TaskList> & { id: ListId; name: string }): TaskList {
  return {
    id: overrides.id,
    name: overrides.name,
    color: overrides.color ?? '#dd7366',
    order: overrides.order ?? 0,
    archived: false,
    systemKey: overrides.systemKey ?? null,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function render(lists: readonly TaskList[]): string {
  return renderToStaticMarkup(
    <ListSidebar lists={lists} tasks={[]} onSelect={() => undefined} />,
  );
}

/** The visible name spans only, so a count or aria label cannot satisfy this. */
function visibleNames(html: string): string[] {
  return [...html.matchAll(/class="list-sidebar__name">([^<]*)</g)].map((m) => m[1]!);
}

describe('listDisplayName', () => {
  it('returns the catalog label for a system list and the stored name otherwise', () => {
    expect(listDisplayName({ name: '收集箱', systemKey: 'inbox' }, 'Inbox')).toBe('Inbox');
    expect(listDisplayName({ name: 'Work', systemKey: null }, 'Inbox')).toBe('Work');
    expect(listDisplayName({ name: 'Work' }, 'Inbox')).toBe('Work');
  });
});

describe('ListSidebar — inbox name comes from the catalog', () => {
  const lists = [
    list({ id: 'l-inbox' as ListId, name: 'stale seed name', order: 0, systemKey: 'inbox' }),
    list({ id: 'l-work' as ListId, name: 'Work', order: 1 }),
  ];

  it('renders the English inbox label while leaving the user list alone', () => {
    return i18n.changeLanguage('en').then(() => {
      const html = render(lists);
      // The stored name is never shown — the system row resolves through i18n,
      // even though the stored value is deliberately stale.
      expect(visibleNames(html)).toEqual(['Inbox', 'Work']);
      expect(html).not.toContain('stale seed name');
    });
  });

  it('renders the Chinese inbox label after a language switch', () => {
    return i18n.changeLanguage('zh-CN').then(() => {
      const html = render(lists);
      expect(visibleNames(html)).toEqual(['收集箱', 'Work']);
    });
  });

  it('changing language renames the inbox but not the user list', () => {
    return i18n
      .changeLanguage('en')
      .then(() => render(lists))
      .then((enHtml) => {
        expect(visibleNames(enHtml)[0]).toBe('Inbox');
        return i18n.changeLanguage('zh-CN').then(() => render(lists));
      })
      .then((zhHtml) => {
        expect(visibleNames(zhHtml)).toEqual(['收集箱', 'Work']);
      });
  });
});
