'use strict';

const { nextTriggerAt } = require('./reminders');

const DEFAULT_GRACE_MS = 5 * 60 * 1000;
const CLOCK_CHECK_MS = 5 * 60 * 1000;
const MAX_TIMEOUT_MS = 2147483647;

function parseIso(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

class ReminderScheduler {
  constructor({ getReminders, saveReminders, notify, log, graceMs = DEFAULT_GRACE_MS, now = () => new Date() }) {
    this.getReminders = getReminders;
    this.saveReminders = saveReminders;
    this.notify = notify;
    this.log = log || (() => {});
    this.graceMs = graceMs;
    this.now = now;
    this.timer = null;
    this.running = false;
    this.lastClockAt = null;
  }

  start() {
    this.running = true;
    this.reschedule('startup');
  }

  stop() {
    this.running = false;
    clearTimeout(this.timer);
    this.timer = null;
  }

  async reschedule(reason = 'configuration') {
    if (!this.running) return;
    clearTimeout(this.timer);
    this.timer = null;
    const now = this.now();
    const reminders = this.getReminders();
    let changed = false;
    let earliest = null;

    for (const reminder of reminders) {
      if (!reminder.enabled) {
        if (reminder.nextTriggerAt) {
          reminder.nextTriggerAt = null;
          changed = true;
        }
        continue;
      }
      const persisted = parseIso(reminder.nextTriggerAt);
      if (!persisted) {
        reminder.nextTriggerAt = nextTriggerAt(reminder, now)?.toISOString() || null;
        changed = true;
      } else if (persisted.getTime() < now.getTime() - this.graceMs) {
        reminder.nextTriggerAt = nextTriggerAt(reminder, now)?.toISOString() || null;
        changed = true;
      }
      const scheduled = parseIso(reminder.nextTriggerAt);
      if (scheduled && (!earliest || scheduled < earliest)) earliest = scheduled;
    }

    if (changed) this.saveReminders(reason);
    await this.scheduleNext(earliest, now);
  }

  async scheduleNext(earliest, now) {
    if (!this.running) return;
    const clockCheckAt = new Date(now.getTime() + CLOCK_CHECK_MS);
    const dueAt = earliest && earliest < clockCheckAt ? earliest : clockCheckAt;
    const delay = Math.max(0, Math.min(MAX_TIMEOUT_MS, dueAt.getTime() - now.getTime()));
    this.lastClockAt = now.getTime();
    this.timer = setTimeout(() => {
      this.runDueCheck().catch((error) => this.log('提醒调度失败', error));
    }, delay + 20);
  }

  async runDueCheck() {
    if (!this.running) return;
    const now = this.now();
    const reminders = this.getReminders();
    let changed = false;

    for (const reminder of reminders) {
      if (!reminder.enabled) continue;
      const scheduled = parseIso(reminder.nextTriggerAt);
      if (!scheduled) continue;
      const delay = now.getTime() - scheduled.getTime();
      if (delay < 0) continue;
      if (delay > this.graceMs) {
        reminder.nextTriggerAt = nextTriggerAt(reminder, now)?.toISOString() || null;
        changed = true;
        continue;
      }
      if (reminder.lastTriggeredAt === scheduled.toISOString()) continue;

      reminder.lastTriggeredAt = scheduled.toISOString();
      reminder.updatedAt = now.toISOString();
      if (reminder.repeat === 'once') {
        reminder.enabled = false;
        reminder.nextTriggerAt = null;
      } else {
        reminder.nextTriggerAt = nextTriggerAt(reminder, new Date(now.getTime() + 1000))?.toISOString() || null;
      }
      changed = true;
      try {
        await this.notify({ ...reminder, triggeredAt: now.toISOString(), scheduledAt: scheduled.toISOString() });
      } catch (error) {
        this.log(`提醒通知失败：${reminder.id}`, error);
      }
    }

    if (changed) this.saveReminders('triggered');
    await this.reschedule('timer');
  }
}

module.exports = { CLOCK_CHECK_MS, DEFAULT_GRACE_MS, ReminderScheduler };
