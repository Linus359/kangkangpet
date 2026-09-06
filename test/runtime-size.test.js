'use strict';

const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const stripOptionalElectronRuntime = require('../scripts/strip-optional-electron-runtime');

test('packaging removes only explicitly disabled WebGPU and Vulkan runtime files', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'kangkang-runtime-'));
  const keep = path.join(directory, 'libGLESv2.dll');
  fs.writeFileSync(keep, 'keep');
  for (const fileName of stripOptionalElectronRuntime.OPTIONAL_RUNTIME_FILES) fs.writeFileSync(path.join(directory, fileName), 'remove');
  await stripOptionalElectronRuntime({ electronPlatformName: 'win32', appOutDir: directory });
  assert.equal(fs.existsSync(keep), true);
  for (const fileName of stripOptionalElectronRuntime.OPTIONAL_RUNTIME_FILES) assert.equal(fs.existsSync(path.join(directory, fileName)), false);
  fs.rmSync(directory, { recursive: true, force: true });
});
