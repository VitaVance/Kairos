import type {
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  ReactNode,
} from 'react';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { LocalDate, Task, TaskId } from '@todolist/core';
import { daysFromToday, todayLocal } from '@todolist/core';
import {
  Checkbox,
  EmptyState,
  ScrollArea,
  SearchIcon,
  TextField,
  isImeComposing,
  useTranslation,
} from '@todolist/ui';
import { useLists } from '../services';
import { useTasks } from '../data/useTasks';
import { listLabel } from '../lists/list-label';
import { escapeStack } from '../shortcuts/useShortcuts';
import { applyFilters, highlightRanges, sortByRelevance } from './search';
import { currentLanguage } from '@todolist/ui';
import './search.css';

export interface SearchPanelProps {
  open: boolean;
  onClose: () => void;
  onOpenTask: (taskId: string) => void;
}

interface ResultGroup {
  readonly key: string;
  readonly label: string;
  readonly color: string;
  readonly tasks: readonly Task[];
}

const FALLBACK_COLOR = 'var(--tl-text-tertiary)';

/** Human label for a due date: today / tomorrow / yesterday / Mon D. */
function dueLabel(
  task: Task,
  today: LocalDate,
  t: ReturnType<typeof useTranslation<'misc'>>['t'],
): string | null {
  if (task.dueDate === null) return null;
  const diff = daysFromToday(task.dueDate, today);
  if (diff === 0) return t('search.dueToday');
  if (diff === 1) return t('search.dueTomorrow');
  if (diff === 2) return t('search.dueDayAfterTomorrow');
  if (diff === -1) return t('search.dueYesterday');
  const parts = task.dueDate.split('-');
  const month = parts[1];
  const day = parts[2];
  if (!month || !day) return null;
  return new Intl.DateTimeFormat(currentLanguage(), { month: 'numeric', day: 'numeric' }).format(
    new Date(`${task.dueDate}T00:00:00`),
  );
}

/** Renders text with every query occurrence wrapped in <mark>. */
function HighlightedText({ text, query }: { text: string; query: string }): ReactNode {
  const ranges = highlightRanges(text, query);
  if (ranges.length === 0) return text;

  const parts: ReactNode[] = [];
  let cursor = 0;
  ranges.forEach((range, i) => {
    if (range.start > cursor) parts.push(text.slice(cursor, range.start));
    parts.push(<mark key={i}>{text.slice(range.start, range.end)}</mark>);
    cursor = range.end;
  });
  if (cursor < text.length) parts.push(text.slice(cursor));
  return parts;
}

/**
 * Command-palette style search overlay.
 *
 * Reads tasks and lists from the app context itself (no data props). Owns its
 * query state and keyboard selection. Built on the native `<dialog>`, so the
 * focus trap, `inert` background, Escape handling and focus restoration all
 * come from `showModal()` rather than from hand-rolled listeners — the old
 * implementation's Tab trap picked the `tabIndex={-1}` result checkbox as the
 * last focusable and let forward-Tab walk into the page behind the palette.
 */
