'use strict';

const fs = require('fs');
const path = require('path');

class ConfigStore {
  constructor(configPath, { log = () => {}, normalize }) {
    this.configPath = configPath;
    this.log = log;
    this.normalize = normalize;
  }

  load(defaultConfig) {
    try {
      if (!fs.existsSync(this.configPath)) return this.normalize(defaultConfig);
      return this.normalize(JSON.parse(fs.readFileSync(this.configPath, 'utf8')));
    } catch (error) {
      const backup = `${this.configPath}.corrupt-${Date.now()}.bak`;
      try {
        if (fs.existsSync(this.configPath)) fs.copyFileSync(this.configPath, backup);
      } catch (backupError) {
        this.log('备份损坏配置失败', backupError);
      }
      this.log(`配置读取失败，已保留备份：${backup}`, error);
      return this.normalize(defaultConfig);
    }
  }

  save(config) {
    const directory = path.dirname(this.configPath);
    const temporaryPath = `${this.configPath}.${process.pid}.${Date.now()}.tmp`;
    fs.mkdirSync(directory, { recursive: true });
    try {
      fs.writeFileSync(temporaryPath, JSON.stringify(config, null, 2), { encoding: 'utf8', mode: 0o600 });
      fs.renameSync(temporaryPath, this.configPath);
    } catch (error) {
      try { fs.rmSync(temporaryPath, { force: true }); } catch {}
      this.log('配置保存失败', error);
      throw error;
    }
  }
}

module.exports = { ConfigStore };
