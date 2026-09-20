'use strict';

const path = require('path');

const REMINDER_MEDIA_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.webp', '.gif',
  '.mp3', '.wav', '.m4a', '.aac', '.ogg', '.flac',
  '.webm', '.mp4', '.mov'
]);
const REMINDER_TEXT_EXTENSIONS = new Set(['.txt', '.md', '.log']);
const REMINDER_DATA_EXTENSIONS = new Set(['.json', '.csv', '.xlsx']);

function extensionForName(name) {
  return path.extname(String(name || '')).toLowerCase();
}

function classifyReminderFile(name) {
  const extension = extensionForName(name);
  if (REMINDER_MEDIA_EXTENSIONS.has(extension)) return 'media';
  if (REMINDER_TEXT_EXTENSIONS.has(extension)) return 'text';
  if (REMINDER_DATA_EXTENSIONS.has(extension)) return extension.slice(1);
  return null;
}

function sourceMetadata(type, name, filePath = '', text = '') {
  return {
    type: ['image', 'audio', 'video', 'text'].includes(type) ? type : 'text',
    name: String(name || '').trim().slice(0, 240),
    path: String(filePath || '').slice(0, 2000),
    text: String(text || '').trim().slice(0, 4000)
  };
}

function mediaTypeForExtension(extension) {
  const normalized = String(extension || '').toLowerCase();
  if (['.mp3', '.wav', '.m4a', '.aac', '.ogg', '.flac'].includes(normalized)) return 'audio';
  if (['.webm', '.mp4', '.mov'].includes(normalized)) return 'video';
  return 'image';
}

module.exports = {
  REMINDER_DATA_EXTENSIONS,
  REMINDER_MEDIA_EXTENSIONS,
  REMINDER_TEXT_EXTENSIONS,
  classifyReminderFile,
  extensionForName,
  mediaTypeForExtension,
  sourceMetadata
};
