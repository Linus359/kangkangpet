'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  applyReminderBulkAction,
  isValidDate,
  isValidTime,
  mergeImportedReminders,
  nextNotificationAt,
  nextTriggerAt,
  normalizeReminder,
  normalizeReminders,
  validateReminder
} = require('../src/main/reminders');
const { ReminderScheduler } = require('../src/main/reminder-scheduler');
const { migrateLegacyPayload } = require('../src/main/migration');
const { ConfigStore } = require('../src/main/config-store');
const { parseReminderBackup, parseReminderCsv, parseReminderText, parseReminderXlsx, serializeReminderBackup } = require('../src/main/reminder-backup');
const ExcelJS = require('exceljs');
const fs = require('fs');
const path = require('path');

function at(value) {
  return new Date(value);
}

function localAt(year, month, day, hours = 0, minutes = 0) {
  return new Date(year, month - 1, day, hours, minutes, 0, 0);
}

function reminder(overrides = {}) {
  return normalizeReminder({
    id: 'test-reminder',
    title: '测试提醒',
    repeat: 'daily',
    time: '09:00',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides
  }, 0, at('2026-01-01T00:00:00.000Z'));
}

test('validates times and calendar dates including leap years', () => {
  assert.equal(isValidTime('23:59'), true);
  assert.equal(isValidTime('24:00'), false);
  assert.equal(isValidDate('2028-02-29'), true);
  assert.equal(isValidDate('2027-02-29'), false);
  assert.equal(isValidDate('2026-13-01'), false);
});

test('calculates daily reminders across a day boundary', () => {
  const result = nextTriggerAt(reminder({ time: '09:00' }), at('2026-01-02T10:30:00'));
  assert.equal(result.getFullYear(), 2026);
  assert.equal(result.getMonth(), 0);
  assert.equal(result.getDate(), 3);
  assert.equal(result.getHours(), 9);
});

test('calculates weekly and custom weekday reminders across a week boundary', () => {
  const now = at('2026-01-04T10:00:00'); // Sunday
  const weekly = nextTriggerAt(reminder({ repeat: 'weekly', weekdays: [0], time: '08:30' }), now);
  const custom = nextTriggerAt(reminder({ repeat: 'custom', weekdays: [2, 4], time: '08:30' }), now);
  assert.equal(weekly.getDay(), 1);
  assert.equal(custom.getDay(), 3);
});

test('calculates interval reminders from the anchor and last trigger', () => {
  const current = at('2026-01-01T10:13:00.000Z');
  const result = nextTriggerAt(reminder({
    repeat: 'interval',
    intervalMinutes: 15,
    intervalAnchorAt: '2026-01-01T10:00:00.000Z'
  }), current);
  assert.equal(result.toISOString(), '2026-01-01T10:15:00.000Z');
  const afterTrigger = nextTriggerAt(reminder({
    repeat: 'interval',
    intervalMinutes: 15,
    lastTriggeredAt: '2026-01-01T10:15:00.000Z'
  }), at('2026-01-01T10:15:01.000Z'));
  assert.equal(afterTrigger.toISOString(), '2026-01-01T10:30:00.000Z');
});

test('calculates one-time reminders and rejects new expired one-time values', () => {
  const future = nextTriggerAt(reminder({ repeat: 'once', date: '2026-12-31', time: '23:59' }), localAt(2026, 12, 31, 23, 58));
  assert.deepEqual([future.getFullYear(), future.getMonth(), future.getDate(), future.getHours(), future.getMinutes()], [2026, 11, 31, 23, 59]);
  const past = nextTriggerAt(reminder({ repeat: 'once', date: '2026-01-01', time: '09:00' }), localAt(2026, 1, 1, 10));
  assert.equal(past, null);
  assert.equal(validateReminder({ title: '过去的提醒', repeat: 'once', date: '2026-01-01', time: '09:00' }, localAt(2026, 1, 1, 10)).valid, false);
});

test('rejects invalid form values', () => {
  assert.equal(validateReminder({ title: 'x', repeat: 'daily', time: '25:00' }).valid, false);
  assert.equal(validateReminder({ title: 'x', repeat: 'once', date: '2026-02-30', time: '09:00' }).valid, false);
  assert.equal(validateReminder({ title: 'x', repeat: 'custom', time: '09:00', weekdays: [] }).valid, false);
  assert.equal(validateReminder({ title: 'x', repeat: 'interval', intervalMinutes: 0 }).valid, false);
});

