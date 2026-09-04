'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { convertUnit, dateDifference, formatTimeZone, holidaysForDate, normalizeAnniversaries, normalizeCalendarViewMode, normalizeTimeZones } = require('../src/main/productivity-tools');

test('time zone configuration stays local, deduplicated, and displayable', () => {
  assert.deepEqual(normalizeTimeZones(['Asia/Shanghai', 'Asia/Shanghai', 'invalid']), ['Asia/Shanghai']);
  const value = formatTimeZone('America/New_York', new Date('2026-01-01T12:00:00.000Z'));
  assert.equal(value.zone, 'America/New_York');
  assert.match(value.value, /01\/01/);
});

test('anniversaries and fixed holidays are local date data', () => {
  const items = normalizeAnniversaries([{ id: 'birthday', name: '纪念日', date: '10-01' }, { name: '', date: '01-01' }]);
  assert.deepEqual(items, [{ id: 'birthday', name: '纪念日', date: '10-01' }]);
  assert.deepEqual(holidaysForDate(new Date(2026, 9, 1), items), ['国庆节', '纪念日']);
});

test('calculator only converts compatible units and calculates calendar days', () => {
  assert.equal(convertUnit(1, 'mi', 'km').toFixed(3), '1.609');
  assert.equal(convertUnit(10, 'cm', 'in').toFixed(3), '3.937');
  assert.equal(convertUnit(1, 'mi', 'cm'), null);
  assert.equal(dateDifference('2026-01-01', '2026-01-11'), 10);
});

test('home calendar view mode is normalized for persisted preferences', () => {
  assert.equal(normalizeCalendarViewMode('year'), 'year');
  assert.equal(normalizeCalendarViewMode('week'), 'week');
  assert.equal(normalizeCalendarViewMode('day'), 'day');
  assert.equal(normalizeCalendarViewMode('invalid'), 'month');
});
