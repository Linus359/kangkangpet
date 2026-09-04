'use strict';

const { spawn } = require('child_process');

const DEFAULT_PWA_CONFIG = Object.freeze({
  enabled: true,
  url: 'https://ai.forcome.com',
  launchCommand: null,
  processNames: [],
  windowTitleKeywords: ['FORCOME AI', 'FORCOME'],
  fallbackToBrowser: true
});

function asText(value, maximum = 300) {
  return typeof value === 'string' ? value.trim().slice(0, maximum) : '';
}

function normalizeStringList(value, maximumItems = 12, maximumLength = 120) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => asText(item, maximumLength)).filter(Boolean))].slice(0, maximumItems);
}

function validHttpUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.toString() : '';
  } catch (_) {
    return '';
  }
}

function normalizeLaunchCommand(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const file = asText(value.file, 2000);
  const args = Array.isArray(value.args) ? value.args.map((item) => asText(item, 2000)) : null;
  if (!file || !args || args.some((item) => !item)) return null;
  return { file, args: args.slice(0, 32) };
}

function normalizePwaConfig(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return {
    enabled: source.enabled !== false,
    url: validHttpUrl(source.url || DEFAULT_PWA_CONFIG.url),
    launchCommand: normalizeLaunchCommand(source.launchCommand),
    processNames: normalizeStringList(source.processNames).map((name) => name.replace(/\.exe$/i, '').toLowerCase()),
    windowTitleKeywords: normalizeStringList(source.windowTitleKeywords || DEFAULT_PWA_CONFIG.windowTitleKeywords).map((keyword) => keyword.toLowerCase()),
    fallbackToBrowser: source.fallbackToBrowser !== false
  };
}

function runPowerShell(script, { env = process.env, timeoutMs = 3000 } = {}) {
  if (process.platform !== 'win32') return Promise.resolve({ ok: false, output: '', error: new Error('Windows-only operation') });
  return new Promise((resolve) => {
    let output = '';
    let errorOutput = '';
    let settled = false;
    const finish = (result) => { if (!settled) { settled = true; resolve(result); } };
    let child;
    try {
      child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
        windowsHide: true,
        env,
        stdio: ['ignore', 'pipe', 'pipe']
      });
    } catch (error) {
      finish({ ok: false, output, error });
      return;
    }
    child.stdout.on('data', (chunk) => { output += String(chunk); });
    child.stderr.on('data', (chunk) => { errorOutput += String(chunk); });
    child.on('error', (error) => finish({ ok: false, output, error }));
    child.on('close', (code) => finish({ ok: code === 0, output, error: code === 0 ? null : new Error(errorOutput || `PowerShell exited with ${code}`) }));
    setTimeout(() => {
      try { child.kill(); } catch (_) {}
      finish({ ok: false, output, error: new Error('PowerShell timed out') });
    }, timeoutMs).unref();
  });
}

async function findPwaWindow(config, runCommand = runPowerShell) {
  if (process.platform !== 'win32' || (!config.windowTitleKeywords.length && !config.processNames.length)) return null;
  // Keep processes with an empty title: minimized or Chromium-hosted PWA windows can report it temporarily.
  const script = "$ErrorActionPreference='Stop'; $OutputEncoding=[System.Text.Encoding]::UTF8; [Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Get-Process | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object Id,ProcessName,MainWindowTitle,MainWindowHandle | ConvertTo-Json -Compress";
  const result = await runCommand(script);
  if (!result?.ok || !result.output.trim()) return null;
  let windows;
  try { windows = JSON.parse(result.output); } catch (_) { return null; }
  const candidates = Array.isArray(windows) ? windows : [windows];
  return candidates.find((candidate) => {
    const title = asText(candidate?.MainWindowTitle, 1000).toLowerCase();
    const processName = asText(candidate?.ProcessName, 120).replace(/\.exe$/i, '').toLowerCase();
    const titleMatches = config.windowTitleKeywords.length > 0 && config.windowTitleKeywords.some((keyword) => title.includes(keyword));
    const processMatches = config.processNames.length > 0 && config.processNames.includes(processName);
    return (!config.windowTitleKeywords.length || titleMatches) && (!config.processNames.length || processMatches);
  }) || null;
}

async function findInstalledPwaShortcut(config, runCommand = runPowerShell) {
  if (process.platform !== 'win32' || (!config.url && !config.windowTitleKeywords.length)) return null;
  const script = "$ErrorActionPreference='Stop'; $OutputEncoding=[System.Text.Encoding]::UTF8; [Console]::OutputEncoding=[System.Text.Encoding]::UTF8; $roots = @([Environment]::GetFolderPath('StartMenu'), [Environment]::GetFolderPath('CommonStartMenu'), [Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('CommonDesktopDirectory')) | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -Unique; $wantedUrl = ([string]$env:KANGKANGPET_PWA_URL).ToLowerInvariant().TrimEnd('/'); $wantedHost = ''; try { if ($wantedUrl) { $wantedHost = ([Uri]$wantedUrl).Host.ToLowerInvariant() } } catch {}; $keywords = @(); try { $keywords = @($env:KANGKANGPET_PWA_KEYWORDS | ConvertFrom-Json) } catch {}; $shell = New-Object -ComObject WScript.Shell; $matches = foreach ($root in $roots) { Get-ChildItem -LiteralPath $root -Filter '*.lnk' -File -Recurse -ErrorAction SilentlyContinue | ForEach-Object { try { $shortcut = $shell.CreateShortcut($_.FullName); $text = (@($_.BaseName, $shortcut.Description, $shortcut.TargetPath, $shortcut.Arguments) -join ' ').ToLowerInvariant(); $urlMatch = $wantedUrl -and ($text.Contains($wantedUrl) -or ($wantedHost -and $text.Contains($wantedHost))); $keywordMatch = $false; foreach ($keyword in $keywords) { if ($keyword -and $text.Contains(([string]$keyword).ToLowerInvariant())) { $keywordMatch = $true; break } }; if ($urlMatch -or $keywordMatch) { [pscustomobject]@{ Path=$_.FullName } } } catch {} } }; $matches | Select-Object -First 1 | ConvertTo-Json -Compress";
  const result = await runCommand(script, {
    env: {
      ...process.env,
      KANGKANGPET_PWA_URL: config.url || '',
      KANGKANGPET_PWA_KEYWORDS: JSON.stringify(config.windowTitleKeywords)
    }
  });
  if (!result?.ok || !result.output.trim()) return null;
  try {
    const value = JSON.parse(result.output);
    const shortcutPath = asText(value?.Path, 4000);
    return shortcutPath.toLowerCase().endsWith('.lnk') ? { path: shortcutPath } : null;
  } catch (_) {
    return null;
  }
}

