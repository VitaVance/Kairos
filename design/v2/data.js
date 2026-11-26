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
    { id: 1,  title: '交报销单',        rung: 'time',   date: '2026-11-26', time: '18:00', q: 1, list: 'work',  urgent: false, done: false },
    { id: 2,  title: '产品评审会',      rung: 'time',   date: '2026-11-26', time: '15:00', end: '16:00', q: 1, list: 'work', urgent: true,  done: false },
    { id: 3,  title: '15:30 接孩子',    rung: 'time',   date: '2026-11-26', time: '15:30', q: 1, list: 'life',  urgent: true,  done: false },
    { id: 4,  title: '回客户邮件',      rung: 'period', date: '2026-11-26', period: 'afternoon', q: 3, list: 'work', urgent: false, done: false },
    { id: 5,  title: '给爸妈打电话',    rung: 'period', date: '2026-11-26', period: 'evening',   q: 2, list: 'life', urgent: false, done: false },
    { id: 6,  title: '跟进合同签署',    rung: 'day',    date: '2026-11-27', q: 1, list: 'work',  urgent: false, done: false },
    { id: 7,  title: '每周五复盘',      rung: 'day',    date: '2026-11-27', q: 2, list: 'work',  urgent: false, done: false, repeat: 'weekly' },
    { id: 8,  title: '交房租',          rung: 'day',    date: '2026-11-28', q: 1, list: 'life',  urgent: false, done: false },
    { id: 9,  title: '预约牙医',        rung: 'day',    date: '2026-11-29', q: 3, list: 'life',  urgent: false, done: false },
    { id: 10, title: '整理相册',        rung: 'day',    date: '2026-11-30', q: 4, list: 'life',  urgent: false, done: false },
    { id: 11, title: '写季度总结',      rung: 'week',   date: '2026-11-23', q: 2, list: 'work',  urgent: false, done: false },
    { id: 12, title: '部门聚餐筹备',    rung: 'week',   date: '2026-11-23', q: 3, list: 'work',  urgent: false, done: false },
    { id: 13, title: '读完《深度工作》', rung: 'week',   date: '2026-11-16', q: 2, list: 'study', urgent: false, done: false, lateWeek: true },
    { id: 14, title: '更新简历',        rung: 'month',  date: '2026-12-01', q: 2, list: 'study', urgent: false, done: false },
    { id: 15, title: '年度体检',        rung: 'month',  date: '2026-12-01', q: 1, list: 'life',  urgent: false, done: false },
    { id: 16, title: '未排期：随手记',  rung: 'none',   q: 4, list: 'inbox', urgent: false, done: false },
    { id: 17, title: '看看新出的效率工具', rung: 'none', q: 4, list: 'study', urgent: false, done: false },
    { id: 18, title: '整理浏览器书签',  rung: 'none',   q: 4, list: 'inbox', urgent: false, done: false },
    { id: 19, title: '设计评审',        rung: 'time',   date: '2026-11-25', time: '10:00', q: 2, list: 'work', urgent: false, done: false, expired: true },
    { id: 20, title: '家长会',          rung: 'time',   date: '2026-11-24', time: '10:30', q: 2, list: 'life', urgent: false, done: true },
  ];

  var TODAY = '2026-11-26';
  var NOW_MIN = 14 * 60 + 20;      // 14:20
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
    }
    return '';
  }

  /* ---- 状态：是否逾期 ---- */
  function isLate(item, nowMin) {
    nowMin = nowMin == null ? NOW_MIN : nowMin;
    if (item.done) return false;
    if (item.rung === 'month' || item.rung === 'week' || item.rung === 'none') return false;  // 计划窗口不算逾期
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

  /** 计划窗口已过（week/month 专用，用 warning 而不是 danger） */
  function isWindowPassed(item, today) {
    today = today || TODAY;
    if (item.done) return false;
    if (item.rung === 'week') return weekStartOf(item.date) < weekStartOf(today);
    if (item.rung === 'month') return monthStartOf(item.date) < monthStartOf(today);
    return false;
  }

  /* ---- 紧急读数（ADR 0004 §4）：五级 ---- */
  function urgencyOf(item, nowMin) {
    nowMin = nowMin == null ? NOW_MIN : nowMin;
    if (item.urgent) return 'urgent';
    if (item.done) return 'none';
    if (item.rung === 'none' || item.rung === 'month') return 'none';
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
  };
})(window);
