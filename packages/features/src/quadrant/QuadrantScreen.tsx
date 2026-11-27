import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DragEvent as ReactDragEvent } from 'react';
import type { Instant, LocalDate, Task, TaskId, TaskList } from '@todolist/core';
import { isUrgentByClock, quadrantOf } from '@todolist/core';
import type { QuadrantKey } from '@todolist/ui';
import {
  Badge,
  CollapsibleSection,
  EmptyState,
  IconButton,
  PlusIcon,
  TextField,
  QUADRANT_COLOR,
  useTranslation,
} from '@todolist/ui';
import { useTasks } from '../data/useTasks';
import { useAppServices } from '../services';
import { useNowInstant } from '../shared/useNow';
import { dragVerdict } from './drag-verdict';
import { useToast } from '../undo/UndoProvider';
import { QuadrantRow, QUADRANT_DRAG_MIME } from './QuadrantRow';

export interface QuadrantScreenProps {
  lists: readonly TaskList[];
  today: LocalDate;
  /** Clicking a task's title opens it in the detail panel. */
  onOpenTask?: (id: TaskId) => void;
  /** Restrict to one list, or undefined for every task. */
  listId?: TaskList['id'] | null;
}

const ORDER: QuadrantKey[] = [
  'urgent-important',
  'not-urgent-important',
  'urgent-not-important',
  'unimportant',
];

/**
 * Domain quadrant key → catalog key. `QUADRANT_LABEL` in core stays the
 * canonical Chinese vocabulary for non-UI consumers; the screen renders the
 * translated name instead, so the label map can differ per language.
 */
const QUADRANT_NAME_KEY = {
  'urgent-important': 'quadrant.names.urgentImportant',
  'not-urgent-important': 'quadrant.names.notUrgentImportant',
  'urgent-not-important': 'quadrant.names.urgentNotImportant',
  unimportant: 'quadrant.names.unimportant',
} as const;

/**
 * How many completed rows an expanded footer shows. Long-lived boards collect
 * recurring copies indefinitely; nothing is deleted, but the disclosure only
 * paints the newest slice so the card stays readable. The section header still
 * shows the true total.
 */
const RECENT_COMPLETED_LIMIT = 20;

/**
 * `completedAt` is an ISO-8601 instant, so plain string comparison orders it.
 * Rows completed before the field existed have `completedAt: null`; those fall
 * back to `updatedAt`, which was stamped by the same write that closed them.
 */
function completedMoment(task: Task): string {
  return task.completedAt ?? task.updatedAt;
}

function byMostRecent(first: Task, second: Task): number {
  // Same ISO-8601 shape on every row, so a plain lexicographic compare is an
  // exact chronological order (and unlike `localeCompare`, deterministic).
  const a = completedMoment(first);
  const b = completedMoment(second);
  if (a === b) return 0;
  return a < b ? 1 : -1;
}

