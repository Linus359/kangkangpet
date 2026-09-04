'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const NOTE_VERSION = 2;
const MIN_NOTE_WIDTH = 240;
const MIN_NOTE_HEIGHT = 180;
const MAX_NOTE_WIDTH = 900;
const MAX_NOTE_HEIGHT = 900;

function finite(value, fallback) {
  if (value === null || value === undefined || value === '') return fallback;
  return Number.isFinite(Number(value)) ? Math.round(Number(value)) : fallback;
}

function text(value, fallback, maximum) {
  const next = typeof value === 'string' ? value : fallback;
  return next.slice(0, maximum);
}

function iso(value, fallback) {
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : fallback;
}

function dateKey(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function normalizeSubtask(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const title = text(value.title, '', 240).trim();
  if (!title) return null;
  return { id: text(value.id, crypto.randomUUID(), 160) || crypto.randomUUID(), title, completed: value.completed === true };
}

function normalizeTask(value, today) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const title = text(value.title, '', 240).trim();
  if (!title) return null;
  const repeat = value.repeat === 'daily' ? 'daily' : 'none';
  const lastResetDate = /^\d{4}-\d{2}-\d{2}$/.test(String(value.lastResetDate || '')) ? String(value.lastResetDate) : today;
  const needsReset = repeat === 'daily' && lastResetDate !== today;
  return {
    id: text(value.id, crypto.randomUUID(), 160) || crypto.randomUUID(),
    title,
    priority: ['low', 'normal', 'high'].includes(value.priority) ? value.priority : 'normal',
    repeat,
    completed: needsReset ? false : value.completed === true,
    subtasks: (Array.isArray(value.subtasks) ? value.subtasks : []).map(normalizeSubtask).filter(Boolean).map((item) => needsReset ? { ...item, completed: false } : item),
    lastResetDate: repeat === 'daily' ? today : lastResetDate
  };
}

function normalizeNote(value, now = new Date().toISOString()) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const createdAt = iso(value.createdAt, now);
  const today = dateKey(now) || dateKey(new Date());
  return {
    id: text(value.id, crypto.randomUUID(), 160) || crypto.randomUUID(),
    title: text(value.title, '未命名便利贴', 120) || '未命名便利贴',
    content: text(value.content, '', 20000),
    mode: value.mode === 'tasks' ? 'tasks' : 'note',
    tasks: (Array.isArray(value.tasks) ? value.tasks : []).map((item) => normalizeTask(item, today)).filter(Boolean),
    x: finite(value.x, null),
    y: finite(value.y, null),
    width: Math.min(MAX_NOTE_WIDTH, Math.max(MIN_NOTE_WIDTH, finite(value.width, 320))),
    height: Math.min(MAX_NOTE_HEIGHT, Math.max(MIN_NOTE_HEIGHT, finite(value.height, 260))),
    alwaysOnTop: value.alwaysOnTop === true,
    visible: value.visible !== false,
    createdAt,
    updatedAt: iso(value.updatedAt, createdAt)
  };
}

function normalizePayload(value) {
  const rawNotes = Array.isArray(value?.notes) ? value.notes : [];
  const ids = new Set();
  const notes = rawNotes.map((item) => normalizeNote(item)).filter((item) => {
    if (!item || ids.has(item.id)) return false;
    ids.add(item.id);
    return true;
  });
  return { version: NOTE_VERSION, notes };
}

class NotesStore {
  constructor(filePath, { log = () => {} } = {}) {
    this.filePath = filePath;
    this.log = log;
  }

  load() {
    try {
      if (!fs.existsSync(this.filePath)) return normalizePayload({});
      const source = fs.readFileSync(this.filePath, 'utf8').trim();
      return normalizePayload(source ? JSON.parse(source) : {});
    } catch (error) {
      const backup = `${this.filePath}.corrupt-${Date.now()}.bak`;
      try { if (fs.existsSync(this.filePath)) fs.copyFileSync(this.filePath, backup); } catch (backupError) { this.log('备份损坏便利贴数据失败。', backupError); }
      this.log(`便利贴数据读取失败，已保留备份：${backup}`, error);
      return normalizePayload({});
    }
  }

  save(payload) {
    const normalized = normalizePayload(payload);
    const temporaryPath = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    try {
      fs.writeFileSync(temporaryPath, JSON.stringify(normalized, null, 2), { encoding: 'utf8', mode: 0o600 });
      fs.renameSync(temporaryPath, this.filePath);
    } catch (error) {
      try { fs.rmSync(temporaryPath, { force: true }); } catch (_) {}
      this.log('便利贴数据保存失败。', error);
      throw error;
    }
    return normalized;
  }
}

module.exports = { NOTE_VERSION, MIN_NOTE_WIDTH, MIN_NOTE_HEIGHT, dateKey, normalizeSubtask, normalizeTask, normalizeNote, normalizePayload, NotesStore };
