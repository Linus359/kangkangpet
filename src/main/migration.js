'use strict';

const { normalizeReminders } = require('./reminders');

function extractLegacyReminders(payload) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== 'object') return [];
  if (Array.isArray(payload.reminders)) return payload.reminders;
  if (Array.isArray(payload.reminder_groups)) {
    return payload.reminder_groups.flatMap((group) => {
      const rules = Array.isArray(group?.rules) ? group.rules : Array.isArray(group?.items) ? group.items : Array.isArray(group?.reminders) ? group.reminders : [];
      return rules.map((rule, index) => ({
        ...group,
        ...rule,
        title: rules.length > 1 ? `${group?.title || '未命名提醒'} - 规则 ${index + 1}` : group?.title || rule?.title,
        message: group?.note || group?.message || rule?.note || rule?.message
      }));
    });
  }
  return [];
}

function migrateLegacyPayload(payload, now = new Date()) {
  return normalizeReminders(extractLegacyReminders(payload), now);
}

module.exports = { extractLegacyReminders, migrateLegacyPayload };
