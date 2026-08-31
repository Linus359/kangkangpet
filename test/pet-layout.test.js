'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { DEFAULT_PET_SIZE, chooseDefaultAsset, clampPetPosition, defaultPetPosition, getPetBounds, normalizePetSize } = require('../src/main/pet-layout');

test('uses the compact 120px visual height and supported range', () => {
  assert.equal(DEFAULT_PET_SIZE, 120);
  assert.equal(normalizePetSize(20), 72);
  assert.equal(normalizePetSize(999), 260);
});

test('window reserves compact controls below the pet', () => {
  const asset = { contentBounds: { width: 80, height: 120 } };
  const bounds = getPetBounds(120, asset);
  assert.deepEqual({ width: bounds.width, height: bounds.height }, { width: 166, height: 178 });
  assert.equal(getPetBounds(120, asset, { visible: true, width: 220, height: 48 }).height, 218);
});

test('window reserves the scrollable bubble height for long messages', () => {
  const asset = { contentBounds: { width: 80, height: 120 } };
  assert.equal(getPetBounds(120, asset, { visible: true, width: 240, height: 600 }, 3).height, 470);
});

test('stable pet windows keep the maximum bubble footprint while it is hidden', () => {
  const asset = { contentBounds: { width: 80, height: 120 } };
  const hidden = getPetBounds(120, asset, null, 3, null, 1, true);
  const visible = getPetBounds(120, asset, { visible: true, width: 160, height: 48 }, 3, null, 1, true);
  assert.deepEqual({ width: hidden.width, height: hidden.height }, { width: 252, height: 470 });
  assert.deepEqual({ width: visible.width, height: visible.height }, { width: hidden.width, height: hidden.height });
});

test('window reserves menu width without moving it above the pet', () => {
  const asset = { contentBounds: { width: 80, height: 120 } };
  const bubble = { visible: true, width: 220, height: 48 };
  const bounds = getPetBounds(120, asset, bubble, 3, { visible: true, width: 220, reserveVertical: false });
  assert.equal(bounds.height, 218);
  assert.equal(bounds.width, 252);
});

test('window leaves the bubble CSS gutter so its text is not clipped', () => {
  const asset = { contentBounds: { width: 80, height: 120 } };
  const bounds = getPetBounds(120, asset, { visible: true, width: 240, height: 48 });
  assert.equal(bounds.width, 252);
});

test('window reserves menu width when no bubble is shown', () => {
  const asset = { contentBounds: { width: 80, height: 120 } };
  const bounds = getPetBounds(120, asset, null, 3, { visible: true, width: 220, reserveVertical: false });
  assert.equal(bounds.height, 178);
  assert.equal(bounds.width, 252);
});

test('different action asset proportions produce their own window bounds', () => {
  const portrait = { contentBounds: { width: 80, height: 120 } };
  const landscape = { contentBounds: { width: 180, height: 120 } };
  assert.equal(getPetBounds(120, portrait).width, 166);
  assert.equal(getPetBounds(120, landscape).width, 212);
});

test('stable aspect reserves one base width while visual asset proportions change', () => {
  const portrait = { contentBounds: { width: 80, height: 120 } };
  const landscape = { contentBounds: { width: 180, height: 120 } };
  const stableAspect = 1.5;
  assert.equal(getPetBounds(120, portrait, null, 3, null, stableAspect).width, 212);
  assert.equal(getPetBounds(120, landscape, null, 3, null, stableAspect).width, 212);
  assert.notEqual(
    getPetBounds(120, portrait, null, 3, null, stableAspect).petLeft,
    getPetBounds(120, landscape, null, 3, null, stableAspect).petLeft
  );
});

test('window reserves space for the three primary interaction icons', () => {
  const asset = { contentBounds: { width: 80, height: 120 } };
  assert.equal(getPetBounds(120, asset, null, 3).width, 135);
  assert.equal(getPetBounds(120, asset, null, 6).width, 228);
});

test('new pets are docked within the primary work area and stale positions are clamped', () => {
  const area = { x: 0, y: 0, width: 1920, height: 1040 };
  const bounds = { width: 120, height: 140 };
  assert.deepEqual(defaultPetPosition(area, bounds), { x: 1776, y: 884 });
  assert.deepEqual(clampPetPosition({ x: 4000, y: -10 }, bounds, area), { x: 1800, y: 0 });
});

test('prefers the explicitly marked transparent idle asset without overriding a valid selection', () => {
  const assets = [{ id: 'white', enabled: true, transparency: { usable: false } }, { id: 'idle', enabled: true, actionKey: 'idle', transparency: { usable: true } }, { id: 'default', enabled: true, default: true, transparency: { usable: true } }];
  assert.equal(chooseDefaultAsset(assets).id, 'default');
});
