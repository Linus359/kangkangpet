'use strict';

const crypto = require('crypto');

const VALID_REPEATS = new Set(['daily', 'weekly', 'custom', 'interval', 'once']);
const VALID_NOTIFICATION_MODES = new Set(['bubble', 'system', 'both']);
const MAX_INTERVAL_MINUTES = 525600;
const WEEKDAY_NAMES = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

const legacyRepeatMap = new Map([
  ['每天', 'daily'],
  ['每日', 'daily'],
  ['每周', 'weekly'],
  ['自定义', 'custom'],
  ['每隔 N 分钟', 'interval'],
  ['每隔N分钟', 'interval'],
  ['自定义星期', 'custom'],
  ['指定日期', 'once']
]);

function asString(value, fallback = '') {
  return typeof value === 'string' ? value.trim() : fallback;
}

function isValidTime(value) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(asString(value));
}

function isValidDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(asString(value));
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

function parseLocalDateTime(dateValue, timeValue) {
  if (!isValidDate(dateValue) || !isValidTime(timeValue)) return null;
  const [year, month, day] = dateValue.split('-').map(Number);
  const [hours, minutes] = timeValue.split(':').map(Number);
  return new Date(year, month - 1, day, hours, minutes, 0, 0);
}

function parseIso(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function localDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function localWeekday(date) {
  return (date.getDay() + 6) % 7;
}

function normalizeWeekdays(value) {
  const source = Array.isArray(value) ? value : [];
  return [...new Set(source.map(Number).filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))]
    .sort((left, right) => left - right);
}

function normalizedRepeat(value) {
  const raw = asString(value, 'daily');
  return VALID_REPEATS.has(raw) ? raw : legacyRepeatMap.get(raw) || 'daily';
}

function normalizedNotificationMode(value) {
  const raw = asString(value, 'both');
  if (VALID_NOTIFICATION_MODES.has(raw)) return raw;
  if (raw === '气泡' || raw === '仅桌宠气泡') return 'bubble';
  if (raw === '弹窗' || raw === '系统通知' || raw === '仅系统通知') return 'system';
  if (raw === '气泡和系统通知') return 'both';
  return 'both';
}

function validInterval(value) {
  const interval = Number(value);
  return Number.isInteger(interval) && interval >= 1 && interval <= MAX_INTERVAL_MINUTES;
}

function normalizeSource(value) {
  if (!value || typeof value !== 'object') return null;
  const type = asString(value.type || value.sourceType).toLowerCase();
  if (!['image', 'audio', 'video', 'text'].includes(type)) return null;
  return {
    type,
    name: asString(value.name || value.sourceName).slice(0, 240),
    path: asString(value.path).slice(0, 2000),
    text: asString(value.text).slice(0, 4000)
  };
}

function normalizeReminder(input = {}, index = 0, now = new Date()) {
  const createdAt = parseIso(input.createdAt)?.toISOString() || now.toISOString();
  const repeat = normalizedRepeat(input.repeat);
  const title = asString(input.title || input.text, `提醒 ${index + 1}`).slice(0, 120) || `提醒 ${index + 1}`;
  const sourceWeekdays = input.weekdays ?? input.repeat_days;
  let weekdays = normalizeWeekdays(sourceWeekdays);
  if (repeat === 'weekly' && !weekdays.length) weekdays = [localWeekday(now)];
  const targetDate = asString(input.date || input.target_date);
  const normalized = {
    id: asString(input.id) || crypto.randomUUID(),
    title,
    message: asString(input.message || input.note).slice(0, 1000),
    enabled: input.enabled !== false,
    sortOrder: Number.isFinite(Number(input.sortOrder)) ? Number(input.sortOrder) : index,
    repeat,
    time: asString(input.time || input.time_text),
    date: targetDate,
    weekdays,
    intervalMinutes: validInterval(input.intervalMinutes ?? input.interval_minutes)
      ? Number(input.intervalMinutes ?? input.interval_minutes)
      : null,
    notificationMode: normalizedNotificationMode(input.notificationMode || input.notify_mode),
    source: normalizeSource(input.source || (input.sourceType ? input : null)),
    createdAt,
    updatedAt: parseIso(input.updatedAt)?.toISOString() || createdAt,
    lastTriggeredAt: parseIso(input.lastTriggeredAt || input.last_triggered)?.toISOString() || null,
    nextTriggerAt: parseIso(input.nextTriggerAt)?.toISOString() || null,
    intervalAnchorAt: parseIso(input.intervalAnchorAt)?.toISOString() || createdAt
  };

  if (repeat === 'interval' && !normalized.intervalMinutes) normalized.enabled = false;
  if (repeat === 'once' && (!isValidDate(normalized.date) || !isValidTime(normalized.time))) normalized.enabled = false;
  if (['daily', 'weekly', 'custom'].includes(repeat) && !isValidTime(normalized.time)) normalized.enabled = false;
  if (repeat === 'custom' && !normalized.weekdays.length) normalized.enabled = false;
  return normalized;
}

