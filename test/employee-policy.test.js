'use strict';

const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  DEFAULT_EMPLOYEE_POLICY,
  loadEffectivePolicy,
  mergeEmployeePolicyReminders,
  parseDifyAnswer,
  syncDifyPolicy,
  validatePolicy
} = require('../src/main/employee-policy');

const root = path.join(__dirname, '..');
const valid = JSON.parse(JSON.stringify(DEFAULT_EMPLOYEE_POLICY));

test('parses a valid employee policy and both supported answer forms', () => {
  assert.equal(validatePolicy(valid).valid, true);
  assert.deepEqual(parseDifyAnswer(JSON.stringify(valid)), valid);
  assert.deepEqual(parseDifyAnswer(`\`\`\`json\n${JSON.stringify(valid)}\n\`\`\``), valid);
  assert.throws(() => parseDifyAnswer(`说明\n${JSON.stringify(valid)}`), /invalid-answer/);
  assert.throws(() => parseDifyAnswer(`\`\`json\n${JSON.stringify(valid)}\n\`\`\`\n说明`), /invalid-answer/);
});

test('rejects invalid policy fields as a whole snapshot', () => {
  const cases = [
    ['time', (item) => { item.time = '9:00'; }],
    ['duplicate ruleKey', (item, policy) => { policy.reminders[1].ruleKey = policy.reminders[0].ruleKey; }],
    ['empty message', (item) => { item.message = '   '; }],
    ['invalid weekdays', (item) => { item.weekdays = [0, 7]; }],
    ['wrong enabled type', (item) => { item.enabled = 'true'; }],
    ['long title', (item) => { item.title = 'x'.repeat(31); }],
    ['long message', (item) => { item.message = 'x'.repeat(241); }],
    ['empty reminders', (_item, policy) => { policy.reminders = []; }]
  ];
  for (const [label, mutate] of cases) {
    const policy = JSON.parse(JSON.stringify(valid));
    mutate(policy.reminders[0], policy);
    assert.equal(validatePolicy(policy).valid, false, label);
    assert.throws(() => parseDifyAnswer(JSON.stringify(policy)), /invalid-policy/);
  }
});

test('maps Dify failures to redacted stable error codes', async () => {
  const run = (options) => syncDifyPolicy({ baseUrl: 'https://example.test/v1', apiKey: 'test-only-secret', request: async () => options });
  await assert.rejects(run({ statusCode: 401, body: '{}' }), (error) => error.code === 'http-401');
  await assert.rejects(run({ statusCode: 500, body: '{}' }), (error) => error.code === 'http-500');
  await assert.rejects(syncDifyPolicy({ baseUrl: 'https://example.test/v1', apiKey: 'test-only-secret', request: async () => { throw Object.assign(new Error(), { code: 'timeout' }); } }), (error) => error.code === 'timeout');
  await assert.rejects(syncDifyPolicy({ baseUrl: 'https://example.test/v1', apiKey: 'test-only-secret', request: async () => { throw Object.assign(new Error(), { code: 'response-too-large' }); } }), (error) => error.code === 'response-too-large');
  await assert.rejects(run({ statusCode: 200, body: JSON.stringify({}) }), (error) => error.code === 'invalid-answer');
  await assert.rejects(run({ statusCode: 200, body: JSON.stringify({ answer: 42 }) }), (error) => error.code === 'invalid-answer');
  await assert.rejects(syncDifyPolicy({ baseUrl: 'https://example.test/v1', request: async () => ({ statusCode: 200, body: '{}' }) }), (error) => error.code === 'missing-credential');
});