test('normalizes legacy Python reminder fields and versions', () => {
  const [migrated] = migrateLegacyPayload({ reminders: [{
    title: '喝水提醒', note: '起来喝水', time_text: '09:00', repeat: '每隔 N 分钟',
    interval_minutes: 30, notify_mode: '气泡', repeat_days: [0, 1]
  }] }, at('2026-01-01T08:00:00'));
  assert.equal(migrated.repeat, 'interval');
  assert.equal(migrated.notificationMode, 'bubble');
  assert.equal(migrated.intervalMinutes, 30);
});

test('preserves reminder source metadata in normalized backups', () => {
  const sourced = reminder({ source: { type: 'audio', name: '会议录音.m4a', path: 'C:/media/meeting.m4a' } });
  assert.deepEqual(sourced.source, { type: 'audio', name: '会议录音.m4a', path: 'C:/media/meeting.m4a', text: '' });
  const payload = JSON.parse(serializeReminderBackup([sourced], '2026-01-01T00:00:00.000Z'));
  assert.equal(payload.reminderFeatureVersion, 4);
  assert.equal(payload.reminders[0].source.type, 'audio');
});

test('imports JSON data without duplicate fingerprints and preserves sort order', () => {
  const first = reminder({ id: 'existing', title: '站会', message: '会议', time: '09:30' });
  const result = mergeImportedReminders([first], [
    { id: 'other', title: '站会', message: '会议', repeat: 'daily', time: '09:30' },
    { id: 'new', title: '复盘', repeat: 'weekly', weekdays: [4], time: '17:00' }
  ], at('2026-01-01T08:00:00'));
  assert.equal(result.imported, 1);
  assert.equal(result.reminders.length, 2);
  assert.deepEqual(result.reminders.map((item) => item.sortOrder), [0, 1]);
});

test('updates only selected reminders in a bulk action and preserves scheduling state', () => {
  const now = localAt(2026, 1, 1, 8);
  const source = normalizeReminders([
    reminder({ id: 'enable', enabled: false, time: '09:00' }),
    reminder({ id: 'disable', enabled: true, time: '10:00' }),
    reminder({ id: 'keep', enabled: true, time: '11:00' })
  ], now);
  const enabled = applyReminderBulkAction(source, ['enable'], 'enable', now);
  assert.equal(enabled.affected, 1);
  assert.equal(enabled.reminders.find((item) => item.id === 'enable').enabled, true);
  assert.equal(enabled.reminders.find((item) => item.id === 'enable').nextTriggerAt, localAt(2026, 1, 1, 9).toISOString());
  const disabled = applyReminderBulkAction(enabled.reminders, ['disable'], 'disable', now);
  assert.equal(disabled.affected, 1);
  assert.equal(disabled.reminders.find((item) => item.id === 'disable').nextTriggerAt, null);
  assert.equal(disabled.reminders.find((item) => item.id === 'keep').enabled, true);
});

test('deletes selected reminders and ignores invalid bulk requests', () => {
  const source = normalizeReminders([
    reminder({ id: 'first', sortOrder: 1 }),
    reminder({ id: 'second', sortOrder: 0 })
  ], localAt(2026, 1, 1, 8));
  const deleted = applyReminderBulkAction(source, ['first'], 'delete');
  assert.equal(deleted.affected, 1);
  assert.deepEqual(deleted.reminders.map((item) => item.id), ['second']);
  assert.deepEqual(deleted.reminders.map((item) => item.sortOrder), [0]);
  assert.equal(applyReminderBulkAction(source, [], 'enable').affected, 0);
  assert.equal(applyReminderBulkAction(source, ['first'], 'unknown').affected, 0);
});

test('round-trips JSON reminder backups', () => {
  const source = [reminder({ id: 'backup', title: '备份测试' })];
  const parsed = parseReminderBackup(serializeReminderBackup(source, '2026-01-01T00:00:00.000Z'));
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].id, 'backup');
  assert.throws(() => parseReminderBackup('{"wrong":true}'), /reminders/);
});

test('parses Chinese CSV reminder headers, quoted content, and common value formats', () => {
  const parsed = parseReminderCsv('\uFEFF标题,内容,重复规则,时间,星期,通知方式,启用\r\n喝水,"起身, 活动一下",每天,9:05,周一|周三,气泡,是\r\n复盘,"第一行\n第二行",自定义星期,18:30,"周二、周四",系统通知,否');
  assert.deepEqual(parsed, [
    { title: '喝水', message: '起身, 活动一下', repeat: '每天', time: '09:05', date: '', weekdays: [0, 2], intervalMinutes: '', notificationMode: '气泡', enabled: true },
    { title: '复盘', message: '第一行\n第二行', repeat: '自定义星期', time: '18:30', date: '', weekdays: [1, 3], intervalMinutes: '', notificationMode: '系统通知', enabled: false }
  ]);
});

