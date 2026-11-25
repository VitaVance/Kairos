import { useCallback, useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import type { LocalDate } from '@todolist/core';
import type { MinuteBounds } from './time-math';
import { isDragDistance, minuteAtOffset, selectionRange } from './time-math';

/** A live drag selection within one column, in snapped minutes of day. */
export interface RangeSelection {
  day: LocalDate;
  /** Low endpoint. */
  start: number;
  /** High endpoint; always strictly greater than `start`. */
  end: number;
}

export interface TimeRangeSelectionOptions {
  /** Off when the host did not supply a range handler. */
  enabled: boolean;
  /** Visible minute span of the column (e.g. 08:00–20:00). */
  bounds: MinuteBounds;
  /** Vertical scale of the grid — pixels occupied by one minute. */
  pxPerMinute: number;
  /**
   * CSS selector for event blocks. A press that starts on a block belongs to
   * that block (open / reschedule), never to the empty-space selection.
   */
  blockSelector: string;
  /** How far (px, Euclidean) the pointer must travel to count as a sweep. */
  dragThresholdPx?: number;
  /** A completed sweep, with both endpoints snapped, clamped and ordered. */
  onSelect: (day: LocalDate, start: number, end: number) => void;
}

/** Per-column pointer handlers, spread onto the selectable column element. */
export interface TimeRangeSelectionHandlers {
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerUp: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerCancel: (event: ReactPointerEvent<HTMLDivElement>) => void;
}

export interface TimeRangeSelection {
  /** Live selection (rendered as the translucent overlay), or null. */
  selection: RangeSelection | null;
  /** Column handlers bound to the day they belong to. */
  handlers: (day: LocalDate) => TimeRangeSelectionHandlers;
  /**
   * Call first in the column's `onClick`. Returns true exactly once for the
   * synthetic click a completed sweep leaves behind, so the view does not also
   * run its click-to-create path.
   */
  consumeClick: () => boolean;
}

interface InternalDrag {
  pointerId: number;
  day: LocalDate;
  captureEl: HTMLDivElement;
  startX: number;
  startY: number;
  /** Snap minute under the pointer at press time. */
  anchorMin: number;
  /** Latest snapped minute under the pointer. */
  focusMin: number;
  /** Set once the pointer has left the click zone. */
  dragged: boolean;
  /** Escape cancelled the sweep; the release must not commit. */
  aborted: boolean;
}

const DEFAULT_THRESHOLD_PX = 3;
const SELECTING_CLASS = 'cal-selecting';

function releaseCapture(el: HTMLElement, pointerId: number): void {
  try {
    if (el.hasPointerCapture(pointerId)) el.releasePointerCapture(pointerId);
  } catch {
    // Capture was already lost (pointercancel / element detached); ignore.
  }
}

/**
 * Pointer drag-to-select for the calendar time grids.
 *
 * Contract:
 * - `pointerdown` (left button, primary pointer, on empty column space) calls
 *   `setPointerCapture` and records the snapped anchor minute.
 * - `pointermove` beyond a small threshold marks a sweep; every move then
 *   updates the live range = ordered `[anchor, focus]`, snapped and clamped.
 *   Dragging upward is the same maths as dragging downward.
 * - `pointerup` on a sweep commits `onSelect(day, start, end)` and arms a
 *   one-shot click suppressor so the synthetic click cannot create a second
 *   event. The commit is deferred one macrotask so it cannot open a modal
 *   dialog beneath that same click. `pointerup` without a sweep commits
 *   nothing: the browser's normal click reaches the view's existing
 *   click-to-create handler unchanged.
 * - `pointercancel`, Escape, or unmount abort: capture is released, no editor
 *   opens, and no stale overlay survives.
 *
 * Capture keeps the sweep alive when the pointer leaves the column, the grid,
 * or the window. The suppression flag armed for a sweep is cleared by the
 * click that follows it, by the next pointerdown, or by a short backstop timer,
 * so it can never swallow a later, unrelated click.
 */
export function useTimeRangeSelection(options: TimeRangeSelectionOptions): TimeRangeSelection {
  const {
    enabled,
    bounds,
    pxPerMinute,
    blockSelector,
    dragThresholdPx = DEFAULT_THRESHOLD_PX,
    onSelect,
  } = options;

  const [selection, setSelection] = useState<RangeSelection | null>(null);
  const [pressing, setPressing] = useState(false);
  const dragRef = useRef<InternalDrag | null>(null);
  /** Set on pointerup; consumed by the click that follows. */
  const suppressClickRef = useRef(false);
  const suppressTimerRef = useRef<number | null>(null);
  const commitTimerRef = useRef<number | null>(null);

  const clearSuppression = useCallback(() => {
    if (suppressTimerRef.current !== null) {
      window.clearTimeout(suppressTimerRef.current);
      suppressTimerRef.current = null;
    }
    suppressClickRef.current = false;
  }, []);

  const armClickSuppression = useCallback(() => {
    suppressClickRef.current = true;
    if (suppressTimerRef.current !== null) window.clearTimeout(suppressTimerRef.current);
    // Backstop only: the flag is normally consumed by the click that follows
    // the release, or cleared by the next pointerdown. This timer just stops a
    // release that produced no click from ever swallowing an unrelated one.
    suppressTimerRef.current = window.setTimeout(clearSuppression, 400);
  }, [clearSuppression]);

  const consumeClick = useCallback(() => {
    if (!suppressClickRef.current) return false;
    clearSuppression();
    return true;
  }, [clearSuppression]);

  const resetDrag = useCallback(() => {
    dragRef.current = null;
    setSelection(null);
    setPressing(false);
  }, []);

  /**
   * Escape abort. Marks the live drag cancelled and clears the overlay, but
   * keeps pointer capture until the physical release: that release is then
   * swallowed (caught by `onPointerUp` → "aborted") instead of falling through
   * as a fresh click on whichever element the pointer happens to be over.
   */
  const abort = useCallback(() => {
    const state = dragRef.current;
    if (state) {
      state.aborted = true;
      state.dragged = false;
    }
    setSelection(null);
    setPressing(false);
    // Capture is intentionally kept until the physical release; `onPointerUp`
    // sees `aborted` and swallows that release (and its click).
  }, []);

  // Escape cancels the sweep while the pointer is still down.
  useEffect(() => {
    if (!pressing) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      abort();
    };
    // Capture phase: beat any inner Escape handler while a sweep is active.
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [pressing, abort]);

  // Freeze document text selection for the whole press so a sweep never
  // highlights labels or chips in neighbouring columns.
  useEffect(() => {
    if (!pressing) return;
    document.body.classList.add(SELECTING_CLASS);
    return () => document.body.classList.remove(SELECTING_CLASS);
  }, [pressing]);

  // Unmount mid-drag: drop capture, timers and the body class (the class is
  // owned by the effect above, whose cleanup runs on unmount too).
  useEffect(() => {
    return () => {
      const state = dragRef.current;
      if (state) releaseCapture(state.captureEl, state.pointerId);
      dragRef.current = null;
      if (suppressTimerRef.current !== null) {
        window.clearTimeout(suppressTimerRef.current);
        suppressTimerRef.current = null;
      }
      if (commitTimerRef.current !== null) {
        window.clearTimeout(commitTimerRef.current);
        commitTimerRef.current = null;
      }
    };
  }, []);

  const handlers = (day: LocalDate): TimeRangeSelectionHandlers => ({
    onPointerDown(event) {
      if (!enabled) return;
      // Left button only; right/middle press keeps its native behaviour.
      if (event.button !== 0) return;
      // Ignore the second finger of a multi-touch gesture.
      if (event.isPrimary === false) return;
      // A press on a block belongs to that block's own handler.
      if ((event.target as Element).closest(blockSelector)) return;

      const el = event.currentTarget;
      const rect = el.getBoundingClientRect();
      const anchorMin = minuteAtOffset(event.clientY - rect.top, pxPerMinute, bounds);

      // A new press starts a new gesture; any suppression left over from a
      // previous release must not swallow this gesture's click.
      clearSuppression();

      try {
        el.setPointerCapture(event.pointerId);
      } catch {
        // The pointer can already be gone (very fast tap). Without capture the
        // sweep still works while inside the column; a click needs no capture.
      }
      dragRef.current = {
        pointerId: event.pointerId,
        day,
        captureEl: el,
        startX: event.clientX,
        startY: event.clientY,
        anchorMin,
        focusMin: anchorMin,
        dragged: false,
        aborted: false,
      };
      setSelection(null);
      setPressing(true);
    },

    onPointerMove(event) {
      const state = dragRef.current;
      if (!state || state.pointerId !== event.pointerId) return;
      if (state.aborted) return;

      const rect = state.captureEl.getBoundingClientRect();
      const focusMin = minuteAtOffset(event.clientY - rect.top, pxPerMinute, bounds);
      state.focusMin = focusMin;

      if (!state.dragged) {
        const dx = event.clientX - state.startX;
        const dy = event.clientY - state.startY;
        if (!isDragDistance(dx, dy, dragThresholdPx)) return;
        state.dragged = true;
      }

      const range = selectionRange(state.anchorMin, focusMin, bounds);
      setSelection({ day: state.day, start: range.start, end: range.end });
    },

    onPointerUp(event) {
      const state = dragRef.current;
      if (!state || state.pointerId !== event.pointerId) return;
      dragRef.current = null;
      releaseCapture(state.captureEl, state.pointerId);
      resetDrag();

      if (state.aborted) {
        // Escape already cancelled this sweep; swallow the trailing click.
        armClickSuppression();
        return;
      }

      if (!state.dragged) {
        // Plain click: leave it to the view's existing click handler, which
        // runs right after this event. Nothing is suppressed or committed.
        return;
      }

      const range = selectionRange(state.anchorMin, state.focusMin, bounds);
      const { day: selectedDay } = state;
      armClickSuppression();
      // Defer past the synthetic click so a modal editor is not opened beneath
      // the very click that would land on its backdrop.
      commitTimerRef.current = window.setTimeout(() => {
        commitTimerRef.current = null;
        onSelect(selectedDay, range.start, range.end);
      }, 0);
    },

    onPointerCancel(event) {
      const state = dragRef.current;
      if (!state || state.pointerId !== event.pointerId) return;
      dragRef.current = null;
      releaseCapture(state.captureEl, state.pointerId);
      resetDrag();
      // Cancelled pointers normally emit no click; suppress defensively.
      armClickSuppression();
    },
  });

  return { selection, handlers, consumeClick };
}
