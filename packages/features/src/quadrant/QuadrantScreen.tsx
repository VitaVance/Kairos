import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DragEvent as ReactDragEvent } from 'react';
import type { LocalDate, Task, TaskId, TaskList } from '@todolist/core';
import { quadrantOf } from '@todolist/core';
import type { QuadrantKey } from '@todolist/ui';
import { Badge, CollapsibleSection, EmptyState, TextField, QUADRANT_COLOR, useTranslation } from '@todolist/ui';
import { useTasks } from '../data/useTasks';
import { useAppServices } from '../services';
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

export function QuadrantScreen({ lists, today, onOpenTask, listId = null }: QuadrantScreenProps) {
  const { t } = useTranslation('lists');
  const quadrantName = useCallback((q: QuadrantKey) => t(QUADRANT_NAME_KEY[q]), [t]);
  const { tasks: taskService } = useAppServices();
  // `data` already contains the optimistic toggles from useTasks, so a
  // completion renders before the write resolves.
  const { data, error, loading, mutate, toggleDone, fresh } = useTasks();
  const notify = useToast();
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
      const q = quadrantOf(task) as QuadrantKey;
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
      if (!current || quadrantOf(current) === quadrant) return;
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
    [all, mutate, notify, quadrantName, taskService, t],
  );

  const toggle = useCallback(
    (id: TaskId) => {
      const title = all.find((task) => task.id === id)?.title ?? t('quadrant.untitledTask');
      toggleDone(id, title);
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

            <TextField
              value={drafts[q] ?? ''}
              onChange={(v) => setDrafts((d) => ({ ...d, [q]: v }))}
              onSubmit={() => void addTask(q)}
              placeholder={t('quadrant.addPlaceholder')}
              label={t('quadrant.addLabel', { quadrant: quadrantName(q) })}
              className="qz-card__add"
            />

            <div className="qz-card__list">
              {open.length === 0 && done.length === 0 ? <EmptyState compact /> : null}
              {open.map((task) => (
                <QuadrantRow
                  key={task.id}
                  task={task}
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
                    lists={lists}
                    today={today}
                    onToggle={toggle}
                    onOpen={onOpenTask}
                    fresh
                    leaving
                  />
                ))}
            </div>

            {done.length > 0 ? (
              <CollapsibleSection title={t('quadrant.completed')} count={done.length} defaultOpen={false}>
                {done.map((task) => (
                  <QuadrantRow
                    key={task.id}
                    task={task}
                    lists={lists}
                    today={today}
                    onToggle={toggle}
                    onMove={moveTask}
                    onOpen={onOpenTask}
                    fresh={fresh.has(task.id)}
                  />
                ))}
              </CollapsibleSection>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}
