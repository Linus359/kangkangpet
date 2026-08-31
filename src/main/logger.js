'use strict';

const fs = require('fs');
const path = require('path');

const MAX_LOG_BYTES = 1024 * 1024;

class Logger {
  constructor(directory) {
    this.directory = directory;
    this.filePath = path.join(directory, 'kangkangpet.log');
  }

  write(message, error = null) {
    try {
      fs.mkdirSync(this.directory, { recursive: true });
      if (fs.existsSync(this.filePath) && fs.statSync(this.filePath).size >= MAX_LOG_BYTES) {
        const archive = `${this.filePath}.${Date.now()}.bak`;
        fs.renameSync(this.filePath, archive);
      }
      const detail = error ? ` ${error.stack || error.message || String(error)}` : '';
      fs.appendFileSync(this.filePath, `[${new Date().toISOString()}] ${message}${detail}\n`, 'utf8');
    } catch {}
  }
}

module.exports = { Logger };
