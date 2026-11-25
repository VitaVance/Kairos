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
 * Key under which "the user has finished with (or cleared) onboarding" is
 * recorded. The value is the ISO instant it was set; presence is what matters.
 * Stored in the same database as the data, so a reset survives restarts and a
 * copied database carries the decision with it.
 */
export const ONBOARDING_DISMISSED_KEY = 'onboarding.demo-dismissed';

/**
 * The tiny key/value surface the seed needs. Both bundled units of work expose
 * it as `settings`; anything else (a hand-written fake in a test) simply does
 * not, and seeding falls back to the old "seed when empty" rule.
 */
interface SettingsStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
}

function settingsOf(uow: UnitOfWork): SettingsStore | null {
  const candidate = (uow as { settings?: Partial<SettingsStore> }).settings;
  if (candidate === undefined) return null;
  return typeof candidate.get === 'function' && typeof candidate.set === 'function'
    ? (candidate as SettingsStore)
    : null;
}

async function isDismissed(uow: UnitOfWork): Promise<boolean> {
  const settings = settingsOf(uow);
  if (!settings) return false;
  return (await settings.get(ONBOARDING_DISMISSED_KEY)) !== null;
}

async function markDismissed(deps: SeedDeps): Promise<void> {
  const settings = settingsOf(deps.uow);
  if (!settings) return;
  await settings.set(ONBOARDING_DISMISSED_KEY, deps.clock.now());
}

/**
 * Demo content for the desktop shell: a small, deliberate tour of the model.
 *
 * Every row exists to demonstrate exactly one idea — four lists, all four
 * Eisenhower quadrants, all four scheduling precisions (labelled in the task
 * titles, because a title is the only text a month cell shows), one recurring
 * task, two affordance hints in notes, and a completed task. Dates are laid
 * out *relative to today* so the calendar is populated whenever the app is
 * first opened rather than only on one hardcoded day.
 *
 * Idempotent twice over: React StrictMode mounts effects twice in dev, and a
 * dismissed onboarding is never seeded again. `ids` is part of `SeedDeps` for
 * symmetry with the other services — the repositories already own id minting,
 * so it is not used directly here.
 */
