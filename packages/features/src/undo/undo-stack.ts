/**
 * Framework-free undo/redo stack.
 *
 * Kept separate from React so ordering, eviction and empty-stack behaviour can
 * be tested without rendering. The provider owns *when* to bump the app
 * revision; this module only owns *what* is on the two stacks.
 */

export interface UndoCommand {
  /** Human-readable description of the action, e.g. `已删除「晨跑」`. */
  readonly label: string;
  undo(): Promise<void>;
  redo(): Promise<void>;
}

export interface UndoStack {
  push(command: UndoCommand): void;
  /** Executes and moves the newest undoable command to the redo stack. */
  undo(): Promise<UndoCommand | null>;
  /** Executes and moves the newest redoable command back to the undo stack. */
  redo(): Promise<UndoCommand | null>;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  clear(): void;
}

export const DEFAULT_UNDO_LIMIT = 50;

export function createUndoStack(max: number = DEFAULT_UNDO_LIMIT): UndoStack {
  const limit = Math.max(1, Math.floor(Number.isFinite(max) ? max : DEFAULT_UNDO_LIMIT));
  const past: UndoCommand[] = [];
  const future: UndoCommand[] = [];

  return {
    push(command) {
      past.push(command);
      // Oldest entry falls off the bottom once the cap is reached.
      if (past.length > limit) past.shift();
      // A fresh action invalidates anything that was undone before it.
      future.length = 0;
    },

    async undo() {
      const command = past[past.length - 1];
      if (!command) return null;
      // Execute before moving so a rejected command stays retryable.
      await command.undo();
      past.pop();
      future.push(command);
      return command;
    },

    async redo() {
      const command = future[future.length - 1];
      if (!command) return null;
      await command.redo();
      future.pop();
      past.push(command);
      return command;
    },

    get canUndo() {
      return past.length > 0;
    },

    get canRedo() {
      return future.length > 0;
    },

    clear() {
      past.length = 0;
      future.length = 0;
    },
  };
}
