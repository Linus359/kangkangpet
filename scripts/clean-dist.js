'use strict';

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const distDir = path.join(root, 'dist');
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const currentPortableDirectory = `kangkangpet-portable-${packageJson.version}`;
const currentArtifacts = new Set([
  `kangkangpet-setup-${packageJson.version}.exe`,
  `kangkangpet-setup-${packageJson.version}.exe.blockmap`,
  'latest.yml'
]);

if (fs.existsSync(distDir)) {
  for (const entry of fs.readdirSync(distDir, { withFileTypes: true })) {
    if (entry.name === 'cli' || entry.name === currentPortableDirectory || currentArtifacts.has(entry.name)) continue;
    fs.rmSync(path.join(distDir, entry.name), { recursive: true, force: true });
  }
}

console.log(`dist cleanup complete: kept dist/cli and ${packageJson.version} installer artifacts.`);