export function SearchPanel({ open, onClose, onOpenTask }: SearchPanelProps) {
  const { t } = useTranslation('misc');
  const { data, toggleDone, fresh } = useTasks();
  const lists = useLists();

  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const [today] = useState<LocalDate>(() => todayLocal());

  const dialogRef = useRef<HTMLDialogElement | null>(null);
  /** The element to focus back if the UA's own dialog restoration cannot. */
  const restoreRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  /** Stable identity for this palette's slot in the app-wide Escape stack. */
  const layerId = useId();

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  const filtered = useMemo(() => {
    const listNames = new Map<string, string>(lists.map((l) => [l.id, listLabel(l)]));
    return sortByRelevance(
      applyFilters(data ?? [], { query, status: 'all', listId: null, listNames }),
      query,
      listNames,
    );
    // `t` is a dependency on purpose: the map holds *resolved* list names, and
    // the system inbox's name changes with the language while the `lists` array
    // keeps its identity. Without `t` the search results would keep grouping
    // under the previous language's label until something else invalidated it.
  }, [data, query, lists, t]);

  const groups = useMemo<readonly ResultGroup[]>(() => {
    const byList = new Map<string, Task[]>();
    for (const task of filtered) {
      const bucket = byList.get(task.listId);
      if (bucket) bucket.push(task);
      else byList.set(task.listId, [task]);
    }

    const out: ResultGroup[] = [];
    // Only non-archived lists get their own group; a task pointing at an
    // archived list falls through to the "未分类" bucket instead of vanishing.
    for (const list of lists) {
      if (list.archived) continue;
      const bucket = byList.get(list.id);
      if (bucket && bucket.length > 0) {
        out.push({ key: list.id, label: listLabel(list), color: list.color, tasks: bucket });
        byList.delete(list.id);
      }
    }
    for (const [listId, bucket] of byList) {
      if (bucket.length > 0) {
        const list = lists.find((l) => l.id === listId);
        out.push({
          key: listId,
          label: list ? listLabel(list) : t('search.uncategorized'),
          color: list?.color ?? FALLBACK_COLOR,
          tasks: bucket,
        });
      }
    }
    return out;
  }, [filtered, lists, t]);

  const flat = useMemo(() => groups.flatMap((g) => g.tasks), [groups]);
  /** id → index into `flat`, so rows do not scan the list for every render. */
  const indexById = useMemo(() => {
    const map = new Map<string, number>();
    flat.forEach((task, index) => map.set(task.id, index));
    return map;
  }, [flat]);

  // Query changes restart selection at the top.
  useEffect(() => {
    setSelected(0);
  }, [query]);

  // Clamp selection when the result set shrinks.
  useEffect(() => {
    setSelected((cur) => (flat.length === 0 ? 0 : Math.min(cur, flat.length - 1)));
  }, [flat.length]);

  // Drive the native dialog imperatively — never render the `open` attribute —
  // and register with the shared Escape stack for the lifetime of the open
  // state. Keeping the element mounted (rather than returning null) is what
  // lets `dialog.close()` restore focus to whatever opened the palette.
  //
  // `showModal()` already makes the UA route Escape to the topmost native
  // dialog, but it does *not* stop other document-level Escape listeners (the
  // task detail side sheet registers one) from also firing. The capture-phase
  // guard below is the part the UA cannot do: while this palette is the
  // topmost layer in the stack, it claims Escape before any bubble-phase
  // document listener sees it, so a lower non-modal layer stays open.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open) {
      if (!dialog.open) dialog.showModal();
      escapeStack.push(layerId);
    } else if (dialog.open) {
      dialog.close();
    }
    return () => {
      escapeStack.pop(layerId);
    };
  }, [open, layerId]);

  useEffect(() => {
    if (!open) return;
    const onEscape = (event: KeyboardEvent) => {
      const dialog = dialogRef.current;
      if (dialog === null || event.key !== 'Escape' || event.isComposing) return;
      // Only events aimed at this palette. A modal above it (the settings
      // dialog, say) has an inert backdrop beneath, so its keys target inside
      // that dialog and must not be claimed here.
      if (!dialog.contains(event.target as Node)) return;
      // Another layer opened on top of this one owns the key.
      if (!escapeStack.isTopmost(layerId)) return;
      // Claim it before bubble-phase document listeners (detail sheet, etc.)
      // run, and suppress `cancel` so the close has exactly one path.
      event.preventDefault();
      event.stopImmediatePropagation();
      onCloseRef.current();
    };
    document.addEventListener('keydown', onEscape, true);
    return () => document.removeEventListener('keydown', onEscape, true);
  }, [open, layerId]);

  // On open, remember what had focus, land focus on the query field, and on
  // close fall back to the remembered element. The UA restores focus after
  // `dialog.close()`, but only when focus is still inside the dialog; a close
  // triggered from an outside listener can lose it, so the fallback covers the
  // case where focus would otherwise fall back to `<body>`.
  useEffect(() => {
    if (!open) return;
    restoreRef.current = (document.activeElement as HTMLElement | null) ?? null;
    const focusTimer = window.setTimeout(() => {
      dialogRef.current?.querySelector<HTMLInputElement>('.tl-field__input')?.focus();
    }, 0);
    return () => {
      window.clearTimeout(focusTimer);
      const restore = restoreRef.current;
      const active = document.activeElement;
      // Only step in when focus was dropped to the page body (or nowhere).
      if (restore !== null && (active === null || active === document.body)) {
        restore.focus?.();
      }
    };
  }, [open]);

  // Keep the active option visible as selection moves.
  useEffect(() => {
    if (!open) return;
    const active = flat[selected];
    if (!active) return;
    document.getElementById(`search-option-${active.id}`)?.scrollIntoView({ block: 'nearest' });
  }, [open, selected, flat]);

  const openTask = useCallback(
    (id: TaskId) => {
      onOpenTask(id);
      onClose();
    },
    [onClose, onOpenTask],
  );

  const toggleDoneOption = useCallback(
    (task: Task) => {
      toggleDone(task.id, task.title);
    },
    [toggleDone],
  );

  const onInputKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLInputElement>) => {
      // While an IME is composing, Enter confirms a candidate and the arrows
      // walk the candidate list — intercepting either here would eat the
      // keystroke the input method needs. Leave the whole event alone.
      if (isImeComposing(e)) return;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (flat.length > 0) setSelected((i) => (i + 1) % flat.length);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (flat.length > 0) setSelected((i) => (i - 1 + flat.length) % flat.length);
      } else if (e.key === 'Enter') {
        const active = flat[selected];
        if (active) {
          e.preventDefault();
          openTask(active.id);
        }
      }
    },
    [flat, openTask, selected],
  );

  const activeTask = flat[selected];
  const activeId = activeTask ? `search-option-${activeTask.id}` : undefined;
  const hasQuery = query.trim().length > 0;

  /**
   * Backdrop click. The dialog covers the viewport and the card is its only
   * child, so a target equal to the dialog element itself is outside the card.
   */
  const onDialogMouseDown = useCallback((e: ReactMouseEvent<HTMLDialogElement>) => {
    if (e.target === e.currentTarget) onCloseRef.current();
  }, []);

  /** `cancel` fires on Escape; route it to the host via `onClose`. */
  const onDialogCancel = useCallback(() => {
    onCloseRef.current();
  }, []);

  return (
    <dialog
      ref={dialogRef}
      className="search-dialog"
      aria-label={t('search.dialogLabel')}
      onMouseDown={onDialogMouseDown}
      onCancel={onDialogCancel}
      onClose={onDialogCancel}
    >
      <div className="search-panel">
        <div className="search-panel__input">
          <TextField
            value={query}
            onChange={setQuery}
            placeholder={t('search.placeholder')}
            label={t('search.inputLabel')}
            leadingIcon={<SearchIcon size={16} />}
            aria-controls="search-results"
            aria-activedescendant={activeId}
            aria-autocomplete="list"
            role="combobox"
            aria-expanded={flat.length > 0}
            onKeyDown={onInputKeyDown}
            autoComplete="off"
          />
          <kbd className="search-panel__esc" aria-hidden="true">
            Esc
          </kbd>
        </div>

        <ScrollArea className="search-panel__results" axis="y">
          {flat.length === 0 ? (
            <EmptyState
              message={t('search.emptyMessage')}
              hint={
                hasQuery
                  ? t('search.emptyHintWithQuery', { query: query.trim() })
                  : t('search.emptyHint')
              }
              icon={<SearchIcon size={22} />}
            />
          ) : (
            <div id="search-results" role="listbox" aria-label={t('search.resultsLabel')}>
              {groups.map((group) => (
                <div key={group.key} className="search-group" role="group" aria-label={group.label}>
                  <div className="search-group__head">
                    <span
                      className="search-group__dot"
                      style={{ background: group.color }}
                      aria-hidden="true"
                    />
                    <span className="search-group__name">{group.label}</span>
                    <span className="search-group__count" aria-hidden="true">
                      {group.tasks.length}
                    </span>
                  </div>
                  {group.tasks.map((task) => {
                    const index = indexById.get(task.id) ?? 0;
                    const isActive = index === selected;
                    const due = dueLabel(task, today, t);
                    return (
                      <div
                        key={task.id}
                        id={`search-option-${task.id}`}
                        role="option"
                        aria-selected={isActive}
                        className={`search-row${isActive ? ' search-row--active' : ''}${
                          task.status === 'done' ? ' search-row--done' : ''
                        }${fresh.has(task.id) ? ' search-row--fresh' : ''}`}
                        onMouseMove={() => setSelected(index)}
                        onClick={() => openTask(task.id)}
                      >
                        <span
                          className="search-row__check"
                          onClick={(e) => e.stopPropagation()}
                          onMouseDown={(e) => e.stopPropagation()}
                        >
                          <Checkbox
                            checked={task.status === 'done'}
                            onChange={() => toggleDoneOption(task)}
                            aria-label={
                              task.status === 'done'
                                ? t('search.checkboxUncomplete', { title: task.title })
                                : t('search.checkboxComplete', { title: task.title })
                            }
                            tabIndex={-1}
                          />
                        </span>
                        <span className="search-row__title">
                          <HighlightedText text={task.title} query={query} />
                        </span>
                        <span className="search-row__meta">
                          {due ? <span className="search-row__due">{due}</span> : null}
                        </span>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          )}
        </ScrollArea>

        <footer className="search-panel__footer">
          <span>
            <kbd>↑</kbd>
            <kbd>↓</kbd> {t('search.footerSelect')}
          </span>
          <span>
            <kbd>Enter</kbd> {t('search.footerOpen')}
          </span>
          <span>
            <kbd>Esc</kbd> {t('search.footerClose')}
          </span>
        </footer>
      </div>
    </dialog>
  );
}
