import type {
  CalendarEvent,
  DuePeriod,
  EventId,
  Instant,
  ListId,
  LocalDate,
  Recurrence,
  Task,
  TaskId,
  TaskList,
  TaskStatus,
} from '@todolist/core';
import { isValidRecurrence } from '@todolist/core';

/**
 * Export / import — pure data transformation, no IO, no React, no DOM.
 *
 * The backup envelope is deliberately versioned and has a fixed key order so
 * two backups of the same data diff cleanly. CSV is offered for spreadsheets,
 * not for round-tripping: it has no id column, so it can never recreate the
 * exact database rows.
 */

export const BACKUP_FORMAT = 'todolist-backup';
/**
 * v2 adds `task.recurrence` (nullable); v3 adds `task.duePeriod` (nullable).
 * The parser still accepts v1/v2 files: a missing field reads as "does not
 * repeat" / "no half-day bucket", which is exactly what those versions mean,
 * so old backups keep importing without a migration step. Raising the version
 * also makes an older app refuse a newer file instead of silently dropping
 * `duePeriod` — see the `version > BACKUP_VERSION` check in `parseImport`.
 */
export const BACKUP_VERSION = 3;

/** The three record collections a backup carries. */
export interface BackupData {
  readonly tasks: readonly Task[];
  readonly lists: readonly TaskList[];
  readonly events: readonly CalendarEvent[];
}

export interface BackupMeta {
  readonly appVersion?: string;
  readonly note?: string;
}

/** Versioned envelope written to disk. */
export interface BackupFile {
  readonly format: typeof BACKUP_FORMAT;
  readonly version: typeof BACKUP_VERSION;
  readonly exportedAt: Instant;
  readonly meta?: BackupMeta;
  readonly data: BackupData;
}

/** Caller-supplied values for an export. `exportedAt` defaults to now. */
export interface ExportMeta {
  readonly exportedAt?: Instant;
  readonly appVersion?: string;
  readonly note?: string;
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

function canonicalList(list: TaskList): TaskList {
  return {
    id: list.id,
    name: list.name,
    color: list.color,
    order: list.order,
    archived: list.archived,
    createdAt: list.createdAt,
    updatedAt: list.updatedAt,
  };
}

function canonicalTask(task: Task): Task {
  return {
    id: task.id,
    listId: task.listId,
    title: task.title,
    notes: task.notes,
    status: task.status,
    important: task.important,
    urgent: task.urgent,
    dueAt: task.dueAt,
    dueDate: task.dueDate,
    allDay: task.allDay,
    duePeriod: task.duePeriod,
    recurrence: task.recurrence,
    completedAt: task.completedAt,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
  };
}

function canonicalEvent(event: CalendarEvent): CalendarEvent {
  return {
    id: event.id,
    listId: event.listId,
    title: event.title,
    notes: event.notes,
    startAt: event.startAt,
    endAt: event.endAt,
    allDay: event.allDay,
    createdAt: event.createdAt,
    updatedAt: event.updatedAt,
  };
}

/**
 * Builds the backup envelope. Every record is rebuilt with a fixed key order,
 * and the collection order is always tasks → lists → events, so the serialized
 * form is byte-stable for identical input.
 */
export function exportToJson(data: BackupData, meta: ExportMeta = {}): BackupFile {
  const exportedAt = meta.exportedAt ?? (new Date().toISOString() as Instant);
  const canonicalData: BackupData = {
    tasks: data.tasks.map(canonicalTask),
    lists: data.lists.map(canonicalList),
    events: data.events.map(canonicalEvent),
  };

  const normalizedMeta: BackupMeta = {
    ...(meta.appVersion === undefined ? {} : { appVersion: meta.appVersion }),
    ...(meta.note === undefined ? {} : { note: meta.note }),
  };

  if (normalizedMeta.appVersion !== undefined || normalizedMeta.note !== undefined) {
    return {
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      exportedAt,
      meta: normalizedMeta,
      data: canonicalData,
    };
  }

  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt,
    data: canonicalData,
  };
}

/** Serialize a backup with two-space indentation and a trailing newline. */
export function serializeBackup(file: BackupFile): string {
  return `${JSON.stringify(file, null, 2)}\n`;
}

// ---------------------------------------------------------------------------
// CSV export
// ---------------------------------------------------------------------------

export const CSV_COLUMNS = [
  '标题',
  '清单',
  '状态',
  '重要',
  '紧急',
  '到期日',
  '到期时间',
  '备注',
] as const;

const CSV_LINE_ENDING = '\r\n';