test('ignores the built-in template example row and accepts Chinese template values', () => {
  const parsed = parseReminderCsv('\uFEFF标题,内容（可选）,重复规则,时间,日期,星期,间隔分钟,通知方式,是否启用\r\n示例提醒（导入时自动忽略）,请参考这一行的格式填写自己的提醒,指定日期,09:00,2026-12-31,,,气泡和系统通知,启用\r\n真正的提醒,正文,每天,08:30,,,,仅桌宠气泡,启用');
  assert.deepEqual(parsed, [{
    title: '真正的提醒', message: '正文', repeat: '每天', time: '08:30', date: '', weekdays: [], intervalMinutes: '', notificationMode: '仅桌宠气泡', enabled: true
  }]);
});

test('parses English CSV reminder headers and normalizes dates, times, and weekdays', () => {
  const parsed = parseReminderCsv('title,repeat,time,date,weekdays,intervalMinutes,notificationMode,enabled\n年度复盘,once,8:30:00,2026/12/31,, ,both,1\n拉伸,custom,17:00,,1|3|5,,bubble,true');
  assert.deepEqual(parsed, [
    { title: '年度复盘', message: '', repeat: 'once', time: '08:30', date: '2026-12-31', weekdays: [], intervalMinutes: '', notificationMode: 'both', enabled: true },
    { title: '拉伸', message: '', repeat: 'custom', time: '17:00', date: '', weekdays: [0, 2, 4], intervalMinutes: '', notificationMode: 'bubble', enabled: true }
  ]);
});

test('parses conversational Chinese reminders and keeps ambiguous lines as drafts', () => {
  const parsed = parseReminderText([
    '明天下午3点提醒我提交周报',
    '每周一 09:30 站会',
    '记得买牛奶'
  ].join('\n'), at('2026-08-27T10:00:00'));
  assert.equal(parsed.reminders.length, 2);
  assert.deepEqual(parsed.reminders[0], {
    title: '提交周报', message: '明天下午3点提醒我提交周报', repeat: 'once', time: '15:00', date: '2026-08-28',
    weekdays: [], notificationMode: 'both', enabled: true, createdAt: at('2026-08-27T10:00:00').toISOString()
  });
  assert.equal(parsed.reminders[1].repeat, 'weekly');
  assert.deepEqual(parsed.reminders[1].weekdays, [0]);
  assert.equal(parsed.drafts.length, 1);
  assert.equal(parsed.drafts[0].title, '买牛奶');
});

test('rejects CSV files without a title column or with unclosed quotes', () => {
  assert.throws(() => parseReminderCsv('内容,时间\n喝水,09:00'), /标题/);
  assert.throws(() => parseReminderCsv('标题,内容\n喝水,"未结束'), /引号/);
});

test('parses XLSX reminder rows through the same import mapping as CSV', async () => {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('提醒');
  worksheet.addRow(['标题', '内容', '重复规则', '时间', '星期', '通知方式', '启用']);
  worksheet.addRow(['喝水', '起身活动', '自定义', 0.375, '周一|周五', 'both', '是']);
  worksheet.getCell('D2').numFmt = 'hh:mm';
  const parsed = await parseReminderXlsx(await workbook.xlsx.writeBuffer());
  assert.deepEqual(parsed, [{
    title: '喝水', message: '起身活动', repeat: '自定义', time: '09:00', date: '', weekdays: [0, 4], intervalMinutes: '', notificationMode: 'both', enabled: true
  }]);
});

