'use strict';

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const distDir = path.join(root, 'dist');
const setupArchiveDir = path.join(distDir, 'setups');
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const currentPortableDirectory = `kangkangpet-portable-${packageJson.version}`;
const currentArtifacts = new Set([
  `kangkangpet-setup-${packageJson.version}.exe`,
  `kangkangpet-setup-${packageJson.version}.exe.blockmap`,
  'latest.yml'
]);
const setupPattern = /^kangkangpet-setup-(\d+\.\d+\.\d+)\.exe(?:\.blockmap)?$/;

function archiveHistoricalSetup(entry) {
  const match = entry.name.match(setupPattern);
  if (!match || match[1] === packageJson.version) return false;

  const versionDir = path.join(setupArchiveDir, match[1]);
  fs.mkdirSync(versionDir, { recursive: true });
  const destination = path.join(versionDir, entry.name);
  if (fs.existsSync(destination)) fs.rmSync(destination, { force: true });
  fs.renameSync(path.join(distDir, entry.name), destination);
  return true;
}

function removeEmptyDirectories(directory) {
  if (!fs.existsSync(directory)) return;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) removeEmptyDirectories(path.join(directory, entry.name));
  }
  if (fs.readdirSync(directory).length === 0 && directory !== setupArchiveDir) fs.rmdirSync(directory);
}

if (fs.existsSync(distDir)) {
  for (const entry of fs.readdirSync(distDir, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    if (archiveHistoricalSetup(entry)) continue;
  }

  for (const entry of fs.readdirSync(distDir, { withFileTypes: true })) {
    if (entry.name === 'cli' || entry.name === 'setups' || entry.name === currentPortableDirectory || currentArtifacts.has(entry.name)) continue;
    fs.rmSync(path.join(distDir, entry.name), { recursive: true, force: true });
  }

  removeEmptyDirectories(setupArchiveDir);
}

console.log(`dist cleanup complete: kept dist/cli, dist/setups, and ${packageJson.version} installer artifacts.`);
