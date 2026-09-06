'use strict';

const path = require('path');
const fs = require('fs');
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('events');
const { PassThrough } = require('stream');
const { ForcomeCliManager, resolveForcomeCliPaths } = require('../src/main/forcome-cli');

const root = path.join(__dirname, '..');
const shimPath = path.join(root, 'dist', 'cli', 'bin', 'fai.cmd');
const bundledFs = {
  statSync(filePath) {
    if (String(filePath).includes('missing-home')) throw new Error('missing');
    return { isFile: () => true };
  },
  readFileSync(filePath) {
    return JSON.stringify({ version: String(filePath).includes('@lobehub') ? '0.0.47' : '0.1.5' });
  }
};

test('resolves the bundled CLI from the development and packaged locations', () => {
  const development = resolveForcomeCliPaths({ appRoot: root, resourcesPath: 'C:\\ignored', isPackaged: false });
  assert.equal(development.root, path.join(root, 'dist', 'cli'));
  const packaged = resolveForcomeCliPaths({ appRoot: root, resourcesPath: 'C:\\Program Files\\KangKang\\resources', isPackaged: true });
  assert.equal(packaged.root, path.join('C:\\Program Files\\KangKang\\resources', 'forcome-cli'));
});

test('reports the checked-in CLI payload without reading credential contents', () => {
  const manager = new ForcomeCliManager({ appRoot: root, resourcesPath: '', isPackaged: false, homeDir: path.join(root, 'test', 'missing-home'), fsImpl: bundledFs });
  const info = manager.staticInfo();
  assert.equal(info.available, true);
  assert.equal(info.version, '0.1.5');
  assert.equal(info.wrappedVersion, '0.0.47');
  assert.equal(info.authenticated, false);
  assert.deepEqual(info.missingFiles, []);
  assert.match(info.iconPath, /forcome\.ico$/i);
});

test('uses a portable CLI shim without a machine-specific installation path', { skip: !fs.existsSync(shimPath) }, () => {
  const shim = fs.readFileSync(shimPath, 'utf8');
  assert.match(shim, /%~dp0\.\.\\runtime\\node\.exe/i);
  assert.match(shim, /@lobehub\\cli\\dist\\index\.js/i);
  assert.match(shim, /IF \/I "%~1"=="connect" IF "%~2"=="" GOTO connector/i);
  assert.match(shim, /LOBEHUB_DEVICE_GATEWAY=https:\/\/ai\.forcome\.com\/device-gateway/i);
  assert.doesNotMatch(shim, /C:\\Users\\/i);
  assert.doesNotMatch(shim, /AppData\\Local\\ForcomeAI/i);
});

test('starts the CLI service host with a fixed argument array and shell disabled', () => {
  let invocation;
  const child = new EventEmitter();
  child.pid = 43210;
  const manager = new ForcomeCliManager({
    appRoot: root,
    resourcesPath: '',
    isPackaged: false,
    fsImpl: bundledFs,
    spawnImpl: (file, args, options) => { invocation = { file, args, options }; return child; }
  });
  const result = manager.startConnector();
  assert.deepEqual(result, { ok: true, pid: 43210 });
  assert.equal(invocation.file, manager.paths.tray);
  assert.deepEqual(invocation.args, ['--service']);
  assert.equal(invocation.options.shell, false);
  assert.equal(invocation.options.windowsHide, true);
});

test('starts browser login through the CLI without launching its second visual tray', () => {
  let invocation;
  const child = new EventEmitter();
  child.pid = 43211;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  const manager = new ForcomeCliManager({
    appRoot: root,
    resourcesPath: '',
    isPackaged: false,
    fsImpl: bundledFs,
    spawnImpl: (file, args, options) => { invocation = { file, args, options }; return child; }
  });
  const result = manager.startLogin();
  assert.deepEqual(result, { ok: true, pid: 43211 });
  assert.equal(invocation.file, manager.paths.node);
  assert.deepEqual(invocation.args, [manager.paths.entry, 'login']);
  assert.equal(invocation.options.shell, false);
  assert.equal(invocation.options.windowsHide, true);
  assert.ok(!invocation.args.includes('--show'));
});
