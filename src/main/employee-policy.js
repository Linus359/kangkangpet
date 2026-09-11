'use strict';

const fs = require('fs');
const http = require('http');
const https = require('https');
const crypto = require('crypto');

const DEFAULT_DIFY_BASE_URL = 'http://dify.forcome.com/v1';
const DIFY_QUERY = 'KANGKANGPET_RULE_SYNC_V1\n请从员工守则知识库检索并整理5-8条工作日桌宠提醒，覆盖考勤与假期、报销与差旅、信息安全与保密、办公环境与公共区域、新员工须知等分类。每个有明确知识库依据的分类至少生成1条；新员工相关规则的ruleKey必须以new_staff_开头。在不挤占上述分类覆盖的前提下，优先额外生成2-3条有知识库依据、面向全员且非新员工主题的轻量日常小贴士，ruleKey必须以tip_开头。提醒时间安排在09:00-18:00之间，分散到非整点时刻，避免全部集中在整点。只返回一个JSON对象，不要解释、markdown或前后缀，格式为{"schemaVersion":1,"policyVersion":"日期","reminders":[{"ruleKey":"英文标识","time":"HH:mm","weekdays":[0,1,2,3,4],"title":"标题","message":"提醒内容","enabled":true}],"warnings":[]}。知识库缺少某分类、日常小贴士依据不足或无法确认的内容时写入warnings，不要编造。';
const DIFY_USER = 'kangkangpet-rule-sync';
const DEFAULT_TIMEOUT_MS = 10 * 1000;
const DEFAULT_MAX_RESPONSE_BYTES = 256 * 1024;
const EMPLOYEE_POLICY_MANAGER = 'employee-policy';

const DEFAULT_EMPLOYEE_POLICY = {
  schemaVersion: 1,
  policyVersion: 'example-pending-hr-2026-08-01',
  reminders: [
    { ruleKey: 'workday-start', time: '09:00', weekdays: [0, 1, 2, 3, 4], title: '上班前提醒（示例）', message: '示例文案，待 HR 审核后替换为正式员工守则内容。', enabled: true },
    { ruleKey: 'workday-lunch', time: '12:00', weekdays: [0, 1, 2, 3, 4], title: '午餐与公共区域提醒（示例）', message: '示例文案，待 HR 审核后替换为正式员工守则内容。', enabled: true },
    { ruleKey: 'workday-end', time: '18:00', weekdays: [0, 1, 2, 3, 4], title: '下班前收尾提醒（示例）', message: '示例文案，待 HR 审核后替换为正式员工守则内容。', enabled: true }
  ],
  warnings: ['内置内容仅为示例，待 HR 审核。']
};

const DEFAULT_EMPLOYEE_POLICY_SETTINGS = {
  enabled: true,
  sprinkleEnabled: true,
  sourceMode: 'dify',
  baseUrl: DEFAULT_DIFY_BASE_URL,
  allowInsecureHttp: true,
  currentSource: 'builtin',
  currentPolicyVersion: DEFAULT_EMPLOYEE_POLICY.policyVersion,
  lastSuccessAt: null,
  lastAttemptAt: null,
  errorCode: null
};

class PolicySyncError extends Error {
  constructor(code) {
    super(code);
    this.name = 'PolicySyncError';
    this.code = code;
  }
}

function characterLength(value) {
  return [...String(value)].length;
}

function policyError(code) {
  return new PolicySyncError(code);
}

function normalizePolicySettings(value = {}) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return {
    ...DEFAULT_EMPLOYEE_POLICY_SETTINGS,
    ...source,
    enabled: source.enabled !== false,
    sprinkleEnabled: source.sprinkleEnabled !== false,
    sourceMode: source.sourceMode === 'local' ? 'local' : 'dify',
    baseUrl: typeof source.baseUrl === 'string' && source.baseUrl.trim() ? source.baseUrl.trim().slice(0, 500) : DEFAULT_DIFY_BASE_URL,
    allowInsecureHttp: source.allowInsecureHttp === true,
    currentSource: ['dify', 'local', 'builtin'].includes(source.currentSource) ? source.currentSource : DEFAULT_EMPLOYEE_POLICY_SETTINGS.currentSource,
    currentPolicyVersion: typeof source.currentPolicyVersion === 'string' ? source.currentPolicyVersion.slice(0, 80) : DEFAULT_EMPLOYEE_POLICY_SETTINGS.currentPolicyVersion,
    lastSuccessAt: typeof source.lastSuccessAt === 'string' ? source.lastSuccessAt : null,
    lastAttemptAt: typeof source.lastAttemptAt === 'string' ? source.lastAttemptAt : null,
    errorCode: typeof source.errorCode === 'string' ? source.errorCode.slice(0, 64) : null
  };
}

