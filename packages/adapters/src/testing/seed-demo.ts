import { SYSTEM_INBOX_KEY } from '@todolist/core';
import type {
  Clock,
  IdGenerator,
  Instant,
  ListId,
  LocalDate,
  NewTask,
  UnitOfWork,
} from '@todolist/core';
import { SEED_CORPORA, seedLanguage } from './seed-corpora.js';
import type { DemoCorpus, SeedLanguage } from './seed-corpora.js';

export interface SeedDeps {
  readonly uow: UnitOfWork;
  readonly clock: Clock;
  readonly ids: IdGenerator;
  /**
   * UI language at first run. A missing/unknown tag falls back to English, so
   * a caller that has not been updated still seeds *something* sensible.
   * Read once, at seed time: the rows are then ordinary content and never
   * retranslated when the user switches language later.
   */
  readonly language?: string | null;
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

  const corpus = corpusFor(seedLanguage(deps.language));
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

  // The inbox is the one list with a stable identity: its stored name is only
  // a fallback, and every surface renders `t('quadrant.inbox')` from the
  // catalog instead. The other three are ordinary content, localized once.
  const inbox = await uow.lists.create(
    { name: corpus.lists.inbox, color: '#dd7366', systemKey: SYSTEM_INBOX_KEY },
    now,
  );
  const work = await uow.lists.create({ name: corpus.lists.work, color: '#5b8def' }, now);
  const study = await uow.lists.create({ name: corpus.lists.study, color: '#8b79c9' }, now);
  const life = await uow.lists.create({ name: corpus.lists.life, color: '#d99a3d' }, now);

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
    listId: ListId;
    start: [number, number];
    end: [number, number];
    day: number;
  }[] = [
    { title: corpus.events.gym.title, listId: life.id, start: [19, 0], end: [20, 0], day: -4 },
    { title: corpus.events.designReview.title, listId: work.id, start: [14, 0], end: [15, 0], day: -2 },
    { title: corpus.events.parentMeeting.title, listId: life.id, start: [18, 30], end: [20, 0], day: -1 },
    {
      title: corpus.events.productReview.title,
      notes: corpus.events.productReview.notes ?? '',
      listId: work.id,
      start: [10, 0],
      end: [11, 0],
      day: 0,
    },
    { title: corpus.events.weeklySync.title, listId: work.id, start: [9, 30], end: [10, 0], day: 1 },
    { title: corpus.events.clientCall.title, listId: work.id, start: [14, 0], end: [15, 0], day: 2 },
    { title: corpus.events.dentistFollowUp.title, listId: life.id, start: [16, 0], end: [17, 0], day: 3 },
    { title: corpus.events.bookClub.title, listId: study.id, start: [19, 30], end: [21, 0], day: 4 },
    { title: corpus.events.teamDinner.title, listId: life.id, start: [18, 0], end: [20, 0], day: 5 },
    { title: corpus.events.workshop.title, listId: study.id, start: [10, 0], end: [12, 0], day: 6 },
    { title: corpus.events.retrospective.title, listId: work.id, start: [15, 0], end: [16, 30], day: 7 },
    { title: corpus.events.healthCheck.title, listId: life.id, start: [8, 30], end: [10, 0], day: 9 },
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

  // --- the tour of the model --------------------------------------------------
  // Scheduling lives here, not in the corpus, so the two language corpora can
  // never drift structurally apart. Order matters: it is the creation order,
  // which is also the order the lists and screens show these rows in.
  //
  // The four scheduling precisions are labelled in their titles because the
  // title is the only text a month cell shows.

  const t = (key: keyof DemoCorpus['tasks']) => corpus.tasks[key];

  const tasks: {
    listId: ListId;
    input: Omit<NewTask, 'listId'>;
    /** The seeded done task is flipped to `done` after creation. */
    complete?: boolean;
  }[] = [
    {
      listId: inbox.id,
      input: {
        title: t('unscheduled').title,
        notes: t('unscheduled').notes,
        important: false,
        urgent: false,
        allDay: false,
      },
    },
    {
      listId: life.id,
      input: {
        title: t('allDay').title,
        notes: t('allDay').notes,
        important: true,
        urgent: false,
        dueDate: dateOf(4),
        allDay: true,
      },
    },
    {
      listId: work.id,
      input: {
        title: t('afternoon').title,
        notes: t('afternoon').notes,
        important: true,
        urgent: true,
        dueDate: dateOf(),
        allDay: true,
        duePeriod: 'afternoon',
      },
    },
    {
      listId: life.id,
      input: {
        title: t('timed').title,
        notes: t('timed').notes,
        important: true,
        urgent: true,
        dueAt: instantAt(15, 30),
        dueDate: dateOf(),
        allDay: false,
      },
    },
    // --- the four quadrants, with a reason to tell the axes apart -------------
    {
      listId: work.id,
      input: {
        title: t('urgentImportant').title,
        notes: t('urgentImportant').notes,
        important: true,
        urgent: true,
        dueAt: instantAt(17),
        dueDate: dateOf(),
        allDay: false,
      },
    },
    {
      listId: life.id,
      input: {
        title: t('importantNotUrgent').title,
        notes: t('importantNotUrgent').notes,
        important: true,
        urgent: false,
        dueDate: dateOf(),
        allDay: true,
        duePeriod: 'evening',
      },
    },
    {
      listId: inbox.id,
      input: {
        title: t('urgentNotImportant').title,
        notes: t('urgentNotImportant').notes,
        important: false,
        urgent: true,
        allDay: false,
      },
    },
    {
      listId: study.id,
      input: {
        title: t('neither').title,
        notes: t('neither').notes,
        important: false,
        urgent: false,
        allDay: false,
      },
    },
    // --- a recurring task: completing one instance schedules the next ---------
    // Monday = 0. Pick this week's upcoming Friday; if today is Friday already,
    // the first instance lands next Friday so the series always starts ahead.
    {
      listId: study.id,
      input: {
        title: t('recurring').title,
        notes: t('recurring').notes,
        important: true,
        urgent: false,
        dueDate: dateOf(fridayOffset(base)),
        allDay: true,
        recurrence: { frequency: 'weekly', interval: 1, weekdays: [4] },
      },
    },
    // --- remaining useful-looking entries, each with its own point -------------
    {
      listId: life.id,
      input: {
        title: t('dentist').title,
        notes: t('dentist').notes,
        important: false,
        urgent: true,
        dueDate: dateOf(3),
        allDay: true,
      },
    },
    {
      listId: inbox.id,
      input: {
        title: t('rent').title,
        notes: t('rent').notes,
        important: true,
        urgent: true,
        dueDate: dateOf(2),
        allDay: true,
      },
    },
    {
      listId: work.id,
      input: {
        title: t('contract').title,
        notes: t('contract').notes,
        important: true,
        urgent: true,
        dueAt: instantAt(11, 0, 1),
        dueDate: dateOf(1),
        allDay: false,
      },
    },
    {
      listId: study.id,
      input: {
        title: t('reading').title,
        notes: t('reading').notes,
        important: true,
        urgent: false,
        allDay: false,
      },
    },
    {
      listId: inbox.id,
      input: {
        title: t('bookmarks').title,
        notes: t('bookmarks').notes,
        important: false,
        urgent: false,
        allDay: false,
      },
    },
    // --- the done state, so the completed section is not a mystery ------------
    {
      listId: work.id,
      input: {
        title: t('done').title,
        notes: t('done').notes,
        important: true,
        urgent: false,
        dueDate: dateOf(-1),
        allDay: true,
      },
      complete: true,
    },
  ];

  for (const { listId, input, complete } of tasks) {
    const created = await createTask(listId, input);
    if (complete) {
      await uow.tasks.update(
        created.id,
        { status: 'done', completedAt: instantAt(16, 40, -1) },
        now,
      );
    }
  }

  await markDismissed(deps);
}

/** Offset from today to this week's upcoming Friday (never 0: see above). */
function fridayOffset(base: Date): number {
  const offset = (4 - ((base.getDay() + 6) % 7) + 7) % 7;
  return offset === 0 ? 7 : offset;
}

/** Narrow the fallback contract to the corpora actually bundled here. */
function corpusFor(language: SeedLanguage): DemoCorpus {
  return SEED_CORPORA[language];
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
