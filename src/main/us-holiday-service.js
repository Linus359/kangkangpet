'use strict';

const fs = require('fs');
const path = require('path');

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const SOURCE_NAME = '美国人事管理局（OPM）';
const SOURCE_URL = 'https://www.opm.gov/policy-data-oversight/pay-leave/federal-holidays/';

const NAME_MAP = Object.freeze({
  "New Year's Day": '元旦（美国）',
  'Birthday of Martin Luther King, Jr.': '马丁·路德·金纪念日',
  "Washington's Birthday": '华盛顿诞辰日',
  'Memorial Day': '阵亡将士纪念日',
  'Juneteenth National Independence Day': '六月节',
  'Independence Day': '独立日',
  'Labor Day': '劳动节（美国）',
  'Columbus Day': '哥伦布日',
  'Veterans Day': '退伍军人节',
  'Thanksgiving Day': '感恩节',
  'Christmas Day': '圣诞节（美国）'
});

function stripHtml(value) {
  return String(value || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&#160;/gi, ' ').replace(/&amp;/gi, '&').replace(/&#39;|&apos;/gi, "'").replace(/&rsquo;|&lsquo;/gi, "'").replace(/\s+/g, ' ').trim();
}

function normalizeName(value) {
  const english = stripHtml(value)
    .replace(/[\u00b9\u00b2*†‡]+/g, '')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
  return NAME_MAP[english] || english;
}

function parseOfficialSchedule(html, year, sourceUrl = SOURCE_URL) {
  const escapedYear = String(Number(year));
  const table = String(html || '').match(new RegExp(`<caption[^>]*>\\s*${escapedYear}\\s+Holiday Schedule\\s*<\\/caption>([\\s\\S]*?)<\\/table>`, 'i'))?.[1] || '';
  const items = [];
  for (const row of table.matchAll(/<tr[^>]*>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<\/tr>/gi)) {
    const dateText = stripHtml(row[1]);
    const match = dateText.match(/(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),\s+([A-Za-z]+)\s+(\d{1,2})/i);
    if (!match) continue;
    const month = new Date(`${match[1]} 1, ${escapedYear}`).getMonth() + 1;
    const day = Number(match[2]);
    if (!month || !day) continue;
    const date = `${escapedYear}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const name = normalizeName(row[2]);
    if (!name) continue;
    items.push({ id: `US:holiday:${date}:${name}`, date, name, kind: 'holiday', source: SOURCE_NAME, sourceUrl, official: true, country: 'US' });
  }
  return [...new Map(items.map((item) => [item.id, item])).values()].sort((left, right) => left.date.localeCompare(right.date));
}

class USHolidayService {
  constructor({ cachePath, fetchImpl = globalThis.fetch, log = () => {} } = {}) {
    this.cachePath = cachePath;
    this.fetch = fetchImpl;
    this.log = log;
    this.cache = this.loadCache();
    this.inflight = new Map();
  }

  loadCache() { try { return JSON.parse(fs.readFileSync(this.cachePath, 'utf8')); } catch (_) { return { years: {} }; } }
  saveCache() { try { fs.mkdirSync(path.dirname(this.cachePath), { recursive: true }); fs.writeFileSync(this.cachePath, JSON.stringify(this.cache, null, 2), 'utf8'); } catch (error) { this.log('保存美国节假日缓存失败。', error); } }

  async getYear(year, { force = false } = {}) {
    const normalizedYear = Number(year);
    if (!Number.isInteger(normalizedYear) || normalizedYear < 2000 || normalizedYear > 2100) return { year: normalizedYear, items: [], available: false, source: SOURCE_NAME, sourceUrl: SOURCE_URL, cached: false };
    const cached = this.cache.years?.[normalizedYear];
    if (!force && cached?.items?.length && Date.now() - Number(cached.fetchedAt || 0) < CACHE_TTL_MS) return { year: normalizedYear, items: cached.items, available: true, source: SOURCE_NAME, sourceUrl: SOURCE_URL, cached: true };
    if (this.inflight.has(normalizedYear)) return this.inflight.get(normalizedYear);
    const promise = (async () => {
      try {
        if (typeof this.fetch !== 'function') throw new Error('当前环境不支持网络请求');
        const response = await this.fetch(SOURCE_URL, { headers: { Accept: 'text/html,application/xhtml+xml' } });
        if (!response?.ok) throw new Error(`OPM 响应异常：${response?.status || 'unknown'}`);
        const items = parseOfficialSchedule(await response.text(), normalizedYear, SOURCE_URL);
        if (!items.length) throw new Error('OPM 页面未找到该年份的完整节假日表');
        this.cache.years = this.cache.years || {};
        this.cache.years[normalizedYear] = { fetchedAt: Date.now(), items, sourceUrl: SOURCE_URL };
        this.saveCache();
        return { year: normalizedYear, items, available: true, source: SOURCE_NAME, sourceUrl: SOURCE_URL, cached: false };
      } catch (error) {
        this.log(`读取 ${normalizedYear} 年美国官方节假日安排失败。`, error);
        const items = cached?.items?.length ? cached.items : [];
        return { year: normalizedYear, items, available: items.length > 0, source: SOURCE_NAME, sourceUrl: SOURCE_URL, cached: true };
      } finally { this.inflight.delete(normalizedYear); }
    })();
    this.inflight.set(normalizedYear, promise);
    return promise;
  }
}

module.exports = { CACHE_TTL_MS, SOURCE_NAME, SOURCE_URL, NAME_MAP, USHolidayService, parseOfficialSchedule };
