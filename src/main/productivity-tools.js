'use strict';

const DEFAULT_TIME_ZONES = ['Asia/Shanghai', 'America/New_York'];
const TIME_ZONE_OPTIONS = [
  ['Asia/Shanghai', '中国时间'], ['America/New_York', '美国东部'], ['America/Los_Angeles', '美国西部'], ['Europe/London', '英国时间'], ['Asia/Tokyo', '日本时间']
];
const FIXED_HOLIDAYS = [
  { month: 1, day: 1, name: '元旦' }, { month: 5, day: 1, name: '劳动节' }, { month: 10, day: 1, name: '国庆节' }
];

function normalizeCalendarViewMode(value) {
  return ['year', 'month', 'week', 'day'].includes(value) ? value : 'month';
}

function normalizeTimeZones(value) {
  const known = new Set(TIME_ZONE_OPTIONS.map(([zone]) => zone));
  const values = (Array.isArray(value) ? value : DEFAULT_TIME_ZONES).filter((zone) => known.has(zone));
  return [...new Set(values)].slice(0, TIME_ZONE_OPTIONS.length) || [...DEFAULT_TIME_ZONES];
}

function normalizeAnniversaries(value) {
  const ids = new Set();
  return (Array.isArray(value) ? value : []).map((item) => {
    const name = typeof item?.name === 'string' ? item.name.trim().slice(0, 80) : '';
    const date = /^\d{2}-\d{2}$/.test(String(item?.date || '')) ? String(item.date) : '';
    const [month, day] = date.split('-').map(Number);
    if (!name || !month || month > 12 || !day || day > new Date(2000, month, 0).getDate()) return null;
    const id = typeof item.id === 'string' && item.id && !ids.has(item.id) ? item.id.slice(0, 160) : `${month}-${day}-${name}`;
    if (ids.has(id)) return null;
    ids.add(id);
    return { id, name, date };
  }).filter(Boolean);
}

function formatTimeZone(zone, now = new Date(), locale = 'zh-CN') {
  const label = TIME_ZONE_OPTIONS.find(([id]) => id === zone)?.[1] || zone;
  const value = new Intl.DateTimeFormat(locale, { timeZone: zone, hour12: false, month: '2-digit', day: '2-digit', weekday: 'short', hour: '2-digit', minute: '2-digit' }).format(now);
  return { zone, label, value };
}

function holidaysForDate(date, anniversaries = []) {
  const month = date.getMonth() + 1; const day = date.getDate();
  const key = `${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return [...FIXED_HOLIDAYS.filter((item) => item.month === month && item.day === day).map((item) => item.name), ...normalizeAnniversaries(anniversaries).filter((item) => item.date === key).map((item) => item.name)];
}

function dateDifference(from, to) {
  const left = new Date(`${from}T00:00:00`); const right = new Date(`${to}T00:00:00`);
  if (!Number.isFinite(left.getTime()) || !Number.isFinite(right.getTime())) return null;
  return Math.round((right - left) / 86400000);
}

function convertUnit(value, from, to) {
  const number = Number(value);
  const factors = { km: 1000, mi: 1609.344, m: 1, cm: 0.01, in: 0.0254 };
  const groups = { km: 'distance', mi: 'distance', m: 'length', cm: 'length', in: 'length' };
  if (!Number.isFinite(number) || !factors[from] || !factors[to] || groups[from] !== groups[to]) return null;
  return number * factors[from] / factors[to];
}

module.exports = { DEFAULT_TIME_ZONES, TIME_ZONE_OPTIONS, FIXED_HOLIDAYS, normalizeCalendarViewMode, normalizeTimeZones, normalizeAnniversaries, formatTimeZone, holidaysForDate, dateDifference, convertUnit };
