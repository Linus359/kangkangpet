'use strict';

const fs = require('fs');
const path = require('path');

const OPTIONAL_RUNTIME_FILES = Object.freeze([
  'dxcompiler.dll',
  'dxil.dll',
  'vk_swiftshader.dll',
  'vk_swiftshader_icd.json',
  'vulkan-1.dll'
]);

module.exports = async function stripOptionalElectronRuntime(context) {
  if (context?.electronPlatformName !== 'win32' || !context.appOutDir) return;
  for (const fileName of OPTIONAL_RUNTIME_FILES) {
    fs.rmSync(path.join(context.appOutDir, fileName), { force: true });
  }
};

module.exports.OPTIONAL_RUNTIME_FILES = OPTIONAL_RUNTIME_FILES;
