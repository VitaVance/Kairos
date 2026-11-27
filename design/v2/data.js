/* ============================================================================
   Kairos v2 — 共享数据
   所有片段引用这一份，保证 20 条事情在六个文件里长得一样。
   今天 = 2026-11-26 周四；本周周一 = 2026-11-23。
   ========================================================================== */
(function (global) {
  'use strict';

  var LISTS = [
    { id: 'inbox', name: '收集箱', color: '#5b8def' },
    { id: 'work',  name: '工作',   color: '#3aa88b' },
    { id: 'study', name: '学习',   color: '#8b79c9' },
    { id: 'life',  name: '生活',   color: '#d99a3d' },
  ];

  /**
   * rung: month | week | day | period | time | none
   * quadrant: 1..4  (1 = 重要且紧急, 2 = 重要不紧急, 3 = 不重要但紧急, 4 = 不重要不紧急)
   * urgent: 用户手标
   * done: 已完成
   * date/time: 该档位对应的具体值
   */
  var ITEMS = [
    { id: 1,  title: '交报销单',        rung: 'time',   date: '2026-11-26', time: '18:00', important: true, list: 'work',  urgent: false, done: false },
    { id: 2,  title: '产品评审会',      rung: 'time',   date: '2026-11-26', time: '15:00', end: '16:00', important: true, list: 'work', urgent: true,  done: false },
    { id: 3,  title: '15:30 接孩子',    rung: 'time',   date: '2026-11-26', time: '15:30', important: true, list: 'life',  urgent: true,  done: false },
    { id: 4,  title: '回客户邮件',      rung: 'period', date: '2026-11-26', period: 'afternoon', important: false, list: 'work', urgent: true, done: false },
    { id: 5,  title: '给爸妈打电话',    rung: 'period', date: '2026-11-26', period: 'evening',   important: true, list: 'life', urgent: false, done: false },
    { id: 6,  title: '跟进合同签署',    rung: 'day',    date: '2026-11-27', important: true, list: 'work',  urgent: false, done: false },
    { id: 7,  title: '每周五复盘',      rung: 'day',    date: '2026-11-27', important: true, list: 'work',  urgent: false, done: false, repeat: 'weekly' },
    { id: 8,  title: '交房租',          rung: 'day',    date: '2026-11-28', important: true, list: 'life',  urgent: false, done: false },
    { id: 9,  title: '预约牙医',        rung: 'day',    date: '2026-11-29', important: false, list: 'life',  urgent: false, done: false },
    { id: 10, title: '整理相册',        rung: 'day',    date: '2026-11-30', important: false, list: 'life',  urgent: false, done: false },
    { id: 11, title: '写季度总结',      rung: 'week',   date: '2026-11-23', important: true, list: 'work',  urgent: false, done: false },
    { id: 12, title: '部门聚餐筹备',    rung: 'week',   date: '2026-11-23', important: false, list: 'work',  urgent: false, done: false },
    { id: 13, title: '读完《深度工作》', rung: 'week',   date: '2026-11-16', important: true, list: 'study', urgent: false, done: false, lateWeek: true },
    { id: 14, title: '更新简历',        rung: 'month',  date: '2026-12-01', important: true, list: 'study', urgent: false, done: false },
    { id: 15, title: '年度体检',        rung: 'month',  date: '2026-12-01', important: true, list: 'life',  urgent: false, done: false },
    { id: 16, title: '未排期：随手记',  rung: 'none',   important: false, list: 'inbox', urgent: false, done: false },
    { id: 17, title: '看看新出的效率工具', rung: 'none', important: false, list: 'study', urgent: false, done: false },
    { id: 18, title: '整理浏览器书签',  rung: 'none',   important: false, list: 'inbox', urgent: false, done: false },
    { id: 19, title: '设计评审',        rung: 'time',   date: '2026-11-25', time: '10:00', important: true, list: 'work', urgent: false, done: false, expired: true },
    { id: 20, title: '家长会',          rung: 'time',   date: '2026-11-24', time: '10:30', important: true, list: 'life', urgent: false, done: true },
    /*
     * ADR 0006 需要一条真正的「占用」：这三天人被拿走了。
     * 它和「写季度总结（这周）」在数据上同为区间，语义完全不同 ——
     * 前者有资格在日历上占地方，后者没有。blocksTime 是两者的唯一区分。
     */
    { id: 21, title: '去杭州出差',      rung: 'range',  start: '2026-12-03', end: '2026-12-05', important: true, list: 'work', urgent: false, done: false, blocksTime: true },
  ];

  var TODAY = '2026-11-26';
  var NOW_MIN = 14 * 60 + 20;      // 14:20

  /*
   * 「现在」必须是一个会走的东西。
   *
   * 原来 TODAY / NOW_MIN 是 module-level 的 var，导出的 Kairos.TODAY 只是拷了一份值，
   * 所以外部改 K.NOW_MIN 对 urgencyOf() 毫无作用 —— 它在闭包里读原变量。
   * 更要命的是 quadrantOf() 调用 urgencyOf() 时不传时钟，于是「紧急随时间变化」
   * 这条 ADR 0004 §4 的核心主张，在数据层根本没有接上。
   *
   * 现在：这两个变量是唯一真源，setNow() 是唯一写入口，quadrantOf 把时钟传下去。
   * 任何视图想知道「现在」都必须调 K.now()，不许自己读 K.TODAY 的快照。
   */
  function setNow(min, today) {
    if (typeof min === 'number' && isFinite(min)) NOW_MIN = Math.max(0, Math.min(1439, Math.round(min)));
    if (typeof today === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(today)) TODAY = today;
    return { nowMin: NOW_MIN, today: TODAY };
  }
  function now() { return { nowMin: NOW_MIN, today: TODAY }; }

  /** 本周周一 */
  var WEEK_START = '2026-11-23';
  /** 上周周一 */
  var LAST_WEEK_START = '2026-11-16';

  var QUADRANTS = {
    1: { name: '重要且紧急',   dot: 'var(--q1)', tint: 'var(--q1-t)', ink: 'var(--q1-i)' },
    2: { name: '重要不紧急',   dot: 'var(--q2)', tint: 'var(--q2-t)', ink: 'var(--q2-i)' },
    3: { name: '不重要但紧急', dot: 'var(--q3)', tint: 'var(--q3-t)', ink: 'var(--q3-i)' },
    4: { name: '不重要不紧急', dot: 'var(--q4)', tint: 'var(--q4-t)', ink: 'var(--q4-i)' },
  };

  var PERIOD_LABEL = { morning: '上午', afternoon: '下午', evening: '晚上' };

  /* ---- 日期工具（纯字符串，避免时区）---- */
  function parse(d) { var p = d.split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function fmt(dt) {
    return dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0') + '-' + String(dt.getDate()).padStart(2, '0');
  }
  function addDays(d, n) { var dt = parse(d); dt.setDate(dt.getDate() + n); return fmt(dt); }
  function diffDays(a, b) { return Math.round((parse(a) - parse(b)) / 86400000); }

  /** 该日期所在周的周一 */
  function weekStartOf(d) {
    var dt = parse(d);
    var dow = (dt.getDay() + 6) % 7;      // 周一 = 0
    dt.setDate(dt.getDate() - dow);
    return fmt(dt);
  }

  /** 该日期所在月的 1 号 */
  function monthStartOf(d) { return d.slice(0, 8) + '01'; }

  /* ---- 一段时间的终点：唯一的一份算法 ---- */
  /*
   * 半开区间（end = 下周一 / 次月 1 号）是**日历切片**要的，
   * 但把它直接印给人看会得到「11/23 – 11/30」，读起来是「到 30 号为止」——错一天。
   * 全站只留这一个函数，任何视图要显示区间都必须走它。
   *
   * 注意两种 rung 的 end 语义不同：
   *   week / month —— end 是**半开**的（下周一 / 次月 1 号），闭区间要减一天
   *   range        —— end 是**用户亲手填的最后一天**，本身就是闭的，不能再减
   */
  function spanEnd(rung, date, inclusive) {
    var start, end, endIsExclusive;
    if (rung === 'week') { start = weekStartOf(date); end = addDays(start, 7); endIsExclusive = true; }
    else if (rung === 'month') {
      start = monthStartOf(date);
      var d = parse(start); d.setMonth(d.getMonth() + 1); end = fmt(d); endIsExclusive = true;
    } else if (rung === 'range') { start = date.start; end = date.end; endIsExclusive = false; }
    else return null;
    var shown = (inclusive === false || !endIsExclusive) ? end : addDays(end, -1);
    return { start: start, end: shown };
  }

  /** 「11/23 – 11/29」——全站唯一的区间写法（闭区间，给人看） */
  function formatSpan(rung, date) {
    var r = spanEnd(rung, date, true);
    if (!r) return '';
    return shortDate(r.start) + ' – ' + shortDate(r.end);
  }
  function shortDate(d) { var p = d.split('-'); return (+p[1]) + '/' + (+p[2]); }

  /** 这段时间是否真的被占用（ADR 0006）：出差、假期是；「这周写完」不是。 */
  function isOccupancy(item) {
    return item.blocksTime === true;
  }

  /* ---- 时间阶梯的文字 ---- */
  function rungLabel(item, today) {
    today = today || TODAY;
    switch (item.rung) {
      case 'none':
        return '不限';
      case 'month': {
        var m = parse(item.date);
        var cur = parse(today);
        var delta = (m.getFullYear() - cur.getFullYear()) * 12 + (m.getMonth() - cur.getMonth());
        if (delta === 1) return '下个月';
        if (delta === 0) return '这个月';
        if (delta === -1) return '上个月';
        return m.getFullYear() + '年' + (m.getMonth() + 1) + '月';
      }
      case 'week': {
        var ws = weekStartOf(today);
        var diff = Math.round((parse(item.date) - parse(ws)) / (7 * 86400000));
        if (diff === 0) return '这周';
        if (diff === -1) return '上周';
        if (diff === 1) return '下周';
        // A negative bare number ("第 -3 周") is not a human phrase. Anything
        // further back than last week is described as how long it has been.
        if (diff < -1) return (-diff) + ' 周前';
        return '第 ' + diff + ' 周';
      }
      case 'day': {
        var n = diffDays(item.date, today);
        if (n === 0) return '今天';
        if (n === 1) return '明天';
        if (n === 2) return '后天';
        if (n === -1) return '昨天';
        var dt = parse(item.date);
        return (dt.getMonth() + 1) + '月' + dt.getDate() + '日';
      }
      case 'period': {
        var pn = diffDays(item.date, today);
        var dayPart = pn === 0 ? '今天' : pn === 1 ? '明天' : (parse(item.date).getMonth() + 1) + '月' + parse(item.date).getDate() + '日';
        return dayPart + PERIOD_LABEL[item.period];
      }
      case 'time': {
        var tn = diffDays(item.date, today);
        var tDay = tn === 0 ? '今天' : tn === 1 ? '明天' : (parse(item.date).getMonth() + 1) + '月' + parse(item.date).getDate() + '日';
        return tDay + ' ' + item.time;
      }
      case 'range': {
        return formatSpan('range', { start: item.start, end: item.end });
      }
    }
    return '';
  }

  /* ---- 状态：是否逾期 ---- */
  /*
   * 每种形状都要能回答「它从哪一刻开始算迟」与「它现在算不算迟」。
   * 加 `range` 时漏了这两个分支，于是 01/05/06 在排序里读到 undefined 崩掉 ——
   * 一个形状不是「数据里多一条」，是**每一处判定都要多一个分支**。
   */
  /** 一段时间的最后一个时刻（半开转闭）。 */
  function spanLastDay(item) {
    if (item.rung === 'week') return addDays(weekStartOf(item.date), 6);
    if (item.rung === 'month') {
      var ms = monthStartOf(item.date), d = parse(ms);
      d.setMonth(d.getMonth() + 1); d.setDate(0);           // 月末
      return fmt(d);
    }
    if (item.rung === 'range') return item.end;
    return null;
  }

  function isLate(item, nowMin) {
    nowMin = nowMin == null ? NOW_MIN : nowMin;
    if (item.done) return false;
    if (item.rung === 'month' || item.rung === 'week' || item.rung === 'none') return false;  // 计划窗口不算逾期
    if (item.rung === 'range') {
      // 只有「占用」才算迟：出差结束了、假期结束了，人回来了而这件事没做完。
      // 意图性的区间（这周写完）不是承诺，绝不标红（ADR 0004 §2）。
      return item.blocksTime === true && spanLastDay(item) < TODAY;
    }
    if (item.rung === 'time') {
      if (item.date < TODAY) return true;
      if (item.date > TODAY) return false;
      var h = +item.time.slice(0, 2), m = +item.time.slice(3, 5);
      return h * 60 + m < nowMin;
    }
    if (item.rung === 'day') return item.date < TODAY;
    if (item.rung === 'period') {
      if (item.date < TODAY) return true;
      if (item.date > TODAY) return false;
      return item.period === 'morning' && nowMin >= 12 * 60
          || item.period === 'afternoon' && nowMin >= 19 * 60
          || item.period === 'evening' && nowMin >= 24 * 60;
    }
    return false;
  }

  /** 计划窗口已过（week/month/意图性区间专用，用 warning 而不是 danger） */
  function isWindowPassed(item, today) {
    today = today || TODAY;
    if (item.done) return false;
    if (item.rung === 'week') return weekStartOf(item.date) < weekStartOf(today);
    if (item.rung === 'month') return monthStartOf(item.date) < monthStartOf(today);
    if (item.rung === 'range' && item.blocksTime !== true) return spanLastDay(item) < today;
    return false;
  }

  /* ---- 紧急读数（ADR 0004 §4）：五级 ---- */
  function urgencyOf(item, nowMin) {
    nowMin = nowMin == null ? NOW_MIN : nowMin;
    if (item.urgent) return 'urgent';
    if (item.done) return 'none';
    if (item.rung === 'none' || item.rung === 'month') return 'none';
    if (item.rung === 'range') {
      // Intention spans carry no clock reading at all (ADR 0006): the user said
      // "this week", not "by Thursday". An occupancy span does have an end —
      // the last minute of the last day — but it still never reaches Q1 by
      // time alone, because coming back from a trip is not a missed deadline.
      if (item.blocksTime !== true) return 'none';
      var last = spanLastDay(item);
      var leftDays = diffDays(addDays(last, 1), TODAY);
      if (leftDays <= 0) return 'far';
      if (leftDays <= 1) return 'near';
      if (leftDays <= 3) return 'soon';
      return 'far';
    }
    if (item.rung === 'week') {
      // week/month NEVER reach 'urgent' by time (ADR 0004 §4): a plan window
      // passing is not a missed deadline. A passed week stays at 'far'; the
      // only way into Q1 is the user's own flag. This was a real bug: the
      // naive "hours remaining" arithmetic went negative and pushed last
      // week's item into Q1, contradicting "week 不算逾期".
      var endOfWeek = addDays(weekStartOf(item.date), 7);
      var daysLeft = diffDays(endOfWeek, TODAY);
      // A window that has ALREADY passed is not "about to expire" — clamp it
      // to 'far' rather than letting the negative remainder fall through the
      // <= 1 branch. The warning signal lives in the row (§3), not in the level.
      if (daysLeft <= 0) return 'far';
      if (daysLeft <= 1) return 'near';
      if (daysLeft <= 3) return 'soon';
      return 'far';
    }
    var hours;
    if (item.rung === 'time') {
      var hh = +item.time.slice(0, 2), mm = +item.time.slice(3, 5);
      hours = (diffDays(item.date, TODAY) * 1440 + hh * 60 + mm - nowMin) / 60;
    } else if (item.rung === 'period') {
      var end = item.period === 'morning' ? 12 : item.period === 'afternoon' ? 19 : 24;
      hours = (diffDays(item.date, TODAY) * 1440 + end * 60 - nowMin) / 60;
    } else {
      hours = (diffDays(addDays(item.date, 1), TODAY) * 1440 - nowMin) / 60;
    }
    if (hours <= 0) return 'urgent';
    if (hours <= 24) return 'near';
    if (hours <= 72) return 'soon';
    if (hours <= 336) return 'far';
    return 'none';
  }

  var URGENCY_LABEL = {
    none: '', far: '', soon: '临近', near: '马上到期', urgent: '已过期',
  };

  /**
   * The quadrant an item sits in, DERIVED — never stored.
   *
   * Items used to carry a single `q: 1..4` field, which conflated the two axes
   * into one number. That made the board unable to follow ADR §4: it placed
   * 年度体检 (next month, not urgent) in 重要且紧急 because q was hard-coded 1,
   * while its own detail panel said "不进 Q1". Two facts, one number.
   *
   * Now: `important` is the only stored axis (the user's own word), and
   * urgency comes from `urgencyOf()` — the user's flag OR the clock reading
   * `urgent`. `near` deliberately does NOT count: ADR §4 keeps Q1 small.
   */
  function quadrantOf(item, nowMin) {
    // The clock must be threaded through: `urgencyOf()` without an argument
    // reads the module-level NOW_MIN, which setNow() mutates — but if a caller
    // passes an explicit minute, the quadrant has to agree with it.
    var urgent = item.urgent === true || urgencyOf(item, nowMin) === 'urgent';
    if (item.important && urgent) return 1;
    if (item.important) return 2;
    if (urgent) return 3;
    return 4;
  }

  /**
   * Every count any surface displays. One definition, because two fragments
   * hard-coded their own numbers and drifted: 01 said 19 open and 收集箱 2,
   * while 03 said 20 and 3 — on the same data, in the same session.
   */
  function counts() {
    var open = ITEMS.filter(function (i) { return !i.done; });
    var byList = {};
    for (var k = 0; k < LISTS.length; k++) byList[LISTS[k].id] = 0;
    for (var j = 0; j < open.length; j++) {
      if (byList[open[j].list] != null) byList[open[j].list]++;
    }
    // Two different questions, two names. 01/02 used to count a week/month
    // window that covers today (`today` = 7); 03/04/05 counted only items whose
    // date IS today (= 5). Both are legitimate, but calling both 「今天」 made
    // two sidebars in one product disagree. Now each has its own name.
    var todayExact = 0, coveringToday = 0;
    for (var m = 0; m < open.length; m++) {
      if (open[m].date === TODAY) todayExact++;
      if (coversToday(open[m])) coveringToday++;
    }
    return {
      open: open.length,
      done: ITEMS.length - open.length,
      total: ITEMS.length,
      byList: byList,
      today: todayExact,          // 今天这一格有事（日历口径）
      todayWindow: coveringToday, // 今天要操心的事（含覆盖今天的窗口）——板的「今天」
    };
  }

  /** 这件事今天是否「要操心」：日期是今天，或它所在的窗口覆盖今天。 */
  function coversToday(item, today) {
    today = today || TODAY;
    if (item.done) return false;
    if (item.rung === 'none') return false;
    if (item.rung === 'week') return weekStartOf(item.date) === weekStartOf(today);
    if (item.rung === 'month') return monthStartOf(item.date) === monthStartOf(today);
    if (item.rung === 'range') return item.start <= today && item.end >= today;
    if (item.rung === 'day' || item.rung === 'period' || item.rung === 'time') return item.date === today;
    return false;
  }

  /**
   * The row label for an item. ADR 0004: the `none` rung shows the LIST NAME,
   * not the word 不限 — an undated thing is identified by where it lives.
   * Four fragments printed 不限 instead; this is the single definition.
   */
  /** 排序用的起始日期：每种形状都有一个「它从哪天开始」。 */
  function startOf(item) {
    if (item.rung === 'week') return weekStartOf(item.date);
    if (item.rung === 'month') return monthStartOf(item.date);
    if (item.rung === 'range') return item.start;
    return item.date || '9999-99-99';
  }

  function rowLabel(item) {
    if (item.rung === 'none') {
      for (var k = 0; k < LISTS.length; k++) {
        if (LISTS[k].id === item.list) return LISTS[k].name;
      }
      return '收集箱';
    }
    return rungLabel(item);
  }

  global.Kairos = {
    LISTS: LISTS,
    ITEMS: ITEMS,
    TODAY: TODAY,
    NOW_MIN: NOW_MIN,
    WEEK_START: WEEK_START,
    LAST_WEEK_START: LAST_WEEK_START,
    QUADRANTS: QUADRANTS,
    PERIOD_LABEL: PERIOD_LABEL,
    rungLabel: rungLabel,
    rowLabel: rowLabel,
    startOf: startOf,
    counts: counts,
    coversToday: coversToday,
    quadrantOf: quadrantOf,
    isLate: isLate,
    isWindowPassed: isWindowPassed,
    urgencyOf: urgencyOf,
    URGENCY_LABEL: URGENCY_LABEL,
    addDays: addDays,
    diffDays: diffDays,
    weekStartOf: weekStartOf,
    monthStartOf: monthStartOf,
    parse: parse,
    fmt: fmt,
    /* 「现在」的唯一入口 —— 页面内可以改，改完所有派生值立刻跟着变 */
    now: now,
    setNow: setNow,
    /* 区间：唯一的一份终点算法与唯一的一种写法 */
    spanEnd: spanEnd,
    formatSpan: formatSpan,
    shortDate: shortDate,
    isOccupancy: isOccupancy,
  };
})(window);
