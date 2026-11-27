/* ============================================================================
   sidebar-counts.js — 侧栏数字只有一个来源
   ----------------------------------------------------------------------------
   03 / 04 / 13 / 14 / 15 的侧栏原来是写死的：收集箱 3、工作 9、学习 1。
   data.js 的真值是 2 / 9 / 3 —— 三个里有两个是错的，而「全部 20」和它自己的
   四个清单加起来是 19，自相矛盾。

   KEEP.md §H 记过同一件事（「六个片段各自硬编码计数」），修的时候只修了
   01/02/06。这里补上剩下的，逻辑只有这一份。

   这些文件里有的写了 `data-side`，有的只有 label。两者都认：先看属性，
   没有就退回 label 文本 —— 侧栏是给人读的，label 本来就是它唯一的身份。
   ========================================================================== */
(function () {
  'use strict';
  var K = window.Kairos;
  if (!K) { return; }

  var SMART = {
    '今天': 'today', '今天要操心': 'today',
    '最近': 'recent', '最近 7 天': 'recent', '最近7天': 'recent',
    '全部': 'all',
    '已完成': 'done'
  };

  function paint() {
    var c = K.counts();
    var sums = {
      today: c.todayWindow,
      recent: K.ITEMS.filter(function (it) { return !it.done && inRecent(it); }).length,
      all: c.open,
      done: c.done
    };

    var rows = document.querySelectorAll('.sidebar__row');
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      var out = row.querySelector('.sidebar__count');
      if (!out) { continue; }
      var labelEl = row.querySelector('.sidebar__label');
      var label = labelEl ? labelEl.textContent.trim() : '';
      var key = row.getAttribute('data-side');

      var n = null;
      if (key && sums[key] != null) {
        n = sums[key];
      } else if (key === 'list' || !key) {
        // 清单：按名字找。找不到就不是清单行。
        for (var k = 0; k < K.LISTS.length; k++) {
          if (K.LISTS[k].name === label) { n = c.byList[K.LISTS[k].id]; break; }
        }
      }
      // data-side 缺席时，靠 label 认出快捷项。
      if (n == null && SMART[label]) { n = sums[SMART[label]]; }

      if (n != null) { out.textContent = n; }
    }
  }

  /** 与 01/02/05 的「最近」同一口径：七天内要操心的事 + 已过的。 */
  function inRecent(it) {
    if (it.rung === 'none') { return false; }
    if (K.isLate(it) || K.isWindowPassed(it)) { return true; }
    if (it.rung === 'month') { return K.monthStartOf(it.date) === K.monthStartOf(K.now().today); }
    if (it.rung === 'week') {
      var ws = K.weekStartOf(it.date);
      return ws >= K.now().today && ws <= K.addDays(K.now().today, 6);
    }
    var start = K.startOf(it);
    return start >= K.now().today && start <= K.addDays(K.now().today, 6);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', paint);
  } else {
    paint();
  }
  window.KairosSidebar = { paint: paint };
})();
