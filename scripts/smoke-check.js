'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const required = [
  'main.js',
  'pet.html',
  'panel.html',
  'quick-reminder.html',
  'note.html',
  'preload/pet-preload.js',
  'preload/panel-preload.js',
  'preload/quick-reminder-preload.js',
  'preload/note-preload.js',
  'src/main/reminders.js',
  'src/main/reminder-scheduler.js',
  'src/main/notes-store.js',
  'src/main/pwa-launcher.js',
  'src/main/forcome-cli.js',
  'src/main/holiday-service.js',
  'src/main/us-holiday-service.js',
  'assets/cat',
  'dist/cli/runtime/node.exe',
  'dist/cli/cli/node_modules/@forcome/ai-cli/bin/fai.js',
  'dist/cli/ForcomeAiTray.exe',
  'dist/cli/assets/forcome.ico',
  'dist/cli/assets/forcomelogo.png'
];

const missing = required.filter((file) => !fs.existsSync(path.join(root, file)));
if (missing.length) {
  console.error(`Smoke check failed. Missing: ${missing.join(', ')}`);
  process.exit(1);
}

const panel = fs.readFileSync(path.join(root, 'panel.html'), 'utf8');
const calendarViews = [...panel.matchAll(/data-calendar-view="([^"]+)"[^>]*>([^<]+)</g)]
  .map((match) => [match[1], match[2].trim()]);
const expectedCalendarViews = [['year', '年'], ['month', '月'], ['week', '周'], ['day', '日']];
if (JSON.stringify(calendarViews) !== JSON.stringify(expectedCalendarViews)) {
  console.error(`Smoke check failed. Calendar views must be 年/月/周/日: ${JSON.stringify(calendarViews)}`);
  process.exit(1);
}
if (panel.includes('小方块') || panel.includes('长条') || panel.includes('当日')) {
  console.error('Smoke check failed. Calendar view labels must remain 年/月/周/日.');
  process.exit(1);
}
if (!panel.includes('中国法定节假日') || !panel.includes('调休补班') || !panel.includes('美国联邦节假日') || panel.includes('国家 / 地区（可多选）')) {
  console.error('Smoke check failed. Calendar must use the simplified official China holiday schedule.');
  process.exit(1);
}
if (!panel.includes('免打扰模式') || panel.includes('启用轻拍反馈')) {
  console.error('Smoke check failed. Pet settings must expose do-not-disturb instead of tap feedback.');
  process.exit(1);
}

const assetCount = fs.readdirSync(path.join(root, 'assets', 'cat'))
  .filter((file) => /\.(png|jpe?g|webp|gif|webm|mp4|mov)$/i.test(file)).length;
if (!assetCount) {
  console.error('Smoke check failed. No bundled pet assets found.');
  process.exit(1);
}

console.log(`Smoke check passed: ${assetCount} bundled assets and required runtime files are present.`);
