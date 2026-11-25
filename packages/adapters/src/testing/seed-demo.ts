import type {
  Clock,
  IdGenerator,
  Instant,
  ListId,
  LocalDate,
  NewTask,
  UnitOfWork,
} from '@todolist/core';

export interface SeedDeps {
  readonly uow: UnitOfWork;
  readonly clock: Clock;
  readonly ids: IdGenerator;
}

/**
 * Demo content for the desktop shell: four lists and a fortnight of entries
 * laid out *relative to today*, so the calendar views are populated whenever
 * the app is first opened rather than only on one hardcoded day.
 *
 * Idempotent by construction: React StrictMode mounts effects twice in dev, so
 * the first call seeds and every later call returns immediately once any list
 * exists. `ids` is part of `SeedDeps` for symmetry with the other services —
 * the repositories already own id minting, so it is not used directly here.
 */
export async function seedDemoData(deps: SeedDeps): Promise<void> {
  const { uow, clock } = deps;

  const existing = await uow.lists.list();
  if (existing.length > 0) return;

  const now = clock.now();

  // Anchor on the real current day. Local-time construction keeps "9:00" at
  // 9:00 regardless of host timezone, and ISO output stays sortable.
  const today = new Date();
  const base = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const instantAt = (hour: number, minute = 0, dayOffset = 0): Instant => {
    const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() + dayOffset, hour, minute, 0, 0);
    return d.toISOString() as Instant;
  };
  const dateOf = (dayOffset = 0): LocalDate => {
    const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() + dayOffset);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}` as LocalDate;
  };

  const inbox = await uow.lists.create({ name: '收集箱', color: '#dd7366' }, now);
  const work = await uow.lists.create({ name: '工作', color: '#5b8def' }, now);
  const study = await uow.lists.create({ name: '学习', color: '#8b79c9' }, now);
  const life = await uow.lists.create({ name: '生活', color: '#d99a3d' }, now);

  const createTask = (
    listId: ListId,
    input: Omit<NewTask, 'listId'>,
  ) => uow.tasks.create({ ...input, listId }, now);

  // --- timed events, spread across the visible week --------------------------
  const events: { title: string; listId: typeof work.id; start: [number, number]; end: [number, number]; day: number }[] = [
    { title: '制定营销策略', listId: work.id, start: [9, 0], end: [12, 0], day: 0 },
    { title: '产品评审', listId: work.id, start: [13, 0], end: [16, 0], day: 0 },
    { title: '部门培训', listId: study.id, start: [9, 0], end: [12, 0], day: 1 },
    { title: '线上会议', listId: work.id, start: [8, 0], end: [10, 0], day: 2 },
    { title: '和妈妈逛街', listId: life.id, start: [14, 0], end: [18, 0], day: -1 },
    { title: '晨会同步', listId: work.id, start: [9, 0], end: [9, 30], day: 3 },
    { title: '客户沟通方案', listId: work.id, start: [14, 0], end: [16, 0], day: 4 },
    { title: '朋友聚餐', listId: life.id, start: [18, 0], end: [21, 0], day: 5 },
    { title: '周末徒步', listId: life.id, start: [8, 30], end: [12, 0], day: 6 },
  ];

  for (const e of events) {
    await uow.events.create(
      {
        title: e.title,
        listId: e.listId,
        startAt: instantAt(e.start[0], e.start[1], e.day),
        endAt: instantAt(e.end[0], e.end[1], e.day),
      },
      now,
    );
  }

  // --- tasks across the Eisenhower quadrants --------------------------------
  await createTask(life.id, {
    title: '晨跑',
    notes: '绕湖一圈，回来冲个澡',
    important: true,
    urgent: false,
    dueAt: instantAt(8),
    dueDate: dateOf(),
    allDay: false,
  });

  await createTask(inbox.id, {
    title: '拿快递',
    notes: '驿站 18:00 关门',
    important: false,
    urgent: true,
    dueAt: instantAt(17),
    dueDate: dateOf(),
    allDay: false,
  });

  await createTask(life.id, {
    title: '瑜伽课',
    notes: '带瑜伽垫',
    important: false,
    urgent: false,
    dueAt: instantAt(19),
    dueDate: dateOf(),
    allDay: false,
  });

  await createTask(study.id, {
    title: '阅读名人传记',
    notes: '每天 30 页',
    important: true,
    urgent: false,
    dueAt: instantAt(20),
    dueDate: dateOf(),
    allDay: false,
  });

  await createTask(inbox.id, {
    title: '整理音乐播放列表',
    notes: '',
    important: false,
    urgent: false,
    allDay: false,
  });

  await createTask(work.id, {
    title: '撰写周报',
    notes: '汇总本周进展与风险',
    important: true,
    urgent: true,
    dueAt: instantAt(18),
    dueDate: dateOf(),
    allDay: false,
  });

  const watered = await createTask(life.id, {
    title: '给绿植浇水',
    notes: '',
    important: false,
    urgent: false,
    allDay: false,
  });
  await uow.tasks.update(
    watered.id,
    { status: 'done', completedAt: instantAt(9, 0, -1) },
    now,
  );
}
