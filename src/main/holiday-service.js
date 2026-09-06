'use strict';

const fs = require('fs');
const path = require('path');

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const SOURCE_NAME = '中国政府网（国务院办公厅）';
const OFFICIAL_SOURCES = {
  2025: 'https://www.gov.cn/zhengce/content/202411/content_6986382.htm',
  2026: 'https://www.gov.cn/gongbao/2025/issue_12406/202511/content_7048922.html'
};

const OFFICIAL_FALLBACKS = {
  2025: {
    holidays: [
      ['元旦', '2025-01-01', '2025-01-01'], ['春节', '2025-01-28', '2025-02-04'],
      ['清明节', '2025-04-04', '2025-04-06'], ['劳动节', '2025-05-01', '2025-05-05'],
      ['端午节', '2025-05-31', '2025-06-02'], ['国庆节、中秋节', '2025-10-01', '2025-10-08']
    ],
    workdays: [['春节', '2025-01-26'], ['春节', '2025-02-08'], ['劳动节', '2025-04-27'], ['国庆节、中秋节', '2025-09-28'], ['国庆节、中秋节', '2025-10-11']]
  },
  2026: {
    holidays: [
      ['元旦', '2026-01-01', '2026-01-03'], ['春节', '2026-02-15', '2026-02-23'],
      ['清明节', '2026-04-04', '2026-04-06'], ['劳动节', '2026-05-01', '2026-05-05'],
      ['端午节', '2026-06-19', '2026-06-21'], ['中秋节', '2026-09-25', '2026-09-27'],
      ['国庆节', '2026-10-01', '2026-10-07']
    ],
    workdays: [['元旦', '2026-01-04'], ['春节', '2026-02-14'], ['春节', '2026-02-28'], ['劳动节', '2026-05-09'], ['国庆节', '2026-09-20'], ['国庆节', '2026-10-10']]
  }
};

