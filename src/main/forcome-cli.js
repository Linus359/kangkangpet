'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile, spawn } = require('child_process');

const REQUIRED_RELATIVE_PATHS = Object.freeze([
  ['runtime', 'node.exe'],
  ['cli', 'node_modules', '@forcome', 'ai-cli', 'bin', 'fai.js'],
  ['cli', 'node_modules', '@forcome', 'ai-cli', 'package.json'],
  ['ForcomeAiTray.exe'],
  ['assets', 'forcome.ico'],
  ['assets', 'forcomelogo.png']
]);

function readJson(filePath, fsImpl = fs) {
  try {
    return JSON.parse(fsImpl.readFileSync(filePath, 'utf8'));
  } catch (_) {
    return null;
  }
}

function fileExists(filePath, fsImpl = fs) {
  try {
    return fsImpl.statSync(filePath).isFile();
  } catch (_) {
    return false;
  }
}

function resolveForcomeCliPaths({ appRoot, resourcesPath, isPackaged }) {
  const root = isPackaged
    ? path.join(resourcesPath, 'forcome-cli')
    : path.join(appRoot, 'dist', 'cli');
  return {
    root,
    node: path.join(root, 'runtime', 'node.exe'),
    entry: path.join(root, 'cli', 'node_modules', '@forcome', 'ai-cli', 'bin', 'fai.js'),
    packageJson: path.join(root, 'cli', 'node_modules', '@forcome', 'ai-cli', 'package.json'),
    wrappedPackageJson: path.join(root, 'cli', 'node_modules', '@forcome', 'ai-cli', 'node_modules', '@lobehub', 'cli', 'package.json'),
    tray: path.join(root, 'ForcomeAiTray.exe'),
    icon: path.join(root, 'assets', 'forcome.ico'),
    logo: path.join(root, 'assets', 'forcomelogo.png')
  };
}

function execFilePromise(file, args, options = {}, execFileImpl = execFile) {
  return new Promise((resolve) => {
    execFileImpl(file, args, options, (error, stdout = '', stderr = '') => {
      resolve({ ok: !error, error, stdout: String(stdout), stderr: String(stderr) });
    });
  });
}

class ForcomeCliManager {
  constructor({ appRoot, resourcesPath, isPackaged, homeDir = os.homedir(), fsImpl = fs, spawnImpl = spawn, execFileImpl = execFile, log = () => {}, onProcessExit = () => {} }) {
    this.paths = resolveForcomeCliPaths({ appRoot, resourcesPath, isPackaged });
    this.homeDir = homeDir;
    this.fs = fsImpl;
    this.spawn = spawnImpl;
    this.execFile = execFileImpl;
    this.log = log;
    this.onProcessExit = onProcessExit;
    this.children = new Map();
  }

  get credentialsPath() {
    return path.join(this.homeDir, '.lobehub', 'credentials.json');
  }

  get daemonStatusPath() {
    return path.join(this.homeDir, '.lobehub', 'daemon.status.json');
  }

  get missingFiles() {
    return REQUIRED_RELATIVE_PATHS
      .map((segments) => path.join(this.paths.root, ...segments))
      .filter((candidate) => !fileExists(candidate, this.fs));
  }

  staticInfo() {
    const packageInfo = readJson(this.paths.packageJson, this.fs) || {};
    const wrappedInfo = readJson(this.paths.wrappedPackageJson, this.fs) || {};
    const missingFiles = this.missingFiles;
    return {
      available: missingFiles.length === 0,
      root: this.paths.root,
      version: packageInfo.version || 'unknown',
      wrappedVersion: wrappedInfo.version || 'unknown',
      authenticated: fileExists(this.credentialsPath, this.fs),
      loginRunning: [...this.children.values()].some((value) => value.kind === '登录'),
      missingFiles: missingFiles.map((candidate) => path.relative(this.paths.root, candidate)),
      iconPath: fileExists(this.paths.icon, this.fs) ? this.paths.icon : null,
      logoPath: fileExists(this.paths.logo, this.fs) ? this.paths.logo : null
    };
  }

