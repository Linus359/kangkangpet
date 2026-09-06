'use strict';

const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const { NotesStore, normalizePayload } = require('../src/main/notes-store');
const { findInstalledPwaShortcut, normalizePwaConfig, openPwa } = require('../src/main/pwa-launcher');
const noteHtml = fs.readFileSync(path.join(__dirname, '..', 'note.html'), 'utf8');

test('notes store skips malformed notes and persists atomically', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'kangkang-notes-'));
  const filePath = path.join(directory, 'notes.json');
  const store = new NotesStore(filePath);
  const saved = store.save({ notes: [{ id: 'first', title: '标题', content: '第一行\n第二行', x: 20, y: 30 }, null, { id: 'first', title: '重复' }] });
  assert.equal(saved.version, 2);
  assert.equal(saved.notes.length, 1);
  assert.equal(store.load().notes[0].content, '第一行\n第二行');
  fs.rmSync(directory, { recursive: true, force: true });
});

test('notes payload tolerates missing fields and invalid entries', () => {
  const payload = normalizePayload({ notes: [{ title: 3 }, 'bad', { id: 'ok', width: 10, height: 9999 }] });
  assert.equal(payload.notes.length, 2);
  assert.equal(payload.notes[1].width, 240);
  assert.equal(payload.notes[1].height, 900);
});

test('task notes preserve subtasks and reset daily task completion on a new date', () => {
  const first = normalizePayload({ notes: [{
    mode: 'tasks', tasks: [{ title: '晨间整理', priority: 'high', repeat: 'daily', completed: true, lastResetDate: '2026-01-01', subtasks: [{ title: '列计划', completed: true }] }]
  }] });
  const task = first.notes[0].tasks[0];
  assert.equal(first.version, 2);
  assert.equal(task.priority, 'high');
  assert.equal(task.repeat, 'daily');
  assert.equal(task.subtasks.length, 1);
  // normalizeNote accepts an explicit clock so date rollover logic remains deterministic.
  const { normalizeNote } = require('../src/main/notes-store');
  const reset = normalizeNote({ ...first.notes[0], tasks: [{ ...task, lastResetDate: '2026-01-01', completed: true, subtasks: [{ ...task.subtasks[0], completed: true }] }] }, '2026-01-02T08:00:00.000Z');
  assert.equal(reset.tasks[0].completed, false);
  assert.equal(reset.tasks[0].subtasks[0].completed, false);
});

