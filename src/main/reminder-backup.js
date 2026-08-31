'use strict';

const ExcelJS = require('exceljs');

function parseReminderBackup(text) {
  const payload = JSON.parse(text);
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === 'object' && Array.isArray(payload.reminders)) return payload.reminders;
  throw new Error('备份文件不包含 reminders 数组。');
}

const CSV_FIELDS = {
  title: ['title', '标题', '提醒标题', '名称', '任务'],
  message: ['message', '内容', '内容（可选）', '提醒内容', '备注', 'note', '描述'],
  repeat: ['repeat', '重复', '重复规则', '频率'],
  time: ['time', '时间', '提醒时间'],
  date: ['date', '日期', '提醒日期'],
  weekdays: ['weekdays', '星期', '星期几', '重复日', '重复星期'],
  intervalMinutes: ['intervalminutes', 'interval_minutes', '间隔分钟', '间隔', '分钟'],
  notificationMode: ['notificationmode', 'notification_mode', '通知方式', '通知', '提醒方式'],
  enabled: ['enabled', '启用', '是否启用']
};

const WEEKDAY_VALUES = new Map([
  ['周一', 0], ['星期一', 0], ['monday', 0], ['mon', 0],
  ['周二', 1], ['星期二', 1], ['tuesday', 1], ['tue', 1],
  ['周三', 2], ['星期三', 2], ['wednesday', 2], ['wed', 2],
  ['周四', 3], ['星期四', 3], ['thursday', 3], ['thu', 3],
  ['周五', 4], ['星期五', 4], ['friday', 4], ['fri', 4],
  ['周六', 5], ['星期六', 5], ['saturday', 5], ['sat', 5],
  ['周日', 6], ['周天', 6], ['星期日', 6], ['星期天', 6], ['sunday', 6], ['sun', 6]
]);

function normalizeHeader(value) {
  return String(value || '').replace(/^\uFEFF/, '').trim().toLowerCase().replace(/[\s_-]/g, '');
}

function parseCsvRows(text) {
  const rows = [];
  let row = [];
  let value = '';
  let quoted = false;
  const source = String(text || '').replace(/^\uFEFF/, '');

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quoted) {
      if (character === '"' && source[index + 1] === '"') {
        value += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        value += character;
      }
      continue;
    }

    if (character === '"') {
      if (value) throw new Error('CSV 引号格式不正确。');
      quoted = true;
    } else if (character === ',') {
      row.push(value.trim());
      value = '';
    } else if (character === '\n' || character === '\r') {
      if (character === '\r' && source[index + 1] === '\n') index += 1;
      row.push(value.trim());
      if (row.some((field) => field)) rows.push(row);
      row = [];
      value = '';
    } else {
      value += character;
    }
  }

  if (quoted) throw new Error('CSV 引号未闭合。');
  row.push(value.trim());
  if (row.some((field) => field)) rows.push(row);
  return rows;
}

function normalizeCsvTime(value) {
  const match = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(String(value || '').trim());
  return match ? `${match[1].padStart(2, '0')}:${match[2]}` : String(value || '').trim();
}

function normalizeCsvDate(value) {
  const match = /^(\d{4})[/.](\d{1,2})[/.](\d{1,2})$/.exec(String(value || '').trim());
  return match ? `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}` : String(value || '').trim();
}

function parseCsvWeekdays(value) {
  const entries = String(value || '').trim().split(/[、|;/\s]+/).filter(Boolean);
  const numeric = entries.map((entry) => Number(entry));
  const usesOneBasedNumbers = entries.length > 0 && numeric.every((entry) => Number.isInteger(entry) && entry >= 1 && entry <= 7);
  return [...new Set(entries.map((entry, index) => {
    const normalized = entry.trim().toLowerCase();
    if (WEEKDAY_VALUES.has(normalized)) return WEEKDAY_VALUES.get(normalized);
    if (Number.isInteger(numeric[index]) && numeric[index] >= 0 && numeric[index] <= 6) return usesOneBasedNumbers ? numeric[index] - 1 : numeric[index];
    return null;
  }).filter((day) => day !== null))].sort((left, right) => left - right);
}