/** RFC 4180: quote when the cell contains a comma, quote, CR or LF. */
function csvCell(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function clockTime(instant: Instant): string {
  const d = new Date(instant);
  if (Number.isNaN(d.getTime())) return '';
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/**
 * Tasks as an RFC 4180 CSV. Deliberately lossy: no ids, booleans become
 * 是/否, instants become local HH:mm. Use the JSON backup for a faithful copy.
 */
export function exportTasksToCsv(tasks: readonly Task[], lists: readonly TaskList[]): string {
  const listNames = new Map<string, string>();
  for (const list of lists) listNames.set(list.id, list.name);

  const rows: string[] = [CSV_COLUMNS.map(csvCell).join(',')];

  for (const task of tasks) {
    rows.push(
      [
        task.title,
        listNames.get(task.listId) ?? '',
        task.status === 'done' ? '已完成' : '未完成',
        task.important ? '是' : '否',
        task.urgent ? '是' : '否',
        task.dueDate ?? '',
        task.dueAt === null ? '' : clockTime(task.dueAt),
        task.notes,
      ]
        .map((cell) => csvCell(cell))
        .join(','),
    );
  }

  return `${rows.join(CSV_LINE_ENDING)}${CSV_LINE_ENDING}`;
}

// ---------------------------------------------------------------------------
// Import validation
// ---------------------------------------------------------------------------

export interface ImportSuccess {
  readonly ok: true;
  readonly data: BackupData;
}

export interface ImportFailure {
  readonly ok: false;
  readonly errors: readonly string[];
}

export type ImportResult = ImportSuccess | ImportFailure;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isInstantValue(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && !Number.isNaN(Date.parse(value));
}

function isLocalDateValue(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function validateTask(raw: unknown, at: string, errors: string[]): Task | null {
  if (!isRecord(raw)) {
    errors.push(`${at}: 必须是对象`);
    return null;
  }

  let ok = true;

  const text = (key: string, allowEmpty = true): string => {
    const value = raw[key];
    if (typeof value !== 'string') {
      errors.push(`${at}.${key}: 必须是字符串`);
      ok = false;
      return '';
    }
    if (!allowEmpty && value.length === 0) {
      errors.push(`${at}.${key}: 不能为空`);
      ok = false;
    }
    return value;
  };

  const bool = (key: string): boolean => {
    const value = raw[key];
    if (typeof value !== 'boolean') {
      errors.push(`${at}.${key}: 必须是布尔值`);
      ok = false;
      return false;
    }
    return value;
  };

  const instant = (key: string): Instant => {
    const value = raw[key];
    if (!isInstantValue(value)) {
      errors.push(`${at}.${key}: 必须是 ISO-8601 时间字符串`);
      ok = false;
      return '' as Instant;
    }
    return value as Instant;
  };

  const nullableInstant = (key: string): Instant | null => {
    const value = raw[key];
    if (value === null) return null;
    if (!isInstantValue(value)) {
      errors.push(`${at}.${key}: 必须是 ISO-8601 时间字符串或 null`);
      ok = false;
      return null;
    }
    return value as Instant;
  };

  const nullableLocalDate = (key: string): LocalDate | null => {
    const value = raw[key];
    if (value === null) return null;
    if (!isLocalDateValue(value)) {
      errors.push(`${at}.${key}: 必须是 YYYY-MM-DD 日期字符串或 null`);
      ok = false;
      return null;
    }
    return value as LocalDate;
  };

  /**
   * Absent and null both mean "does not repeat" — that is what a v1 backup
   * encodes, so old files keep importing unchanged. Anything present must be a
   * structurally valid rule.
   */
  const nullableRecurrence = (key: string): Recurrence | null => {
    const value = raw[key];
    if (value === undefined || value === null) return null;
    if (!isValidRecurrence(value)) {
      errors.push(`${at}.${key}: 重复规则无效（需包含合法的 frequency / interval）`);
      ok = false;
      return null;
    }
    return value;
  };

  /**
   * Same tolerance as `nullableRecurrence`: absent/undefined/null all mean
   * "whole day, no bucket", so a v1/v2 backup imports unchanged. A present
   * value must be one of the three buckets.
   */
  const nullablePeriod = (key: string): DuePeriod | null => {
    const value = raw[key];
    if (value === undefined || value === null) return null;
    if (value !== 'morning' && value !== 'afternoon' && value !== 'evening') {
      errors.push(`${at}.${key}: 必须是 "morning"、"afternoon"、"evening" 或 null`);
      ok = false;
      return null;
    }
    return value;
  };

  let status: TaskStatus = 'open';
  const rawStatus = raw['status'];
  if (rawStatus === 'open' || rawStatus === 'done') {
    status = rawStatus;
  } else {
    errors.push(`${at}.status: 必须是 "open" 或 "done"`);
    ok = false;
  }

  const task: Task = {
    id: text('id', false) as TaskId,
    listId: text('listId', false) as ListId,
    title: text('title', false),
    notes: text('notes'),
    status,
    important: bool('important'),
    urgent: bool('urgent'),
    dueAt: nullableInstant('dueAt'),
    dueDate: nullableLocalDate('dueDate'),
    allDay: bool('allDay'),
    duePeriod: nullablePeriod('duePeriod'),
    recurrence: nullableRecurrence('recurrence'),
    completedAt: nullableInstant('completedAt'),
    createdAt: instant('createdAt'),
    updatedAt: instant('updatedAt'),
  };

  return ok ? task : null;
}

function validateList(raw: unknown, at: string, errors: string[]): TaskList | null {
  if (!isRecord(raw)) {
    errors.push(`${at}: 必须是对象`);
    return null;
  }

  let ok = true;

  const text = (key: string, allowEmpty = true): string => {
    const value = raw[key];
    if (typeof value !== 'string') {
      errors.push(`${at}.${key}: 必须是字符串`);
      ok = false;
      return '';
    }
    if (!allowEmpty && value.length === 0) {
      errors.push(`${at}.${key}: 不能为空`);
      ok = false;
    }
    return value;
  };

  const instant = (key: string): Instant => {
    const value = raw[key];
    if (!isInstantValue(value)) {
      errors.push(`${at}.${key}: 必须是 ISO-8601 时间字符串`);
      ok = false;
      return '' as Instant;
    }
    return value as Instant;
  };

  let order = 0;
  const rawOrder = raw['order'];
  if (typeof rawOrder !== 'number' || !Number.isFinite(rawOrder)) {
    errors.push(`${at}.order: 必须是数字`);
    ok = false;
  } else {
    order = rawOrder;
  }

  let archived = false;
  const rawArchived = raw['archived'];
  if (typeof rawArchived !== 'boolean') {
    errors.push(`${at}.archived: 必须是布尔值`);
    ok = false;
  } else {
    archived = rawArchived;
  }

  const list: TaskList = {
    id: text('id', false) as ListId,
    name: text('name', false),
    color: text('color'),
    order,
    archived,
    createdAt: instant('createdAt'),
    updatedAt: instant('updatedAt'),
  };

  return ok ? list : null;
}

function validateEvent(raw: unknown, at: string, errors: string[]): CalendarEvent | null {
  if (!isRecord(raw)) {
    errors.push(`${at}: 必须是对象`);
    return null;
  }

  let ok = true;

  const text = (key: string, allowEmpty = true): string => {
    const value = raw[key];
    if (typeof value !== 'string') {
      errors.push(`${at}.${key}: 必须是字符串`);
      ok = false;
      return '';
    }
    if (!allowEmpty && value.length === 0) {
      errors.push(`${at}.${key}: 不能为空`);
      ok = false;
    }
    return value;
  };

  const instant = (key: string): Instant => {
    const value = raw[key];
    if (!isInstantValue(value)) {
      errors.push(`${at}.${key}: 必须是 ISO-8601 时间字符串`);
      ok = false;
      return '' as Instant;
    }
    return value as Instant;
  };

  const nullableId = (key: string): ListId | null => {
    const value = raw[key];
    if (value === null) return null;
    if (typeof value !== 'string' || value.length === 0) {
      errors.push(`${at}.${key}: 必须是非空字符串或 null`);
      ok = false;
      return null;
    }
    return value as ListId;
  };

  let allDay = false;
  const rawAllDay = raw['allDay'];
  if (typeof rawAllDay !== 'boolean') {
    errors.push(`${at}.allDay: 必须是布尔值`);
    ok = false;
  } else {
    allDay = rawAllDay;
  }

  const event: CalendarEvent = {
    id: text('id', false) as EventId,
    listId: nullableId('listId'),
    title: text('title', false),
    notes: text('notes'),
    startAt: instant('startAt'),
    endAt: instant('endAt'),
    allDay,
    createdAt: instant('createdAt'),
    updatedAt: instant('updatedAt'),
  };

  return ok ? event : null;
}

function parseCollection<T>(
  value: unknown,
  name: string,
  validate: (raw: unknown, at: string, errors: string[]) => T | null,
  errors: string[],
): T[] {
  if (!Array.isArray(value)) {
    errors.push(`${name}: 必须是数组`);
    return [];
  }
  const out: T[] = [];
  value.forEach((item, index) => {
    const parsed = validate(item, `${name}[${index}]`, errors);
    if (parsed !== null) out.push(parsed);
  });
  return out;
}

/**
 * Parse and validate a backup. Never throws: malformed JSON, a wrong envelope
 * and every invalid record are reported together in `errors`.
 */
export function parseImport(json: string): ImportResult {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, errors: [`JSON 解析失败：${message}`] };
  }

  try {
    if (!isRecord(raw)) {
      return { ok: false, errors: ['根节点必须是对象'] };
    }

    const errors: string[] = [];

    if (raw['format'] !== BACKUP_FORMAT) {
      errors.push(`format: 必须是 "${BACKUP_FORMAT}"`);
    }

    const version = raw['version'];
    if (typeof version !== 'number' || !Number.isInteger(version)) {
      errors.push('version: 必须是整数');
    } else if (version > BACKUP_VERSION) {
      errors.push(
        `version: 不支持的备份版本 ${version}（当前支持 ${BACKUP_VERSION}），请升级应用后再导入`,
      );
    } else if (version < 1) {
      errors.push(`version: 无效的备份版本 ${version}`);
    }

    if (!isInstantValue(raw['exportedAt'])) {
      errors.push('exportedAt: 必须是 ISO-8601 时间字符串');
    }

    let tasks: Task[] = [];
    let lists: TaskList[] = [];
    let events: CalendarEvent[] = [];

    const data = raw['data'];
    if (!isRecord(data)) {
      errors.push('data: 必须是包含 tasks/lists/events 的对象');
    } else {
      tasks = parseCollection(data['tasks'], 'tasks', validateTask, errors);
      lists = parseCollection(data['lists'], 'lists', validateList, errors);
      events = parseCollection(data['events'], 'events', validateEvent, errors);
    }

    if (errors.length > 0) return { ok: false, errors };

    return { ok: true, data: { tasks, lists, events } };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, errors: [`导入失败：${message}`] };
  }
}

