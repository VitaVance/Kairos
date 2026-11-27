/**
 * verify-data.mjs — 断言 data.js 的每一条承诺。
 *   node design/v2/verify-data.mjs
 * 不依赖浏览器。任何一条失败就退出码 1。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, 'data.js'), 'utf8');
const g = {};
new Function('window', src)(g);
const K = g.Kairos;

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; }
  else { fail++; console.log('FAIL  ' + name + (detail ? '   ' + JSON.stringify(detail) : '')); }
};
const eq = (name, a, b) => ok(name, JSON.stringify(a) === JSON.stringify(b), { got: a, want: b });

/* ---------- 1. 时钟 ---------- */
{
  K.setNow(14 * 60 + 20, '2026-11-26');
  const item = K.ITEMS.find((i) => i.title === '交报销单'); // 18:00 today
  eq('18:00 的事在 14:20 是 near', K.urgencyOf(item), 'near');
  K.setNow(19 * 60);                                        // 19:00
  eq('setNow 之后立刻变 urgent（原来改不动）', K.urgencyOf(item), 'urgent');
  eq('quadrantOf 跟着时钟走：过期 + 重要 = Q1', K.quadrantOf(item), 1);
  K.setNow(14 * 60 + 20);
}

/* ---------- 2. quadrantOf 把时钟传下去 ---------- */
{
  const item = K.ITEMS.find((i) => i.title === '交报销单');
  eq('显式传 nowMin 时象限与之相符', K.quadrantOf(item, 19 * 60), 1);
  const notImportant = { ...item, important: false, urgent: false };
  eq('不重要的过期事进 Q3', K.quadrantOf(notImportant, 19 * 60), 3);
}

/* ---------- 3. 周标签不许有负数 ---------- */
{
  eq('上周', K.rungLabel({ rung: 'week', date: '2026-11-16' }), '上周');
  eq('这周', K.rungLabel({ rung: 'week', date: '2026-11-23' }), '这周');
  eq('下周', K.rungLabel({ rung: 'week', date: '2026-11-30' }), '下周');
  eq('三周前不是「第 -3 周」', K.rungLabel({ rung: 'week', date: '2026-11-02' }), '3 周前');
  eq('六周前', K.rungLabel({ rung: 'week', date: '2026-10-12' }), '6 周前');
  ok('任何周标签不含负号', !/-\d/.test(K.rungLabel({ rung: 'week', date: '2026-10-12' })));
}

/* ---------- 4. 区间终点只有一份算法 ---------- */
{
  const inc = K.spanEnd('week', '2026-11-23', true);
  eq('本周闭区间终点是 11/29', inc.end, '2026-11-29');
  const exc = K.spanEnd('week', '2026-11-23', false);
  eq('半开终点是下周一', exc.end, '2026-11-30');
  eq('给人看的写法', K.formatSpan('week', '2026-11-23'), '11/23 – 11/29');
  eq('月区间闭终点是月末', K.spanEnd('month', '2026-12-01', true).end, '2026-12-31');
  eq('任意区间', K.formatSpan('range', { start: '2026-12-03', end: '2026-12-05' }), '12/3 – 12/5');
}

/* ---------- 5. 计数只有一个真源 ---------- */
{
  const c = K.counts();
  eq('未完成 20（19 条原数据 + 新增的出差）', c.open, 20);
  eq('总数 21', c.total, 21);
  eq('今天这一格 5 件', c.today, 5);
  eq('今天要操心 7 件（含覆盖今天的窗口）', c.todayWindow, 7);
  eq('收集箱 2', c.byList.inbox, 2);
  ok('两个今天口径是分开的字段', 'today' in c && 'todayWindow' in c);
}

/* ---------- 6. 占用与意图 ---------- */
{
  const trip = K.ITEMS.find((i) => i.title === '去杭州出差');
  const summary = K.ITEMS.find((i) => i.title === '写季度总结');
  ok('出差是占用', K.isOccupancy(trip));
  ok('写季度总结不是占用', !K.isOccupancy(summary));
  eq('出差的区间文字', K.rungLabel(trip), '12/3 – 12/5');
}

/* ---------- 7. 覆盖今天 ---------- */
{
  eq('本周窗口覆盖今天', K.coversToday({ rung: 'week', date: '2026-11-23' }), true);
  eq('上周窗口不覆盖今天', K.coversToday({ rung: 'week', date: '2026-11-16' }), false);
  eq('无日期不覆盖今天', K.coversToday({ rung: 'none' }), false);
  eq('出差期间覆盖今天（12/3 之后）', K.coversToday({ rung: 'range', start: '2026-12-03', end: '2026-12-05' }, '2026-12-04'), true);
}

/* ---------- 8. 改 TODAY，一切跟着走 ---------- */
{
  K.setNow(9 * 60, '2026-11-27');
  eq('换一天之后今天计数变', K.counts().today, 2);
  // 11/27 仍在同一周（周一是 11/23），所以「本周」= 11/23 那一周不变。
  // 要验证标签真的在动，跨到下一周去。
  K.setNow(9 * 60, '2026-11-30');                 // 下周一
  const relabel = K.rungLabel({ rung: 'week', date: '2026-11-23' });
  ok('跨周之后 11/23 那一周变成上周', relabel === '上周', relabel);
  eq('而 11/30 自己是这周', K.rungLabel({ rung: 'week', date: '2026-11-30' }), '这周');
  K.setNow(14 * 60 + 20, '2026-11-26');
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