function validateReminder(input, now = new Date()) {
  const reminder = normalizeReminder(input, 0, now);
  const errors = [];
  if (!asString(input.title || input.text)) errors.push('请输入提醒标题。');
  if (['daily', 'weekly', 'custom', 'once'].includes(reminder.repeat) && !isValidTime(reminder.time)) {
    errors.push('时间格式应为 HH:MM。');
  }
  if (reminder.repeat === 'once' && !isValidDate(reminder.date)) errors.push('请选择有效日期。');
  if (reminder.repeat === 'once') {
    const scheduled = parseLocalDateTime(reminder.date, reminder.time);
    if (scheduled && scheduled.getTime() < now.getTime()) errors.push('指定日期已经过去。');
  }
  if (reminder.repeat === 'custom' && !reminder.weekdays.length) errors.push('请至少选择一个星期。');
  if (reminder.repeat === 'interval' && !validInterval(reminder.intervalMinutes)) {
    errors.push(`间隔分钟必须是 1 到 ${MAX_INTERVAL_MINUTES} 之间的整数。`);
  }
  return { valid: errors.length === 0, errors, reminder };
}

function nextTriggerAt(reminder, now = new Date()) {
  if (!reminder?.enabled) return null;
  const current = new Date(now.getTime());
  current.setSeconds(0, 0);

  if (reminder.repeat === 'once') {
    const candidate = parseLocalDateTime(reminder.date, reminder.time);
    return candidate && candidate.getTime() >= current.getTime() ? candidate : null;
  }

  if (reminder.repeat === 'interval') {
    if (!validInterval(reminder.intervalMinutes)) return null;
    const anchor = parseIso(reminder.lastTriggeredAt) || parseIso(reminder.intervalAnchorAt) || parseIso(reminder.createdAt) || current;
    const intervalMs = reminder.intervalMinutes * 60 * 1000;
    const elapsed = current.getTime() - anchor.getTime();
    const steps = elapsed <= 0 ? 1 : Math.ceil(elapsed / intervalMs);
    return new Date(anchor.getTime() + Math.max(1, steps) * intervalMs);
  }

  if (!isValidTime(reminder.time)) return null;
  const [hours, minutes] = reminder.time.split(':').map(Number);
  const weekdays = reminder.repeat === 'daily'
    ? [0, 1, 2, 3, 4, 5, 6]
    : normalizeWeekdays(reminder.weekdays);
  if (!weekdays.length) return null;

  for (let offset = 0; offset <= 8; offset += 1) {
    const candidate = new Date(current.getFullYear(), current.getMonth(), current.getDate() + offset, hours, minutes, 0, 0);
    if (weekdays.includes(localWeekday(candidate)) && candidate.getTime() >= current.getTime()) return candidate;
  }
  return null;
}

function setNextTrigger(reminder, now = new Date(), force = false) {
  const current = { ...reminder };
  if (!current.enabled) return { ...current, nextTriggerAt: null };
  const existing = parseIso(current.nextTriggerAt);
  if (!force && existing) return current;
  const next = nextTriggerAt(current, now);
  return { ...current, nextTriggerAt: next?.toISOString() || null };
}

