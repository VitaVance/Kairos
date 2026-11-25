/**
 * Demo-corpus text, one corpus per shipped UI language.
 *
 * These are *plain data*, not UI copy: the adapters package must not depend on
 * `@todolist/ui` (dependency-cruiser enforces it), so it cannot call `t()`.
 * The seeder receives the language chosen at first run and picks a corpus once;
 * the rows it writes are ordinary user content and are never retranslated.
 *
 * Both corpora carry the same 15 tasks and 12 events, in the same order, and
 * every row teaches the same lesson in each language. Scheduling (dates, flags,
 * recurrence, precision) deliberately lives in `seed-demo.ts`, not here, so the
 * two languages cannot drift apart structurally.
 */

export type SeedLanguage = 'en' | 'zh-CN';

export interface DemoTaskText {
  readonly title: string;
  readonly notes: string;
}

export interface DemoEventText {
  readonly title: string;
  readonly notes?: string;
}

export interface DemoListNames {
  readonly inbox: string;
  readonly work: string;
  readonly study: string;
  readonly life: string;
}

/**
 * Stable keys for the demo rows. They identify *what a row teaches*, never what
 * it says, so a wording change in one language is a one-line edit here.
 */
export type DemoTaskKey =
  | 'unscheduled'
  | 'allDay'
  | 'afternoon'
  | 'timed'
  | 'urgentImportant'
  | 'importantNotUrgent'
  | 'urgentNotImportant'
  | 'neither'
  | 'recurring'
  | 'dentist'
  | 'rent'
  | 'contract'
  | 'reading'
  | 'bookmarks'
  | 'done';

export type DemoEventKey =
  | 'gym'
  | 'designReview'
  | 'parentMeeting'
  | 'productReview'
  | 'weeklySync'
  | 'clientCall'
  | 'dentistFollowUp'
  | 'bookClub'
  | 'teamDinner'
  | 'workshop'
  | 'retrospective'
  | 'healthCheck';

export interface DemoCorpus {
  readonly lists: DemoListNames;
  readonly tasks: Record<DemoTaskKey, DemoTaskText>;
  readonly events: Record<DemoEventKey, DemoEventText>;
}

const en: DemoCorpus = {
  lists: { inbox: 'Inbox', work: 'Work', study: 'Study', life: 'Personal' },
  tasks: {
    unscheduled: {
      title: 'Unscheduled: quick note',
      notes: 'No date and no time — drop it in the inbox and schedule it later.',
    },
    allDay: {
      title: 'All day: sort the photo albums',
      notes: 'A day but no clock time; do it whenever you like that day.',
    },
    afternoon: {
      title: 'Afternoon: reply to the client',
      notes: 'Half-day precision: done any time in the afternoon (12:00–19:00), without claiming an exact hour.',
    },
    timed: {
      title: '15:30 pick up the kids',
      notes: 'Exact time: this appears on the calendar timeline, and reminders follow that hour.',
    },
    urgentImportant: {
      title: 'Due today: submit the expenses',
      notes: 'Important and urgent: it is void if not submitted today.',
    },
    importantNotUrgent: {
      title: 'Call my parents',
      notes: 'Important but not urgent — so give it a fixed evening instead of waiting for it to become urgent.',
    },
    urgentNotImportant: {
      title: 'Reply to one confirmation text',
      notes: 'Dragging the task into another quadrant flips both the important/urgent switches — a quadrant is computed from them, not stored as its own field.',
    },
    neither: {
      title: 'Look at the new productivity tools',
      notes: 'Press Ctrl+K to search tasks and events at any time.',
    },
    recurring: {
      title: 'Every Friday: review the week',
      notes: 'Set to “repeat weekly”. Completing this one schedules the next for the following Friday.',
    },
    dentist: {
      title: 'Book the dentist',
      notes: 'Someone else set the time: urgent, but not necessarily important.',
    },
    rent: {
      title: 'Pay the rent',
      notes: 'Once the date arrives it surfaces in Today and in the quadrants.',
    },
    contract: {
      title: 'Follow up on the contract signature',
      notes: 'Work with a real time shows on the timeline at a glance, including how long it takes.',
    },
    reading: {
      title: 'Read chapter three of Deep Work',
      notes: 'Important, not urgent and not scheduled yet — it waits here for you to plan it.',
    },
    bookmarks: {
      title: 'Tidy the browser bookmarks',
      notes: 'Neither important nor urgent: do it when there is time, delete it when there is not.',
    },
    done: {
      title: 'Done: tidy last week’s notes',
      notes: 'A ticked task stays in the list; untick it to restore it.',
    },
  },
  events: {
    gym: { title: 'Gym' },
    designReview: { title: 'Design review' },
    parentMeeting: { title: 'Parent-teacher meeting' },
    productReview: {
      title: 'Product review',
      notes: 'Events and tasks share one calendar: a task with a real time shows up here too.',
    },
    weeklySync: { title: 'Weekly sync' },
    clientCall: { title: 'Client call' },
    dentistFollowUp: { title: 'Dentist follow-up' },
    bookClub: { title: 'Book club' },
    teamDinner: { title: 'Team dinner' },
    workshop: { title: 'Workshop' },
    retrospective: { title: 'Project retrospective' },
    healthCheck: { title: 'Health check' },
  },
};