export function QuadrantScreen({ lists, today, onOpenTask, listId = null }: QuadrantScreenProps) {
  const { t } = useTranslation('lists');
  const quadrantName = useCallback((q: QuadrantKey) => t(QUADRANT_NAME_KEY[q]), [t]);
  const { tasks: taskService } = useAppServices();
  // `data` already contains the optimistic toggles from useTasks, so a
  // completion renders before the write resolves.
  const { data, error, loading, mutate, toggleDone, fresh } = useTasks();
  const notify = useToast();
  /*
   * ADR 0007：紧急由时钟派生，所以板需要一个会走的「现在」，每分钟 tick。
   * 没有它，一件事过期之后要等用户重新打开应用才会进 Q1 —— 那等于这条规则
   * 只在启动那一刻成立一次。
   *
   * 直接 as Instant：useNow 返回的是 ISO 字符串，与 core 的 Instant 同形
   * （仓库里 export-import.ts / WeekView.tsx 都是这个写法）。
   */
  const now = useNowInstant(true) as Instant;
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [dragOver, setDragOver] = useState<QuadrantKey | null>(null);
  /** Id of the row being dragged, so it can dim while it travels. */
  const [draggingId, setDraggingId] = useState<TaskId | null>(null);
  /** Announcement text for the live region (pointer *and* keyboard moves). */
  const [announcement, setAnnouncement] = useState('');
  /** Card to pulse after a move — the only visual feedback a keyboard user gets. */
  const [flash, setFlash] = useState<QuadrantKey | null>(null);
  const flashTimer = useRef<number | null>(null);
  /** Row whose handle should regain focus after a keyboard move re-renders it. */
  const pendingFocus = useRef<{ id: TaskId; quadrant: QuadrantKey } | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  // `dragenter`/`dragleave` fire for every child the pointer crosses; a
  // per-quadrant depth counter keeps the highlight from flickering off
  // between nested targets (a single counter would mix up two adjacent cards).
  const dragDepth = useRef<Partial<Record<QuadrantKey, number>>>({});

  const endDrag = useCallback(() => {
    dragDepth.current = {};
    setDragOver(null);
    setDraggingId(null);
  }, []);

  /**
   * Shared by both drop targets. `getData` is blocked during `dragover`, so
   * the highlight keys off `types`; by `drop` time the id is readable.
   */
  const isQuadrantDrag = (e: ReactDragEvent) => e.dataTransfer.types.includes(QUADRANT_DRAG_MIME);

  const all = useMemo(
    () => (data ?? []).filter((t) => listId === null || t.listId === listId),
    [data, listId],
  );
  const inboxListId = listId ?? lists[0]?.id;

  const grouped = useMemo(() => {
    const map: Record<QuadrantKey, { open: Task[]; done: Task[] }> = {
      'urgent-important': { open: [], done: [] },
      'not-urgent-important': { open: [], done: [] },
      'urgent-not-important': { open: [], done: [] },
      unimportant: { open: [], done: [] },
    };
    for (const task of all) {
      // 带时钟：过期的事自己走进 urgent 列，不需要用户去勾那个勾。
      const q = quadrantOf(task, now) as QuadrantKey;
      if (task.status === 'done') map[q].done.push(task);
      else map[q].open.push(task);
    }
    return map;
  }, [all]);

  const addTask = useCallback(
    async (quadrant: QuadrantKey) => {
      const title = (drafts[quadrant] ?? '').trim();
      if (!title) return;
      if (!inboxListId) {
        notify(t('quadrant.noList'));
        return;
      }
      setDrafts((d) => ({ ...d, [quadrant]: '' }));
      try {
        await mutate(async () => {
          const created = await taskService.createInbox(title, inboxListId);
          await taskService.moveToQuadrant(created.id, quadrant);
        });
      } catch (err) {
        console.error('添加任务失败', err);
        // Restore the draft so a failed create never silently eats the text.
        setDrafts((d) => ({ ...d, [quadrant]: title }));
        notify(t('quadrant.addFailed'));
      }
    },
    [drafts, inboxListId, mutate, notify, taskService, t],
  );

  /**
   * Quartile moves are user-controlled data (they flip `important`/`urgent`),
   * so they announce their result for keyboard users. Dropping onto the
   * quadrant the task already belongs to is a no-op: no write, no toast, no
   * announcement.
   */
  const moveTask = useCallback(
    async (id: TaskId, quadrant: QuadrantKey) => {
      const current = all.find((task) => task.id === id);
      if (!current || quadrantOf(current, now) === quadrant) return;

      /*
       * ADR 0007 决策 3：时钟有否决权。
       *
       * 一件已经过期的事不能被声明为「不紧急」—— 拖走它看起来会像成功，
       * 但下一帧它又因为过期被算回 urgent 列。与其让控件看起来失灵，
       * 不如拒绝并说明：他能做的只有做掉它，或者给它一个新日期。
       *
       * 用户自己标了紧急、但没到期的任务不受此限：那是他的判断，
       * 改变主意是他的权利。
       */
      const verdict = dragVerdict(isUrgentByClock(current, now));
      if (!verdict.allowed) {
        setAnnouncement(t('quadrant.cannotMoveOverdue', { title: current.title }));
        notify(t('quadrant.cannotMoveOverdue', { title: current.title }));
        return;
      }
      try {
        await mutate(() => taskService.moveToQuadrant(id, quadrant));
        setAnnouncement(t('quadrant.moved', { quadrant: quadrantName(quadrant) }));
        // The row unmounts from its old card and remounts in the new one, so
        // a focused handle loses focus. Move it with the task, then flash the
        // destination card so keyboard users can see where it went.
        pendingFocus.current = { id, quadrant };
        setFlash(quadrant);
        if (flashTimer.current !== null) window.clearTimeout(flashTimer.current);
        flashTimer.current = window.setTimeout(() => setFlash(null), 700);
      } catch (err) {
        console.error('移动象限失败', err);
        // The move is not optimistic: `mutate` only bumps the revision after
        // the write resolves, so a rejection leaves the rendered snapshot
        // untouched — nothing to roll back, but the user must be told.
        notify(t('quadrant.moveFailed'));
      }
    },
    [all, mutate, notify, now, quadrantName, taskService, t],
  );

  const toggle = useCallback(
    (id: TaskId, source: 'checkbox' | 'row') => {
      const title = all.find((task) => task.id === id)?.title ?? t('quadrant.untitledTask');
      toggleDone(id, title, source);
    },
    [all, toggleDone, t],
  );

  // A completion that fails is reported by `toggleDone`; a *load* failure was
  // previously indistinguishable from an empty board (both rendered nothing),
  // so surface it once per failed snapshot.
  useEffect(() => {
    if (error) notify(t('quadrant.loadFailed', { detail: error.message }));
  }, [error, notify, t]);

  useEffect(
    () => () => {
      if (flashTimer.current !== null) window.clearTimeout(flashTimer.current);
    },
    [],
  );

  // Runs after every render; only a pending move schedules work. The write is
  // async, so the row only lands in its new card *after* the post-write
  // refetch — hence this waits for the destination to actually contain the
  // row instead of consuming the pending id on the first render.
  useEffect(() => {
    const pending = pendingFocus.current;
    if (pending === null) return;
    const card = gridRef.current?.querySelector(`[data-qz-quadrant="${pending.quadrant}"]`);
    const handle = card?.querySelector<HTMLElement>(
      `[data-qz-task="${CSS.escape(pending.id)}"] .qz-row__handle`,
    );
    if (!handle) return;
    pendingFocus.current = null;
    handle.focus();
  }, [grouped]);

  if (loading && !data) return <EmptyState message={t('quadrant.loading')} />;
  if (error && !data)
    return <EmptyState message={t('quadrant.loadErrorTitle')} hint={t('quadrant.loadErrorHint')} />;

  return (
    <div ref={gridRef} className={`qz-grid${draggingId ? ' qz-grid--dragging' : ''}`}>
      {/* Polite live region: quadrant moves are user-controlled data, and
          keyboard users get no visual drag feedback. Always rendered so a
          changed string is what triggers the announcement. */}
      <span className="tl-visually-hidden" role="status" aria-live="polite" aria-atomic="true">
        {announcement}
      </span>
      {ORDER.map((q) => {
        const color = QUADRANT_COLOR[q];
        const open = grouped[q].open;
        const done = grouped[q].done;
        // Newest completions first; the disclosure paints only this slice so a
        // board that has been used for months stays readable. The header count
        // keeps showing `done.length`, the true total.
        const recentDone = [...done].sort(byMostRecent).slice(0, RECENT_COMPLETED_LIMIT);
        return (
          <section
            key={q}
            className={`qz-card${dragOver === q ? ' qz-card--over' : ''}${flash === q ? ' qz-card--flash' : ''}`}
            aria-label={quadrantName(q)}
            data-qz-quadrant={q}
            onDragEnter={(e) => {
              if (!isQuadrantDrag(e)) return;
              e.preventDefault();
              dragDepth.current[q] = (dragDepth.current[q] ?? 0) + 1;
              setDragOver(q);
            }}
            onDragOver={(e) => {
              if (!isQuadrantDrag(e)) return;
              // Only a preventDefault'ed dragover marks this as a drop target.
              e.preventDefault();
              e.dataTransfer.dropEffect = 'move';
            }}
            onDragLeave={(e) => {
              if (!isQuadrantDrag(e)) return;
              const depth = Math.max(0, (dragDepth.current[q] ?? 0) - 1);
              dragDepth.current[q] = depth;
              if (depth === 0) setDragOver((cur) => (cur === q ? null : cur));
            }}
            onDrop={(e) => {
              if (!isQuadrantDrag(e)) return;
              e.preventDefault();
              endDrag();
              const id = e.dataTransfer.getData(QUADRANT_DRAG_MIME) || e.dataTransfer.getData('text/plain');
              if (id) void moveTask(id as TaskId, q);
            }}
          >
            <header className="qz-card__head">
              <Badge label={quadrantName(q)} color={color.color} count={open.length} />
            </header>

            {/*
              One flex column owns the card's height: the add field (fixed),
              then the scrolling body (flex: 1, min-height: 0) which holds the
              open rows *and* the completed disclosure. The disclosure used to
              be a sibling of the scrolling list with no shrink limit, so a long
              completed list made the card's content taller than its fixed grid
              track — and because only the list clipped, the rest painted over
              the card below. Keeping a single scroll container is both simpler
              and impossible to overflow.
            */}
            <TextField
              value={drafts[q] ?? ''}
              onChange={(v) => setDrafts((d) => ({ ...d, [q]: v }))}
              onSubmit={() => void addTask(q)}
              placeholder={t('quadrant.addPlaceholder')}
              label={t('quadrant.addLabel', { quadrant: quadrantName(q) })}
              leadingIcon={<PlusIcon size={14} />}
              className="qz-card__add"
              /*
                Pointer/touch users had no way to submit: the only submit path
                was Enter, and `leadingIcon` is a decorative span. A real submit
                button trailing the input gives them one. It lives inside the
                field's existing flex row (`.tl-field` is `display: flex`), so
                `.qz-card__add` (flex: none + margin) needs no change.

                The label reuses the field's accessible name ("Add a task to
                …") — the locale catalog has no shorter "Add" verb, and the
                input right next to it already carries the quadrant context.
              */
              trailing={
                <IconButton
                  variant="quiet"
                  label={t('quadrant.addLabel', { quadrant: quadrantName(q) })}
                  disabled={(drafts[q] ?? '').trim().length === 0}
                  onClick={() => void addTask(q)}
                >
                  <PlusIcon size={16} />
                </IconButton>
              }
            />

            <div className="qz-card__body">
              {open.length === 0 && done.length === 0 ? (
                <div className="qz-card__empty">
                  <EmptyState compact />
                </div>
              ) : null}
              {open.map((task) => (
                <QuadrantRow
                  key={task.id}
                  task={task}

                  now={now}
                  lists={lists}
                  today={today}
                  onToggle={toggle}
                  onMove={moveTask}
                  onDragStart={setDraggingId}
                  onDragEnd={endDrag}
                  dragging={draggingId === task.id}
                  onOpen={onOpenTask}
                  fresh={fresh.has(task.id)}
                />
              ))}
              {/* Completed-this-moment rows: shown struck-through for one
                  animation beat so the tick visibly *does* something. */}
              {done
                .filter((t) => fresh.has(t.id))
                .map((task) => (
                  <QuadrantRow
                    key={`leaving-${task.id}`}
                    task={task}

                    now={now}
                    lists={lists}
                    today={today}
                    onToggle={toggle}
                    onOpen={onOpenTask}
                    fresh
                    leaving
                  />
                ))}

              {done.length > 0 ? (
                <div className="qz-card__done">
                  <CollapsibleSection
                    title={t('quadrant.completed')}
                    count={done.length}
                    defaultOpen={false}
                    footer={
                      done.length > recentDone.length
                        ? t('quadrant.completedRecent', {
                            shown: recentDone.length,
                            total: done.length,
                          })
                        : undefined
                    }
                  >
                    {recentDone.map((task) => (
                      <QuadrantRow
                        key={task.id}
                        task={task}

                        now={now}
                        lists={lists}
                        today={today}
                        onToggle={toggle}
                        onMove={moveTask}
                        onOpen={onOpenTask}
                        fresh={fresh.has(task.id)}
                      />
                    ))}
                  </CollapsibleSection>
                </div>
              ) : null}
            </div>
          </section>
        );
      })}
    </div>
  );
}
