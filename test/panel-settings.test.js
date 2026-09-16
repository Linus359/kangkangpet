'use strict';

const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const panelHtml = fs.readFileSync(path.join(__dirname, '..', 'panel.html'), 'utf8');

test('settings autosave preserves active inputs and IME composition', () => {
  assert.match(panelHtml, /let pendingSaveFactory = null;/);
  assert.match(panelHtml, /let saveInFlight = false;/);
  assert.match(panelHtml, /let composingInput = false;/);
  assert.match(panelHtml, /const SETTINGS_SAVE_DELAY = 480;/);
  assert.match(panelHtml, /if \(composingInput \|\| saveInFlight\) return;/);
  assert.match(panelHtml, /document\.addEventListener\('compositionstart'/);
  assert.match(panelHtml, /document\.addEventListener\('compositionend'/);
  assert.match(panelHtml, /await api\.updateConfig\(patch\);/);
  assert.match(panelHtml, /Object\.entries\(patch \|\| \{\}\)\.forEach/);
  assert.doesNotMatch(panelHtml, /api\.updateConfig\(factory\(\)\); renderSettings\(\)/);
});

test('panel exposes the exchange-rate tool and optional onboarding date', () => {
  assert.match(panelHtml, /id="exchangeAmount"/);
  assert.match(panelHtml, /id="exchangeBase"/);
  assert.match(panelHtml, /id="exchangeQuote"/);
  assert.match(panelHtml, /id="exchangeRefresh"/);
  assert.match(panelHtml, /getExchangeRate\(\{ base: exchangeBase\.value, quote: exchangeQuote\.value \}\)/);
  assert.match(panelHtml, /id="newStaffStartDate"/);
  assert.match(panelHtml, /newStaffProfile: \{ onboardingStartDate \}/);
});

test('panel keeps the mini calendar inside its sidebar at constrained sizes', () => {
  assert.match(panelHtml, /body \{ display:flex; margin:0; min-width:0;/);
  assert.match(panelHtml, /\.calendar-sidebar \{ grid-template-rows:auto auto minmax\(0, 1fr\); gap:10px; overflow-y:auto/);
  assert.match(panelHtml, /\.calendar-sidebar > \.sidebar-block:first-child \{ min-height:246px;/);
  assert.match(panelHtml, /\.calendar-sidebar > \.sidebar-block:first-child \.mini-grid \{ overflow:visible; \}/);
});

test('tools page scrolls with the panel and collapses before the minimum width', () => {
  assert.match(panelHtml, /#toolsTab,#remindersTab,#settingsTab \{ overflow-y:auto; overflow-x:hidden; \}/);
  assert.match(panelHtml, /\.tools-grid \{ display:grid; grid-template-columns:repeat\(2,minmax\(0,1fr\)\); align-items:start;/);
  assert.match(panelHtml, /\.tools-column \{ display:grid; align-content:start; gap:16px; min-width:0; \}/);
  assert.match(panelHtml, /<div class="tools-column">[\s\S]*id="clockList"[\s\S]*id="dateFrom"/);
  assert.match(panelHtml, /<div class="tools-column">[\s\S]*id="holidayToday"[\s\S]*id="unitValue"/);
  assert.match(panelHtml, /\.tools-grid > \.section \{ min-width:0; grid-column:1 \/ -1; \}/);
  assert.match(panelHtml, /@media \(max-width:980px\) \{ \.tools-grid \{ grid-template-columns:1fr; \}/);
});