function csvEnabled(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return undefined;
  if (['0', 'false', 'no', '否', '停用', '禁用'].includes(normalized)) return false;
  if (['1', 'true', 'yes', '是', '启用'].includes(normalized)) return true;
  return undefined;
}

function parseReminderRows(rows, format) {
  if (rows.length < 2) throw new Error(`${format} 至少需要表头和一条提醒。`);

  const headers = rows[0].map(normalizeHeader);
  const indexes = Object.fromEntries(Object.entries(CSV_FIELDS).map(([field, aliases]) => [
    field,
    headers.findIndex((header) => aliases.map(normalizeHeader).includes(header))
  ]));
  if (indexes.title < 0) throw new Error('CSV 缺少“标题”或 title 列。');

  const dataRows = rows.slice(1).filter((row) => {
    const title = String(row[indexes.title] || '').trim();
    const message = String(indexes.message >= 0 ? row[indexes.message] || '' : '').trim();
    return title && !/^(?:示例|示例提醒|填写示例|example|sample)(?:[：:]|[（(]|\s|$)/i.test(title)
      && !/填写示例|导入前删除/.test(`${title} ${message}`);
  });

  return dataRows.map((row) => {
    const value = (field) => indexes[field] >= 0 ? row[indexes[field]] || '' : '';
    const enabled = csvEnabled(value('enabled'));
    return {
      title: value('title'),
      message: value('message'),
      repeat: value('repeat'),
      time: normalizeCsvTime(value('time')),
      date: normalizeCsvDate(value('date')),
      weekdays: parseCsvWeekdays(value('weekdays')),
      intervalMinutes: value('intervalMinutes'),
      notificationMode: value('notificationMode'),
      ...(enabled === undefined ? {} : { enabled })
    };
  });
}

function parseReminderCsv(text) {
  return parseReminderRows(parseCsvRows(text), 'CSV');
}

function dateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function parseConversationDate(text, now) {
  const full = /(\d{4})\s*[年./-]\s*(\d{1,2})\s*[月./-]\s*(\d{1,2})\s*[日号]?/.exec(text);
  if (full) return `${full[1]}-${String(full[2]).padStart(2, '0')}-${String(full[3]).padStart(2, '0')}`;
  const monthDay = /(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]?/.exec(text);
  if (monthDay) return `${now.getFullYear()}-${String(monthDay[1]).padStart(2, '0')}-${String(monthDay[2]).padStart(2, '0')}`;
  const relative = /(今天|明天|后天|大后天)/.exec(text)?.[1];
  if (!relative) return '';
  const offset = { 今天: 0, 明天: 1, 后天: 2, 大后天: 3 }[relative] || 0;
  const target = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
  return dateKey(target);
}

function parseConversationTime(text) {
  const colon = /(上午|早上|中午|下午|晚上|今晚)?\s*(\d{1,2})\s*[:：]\s*(\d{2})/.exec(text);
  const chinese = /(上午|早上|中午|下午|晚上|今晚)?\s*(\d{1,2})\s*(?:点|时)(?:(半)|\s*(\d{1,2})\s*分?)?/.exec(text);
  const match = colon || chinese;
  if (!match) return '';
  const meridiem = match[1] || '';
  let hours = Number(match[2]);
  const minutes = colon ? Number(match[3]) : match[3] === '半' ? 30 : Number(match[4] || 0);
  if (meridiem === '下午' || meridiem === '晚上' || meridiem === '今晚') hours = hours < 12 ? hours + 12 : hours;
  if (meridiem === '中午' && hours < 11) hours += 12;
  if ((meridiem === '上午' || meridiem === '早上') && hours === 12) hours = 0;
  return hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59
    ? `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
    : '';
}

function conversationWeekdays(text) {
  const names = ['一', '二', '三', '四', '五', '六', '日'];
  return names.reduce((days, name, index) => {
    if (new RegExp(`(?:周|星期)${name}`).test(text)) days.push(index);
    return days;
  }, []);
}

function conversationTitle(text) {
  const cleaned = String(text || '')
    .replace(/^\s*(?:[-*•·]|\d+[.)])\s*/, '')
    .replace(/(?:今天|明天|后天|大后天|\d{4}\s*[年./-]\s*\d{1,2}\s*[月./-]\s*\d{1,2}\s*[日号]?|\d{1,2}\s*月\s*\d{1,2}\s*[日号]?)/g, '')
    .replace(/(?:上午|早上|中午|下午|晚上|今晚)?\s*\d{1,2}\s*(?::\s*\d{2}|点(?:半|\s*\d{1,2}\s*分?)?|时(?:半|\s*\d{1,2}\s*分?)?)/g, '')
    .replace(/(?:每天|每日|每周|每星期)(?:[一二三四五六日天])?/g, '')
    .replace(/(?:周|星期)[一二三四五六日天]/g, '')
    .replace(/^(?:提醒我|请提醒我|记得|别忘了|提醒|通知我)\s*/i, '')
    .replace(/[，。,:：;；\-]+/g, ' ')
    .trim();
  return (cleaned || String(text || '').trim() || '未命名提醒').slice(0, 120);
}

function parseReminderText(text, now = new Date()) {
  const reminders = [];
  const drafts = [];
  const source = String(text || '').replace(/\r/g, '');
  const chunks = source.split(/\n+/).map((item) => item.trim()).filter(Boolean);
  for (const chunk of chunks) {
    const time = parseConversationTime(chunk);
    const date = parseConversationDate(chunk, now);
    const weekdays = conversationWeekdays(chunk);
    const daily = /每天|每日|每天都/.test(chunk);
    const weekly = /每周|每星期/.test(chunk) || weekdays.length > 0;
    if (!time && !date && !daily && !weekly) {
      drafts.push({ title: conversationTitle(chunk), message: chunk, sourceType: 'text', sourceName: '对话文本', createdAt: now.toISOString() });
      continue;
    }
    const repeat = daily ? 'daily' : weekly ? (weekdays.length > 1 ? 'custom' : 'weekly') : 'once';
    let targetDate = date;
    let targetTime = time || '09:00';
    if (repeat === 'once' && !targetDate) {
      const candidate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), Number(targetTime.slice(0, 2)), Number(targetTime.slice(3)), 0, 0);
      if (candidate.getTime() <= now.getTime()) candidate.setDate(candidate.getDate() + 1);
      targetDate = dateKey(candidate);
    }
    reminders.push({
      title: conversationTitle(chunk),
      message: chunk,
      repeat,
      time: targetTime,
      date: repeat === 'once' ? targetDate : '',
      weekdays,
      notificationMode: 'both',
      enabled: true,
      createdAt: now.toISOString()
    });
  }
  return { reminders, drafts };
}

async function parseReminderXlsx(buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const worksheet = workbook.worksheets.find((sheet) => sheet.actualRowCount > 0);
  if (!worksheet) throw new Error('XLSX 不包含可读取的工作表。');
  const rows = [];
  worksheet.eachRow({ includeEmpty: false }, (row) => {
    rows.push(Array.from({ length: worksheet.columnCount }, (_unused, index) => xlsxCellText(row.getCell(index + 1))));
  });
  return parseReminderRows(rows, 'XLSX');
}

function xlsxCellText(cell) {
  if (cell.value instanceof Date) {
    const format = String(cell.numFmt || '').toLowerCase();
    if (format.includes('h') && !format.includes('y') && !format.includes('d')) {
      return `${String(cell.value.getUTCHours()).padStart(2, '0')}:${String(cell.value.getUTCMinutes()).padStart(2, '0')}`;
    }
    return `${cell.value.getUTCFullYear()}-${String(cell.value.getUTCMonth() + 1).padStart(2, '0')}-${String(cell.value.getUTCDate()).padStart(2, '0')}`;
  }
  return String(cell.text || '').trim();
}

function serializeReminderBackup(reminders, exportedAt = new Date().toISOString()) {
  return JSON.stringify({
    exportedAt,
    reminderFeatureVersion: 3,
    reminders: Array.isArray(reminders) ? reminders : []
  }, null, 2);
}

module.exports = { parseReminderBackup, parseReminderCsv, parseReminderText, parseReminderXlsx, serializeReminderBackup };
