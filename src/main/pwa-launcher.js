'use strict';

const { spawn } = require('child_process');
const path = require('path');

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

function runPowerShell(script, { env = process.env, timeoutMs = 6000 } = {}) {
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

function normalizeInstalledPwa(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const shortcutPath = asText(source.Path || source.path, 4000);
  const file = asText(source.TargetPath || source.file, 4000);
  const appId = /^[a-z0-9_-]{4,160}$/i.test(asText(source.AppId || source.appId, 160)) ? asText(source.AppId || source.appId, 160).toLowerCase() : '';
  const profile = asText(source.Profile || source.profile, 300);
  const appUrl = validHttpUrl(source.AppUrl || source.appUrl);
  const fileName = path.win32.basename(file).replace(/\.exe$/i, '').replace(/_proxy$/i, '').toLowerCase();
  if (!appId && !appUrl) return null;
  return {
    path: shortcutPath.toLowerCase().endsWith('.lnk') ? shortcutPath : '',
    file,
    args: [profile ? `--profile-directory=${profile}` : '', appId ? `--app-id=${appId}` : '', appUrl ? `--app=${appUrl}` : ''].filter(Boolean),
    appId,
    appUrl,
    profile,
    processName: fileName,
    name: asText(source.Name || source.name, 500),
    description: asText(source.Description || source.description, 1000),
    source: asText(source.Source || source.source, 40)
  };
}

function installedPwaScore(candidate, config) {
  if (!candidate) return -1;
  let score = candidate.appId ? 40 : 0;
  const name = candidate.name.toLowerCase();
  const description = candidate.description.toLowerCase();
  const fileText = `${candidate.file} ${candidate.appUrl}`.toLowerCase();
  let wantedHost = '';
  try { wantedHost = new URL(config.url).host.toLowerCase(); } catch (_) {}
  if (config.url && candidate.appUrl === config.url) score += 1200;
  else if (wantedHost && fileText.includes(wantedHost)) score += 700;
  for (const keyword of [...config.windowTitleKeywords].sort((left, right) => right.length - left.length)) {
    if (name === keyword) score += 600 + keyword.length;
    else if (name.includes(keyword)) score += 260 + keyword.length;
    if (description.includes(keyword)) score += 140 + keyword.length;
  }
  if (candidate.path) score += 20;
  if (candidate.source === 'shortcut') score += 10;
  return score;
}

function hasPwaLaunchMarker(commandLine) {
  return /(?:^|\s)--(?:app-id|app)(?:=|\s)/i.test(asText(commandLine, 4000));
}

function matchesInstalledPwaCommand(commandLine, installedPwa) {
  const command = asText(commandLine, 4000).toLowerCase();
  if (!hasPwaLaunchMarker(command)) return false;
  if (installedPwa?.appId && new RegExp(`(?:^|\\s)--app-id(?:=|\\s)["']?${installedPwa.appId.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}(?:["']|\\s|$)`, 'i').test(command)) return true;
  if (installedPwa?.appUrl) {
    const normalizedUrl = installedPwa.appUrl.toLowerCase().replace(/["']/g, '');
    return command.includes(`--app=${normalizedUrl}`) || command.includes(`--app ${normalizedUrl}`);
  }
  return false;
}

async function findPwaWindow(config, installedPwa = null, runCommand = runPowerShell) {
  if (typeof installedPwa === 'function') { runCommand = installedPwa; installedPwa = null; }
  if (process.platform !== 'win32' || (!config.windowTitleKeywords.length && !config.processNames.length && !installedPwa?.appId)) return null;
  const script = "$ErrorActionPreference='Stop'; $OutputEncoding=[System.Text.Encoding]::UTF8; [Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Add-Type @'\nusing System; using System.Collections.Generic; using System.Runtime.InteropServices; using System.Text; public static class KangKangPwaWindows { public sealed class WindowInfo { public long MainWindowHandle; public int Id; public string MainWindowTitle; public bool Minimized; } private delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam); [DllImport(\"user32.dll\")] private static extern bool EnumWindows(EnumWindowsProc callback, IntPtr lParam); [DllImport(\"user32.dll\")] private static extern bool IsWindowVisible(IntPtr hWnd); [DllImport(\"user32.dll\")] private static extern bool IsIconic(IntPtr hWnd); [DllImport(\"user32.dll\")] private static extern int GetWindowTextLength(IntPtr hWnd); [DllImport(\"user32.dll\", CharSet=CharSet.Unicode)] private static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count); [DllImport(\"user32.dll\")] private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId); public static WindowInfo[] GetAll() { var result = new List<WindowInfo>(); EnumWindows((hWnd, unused) => { bool minimized = IsIconic(hWnd); if (!IsWindowVisible(hWnd) && !minimized) return true; uint processId; GetWindowThreadProcessId(hWnd, out processId); if (processId == 0) return true; int length = GetWindowTextLength(hWnd); var text = new StringBuilder(length + 1); GetWindowText(hWnd, text, text.Capacity); result.Add(new WindowInfo { MainWindowHandle=hWnd.ToInt64(), Id=(int)processId, MainWindowTitle=text.ToString(), Minimized=minimized }); return true; }, IntPtr.Zero); return result.ToArray(); } }\n'@; $processes=@{}; Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | ForEach-Object { $processes[[int]$_.ProcessId]=[pscustomobject]@{ ProcessName=$_.Name; CommandLine=$_.CommandLine } }; [KangKangPwaWindows]::GetAll() | ForEach-Object { $process=$processes[[int]$_.Id]; [pscustomobject]@{ Id=$_.Id; ProcessName=$process.ProcessName; MainWindowTitle=$_.MainWindowTitle; MainWindowHandle=$_.MainWindowHandle; Minimized=$_.Minimized; CommandLine=$process.CommandLine } } | ConvertTo-Json -Compress";
  const result = await runCommand(script);
  if (!result?.ok || !result.output.trim()) return null;
  let windows;
  try { windows = JSON.parse(result.output); } catch (_) { return null; }
  const candidates = Array.isArray(windows) ? windows : [windows];
  return candidates.find((candidate) => {
    const title = asText(candidate?.MainWindowTitle, 1000).toLowerCase();
    const processName = asText(candidate?.ProcessName, 120).replace(/\.exe$/i, '').toLowerCase();
    const commandLine = asText(candidate?.CommandLine, 4000).toLowerCase();
    const titleMatches = config.windowTitleKeywords.length > 0 && config.windowTitleKeywords.some((keyword) => title.includes(keyword));
    const processMatches = config.processNames.length > 0 && config.processNames.includes(processName);
    if (installedPwa) {
      // A regular browser tab can have the same title and process as the PWA.
      // Only reuse a window when its command line carries the installed app
      // marker (app-id/app URL), and optionally use owner/title as a sanity check.
      const markerMatches = matchesInstalledPwaCommand(commandLine, installedPwa);
      const ownerMatches = !installedPwa.processName || processName === installedPwa.processName;
      return markerMatches && ownerMatches && (!titleMatches || markerMatches);
    }
    return (!config.windowTitleKeywords.length || titleMatches) && (!config.processNames.length || processMatches);
  }) || null;
}

async function findInstalledPwaShortcut(config, runCommand = runPowerShell) {
  if (process.platform !== 'win32' || (!config.url && !config.windowTitleKeywords.length)) return null;
  const script = String.raw`$ErrorActionPreference='Stop'; $OutputEncoding=[System.Text.Encoding]::UTF8; [Console]::OutputEncoding=[System.Text.Encoding]::UTF8; $items=@(); $shell=New-Object -ComObject WScript.Shell; $roots=@([Environment]::GetFolderPath('StartMenu'),[Environment]::GetFolderPath('CommonStartMenu'),[Environment]::GetFolderPath('Desktop'),[Environment]::GetFolderPath('CommonDesktopDirectory')) | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -Unique; foreach($root in $roots){ Get-ChildItem -LiteralPath $root -Filter '*.lnk' -File -Recurse -ErrorAction SilentlyContinue | ForEach-Object { try { $shortcut=$shell.CreateShortcut($_.FullName); $arguments=[string]$shortcut.Arguments; $appId=''; $profile=''; $appUrl=''; if($arguments -match '(?i)--app-id(?:=|\s+)(?:"([^"]+)"|([^\s]+))'){ $appId=($Matches[1]+$Matches[2]).Trim() }; if($arguments -match '(?i)--profile-directory(?:=|\s+)(?:"([^"]+)"|([^\s]+))'){ $profile=($Matches[1]+$Matches[2]).Trim() }; if($arguments -match '(?i)--app(?:=|\s+)(?:"(https?://[^"]+)"|(https?://[^\s]+))'){ $appUrl=($Matches[1]+$Matches[2]).Trim() }; if($appId -or $appUrl){ $items += [pscustomobject]@{ Path=$_.FullName; TargetPath=$shortcut.TargetPath; Name=$_.BaseName; Description=$shortcut.Description; AppId=$appId; Profile=$profile; AppUrl=$appUrl; Source='shortcut' } } } catch {} } }; $registryRoots=@('HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall','HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall','HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall'); foreach($root in $registryRoots){ if(!(Test-Path $root)){continue}; Get-ChildItem $root -ErrorAction SilentlyContinue | ForEach-Object { try { $entry=Get-ItemProperty $_.PSPath -ErrorAction Stop; $uninstall=[string]$entry.UninstallString; if($uninstall -notmatch '(?i)--uninstall-app-id(?:=|\s+)([a-z0-9_-]+)'){return}; $appId=$Matches[1]; $profile=''; if($uninstall -match '(?i)--profile-directory(?:=|\s+)(?:"([^"]+)"|([^\s]+))'){ $profile=($Matches[1]+$Matches[2]).Trim() }; $target=''; if($uninstall -match '^\s*"([^"]+\.exe)"'){ $target=$Matches[1] } elseif($uninstall -match '^\s*([^\s]+\.exe)'){ $target=$Matches[1] }; if($target){ $items += [pscustomobject]@{ Path=''; TargetPath=$target; Name=[string]$entry.DisplayName; Description=[string]$entry.Comments; AppId=$appId; Profile=$profile; AppUrl=''; Source='registry' } } } catch {} } }; @($items) | ConvertTo-Json -Compress`;
  const result = await runCommand(script);
  if (!result?.ok || !result.output.trim()) return null;
  try {
    const values = JSON.parse(result.output);
    const candidates = (Array.isArray(values) ? values : [values]).map(normalizeInstalledPwa).filter(Boolean);
    return candidates.map((candidate) => ({ candidate, score: installedPwaScore(candidate, config) }))
      .filter((entry) => entry.score > 0)
      .sort((left, right) => right.score - left.score)[0]?.candidate || null;
  } catch (_) {
    return null;
  }
}

async function activatePwaWindow(windowInfo, runCommand = runPowerShell) {
  const processId = Number(windowInfo?.Id);
  const windowHandle = Number(windowInfo?.MainWindowHandle);
  if ((!Number.isInteger(processId) || processId <= 0) && (!Number.isSafeInteger(windowHandle) || windowHandle <= 0)) return false;
  if (process.platform !== 'win32') return false;
  const script = "$ErrorActionPreference='Stop'; Add-Type @'\nusing System; using System.Runtime.InteropServices; public static class KangKangPwaWindow { [DllImport(\"user32.dll\")] static extern bool IsWindow(IntPtr hWnd); [DllImport(\"user32.dll\")] static extern bool IsIconic(IntPtr hWnd); [DllImport(\"user32.dll\")] static extern bool ShowWindowAsync(IntPtr hWnd, int command); [DllImport(\"user32.dll\")] static extern bool BringWindowToTop(IntPtr hWnd); [DllImport(\"user32.dll\")] static extern bool SetForegroundWindow(IntPtr hWnd); [DllImport(\"user32.dll\")] static extern IntPtr SetActiveWindow(IntPtr hWnd); [DllImport(\"user32.dll\")] static extern IntPtr GetForegroundWindow(); [DllImport(\"user32.dll\")] static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId); [DllImport(\"kernel32.dll\")] static extern uint GetCurrentThreadId(); [DllImport(\"user32.dll\")] static extern bool AttachThreadInput(uint attach, uint attachTo, bool value); public static bool Activate(long value) { var hWnd=new IntPtr(value); if(!IsWindow(hWnd)) return false; ShowWindowAsync(hWnd, IsIconic(hWnd) ? 9 : 5); var foreground=GetForegroundWindow(); uint ignored; var currentThread=GetCurrentThreadId(); var targetThread=GetWindowThreadProcessId(hWnd,out ignored); var foregroundThread=foreground==IntPtr.Zero ? 0 : GetWindowThreadProcessId(foreground,out ignored); if(foregroundThread!=0 && foregroundThread!=currentThread) AttachThreadInput(currentThread,foregroundThread,true); if(targetThread!=0 && targetThread!=currentThread) AttachThreadInput(currentThread,targetThread,true); BringWindowToTop(hWnd); SetActiveWindow(hWnd); var result=SetForegroundWindow(hWnd); if(targetThread!=0 && targetThread!=currentThread) AttachThreadInput(currentThread,targetThread,false); if(foregroundThread!=0 && foregroundThread!=currentThread) AttachThreadInput(currentThread,foregroundThread,false); return result || GetForegroundWindow()==hWnd; } }\n'@; $handle=0; [long]::TryParse([string]$env:KANGKANGPET_PWA_WINDOW_HANDLE,[ref]$handle) | Out-Null; if($handle -le 0){ $process=Get-Process -Id $env:KANGKANGPET_PWA_PROCESS_ID -ErrorAction Stop; $handle=[long]$process.MainWindowHandle }; if([KangKangPwaWindow]::Activate($handle)){exit 0}else{exit 1}";
  const result = await runCommand(script, { env: { ...process.env, KANGKANGPET_PWA_PROCESS_ID: String(processId || ''), KANGKANGPET_PWA_WINDOW_HANDLE: String(windowHandle || '') } });
  return Boolean(result?.ok);
}

function launchConfiguredCommand(command, launch = spawn) {
  if (!command) return false;
  try {
    const child = launch(command.file, command.args, { detached: true, stdio: 'ignore', windowsHide: true, shell: false });
    child.once?.('error', () => {});
    child.unref?.();
    return true;
  } catch (_) {
    return false;
  }
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function findAndActivatePwa(config, installedPwa, { findWindow, activateWindow, delay, log }, attempts = 1) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const candidate = await findWindow(config, installedPwa).catch((error) => { log('查找目标 PWA 窗口失败。', error); return null; });
    if (candidate && await activateWindow(candidate).catch((error) => { log('激活目标 PWA 窗口失败。', error); return false; })) return true;
    if (attempt + 1 < attempts) await delay(300);
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
  const installedPwa = await findInstalledShortcut(config).catch((error) => { log('查找已安装目标 PWA 失败。', error); return null; });
  if (await findAndActivatePwa(config, installedPwa, { findWindow, activateWindow, delay, log })) return { ok: true, reused: true, message: '已唤起目标 PWA。' };

  if (installedPwa) {
    let accepted = false;
    if (installedPwa.file && installedPwa.args.length) {
      accepted = launch({ file: installedPwa.file, args: installedPwa.args }) === true;
      if (accepted && await findAndActivatePwa(config, installedPwa, { findWindow, activateWindow, delay, log }, 16)) {
        return { ok: true, launched: true, installed: true, message: '已打开已安装的目标 PWA。' };
      }
    }
    if (installedPwa.path && typeof openPath === 'function') {
      const openedShortcut = await openInstalledPwaShortcut(installedPwa, openPath);
      accepted = openedShortcut || accepted;
      if (openedShortcut && await findAndActivatePwa(config, installedPwa, { findWindow, activateWindow, delay, log }, 12)) {
        return { ok: true, launched: true, installed: true, message: '已打开已安装的目标 PWA。' };
      }
    }
    // Never hand an installed Chrome/Chromium PWA URL to a different default browser.
    if (accepted) return { ok: true, launched: true, installed: true, message: '已调用安装该应用的浏览器启动目标 PWA。' };
  }

  if (config.launchCommand) {
    const launched = launch(config.launchCommand);
    if (launched) {
      if (await findAndActivatePwa(config, null, { findWindow, activateWindow, delay, log }, 12)) return { ok: true, launched: true, message: '已打开目标 PWA。' };
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

module.exports = { DEFAULT_PWA_CONFIG, normalizePwaConfig, normalizeLaunchCommand, normalizeInstalledPwa, installedPwaScore, hasPwaLaunchMarker, matchesInstalledPwaCommand, findPwaWindow, findInstalledPwaShortcut, activatePwaWindow, launchConfiguredCommand, openInstalledPwaShortcut, openPwa };
