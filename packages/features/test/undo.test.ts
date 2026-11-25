import { describe, expect, it } from 'vitest';
import { createUndoStack } from '../src/undo/undo-stack';
import type { UndoCommand } from '../src/undo/undo-stack';

/** A command that records when its halves run, so ordering is observable. */
function command(label: string, log: string[], failOnUndo = false): UndoCommand {
  return {
    label,
    async undo() {
      if (failOnUndo) throw new Error(`undo failed: ${label}`);
      log.push(`undo:${label}`);
    },
    async redo() {
      log.push(`redo:${label}`);
    },
  };
}

describe('createUndoStack', () => {
  it('reports empty stacks as no-ops', async () => {
    const stack = createUndoStack();
    expect(stack.canUndo).toBe(false);
    expect(stack.canRedo).toBe(false);
    await expect(stack.undo()).resolves.toBeNull();
    await expect(stack.redo()).resolves.toBeNull();
    expect(stack.canUndo).toBe(false);
    expect(stack.canRedo).toBe(false);
  });

  it('undoes newest-first and redoes in the original order', async () => {
    const log: string[] = [];
    const stack = createUndoStack();
    stack.push(command('a', log));
    stack.push(command('b', log));
    stack.push(command('c', log));

    expect(stack.canUndo).toBe(true);
    expect(stack.canRedo).toBe(false);

    await stack.undo();
    await stack.undo();
    expect(log).toEqual(['undo:c', 'undo:b']);
    expect(stack.canRedo).toBe(true);

    await stack.redo();
    expect(log).toEqual(['undo:c', 'undo:b', 'redo:b']);
    await stack.redo();
    expect(log).toEqual(['undo:c', 'undo:b', 'redo:b', 'redo:c']);

    expect(stack.canRedo).toBe(false);
    expect(stack.canUndo).toBe(true);
  });

  it('clears the redo stack when a new command is pushed', async () => {
    const log: string[] = [];
    const stack = createUndoStack();
    stack.push(command('a', log));
    await stack.undo();
    expect(stack.canRedo).toBe(true);

    stack.push(command('b', log));
    expect(stack.canRedo).toBe(false);

    await stack.redo();
    expect(log).toEqual(['undo:a']);
    await stack.undo();
    expect(log).toEqual(['undo:a', 'undo:b']);
  });

  it('evicts the oldest command once the cap is exceeded', async () => {
    const log: string[] = [];
    const stack = createUndoStack(3);
    for (const label of ['a', 'b', 'c', 'd', 'e']) {
      stack.push(command(label, log));
    }

    // Only c, d, e remain; three undos drain the stack and a fourth is a no-op.
    await stack.undo();
    await stack.undo();
    await stack.undo();
    await stack.undo();
    expect(log).toEqual(['undo:e', 'undo:d', 'undo:c']);

    // The evicted commands are unreachable via redo too.
    await stack.redo();
    expect(log).toEqual(['undo:e', 'undo:d', 'undo:c', 'redo:c']);
  });

  it('treats a non-positive cap as a single-slot stack', async () => {
    const log: string[] = [];
    const stack = createUndoStack(0);
    stack.push(command('a', log));
    stack.push(command('b', log));

    await stack.undo();
    await stack.undo();
    expect(log).toEqual(['undo:b']);
  });

  it('keeps a failed command on the stack so undo can be retried', async () => {
    const log: string[] = [];
    const stack = createUndoStack();
    stack.push(command('boom', log, true));

    await expect(stack.undo()).rejects.toThrow('undo failed: boom');
    expect(stack.canUndo).toBe(true);
    expect(stack.canRedo).toBe(false);

    stack.push(command('ok', log));
    await stack.undo();
    expect(log).toEqual(['undo:ok']);
    expect(stack.canUndo).toBe(true);
  });

  it('clear() empties both stacks', async () => {
    const log: string[] = [];
    const stack = createUndoStack();
    stack.push(command('a', log));
    await stack.undo();
    expect(stack.canRedo).toBe(true);

    stack.clear();
    expect(stack.canUndo).toBe(false);
    expect(stack.canRedo).toBe(false);
    await expect(stack.undo()).resolves.toBeNull();
    await expect(stack.redo()).resolves.toBeNull();
  });
});