async function activatePwaWindow(windowInfo, runCommand = runPowerShell) {
  const processId = Number(windowInfo?.Id);
  if (!Number.isInteger(processId) || processId <= 0 || process.platform !== 'win32') return false;
  const script = "Add-Type @'\nusing System; using System.Runtime.InteropServices; public static class KangKangPwaWindow { [DllImport(\"user32.dll\")] public static extern bool SetForegroundWindow(IntPtr hWnd); [DllImport(\"user32.dll\")] public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow); }\n'@; $p = Get-Process -Id $env:KANGKANGPET_PWA_PROCESS_ID -ErrorAction Stop; [KangKangPwaWindow]::ShowWindowAsync($p.MainWindowHandle, 9) | Out-Null; if ([KangKangPwaWindow]::SetForegroundWindow($p.MainWindowHandle)) { exit 0 } else { exit 1 }";
  const result = await runCommand(script, { env: { ...process.env, KANGKANGPET_PWA_PROCESS_ID: String(processId) } });
  return Boolean(result?.ok);
}

function launchConfiguredCommand(command, launch = spawn) {
  if (!command) return false;
  try {
    const child = launch(command.file, command.args, { detached: true, stdio: 'ignore', windowsHide: true, shell: false });
    child.unref?.();
    return true;
  } catch (_) {
    return false;
  }
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function findAndActivatePwa(config, { findWindow, activateWindow, delay, log }, attempts = 1) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const candidate = await findWindow(config).catch((error) => { log('查找目标 PWA 窗口失败。', error); return null; });
    if (candidate && await activateWindow(candidate).catch((error) => { log('激活目标 PWA 窗口失败。', error); return false; })) return true;
    if (attempt + 1 < attempts) await delay(350);
  }
  return false;
}

async function openInstalledPwaShortcut(shortcut, openPath) {
  if (!shortcut?.path || typeof openPath !== 'function') return false;
  try {
    const error = await openPath(shortcut.path);
    return !error;
  } catch (_) {
    return false;
  }
}

async function openPwa(configValue, { openExternal, openPath, log = () => {}, findWindow = findPwaWindow, activateWindow = activatePwaWindow, findInstalledShortcut = findInstalledPwaShortcut, launch = launchConfiguredCommand, delay = wait } = {}) {
  const config = normalizePwaConfig(configValue);
  if (!config.enabled) return { ok: false, message: '目标 PWA 功能未启用。' };
  if (await findAndActivatePwa(config, { findWindow, activateWindow, delay, log })) return { ok: true, reused: true, message: '已唤起目标 PWA。' };

  const shortcut = typeof openPath === 'function'
    ? await findInstalledShortcut(config).catch((error) => { log('查找已安装目标 PWA 失败。', error); return null; })
    : null;
  if (shortcut && await openInstalledPwaShortcut(shortcut, openPath)) {
    if (await findAndActivatePwa(config, { findWindow, activateWindow, delay, log }, 7)) return { ok: true, launched: true, installed: true, message: '已打开已安装的目标 PWA。' };
    // The shell accepted the registered shortcut. Do not open a second browser window just because the app exposes no title yet.
    return { ok: true, launched: true, installed: true, message: '已启动已安装的目标 PWA。' };
  }

  if (config.launchCommand) {
    const launched = launch(config.launchCommand);
    if (launched) {
      if (await findAndActivatePwa(config, { findWindow, activateWindow, delay, log }, 7)) return { ok: true, launched: true, message: '已打开目标 PWA。' };
    } else {
      log('配置的目标 PWA 启动命令无法执行。');
    }
  }

  if (config.fallbackToBrowser && config.url && typeof openExternal === 'function') {
    try {
      await openExternal(config.url);
      return { ok: true, fallback: true, message: '已使用默认浏览器打开目标地址。' };
    } catch (error) {
      log('默认浏览器打开目标 PWA 地址失败。', error);
    }
  }
  return { ok: false, message: '无法打开目标 PWA，请检查设置或默认浏览器。' };
}

module.exports = { DEFAULT_PWA_CONFIG, normalizePwaConfig, normalizeLaunchCommand, findPwaWindow, findInstalledPwaShortcut, activatePwaWindow, launchConfiguredCommand, openInstalledPwaShortcut, openPwa };