test('note header is a large drag region while title and content share the editor body', () => {
  assert.match(noteHtml, /class="drag-space"[\s\S]*?title="拖动便利贴"/);
  assert.match(noteHtml, /\.drag-space \{[\s\S]*?-webkit-app-region:drag;/);
  assert.match(noteHtml, /<main id="noteBody">[\s\S]*?<input id="title"[\s\S]*?class="title-divider"[\s\S]*?<textarea id="content"/);
  assert.match(noteHtml, /#title \{[\s\S]*?font:700 15px/);
  assert.match(noteHtml, /#content \{[\s\S]*?font:400 14px/);
  assert.doesNotMatch(noteHtml, /editTitle|编辑标题|✎/);
});

test('PWA configuration accepts only structured local commands', () => {
  const config = normalizePwaConfig({ url: 'https://example.test/app', launchCommand: { file: 'C:\\Apps\\Pwa.exe', args: ['--app'] }, processNames: ['Pwa.exe'], windowTitleKeywords: ['Target'] });
  assert.deepEqual(config.launchCommand, { file: 'C:\\Apps\\Pwa.exe', args: ['--app'] });
  assert.deepEqual(config.processNames, ['pwa']);
  assert.deepEqual(normalizePwaConfig({ launchCommand: { file: 'C:\\Apps\\Pwa.exe', args: [] } }).launchCommand, { file: 'C:\\Apps\\Pwa.exe', args: [] });
  assert.equal(normalizePwaConfig({ launchCommand: 'not allowed' }).launchCommand, null);
});

test('PWA flow reuses a matching window before attempting a launch', async () => {
  let launches = 0;
  let fallbacks = 0;
  const result = await openPwa({ url: 'https://example.test', windowTitleKeywords: ['Target'] }, {
    findInstalledShortcut: async () => null,
    findWindow: async () => ({ Id: 42, MainWindowTitle: 'Target' }),
    activateWindow: async () => true,
    launch: () => { launches += 1; return true; },
    openExternal: async () => { fallbacks += 1; }
  });
  assert.equal(result.reused, true);
  assert.equal(launches, 0);
  assert.equal(fallbacks, 0);
});

test('PWA flow falls back to the system browser after a failed configured launch', async () => {
  let fallbackUrl = null;
  const result = await openPwa({ url: 'https://example.test', launchCommand: { file: 'missing.exe', args: [] }, windowTitleKeywords: ['Target'] }, {
    findInstalledShortcut: async () => null,
    findWindow: async () => null,
    launch: () => false,
    openExternal: async (url) => { fallbackUrl = url; }
  });
  assert.equal(result.fallback, true);
  assert.equal(fallbackUrl, 'https://example.test/');
});

test('PWA flow opens an installed Start menu shortcut before browser fallback', async () => {
  let findCalls = 0;
  let openedPath = null;
  let fallbackUrl = null;
  const result = await openPwa({ url: 'https://example.test/app', windowTitleKeywords: ['Target'] }, {
    findWindow: async () => { findCalls += 1; return findCalls >= 3 ? { Id: 42 } : null; },
    activateWindow: async () => true,
    findInstalledShortcut: async () => ({ path: 'C:\\Start Menu\\Target.lnk' }),
    openPath: async (value) => { openedPath = value; return ''; },
    delay: async () => {},
    openExternal: async (url) => { fallbackUrl = url; }
  });
  assert.equal(result.installed, true);
  assert.equal(openedPath, 'C:\\Start Menu\\Target.lnk');
  assert.equal(fallbackUrl, null);
  assert.ok(findCalls >= 3);
});

test('installed PWA discovery prefers the exact app and preserves its browser profile and app id', async () => {
  const output = JSON.stringify([
    { Path: 'C:\\Start Menu\\Forcome Cloud.lnk', TargetPath: 'C:\\Browsers\\Owner\\browser_proxy.exe', Name: 'Forcome Cloud', Description: '', AppId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', Profile: 'Profile 2', AppUrl: '', Source: 'shortcut' },
    { Path: 'C:\\Start Menu\\FORCOME AI.lnk', TargetPath: 'C:\\Browsers\\Owner\\browser_proxy.exe', Name: 'FORCOME AI', Description: 'FORCOME AI portal', AppId: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', Profile: 'Default', AppUrl: '', Source: 'shortcut' }
  ]);
  const installed = await findInstalledPwaShortcut(normalizePwaConfig({ url: 'https://ai.forcome.test', windowTitleKeywords: ['FORCOME AI', 'FORCOME'] }), async () => ({ ok: true, output }));
  assert.equal(installed.name, 'FORCOME AI');
  assert.equal(installed.appId, 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');
  assert.equal(installed.processName, 'browser');
  assert.deepEqual(installed.args, ['--profile-directory=Default', '--app-id=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb']);
});

test('installed PWA launch uses the owning browser instead of the default browser URL handler', async () => {
  let launchedCommand = null;
  let fallbackUrl = null;
  let findCalls = 0;
  const installed = { path: '', file: 'C:\\Browsers\\Owner\\browser_proxy.exe', args: ['--profile-directory=Default', '--app-id=target-app'], appId: 'target-app', processName: 'browser' };
  const result = await openPwa({ url: 'https://example.test', windowTitleKeywords: ['Target'] }, {
    findInstalledShortcut: async () => installed,
    findWindow: async (_config, owner) => { findCalls += 1; assert.equal(owner, installed); return findCalls >= 4 ? { Id: 42, MainWindowHandle: 99 } : null; },
    activateWindow: async () => true,
    launch: (command) => { launchedCommand = command; return true; },
    delay: async () => {},
    openExternal: async (url) => { fallbackUrl = url; }
  });
  assert.equal(result.installed, true);
  assert.deepEqual(launchedCommand, { file: installed.file, args: installed.args });
  assert.equal(fallbackUrl, null);
});
