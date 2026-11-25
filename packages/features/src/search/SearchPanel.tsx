import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { LocalDate, Task, TaskId } from '@todolist/core';
import { daysFromToday, todayLocal } from '@todolist/core';
import { Checkbox, EmptyState, ScrollArea, SearchIcon, TextField } from '@todolist/ui';
import { useLists } from '../services';
import { useTasks } from '../data/useTasks';
import { applyFilters, highlightRanges, sortByRelevance } from './search';
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

/** Human label for a due date: 今天 / 明天 / 昨天 / M月D日. */
function dueLabel(task: Task, today: LocalDate): string | null {
  if (task.dueDate === null) return null;
  const diff = daysFromToday(task.dueDate, today);
  if (diff === 0) return '今天';
  if (diff === 1) return '明天';
  if (diff === 2) return '后天';
  if (diff === -1) return '昨天';
  const parts = task.dueDate.split('-');
  const month = parts[1];
  const day = parts[2];
  if (!month || !day) return null;
  return `${Number(month)}月${Number(day)}日`;
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
 * query state and keyboard selection. Focus moves to the input on open, Tab is
 * trapped inside the panel, and the previously focused element is restored
 * when the overlay closes.
 */
export function SearchPanel({ open, onClose, onOpenTask }: SearchPanelProps) {
  const { data, toggleDone, fresh } = useTasks();
  const lists = useLists();

  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const [today] = useState<LocalDate>(() => todayLocal());

  const panelRef = useRef<HTMLDivElement | null>(null);
  const restoreRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  const filtered = useMemo(() => {
    const listNames = new Map<string, string>(lists.map((l) => [l.id, l.name]));
    return sortByRelevance(
      applyFilters(data ?? [], { query, status: 'all', listId: null, listNames }),
      query,
      listNames,
    );
  }, [data, query, lists]);

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
        out.push({ key: list.id, label: list.name, color: list.color, tasks: bucket });
        byList.delete(list.id);
      }
    }
    for (const [listId, bucket] of byList) {
      if (bucket.length > 0) {
        const list = lists.find((l) => l.id === listId);
        out.push({
          key: listId,
          label: list?.name ?? '未分类',
          color: list?.color ?? FALLBACK_COLOR,
          tasks: bucket,
        });
      }
    }
    return out;
  }, [filtered, lists]);

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

  // Focus in on open, restore on close, and trap Tab. Esc/restore live in an
  // effect keyed only on `open` so a new onClose identity cannot churn focus.
  useEffect(() => {
    if (!open) return;
    restoreRef.current = (document.activeElement as HTMLElement | null) ?? null;

    const focusTimer = window.setTimeout(() => {
      panelRef.current?.querySelector<HTMLInputElement>('.tl-field__input')?.focus();
    }, 0);

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (e.key !== 'Tab') return;
      const panel = panelRef.current;
      if (!panel) return;
      const focusables = panel.querySelectorAll<HTMLElement>(
        'input, button, [href], [tabindex]:not([tabindex="-1"])',
      );
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (!first || !last) return;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKey);
    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener('keydown', onKey);
      restoreRef.current?.focus?.();
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

  if (!open) return null;

  const activeTask = flat[selected];
  const activeId = activeTask ? `search-option-${activeTask.id}` : undefined;
  const hasQuery = query.trim().length > 0;

  return (
    <div
      className="search-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="search-panel"
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="搜索任务"
      >
        <div className="search-panel__input">
          <TextField
            value={query}
            onChange={setQuery}
            placeholder="搜索任务标题或备注…"
            label="搜索任务"
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
              message="没有匹配的任务"
              hint={hasQuery ? `没有找到与「${query.trim()}」相关的结果` : '输入关键词开始搜索'}
              icon={<SearchIcon size={22} />}
            />
          ) : (
            <div id="search-results" role="listbox" aria-label="搜索结果">
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
                    const due = dueLabel(task, today);
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
                              task.status === 'done' ? `取消完成 ${task.title}` : `完成 ${task.title}`
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
            <kbd>↓</kbd> 选择
          </span>
          <span>
            <kbd>Enter</kbd> 打开
          </span>
          <span>
            <kbd>Esc</kbd> 关闭
          </span>
        </footer>
      </div>
    </div>
  );
}
