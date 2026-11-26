import { describe, expect, it } from 'vitest';
import { shouldActivateRow } from '../src/task/row-click';
import type { ClickNode } from '../src/task/row-click';

/**
 * Minimal structural stand-in for an `Element`. `tagName` is upper-case like
 * the DOM's; attributes are a plain record.
 */
function node(tagName: string, attrs: Record<string, string> = {}, parent: ClickNode | null = null): ClickNode {
  return {
    tagName: tagName.toUpperCase(),
    getAttribute: (name: string) => attrs[name] ?? null,
    parentElement: parent,
  };
}

/** `row > ...children`, chained from the row outward. */
function chain(...nodes: ClickNode[]): ClickNode {
  for (let i = 1; i < nodes.length; i += 1) {
    // `parentElement` is readonly in the interface; tests assign it here.
    Object.defineProperty(nodes[i]!, 'parentElement', { value: nodes[i - 1] });
  }
  return nodes[0]!;
}

/**
 * The predicate itself is gesture-agnostic: it answers "is this click free of
 * controls?". The rows now route that answer to *open*, and the checkbox owns
 * completion; these cases pin the routing, not which handler runs.
 */
describe('shouldActivateRow', () => {
  it('activates when the click lands on the row itself', () => {
    const r = node('div');
    expect(shouldActivateRow(r, r)).toBe(true);
  });

  it('activates for a span (title text) that sits directly in the row', () => {
    const r = node('div');
    const title = node('span', {}, r);
    expect(shouldActivateRow(title, r)).toBe(true);
  });

  it('activates for a decorative child whose whole chain is non-interactive', () => {
    const r = node('div');
    const meta = node('span', {}, r);
    const clock = node('svg', {}, meta);
    expect(shouldActivateRow(clock, r)).toBe(true);
  });

  it('yields to the checkbox input so only it completes', () => {
    const r = node('div');
    const wrapper = node('span', { class: 'tl-checkbox' }, r);
    const input = node('input', { type: 'checkbox' }, wrapper);
    expect(shouldActivateRow(input, r)).toBe(false);
  });

  it('lets an aria-hidden icon defer to the control that owns it', () => {
    // A decorative icon inside the chevron resolves to the button above it.
    const r = node('div');
    const open = node('button', { class: 'tk-row__open' }, r);
    const icon = node('svg', { 'aria-hidden': 'true' }, open);
    expect(shouldActivateRow(icon, r)).toBe(false);
    // The same icon with no control above it is part of the row body.
    const freeIcon = node('svg', { 'aria-hidden': 'true' }, r);
    expect(shouldActivateRow(freeIcon, r)).toBe(true);
  });

  it('yields when the click starts on the visible checkbox glyph', () => {
    // The glyph is `pointer-events: none`, so the browser hands this click to
    // the oversized input below; the predicate sees the input either way.
    const r = node('div');
    const wrapper = node('span', { class: 'tl-checkbox' }, r);
    const input = node('input', { type: 'checkbox' }, wrapper);
    const glyph = node('svg', {}, wrapper);
    expect(shouldActivateRow(input, r)).toBe(false);
    // A glyph-targeted click only reaches the row if no control is between.
    // Real DOM resolves it to the input first, so this case does not occur.
    expect(shouldActivateRow(glyph, r)).toBe(true);
  });

  it('yields to the chevron button or anything inside it', () => {
    const r = node('div');
    const open = node('button', { class: 'tk-row__open' }, r);
    const icon = node('svg', {}, open);
    expect(shouldActivateRow(open, r)).toBe(false);
    expect(shouldActivateRow(icon, r)).toBe(false);
  });

  it('yields to the drag handle (a button) used by the quadrant row', () => {
    const r = node('div');
    const handle = node('button', { class: 'qz-row__handle' }, r);
    const glyph = node('svg', {}, handle);
    expect(shouldActivateRow(handle, r)).toBe(false);
    expect(shouldActivateRow(glyph, r)).toBe(false);
  });

  it('yields to the delete button', () => {
    const r = node('div');
    const del = node('button', { class: 'tk-row__delete' }, r);
    expect(shouldActivateRow(del, r)).toBe(false);
  });

  it('yields to a link inside the title', () => {
    const r = node('div');
    const title = node('span', {}, r);
    const link = node('a', { href: 'https://example.com' }, title);
    const text = node('span', {}, link);
    expect(shouldActivateRow(link, r)).toBe(false);
    expect(shouldActivateRow(text, r)).toBe(false);
  });

  it('honours ARIA-roled controls that are not native elements', () => {
    const r = node('div');
    const custom = node('span', { role: 'button' }, r);
    expect(shouldActivateRow(custom, r)).toBe(false);
    const editable = node('span', { contenteditable: '' }, r);
    expect(shouldActivateRow(editable, r)).toBe(false);
  });

  it('allows a contenteditable="false" child to activate', () => {
    const r = node('div');
    const text = node('span', { contenteditable: 'false' }, r);
    expect(shouldActivateRow(text, r)).toBe(true);
  });

  it('refuses when the target is not inside the row (detached / portal)', () => {
    const r = node('div');
    const orphan = node('button', {}, node('div', {}, null));
    expect(shouldActivateRow(orphan, r)).toBe(false);
    expect(shouldActivateRow(null, r)).toBe(false);
  });

  it('refuses when a control is anywhere between the target and the row', () => {
    // body > button > span: the span itself is not interactive, but its
    // ancestor button owns the gesture.
    const r = node('div');
    const btn = node('button', {}, r);
    const span = node('span', {}, btn);
    expect(shouldActivateRow(span, r)).toBe(false);
  });

  it('is case-insensitive about tag names', () => {
    const r = node('DIV');
    const input = node('INPUT', {}, r);
    expect(shouldActivateRow(input, r)).toBe(false);
  });
});

describe('row scaffolding helper', () => {
  it('links children to the row', () => {
    const r = node('div', { class: 'tk-row' });
    const title = node('span');
    chain(r, title);
    expect(title.parentElement).toBe(r);
    expect(shouldActivateRow(title, r)).toBe(true);
  });
});