export async function seedDemoData(deps: SeedDeps): Promise<void> {
  const { uow, clock } = deps;

  // A reset (or a user who already has real data) leaves this flag behind.
  // Reading it first is what stops a reset from resurrecting the demo.
  if (await isDismissed(uow)) return;

  const existing = await uow.lists.list();
  if (existing.length > 0) {
    // Pre-flag installs: having data of their own is itself "onboarding done".
    await markDismissed(deps);
    return;
  }

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

  // --- events: one per day, a comfortable spread across the visible month ----
  // Times are local wall clock, days are offsets from today, so the calendar
  // is never empty on first run and never looks like one dense block either.
  const events: {
    title: string;
    notes?: string;
    listId: typeof work.id;
    start: [number, number];
    end: [number, number];
    day: number;
  }[] = [
    { title: '健身房', listId: life.id, start: [19, 0], end: [20, 0], day: -4 },
    { title: '设计评审', listId: work.id, start: [14, 0], end: [15, 0], day: -2 },
    { title: '家长会', listId: life.id, start: [18, 30], end: [20, 0], day: -1 },
    {
      title: '产品评审会',
      notes: '日程和任务共用同一个日历：带具体时间的任务也会出现在这里。',
      listId: work.id,
      start: [10, 0],
      end: [11, 0],
      day: 0,
    },
    { title: '周会同步', listId: work.id, start: [9, 30], end: [10, 0], day: 1 },
    { title: '客户电话', listId: work.id, start: [14, 0], end: [15, 0], day: 2 },
    { title: '牙医复诊', listId: life.id, start: [16, 0], end: [17, 0], day: 3 },
    { title: '读书会', listId: study.id, start: [19, 30], end: [21, 0], day: 4 },
    { title: '部门聚餐', listId: life.id, start: [18, 0], end: [20, 0], day: 5 },
    { title: '研讨会', listId: study.id, start: [10, 0], end: [12, 0], day: 6 },
    { title: '项目复盘', listId: work.id, start: [15, 0], end: [16, 30], day: 7 },
    { title: '体检', listId: life.id, start: [8, 30], end: [10, 0], day: 9 },
  ];

  for (const e of events) {
    await uow.events.create(
      {
        title: e.title,
        notes: e.notes ?? '',
        listId: e.listId,
        startAt: instantAt(e.start[0], e.start[1], e.day),
        endAt: instantAt(e.end[0], e.end[1], e.day),
      },
      now,
    );
  }

  // --- the four scheduling precisions, labelled in the titles -----------------
  // The title is the only text a month cell shows, so "what kind of schedule
  // this is" has to be readable there, not just in the detail panel.

  await createTask(inbox.id, {
    title: '未排期：随手记',
    notes: '没有日期，也没有时间——先放进收集箱，想起来再安排。',
    important: false,
    urgent: false,
    allDay: false,
  });

  await createTask(life.id, {
    title: '全天：整理相册',
    notes: '只有「哪一天」，没有具体钟点；那一天什么时候做都行。',
    important: true,
    urgent: false,
    dueDate: dateOf(4),
    allDay: true,
  });

  await createTask(work.id, {
    title: '下午：回客户邮件',
    notes: '半天粒度：下午（12:00–19:00）做完即可，不占用具体钟点。',
    important: true,
    urgent: true,
    dueDate: dateOf(),
    allDay: true,
    duePeriod: 'afternoon',
  });

  await createTask(life.id, {
    title: '15:30 接孩子',
    notes: '具体时间：日历时间轴上会出现这一条，提醒也按这个钟点走。',
    important: true,
    urgent: true,
    dueAt: instantAt(15, 30),
    dueDate: dateOf(),
    allDay: false,
  });

  // --- the four quadrants, with a reason to tell the axes apart ---------------

  await createTask(work.id, {
    title: '今天截止：交报销单',
    notes: '重要且紧急：今天不交就作废。',
    important: true,
    urgent: true,
    dueAt: instantAt(17),
    dueDate: dateOf(),
    allDay: false,
  });

  await createTask(life.id, {
    title: '给爸妈打电话',
    notes: '重要但不紧急——所以给它留一个固定的晚上，而不是等它变急。',
    important: true,
    urgent: false,
    dueDate: dateOf(),
    allDay: true,
    duePeriod: 'evening',
  });

  await createTask(inbox.id, {
    title: '回一条确认短信',
    notes: '把任务拖到另一个象限，会同时改「重要 / 紧急」两个开关——象限是这两个开关算出来的，不是单独存的字段。',
    important: false,
    urgent: true,
    allDay: false,
  });

  await createTask(study.id, {
    title: '看看新出的效率工具',
    notes: '按 Ctrl+K 可以随时搜索任务和日程。',
    important: false,
    urgent: false,
    allDay: false,
  });

  // --- a recurring task: completing one instance schedules the next -----------

  // Monday = 0. Pick this week's upcoming Friday; if today is Friday already,
  // the first instance lands next Friday so the series always starts ahead.
  const fridayOffset = (() => {
    const offset = (4 - ((base.getDay() + 6) % 7) + 7) % 7;
    return offset === 0 ? 7 : offset;
  })();
  await createTask(study.id, {
    title: '每周五：复盘一周',
    notes: '设置里选了「每周重复」。完成这一次后，会自动排到下一个周五。',
    important: true,
    urgent: false,
    dueDate: dateOf(fridayOffset),
    allDay: true,
    recurrence: { frequency: 'weekly', interval: 1, weekdays: [4] },
  });

  // --- remaining useful-looking entries, each with its own point --------------

  await createTask(life.id, {
    title: '预约牙医',
    notes: '别人替你定了时间：紧急，但不一定重要。',
    important: false,
    urgent: true,
    dueDate: dateOf(3),
    allDay: true,
  });

  await createTask(inbox.id, {
    title: '交房租',
    notes: '日期一到，就会在「今天」和四象限里顶上来。',
    important: true,
    urgent: true,
    dueDate: dateOf(2),
    allDay: true,
  });

  await createTask(work.id, {
    title: '跟进合同签署',
    notes: '有具体时间的工作，在时间轴上一眼能看出要占多久。',
    important: true,
    urgent: true,
    dueAt: instantAt(11, 0, 1),
    dueDate: dateOf(1),
    allDay: false,
  });

  await createTask(study.id, {
    title: '读《深度工作》第三章',
    notes: '重要但不紧急、也还没排期的任务，会一直在这里等你安排。',
    important: true,
    urgent: false,
    allDay: false,
  });

  await createTask(inbox.id, {
    title: '整理浏览器书签',
    notes: '不重要也不紧急：有空再做，没空就删掉。',
    important: false,
    urgent: false,
    allDay: false,
  });

  // --- the done state, so the completed section is not a mystery --------------

  const done = await createTask(work.id, {
    title: '完成：整理上周纪要',
    notes: '勾掉的任务会留在列表里，也可以再取消勾选恢复。',
    important: true,
    urgent: false,
    dueDate: dateOf(-1),
    allDay: true,
  });
  await uow.tasks.update(
    done.id,
    { status: 'done', completedAt: instantAt(16, 40, -1) },
    now,
  );

  await markDismissed(deps);
}

/**
 * Deletes *everything*: every task, event and list, then records that
 * onboarding is over so the demo never comes back.
 *
 * This is deliberately not "remove only the demo rows": once the user has
 * edited a seeded row there is no reliable way to tell it apart from their
 * own content. Deleting all of it is the only honest meaning of the button,
 * which is why the UI labels it 「清空所有数据」 rather than 「清除示例数据」.
 *
 * Order matters on SQLite: tasks are deleted before lists so the result does
 * not depend on `ON DELETE CASCADE` being enabled. Removing a missing row is a
 * no-op in both adapters, so this is safe to run twice.
 */
export async function resetAllData(deps: SeedDeps): Promise<void> {
  const { uow } = deps;

  // Snapshot each collection before deleting: the in-memory lists repository
  // returns its live array, so mutating it while iterating would skip rows.
  for (const task of [...(await uow.tasks.list())]) {
    await uow.tasks.remove(task.id);
  }
  for (const event of [...(await uow.events.list())]) {
    await uow.events.remove(event.id);
  }
  for (const list of [...(await uow.lists.list())]) {
    await uow.lists.remove(list.id);
  }

  // Persist the decision *after* the deletes so a failure halfway through
  // leaves the flag unset and the user can simply retry.
  await markDismissed(deps);
}
