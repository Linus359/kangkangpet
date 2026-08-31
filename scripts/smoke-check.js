'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const required = [
  'main.js',
  'pet.html',
  'panel.html',
  'quick-reminder.html',
  'preload/pet-preload.js',
  'preload/panel-preload.js',
  'preload/quick-reminder-preload.js',
  'src/main/reminders.js',
  'src/main/reminder-scheduler.js',
  'assets/cat',
  'build/face.ico'
];

const missing = required.filter((file) => !fs.existsSync(path.join(root, file)));
if (missing.length) {
  console.error(`Smoke check failed. Missing: ${missing.join(', ')}`);
  process.exit(1);
}

const assetCount = fs.readdirSync(path.join(root, 'assets', 'cat'))
  .filter((file) => /\.(png|jpe?g|webp|gif|webm|mp4|mov)$/i.test(file)).length;
if (!assetCount) {
  console.error('Smoke check failed. No bundled pet assets found.');
  process.exit(1);
}

console.log(`Smoke check passed: ${assetCount} bundled assets and required runtime files are present.`);
