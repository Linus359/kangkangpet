'use strict';

const https = require('https');

const DEFAULT_EXCHANGE_RATE_BASE_URL = 'https://api.frankfurter.dev/v2/rate';
const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000;
const DEFAULT_TIMEOUT_MS = 10 * 1000;
const DEFAULT_MAX_RESPONSE_BYTES = 64 * 1024;

function normalizeCurrency(value) {
  const code = typeof value === 'string' ? value.trim().toUpperCase() : '';
  return /^[A-Z]{3}$/.test(code) ? code : null;
}

function requestJson(url, { timeoutMs = DEFAULT_TIMEOUT_MS, maxResponseBytes = DEFAULT_MAX_RESPONSE_BYTES } = {}) {
  return new Promise((resolve, reject) => {
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      reject(new Error('invalid-url'));
      return;
    }
    if (parsed.protocol !== 'https:') {
      reject(new Error('https-required'));
      return;
    }

    const request = https.get(parsed, { headers: { Accept: 'application/json' } }, (response) => {
      let size = 0;
      const chunks = [];
      response.on('data', (chunk) => {
        size += chunk.length;
        if (size <= maxResponseBytes) chunks.push(chunk);
        else response.destroy(new Error('response-too-large'));
      });
      response.on('end', () => {
        if (size > maxResponseBytes) return;
        const body = Buffer.concat(chunks).toString('utf8');
        if (response.statusCode < 200 || response.statusCode >= 300) {
          reject(new Error(`http-${response.statusCode || 0}`));
          return;
        }
        try {
          resolve(JSON.parse(body));
        } catch {
          reject(new Error('invalid-json'));
        }
      });
      response.on('error', reject);
    });
    request.setTimeout(timeoutMs, () => request.destroy(new Error('timeout')));
    request.on('error', reject);
  });
}

class ExchangeRateService {
  constructor({ baseUrl = DEFAULT_EXCHANGE_RATE_BASE_URL, cacheTtlMs = DEFAULT_CACHE_TTL_MS, now = () => Date.now(), request = requestJson } = {}) {
    this.baseUrl = String(baseUrl).replace(/\/$/, '');
    this.cacheTtlMs = Math.max(0, Number(cacheTtlMs) || DEFAULT_CACHE_TTL_MS);
    this.now = now;
    this.request = request;
    this.cache = new Map();
  }

  async getRate(base, quote) {
    const normalizedBase = normalizeCurrency(base);
    const normalizedQuote = normalizeCurrency(quote);
    if (!normalizedBase || !normalizedQuote) throw new Error('invalid-currency');
    if (normalizedBase === normalizedQuote) {
      return { ok: true, base: normalizedBase, quote: normalizedQuote, rate: 1, date: null, cached: false, fetchedAt: new Date(this.now()).toISOString(), source: 'Frankfurter' };
    }

    const key = `${normalizedBase}:${normalizedQuote}`;
    const cached = this.cache.get(key);
    if (cached && this.now() - cached.timestamp < this.cacheTtlMs) return { ...cached.value, cached: true };

    const payload = await this.request(`${this.baseUrl}/${normalizedBase}/${normalizedQuote}`);
    const rate = Number(payload?.rate);
    if (!Number.isFinite(rate) || rate <= 0) throw new Error('invalid-rate');
    const value = {
      ok: true,
      base: normalizedBase,
      quote: normalizedQuote,
      rate,
      date: typeof payload?.date === 'string' ? payload.date : null,
      cached: false,
      fetchedAt: new Date(this.now()).toISOString(),
      source: 'Frankfurter'
    };
    this.cache.set(key, { timestamp: this.now(), value });
    return value;
  }
}

module.exports = { DEFAULT_EXCHANGE_RATE_BASE_URL, ExchangeRateService, normalizeCurrency, requestJson };
