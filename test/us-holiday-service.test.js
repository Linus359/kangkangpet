'use strict';

const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const { parseOfficialSchedule, USHolidayService, SOURCE_NAME } = require('../src/main/us-holiday-service');

const SAMPLE = `
<table><caption>2026 Holiday Schedule</caption><tbody>
<tr><td>Thursday, January 01</td><td>New Year’s Day</td></tr>
<tr><td>Friday, June 19</td><td>Juneteenth National Independence Day</td></tr>
<tr><td>Thursday, November 26</td><td>Thanksgiving Day</td></tr>
</tbody></table>`;

test('parses the official OPM holiday schedule into dated US entries', () => {
  const items = parseOfficialSchedule(SAMPLE, 2026);
  assert.equal(items.length, 3);
  assert.deepEqual(items.map((item) => [item.date, item.name]), [
    ['2026-01-01', '元旦（美国）'],
    ['2026-06-19', '六月节'],
    ['2026-11-26', '感恩节']
  ]);
  assert.ok(items.every((item) => item.country === 'US' && item.source === SOURCE_NAME && item.official));
});

test('uses a fresh cache when OPM is unavailable', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'kangkang-us-holidays-'));
  const cachePath = path.join(directory, 'cache.json');
  const service = new USHolidayService({ cachePath, fetchImpl: async () => ({ ok: true, text: async () => SAMPLE }) });
  const first = await service.getYear(2026);
  assert.equal(first.available, true);
  const offline = new USHolidayService({ cachePath, fetchImpl: async () => { throw new Error('offline'); } });
  const second = await offline.getYear(2026, { force: true });
  assert.equal(second.available, true);
  assert.equal(second.cached, true);
  assert.equal(second.items[2].name, '感恩节');
  fs.rmSync(directory, { recursive: true, force: true });
});
