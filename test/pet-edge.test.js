'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { edgeHeadBounds, nearestDesktopEdge, restoredPetBounds } = require('../src/main/pet-edge');

const workArea = { x: 0, y: 0, width: 1920, height: 1040 };

test('chooses the nearest work-area edge for an idle pet', () => {
  assert.equal(nearestDesktopEdge({ x: 12, y: 430, width: 160, height: 220 }, workArea), 'left');
  assert.equal(nearestDesktopEdge({ x: 1700, y: 480, width: 160, height: 220 }, workArea), 'right');
  assert.equal(nearestDesktopEdge({ x: 800, y: 6, width: 160, height: 220 }, workArea), 'top');
  assert.equal(nearestDesktopEdge({ x: 800, y: 790, width: 160, height: 220 }, workArea), 'bottom');
});

test('keeps the complete edge head inside the work area', () => {
  const head = edgeHeadBounds('right', { x: 1780, y: 980, width: 120, height: 120 }, workArea, 96);
  assert.deepEqual(head, { x: 1824, y: 944, width: 96, height: 96 });
});

test('restores a dragged edge pet along its original edge without overflow', () => {
  const head = { x: 0, y: 900, width: 96, height: 96 };
  const pet = restoredPetBounds('left', head, { width: 180, height: 340 }, workArea);
  assert.deepEqual(pet, { x: 0, y: 700, width: 180, height: 340 });
});