const zhCN: DemoCorpus = {
  lists: { inbox: '收集箱', work: '工作', study: '学习', life: '生活' },
  tasks: {
    unscheduled: {
      title: '未排期：随手记',
      notes: '没有日期，也没有时间——先放进收集箱，想起来再安排。',
    },
    allDay: {
      title: '全天：整理相册',
      notes: '只有「哪一天」，没有具体钟点；那一天什么时候做都行。',
    },
    afternoon: {
      title: '下午：回客户邮件',
      notes: '半天粒度：下午（12:00–19:00）做完即可，不占用具体钟点。',
    },
    timed: {
      title: '15:30 接孩子',
      notes: '具体时间：日历时间轴上会出现这一条，提醒也按这个钟点走。',
    },
    urgentImportant: {
      title: '今天截止：交报销单',
      notes: '重要且紧急：今天不交就作废。',
    },
    importantNotUrgent: {
      title: '给爸妈打电话',
      notes: '重要但不紧急——所以给它留一个固定的晚上，而不是等它变急。',
    },
    urgentNotImportant: {
      title: '回一条确认短信',
      notes: '把任务拖到另一个象限，会同时改「重要 / 紧急」两个开关——象限是这两个开关算出来的，不是单独存的字段。',
    },
    neither: {
      title: '看看新出的效率工具',
      notes: '按 Ctrl+K 可以随时搜索任务和日程。',
    },
    recurring: {
      title: '每周五：复盘一周',
      notes: '设置里选了「每周重复」。完成这一次后，会自动排到下一个周五。',
    },
    dentist: {
      title: '预约牙医',
      notes: '别人替你定了时间：紧急，但不一定重要。',
    },
    rent: {
      title: '交房租',
      notes: '日期一到，就会在「今天」和四象限里顶上来。',
    },
    contract: {
      title: '跟进合同签署',
      notes: '有具体时间的工作，在时间轴上一眼能看出要占多久。',
    },
    reading: {
      title: '读《深度工作》第三章',
      notes: '重要但不紧急、也还没排期的任务，会一直在这里等你安排。',
    },
    bookmarks: {
      title: '整理浏览器书签',
      notes: '不重要也不紧急：有空再做，没空就删掉。',
    },
    done: {
      title: '完成：整理上周纪要',
      notes: '勾掉的任务会留在列表里，也可以再取消勾选恢复。',
    },
  },
  events: {
    gym: { title: '健身房' },
    designReview: { title: '设计评审' },
    parentMeeting: { title: '家长会' },
    productReview: {
      title: '产品评审会',
      notes: '日程和任务共用同一个日历：带具体时间的任务也会出现在这里。',
    },
    weeklySync: { title: '周会同步' },
    clientCall: { title: '客户电话' },
    dentistFollowUp: { title: '牙医复诊' },
    bookClub: { title: '读书会' },
    teamDinner: { title: '部门聚餐' },
    workshop: { title: '研讨会' },
    retrospective: { title: '项目复盘' },
    healthCheck: { title: '体检' },
  },
};

/** Everything both corpora must contain, in seed order. */
export const DEMO_TASK_KEYS: readonly DemoTaskKey[] = [
  'unscheduled',
  'allDay',
  'afternoon',
  'timed',
  'urgentImportant',
  'importantNotUrgent',
  'urgentNotImportant',
  'neither',
  'recurring',
  'dentist',
  'rent',
  'contract',
  'reading',
  'bookmarks',
  'done',
];

export const DEMO_EVENT_KEYS: readonly DemoEventKey[] = [
  'gym',
  'designReview',
  'parentMeeting',
  'productReview',
  'weeklySync',
  'clientCall',
  'dentistFollowUp',
  'bookClub',
  'teamDinner',
  'workshop',
  'retrospective',
  'healthCheck',
];

export const SEED_CORPORA: Readonly<Record<SeedLanguage, DemoCorpus>> = {
  en,
  'zh-CN': zhCN,
};

/**
 * Map any locale tag onto a corpus the app actually ships.
 *
 * Mirrors `detectLanguage` in `@todolist/ui` (deliberately duplicated rather
 * than imported: the adapters package must not depend on presentation). Any
 * Chinese tag gets the Simplified Chinese corpus; everything else — including
 * an unknown or missing tag — gets English, matching `fallbackLng: 'en'`.
 */
export function seedLanguage(candidate: string | null | undefined): SeedLanguage {
  if (typeof candidate !== 'string' || candidate.length === 0) return 'en';
  return candidate.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en';
}
