'use strict';

const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = path.join(__dirname, '..');
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const mainSource = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
const pwaSource = fs.readFileSync(path.join(root, 'src', 'main', 'pwa-launcher.js'), 'utf8');
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

test('opens the configured PWA through the main process with browser fallback', () => {
  assert.match(pwaSource, /function normalizePwaConfig\(value\)/);
  assert.match(pwaSource, /launchCommand: normalizeLaunchCommand\(source\.launchCommand\)/);
  assert.match(pwaSource, /shell|openExternal/);
  assert.match(pwaSource, /shell: false/);
  assert.match(pwaSource, /fallbackToBrowser/);
  assert.match(pwaSource, /findInstalledPwaShortcut/);
  assert.match(mainSource, /openPath: shell\.openPath/);
  assert.match(mainSource, /ipcMain\.handle\('pet:open-pwa'/);
  assert.match(mainSource, /openPwa\(config\?\.pwa/);
  assert.doesNotMatch(pwaSource, /Chrome\.exe|Edge\.exe|Program Files/);
});

test('uses one CLI-centered tray with live status and automatic reconnect', () => {
  assert.match(mainSource, /function forcomeStatusLabel\(/);
  assert.match(mainSource, /FORCOME_RECONNECT_DELAYS_MS = \[5000, 15000, 30000, 60000, 120000\]/);
  assert.match(mainSource, /tray\.on\('click', \(\) => openConfiguredPwa\(\)\)/);
  assert.match(mainSource, /label: '康康熊桌宠与提醒', submenu:/);
  assert.match(mainSource, /fs\.watchFile\(forcomeStatusWatchPath/);
  assert.doesNotMatch(mainSource, /\.openTray\(/);
  assert.doesNotMatch(mainSource, /--show/);
  assert.match(panelSource, /CLI 离线自动重连/);
  assert.match(panelSource, /低资源模式（推荐）/);
  assert.match(panelPreloadSource, /loginForcomeCli: \(\) => ipcRenderer\.invoke\('forcome-cli:login'\)/);
  assert.doesNotMatch(mainSource, /label: '开机自动启动', type: 'checkbox'/);
  assert.match(panelSource, /id="autoLaunch" type="checkbox"/);
});

test('keeps the CLI and tray alive when the optional pet window is released', () => {
  assert.match(mainSource, /app\.on\('window-all-closed', \(\) => \{/);
  const maintenance = mainSource.match(/function scheduleForcomeMaintenance[\s\S]*?\n\}/)?.[0] || '';
  assert.doesNotMatch(maintenance, /petWindowDestroyTimer/);
  assert.match(mainSource, /setTimeout\(\(\) => \{[\s\S]*?petWindow\.destroy\(\);[\s\S]*?\}, 30000\)/);
});

test('pet context menu is a flat desktop-pet shortcut menu without CLI management actions', () => {
  const petMenu = mainSource.match(/function petContextMenuTemplate\(\) \{[\s\S]*?\n\}/)?.[0] || '';
  assert.match(petMenu, /FORCOME AI：/);
  assert.match(petMenu, /打开 FORCOME AI/);
  assert.match(petMenu, /隐藏桌宠/);
  assert.match(petMenu, /快速新建提醒/);
  assert.match(petMenu, /新建便利贴/);
  assert.match(petMenu, /显示全部便利贴/);
  assert.match(petMenu, /隐藏全部便利贴/);
  assert.match(petMenu, /打开控制面板/);
  assert.match(petMenu, /'退出免打扰模式'[\s\S]*?'开启免打扰模式'/);
  assert.doesNotMatch(petMenu, /submenu|重新登录|连接 CLI|停止 CLI|离线自动重连/);
  assert.match(mainSource, /Menu\.buildFromTemplate\(petContextMenuTemplate\(\)\)/);
  assert.match(panelSource, /id="doNotDisturbMode"/);
  assert.doesNotMatch(panelSource, /启用轻拍反馈|id="tapFeedback"/);
});

test('uses only official China holiday scheduling in the calendar', () => {
  assert.match(mainSource, /ChinaHolidayService/);
  assert.match(mainSource, /china-holidays:get/);
  assert.match(panelPreloadSource, /getChinaHolidays:/);
  assert.match(panelSource, /中国法定节假日/);
  assert.match(panelSource, /调休补班/);
  assert.doesNotMatch(panelSource, /国家 \/ 地区（可多选）|holidayCountries|holidayOptional/);
});

test('verifies tagged release source without requiring the private bundled CLI payload', () => {
  assert.match(workflow, /tags:[\s\S]*?- 'v\*'/);
  assert.match(workflow, /npm run check/);
  assert.match(workflow, /npm test/);
  assert.match(workflow, /bundled FORCOME CLI runtime is not stored in the public source repository/);
  assert.doesNotMatch(workflow, /electron-builder|GH_TOKEN/);
});
