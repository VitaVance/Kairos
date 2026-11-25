import { useCallback, useState } from 'react';
import { todayLocal } from '@todolist/core';
import type { LocalDate, ListId, Quadrant } from '@todolist/core';
import { PlusIcon, TextField, useTranslation } from '@todolist/ui';
import { useTasks } from '../data/useTasks';
import { useAppServices } from '../services';
import { useToast } from '../undo/UndoProvider';
import { parseQuickAdd } from './due-label';

export interface QuickAddProps {
  /** Called after a task is created (the shell bumps its revision). */
  onCreated?: () => void;
  /** Defaults to the machine's local day; overridable for tests. */
  today?: LocalDate;
}

/** Importance × urgency → quadrant, matching the tokens `/重要` and `/紧急`. */
function quadrantFor(important: boolean, urgent: boolean): Quadrant {
  if (important && urgent) return 'urgent-important';
  if (important) return 'not-urgent-important';
  if (urgent) return 'urgent-not-important';
  return 'unimportant';
}

/**
 * Command-style capture box for the top bar. Self-contained: it reads the
 * service + first list from context and writes via `mutate`, so any screen
 * that shows it refreshes without parent wiring.
 */
export function QuickAdd({ onCreated, today = todayLocal() }: QuickAddProps) {
  const { t } = useTranslation('task');
  const { tasks: taskService, lists } = useAppServices();
  const { mutate } = useTasks();
  const notify = useToast();
  const [value, setValue] = useState('');

  const submit = useCallback(
    async (raw: string) => {
      const parsed = parseQuickAdd(raw, today);
      if (parsed.title.length === 0) return;

      const listId: ListId | undefined = lists[0]?.id;
      if (!listId) {
        // Without a list there is nowhere to put the task; say so instead of
        // swallowing the keypress (a no-op here reads as a broken input).
        notify(t('quickAdd.noList'));
        return;
      }

      // Clear optimistically for the instant feedback a capture box needs, but
      // put the text back if the write fails — otherwise the user's only copy
      // of what they typed is gone.
      setValue('');
      try {
        await mutate(async () => {
          const created = await taskService.createInbox(parsed.title, listId);
          if (parsed.important || parsed.urgent) {
            await taskService.moveToQuadrant(created.id, quadrantFor(parsed.important, parsed.urgent));
          }
          if (parsed.dueDate !== null && parsed.dueTime !== null) {
            // The union keeps the instant construction inside core
            // (`instantAtLocal`); hand-building an ISO string here was the
            // design doc's DO-NOT pattern.
            await taskService.schedule(created.id, {
              kind: 'time',
              date: parsed.dueDate,
              time: parsed.dueTime,
            });
          }
        });
      } catch (error) {
        console.error('Quick add task failed', error);
        setValue((current) => (current.length === 0 ? raw : current));
        notify(t('quickAdd.failed'));
        return;
      }
      onCreated?.();
    },
    [lists, mutate, notify, onCreated, taskService, today, t],
  );

  return (
    <div className="tk-quickadd">
      <TextField
        value={value}
        onChange={setValue}
        onSubmit={() => void submit(value)}
        leadingIcon={<PlusIcon />}
        placeholder={t('quickAdd.placeholder')}
        label={t('quickAdd.label')}
        aria-keyshortcuts="Enter"
      />
    </div>
  );
}