test('backs up a corrupt config and returns normalized defaults', () => {
  const directory = path.join(__dirname, `.config-store-test-${process.pid}`);
  const configPath = path.join(directory, 'config.json');
  fs.mkdirSync(directory, { recursive: true });
  try {
    const messages = [];
    const store = new ConfigStore(configPath, { log: (message) => messages.push(message), normalize: (value) => ({ ...value, normalized: true }) });
    store.save({ value: 1 });
    assert.deepEqual(store.load({ value: 0 }), { value: 1, normalized: true });
    fs.writeFileSync(configPath, '{bad json', 'utf8');
    assert.deepEqual(store.load({ value: 0 }), { value: 0, normalized: true });
    assert.equal(fs.readdirSync(directory).some((name) => name.includes('.corrupt-')), true);
    assert.equal(messages.length > 0, true);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('scheduler triggers simultaneous reminders once and disables a one-time reminder', async () => {
  let current = localAt(2026, 1, 1, 9);
  const records = normalizeReminders([
    reminder({ id: 'daily', repeat: 'daily', time: '09:00' }),
    reminder({ id: 'once', repeat: 'once', date: '2026-01-01', time: '09:00' })
  ], localAt(2026, 1, 1, 8, 59));
  const notified = [];
  const scheduler = new ReminderScheduler({
    getReminders: () => records,
    saveReminders: () => {},
    notify: async (item) => notified.push(item.id),
    now: () => current,
    graceMs: 5 * 60 * 1000
  });
  scheduler.running = true;
  await scheduler.runDueCheck();
  scheduler.stop();
  assert.deepEqual(notified.sort(), ['daily', 'once']);
  assert.equal(records.find((item) => item.id === 'once').enabled, false);
  scheduler.running = true;
  await scheduler.runDueCheck();
  scheduler.stop();
  assert.equal(notified.length, 2);
});

test('normalizes empty next trigger values as unscheduled reminders', () => {
  const [record] = normalizeReminders([reminder({ nextTriggerAt: null })], localAt(2026, 1, 1, 8, 59));
  assert.equal(record.nextTriggerAt, localAt(2026, 1, 1, 9).toISOString());
});

test('scheduler skips stale missed reminders outside the grace period after resume', async () => {
  const records = [reminder({
    id: 'stale', repeat: 'daily', time: '09:00', nextTriggerAt: localAt(2026, 1, 1, 9).toISOString()
  })];
  const notified = [];
  const scheduler = new ReminderScheduler({
    getReminders: () => records,
    saveReminders: () => {},
    notify: async (item) => notified.push(item.id),
    now: () => localAt(2026, 1, 1, 9, 10),
    graceMs: 5 * 60 * 1000
  });
  scheduler.running = true;
  await scheduler.runDueCheck();
  scheduler.stop();
  assert.deepEqual(notified, []);
  const next = new Date(records[0].nextTriggerAt);
  assert.deepEqual([next.getFullYear(), next.getMonth(), next.getDate(), next.getHours(), next.getMinutes()], [2026, 0, 2, 9, 0]);
});

test('scheduler retains a one-time reminder within the resume grace window and triggers it once', async () => {
  const now = localAt(2026, 1, 1, 9, 3);
  const records = normalizeReminders([reminder({
    id: 'grace-once', repeat: 'once', date: '2026-01-01', time: '09:00', nextTriggerAt: localAt(2026, 1, 1, 9).toISOString()
  })], now);
  const notified = [];
  const scheduler = new ReminderScheduler({
    getReminders: () => records,
    saveReminders: () => {},
    notify: async (item) => notified.push(item.id),
    now: () => now,
    graceMs: 5 * 60 * 1000
  });
  scheduler.running = true;
  await scheduler.runDueCheck();
  scheduler.stop();
  assert.deepEqual(notified, ['grace-once']);
  assert.equal(records[0].enabled, false);
});

test('normalizes strong reminders for persistent acknowledgement', () => {
  const normalized = normalizeReminder({ title: '确认事项', repeat: 'daily', time: '09:00', strongReminder: true }, 0, at('2026-01-01T08:00:00'));
  assert.equal(normalized.strongReminder, true);
  const legacy = normalizeReminder({ title: '旧字段', repeat: 'daily', time: '09:00', persistent: true }, 0, at('2026-01-01T08:00:00'));
  assert.equal(legacy.strongReminder, true);
});

test('keeps the scheduled occurrence while calculating an early notification', () => {
  const scheduled = localAt(2026, 1, 1, 9, 0).toISOString();
  const early = reminder({ nextTriggerAt: scheduled, reminderOffsetMinutes: 5 });
  assert.equal(early.reminderOffsetMinutes, 5);
  assert.equal(nextNotificationAt(early).toISOString(), localAt(2026, 1, 1, 8, 55).toISOString());
  assert.equal(reminder({ reminderOffsetMinutes: 7 }).reminderOffsetMinutes, 0);
});

test('scheduler sends an early reminder once and retains the real scheduled time', async () => {
  let current = localAt(2026, 1, 1, 8, 55);
  const records = normalizeReminders([
    reminder({ id: 'early', time: '09:00', reminderOffsetMinutes: 5 })
  ], localAt(2026, 1, 1, 8, 50));
  const notified = [];
  const scheduler = new ReminderScheduler({
    getReminders: () => records,
    saveReminders: () => {},
    notify: async (item) => notified.push(item),
    now: () => current
  });
  scheduler.running = true;
  await scheduler.runDueCheck();
  scheduler.stop();
  assert.equal(notified.length, 1);
  assert.equal(notified[0].scheduledAt, localAt(2026, 1, 1, 9).toISOString());
  current = localAt(2026, 1, 1, 9, 0);
  scheduler.running = true;
  await scheduler.runDueCheck();
  scheduler.stop();
  assert.equal(notified.length, 1);
});