function dateKey(year, month, day) {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function expandRange(start, end) {
  const values = [];
  const cursor = new Date(`${start}T00:00:00`);
  const limit = new Date(`${end}T00:00:00`);
  while (Number.isFinite(cursor.getTime()) && cursor <= limit && values.length < 32) {
    values.push(dateKey(cursor.getFullYear(), cursor.getMonth() + 1, cursor.getDate()));
    cursor.setDate(cursor.getDate() + 1);
  }
  return values;
}

function normalizeItem(item, year, sourceUrl) {
  const kind = item?.kind === 'workday' ? 'workday' : 'holiday';
  const date = String(item?.date || '');
  if (!date.startsWith(`${year}-`) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const name = String(item?.name || '').trim();
  if (!name) return null;
  return { id: `CN:${kind}:${date}`, date, name, kind, source: SOURCE_NAME, sourceUrl, official: true };
}

function fallbackItems(year) {
  const sourceUrl = OFFICIAL_SOURCES[year];
  const schedule = OFFICIAL_FALLBACKS[year];
  if (!sourceUrl || !schedule) return [];
  const items = [];
  schedule.holidays.forEach(([name, start, end]) => expandRange(start, end).forEach((date) => items.push(normalizeItem({ date, name, kind: 'holiday' }, year, sourceUrl))));
  schedule.workdays.forEach(([name, date]) => items.push(normalizeItem({ date, name, kind: 'workday' }, year, sourceUrl)));
  return items.filter(Boolean);
}

function stripHtml(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&ldquo;|&rdquo;|&#34;/gi, '“')
    .replace(/\s+/g, ' ');
}

function parseDateRange(text, year) {
  const value = String(text || '').replace(/（[^）]*）/g, '');
  const match = value.match(/(\d{1,2})月(\d{1,2})日(?:至(?:(\d{1,2})月)?(\d{1,2})日)?/);
  if (!match) return [];
  const startMonth = Number(match[1]); const startDay = Number(match[2]);
  const endMonth = Number(match[3] || startMonth); const endDay = Number(match[4] || startDay);
  return expandRange(dateKey(year, startMonth, startDay), dateKey(year, endMonth, endDay));
}

function parseOfficialNotice(html, year, sourceUrl = OFFICIAL_SOURCES[year]) {
  const text = stripHtml(html);
  const start = text.indexOf('一、元旦');
  if (start < 0) return [];
  const officeIndex = text.indexOf('国务院办公厅', start);
  const relevant = text.slice(start, officeIndex > start ? officeIndex : start + 3000);
  const items = [];
  const sectionPattern = /(?:^|\s)[一二三四五六七八九十]+、([^：]{1,20})：\s*([\s\S]*?)(?=\s[一二三四五六七八九十]+、|节假日期间|$)/g;
  for (const section of relevant.matchAll(sectionPattern)) {
    const name = section[1].trim();
    const body = section[2];
    const holidaySentence = body.split('。').find((sentence) => sentence.includes('放假')) || '';
    parseDateRange(holidaySentence.split('放假')[0], year).forEach((date) => items.push(normalizeItem({ date, name, kind: 'holiday' }, year, sourceUrl)));
    const workdayText = body.split('。').filter((sentence) => sentence.includes('上班')).join(' ').replace(/（[^）]*）/g, '');
    for (const match of workdayText.matchAll(/(\d{1,2})月(\d{1,2})日/g)) {
      items.push(normalizeItem({ date: dateKey(year, Number(match[1]), Number(match[2])), name, kind: 'workday' }, year, sourceUrl));
    }
  }
  const unique = new Map(items.filter(Boolean).map((item) => [item.id, item]));
  return [...unique.values()].sort((left, right) => left.date.localeCompare(right.date) || left.kind.localeCompare(right.kind));
}

class ChinaHolidayService {
  constructor({ cachePath, fetchImpl = globalThis.fetch, log = () => {} } = {}) {
    this.cachePath = cachePath;
    this.fetch = fetchImpl;
    this.log = log;
    this.cache = this.loadCache();
    this.inflight = new Map();
  }

  loadCache() {
    try { return JSON.parse(fs.readFileSync(this.cachePath, 'utf8')); } catch (_) { return { years: {} }; }
  }

  saveCache() {
    try { fs.mkdirSync(path.dirname(this.cachePath), { recursive: true }); fs.writeFileSync(this.cachePath, JSON.stringify(this.cache, null, 2), 'utf8'); }
    catch (error) { this.log('保存中国节假日缓存失败。', error); }
  }

  async getYear(year, { force = false } = {}) {
    const normalizedYear = Number(year);
    const sourceUrl = OFFICIAL_SOURCES[normalizedYear];
    if (!Number.isInteger(normalizedYear) || !sourceUrl) return { year: normalizedYear, items: [], available: false, source: SOURCE_NAME, sourceUrl: null, cached: false };
    const cached = this.cache.years?.[normalizedYear];
    if (!force && cached?.items?.length && Date.now() - Number(cached.fetchedAt || 0) < CACHE_TTL_MS) return { year: normalizedYear, items: cached.items, available: true, source: SOURCE_NAME, sourceUrl, cached: true };
    if (this.inflight.has(normalizedYear)) return this.inflight.get(normalizedYear);
    const promise = (async () => {
      try {
        if (typeof this.fetch !== 'function') throw new Error('当前环境不支持网络请求');
        const response = await this.fetch(sourceUrl, { headers: { Accept: 'text/html,application/xhtml+xml' } });
        if (!response?.ok) throw new Error(`中国政府网响应异常：${response?.status || 'unknown'}`);
        const parsed = parseOfficialNotice(await response.text(), normalizedYear, sourceUrl);
        if (!parsed.length || !parsed.some((item) => item.kind === 'workday')) throw new Error('官方通知内容解析不完整');
        this.cache.years = this.cache.years || {};
        this.cache.years[normalizedYear] = { fetchedAt: Date.now(), items: parsed, sourceUrl };
        this.saveCache();
        return { year: normalizedYear, items: parsed, available: true, source: SOURCE_NAME, sourceUrl, cached: false };
      } catch (error) {
        this.log(`读取 ${normalizedYear} 年中国官方节假日安排失败。`, error);
        const items = cached?.items?.length ? cached.items : fallbackItems(normalizedYear);
        return { year: normalizedYear, items, available: items.length > 0, source: SOURCE_NAME, sourceUrl, cached: true };
      } finally { this.inflight.delete(normalizedYear); }
    })();
    this.inflight.set(normalizedYear, promise);
    return promise;
  }
}

module.exports = { CACHE_TTL_MS, SOURCE_NAME, OFFICIAL_SOURCES, OFFICIAL_FALLBACKS, ChinaHolidayService, fallbackItems, parseOfficialNotice };