test('blocks HTTP by default and permits it only explicitly', async () => {
  await assert.rejects(syncDifyPolicy({ baseUrl: 'http://example.test/v1', apiKey: 'test-only-secret', request: async () => ({ statusCode: 200, body: JSON.stringify({ answer: JSON.stringify(valid) }) }) }), (error) => error.code === 'insecure-http-blocked');
  const result = await syncDifyPolicy({ baseUrl: 'http://example.test/v1', allowInsecureHttp: true, apiKey: 'test-only-secret', request: async () => ({ statusCode: 200, body: JSON.stringify({ answer: JSON.stringify(valid) }) }) });
  assert.equal(result.policy.schemaVersion, 1);
});

test('loads valid cache, then local, then bundled defaults', () => {
  const temp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'kangkang-policy-'));
  const cachePath = path.join(temp, 'cache.json'); const localPath = path.join(temp, 'local.json'); const defaultsPath = path.join(root, 'assets', 'config', 'employee-policy-defaults.json');
  fs.writeFileSync(cachePath, JSON.stringify(valid));
  fs.writeFileSync(localPath, JSON.stringify({ ...valid, policyVersion: 'local-version' }));
  assert.equal(loadEffectivePolicy({ sourceMode: 'dify', cachePath, localPath, defaultsPath }).sourceKind, 'dify');
  fs.writeFileSync(cachePath, '{broken');
  assert.equal(loadEffectivePolicy({ sourceMode: 'dify', cachePath, localPath, defaultsPath }).sourceKind, 'local');
  fs.writeFileSync(localPath, '{broken');
  assert.equal(loadEffectivePolicy({ sourceMode: 'dify', cachePath, localPath, defaultsPath }).sourceKind, 'builtin');
  fs.rmSync(temp, { recursive: true, force: true });
});

test('merges managed reminders without changing manual reminders or duplicating rules', () => {
  const manual = { id: 'manual-1', title: '我的提醒', message: '不要改我', repeat: 'daily', time: '10:00', enabled: true, sortOrder: 0 };
  const first = mergeEmployeePolicyReminders([manual], valid, { sourceKind: 'builtin', sourceRevision: 'rev-1', now: new Date('2026-09-10T08:00:00Z') });
  const withState = first.map((item) => item.id === 'employee-policy:workday-start' ? { ...item, lastTriggeredAt: '2026-09-10T01:00:00.000Z', nextTriggerAt: '2026-09-11T01:00:00.000Z' } : item);
  const second = mergeEmployeePolicyReminders(withState, valid, { sourceKind: 'dify', sourceRevision: 'rev-2', now: new Date('2026-09-10T08:05:00Z') });
  assert.equal(second.filter((item) => item.managedBy === 'employee-policy').length, 3);
  assert.deepEqual(second.find((item) => item.id === 'manual-1'), manual);
  const unchanged = second.find((item) => item.id === 'employee-policy:workday-start');
  assert.equal(unchanged.lastTriggeredAt, '2026-09-10T01:00:00.000Z');
  assert.equal(unchanged.nextTriggerAt, '2026-09-11T01:00:00.000Z');
});

test('does not expose credentials in renderer-facing files', () => {
  const files = ['main.js', 'panel.html', 'preload/panel-preload.js', 'src/main/employee-policy.js', ...fs.readdirSync(path.join(root, 'test')).map((name) => path.join('test', name))];
  const source = files.map((file) => fs.readFileSync(path.join(root, file), 'utf8')).join('\n');
  assert.doesNotMatch(source, /sk-[A-Za-z0-9]{12,}/);
  assert.doesNotMatch(fs.readFileSync(path.join(root, 'panel.html'), 'utf8'), /Authorization/i);
  assert.doesNotMatch(fs.readFileSync(path.join(root, 'preload', 'panel-preload.js'), 'utf8'), /Authorization/i);
  assert.doesNotMatch(fs.readFileSync(path.join(root, 'panel.html'), 'utf8'), /employeePolicy|员工守则同步|KANGKANGPET_DIFY/);
  assert.doesNotMatch(fs.readFileSync(path.join(root, 'preload', 'panel-preload.js'), 'utf8'), /employeePolicy|employee-policy|DIFY/);
});
