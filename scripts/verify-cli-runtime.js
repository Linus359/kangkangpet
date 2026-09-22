'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const runtimePath = path.join(__dirname, '..', 'dist', 'cli', 'runtime', 'node.exe');
const knownBlockedSha1 = '8c277a25c42f0d324bbf3de7beaa1aaafa96bfdd';

if (!fs.existsSync(runtimePath)) {
  console.log('CLI runtime verification skipped: private dist/cli payload is not present.');
  process.exit(0);
}

const bytes = fs.readFileSync(runtimePath);
const sha1 = crypto.createHash('sha1').update(bytes).digest('hex');
const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');

if (sha1 === knownBlockedSha1) {
  throw new Error(`Blocked CLI runtime detected at ${runtimePath}. Replace node.exe before packaging (SHA1 ${sha1}).`);
}

console.log(`CLI runtime verified: node.exe SHA1 ${sha1}, SHA256 ${sha256}.`);
