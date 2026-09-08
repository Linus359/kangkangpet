'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { ensureWindowBoundsVisible } = require('../src/main/window-layout');

const primary = { x: 0, y: 0, width: 1440, height: 852 };

test('moves a panel saved on a disconnected left monitor back to the primary screen', () => {
  const stale = { x: -1928, y: -8, width: 1440, height: 852 };
  assert.deepEqual(ensureWindowBoundsVisible(stale, [{ workArea: primary }], primary), primary);
});

test('preserves a panel that remains substantially visible on any connected display', () => {
  const secondary = { x: -1920, y: 0, width: 1920, height: 1040 };
  const bounds = { x: -1800, y: 80, width: 1040, height: 780 };
  assert.deepEqual(ensureWindowBoundsVisible(bounds, [{ workArea: primary }, { workArea: secondary }], primary), bounds);
});

test('rescues a nearly unreachable window and fits oversized bounds to the work area', () => {
  const stale = { x: 1400, y: 830, width: 1800, height: 1200 };
  assert.deepEqual(ensureWindowBoundsVisible(stale, [{ workArea: primary }], primary), primary);
});