function sortReminders(reminders) {
  return (Array.isArray(reminders) ? reminders : [])
    .slice()
    .sort((left, right) => Number(left.sortOrder) - Number(right.sortOrder))
    .map((reminder, index) => ({ ...reminder, sortOrder: index }));
}

function normalizeReminders(reminders, now = new Date()) {
  const seen = new Set();
  return sortReminders((Array.isArray(reminders) ? reminders : []).map((item, index) => {
    const normalized = normalizeReminder(item, index, now);
    if (seen.has(normalized.id)) normalized.id = crypto.randomUUID();
    seen.add(normalized.id);
    return normalized;
  })).map((item) => setNextTrigger(item, now));
}

function formatReminderSchedule(reminder) {
  switch (reminder.repeat) {
    case 'weekly':
    case 'custom': {
      const days = normalizeWeekdays(reminder.weekdays).map((day) => WEEKDAY_NAMES[day]).join('、');
      return `${reminder.repeat === 'weekly' ? '每周' : '自定义'} ${days} ${reminder.time}`.trim();
    }
    case 'interval':
      return `每隔 ${reminder.intervalMinutes} 分钟`;
    case 'once':
      return `${reminder.date} ${reminder.time}`.trim();
    default:
      return `每天 ${reminder.time}`.trim();
  }
}

function reminderFingerprint(reminder) {
  return [reminder.title, reminder.message, reminder.repeat, reminder.time, reminder.date, reminder.intervalMinutes, reminder.weekdays.join(',')].join('|');
}

function mergeImportedReminders(existing, incoming, now = new Date()) {
  const current = normalizeReminders(existing, now);
  const fingerprints = new Set(current.map(reminderFingerprint));
  const ids = new Set(current.map((item) => item.id));
  const accepted = [];
  const errors = [];
  for (const [index, item] of (Array.isArray(incoming) ? incoming : []).entries()) {
    const result = validateReminder(item, now);
    if (!result.valid) {
      errors.push({ index, errors: result.errors });
      continue;
    }
    const reminder = result.reminder;
    const fingerprint = reminderFingerprint(reminder);
    if (ids.has(reminder.id) || fingerprints.has(fingerprint)) continue;
    reminder.sortOrder = current.length + accepted.length;
    accepted.push(setNextTrigger(reminder, now, true));
    ids.add(reminder.id);
    fingerprints.add(fingerprint);
  }
  return { reminders: sortReminders([...current, ...accepted]), imported: accepted.length, errors };
}

function applyReminderBulkAction(reminders, reminderIds, action, now = new Date()) {
  const current = sortReminders(reminders);
  const ids = new Set((Array.isArray(reminderIds) ? reminderIds : [])
    .filter((id) => typeof id === 'string' && id.trim())
    .map((id) => id.trim()));
  if (!ids.size || !['enable', 'disable', 'delete'].includes(action)) {
    return { reminders: current, affected: 0 };
  }

  if (action === 'delete') {
    const next = current.filter((reminder) => !ids.has(reminder.id));
    return { reminders: sortReminders(next), affected: current.length - next.length };
  }

  const enabled = action === 'enable';
  const updatedAt = now.toISOString();
  let affected = 0;
  const next = current.map((reminder) => {
    if (!ids.has(reminder.id) || reminder.enabled === enabled) return reminder;
    const updated = setNextTrigger({ ...reminder, enabled, updatedAt, nextTriggerAt: null }, now, true);
    if (enabled && !updated.nextTriggerAt) return reminder;
    affected += 1;
    return updated;
  });
  return { reminders: sortReminders(next), affected };
}

module.exports = {
  MAX_INTERVAL_MINUTES,
  WEEKDAY_NAMES,
  applyReminderBulkAction,
  formatReminderSchedule,
  isValidDate,
  isValidTime,
  mergeImportedReminders,
  nextTriggerAt,
  normalizeReminder,
  normalizeSource,
  normalizeReminders,
  setNextTrigger,
  sortReminders,
  validateReminder
};
