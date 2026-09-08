'use strict';

const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = path.join(__dirname, '..');
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const installer = fs.readFileSync(path.join(root, 'build', 'installer.nsh'), 'utf8');
const legacyCleanupBytes = fs.readFileSync(path.join(root, 'build', 'cleanup-legacy-cli.ps1'));
const legacyCleanup = legacyCleanupBytes.toString('utf8');

test('packages only required Windows x64 runtime files with maximum compression', () => {
  const build = packageJson.build;
  assert.equal(build.asar, true);
  assert.equal(build.compression, 'maximum');
  assert.deepEqual(build.electronLanguages, ['zh-CN']);
  assert.deepEqual(build.win.target, [{ target: 'nsis', arch: ['x64'] }]);
  assert.ok(build.files.includes('assets/cat-processed/**/*'));
  assert.ok(build.files.includes('assets/head/**/*'));
  assert.ok(!build.files.includes('build/face.ico'));
  assert.equal(build.win.icon, 'dist/cli/assets/forcome.ico');
  assert.equal(build.nsis.installerIcon, 'dist/cli/assets/forcome.ico');
  assert.equal(build.nsis.uninstallerIcon, 'dist/cli/assets/forcome.ico');
  assert.equal(build.nsis.installerHeaderIcon, 'dist/cli/assets/forcome.ico');
  assert.ok(build.extraResources.some((resource) => resource.from === 'dist/cli/runtime' && resource.to === 'forcome-cli/runtime'));
  assert.ok(build.extraResources.some((resource) => resource.from === 'dist/cli/cli' && resource.to === 'forcome-cli/cli'));
  assert.ok(build.extraResources.some((resource) => resource.from === 'dist/cli/ForcomeAiTray.exe' && resource.to === 'forcome-cli/ForcomeAiTray.exe'));
  assert.ok(build.files.includes('!**/*.map'));
  assert.ok(build.files.includes('!node_modules/exceljs/dist/**/*'));
  assert.ok(!build.files.includes('assets/**/*'));
  assert.ok(!build.files.includes('assets/cat/**/*'));
  assert.ok(build.asarUnpack.includes('assets/cat-processed/**'));
  assert.ok(!build.asarUnpack.includes('assets/cat/**'));
});

test('uses a standard per-user installer, removes legacy standalone CLIs, and preserves application data', () => {
  const nsis = packageJson.build.nsis;
  assert.equal(nsis.oneClick, false);
  assert.equal(nsis.allowToChangeInstallationDirectory, true);
  assert.equal(nsis.perMachine, false);
  assert.equal(nsis.createDesktopShortcut, true);
  assert.equal(nsis.createStartMenuShortcut, true);
  assert.equal(nsis.menuCategory, '康康熊桌宠');
  assert.equal(nsis.runAfterFinish, true);
  assert.equal(nsis.deleteAppDataOnUninstall, false);
  assert.match(installer, /!macro customCheckAppRunning/);
  assert.doesNotMatch(installer, /!macro customInit/);
  assert.match(installer, /cleanup-legacy-cli\.ps1/);
  assert.match(installer, /正在退出程序并清理旧版 FORCOME AI CLI/);
  assert.match(installer, /inside the install section/);
  assert.match(installer, /legacyCliCleanupDone/);
  assert.deepEqual([...legacyCleanupBytes.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
  assert.match(legacyCleanup, /ForcomeAI-Connector/);
  assert.match(legacyCleanup, /ForcomeAI-Tray/);
  assert.match(legacyCleanup, /npm\.cmd/);
  assert.match(legacyCleanup, /@forcome\[\\\\\/\]ai-cli/);
  assert.match(legacyCleanup, /ForcomeAI\\cli/);
  assert.match(legacyCleanup, /保留 \.lobehub 登录凭据/);
  assert.doesNotMatch(legacyCleanup, /Remove-Item[^\n]+credentials\.json/i);
  assert.match(installer, /Preserving local reminder, calendar, note, and settings data in AppData/);
  assert.doesNotMatch(installer, /KangKangSelectDefaultInstallDrive|Get-PSDrive|MUI_PAGE_DIRECTORY|CreateShortCut|RMDir/);
});
