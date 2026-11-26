/**
 * Click routing for task rows.
 *
 * A row is an *object*, not a checkbox: clicking its body opens the task, and
 * only the checkbox completes it. The earlier model made the whole row the
 * completion target ("large, no-aiming area"), but completing is destructive
 * enough — it can spawn a second row for a recurring task — that a mis-aimed
 * click near the title should not be able to do it. Opening is reversible and
 * every other list in this app treats a row as "the thing you open".
 *
 * The predicate answers one question: did this click land on a control that
 * owns its own gesture? A drag handle, the checkbox, the delete button or a
 * link inside the title all do. The row only acts when the whole chain from
 * the target up to the row is free of controls.
 *
 * The predicate is DOM-free on purpose: this package has no jsdom, so the
 * tests build plain `ClickNode` chains and assert the routing directly. The
 * components pass real `Element`s, which satisfy the structural interface.
 */

/** Elements that own the click themselves. */
const INTERACTIVE_TAGS = new Set(['A', 'BUTTON', 'INPUT', 'LABEL', 'SELECT', 'TEXTAREA']);

/** ARIA roles that make a non-form element a control. */
const INTERACTIVE_ROLES = new Set([
  'button',
  'checkbox',
  'link',
  'menuitem',
  'option',
  'radio',
  'switch',
  'tab',
]);

/** The slice of `Element` this module needs, so tests need no DOM. */
export interface ClickNode {
  readonly tagName: string;
  getAttribute(name: string): string | null;
  readonly parentElement: ClickNode | null;
}

function isInteractive(node: ClickNode): boolean {
  if (INTERACTIVE_TAGS.has(node.tagName.toUpperCase())) return true;
  const role = node.getAttribute('role');
  if (role !== null && INTERACTIVE_ROLES.has(role)) return true;
  const editable = node.getAttribute('contenteditable');
  // `contenteditable=""` and `"true"` both opt in; `"false"` opts out.
  return editable !== null && editable !== 'false';
}

/**
 * The checkbox's painted square is a decorative `<span aria-hidden="true">`
 * that sits *inside* the interactive `<label>`/`<input>`. Testing only the
 * element under the pointer would call that square "not a control" and the
 * row would toggle as well as the checkbox — completing the task and then
 * immediately un-completing it.
 *
 * So: a decorative node does not decide anything on its own. The walk keeps
 * going, and the ancestor that owns it answers for it.
 */
function isDecorative(node: ClickNode): boolean {
  return node.getAttribute('aria-hidden') === 'true';
}

/**
 * Walk from the event target up to the row. The row acts only when the whole
 * chain reaches the row without crossing a control.
 *
 * Returning `false` when the walk leaves the row (a detached target, a click
 * that started in a portal) is deliberate: an unknown origin must never act.
 */
export function shouldActivateRow(target: ClickNode | null, row: ClickNode): boolean {
  let node = target;
  while (node !== null && node !== row) {
    // A decorative node is skipped rather than treated as a control: whatever
    // it belongs to is higher up and will answer for itself.
    if (!isDecorative(node) && isInteractive(node)) return false;
    node = node.parentElement;
  }
  return node === row;
}
