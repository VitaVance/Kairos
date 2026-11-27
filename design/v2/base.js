/* ============================================================================
   Kairos v2 — 片段页共用脚本
   皮肤/主题切换、演示控制条、无 JS 时的兜底。
   ========================================================================== */
(function () {
  'use strict';

  var SKINS = ['refined', 'protool', 'editorial'];
  var SKIN_LABEL = { refined: 'A', protool: 'B', editorial: 'C' };
  var THEMES = ['light', 'dark'];
  var THEME_LABEL = { light: '明', dark: '暗' };

  /**
   * The fragments are 17 separate files; this is how a reviewer walks between
   * them. It lives in the demo bar rather than as a bottom pill because one
   * fragment is itself a specimen of the app's real bottom pill, and two pills
   * on one screen would be indistinguishable.
   */
  var ORDER = [
    '01-quadrant.html', '02-list.html',
    '03-calendar-month.html', '04-calendar-week.html', '05-agenda.html',
    '13-year.html', '14-multi-day.html', '15-day.html',
    '06-detail.html', '07-capture.html', '08-time-picker.html',
    '09-search.html', '10-settings.html', '11-dialogs.html', '12-empty-states.html',
    '16-components.html', '17-icons.html',
  ];

  /**
   * The skin/theme choice carries across fragments WITHIN a review session, so
   * a reviewer can walk 01→17 in one skin. It must NOT leak across sessions:
   * a value stored an hour ago silently overrode every file's declared default
   * and made screenshots show dark when the file says light — which is exactly
   * how a review ends up judging the wrong thing.
   *
   * So: sessionStorage, not localStorage. A fresh tab starts from the file's
   * own `<body data-skin data-theme>`.
   */
  function readStored(key, fallback) {
    try { return sessionStorage.getItem(key) || fallback; } catch (e) { return fallback; }
  }
  function writeStored(key, value) {
    try { sessionStorage.setItem(key, value); } catch (e) { /* private mode */ }
  }

  function apply(skin, theme) {
    document.body.dataset.skin = skin;
    document.body.dataset.theme = theme;
    document.querySelectorAll('[data-demo-skin]').forEach(function (b) {
      b.setAttribute('aria-pressed', String(b.dataset.demoSkin === skin));
    });
    document.querySelectorAll('[data-demo-theme]').forEach(function (b) {
      b.setAttribute('aria-pressed', String(b.dataset.demoTheme === theme));
    });
  }

  function buildBar() {
    var bar = document.createElement('div');
    bar.className = 'demo-bar';
    bar.setAttribute('role', 'group');
    bar.setAttribute('aria-label', '演示：皮肤与主题');

    var here = (location.pathname.split('/').pop() || '');
    var idx = ORDER.indexOf(here);
    var prev = idx > 0 ? ORDER[idx - 1] : null;
    var next = idx >= 0 && idx < ORDER.length - 1 ? ORDER[idx + 1] : null;

    var nav = '';
    if (idx >= 0) {
      nav =
        '<a href="index.html" title="返回总览" style="text-decoration:none;color:inherit;padding:.25rem .375rem;border-radius:5px">⌂</a>' +
        (prev ? '<a href="' + prev + '" title="上一个" style="text-decoration:none;color:inherit;padding:.25rem .375rem;border-radius:5px">‹</a>' : '') +
        '<span style="padding:.25rem .375rem;color:#9a9aa4">' + (idx + 1) + '/' + ORDER.length + '</span>' +
        (next ? '<a href="' + next + '" title="下一个" style="text-decoration:none;color:inherit;padding:.25rem .375rem;border-radius:5px">›</a>' : '') +
        '<span style="inline-size:1px;block-size:14px;background:rgba(255,255,255,.25);margin:0 .125rem"></span>';
    } else if (here !== 'index.html') {
      nav = '<a href="index.html" style="text-decoration:none;color:inherit;padding:.25rem .375rem;border-radius:5px">⌂</a>' +
            '<span style="inline-size:1px;block-size:14px;background:rgba(255,255,255,.25);margin:0 .125rem"></span>';
    }

    bar.innerHTML = nav +
      SKINS.map(function (s) {
        return '<button type="button" data-demo-skin="' + s + '" aria-pressed="false">' + SKIN_LABEL[s] + '</button>';
      }).join('') +
      '<span style="inline-size:1px;block-size:14px;background:rgba(255,255,255,.25);margin:0 .125rem"></span>' +
      THEMES.map(function (t) {
        return '<button type="button" data-demo-theme="' + t + '" aria-pressed="false">' + THEME_LABEL[t] + '</button>';
      }).join('');
    document.body.appendChild(bar);

    bar.addEventListener('click', function (e) {
      var t = e.target;
      if (!t || typeof t.closest !== 'function') return;
      var b = t.closest('button');
      if (!b) return;
      if (b.dataset.demoSkin) {
        writeStored('kairos-v2-skin', b.dataset.demoSkin);
        apply(b.dataset.demoSkin, document.body.dataset.theme || 'light');
      } else if (b.dataset.demoTheme) {
        writeStored('kairos-v2-theme', b.dataset.demoTheme);
        apply(document.body.dataset.skin || 'refined', b.dataset.demoTheme);
      }
    });

    /*
     * Keyboard: ← / → walk the fragment sequence — but ONLY when nothing else
     * wants the key. The first version only excluded text inputs, so testing
     * arrow keys on a radiogroup or a calendar teleported the reviewer to
     * another fragment, and every keyboard verdict on this set became a false
     * negative. One author worked around it with stopPropagation(); that is a
     * symptom, not a fix.
     *
     * Skip when the event was already handled (defaultPrevented), when focus is
     * inside anything interactive, or when a modifier is held.
     */
    document.addEventListener('keydown', function (e) {
      if (e.defaultPrevented) return;
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      var el = e.target;
      if (!el || typeof el.closest !== 'function') return;
      if (el.closest('input, textarea, select, [contenteditable], button, a, [role="radio"], [role="tab"], [role="menuitem"], [role="option"], [role="gridcell"], [tabindex]')) return;
      if (e.key === 'ArrowLeft' && prev) location.href = prev;
      else if (e.key === 'ArrowRight' && next) location.href = next;
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    var skin = readStored('kairos-v2-skin', document.body.dataset.skin || 'refined');
    var theme = readStored('kairos-v2-theme', document.body.dataset.theme || 'light');
    apply(skin, theme);
    buildBar();
  });
})();
