import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ListId, LocalDate, NewList, Task, TaskId, TaskList } from '@todolist/core';
import { daysFromToday, isSystemInbox, listDisplayName, todayLocal } from '@todolist/core';
import { IconButton, MoreIcon, PlusIcon, useTranslation } from '@todolist/ui';
import { DEFAULT_LIST_COLOR, LIST_HUE_HEX, ListEditor } from './ListEditor';
import type { ListEditorValue } from './ListEditor';
import type { UndoCommand } from '../undo/undo-stack';
import { useUndoOptional } from '../undo/UndoProvider';
import './lists.css';

/** The `lists` namespace translator, derived from the shared hook's return type. */
type ListsT = ReturnType<typeof useTranslation<'lists'>>['t'];

/**
 * Write port for lists.
 *
 * `AppServices` only exposes a read-only snapshot of lists today, so the
 * sidebar receives this API explicitly. The composition root is expected to
 * satisfy it from `UnitOfWork.lists` (see report):
 *
 *   api = {
 *     create: (input) => uow.lists.create(input, clock.now()),
 *     rename: (id, name) => uow.lists.update(id, { name }, clock.now()),
 *     recolor: (id, color) => uow.lists.update(id, { color }, clock.now()),
 *     remove: (id) => uow.lists.remove(id),
 *   }
 *
 * When `api` is omitted/undefined the whole management UI still renders, but
 * every mutating control is disabled and points at an explanation.
 */
export interface ListsApi {
  create(input: NewList): Promise<TaskList>;
  rename(id: ListId, name: string): Promise<TaskList>;
  recolor(id: ListId, color: string): Promise<TaskList>;
  remove(id: ListId): Promise<void>;
}

/** Which shortcut/list the sidebar is currently highlighting. */
export type SidebarFilter =
  | { readonly kind: 'today' }
  | { readonly kind: 'recent' }
  | { readonly kind: 'all' }
  | { readonly kind: 'list'; readonly listId: ListId };

export interface ListSidebarProps {
  lists: readonly TaskList[];
  tasks: readonly Task[];
  /** Currently selected list, for row highlight. `null` = no list selected. */
  selectedListId?: ListId | null;
  /** Emits the clicked shortcut/list filter. */
  onSelect: (filter: SidebarFilter) => void;
  /** List write port; omit when unavailable — mutations become disabled. */
  api?: ListsApi;
  /**
   * Move a task to another list. A drag-drop counterpart of `api`: when the
   * shell owns the task service it passes this in, and drops become undoable.
   */
  moveTask?: (taskId: TaskId, listId: ListId) => Promise<unknown>;
  /** Today's local date — used for the shortcut counts. */
  today?: LocalDate;
  /**
   * Called after the shell should reload lists/tasks following a write.
   * If it returns a promise, the sidebar awaits it before closing the editor,
   * so a host that re-reads there can push a restore command synchronously.
   */
  onChanged?: () => void | Promise<void>;
  /**
   * Record an inverse action for the app-wide undo stack. Without it, writes
   * still work but cannot be undone. The command must be built *before* the
   * change lands, from the data that is about to be replaced.
   */
  onUndoable?: (command: UndoCommand) => void;
}

const MISSING_PORT_HINT_ID = 'list-sidebar-write-port-hint';

/**
 * True when dropping `taskId` on `listId` would actually move it. Dropping a
 * task on the list it already belongs to (or on a list that no longer holds
 * the task) must be a no-op: `moveToList` would otherwise write and bump
 * `updatedAt` for a row that did not move.
 */
export function isRealListMove(
  tasks: readonly Task[],
  taskId: TaskId,
  listId: ListId,
): boolean {
  const task = tasks.find((t) => t.id === taskId);
  return task !== undefined && task.listId !== listId;
}

