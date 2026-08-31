'use strict';

const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = path.join(__dirname, '..');
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const mainSource = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
const panelSource = fs.readFileSync(path.join(root, 'panel.html'), 'utf8');
const panelPreloadSource = fs.readFileSync(path.join(root, 'preload', 'panel-preload.js'), 'utf8');
const workflow = fs.readFileSync(path.join(root, '.github', 'workflows', 'release.yml'), 'utf8');

test('packages GitHub Releases metadata for automatic updates', () => {
  assert.equal(packageJson.repository.url, 'https://github.com/Linus359/kangkangpet.git');
  assert.equal(packageJson.build.publish.provider, 'github');
  assert.equal(packageJson.build.publish.owner, 'Linus359');
  assert.equal(packageJson.build.publish.repo, 'kangkangpet');
  assert.equal(packageJson.build.win.artifactName, 'kangkangpet-setup-${version}.${ext}');
  assert.ok(packageJson.dependencies['electron-updater']);
});

test('checks packaged installs for updates without affecting development', () => {
  assert.match(mainSource, /const \{ autoUpdater \} = require\('electron-updater'\);/);
  assert.match(mainSource, /function setupAutoUpdater\(\) \{[\s\S]*?if \(!app\.isPackaged\) return;/);
  assert.match(mainSource, /autoUpdater\.checkForUpdates\(\)/);
  assert.match(mainSource, /setupAutoUpdater\(\);/);
});

test('exposes app version and manual update status to the settings panel', () => {
  assert.match(mainSource, /ipcMain\.handle\('app:get-info'/);
  assert.match(mainSource, /ipcMain\.handle\('app:check-for-updates'/);
  assert.match(mainSource, /app\.getVersion\(\)/);
  assert.match(panelPreloadSource, /getAppInfo: \(\) => ipcRenderer\.invoke\('app:get-info'\)/);
  assert.match(panelPreloadSource, /checkForUpdates: \(\) => ipcRenderer\.invoke\('app:check-for-updates'\)/);
  assert.match(panelPreloadSource, /onUpdateStatus:/);
  assert.match(panelSource, /id="appVersion"/);
  assert.match(panelSource, /id="checkUpdates"/);
  assert.match(panelSource, /api\.checkForUpdates\(\)/);
});

test('keeps calendar creation in a date-triggered modal and provides an import template', () => {
  assert.match(panelSource, /id="calendarQuickModal" hidden/);
  const calendarSection = panelSource.match(/<section class="tab active" id="calendarTab">([\s\S]*?)<\/section>/)?.[1] || '';
  assert.doesNotMatch(calendarSection, /calendar-create-form/);
  assert.match(panelSource, /cell\.addEventListener\('dblclick', \(\) => focusQuickForm\(key\)\)/);
  assert.match(panelSource, /id="downloadTemplate"/);
  assert.match(panelSource, /function downloadReminderTemplate\(\)/);
});

test('opens FORCOME AI through installed shortcuts, browser apps, or a direct app window', () => {
  assert.match(mainSource, /const FORCOME_AI_URL = 'https:\/\/ai\.forcome\.com';/);
  assert.match(mainSource, /function startMenuRoots\(\)/);
  assert.match(mainSource, /function browserAppCandidates\(\)/);
  assert.match(mainSource, /function installBrowserAppShortcut\(\)/);
  assert.match(mainSource, /shell\.writeShortcutLink\(shortcut, fs\.existsSync\(shortcut\) \? 'replace' : 'create'/);
  assert.match(mainSource, /--app-id=\$\{candidate\.appId\}/);
  assert.match(mainSource, /--app=\$\{FORCOME_AI_URL\}/);
  assert.match(mainSource, /--app-id=\$\{candidate\.appId\}/);
  assert.match(mainSource, /--app=\$\{FORCOME_AI_URL\}/);
  assert.match(mainSource, /shell\.openExternal\(FORCOME_AI_URL\)/);
  assert.doesNotMatch(mainSource, /未找到已安装的 FORCOME 应用/);
});

test('publishes tagged releases through GitHub Actions', () => {
  assert.match(workflow, /tags:[\s\S]*?- 'v\*'/);
  assert.match(workflow, /GH_TOKEN: \$\{\{ github\.token \}\}/);
  assert.match(workflow, /electron-builder --win nsis --x64 --publish always/);
});