function validatePolicy(value) {
  const errors = [];
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { valid: false, errors: ['policy-object'] };
  if (value.schemaVersion !== 1 || typeof value.schemaVersion !== 'number') errors.push('schemaVersion');
  if (typeof value.policyVersion !== 'string' || !value.policyVersion.trim() || characterLength(value.policyVersion) > 80) errors.push('policyVersion');
  if (!Array.isArray(value.reminders) || value.reminders.length < 1 || value.reminders.length > 50) errors.push('reminders');
  if (!Array.isArray(value.warnings) || value.warnings.length > 20 || value.warnings.some((item) => typeof item !== 'string' || characterLength(item) > 240)) errors.push('warnings');

  const keys = new Set();
  for (const reminder of Array.isArray(value.reminders) ? value.reminders : []) {
    if (!reminder || typeof reminder !== 'object' || Array.isArray(reminder)) { errors.push('reminder-object'); continue; }
    if (typeof reminder.ruleKey !== 'string' || !/^[a-z0-9_-]{1,64}$/.test(reminder.ruleKey) || keys.has(reminder.ruleKey)) errors.push('ruleKey');
    keys.add(reminder.ruleKey);
    if (typeof reminder.time !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(reminder.time)) errors.push('time');
    if (!Array.isArray(reminder.weekdays) || !reminder.weekdays.length || new Set(reminder.weekdays).size !== reminder.weekdays.length || reminder.weekdays.some((day) => !Number.isInteger(day) || day < 0 || day > 6)) errors.push('weekdays');
    if (typeof reminder.title !== 'string' || !reminder.title.trim() || characterLength(reminder.title) > 30) errors.push('title');
    if (typeof reminder.message !== 'string' || !reminder.message.trim() || characterLength(reminder.message) > 240) errors.push('message');
    if (typeof reminder.enabled !== 'boolean') errors.push('enabled');
  }
  return { valid: errors.length === 0, errors };
}

function normalizePolicy(value) {
  const result = validatePolicy(value);
  if (!result.valid) throw policyError('invalid-policy');
  return {
    schemaVersion: 1,
    policyVersion: value.policyVersion,
    reminders: value.reminders.map((item) => ({
      ruleKey: item.ruleKey,
      time: item.time,
      weekdays: [...item.weekdays],
      title: item.title.trim(),
      message: item.message.trim(),
      enabled: item.enabled
    })),
    warnings: value.warnings.map((item) => item.trim())
  };
}

function parseDifyAnswer(answer) {
  if (typeof answer !== 'string') throw policyError('invalid-answer');
  const text = answer.trim();
  let jsonText = text;
  const fenced = text.match(/^```json\r?\n([\s\S]*?)\r?\n```$/);
  if (fenced) jsonText = fenced[1];
  else if (text.startsWith('```') || text.includes('```')) throw policyError('invalid-answer');
  let value;
  try { value = JSON.parse(jsonText); } catch { throw policyError('invalid-answer'); }
  try { return normalizePolicy(value); } catch { throw policyError('invalid-policy'); }
}

function policyRevision(policy) {
  return crypto.createHash('sha256').update(JSON.stringify(normalizePolicy(policy))).digest('hex').slice(0, 16);
}

function readPolicyFile(filePath) {
  try {
    if (!filePath || !fs.existsSync(filePath)) return null;
    return normalizePolicy(JSON.parse(fs.readFileSync(filePath, 'utf8')));
  } catch {
    return null;
  }
}

function loadEffectivePolicy({ sourceMode = 'dify', cachePath, localPath, defaultsPath }) {
  const candidates = sourceMode === 'local'
    ? [['local', readPolicyFile(localPath)], ['builtin', readPolicyFile(defaultsPath) || normalizePolicy(DEFAULT_EMPLOYEE_POLICY)]]
    : [['dify', readPolicyFile(cachePath)], ['local', readPolicyFile(localPath)], ['builtin', readPolicyFile(defaultsPath) || normalizePolicy(DEFAULT_EMPLOYEE_POLICY)]];
  const selected = candidates.find(([, policy]) => policy);
  return { sourceKind: selected[0], policy: selected[1], sourceRevision: policyRevision(selected[1]) };
}

function writeJsonAtomic(filePath, value) {
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.mkdirSync(require('path').dirname(filePath), { recursive: true });
  try {
    fs.writeFileSync(temporaryPath, JSON.stringify(value, null, 2), { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(temporaryPath, filePath);
  } catch (error) {
    try { fs.rmSync(temporaryPath, { force: true }); } catch {}
    throw error;
  }
}

function requestDify(url, { body, apiKey, timeoutMs = DEFAULT_TIMEOUT_MS, maxResponseBytes = DEFAULT_MAX_RESPONSE_BYTES, signal } = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const transport = parsed.protocol === 'https:' ? https : http;
    let settled = false;
    let received = 0;
    const finish = (error, value) => { if (settled) return; settled = true; signal?.removeEventListener('abort', onAbort); error ? reject(error) : resolve(value); };
    const onAbort = () => { request.destroy(); finish(policyError('network-error')); };
    const request = transport.request(parsed, { method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } }, (response) => {
      if (Number(response.headers['content-length']) > maxResponseBytes) { request.destroy(); finish(policyError('response-too-large')); return; }
      const chunks = [];
      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        received += Buffer.byteLength(chunk);
        if (received > maxResponseBytes) { request.destroy(); finish(policyError('response-too-large')); return; }
        chunks.push(chunk);
      });
      response.on('end', () => finish(null, { statusCode: response.statusCode, body: chunks.join('') }));
      response.on('error', () => finish(policyError('network-error')));
    });
    request.setTimeout(timeoutMs, () => { request.destroy(); finish(policyError('timeout')); });
    request.on('error', () => finish(policyError('network-error')));
    if (signal) {
      if (signal.aborted) return onAbort();
      signal.addEventListener('abort', onAbort, { once: true });
    }
    request.write(body);
    request.end();
  });
}

