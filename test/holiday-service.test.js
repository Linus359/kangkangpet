'use strict';

const path = require('path');
const os = require('os');
const test = require('node:test');
const assert = require('node:assert/strict');
const { ChinaHolidayService, OFFICIAL_SOURCES, fallbackItems, parseOfficialNotice } = require('../src/main/holiday-service');

const notice = `
  <p><strong>一、元旦：</strong>1月1日（周四）至3日（周六）放假调休，共3天。1月4日（周日）上班。</p>
  <p><strong>二、春节：</strong>2月15日（农历腊月二十八、周日）至23日（农历正月初七、周一）放假调休，共9天。2月14日（周六）、2月28日（周六）上班。</p>
  <p><strong>三、清明节：</strong>4月4日（周六）至6日（周一）放假，共3天。</p>
  <p>节假日期间，请妥善安排。</p><p>国务院办公厅</p>`;

test('parses official Chinese holiday and adjusted workday dates distinctly', () => {
  const items = parseOfficialNotice(notice, 2026, OFFICIAL_SOURCES[2026]);
  assert.equal(items.filter((item) => item.kind === 'holiday').length, 15);
  assert.deepEqual(items.filter((item) => item.kind === 'workday').map((item) => item.date), ['2026-01-04', '2026-02-14', '2026-02-28']);
  assert.equal(items.find((item) => item.date === '2026-02-15').name, '春节');
  assert.ok(items.every((item) => item.source.includes('中国政府网')));
});

test('ships official-notice fallback data for supported years', () => {
  const items = fallbackItems(2026);
  assert.equal(items.filter((item) => item.kind === 'holiday').length, 33);
  assert.equal(items.filter((item) => item.kind === 'workday').length, 6);
  assert.equal(fallbackItems(2027).length, 0);
});

test('downloads the government notice and falls back safely when unavailable', async () => {
  const cachePath = path.join(os.tmpdir(), `kangkang-cn-holiday-${Date.now()}.json`);
  const service = new ChinaHolidayService({ cachePath, fetchImpl: async () => ({ ok: true, text: async () => notice }) });
  const result = await service.getYear(2026, { force: true });
  assert.equal(result.available, true);
  assert.equal(result.cached, false);
  assert.equal(result.items.filter((item) => item.kind === 'workday').length, 3);

  const fallback = await new ChinaHolidayService({ cachePath: `${cachePath}.offline`, fetchImpl: async () => { throw new Error('offline'); } }).getYear(2026, { force: true });
  assert.equal(fallback.available, true);
  assert.equal(fallback.cached, true);
  assert.equal(fallback.items.filter((item) => item.kind === 'workday').length, 6);
});
