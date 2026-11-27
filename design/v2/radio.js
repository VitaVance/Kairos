/* ============================================================================
   Kairos v2 — 单选组键盘契约（roving tabindex）
   一个角色写下来就是一个承诺：role="radiogroup" 意味着整组一个 Tab 停点，
   方向键在组内移动并改变选中。这一版有 21 个组声明了 role 却没兑现。
   ========================================================================== */
(function () {
  'use strict';

  /**
   * Wire one group: exactly one tabbable option, arrow keys move selection,
   * Home/End jump to the ends.
   *
   * Who owns `aria-checked`: the FRAGMENT does. Several panels derive it from
   * data (renderQuad() computes it from the item's quadrant), and if this file
   * also wrote it, the two owners would fight — a click would be overwritten on
   * the next render, or a render would undo the keyboard. So this module owns
   * exactly one thing: TAB ORDER and FOCUS. It moves focus and dispatches a
   * click; whatever the fragment does on click decides what is selected.
   */
  function wire(group) {
    if (group.dataset.rgWired === '1') return;
    group.dataset.rgWired = '1';

    var items = Array.prototype.slice.call(
      group.querySelectorAll('[role="radio"], [role="tab"]'),
    );
    if (!items.length) return;

    /**
     * Exactly one tabbable. Prefer whatever the fragment marked as selected;
     * if it marked none (some groups start neutral), fall back to the first.
     */
    function setRoving(target) {
      items.forEach(function (el) { el.tabIndex = el === target ? 0 : -1; });
    }

    var current = items.filter(function (el) {
      return el.getAttribute('aria-checked') === 'true' || el.getAttribute('aria-selected') === 'true';
    })[0] || items[0];
    setRoving(current);

    items.forEach(function (item, i) {
      // After a click, the fragment may have re-rendered and re-marked a
      // different option as selected. Re-derive the roving stop from the
      // markup rather than trusting the clicked element.
      item.addEventListener('click', function () {
        var sel = items.filter(function (el) {
          return el.getAttribute('aria-checked') === 'true' || el.getAttribute('aria-selected') === 'true';
        })[0];
        setRoving(sel || item);
      });

      item.addEventListener('keydown', function (e) {
        var last = items.length - 1;
        var next = null;
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = i === last ? 0 : i + 1;
        else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = i === 0 ? last : i - 1;
        else if (e.key === 'Home') next = 0;
        else if (e.key === 'End') next = last;
        else return;
        e.preventDefault();
        e.stopPropagation();   // the review harness pages fragments on ←/→
        var target = items[next];
        setRoving(target);
        target.focus();
        // Selecting is the fragment's job; a real click is the honest way to
        // ask, and it runs whatever handler the fragment attached.
        target.click();
      });
    });
  }

  function wireAll(root) {
    (root || document).querySelectorAll('[role="radiogroup"], [role="tablist"]').forEach(wire);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { wireAll(); });
  } else {
    wireAll();
  }

  // Fragments build their DOM from data.js after load; catch those too.
  document.addEventListener('DOMContentLoaded', function () {
    setTimeout(function () { wireAll(); }, 0);
    setTimeout(function () { wireAll(); }, 300);
  });

  window.KairosRadio = { wireAll: wireAll };
})();