/**
 * Human explanation for why a list cannot be deleted. `ListService.remove`
 * refuses while *any* task remains (open or done), so the copy must report the
 * total and tell the user what to do — the service error alone says only
 * "清单仍有 N 个任务".
 *
 * Copy comes from the `lists` catalog; the translator is passed in so this
 * stays a pure, unit-testable function (it is exercised with the `en` locale).
 */
export function describeListDeletionBlock(
  t: ListsT,
  listName: string,
  openCount: number,
  totalCount: number,
): string | null {
  if (totalCount <= 0) return null;
  if (openCount === totalCount) {
    return t('sidebar.deletionOpenOnly', { name: listName, count: totalCount });
  }
  if (openCount === 0) {
    return t('sidebar.deletionDoneOnly', { name: listName, count: totalCount });
  }
  return t('sidebar.deletionMixed', { name: listName, count: totalCount, open: openCount });
}

/** Open tasks with a due date in [today, today+6]. */
function isRecent(task: Task, today: LocalDate): boolean {
  if (task.status === 'done' || task.dueDate === null) return false;
  const diff = daysFromToday(task.dueDate, today);
  return diff >= 0 && diff <= 6;
}

/**
 * The name to *show* for a list. User lists show their stored name; the system
 * inbox shows the catalog's word for it, so switching language renames it in
 * place. Re-exported from core (the pure rule lives with the domain type) so
 * every surface resolves it the same way.
 */
export { listDisplayName };

/**
 * Expanded "清单" sidebar section. Purely presentational: it receives tasks and
 * lists as props, reports selections upward, and delegates every write to
 * `api`. It never imports an adapter or a service instance.
 */
