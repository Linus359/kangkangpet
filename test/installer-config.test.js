'use strict';

const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = path.join(__dirname, '..');
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const installer = fs.readFileSync(path.join(root, 'build', 'installer.nsh'), 'utf8');

test('packages only required Windows x64 runtime files with maximum compression', () => {
  const build = packageJson.build;
  assert.equal(build.asar, true);
  assert.equal(build.compression, 'maximum');
  assert.deepEqual(build.electronLanguages, ['zh-CN']);
  assert.deepEqual(build.win.target, [{ target: 'nsis', arch: ['x64'] }]);
  assert.ok(build.files.includes('assets/cat-processed/**/*'));
  assert.ok(build.files.includes('assets/head/**/*'));
  assert.ok(build.files.includes('build/face.ico'));
  assert.ok(build.files.includes('!**/*.map'));
  assert.ok(build.files.includes('!node_modules/exceljs/dist/**/*'));
  assert.ok(!build.files.includes('assets/**/*'));
  assert.ok(!build.files.includes('assets/cat/**/*'));
  assert.ok(build.asarUnpack.includes('assets/cat-processed/**'));
  assert.ok(!build.asarUnpack.includes('assets/cat/**'));
});

test('uses a standard per-user installer and preserves application data', () => {
  const nsis = packageJson.build.nsis;
  assert.equal(nsis.oneClick, false);
  assert.equal(nsis.allowToChangeInstallationDirectory, true);
  assert.equal(nsis.perMachine, false);
  assert.equal(nsis.createDesktopShortcut, true);
  assert.equal(nsis.createStartMenuShortcut, true);
  assert.equal(nsis.menuCategory, '康康熊桌宠');
  assert.equal(nsis.runAfterFinish, true);
  assert.equal(nsis.deleteAppDataOnUninstall, false);
  assert.match(installer, /Preserving local reminder, calendar, note, and settings data in AppData/);
  assert.doesNotMatch(installer, /taskkill|KangKangSelectDefaultInstallDrive|Get-PSDrive|MUI_PAGE_DIRECTORY|CreateShortCut|RMDir/);
});