  async connectorProcesses() {
    if (process.platform !== 'win32' || !this.staticInfo().available) return [];
    const script = String.raw`$ErrorActionPreference='SilentlyContinue'; $root=[IO.Path]::GetFullPath($env:FORCOME_EMBEDDED_ROOT).TrimEnd('\'); Get-CimInstance Win32_Process | ForEach-Object { $exe=[string]$_.ExecutablePath; $cmd=[string]$_.CommandLine; $isService=([string]$_.Name -ieq 'ForcomeAiTray.exe') -and ($cmd -match '(?i)--service'); $isCliConnect=($cmd -match '(?i)(^|\s)connect(\s|$)') -and ($cmd -match '(?i)(@forcome[\\/]ai-cli|ForcomeAI[\\/]cli|fai\.cmd)'); if($exe -and $cmd -and ($isService -or $isCliConnect)){ [pscustomobject]@{ ProcessId=$_.ProcessId; Name=$_.Name; ExecutablePath=$exe; CommandLine=$cmd; Managed=([IO.Path]::GetFullPath($exe).StartsWith($root,[StringComparison]::OrdinalIgnoreCase) -or $cmd.StartsWith($root,[StringComparison]::OrdinalIgnoreCase) -or $cmd.IndexOf(('"'+$root),[StringComparison]::OrdinalIgnoreCase) -ge 0) } } } | ConvertTo-Json -Compress`;
    const result = await execFilePromise('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      encoding: 'utf8',
      timeout: 6000,
      windowsHide: true,
      env: { ...process.env, FORCOME_EMBEDDED_ROOT: this.paths.root }
    }, this.execFile);
    if (!result.ok || !result.stdout.trim()) return [];
    try {
      const parsed = JSON.parse(result.stdout);
      return (Array.isArray(parsed) ? parsed : [parsed]).filter((item) => Number.isInteger(Number(item?.ProcessId)));
    } catch (error) {
      this.log('解析 FORCOME AI 连接器进程状态失败。', error);
      return [];
    }
  }

  async managedProcesses() {
    return (await this.connectorProcesses()).filter((item) => item.Managed === true);
  }

  async getStatus() {
    const info = this.staticInfo();
    const processes = info.available ? await this.connectorProcesses() : [];
    const managed = processes.filter((item) => item.Managed === true);
    const external = processes.filter((item) => item.Managed !== true);
    const daemonStatus = readJson(this.daemonStatusPath, this.fs) || {};
    const daemonPid = Number(daemonStatus.pid);
    const daemonBelongsToManaged = managed.some((item) => Number(item.ProcessId) === daemonPid);
    const connectionStatus = daemonBelongsToManaged
      ? String(daemonStatus.connectionStatus || 'running')
      : managed.length > 0 ? 'running' : 'stopped';
    return {
      ...info,
      connectorRunning: managed.length > 0,
      connectorConnected: connectionStatus === 'connected',
      connectionStatus,
      connectorProcessCount: managed.length,
      externalConnectorRunning: external.length > 0,
      externalConnectorProcessCount: external.length
    };
  }

  rememberChild(child, kind) {
    if (!child?.pid) return child;
    this.children.set(child.pid, { child, kind });
    child.once?.('exit', (code, signal) => {
      this.children.delete(child.pid);
      this.onProcessExit({ kind, pid: child.pid, code, signal });
    });
    child.once?.('error', (error) => {
      this.children.delete(child.pid);
      this.log(`FORCOME AI ${kind}进程启动失败。`, error);
    });
    return child;
  }

  startConnector() {
    const info = this.staticInfo();
    if (!info.available) return { ok: false, error: `CLI 文件不完整：${info.missingFiles.join('、')}` };
    const existing = [...this.children.entries()].find(([, value]) => value.kind === '连接器');
    if (existing) return { ok: true, pid: existing[0], reused: true };
    try {
      const child = this.spawn(this.paths.tray, ['--service'], {
        cwd: this.paths.root,
        env: { ...process.env },
        windowsHide: true,
        stdio: 'ignore',
        shell: false
      });
      this.rememberChild(child, '连接器');
      return { ok: true, pid: child.pid || null };
    } catch (error) {
      this.log('启动 FORCOME AI 连接器失败。', error);
      return { ok: false, error: error.message };
    }
  }

  startLogin() {
    const info = this.staticInfo();
    if (!info.available) return { ok: false, error: `CLI 文件不完整：${info.missingFiles.join('、')}` };
    const existing = [...this.children.entries()].find(([, value]) => value.kind === '登录');
    if (existing) return { ok: true, pid: existing[0], reused: true };
    try {
      const child = this.spawn(this.paths.node, [this.paths.entry, 'login'], {
        cwd: this.paths.root,
        env: { ...process.env },
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: false
      });
      child.stdout?.on('data', () => {});
      child.stderr?.on('data', (chunk) => this.log(`FORCOME AI 登录：${String(chunk).trim()}`));
      this.rememberChild(child, '登录');
      return { ok: true, pid: child.pid || null };
    } catch (error) {
      this.log('启动 FORCOME AI 登录失败。', error);
      return { ok: false, error: error.message };
    }
  }

  async stopConnector() {
    const processes = await this.managedProcesses();
    const pids = new Set([
      ...processes.map((item) => Number(item.ProcessId)),
      ...[...this.children.entries()].filter(([, value]) => value.kind === '连接器').map(([pid]) => pid)
    ].filter((pid) => Number.isInteger(pid) && pid > 0));
    for (const pid of pids) {
      const result = await execFilePromise('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, timeout: 6000 }, this.execFile);
      if (!result.ok) this.log(`停止 FORCOME AI 连接器进程 ${pid} 失败。`, result.error);
      this.children.delete(pid);
    }
    return { ok: true, stopped: pids.size };
  }

  stopTrackedProcesses() {
    const pids = [...this.children.keys()].filter((pid) => Number.isInteger(pid) && pid > 0);
    for (const pid of pids) {
      try {
        const killer = this.spawn('taskkill.exe', ['/PID', String(pid), '/T', '/F'], {
          detached: true,
          windowsHide: true,
          stdio: 'ignore',
          shell: false
        });
        killer.unref?.();
      } catch (error) {
        this.log(`退出时停止 FORCOME AI 进程 ${pid} 失败。`, error);
      }
    }
    this.children.clear();
    return pids.length;
  }

  async ensureConnectorStarted() {
    const status = await this.getStatus();
    if (!status.available || !status.authenticated || status.connectorRunning || status.externalConnectorRunning) return status;
    this.startConnector();
    return this.getStatus();
  }
}

module.exports = { ForcomeCliManager, REQUIRED_RELATIVE_PATHS, resolveForcomeCliPaths };