// ---------------------------------------------------------------------------
// Merge planning
// ---------------------------------------------------------------------------

export type MergeMode = 'replace' | 'merge';
export type MergeAction = 'add' | 'update' | 'skip' | 'remove';

export interface MergeCounts {
  readonly added: number;
  readonly updated: number;
  readonly skipped: number;
  readonly removed: number;
}

/** Per-entity decision, keyed by record id, plus the id lists behind it. */
export interface EntityMergePlan {
  /** `id → action` for every id the plan mentions. */
  readonly byId: Readonly<Record<string, MergeAction>>;
  readonly add: readonly string[];
  readonly update: readonly string[];
  readonly skip: readonly string[];
  readonly remove: readonly string[];
}

export interface MergePlan {
  readonly mode: MergeMode;
  readonly counts: MergeCounts;
  readonly tasks: EntityMergePlan;
  readonly lists: EntityMergePlan;
  readonly events: EntityMergePlan;
}

interface IdentifiedRecord {
  readonly id: string;
  readonly updatedAt: Instant;
}

function planEntity(
  existing: readonly IdentifiedRecord[],
  incoming: readonly IdentifiedRecord[],
  mode: MergeMode,
): EntityMergePlan {
  const existingById = new Map<string, IdentifiedRecord>();
  for (const record of existing) existingById.set(record.id, record);
  const incomingIds = new Set<string>();
  for (const record of incoming) incomingIds.add(record.id);

  const byId: Record<string, MergeAction> = {};
  const add: string[] = [];
  const update: string[] = [];
  const skip: string[] = [];
  const remove: string[] = [];

  for (const record of incoming) {
    const current = existingById.get(record.id);
    if (mode === 'replace') {
      // The existing dataset is dropped wholesale; every incoming row is new.
      byId[record.id] = 'add';
      add.push(record.id);
      continue;
    }
    if (!current) {
      byId[record.id] = 'add';
      add.push(record.id);
      continue;
    }
    if (Date.parse(record.updatedAt) > Date.parse(current.updatedAt)) {
      byId[record.id] = 'update';
      update.push(record.id);
    } else {
      byId[record.id] = 'skip';
      skip.push(record.id);
    }
  }

  if (mode === 'replace') {
    for (const record of existing) {
      if (incomingIds.has(record.id)) continue;
      byId[record.id] = 'remove';
      remove.push(record.id);
    }
  }

  return { byId, add, update, skip, remove };
}

/**
 * Describe what an import would do without touching anything.
 *
 * - `replace`: existing rows are dropped, every incoming row is added, and
 *   existing rows absent from the payload are removed.
 * - `merge`: absent ids are added; colliding ids are updated only when the
 *   incoming `updatedAt` is newer, otherwise they are skipped.
 */
export function planMerge(existing: BackupData, incoming: BackupData, mode: MergeMode): MergePlan {
  const tasks = planEntity(existing.tasks, incoming.tasks, mode);
  const lists = planEntity(existing.lists, incoming.lists, mode);
  const events = planEntity(existing.events, incoming.events, mode);

  const counts: MergeCounts = {
    added: tasks.add.length + lists.add.length + events.add.length,
    updated: tasks.update.length + lists.update.length + events.update.length,
    skipped: tasks.skip.length + lists.skip.length + events.skip.length,
    removed: tasks.remove.length + lists.remove.length + events.remove.length,
  };

  return { mode, counts, tasks, lists, events };
}
