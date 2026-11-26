import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ARM_DELAY_MS,
  armDelayMs,
  shouldArm,
} from '../src/data/DestructiveConfirm';
import {
  RESET_FAILED,
  RESET_SUCCEEDED,
  resetOutcome,
} from '../src/data/DataTransferPanel';

/**
 * The destructive-confirmation rules, pinned without a DOM.
 *
 * The repo's vitest runs in the node environment (no jsdom, no
 * vitest.config), so these tests cover the two behaviours that caused or can
 * cause data loss as pure functions:
 *
 *   1. the 600ms arm delay — the guard against the opening gesture (a double
 *      click, a scripted click, a held Enter) also firing the destructive
 *      action;
 *   2. the reset outcome — what the handler must do after `onReset` settles.
 *      The P0-4 bug was this map missing `closeConfirm` on the success path,
 *      which left the inner modal `showModal()` and the app `inert`.
 */

describe('armDelayMs', () => {
  it('keeps a positive delay as given', () => {
    expect(armDelayMs(600)).toBe(600);
    expect(armDelayMs(1)).toBe(1);
    expect(armDelayMs(2500)).toBe(2500);
  });

  it('treats a non-positive or NaN delay as "arm immediately"', () => {
    expect(armDelayMs(0)).toBe(0);
    expect(armDelayMs(-1)).toBe(0);
    expect(armDelayMs(Number.NaN)).toBe(0);
  });

  it('preserves Infinity, which means "never arms"', () => {
    expect(armDelayMs(Number.POSITIVE_INFINITY)).toBe(Number.POSITIVE_INFINITY);
  });
});

describe('shouldArm', () => {
  const delay = DEFAULT_ARM_DELAY_MS;

  it('refuses one millisecond before the delay (no early fire)', () => {
    expect(shouldArm(0, delay)).toBe(false);
    expect(shouldArm(delay - 1, delay)).toBe(false);
  });

  it('arms at exactly the delay', () => {
    expect(shouldArm(delay, delay)).toBe(true);
  });

  it('stays armed after the delay', () => {
    expect(shouldArm(delay + 1, delay)).toBe(true);
    expect(shouldArm(60_000, delay)).toBe(true);
  });

  it('the default delay is 600ms', () => {
    expect(DEFAULT_ARM_DELAY_MS).toBe(600);
  });

  it('a delay of 0 arms on the first tick', () => {
    expect(shouldArm(0, 0)).toBe(true);
  });

  it('a negative delay behaves like 0 rather than never arming', () => {
    expect(shouldArm(0, -50)).toBe(true);
  });

  it('Infinity never arms, however long the dialog has been open', () => {
    expect(shouldArm(0, Number.POSITIVE_INFINITY)).toBe(false);
    expect(shouldArm(Number.MAX_SAFE_INTEGER, Number.POSITIVE_INFINITY)).toBe(false);
  });
});

describe('resetOutcome — the P0-4 lock', () => {
  it('closes the confirmation modal on success', () => {
    // This single assertion is the regression guard: the success branch once
    // omitted the equivalent of this flag, and the app stayed inert.
    expect(resetOutcome(true).closeConfirm).toBe(true);
  });

  it('closes the panel and announces success only on success', () => {
    expect(resetOutcome(true)).toEqual({
      closeConfirm: true,
      closePanel: true,
      clearUndo: true,
      announce: 'resetDone',
    });
  });

  it('drops the undo stack on success (every row it pointed at is gone)', () => {
    expect(resetOutcome(true).clearUndo).toBe(true);
  });

  it('also closes the confirmation modal on failure', () => {
    expect(resetOutcome(false).closeConfirm).toBe(true);
  });

  it('keeps the panel open and the undo stack alive on failure', () => {
    expect(resetOutcome(false)).toEqual({
      closeConfirm: true,
      closePanel: false,
      clearUndo: false,
      announce: null,
    });
  });

  it('both outcomes close the modal — neither path may leave it open', () => {
    for (const ok of [true, false]) {
      expect(resetOutcome(ok).closeConfirm).toBe(true);
    }
  });

  it('exports frozen-by-shape constants that match the mapper', () => {
    expect(resetOutcome(true)).toBe(RESET_SUCCEEDED);
    expect(resetOutcome(false)).toBe(RESET_FAILED);
    // Structural sanity: the two differ in exactly the fields a failure must
    // change (no panel close, no undo clear, no announcement).
    expect(RESET_SUCCEEDED.closePanel).not.toBe(RESET_FAILED.closePanel);
    expect(RESET_SUCCEEDED.clearUndo).not.toBe(RESET_FAILED.clearUndo);
    expect(RESET_SUCCEEDED.announce).not.toBe(RESET_FAILED.announce);
  });
});