async function syncDifyPolicy({ baseUrl, allowInsecureHttp = false, apiKey, signal, request = requestDify, timeoutMs = DEFAULT_TIMEOUT_MS, maxResponseBytes = DEFAULT_MAX_RESPONSE_BYTES } = {}) {
  let parsed;
  try { parsed = new URL(String(baseUrl || '')); } catch { throw policyError('network-error'); }
  if (!['http:', 'https:'].includes(parsed.protocol)) throw policyError('network-error');
  if (parsed.protocol === 'http:' && allowInsecureHttp !== true) throw policyError('insecure-http-blocked');
  if (typeof apiKey !== 'string' || !apiKey.trim()) throw policyError('missing-credential');
  const endpoint = `${String(baseUrl).replace(/\/$/, '')}/chat-messages`;
  const body = JSON.stringify({ inputs: {}, query: DIFY_QUERY, response_mode: 'blocking', conversation_id: '', user: DIFY_USER });
  const response = await request(endpoint, { body, apiKey: apiKey.trim(), signal, timeoutMs, maxResponseBytes });
  if (response.statusCode < 200 || response.statusCode >= 300) throw policyError(`http-${response.statusCode}`);
  let payload;
  try { payload = JSON.parse(response.body); } catch { throw policyError('invalid-answer'); }
  if (!Object.prototype.hasOwnProperty.call(payload, 'answer') || typeof payload.answer !== 'string') throw policyError('invalid-answer');
  return { policy: parseDifyAnswer(payload.answer), rawBytes: Buffer.byteLength(response.body) };
}

function mergeEmployeePolicyReminders(existing, policy, { sourceKind, sourceRevision, now = new Date() } = {}) {
  const current = Array.isArray(existing) ? existing.map((item) => ({ ...item })) : [];
  const managed = new Map(current.filter((item) => item?.managedBy === EMPLOYEE_POLICY_MANAGER).map((item) => [item.sourceRuleId || String(item.id).replace(/^employee-policy:/, ''), item]));
  const next = current.filter((item) => item?.managedBy !== EMPLOYEE_POLICY_MANAGER);
  const baseOrder = current.reduce((max, item) => Math.max(max, Number(item.sortOrder) || 0), -1) + 1;
  policy.reminders.forEach((rule, index) => {
    const old = managed.get(rule.ruleKey);
    const sameSchedule = old && old.time === rule.time && JSON.stringify(old.weekdays || []) === JSON.stringify([...rule.weekdays].sort((a, b) => a - b));
    const reminder = {
      ...(old || {}),
      id: `employee-policy:${rule.ruleKey}`,
      title: rule.title,
      message: rule.message,
      enabled: rule.enabled,
      repeat: 'custom',
      time: rule.time,
      date: '',
      weekdays: [...rule.weekdays].sort((a, b) => a - b),
      intervalMinutes: null,
      notificationMode: 'bubble',
      reminderOffsetMinutes: 0,
      strongReminder: false,
      source: null,
      managedBy: EMPLOYEE_POLICY_MANAGER,
      sourceRuleId: rule.ruleKey,
      sourceKind,
      sourceRevision,
      createdAt: old?.createdAt || now.toISOString(),
      updatedAt: now.toISOString(),
      sortOrder: old?.sortOrder ?? baseOrder + index,
      lastTriggeredAt: old?.lastTriggeredAt || null,
      nextTriggerAt: sameSchedule && old.enabled === rule.enabled ? old.nextTriggerAt || null : null,
      intervalAnchorAt: old?.intervalAnchorAt || now.toISOString()
    };
    next.push(reminder);
  });
  return next;
}

module.exports = {
  DEFAULT_DIFY_BASE_URL,
  DEFAULT_EMPLOYEE_POLICY,
  DEFAULT_EMPLOYEE_POLICY_SETTINGS,
  DEFAULT_MAX_RESPONSE_BYTES,
  DEFAULT_TIMEOUT_MS,
  DIFY_QUERY,
  EMPLOYEE_POLICY_MANAGER,
  PolicySyncError,
  loadEffectivePolicy,
  mergeEmployeePolicyReminders,
  normalizePolicy,
  normalizePolicySettings,
  parseDifyAnswer,
  policyRevision,
  requestDify,
  syncDifyPolicy,
  validatePolicy,
  writeJsonAtomic
};