export function ListSidebar({
  lists,
  tasks,
  selectedListId = null,
  onSelect,
  api,
  today = todayLocal(),
  onChanged,
  onUndoable,
  moveTask,
}: ListSidebarProps) {
  const { t } = useTranslation('lists');
  const { t: tCommon } = useTranslation('common');
  const missingPortText = t('sidebar.missingPort');
  const [creating, setCreating] = useState(false);
  const [menuId, setMenuId] = useState<ListId | null>(null);
  const [renamingId, setRenamingId] = useState<ListId | null>(null);
  const [recoloringId, setRecoloringId] = useState<ListId | null>(null);
  const [deletingId, setDeletingId] = useState<ListId | null>(null);
  const [dropTarget, setDropTarget] = useState<ListId | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [quick, setQuick] = useState<'today' | 'recent' | 'all' | null>(null);
  const sidebarRef = useRef<HTMLElement | null>(null);

  const readOnly = api === undefined || api === null;
  // Writes are undoable whenever the app-wide stack is mounted. Read through
  // an optional hook so the sidebar still renders in isolation.
  const undoStack = useUndoOptional();
  const recordUndoable = onUndoable ?? undoStack?.push;

  // A list selection is mutually exclusive with the shortcut highlight.
  useEffect(() => {
    if (selectedListId !== null) setQuick(null);
  }, [selectedListId]);

  useEffect(() => {
    if (!menuId) return;
    const onPointer = (e: PointerEvent) => {
      const target = e.target as Node | null;
      if (target && sidebarRef.current?.contains(target)) return;
      setMenuId(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuId(null);
    };
    document.addEventListener('pointerdown', onPointer, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuId]);

  const counts = useMemo(() => {
    const byList = new Map<string, number>();
    // Total rows per list, completed included. `ListService.remove` refuses
    // while *any* task remains, so delete eligibility must use this count —
    // using the open-only count would offer a delete that always fails.
    const totalByList = new Map<string, number>();
    let openTotal = 0;
    let dueToday = 0;
    let recent = 0;
    for (const task of tasks) {
      totalByList.set(task.listId, (totalByList.get(task.listId) ?? 0) + 1);
      if (task.status === 'done') continue;
      openTotal += 1;
      byList.set(task.listId, (byList.get(task.listId) ?? 0) + 1);
      if (task.dueDate === today) dueToday += 1;
      if (isRecent(task, today)) recent += 1;
    }
    return { byList, totalByList, openTotal, dueToday, recent };
  }, [tasks, today]);

  const closeEditors = useCallback(() => {
    setMenuId(null);
    setRenamingId(null);
    setRecoloringId(null);
    setDeletingId(null);
    setActionError(null);
  }, []);

  const runWrite = useCallback(
    async (fn: (target: ListsApi) => Promise<unknown>, command?: UndoCommand) => {
      if (!api) return;
      setActionError(null);
      try {
        await fn(api);
        closeEditors();
        setCreating(false);
        await onChanged?.();
        // Push only after the write AND the reload, so the undo closure sees
        // the post-write world it has to reverse.
        if (command) recordUndoable?.(command);
      } catch (err: unknown) {
        setActionError(err instanceof Error ? err.message : String(err));
      }
    },
    [api, closeEditors, onChanged, recordUndoable],
  );

  const handleCreate = useCallback(
    (value: ListEditorValue) => {
      let created: TaskList | undefined;
      const command: UndoCommand = {
        label: t('undo.createList', { name: value.name }),
        undo: async () => {
          if (created) await api?.remove(created.id);
          await onChanged?.();
        },
        redo: async () => {
          if (!api) return;
          created = await api.create({ name: value.name, color: value.color });
          await onChanged?.();
        },
      };
      return runWrite(async (target) => {
        created = await target.create({ name: value.name, color: value.color });
      }, command);
    },
    [api, onChanged, runWrite, t],
  );

  const handleRename = useCallback(
    (id: ListId, value: ListEditorValue) => {
      const current = lists.find((l) => l.id === id);
      const before = { name: current?.name, color: current?.color };
      const command: UndoCommand | undefined =
        current && (before.name !== value.name || before.color !== value.color)
          ? {
              label: t('undo.renameList', { name: before.name }),
              undo: async () => {
                if (before.name === undefined || before.color === undefined) return;
                await api?.rename(id, before.name);
                await api?.recolor(id, before.color);
                await onChanged?.();
              },
              redo: async () => {
                await api?.rename(id, value.name);
                await api?.recolor(id, value.color);
                await onChanged?.();
              },
            }
          : undefined;
      return runWrite(async (target) => {
        // Rename and recolor are separate operations on the port.
        await target.rename(id, value.name);
        await target.recolor(id, value.color);
      }, command);
    },
    [api, lists, onChanged, runWrite, t],
  );

  const handleRecolor = useCallback(
    (id: ListId, color: string) => {
      const before = lists.find((l) => l.id === id)?.color;
      const command: UndoCommand | undefined =
        before !== undefined && before !== color
          ? {
              label: t('undo.recolorList'),
              undo: async () => {
                await api?.recolor(id, before);
                await onChanged?.();
              },
              redo: async () => {
                await api?.recolor(id, color);
                await onChanged?.();
              },
            }
          : undefined;
      return runWrite((target) => target.recolor(id, color), command);
    },
    [api, lists, onChanged, runWrite, t],
  );

  const handleRemove = useCallback(
    (id: ListId) => {
      if (api === undefined || api === null) return;
      const list = lists.find((l) => l.id === id);
      // The system inbox is app-owned: deleting it would remove the one list
      // whose identity drives the localized display name. Its menu does not
      // offer this action; this guard is the second line of defence.
      if (list !== undefined && isSystemInbox(list)) return;
      // The domain refuses to delete a list that still holds tasks — open or
      // completed (`ListNotEmptyError`) — so that work is never cascade-deleted.
      // Surface the full rule *before* the confirm step: how many rows, and
      // what to do instead.
      const open = counts.byList.get(id) ?? 0;
      const total = counts.totalByList.get(id) ?? 0;
      void (async () => {
        const block = describeListDeletionBlock(
          t,
          list ? listDisplayName(list, t('quadrant.inbox')) : t('sidebar.untitledList'),
          open,
          total,
        );
        if (block !== null) {
          setActionError(block);
          setDeletingId(null);
          return;
        }
        const wasSelected = selectedListId === id;
        // Capture the replacement *before* the write so the inverse can find
        // it; `create` mints a new id, which the label must not pretend is the
        // old one.
        let undoId: ListId | null = null;
        await runWrite(
          async (target) => {
            await target.remove(id);
          },
          list
            ? {
                label: t('undo.deleteList', { name: listDisplayName(list, t('quadrant.inbox')) }),
                undo: async () => {
                  if (!api) return;
                  const recreated = await api.create({
                    name: list.name,
                    color: list.color,
                    order: list.order,
                  });
                  undoId = recreated.id;
                  await onChanged?.();
                },
                redo: async () => {
                  const target = undoId ?? id;
                  await api?.remove(target);
                  await onChanged?.();
                },
              }
            : undefined,
        );
        // Never leave the user filtered to a list that no longer exists.
        if (wasSelected) onSelect({ kind: 'all' });
      })();
    },
    [api, counts, lists, onChanged, onSelect, runWrite, selectedListId, t],
  );

  const quickFilters: { filter: SidebarFilter; key: 'today' | 'recent' | 'all'; label: string; count: number }[] = [
    { filter: { kind: 'today' }, key: 'today', label: t('sidebar.today'), count: counts.dueToday },
    { filter: { kind: 'recent' }, key: 'recent', label: t('sidebar.recent'), count: counts.recent },
    { filter: { kind: 'all' }, key: 'all', label: t('sidebar.all'), count: counts.openTotal },
  ];

  return (
    <aside className="list-sidebar" aria-label={t('sidebar.nav')} ref={sidebarRef}>
      <nav className="list-sidebar__quick" aria-label={t('sidebar.quickFilters')}>
        {quickFilters.map(({ filter, key, label, count }) => {
          const active = quick === key;
          return (
            <button
              key={key}
              type="button"
              className={`list-sidebar__quick-item${active ? ' list-sidebar__quick-item--active' : ''}`}
              aria-current={active ? 'true' : undefined}
              onClick={() => {
                setQuick(key);
                onSelect(filter);
              }}
            >
              <span className="list-sidebar__quick-label">{label}</span>
              <span className="list-sidebar__quick-count" aria-hidden="true">
                {count}
              </span>
            </button>
          );
        })}
      </nav>

      <div className="list-sidebar__head">
        <span className="list-sidebar__heading">{t('sidebar.heading')}</span>
        <IconButton
          label={t('sidebar.newList')}
          variant="quiet"
          disabled={readOnly}
          title={readOnly ? missingPortText : t('sidebar.newList')}
          aria-describedby={readOnly ? MISSING_PORT_HINT_ID : undefined}
          onClick={() => {
            closeEditors();
            setCreating((v) => !v);
          }}
        >
          <PlusIcon size={15} />
        </IconButton>
      </div>

      {creating ? (
        <div className="list-sidebar__editor">
          <ListEditor
            mode="create"
            initialColor={LIST_HUE_HEX[lists.length % LIST_HUE_HEX.length] ?? DEFAULT_LIST_COLOR}
            disabled={readOnly}
            onSubmit={handleCreate}
            onCancel={() => setCreating(false)}
          />
        </div>
      ) : null}

      {actionError ? (
        <p className="list-sidebar__error" role="alert">
          {actionError}
        </p>
      ) : null}

      {lists.length === 0 ? (
        <p className="list-sidebar__empty">{t('sidebar.noLists')}</p>
      ) : (
        <ul className="list-sidebar__lists">
          {lists.map((list) => {
            const count = counts.byList.get(list.id) ?? 0;
            const totalCount = counts.totalByList.get(list.id) ?? 0;
            const blocked = totalCount > 0;
            const active = selectedListId === list.id && quick === null;
            const isMenuOpen = menuId === list.id;
            const isRenaming = renamingId === list.id;
            const isRecoloring = recoloringId === list.id;
            const isDeleting = deletingId === list.id;
            // Identity, not name: the inbox is app-owned, so its display name
            // comes from the catalog and two of the three menu actions (rename,
            // delete) would either be overwritten by i18n or destroy the
            // fallback. Both are hidden rather than silently ignored; recolour
            // stays, because a colour is not part of the identity.
            const isSystem = isSystemInbox(list);
            const displayName = listDisplayName(list, t('quadrant.inbox'));

            return (
              <li
                key={list.id}
                className={`list-sidebar__item${active ? ' list-sidebar__item--active' : ''}${
                  dropTarget === list.id ? ' list-sidebar__item--drop' : ''
                }`}
                onDragOver={(e) => {
                  if (!moveTask) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = 'move';
                  setDropTarget(list.id);
                }}
                onDragLeave={() => setDropTarget((cur) => (cur === list.id ? null : cur))}
                onDrop={(e) => {
                  if (!moveTask) return;
                  e.preventDefault();
                  setDropTarget(null);
                  const raw = e.dataTransfer.getData('text/plain');
                  if (!raw) return;
                  // Dropping a task on the list it already belongs to must be a
                  // no-op: `moveToList` would still write and bump `updatedAt`
                  // for a row that did not move.
                  if (!isRealListMove(tasks, raw as TaskId, list.id)) return;
                  const source = tasks.find((t) => t.id === raw)!;
                  const targetList = list;
                  void (async () => {
                    try {
                      await moveTask(source.id, targetList.id);
                    } catch (err: unknown) {
                      setActionError(err instanceof Error ? err.message : String(err));
                      return;
                    }
                    await onChanged?.();
                    // Only record once the move actually landed.
                    if (moveTask) {
                      recordUndoable?.({
                        label: t('undo.moveTask', { task: source.title, list: displayName }),
                        undo: async () => {
                          await moveTask(source.id, source.listId);
                          await onChanged?.();
                        },
                        redo: async () => {
                          await moveTask(source.id, targetList.id);
                          await onChanged?.();
                        },
                      });
                    }
                  })();
                }}
              >
                <div className="list-sidebar__row">
                  <button
                    type="button"
                    className="list-sidebar__select"
                    aria-current={active ? 'true' : undefined}
                    onClick={() => {
                      setQuick(null);
                      onSelect({ kind: 'list', listId: list.id });
                    }}
                  >
                    <span
                      className="list-sidebar__dot"
                      style={{ background: list.color }}
                      aria-hidden="true"
                    />
                    <span className="list-sidebar__name">{displayName}</span>
                    <span className="list-sidebar__count" aria-label={t('sidebar.taskCount', { count })}>
                      {count}
                    </span>
                  </button>

                  <div className="list-sidebar__menu-wrap">
                    <IconButton
                      label={t('sidebar.listActions', { name: displayName })}
                      variant="quiet"
                      className="list-sidebar__more"
                      aria-haspopup="menu"
                      aria-expanded={isMenuOpen}
                      onClick={() => {
                        setActionError(null);
                        setRenamingId(null);
                        setRecoloringId(null);
                        setDeletingId(null);
                        setMenuId((cur) => (cur === list.id ? null : list.id));
                      }}
                    >
                      <MoreIcon size={15} />
                    </IconButton>

                    {isMenuOpen ? (
                      <div className="list-sidebar__menu" role="menu" aria-label={t('sidebar.menuLabel', { name: displayName })}>
                        {isSystem ? null : (
                          <button
                            type="button"
                            role="menuitem"
                            className="list-sidebar__menu-item"
                            disabled={readOnly || isRenaming}
                            title={readOnly ? missingPortText : undefined}
                            aria-describedby={readOnly ? MISSING_PORT_HINT_ID : undefined}
                            onClick={() => {
                              setMenuId(null);
                              setRenamingId(list.id);
                            }}
                          >
                            {t('menu.rename')}
                          </button>
                        )}
                        <button
                          type="button"
                          role="menuitem"
                          className="list-sidebar__menu-item"
                          disabled={readOnly || isRecoloring}
                          title={readOnly ? missingPortText : undefined}
                          aria-describedby={readOnly ? MISSING_PORT_HINT_ID : undefined}
                          onClick={() => {
                            setMenuId(null);
                            setRecoloringId(list.id);
                          }}
                        >
                          {t('menu.recolor')}
                        </button>
                        {isSystem ? null : (
                          <button
                            type="button"
                            role="menuitem"
                            className="list-sidebar__menu-item list-sidebar__menu-item--danger"
                            disabled={readOnly}
                            title={readOnly ? missingPortText : undefined}
                            aria-describedby={readOnly ? MISSING_PORT_HINT_ID : undefined}
                            onClick={() => {
                              setMenuId(null);
                              setDeletingId(list.id);
                            }}
                          >
                            {t('menu.delete')}
                          </button>
                        )}
                      </div>
                    ) : null}
                  </div>
                </div>

                {isRenaming ? (
                  <div className="list-sidebar__editor">
                    <ListEditor
                      mode="rename"
                      initialName={list.name}
                      initialColor={list.color}
                      disabled={readOnly}
                      onSubmit={(value) => handleRename(list.id, value)}
                      onCancel={() => setRenamingId(null)}
                    />
                  </div>
                ) : null}

                {isRecoloring ? (
                  <div className="list-sidebar__recolor" role="group" aria-label={t('sidebar.colorGroup', { name: displayName })}>
                    {LIST_HUE_HEX.map((hue, i) => (
                      <button
                        key={hue}
                        type="button"
                        className={`list-sidebar__swatch${list.color === hue ? ' list-sidebar__swatch--selected' : ''}`}
                        style={{ background: hue }}
                        aria-label={t('sidebar.colorSwatch', { index: i + 1 })}
                        aria-pressed={list.color === hue}
                        disabled={readOnly}
                        title={readOnly ? missingPortText : t('sidebar.colorSwatch', { index: i + 1 })}
                        aria-describedby={readOnly ? MISSING_PORT_HINT_ID : undefined}
                        onClick={() => handleRecolor(list.id, hue)}
                      />
                    ))}
                    <button
                      type="button"
                      className="list-sidebar__cancel"
                      onClick={() => setRecoloringId(null)}
                    >
                      {tCommon('buttons.cancel')}
                    </button>
                  </div>
                ) : null}

                {isDeleting ? (
                  <div className="list-sidebar__confirm" role="alertdialog" aria-label={t('deleteConfirm.dialogLabel', { name: displayName })}>
                    <p className="list-sidebar__confirm-text">
                      {blocked
                        ? t('deleteConfirm.blocked', { name: displayName, count: totalCount, open: count })
                        : t('deleteConfirm.question', { name: displayName })}
                    </p>
                    <div className="list-sidebar__confirm-actions">
                      <button
                        type="button"
                        className="list-sidebar__cancel"
                        onClick={() => setDeletingId(null)}
                      >
                        {tCommon('buttons.cancel')}
                      </button>
                      <button
                        type="button"
                        className="list-sidebar__danger"
                        disabled={readOnly || blocked}
                        title={readOnly ? missingPortText : blocked ? t('deleteConfirm.blockedHint') : undefined}
                        aria-describedby={readOnly ? MISSING_PORT_HINT_ID : undefined}
                        onClick={() => handleRemove(list.id)}
                      >
                        {t('deleteConfirm.confirm')}
                      </button>
                    </div>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      <p id={MISSING_PORT_HINT_ID} className="tl-visually-hidden">
        {missingPortText}
      </p>
    </aside>
  );
}
