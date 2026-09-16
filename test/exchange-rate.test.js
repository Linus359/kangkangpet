'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { ExchangeRateService, normalizeCurrency } = require('../src/main/exchange-rate-service');

test('normalizes three-letter currency codes and rejects malformed values', () => {
  assert.equal(normalizeCurrency(' cny '), 'CNY');
  assert.equal(normalizeCurrency('usd'), 'USD');
  assert.equal(normalizeCurrency('US'), null);
  assert.equal(normalizeCurrency('USDT'), null);
});

test('returns one for same-currency conversions without a request', async () => {
  let calls = 0;
  const service = new ExchangeRateService({ request: async () => { calls += 1; return { rate: 2 }; } });
  const result = await service.getRate('CNY', 'CNY');
  assert.equal(result.rate, 1);
  assert.equal(result.cached, false);
  assert.equal(calls, 0);
});

test('fetches a rate and serves repeated requests from the five-minute cache', async () => {
  let now = 1000;
  let calls = 0;
  const service = new ExchangeRateService({
    baseUrl: 'https://example.test/rate',
    now: () => now,
    request: async (url) => {
      calls += 1;
      assert.equal(url, 'https://example.test/rate/CNY/USD');
      return { rate: 0.1375, date: '2026-09-15' };
    }
  });
  const first = await service.getRate('CNY', 'USD');
  const second = await service.getRate('CNY', 'USD');
  assert.equal(first.rate, 0.1375);
  assert.equal(first.date, '2026-09-15');
  assert.equal(first.cached, false);
  assert.equal(second.cached, true);
  assert.equal(calls, 1);
  now += 5 * 60 * 1000;
  await service.getRate('CNY', 'USD');
  assert.equal(calls, 2);
});

test('rejects invalid currencies and invalid provider rates', async () => {
  const service = new ExchangeRateService({ request: async () => ({ rate: 0 }) });
  await assert.rejects(service.getRate('CN', 'USD'), /invalid-currency/);
  await assert.rejects(service.getRate('CNY', 'USD'), /invalid-rate/);
});
