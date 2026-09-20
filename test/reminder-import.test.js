'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  classifyReminderFile,
  extensionForName,
  mediaTypeForExtension,
  sourceMetadata
} = require('../src/main/reminder-import');

test('classifies reminder import files without relying on renderer state', () => {
  assert.equal(extensionForName('会议.XLSX'), '.xlsx');
  assert.equal(classifyReminderFile('日程.csv'), 'csv');
  assert.equal(classifyReminderFile('会议.txt'), 'text');
  assert.equal(classifyReminderFile('截图.png'), 'media');
  assert.equal(classifyReminderFile('录音.m4a'), 'media');
  assert.equal(classifyReminderFile('未知.bin'), null);
});

test('maps media extensions and preserves bounded source metadata', () => {
  assert.equal(mediaTypeForExtension('.mp4'), 'video');
  assert.equal(mediaTypeForExtension('.wav'), 'audio');
  assert.equal(mediaTypeForExtension('.jpg'), 'image');
  const source = sourceMetadata('audio', '会议录音.m4a', 'C:/media/会议录音.m4a', '会议内容');
  assert.deepEqual(source, { type: 'audio', name: '会议录音.m4a', path: 'C:/media/会议录音.m4a', text: '会议内容' });
});
