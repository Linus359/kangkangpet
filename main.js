'use strict';

const { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, Notification, powerMonitor, screen, shell, Tray } = require('electron');
const { autoUpdater } = require('electron-updater');
const crypto = require('crypto');
const fs = require('fs');
const https = require('https');
const path = require('path');
const { pathToFileURL } = require('url');
const { ConfigStore } = require('./src/main/config-store');
const { NOTE_VERSION, NotesStore, normalizeNote } = require('./src/main/notes-store');
const { DEFAULT_PWA_CONFIG, normalizePwaConfig, openPwa } = require('./src/main/pwa-launcher');
const { DEFAULT_TIME_ZONES, normalizeAnniversaries, normalizeCalendarViewMode, normalizeTimeZones } = require('./src/main/productivity-tools');
const { ChinaHolidayService } = require('./src/main/holiday-service');
const { USHolidayService } = require('./src/main/us-holiday-service');
const { Logger } = require('./src/main/logger');
const { migrateLegacyPayload } = require('./src/main/migration');
const { parseReminderBackup, parseReminderCsv, parseReminderText, parseReminderXlsx, serializeReminderBackup } = require('./src/main/reminder-backup');
const { ReminderScheduler } = require('./src/main/reminder-scheduler');
const { applyReminderBulkAction, mergeImportedReminders, normalizeReminders, normalizeSource, sortReminders, validateReminder } = require('./src/main/reminders');
const { DEFAULT_PET_SIZE, MAX_PET_SIZE, MIN_PET_SIZE, chooseDefaultAsset, clampPetPosition, defaultPetPosition, getPetBounds: calculatePetBounds, normalizePetSize } = require('./src/main/pet-layout');
const { ForcomeCliManager, resolveForcomeCliPaths } = require('./src/main/forcome-cli');
const { ensureWindowBoundsVisible } = require('./src/main/window-layout');
const {
  DEFAULT_DIFY_BASE_URL,
  DEFAULT_EMPLOYEE_POLICY_SETTINGS,
  EMPLOYEE_POLICY_MANAGER,
  loadEffectivePolicy,
  mergeEmployeePolicyReminders,
  normalizePolicySettings,
  policyRevision,
  syncDifyPolicy,
  writeJsonAtomic
} = require('./src/main/employee-policy');

// The app does not render WebGPU content. Keeping Chromium on the D3D11/ANGLE path
// lets packaged builds omit the optional D3D12 WebGPU and Vulkan fallback binaries.
app.commandLine.appendSwitch('disable-features', 'WebGPU,Vulkan,DefaultANGLEVulkan,VulkanFromANGLE');

const APP_NAME = '康康熊桌宠';
const APP_ID = 'com.forcome.kangkangpet';
const RELEASE_NOTES_URL = 'https://api.github.com/repos/Linus359/kangkangpet/releases?per_page=100';
const ASSET_DIR_NAME = 'cat';
const ALLOWED_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.webm', '.mp4', '.mov', '.gif']);
const REMINDER_MEDIA_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.mp3', '.wav', '.m4a', '.aac', '.ogg', '.flac', '.webm', '.mp4', '.mov']);
const REMINDER_TEXT_EXTENSIONS = new Set(['.txt', '.md', '.log']);
const ASSET_PATCH_FIELDS = new Set(['enabled', 'actionKey', 'behavior', 'interactionButtonIds']);

const actionKeywordRules = [
  ['sleep', ['休息', '睡觉', '打盹', '休憩', '趴地睡觉', '床上睡觉', '坐姿打盹', '伸懒腰']],
  ['eat', ['饮食', '吃', '喝', '水', '饮料', '汉堡', '饼干', '爆米花']],
  ['walk', ['移动', '行走', '走路', '奔跑', '跑', '跳跃']],
  ['greet', ['挥手', '打招呼', '告别', '拇指', '鼓掌', '欢呼']],
  ['work', ['办公', '笔记本', '电脑', '阅读', '书本', '看书', '台式机', '工具箱']],
  ['clean', ['扫地', '拖地', '浇水', '洗澡']],
  ['exercise', ['足球', '杠铃', '锻炼', '跳舞', '哑铃']],
  ['happy', ['微笑', '开心', '大笑', '欢呼', '闪光', '害羞', '脸红']],
  ['sad', ['哭', '伤心', '委屈', '寒冷', '发抖']],
  ['angry', ['生气', '抱臂生气', '冒汽', '握拳']],
  ['think', ['思考', '问号', '疑惑', '托腮', '对话框', '省略号']],
  ['surprise', ['惊讶', '慌张', '流汗', '头晕', '眼花', '困倦']],
  ['idle', ['待机', '站立', '自然', '背手', '双手交叠']]
];

const defaultInteractionButtons = [
  { id: 'pat', label: '摸摸康康熊', actionKeys: ['happy', 'greet', 'idle'], responses: ['康康熊被摸摸了，心情变好了。', '嘿嘿，康康熊收到你的关心啦。', '再摸一下也不是不行。'] },
  { id: 'call', label: '叫康康熊', actionKeys: ['greet', 'think', 'surprise'], responses: ['康康熊在呢，有什么安排？', '收到，我听见你叫我啦。', '康康熊上线，准备陪你工作。'] },
  { id: 'feed', label: '喂康康熊', actionKeys: ['eat', 'happy'], responses: ['谢谢投喂，康康熊能量恢复中。', '这份补给不错，继续加油。'] },
  { id: 'work', label: '开始工作', actionKeys: ['work', 'think', 'clean'], responses: ['进入工作模式，康康熊陪你专注一下。', '先做最重要的一件事。'] }
];

const defaultActionMessages = {
  idle: ['康康熊安静待机中。', '它正在桌面角落陪你。'], happy: ['康康熊看起来心情不错。'], greet: ['康康熊挥了挥手。'],
  eat: ['康康熊进入补充能量时间。'], sleep: ['康康熊休息一会儿。'], walk: ['康康熊在桌面巡逻。'],
  work: ['康康熊开始认真办公。'], clean: ['康康熊帮你把状态整理一下。'], exercise: ['康康熊短暂运动了一下。'],
  think: ['康康熊正在思考。'], surprise: ['康康熊被提醒了一下。'], sad: ['康康熊有点小情绪，需要安慰。'], angry: ['康康熊有点不满，但很快会缓过来。']
};

const defaultConfig = {
  configVersion: 8,
  reminderFeatureVersion: 4,
  size: DEFAULT_PET_SIZE,
  autoLaunch: false,
  position: null,
  panelBounds: null,
  activeAssetId: null,
  assets: [],
  interactionButtons: defaultInteractionButtons,
  responses: ['康康熊在这里陪你。', '收到，继续加油。', '康康熊短暂地认可了你的操作。'],
  idleMessages: ['康康熊正在按自己的节奏陪伴你。', '今天也要稳稳推进。', '如果累了，就休息两分钟。'],
  actionMessages: defaultActionMessages,
  reminders: [],
  reminderDrafts: [],
  pwa: DEFAULT_PWA_CONFIG,
  cliAutoReconnect: true,
  petLowResourceMode: true,
  doNotDisturbMode: false,
  timeZones: DEFAULT_TIME_ZONES,
  anniversaries: [],
  chinaHolidayEnabled: true,
  usHolidayEnabled: false,
  calendarViewMode: 'month',
  employeePolicy: DEFAULT_EMPLOYEE_POLICY_SETTINGS
};

let config;
let configPath;
let mediaDir;
let configStore;
let employeePolicyPaths;
let employeePolicyReadingStatePath;
let employeePolicyReadingState = { recentTips: [] };
let employeePolicyTimer = null;
let employeePolicySyncPromise = null;
let employeePolicyAbortController = null;
let employeePolicySprinkleTimer = null;
let employeePolicySprinkleDay = '';
const employeePolicySprinkleTriggered = new Set();
let notesStore;
let notes = [];
let logger;
let scheduler;
let holidayService;
let usHolidayService;
let forcomeCli;
let petWindow;
let panelWindow;
let quickReminderWindow;
let tray;
let saveTimer;
let notesSaveTimer;
let petWindowDestroyTimer = null;
let pwaOpenPromise = null;
const noteWindows = new Map();
const noteWindowIds = new Map();
const pendingNoteBounds = new Map();
const deletingNoteIds = new Set();
let isQuitting = false;
let shutdownCleanupStarted = false;
let shutdownCleanupComplete = false;
let pendingPetLayout = null;
let petLayoutScheduled = false;
let petLayoutState = null;
let petDragState = null;
let petLayoutDeferredDuringDrag = false;
let updaterConfigured = false;
let updaterCheckPromise = null;
let updaterDownloadPromise = null;
let updaterPromptVersion = null;
let updaterInstalling = false;
let updaterShutdownPromise = null;
let updaterState = { status: 'idle', version: null, message: '尚未检查更新。', percent: null, bytesPerSecond: 0, transferred: 0, total: 0 };
let forcomeStatus = { available: false, authenticated: false, connectorRunning: false, externalConnectorRunning: false };
let forcomeSupervisorTimer = null;
let forcomeReconnectAttempt = 0;
let forcomeRefreshPromise = null;
let forcomeStatusWatchPath = null;
let connectorManuallyPaused = false;
const trayStatusIcons = new Map();
const FORCOME_HEALTH_CHECK_MS = 2 * 60 * 1000;
const FORCOME_RECONNECT_DELAYS_MS = [5000, 15000, 30000, 60000, 120000];

function writeLog(message, error = null) {
  if (logger) logger.write(message, error);
}

function publicUpdaterState() {
  return app.isPackaged
    ? { ...updaterState }
    : { status: 'unavailable', version: app.getVersion(), message: '开发环境不检查更新。' };
}

function broadcastUpdaterState() {
  if (panelWindow && !panelWindow.isDestroyed()) panelWindow.webContents.send('app:update-status', publicUpdaterState());
}

function setUpdaterState(next) {
  updaterState = { ...updaterState, ...next };
  broadcastUpdaterState();
}

function configureAutoUpdater() {
  if (updaterConfigured || !app.isPackaged) return;
  updaterConfigured = true;
  // Keep the decision in the user's hands. electron-updater still uses its
  // NSIS differential downloader when the previous block map/cache is
  // available, but never starts a large download without confirmation.
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.autoRunAppAfterInstall = true;
  autoUpdater.disableDifferentialDownload = false;
  autoUpdater.disableWebInstaller = true;
  autoUpdater.on('checking-for-update', () => setUpdaterState({ status: 'checking', message: '正在检查更新...', percent: null, bytesPerSecond: 0, transferred: 0, total: 0 }));
  autoUpdater.on('error', (error) => {
    updaterDownloadPromise = null;
    updaterPromptVersion = null;
    setUpdaterState({ status: 'error', version: null, message: '更新失败，请稍后重试。', percent: null, bytesPerSecond: 0, transferred: 0, total: 0 });
    writeLog('在线更新检查失败。', error);
  });
  autoUpdater.on('update-available', (info) => {
    setUpdaterState({ status: 'awaiting-confirmation', version: info.version, message: `发现新版本 ${info.version}，等待确认下载。`, percent: 0, bytesPerSecond: 0, transferred: 0, total: 0 });
    writeLog(`发现在线更新：${info.version}。`);
    promptAndDownloadUpdate(info).catch((error) => writeLog('更新确认流程失败。', error));
  });
  autoUpdater.on('update-not-available', () => setUpdaterState({ status: 'latest', version: app.getVersion(), message: `当前已是最新版本（${app.getVersion()}）。`, percent: null, bytesPerSecond: 0, transferred: 0, total: 0 }));
  autoUpdater.on('download-progress', (progress) => {
    const percent = Number.isFinite(progress?.percent) ? Math.max(0, Math.min(100, progress.percent)) : null;
    const bytesPerSecond = Number.isFinite(progress?.bytesPerSecond) ? Math.max(0, progress.bytesPerSecond) : 0;
    const transferred = Number.isFinite(progress?.transferred) ? Math.max(0, progress.transferred) : 0;
    const total = Number.isFinite(progress?.total) ? Math.max(0, progress.total) : 0;
    const speed = bytesPerSecond > 0 ? ` · ${(bytesPerSecond / 1024 / 1024).toFixed(1)} MB/s` : '';
    setUpdaterState({ status: 'downloading', percent, bytesPerSecond, transferred, total, message: percent == null ? '正在下载更新...' : `正在下载更新 ${percent.toFixed(0)}%${speed}` });
  });
  autoUpdater.on('update-downloaded', (info) => {
    updaterDownloadPromise = null;
    setUpdaterState({ status: 'installing', version: info.version, message: `新版本 ${info.version} 已下载，正在重启安装...`, percent: null, bytesPerSecond: 0, transferred: 0, total: 0 });
    writeLog(`在线更新已下载：${info.version}，准备自动重启安装。`);
    if (updaterInstalling) return;
    updaterInstalling = true;
    // Stop the embedded connector first so Windows can replace every bundled
    // file cleanly. The updater then exits this process and starts the NSIS
    // installer, which relaunches KangKangPet when installation is complete.
    updaterShutdownPromise = Promise.resolve()
      .then(() => { isQuitting = true; scheduler?.stop(); clearTimeout(forcomeSupervisorTimer); if (forcomeStatusWatchPath) fs.unwatchFile(forcomeStatusWatchPath); flushPendingNoteBounds(); saveConfigNow(); return forcomeCli?.stopConnector(); })
      .catch((error) => writeLog('更新安装前停止 FORCOME AI 连接器失败。', error))
      .finally(() => {
        setTimeout(() => {
          try { autoUpdater.quitAndInstall(true, true); }
          catch (error) { updaterInstalling = false; isQuitting = false; setUpdaterState({ status: 'error', version: info.version, message: '安装更新失败，请稍后重试。' }); writeLog('自动安装更新失败。', error); }
        }, 150);
      });
  });
}

async function promptAndDownloadUpdate(info) {
  const version = info?.version || null;
  if (!version || updaterDownloadPromise || updaterPromptVersion === version) return;
  updaterPromptVersion = version;
  const options = {
    type: 'info',
    title: `${APP_NAME} 更新`,
    message: `发现新版本 ${version}`,
    detail: '是否现在下载更新？下载完成后程序会自动重启并完成安装。选择“稍后”不会影响当前使用。',
    buttons: ['立即更新', '稍后'],
    defaultId: 0,
    cancelId: 1,
    noLink: true
  };
  const parent = panelWindow && !panelWindow.isDestroyed() ? panelWindow : null;
  const result = parent ? await dialog.showMessageBox(parent, options) : await dialog.showMessageBox(options);
  if (result.response !== 0) {
    updaterPromptVersion = null;
    setUpdaterState({ status: 'deferred', version, message: `已暂缓更新 ${version}，可稍后点击“检查更新”。`, percent: null, bytesPerSecond: 0, transferred: 0, total: 0 });
    writeLog(`用户暂缓在线更新：${version}。`);
    return { status: 'deferred', version };
  }
  setUpdaterState({ status: 'downloading', version, message: '正在下载更新...', percent: 0, bytesPerSecond: 0, transferred: 0, total: 0 });
  updaterDownloadPromise = autoUpdater.downloadUpdate().catch((error) => {
    updaterDownloadPromise = null;
    updaterPromptVersion = null;
    setUpdaterState({ status: 'error', version, message: '更新下载失败，请稍后重试。', percent: null, bytesPerSecond: 0, transferred: 0, total: 0 });
    writeLog('在线更新下载失败。', error);
    return null;
  });
  await updaterDownloadPromise;
  return { status: 'downloading', version };
}

async function checkForUpdates() {
  if (!app.isPackaged) {
    const result = { status: 'unavailable', version: app.getVersion(), message: '开发环境不检查更新。' };
    setUpdaterState(result);
    return result;
  }
  configureAutoUpdater();
  if (updaterCheckPromise) return updaterCheckPromise;

  setUpdaterState({ status: 'checking', message: '正在检查更新...' });
  updaterCheckPromise = Promise.resolve()
    .then(() => autoUpdater.checkForUpdates())
    .then((result) => {
      if (result?.isUpdateAvailable) {
        const version = result.updateInfo?.version || updaterState.version;
        const next = ['awaiting-confirmation', 'downloading', 'deferred', 'installing'].includes(updaterState.status)
          ? updaterState
          : { status: 'awaiting-confirmation', version: version || null, message: version ? `发现新版本 ${version}，等待确认下载。` : '发现新版本，等待确认下载。' };
        setUpdaterState(next);
        return next;
      }
      const next = { status: 'latest', version: app.getVersion(), message: `当前已是最新版本（${app.getVersion()}）。` };
      setUpdaterState(next);
      return next;
    })
    .catch((error) => {
      const next = { status: 'error', version: null, message: '检查更新失败，请稍后重试。' };
      setUpdaterState(next);
      writeLog('无法启动在线更新检查。', error);
      return next;
    })
    .finally(() => { updaterCheckPromise = null; });
  return updaterCheckPromise;
}

function setupAutoUpdater() {
  if (!app.isPackaged) return;
  configureAutoUpdater();
  checkForUpdates().catch((error) => writeLog('无法启动在线更新检查。', error));
}

function getReleaseNotes() {
  return new Promise((resolve) => {
    const request = https.get(RELEASE_NOTES_URL, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'KangKangPet' } }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { body += chunk; });
      response.on('end', () => {
        if (response.statusCode !== 200) return resolve({ ok: false, error: '暂时无法读取更新说明。', releases: [] });
        try {
          const releases = JSON.parse(body);
          if (!Array.isArray(releases)) throw new Error('Unexpected release payload');
          resolve({ ok: true, releases: releases.filter((item) => !item.draft).map((item) => ({ version: item.name || item.tag_name || '未命名版本', publishedAt: item.published_at || item.created_at || null, body: item.body || '暂无更新说明。', url: item.html_url || '' })) });
        } catch (error) {
          writeLog('解析更新说明失败。', error);
          resolve({ ok: false, error: '更新说明格式无法识别。', releases: [] });
        }
      });
    });
    request.setTimeout(8000, () => request.destroy());
    request.on('error', (error) => { writeLog('读取更新说明失败。', error); resolve({ ok: false, error: '读取更新说明失败，请检查网络。', releases: [] }); });
  });
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function asList(value, fallback) {
  const result = (Array.isArray(value) ? value : fallback).map((item) => String(item || '').trim()).filter(Boolean);
  return result.length ? result : fallback;
}

function inferActionKey(fileName) {
  const baseName = path.basename(String(fileName || ''), path.extname(String(fileName || '')));
  for (const [actionKey, keywords] of actionKeywordRules) {
    if (keywords.some((keyword) => baseName.includes(keyword))) return actionKey;
  }
  return 'idle';
}

function inferAssetBehavior(fileName) {
  const baseName = path.basename(String(fileName || ''), path.extname(String(fileName || '')));
  return /(待机|站立|休息|睡觉)/.test(baseName) ? 'still' : 'motion';
}

function safeFileName(fileName) {
  return path.basename(String(fileName || '')).replace(/[<>:"/\\|?*\x00-\x1F]+/g, '_');
}

function isDeletedAssetName(fileName) {
  return path.basename(String(fileName || ''), path.extname(String(fileName || ''))).includes('-del');
}

function normalizeButton(item, fallback = {}) {
  return {
    id: String(item?.id || fallback.id || crypto.randomUUID()),
    label: String(item?.label || fallback.label || '').trim().slice(0, 40),
    actionKeys: asList(item?.actionKeys, fallback.actionKeys || []).slice(0, 30),
    responses: asList(item?.responses, fallback.responses || []).slice(0, 50)
  };
}

function normalizeButtons(items) {
  const fallbackById = new Map(defaultInteractionButtons.map((item) => [item.id, item]));
  const source = Array.isArray(items) ? items : defaultInteractionButtons;
  const used = new Set();
  const result = source.map((item) => normalizeButton(item, fallbackById.get(item?.id))).filter((item) => {
    if (!item.label || used.has(item.id)) return false;
    used.add(item.id);
    return true;
  });
  return result.length ? result : defaultInteractionButtons.map((item) => ({ ...item }));
}

function normalizeAsset(asset, buttonIds) {
  const name = String(asset?.name || '').trim();
  const extension = String(asset?.extension || path.extname(name).slice(1) || '').toLowerCase();
  const actionKey = String(asset?.actionKey || inferActionKey(name)).trim() || 'idle';
  const linked = Array.isArray(asset?.interactionButtonIds)
    ? [...new Set(asset.interactionButtonIds.map(String).filter((id) => buttonIds.has(id)))]
    : defaultInteractionButtons
      .filter((button) => buttonIds.has(button.id) && button.actionKeys.includes(actionKey))
      .map((button) => button.id);
  return {
    id: String(asset?.id || crypto.randomUUID()),
    name,
    path: String(asset?.path || ''),
    type: asset?.type === 'video' || ['webm', 'mp4', 'mov'].includes(extension) ? 'video' : 'image',
    extension,
    actionKey,
    behavior: asset?.behavior === 'still' ? 'still' : inferAssetBehavior(name),
    enabled: asset?.enabled !== false,
    default: asset?.default === true,
    processedPath: String(asset?.processedPath || ''),
    contentBounds: asset?.contentBounds && Number.isFinite(asset.contentBounds.width) && Number.isFinite(asset.contentBounds.height)
      ? { left: Math.max(0, Math.round(asset.contentBounds.left || 0)), top: Math.max(0, Math.round(asset.contentBounds.top || 0)), width: Math.max(1, Math.round(asset.contentBounds.width)), height: Math.max(1, Math.round(asset.contentBounds.height)) }
      : null,
    transparency: asset?.transparency && typeof asset.transparency === 'object' ? asset.transparency : null,
    interactionButtonIds: linked,
    createdAt: asset?.createdAt || new Date().toISOString()
  };
}

function normalizeBounds(bounds) {
  if (!bounds || ![bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite)) return null;
  return { x: Math.round(bounds.x), y: Math.round(bounds.y), width: clamp(Math.round(bounds.width), 760, 1800), height: clamp(Math.round(bounds.height), 560, 1200) };
}

function normalizeReminderDraft(draft = {}) {
  const sourceType = String(draft.sourceType || draft.type || 'text').toLowerCase();
  const type = ['image', 'audio', 'video', 'text'].includes(sourceType) ? sourceType : 'text';
  return {
    id: String(draft.id || crypto.randomUUID()),
    title: String(draft.title || draft.sourceName || '待排期提醒').trim().slice(0, 120) || '待排期提醒',
    message: String(draft.message || draft.text || '').trim().slice(0, 4000),
    sourceType: type,
    sourceName: String(draft.sourceName || draft.name || '').trim().slice(0, 240),
    path: String(draft.path || '').slice(0, 2000),
    createdAt: String(draft.createdAt || new Date().toISOString())
  };
}

function normalizeReminderDrafts(items) {
  const seen = new Set();
  return (Array.isArray(items) ? items : []).map(normalizeReminderDraft).filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

function normalizeConfig(raw) {
  const next = { ...defaultConfig, ...(raw && typeof raw === 'object' ? raw : {}) };
  const legacyDefaultSize = Number(next.configVersion || 0) < 3 && Number(next.size) === 260;
  next.configVersion = 8;
  next.reminderFeatureVersion = 4;
  next.size = normalizePetSize(legacyDefaultSize ? DEFAULT_PET_SIZE : next.size);
  next.autoLaunch = next.autoLaunch === true;
  next.cliAutoReconnect = next.cliAutoReconnect !== false;
  next.petLowResourceMode = next.petLowResourceMode !== false;
  next.doNotDisturbMode = next.doNotDisturbMode === true;
  delete next.tapFeedbackEnabled;
  next.timeZones = normalizeTimeZones(next.timeZones);
  next.anniversaries = normalizeAnniversaries(next.anniversaries);
  next.chinaHolidayEnabled = next.chinaHolidayEnabled !== false;
  next.usHolidayEnabled = next.usHolidayEnabled === true;
  delete next.holidaySettings;
  next.calendarViewMode = normalizeCalendarViewMode(next.calendarViewMode);
  next.employeePolicy = normalizePolicySettings(next.employeePolicy);
  next.interactionButtons = normalizeButtons(next.interactionButtons);
  const buttonIds = new Set(next.interactionButtons.map((button) => button.id));
  next.assets = (Array.isArray(next.assets) ? next.assets : []).map((asset) => normalizeAsset(asset, buttonIds));
  next.responses = asList(next.responses, defaultConfig.responses);
  next.idleMessages = asList(next.idleMessages, defaultConfig.idleMessages);
  next.actionMessages = { ...defaultActionMessages, ...(next.actionMessages && typeof next.actionMessages === 'object' ? next.actionMessages : {}) };
  for (const [key, value] of Object.entries(next.actionMessages)) next.actionMessages[key] = asList(value, defaultActionMessages[key] || defaultConfig.idleMessages);
  next.reminders = normalizeReminders(next.reminders);
  next.reminderDrafts = normalizeReminderDrafts(next.reminderDrafts);
  next.pwa = normalizePwaConfig(next.pwa);
  next.panelBounds = normalizeBounds(next.panelBounds);
  next.position = next.position && Number.isFinite(next.position.x) && Number.isFinite(next.position.y)
    ? { x: Math.round(next.position.x), y: Math.round(next.position.y) }
    : null;
  if (!next.assets.some((asset) => asset.enabled && asset.id === next.activeAssetId && asset.transparency?.usable !== false)) {
    next.activeAssetId = chooseDefaultAsset(next.assets)?.id || null;
  }
  if (legacyDefaultSize) writeLog('已将旧版默认桌宠大小 260px 迁移为 120px。');
  return next;
}

function ensureStorage() {
  const userData = app.getPath('userData');
  configPath = path.join(userData, 'config.json');
  mediaDir = path.join(userData, 'media');
  fs.mkdirSync(mediaDir, { recursive: true });
  logger = new Logger(path.join(userData, 'logs'));
  configStore = new ConfigStore(configPath, { log: writeLog, normalize: normalizeConfig });
  notesStore = new NotesStore(path.join(userData, 'notes.json'), { log: writeLog });
  holidayService = new ChinaHolidayService({ cachePath: path.join(userData, 'china-holiday-cache.json'), log: writeLog });
  usHolidayService = new USHolidayService({ cachePath: path.join(userData, 'us-holiday-cache.json'), log: writeLog });
  employeePolicyPaths = {
    localPath: path.join(userData, 'employee-policy-local.json'),
    cachePath: path.join(userData, 'employee-policy-cache.json'),
    defaultsPath: path.join(__dirname, 'assets', 'config', 'employee-policy-defaults.json')
  };
  employeePolicyReadingStatePath = path.join(userData, 'employee-policy-reading-state.json');
  loadHandbookReadingState();
}

function visiblePanelBounds(bounds) {
  const normalized = normalizeBounds(bounds) || { width: 1040, height: 780 };
  const displays = screen.getAllDisplays();
  const primaryWorkArea = screen.getPrimaryDisplay().workArea;
  return ensureWindowBoundsVisible(normalized, displays, primaryWorkArea);
}

function restorePanelToVisibleArea() {
  if (!panelWindow || panelWindow.isDestroyed()) return;
  const current = panelWindow.getBounds();
  const visible = visiblePanelBounds(current);
  if (current.x === visible.x && current.y === visible.y && current.width === visible.width && current.height === visible.height) return;
  panelWindow.setBounds(visible);
  config.panelBounds = visible;
  saveConfigSoon();
  writeLog(`控制面板原位置不在当前屏幕内，已移回主屏：${visible.x},${visible.y} ${visible.width}x${visible.height}。`);
}

function bundledAssetsDir() {
  const unpacked = path.join(process.resourcesPath || '', 'app.asar.unpacked', 'assets', ASSET_DIR_NAME);
  return fs.existsSync(unpacked) ? unpacked : path.join(__dirname, 'assets', ASSET_DIR_NAME);
}

function processedAssetsDir() {
  const unpacked = path.join(process.resourcesPath || '', 'app.asar.unpacked', 'assets', 'cat-processed');
  return fs.existsSync(unpacked) ? unpacked : path.join(__dirname, 'assets', 'cat-processed');
}

function processedManifest() {
  const file = path.join(processedAssetsDir(), 'manifest.json');
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return { assets: [] }; }
}

function makeAssetFromFile(sourcePath) {
  const id = crypto.randomUUID();
  const targetPath = path.join(mediaDir, `${id}-${safeFileName(path.basename(sourcePath))}`);
  fs.copyFileSync(sourcePath, targetPath);
  return normalizeAsset({ id, name: path.basename(sourcePath), path: targetPath, enabled: true, createdAt: new Date().toISOString() }, new Set(config.interactionButtons.map((button) => button.id)));
}

function makeProcessedAsset(manifestAsset) {
  const sourcePath = path.join(processedAssetsDir(), path.basename(manifestAsset.output));
  if (!fs.existsSync(sourcePath)) return null;
  const asset = normalizeAsset({ id: crypto.randomUUID(), name: path.basename(manifestAsset.output), path: sourcePath, default: manifestAsset.default, actionKey: manifestAsset.default ? 'idle' : undefined, contentBounds: manifestAsset.contentBounds, transparency: manifestAsset.transparency, enabled: true, createdAt: new Date().toISOString() }, new Set(config.interactionButtons.map((button) => button.id)));
  asset.processedPath = sourcePath;
  return asset;
}

function bundledAssetName(asset) {
  return path.basename(String(asset?.path || '')).replace(/^[0-9a-f-]{36}-/i, '');
}

function migrateBundledAssetsToProcessed() {
  const manifest = processedManifest();
  if (!manifest.assets?.length || !Array.isArray(config.assets)) return;
  const byName = new Map(manifest.assets.map((asset) => [path.basename(asset.output), asset]));
  const activeBefore = config.assets.find((asset) => asset.id === config.activeAssetId);
  let migrated = 0;
  config.assets = config.assets.map((asset) => {
    const processed = byName.get(bundledAssetName(asset));
    if (!processed) return asset;
    const processedPath = path.join(processedAssetsDir(), path.basename(processed.output));
    if (!fs.existsSync(processedPath)) return asset;
    migrated++;
    return normalizeAsset({ ...asset, path: processedPath, processedPath, contentBounds: processed.contentBounds, transparency: processed.transparency, default: processed.default }, new Set(config.interactionButtons.map((button) => button.id)));
  });
  const defaultProcessed = manifest.assets.find((asset) => asset.default);
  if (defaultProcessed && !config.assets.some((asset) => asset.default)) {
    const defaultAsset = makeProcessedAsset(defaultProcessed);
    if (defaultAsset) config.assets.unshift(defaultAsset);
  }
  if (activeBefore && byName.has(bundledAssetName(activeBefore))) {
    config.activeAssetId = chooseDefaultAsset(config.assets)?.id || config.activeAssetId;
    writeLog(`已将旧活动白底素材迁移为透明默认素材：${bundledAssetName(activeBefore)}`);
  }
  if (migrated) writeLog(`已迁移 ${migrated} 个内置素材至透明处理版本。`);
}

function seedBundledAssetsIfNeeded() {
  if (config.assets.some((asset) => asset.path && fs.existsSync(asset.path))) return;
  const manifest = processedManifest();
  if (manifest.assets?.length) {
    const processed = manifest.assets.map(makeProcessedAsset).filter(Boolean);
    if (processed.length) {
      config.assets = processed;
      config.activeAssetId = chooseDefaultAsset(processed)?.id || null;
      writeLog(`已导入 ${processed.length} 个透明处理素材。`);
      return;
    }
  }
  const directory = bundledAssetsDir();
  if (!fs.existsSync(directory)) {
    writeLog(`未找到内置素材目录：${directory}`);
    return;
  }
  const sourceFiles = fs.readdirSync(directory)
    .filter((file) => ALLOWED_EXTENSIONS.has(path.extname(file).toLowerCase()) && !isDeletedAssetName(file))
    .sort((left, right) => left.localeCompare(right, 'zh-Hans-CN'))
    .map((file) => path.join(directory, file));
  config.assets = sourceFiles.map(makeAssetFromFile);
  config.activeAssetId = config.assets.find((asset) => asset.enabled && asset.actionKey === 'idle')?.id || config.assets.find((asset) => asset.enabled)?.id || null;
  writeLog(`已导入 ${config.assets.length} 个内置素材。`);
}

function tryMigrateLegacyReminders() {
  if (config.reminders.length || config.legacyReminderMigrationAttempted) return;
  config.legacyReminderMigrationAttempted = true;
  const legacyPath = path.join(app.getPath('appData'), 'KangKangPet', 'reminders.json');
  if (!fs.existsSync(legacyPath)) return;
  try {
    const backupDir = path.join(app.getPath('userData'), 'migrations');
    fs.mkdirSync(backupDir, { recursive: true });
    fs.copyFileSync(legacyPath, path.join(backupDir, `legacy-reminders-${Date.now()}.json`));
    const migrated = migrateLegacyPayload(JSON.parse(fs.readFileSync(legacyPath, 'utf8')));
    config.reminders = migrated;
    writeLog(`已迁移旧版提醒 ${migrated.length} 条。`);
  } catch (error) {
    writeLog('旧版提醒迁移失败，已保留原文件。', error);
  }
}

function loadConfig() {
  ensureStorage();
  config = configStore.load(defaultConfig);
  notes = notesStore.load().notes.map(normalizeNotePosition).filter(Boolean);
  tryMigrateLegacyReminders();
  applyStoredEmployeePolicy();
  seedBundledAssetsIfNeeded();
  migrateBundledAssetsToProcessed();
  saveConfigNow();
  applyAutoLaunchSetting();
}

function saveConfigNow() {
  if (!configStore || !config) return;
  try {
    configStore.save(config);
  } catch (error) {
    writeLog('无法保存配置。', error);
  }
}

function saveConfigSoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveConfigNow, 180);
}

function publicConfig() {
  const { employeePolicy: _employeePolicy, ...rendererConfig } = config;
  return {
    ...rendererConfig,
    pwa: { ...rendererConfig.pwa, launchCommand: null },
    assets: rendererConfig.assets.map((asset) => ({ ...asset, fileUrl: asset.path && fs.existsSync(asset.path) ? pathToFileURL(asset.path).toString() : null })),
    reminders: rendererConfig.reminders.filter((reminder) => reminder.managedBy !== EMPLOYEE_POLICY_MANAGER).map((reminder) => ({
      ...reminder,
      source: reminder.source
        ? { ...reminder.source, fileUrl: reminder.source.path && fs.existsSync(reminder.source.path) ? pathToFileURL(reminder.source.path).toString() : null }
        : null
    })),
    reminderDrafts: config.reminderDrafts.map((draft) => ({
      ...draft,
      fileUrl: draft.path && fs.existsSync(draft.path) ? pathToFileURL(draft.path).toString() : null
    }))
  };
}

function activePetAsset() {
  return config?.assets?.find((asset) => asset.enabled !== false && asset.id === config.activeAssetId) || chooseDefaultAsset(config?.assets);
}

function petAssetAspect(asset) {
  const width = Number(asset?.contentBounds?.width || asset?.width || 1);
  const height = Number(asset?.contentBounds?.height || asset?.height || 1);
  return clamp(width / Math.max(height, 1), 0.45, 2.4);
}

function stablePetAspect() {
  const enabled = (config?.assets || []).filter((asset) => asset?.enabled !== false && asset?.transparency?.usable !== false);
  return enabled.reduce((maximum, asset) => Math.max(maximum, petAssetAspect(asset)), 0.45);
}

function getPetBounds(bubble = null, assetId = null, menu = null) {
  const displayedAsset = typeof assetId === 'string'
    ? config?.assets?.find((asset) => asset.enabled !== false && asset.id === assetId)
    : null;
  return calculatePetBounds(config.size, displayedAsset || activePetAsset(), bubble, 3, menu, stablePetAspect(), true);
}

function visiblePetPosition(position, bounds) {
  const displays = screen.getAllDisplays();
  const visible = position && displays.some(({ workArea }) => position.x + bounds.width > workArea.x + 24 && position.x < workArea.x + workArea.width - 24 && position.y + bounds.height > workArea.y + 24 && position.y < workArea.y + workArea.height - 24);
  if (visible) {
    const display = screen.getDisplayNearestPoint({
      x: position.x + Math.round(bounds.width / 2),
      y: position.y + bounds.height
    }) || screen.getPrimaryDisplay();
    return clampPetPosition(position, bounds, display.workArea);
  }
  const workArea = screen.getPrimaryDisplay().workArea;
  return defaultPetPosition(workArea, bounds);
}

function petLayoutPosition(current, bounds) {
  const anchor = {
    x: current.x + Math.round(current.width / 2),
    y: current.y + current.height
  };
  const display = screen.getDisplayNearestPoint(anchor) || screen.getPrimaryDisplay();
  return clampPetPosition({
    x: anchor.x - Math.round(bounds.width / 2),
    y: anchor.y - bounds.height
  }, bounds, display.workArea);
}

function resizePetWindow() {
  if (!petWindow || petWindow.isDestroyed() || petDragState) return;
  const layout = petLayoutState;
  const bounds = getPetBounds(layout?.bubble?.visible ? layout.bubble : null, layout?.assetId, layout?.menu);
  const position = visiblePetPosition(config.position || petWindow.getBounds(), bounds);
  const current = petWindow.getBounds();
  const nextBounds = { ...position, ...bounds };
  config.position = position;
  if (current.x === nextBounds.x && current.y === nextBounds.y && current.width === nextBounds.width && current.height === nextBounds.height) return;
  petWindow.setBounds(nextBounds, false);
}

function applyPetLayout(layout) {
  if (!petWindow || petWindow.isDestroyed() || !layout || typeof layout !== 'object') return;
  petLayoutState = layout;
  if (petDragState) {
    petLayoutDeferredDuringDrag = true;
    return;
  }
  const bubble = layout.bubble?.visible ? layout.bubble : null;
  const menu = layout.menu?.visible ? layout.menu : null;
  const bounds = getPetBounds(bubble, layout.assetId, menu);
  const current = petWindow.getBounds();
  if (current.width === bounds.width && current.height === bounds.height) return;
  const position = petLayoutPosition(current, bounds);
  const nextBounds = { ...position, width: bounds.width, height: bounds.height };
  config.position = position;
  if (current.x === nextBounds.x && current.y === nextBounds.y && current.width === nextBounds.width && current.height === nextBounds.height) return;
  petWindow.setBounds(nextBounds, false);
}

function updatePetLayout(layout) {
  if (!layout || typeof layout !== 'object') return;
  pendingPetLayout = layout;
  if (petLayoutScheduled) return;
  petLayoutScheduled = true;
  setImmediate(() => {
    petLayoutScheduled = false;
    const nextLayout = pendingPetLayout;
    pendingPetLayout = null;
    if (nextLayout) applyPetLayout(nextLayout);
  });
}

function broadcastConfig() {
  const payload = publicConfig();
  for (const win of [petWindow, panelWindow]) {
    if (win && !win.isDestroyed()) win.webContents.send('config:changed', payload);
  }
}

function setPetClickThrough(ignore) {
  if (petWindow && !petWindow.isDestroyed()) petWindow.setIgnoreMouseEvents(Boolean(ignore), { forward: true });
}

function createPetWindow() {
  if (petWindow && !petWindow.isDestroyed()) return petWindow;
  const size = getPetBounds();
  const position = visiblePetPosition(config.position, size);
  petWindow = new BrowserWindow({
    ...size,
    ...position,
    frame: false,
    transparent: true,
    resizable: false,
    movable: true,
    hasShadow: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    backgroundColor: '#00000000',
    title: APP_NAME,
    icon: appIconPath() || undefined,
    webPreferences: { preload: path.join(__dirname, 'preload', 'pet-preload.js'), contextIsolation: true, nodeIntegration: false, backgroundThrottling: true, spellcheck: false }
  });
  config.position = position;
  petWindow.setAlwaysOnTop(true, 'screen-saver');
  petWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  petWindow.loadFile('pet.html');
  petWindow.on('show', () => petWindow?.webContents.send('pet:visibility', true));
  petWindow.on('hide', () => petWindow?.webContents.send('pet:visibility', false));
  petWindow.on('closed', () => { petWindow = null; petLayoutState = null; pendingPetLayout = null; });
  petWindow.webContents.on('render-process-gone', (_event, details) => writeLog(`桌宠渲染进程异常：${details.reason}`));
  return petWindow;
}

function createPanelWindow(tab = null) {
  writeLog(`正在创建控制面板窗口${tab ? `（${tab}）` : ''}。`);
  if (panelWindow && !panelWindow.isDestroyed()) {
    restorePanelToVisibleArea();
    panelWindow.show();
    panelWindow.focus();
    if (tab) panelWindow.webContents.send('panel:open-tab', tab);
    return panelWindow;
  }
  const bounds = visiblePanelBounds(config.panelBounds);
  if (config.panelBounds && (bounds.x !== config.panelBounds.x || bounds.y !== config.panelBounds.y || bounds.width !== config.panelBounds.width || bounds.height !== config.panelBounds.height)) {
    config.panelBounds = bounds;
    saveConfigSoon();
    writeLog(`控制面板保存位置不在当前屏幕内，已移回主屏：${bounds.x},${bounds.y} ${bounds.width}x${bounds.height}。`);
  }
  panelWindow = new BrowserWindow({
    ...bounds,
    show: true,
    minWidth: 760,
    minHeight: 560,
    title: `${APP_NAME}控制面板`,
    icon: appIconPath() || undefined,
    backgroundColor: '#f6f4ef',
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload', 'panel-preload.js'), contextIsolation: true, nodeIntegration: false, backgroundThrottling: true, spellcheck: false }
  });
  panelWindow.loadFile('panel.html');
  panelWindow.showInactive();
  panelWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription) => writeLog(`控制面板加载失败：${errorCode} ${errorDescription}`));
  panelWindow.once('ready-to-show', () => {
    writeLog('控制面板已加载并准备显示。');
    panelWindow.show();
    if (tab) panelWindow.webContents.send('panel:open-tab', tab);
  });
  const persistBounds = () => { if (panelWindow && !panelWindow.isDestroyed()) { config.panelBounds = normalizeBounds(panelWindow.getBounds()); saveConfigSoon(); } };
  panelWindow.on('move', persistBounds);
  panelWindow.on('resize', persistBounds);
  panelWindow.on('closed', () => { writeLog('控制面板窗口已关闭。'); panelWindow = null; });
  panelWindow.webContents.on('render-process-gone', (_event, details) => writeLog(`控制面板渲染进程异常：${details.reason}`));
  return panelWindow;
}

function createQuickReminderWindow() {
  if (quickReminderWindow && !quickReminderWindow.isDestroyed()) {
    quickReminderWindow.show();
    quickReminderWindow.focus();
    return quickReminderWindow;
  }
  quickReminderWindow = new BrowserWindow({
    width: 460,
    height: 430,
    resizable: false,
    maximizable: false,
    minimizable: false,
    title: '快速新建提醒',
    icon: appIconPath() || undefined,
    backgroundColor: '#f6f4ef',
    parent: panelWindow || undefined,
    modal: Boolean(panelWindow),
    webPreferences: { preload: path.join(__dirname, 'preload', 'quick-reminder-preload.js'), contextIsolation: true, nodeIntegration: false, backgroundThrottling: true, spellcheck: false }
  });
  quickReminderWindow.setMenuBarVisibility(false);
  quickReminderWindow.loadFile('quick-reminder.html');
  quickReminderWindow.on('closed', () => { quickReminderWindow = null; });
  return quickReminderWindow;
}

function effectiveEmployeePolicy() {
  return loadEffectivePolicy({ ...employeePolicyPaths, sourceMode: config.employeePolicy.sourceMode });
}

function applyStoredEmployeePolicy() {
  const effective = effectiveEmployeePolicy();
  const policy = {
    ...effective.policy,
    reminders: effective.policy.reminders.map((reminder) => ({ ...reminder, enabled: config.employeePolicy.enabled && reminder.enabled && !isHandbookSprinkleRule(reminder.ruleKey) }))
  };
  config.reminders = normalizeReminders(mergeEmployeePolicyReminders(config.reminders, policy, effective));
  config.employeePolicy.currentSource = effective.sourceKind;
  config.employeePolicy.currentPolicyVersion = effective.policy.policyVersion;
  config.employeePolicy.errorCode = null;
  scheduleHandbookSprinkle();
}

function saveEmployeePolicyStatus() {
  saveConfigSoon();
}

const HANDBOOK_WORK_START_MINUTES = 9 * 60;
const HANDBOOK_WORK_END_MINUTES = 18 * 60;
const HANDBOOK_RECENT_TIP_LIMIT = 3;
const HANDBOOK_MIN_BUBBLE_DURATION_MS = 12 * 1000;
const HANDBOOK_MAX_BUBBLE_DURATION_MS = 20 * 1000;
const EMPLOYEE_POLICY_SYNC_TIMEOUT_MS = 30 * 1000;

function isHandbookSprinkleRule(ruleKey) {
  return typeof ruleKey === 'string' && ruleKey.startsWith('tip_');
}

function normalizeHandbookRecentTip(value) {
  if (!value || typeof value !== 'object') return null;
  const ruleKey = typeof value.ruleKey === 'string' ? value.ruleKey.trim().slice(0, 120) : '';
  if (!ruleKey) return null;
  const title = typeof value.title === 'string' ? value.title.trim().slice(0, 160) : '';
  const message = typeof value.message === 'string' ? value.message.trim().slice(0, 1200) : '';
  if (!title && !message) return null;
  return { ruleKey, title, message, shownAt: typeof value.shownAt === 'string' ? value.shownAt : null };
}

function loadHandbookReadingState() {
  try {
    const parsed = JSON.parse(fs.readFileSync(employeePolicyReadingStatePath, 'utf8'));
    const recentTips = Array.isArray(parsed?.recentTips) ? parsed.recentTips.map(normalizeHandbookRecentTip).filter(Boolean).slice(0, HANDBOOK_RECENT_TIP_LIMIT) : [];
    employeePolicyReadingState = { recentTips };
  } catch {
    employeePolicyReadingState = { recentTips: [] };
  }
}

function saveHandbookReadingState() {
  if (!employeePolicyReadingStatePath) return;
  try { writeJsonAtomic(employeePolicyReadingStatePath, employeePolicyReadingState); } catch (error) { writeLog('保存员工守则最近阅读记录失败。', error); }
}

function recordHandbookTip(rule) {
  const entry = normalizeHandbookRecentTip({ ...rule, shownAt: new Date().toISOString() });
  if (!entry) return;
  employeePolicyReadingState.recentTips = [entry, ...employeePolicyReadingState.recentTips.filter((item) => item.ruleKey !== entry.ruleKey)].slice(0, HANDBOOK_RECENT_TIP_LIMIT);
  saveHandbookReadingState();
}

function handbookTipDurationMs(rule) {
  const textLength = `${rule?.title || ''}${rule?.message || ''}`.length;
  return Math.max(HANDBOOK_MIN_BUBBLE_DURATION_MS, Math.min(HANDBOOK_MAX_BUBBLE_DURATION_MS, 9000 + Math.ceil(textLength / 18) * 1000));
}

function localDayKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function minutesSinceMidnight(date) {
  return date.getHours() * 60 + date.getMinutes();
}

function isHandbookWorkday(date) {
  return date.getDay() >= 1 && date.getDay() <= 5;
}

function handbookWeekdayIndex(date) {
  return (date.getDay() + 6) % 7;
}

function resetHandbookSprinkleDay(now = new Date()) {
  const key = localDayKey(now);
  if (employeePolicySprinkleDay !== key) {
    employeePolicySprinkleDay = key;
    employeePolicySprinkleTriggered.clear();
  }
}

function randomHandbookDelayMs() {
  return (45 + Math.floor(Math.random() * 46)) * 60 * 1000;
}

function nextHandbookWorkdayStart(now) {
  const next = new Date(now);
  next.setHours(9, 0, 0, 0);
  do next.setDate(next.getDate() + 1); while (!isHandbookWorkday(next));
  return next;
}

function nextHandbookSprinkleAt(now) {
  const minutes = minutesSinceMidnight(now);
  if (isHandbookWorkday(now) && minutes >= HANDBOOK_WORK_START_MINUTES && minutes < HANDBOOK_WORK_END_MINUTES) {
    const candidate = new Date(now.getTime() + randomHandbookDelayMs());
    if (isHandbookWorkday(candidate) && minutesSinceMidnight(candidate) < HANDBOOK_WORK_END_MINUTES) return candidate;
  }

  const start = isHandbookWorkday(now) && minutes < HANDBOOK_WORK_START_MINUTES
    ? new Date(now)
    : nextHandbookWorkdayStart(now);
  start.setHours(9, 0, 0, 0);
  start.setTime(start.getTime() + randomHandbookDelayMs());
  return start;
}

function handbookTipPool(now, requireCurrentWeekday = true) {
  if (!employeePolicyPaths) return [];
  let effective;
  try { effective = effectiveEmployeePolicy(); } catch { return []; }
  const day = handbookWeekdayIndex(now);
  const rules = Array.isArray(effective.policy.reminders) ? effective.policy.reminders : [];
  const defaultTips = loadEffectivePolicy({ sourceMode: 'local', defaultsPath: employeePolicyPaths.defaultsPath }).policy.reminders
    .filter((rule) => isHandbookSprinkleRule(rule.ruleKey));
  const cachedTips = rules.filter((rule) => isHandbookSprinkleRule(rule.ruleKey));
  const tipSource = Array.from(new Map([...defaultTips, ...cachedTips].map((rule) => [rule.ruleKey, rule])).values());
  if (tipSource.length) {
    return tipSource.filter((rule) => rule?.enabled === true && (!requireCurrentWeekday || (Array.isArray(rule.weekdays) && rule.weekdays.includes(day))));
  }
  return rules.filter((rule) => rule?.enabled === true && (!requireCurrentWeekday || (Array.isArray(rule.weekdays) && rule.weekdays.includes(day))) && Number(String(rule.time || '').split(':')[1]) !== 0);
}

function handbookSprinkleCandidates(now) {
  return handbookTipPool(now).filter((rule) => !employeePolicySprinkleTriggered.has(rule.ruleKey));
}

async function notifyHandbookTip(rule, { replay = false } = {}) {
  if (!rule) return;
  if (!replay) recordHandbookTip(rule);
  await notifyReminder({
    ...rule,
    id: `employee-policy-${replay ? 'reading' : 'sprinkle'}:${rule.ruleKey}`,
    title: `${replay ? '📖' : '💡'} ${String(rule.title || '').replace(/^(💡|📖)\s*/, '')}`,
    notificationMode: 'bubble',
    strongReminder: replay,
    bubbleDurationMs: replay ? undefined : handbookTipDurationMs(rule),
    acknowledgeLabel: replay ? '我看完了' : undefined,
    managedBy: EMPLOYEE_POLICY_MANAGER,
    sourceRuleId: rule.ruleKey
  });
}

async function triggerHandbookTipManually() {
  if (!config?.employeePolicy?.enabled || config.employeePolicy.sprinkleEnabled === false) return;
  const now = new Date();
  resetHandbookSprinkleDay(now);
  const unseen = handbookSprinkleCandidates(now);
  const candidates = unseen.length ? unseen : handbookTipPool(now, false);
  if (!candidates.length) return;
  const rule = candidates[Math.floor(Math.random() * candidates.length)];
  employeePolicySprinkleTriggered.add(rule.ruleKey);
  await notifyHandbookTip(rule);
  scheduleHandbookSprinkle();
}

function replayHandbookTip(entry) {
  const tip = normalizeHandbookRecentTip(entry);
  if (!tip) return;
  notifyHandbookTip(tip, { replay: true }).catch((error) => writeLog('继续阅读员工守则小贴士失败。', error));
}

function handbookTipMenuTemplate() {
  const recentTips = employeePolicyReadingState.recentTips;
  const available = config?.employeePolicy?.enabled && config.employeePolicy.sprinkleEnabled !== false && handbookTipPool(new Date(), false).length > 0;
  const items = [
    { label: '随机来一条小贴士', enabled: available, click: () => triggerHandbookTipManually().catch((error) => writeLog('手动触发员工守则小贴士失败。', error)) },
    { label: '继续阅读上一条', enabled: recentTips.length > 0, click: () => replayHandbookTip(recentTips[0]) }
  ];
  if (recentTips.length) {
    items.push({ label: '最近小贴士', submenu: recentTips.map((tip) => ({ label: (tip.title || tip.message).slice(0, 36), click: () => replayHandbookTip(tip) })) });
  }
  return { label: '员工守则小贴士', submenu: items };
}

async function runHandbookSprinkle() {
  employeePolicySprinkleTimer = null;
  const now = new Date();
  resetHandbookSprinkleDay(now);
  if (!config?.employeePolicy?.enabled || config.employeePolicy.sprinkleEnabled === false) return;

  const minutes = minutesSinceMidnight(now);
  if (isHandbookWorkday(now) && minutes >= HANDBOOK_WORK_START_MINUTES && minutes < HANDBOOK_WORK_END_MINUTES) {
    const candidates = handbookSprinkleCandidates(now);
    if (candidates.length) {
      const rule = candidates[Math.floor(Math.random() * candidates.length)];
      employeePolicySprinkleTriggered.add(rule.ruleKey);
      await notifyHandbookTip(rule);
    }
  }
  scheduleHandbookSprinkle();
}

function scheduleHandbookSprinkle() {
  clearTimeout(employeePolicySprinkleTimer);
  employeePolicySprinkleTimer = null;
  if (!config?.employeePolicy?.enabled || config.employeePolicy.sprinkleEnabled === false) return;
  const now = new Date();
  resetHandbookSprinkleDay(now);
  const minutes = minutesSinceMidnight(now);
  if (isHandbookWorkday(now) && minutes >= HANDBOOK_WORK_START_MINUTES && minutes < HANDBOOK_WORK_END_MINUTES && !handbookSprinkleCandidates(now).length) {
    employeePolicySprinkleTimer = setTimeout(() => scheduleHandbookSprinkle(), Math.max(1000, nextHandbookWorkdayStart(now).getTime() - now.getTime()));
    return;
  }
  const target = nextHandbookSprinkleAt(now);
  employeePolicySprinkleTimer = setTimeout(() => runHandbookSprinkle().catch((error) => {
    writeLog('员工守则随机撒点失败。', error);
    scheduleHandbookSprinkle();
  }), Math.max(1000, target.getTime() - now.getTime()));
}

function startHandbookReminders() {
  scheduleHandbookSprinkle();
}

function stopHandbookReminders() {
  clearTimeout(employeePolicySprinkleTimer);
  employeePolicySprinkleTimer = null;
  employeePolicySprinkleTriggered.clear();
  employeePolicySprinkleDay = '';
}

function scheduleEmployeePolicySync() {
  clearTimeout(employeePolicyTimer);
  if (!config?.employeePolicy?.enabled) return;
  employeePolicyTimer = setTimeout(() => syncEmployeePolicy().catch(() => {}), 24 * 60 * 60 * 1000);
}

async function syncEmployeePolicy() {
  if (employeePolicySyncPromise) return employeePolicySyncPromise;
  employeePolicySyncPromise = (async () => {
    const now = new Date().toISOString();
    config.employeePolicy.lastAttemptAt = now;
    config.employeePolicy.errorCode = null;
    saveEmployeePolicyStatus();
    if (!config.employeePolicy.enabled) return { ok: false, errorCode: 'disabled' };
    if (config.employeePolicy.sourceMode === 'local') {
      applyStoredEmployeePolicy();
      saveConfigNow();
      broadcastConfig();
      scheduleEmployeePolicySync();
      scheduleHandbookSprinkle();
      return { ok: true, source: config.employeePolicy.currentSource };
    }
    employeePolicyAbortController = new AbortController();
    try {
      const result = await syncDifyPolicy({
        baseUrl: config.employeePolicy.baseUrl || DEFAULT_DIFY_BASE_URL,
        allowInsecureHttp: config.employeePolicy.allowInsecureHttp === true,
        apiKey: process.env.KANGKANGPET_DIFY_API_KEY,
        signal: employeePolicyAbortController.signal,
        timeoutMs: EMPLOYEE_POLICY_SYNC_TIMEOUT_MS
      });
      const sourceRevision = policyRevision(result.policy);
      writeJsonAtomic(employeePolicyPaths.cachePath, result.policy);
      const policy = {
        ...result.policy,
        reminders: result.policy.reminders.map((reminder) => ({ ...reminder, enabled: config.employeePolicy.enabled && reminder.enabled && !isHandbookSprinkleRule(reminder.ruleKey) }))
      };
      config.reminders = normalizeReminders(mergeEmployeePolicyReminders(config.reminders, policy, { sourceKind: 'dify', sourceRevision }));
      config.employeePolicy.currentSource = 'dify';
      config.employeePolicy.currentPolicyVersion = policy.policyVersion;
      config.employeePolicy.lastSuccessAt = new Date().toISOString();
      config.employeePolicy.errorCode = null;
      saveConfigNow();
      broadcastConfig();
      scheduleEmployeePolicySync();
      scheduleHandbookSprinkle();
      writeLog(`员工守则同步成功：版本 ${policy.policyVersion}。`);
      return { ok: true, source: 'dify' };
    } catch (error) {
      config.employeePolicy.errorCode = error?.code || 'network-error';
      saveEmployeePolicyStatus();
      scheduleEmployeePolicySync();
      writeLog(`员工守则同步失败：${config.employeePolicy.errorCode}。`);
      return { ok: false, errorCode: config.employeePolicy.errorCode };
    } finally {
      employeePolicyAbortController = null;
    }
  })().finally(() => { employeePolicySyncPromise = null; });
  return employeePolicySyncPromise;
}

function normalizeNotePosition(note) {
  const normalized = normalizeNote(note);
  if (!normalized) return null;
  const display = screen.getDisplayNearestPoint({ x: normalized.x ?? 0, y: normalized.y ?? 0 }) || screen.getPrimaryDisplay();
  const area = display.workArea;
  const fallbackX = area.x + Math.min(72 + (notes.length % 6) * 28, Math.max(0, area.width - normalized.width));
  const fallbackY = area.y + Math.min(72 + (notes.length % 6) * 28, Math.max(0, area.height - normalized.height));
  return {
    ...normalized,
    x: Math.max(area.x, Math.min(Number.isFinite(normalized.x) ? normalized.x : fallbackX, area.x + area.width - normalized.width)),
    y: Math.max(area.y, Math.min(Number.isFinite(normalized.y) ? normalized.y : fallbackY, area.y + area.height - normalized.height))
  };
}

function noteById(noteId) {
  return notes.find((note) => note.id === String(noteId)) || null;
}

function commitNotes(nextNotes) {
  const payload = { version: NOTE_VERSION, notes: nextNotes };
  const saved = notesStore.save(payload);
  notes = saved.notes;
  return notes;
}

function sendNoteError(noteId, message) {
  const win = noteWindows.get(noteId);
  if (win && !win.isDestroyed()) win.webContents.send('notes:error', message);
}

function sendNoteChanged(note) {
  const win = noteWindows.get(note.id);
  if (win && !win.isDestroyed()) win.webContents.send('notes:changed', note);
}

function updateNote(noteId, patch) {
  const original = noteById(noteId);
  if (!original) return { ok: false, error: '便利贴不存在。' };
  const allowed = {};
  if (typeof patch?.title === 'string') allowed.title = patch.title;
  if (typeof patch?.content === 'string') allowed.content = patch.content;
  if (patch?.mode === 'note' || patch?.mode === 'tasks') allowed.mode = patch.mode;
  if (Array.isArray(patch?.tasks)) allowed.tasks = patch.tasks;
  if (typeof patch?.alwaysOnTop === 'boolean') allowed.alwaysOnTop = patch.alwaysOnTop;
  if (typeof patch?.visible === 'boolean') allowed.visible = patch.visible;
  const replacement = normalizeNote({ ...original, ...allowed, id: original.id, createdAt: original.createdAt, updatedAt: new Date().toISOString() });
  try {
    commitNotes(notes.map((note) => note.id === original.id ? replacement : note));
  } catch (error) {
    writeLog('保存便利贴失败。', error);
    sendNoteError(noteId, '便利贴保存失败，原内容未更改。');
    return { ok: false, error: '便利贴保存失败，请重试。' };
  }
  const saved = noteById(noteId);
  const win = noteWindows.get(noteId);
  if (win && !win.isDestroyed()) win.setAlwaysOnTop(saved.alwaysOnTop);
  sendNoteChanged(saved);
  return { ok: true, note: saved };
}

function flushPendingNoteBounds() {
  clearTimeout(notesSaveTimer);
  notesSaveTimer = null;
  if (!pendingNoteBounds.size) return true;
  const pending = new Map(pendingNoteBounds);
  pendingNoteBounds.clear();
  const nextNotes = notes.map((note) => {
    const bounds = pending.get(note.id);
    return bounds ? normalizeNote({ ...note, ...bounds, updatedAt: new Date().toISOString() }) : note;
  });
  try {
    commitNotes(nextNotes);
    return true;
  } catch (error) {
    writeLog('保存便利贴位置失败。', error);
    for (const noteId of pending.keys()) sendNoteError(noteId, '便利贴位置保存失败。');
    return false;
  }
}

function saveNoteBoundsSoon(noteId, bounds) {
  const note = noteById(noteId);
  if (!note) return;
  pendingNoteBounds.set(noteId, {
    x: Math.round(bounds.x), y: Math.round(bounds.y), width: Math.round(bounds.width), height: Math.round(bounds.height)
  });
  clearTimeout(notesSaveTimer);
  notesSaveTimer = setTimeout(flushPendingNoteBounds, 350);
}

function createNoteWindow(noteId, { focus = false } = {}) {
  const note = noteById(noteId);
  if (!note) return null;
  const existing = noteWindows.get(note.id);
  if (existing && !existing.isDestroyed()) {
    if (note.visible) existing.show();
    if (focus) existing.focus();
    return existing;
  }
  const win = new BrowserWindow({
    x: note.x,
    y: note.y,
    width: note.width,
    height: note.height,
    minWidth: 240,
    minHeight: 180,
    frame: false,
    transparent: false,
    resizable: true,
    alwaysOnTop: note.alwaysOnTop,
    title: note.title,
    icon: appIconPath() || undefined,
    backgroundColor: '#fff4a8',
    webPreferences: { preload: path.join(__dirname, 'preload', 'note-preload.js'), contextIsolation: true, nodeIntegration: false, backgroundThrottling: true, spellcheck: false }
  });
  win.setMenuBarVisibility(false);
  noteWindows.set(note.id, win);
  noteWindowIds.set(win.webContents.id, note.id);
  win.loadFile('note.html');
  win.once('ready-to-show', () => { if (noteById(note.id)?.visible) { win.show(); if (focus) win.focus(); } });
  win.on('move', () => { if (!win.isDestroyed()) saveNoteBoundsSoon(note.id, win.getBounds()); });
  win.on('resize', () => { if (!win.isDestroyed()) saveNoteBoundsSoon(note.id, win.getBounds()); });
  win.on('close', (event) => {
    if (isQuitting || deletingNoteIds.has(note.id)) return;
    event.preventDefault();
    hideNote(note.id);
  });
  win.on('closed', () => { noteWindows.delete(note.id); noteWindowIds.delete(win.webContents.id); });
  win.webContents.on('render-process-gone', (_event, details) => writeLog(`便利贴渲染进程异常：${details.reason}`));
  return win;
}

function createNote() {
  const candidate = normalizeNote({ id: crypto.randomUUID(), title: '未命名便利贴', content: '', visible: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  const note = normalizeNotePosition(candidate);
  try {
    commitNotes([...notes, note]);
  } catch (error) {
    writeLog('创建便利贴失败。', error);
    return { ok: false, error: '无法创建便利贴，请检查本地存储。' };
  }
  createNoteWindow(note.id, { focus: true });
  return { ok: true, note: noteById(note.id) };
}

function hideNote(noteId) {
  const result = updateNote(noteId, { visible: false });
  if (!result.ok) return result;
  const win = noteWindows.get(String(noteId));
  if (win && !win.isDestroyed()) win.hide();
  flushPendingNoteBounds();
  return result;
}

function showAllNotes() {
  const hiddenIds = notes.filter((note) => !note.visible).map((note) => note.id);
  if (hiddenIds.length) {
    try { commitNotes(notes.map((note) => hiddenIds.includes(note.id) ? normalizeNote({ ...note, visible: true, updatedAt: new Date().toISOString() }) : note)); }
    catch (error) { writeLog('显示便利贴失败。', error); return { ok: false, error: '便利贴状态保存失败。' }; }
  }
  notes.filter((note) => note.visible).forEach((note) => createNoteWindow(note.id));
  return { ok: true };
}

function hideAllNotes() {
  try { commitNotes(notes.map((note) => normalizeNote({ ...note, visible: false, updatedAt: new Date().toISOString() }))); }
  catch (error) { writeLog('隐藏便利贴失败。', error); return { ok: false, error: '便利贴状态保存失败。' }; }
  for (const win of noteWindows.values()) if (!win.isDestroyed()) win.hide();
  flushPendingNoteBounds();
  return { ok: true };
}

function deleteNote(noteId) {
  const id = String(noteId);
  if (!noteById(id)) return { ok: true };
  try { commitNotes(notes.filter((note) => note.id !== id)); }
  catch (error) { writeLog('删除便利贴失败。', error); return { ok: false, error: '删除便利贴失败，请重试。' }; }
  pendingNoteBounds.delete(id);
  const win = noteWindows.get(id);
  if (win && !win.isDestroyed()) {
    deletingNoteIds.add(id);
    win.destroy();
    deletingNoteIds.delete(id);
  }
  return { ok: true };
}

function currentNoteId(event) {
  return noteWindowIds.get(event.sender.id) || null;
}

function appIconPath() {
  const paths = resolveForcomeCliPaths({ appRoot: __dirname, resourcesPath: process.resourcesPath, isPackaged: app.isPackaged });
  return fs.existsSync(paths.icon) ? paths.icon : null;
}

function showPet() {
  clearTimeout(petWindowDestroyTimer);
  petWindowDestroyTimer = null;
  const win = createPetWindow();
  win.showInactive();
}

function hidePet() {
  if (petWindow && !petWindow.isDestroyed()) petWindow.hide();
  clearTimeout(petWindowDestroyTimer);
  if (config?.petLowResourceMode !== false) {
    petWindowDestroyTimer = setTimeout(() => {
      if (petWindow && !petWindow.isDestroyed() && !petWindow.isVisible()) petWindow.destroy();
      petWindowDestroyTimer = null;
    }, 30000);
    petWindowDestroyTimer.unref?.();
  }
}

function quitApp() {
  isQuitting = true;
  flushPendingNoteBounds();
  app.quit();
}

function forcomeStatusKey(status = forcomeStatus) {
  if (!status.available || status.externalConnectorRunning) return 'error';
  if (status.connectorConnected) return 'connected';
  if (status.loginRunning) return 'login';
  if (status.authenticated) return 'offline';
  return 'signed-out';
}

function forcomeStatusLabel(status = forcomeStatus) {
  const key = forcomeStatusKey(status);
  if (key === 'connected') return '已连接';
  if (key === 'login') return '正在登录';
  if (key === 'offline') {
    if (status.connectionStatus === 'connecting') return '正在连接';
    if (status.connectionStatus === 'reconnecting') return '网络离线，自动重连中';
    return '已登录，连接离线';
  }
  if (key === 'error') return status.externalConnectorRunning ? '检测到旧版连接器冲突' : 'CLI 不可用';
  return '未登录';
}

function forcomeTrayIcon(status = forcomeStatus) {
  const key = forcomeStatusKey(status);
  if (trayStatusIcons.has(key)) return trayStatusIcons.get(key);
  const paths = resolveForcomeCliPaths({ appRoot: __dirname, resourcesPath: process.resourcesPath, isPackaged: app.isPackaged });
  if (!fs.existsSync(paths.logo)) return nativeImage.createFromPath(appIconPath() || '');
  const color = { connected: '#22c55e', login: '#3b82f6', offline: '#f59e0b', error: '#ef4444', 'signed-out': '#94a3b8' }[key];
  const logo = fs.readFileSync(paths.logo).toString('base64');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><image href="data:image/png;base64,${logo}" x="1" y="1" width="29" height="29"/><circle cx="25" cy="25" r="6" fill="white"/><circle cx="25" cy="25" r="4.5" fill="${color}"/></svg>`;
  const icon = nativeImage.createFromDataURL(`data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`).resize({ width: 32, height: 32 });
  trayStatusIcons.set(key, icon);
  return icon;
}

function updateForcomeTrayStatus() {
  if (!tray || tray.isDestroyed()) return;
  const fallbackPath = appIconPath();
  const fallback = fallbackPath ? nativeImage.createFromPath(fallbackPath) : nativeImage.createEmpty();
  const statusIcon = forcomeTrayIcon();
  tray.setImage(statusIcon && !statusIcon.isEmpty() ? statusIcon : fallback);
  tray.setToolTip(`FORCOME AI：${forcomeStatusLabel()} · 康康熊桌宠`);
}

function broadcastForcomeStatus() {
  updateForcomeTrayStatus();
  if (panelWindow && !panelWindow.isDestroyed()) panelWindow.webContents.send('forcome-cli:status', forcomeStatus);
}

async function refreshForcomeStatus() {
  if (!forcomeCli) return forcomeStatus;
  if (forcomeRefreshPromise) return forcomeRefreshPromise;
  forcomeRefreshPromise = forcomeCli.getStatus()
    .then((status) => {
      forcomeStatus = status;
      if (status.connectorRunning) forcomeReconnectAttempt = 0;
      broadcastForcomeStatus();
      return status;
    })
    .catch((error) => {
      writeLog('读取 FORCOME AI 状态失败。', error);
      return forcomeStatus;
    })
    .finally(() => { forcomeRefreshPromise = null; });
  return forcomeRefreshPromise;
}

function scheduleForcomeMaintenance(delay = FORCOME_HEALTH_CHECK_MS, reconnectAfterDelay = false) {
  clearTimeout(forcomeSupervisorTimer);
  if (isQuitting) return;
  forcomeSupervisorTimer = setTimeout(() => maintainForcomeConnector({ immediate: reconnectAfterDelay }).catch((error) => writeLog('FORCOME AI 连接维护失败。', error)), delay);
  forcomeSupervisorTimer.unref?.();
}

async function maintainForcomeConnector({ immediate = false } = {}) {
  if (isQuitting || !forcomeCli) return forcomeStatus;
  const status = await refreshForcomeStatus();
  const shouldReconnect = config?.cliAutoReconnect !== false && !connectorManuallyPaused && status.available && status.authenticated && !status.connectorRunning && !status.externalConnectorRunning;
  if (!shouldReconnect) {
    scheduleForcomeMaintenance();
    return status;
  }
  const delay = immediate ? 0 : FORCOME_RECONNECT_DELAYS_MS[Math.min(forcomeReconnectAttempt, FORCOME_RECONNECT_DELAYS_MS.length - 1)];
  if (delay > 0) {
    forcomeReconnectAttempt += 1;
    scheduleForcomeMaintenance(delay, true);
    return status;
  }
  const result = forcomeCli.startConnector();
  if (!result.ok) {
    writeLog('FORCOME AI 自动重连启动失败。', new Error(result.error || 'unknown error'));
    forcomeReconnectAttempt += 1;
    scheduleForcomeMaintenance(FORCOME_RECONNECT_DELAYS_MS[Math.min(forcomeReconnectAttempt, FORCOME_RECONNECT_DELAYS_MS.length - 1)], true);
    return status;
  }
  scheduleForcomeMaintenance(5000);
  return status;
}

async function startForcomeLogin(options = {}) {
  const force = options && options.force === true;
  const before = await refreshForcomeStatus();
  if (!before.available) return { ...before, action: { ok: false, error: 'CLI 尚未初始化或文件不完整。' } };
  if (before.authenticated && !force) {
    connectorManuallyPaused = false;
    const status = await forcomeCli.ensureConnectorStarted();
    forcomeStatus = status;
    broadcastForcomeStatus();
    scheduleForcomeMaintenance(4000);
    return { ...status, action: { ok: true, reused: true, message: '已检测到钉钉授权，正在自动连接 FORCOME AI。' } };
  }
  const result = forcomeCli.startLogin();
  if (!result.ok) writeLog('FORCOME AI 登录启动失败。', new Error(result.error));
  await refreshForcomeStatus();
  return { ...forcomeStatus, action: result };
}

async function reconnectForcomeConnector() {
  connectorManuallyPaused = false;
  if (forcomeStatus.externalConnectorRunning) return { ...forcomeStatus, ok: false, error: '检测到旧版连接器，请先退出旧版。' };
  await forcomeCli.stopConnector();
  forcomeReconnectAttempt = 0;
  const result = forcomeCli.startConnector();
  scheduleForcomeMaintenance(4000);
  return { ...await refreshForcomeStatus(), ok: result.ok, error: result.error };
}

async function pauseForcomeConnector() {
  connectorManuallyPaused = true;
  clearTimeout(forcomeSupervisorTimer);
  const result = await forcomeCli.stopConnector();
  scheduleForcomeMaintenance();
  return { ...result, ...await refreshForcomeStatus() };
}

function trayMenuTemplate() {
  const petVisible = Boolean(petWindow && !petWindow.isDestroyed() && petWindow.isVisible());
  return [
    { label: `FORCOME AI：${forcomeStatusLabel()}`, enabled: false },
    { label: '打开 FORCOME AI', click: () => openConfiguredPwa() },
    { label: forcomeStatus.authenticated ? '重新登录 / 切换账号' : '登录 FORCOME AI', enabled: forcomeStatus.available && !forcomeStatus.loginRunning, click: () => startForcomeLogin({ force: true }) },
    { label: forcomeStatus.connectorRunning ? '重新连接 CLI' : '连接 CLI', enabled: forcomeStatus.available && forcomeStatus.authenticated && !forcomeStatus.externalConnectorRunning, click: () => reconnectForcomeConnector() },
    { label: '停止 CLI 连接器', enabled: forcomeStatus.connectorRunning, click: () => pauseForcomeConnector() },
    { label: '离线自动重连', type: 'checkbox', checked: config.cliAutoReconnect !== false, click: (item) => { connectorManuallyPaused = false; applyConfigPatch({ cliAutoReconnect: item.checked }); if (item.checked) maintainForcomeConnector({ immediate: true }).catch((error) => writeLog('手动启用 FORCOME AI 自动重连失败。', error)); } },
    { type: 'separator' },
    { label: '康康熊桌宠与提醒', submenu: [
      { label: petVisible ? '隐藏桌宠' : '显示桌宠', click: petVisible ? hidePet : showPet },
      { label: '快速新建提醒', click: createQuickReminderWindow },
      { label: '立即同步员工守则', enabled: !employeePolicySyncPromise, click: () => syncEmployeePolicy().catch(() => {}) },
      handbookTipMenuTemplate(),
      { label: '新建便利贴', click: createNote },
      { label: '显示全部便利贴', click: showAllNotes },
      { label: '隐藏全部便利贴', click: hideAllNotes }
    ] },
    { label: '打开控制面板', click: () => createPanelWindow() },
    { type: 'separator' },
    { label: '退出', click: quitApp }
  ];
}

function petContextMenuTemplate() {
  return [
    { label: `FORCOME AI：${forcomeStatusLabel()}`, enabled: false },
    { label: '打开 FORCOME AI', click: () => openConfiguredPwa() },
    { type: 'separator' },
    { label: '隐藏桌宠', click: hidePet },
    { label: '快速新建提醒', click: createQuickReminderWindow },
    handbookTipMenuTemplate(),
    { label: '新建便利贴', click: createNote },
    { label: '显示全部便利贴', click: showAllNotes },
    { label: '隐藏全部便利贴', click: hideAllNotes },
    { type: 'separator' },
    { label: '打开控制面板', click: () => createPanelWindow() },
    { label: config.doNotDisturbMode ? '退出免打扰模式' : '开启免打扰模式', type: 'checkbox', checked: config.doNotDisturbMode === true, click: (item) => applyConfigPatch({ doNotDisturbMode: item.checked }) }
  ];
}

function createTray() {
  if (tray) return;
  const iconPath = appIconPath();
  const icon = iconPath ? nativeImage.createFromPath(iconPath) : nativeImage.createEmpty();
  tray = new Tray(icon && !icon.isEmpty() ? icon : nativeImage.createEmpty());
  updateForcomeTrayStatus();
  tray.on('click', () => openConfiguredPwa());
  tray.on('double-click', () => createPanelWindow());
  tray.on('right-click', () => tray.popUpContextMenu(Menu.buildFromTemplate(trayMenuTemplate())));
}

function showPetContextMenu() {
  if (!petWindow || petWindow.isDestroyed()) return;
  Menu.buildFromTemplate(petContextMenuTemplate()).popup({ window: petWindow });
}

function focusedWindow() {
  const win = BrowserWindow.getFocusedWindow();
  return win && !win.isDestroyed() ? win : null;
}

function createChineseAppMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: '文件', submenu: [{ label: '打开控制面板', accelerator: 'CommandOrControl+,', click: () => createPanelWindow() }, { label: '快速新建提醒', click: createQuickReminderWindow }, { label: '新建便利贴', click: createNote }, { type: 'separator' }, { label: '退出', accelerator: 'CommandOrControl+Q', click: quitApp }] },
    { label: '编辑', submenu: [{ label: '撤销', accelerator: 'CommandOrControl+Z', click: () => focusedWindow()?.webContents.undo() }, { label: '重做', accelerator: 'CommandOrControl+Y', click: () => focusedWindow()?.webContents.redo() }, { type: 'separator' }, { label: '剪切', accelerator: 'CommandOrControl+X', click: () => focusedWindow()?.webContents.cut() }, { label: '复制', accelerator: 'CommandOrControl+C', click: () => focusedWindow()?.webContents.copy() }, { label: '粘贴', accelerator: 'CommandOrControl+V', click: () => focusedWindow()?.webContents.paste() }, { label: '全选', accelerator: 'CommandOrControl+A', click: () => focusedWindow()?.webContents.selectAll() }] },
    { label: '窗口', submenu: [{ label: '最小化', accelerator: 'CommandOrControl+M', click: () => focusedWindow()?.minimize() }, { label: '关闭窗口', accelerator: 'CommandOrControl+W', click: () => focusedWindow()?.close() }] },
    { label: '帮助', submenu: [{ label: `关于${APP_NAME}`, click: () => dialog.showMessageBox(focusedWindow() || petWindow, { type: 'info', title: APP_NAME, message: APP_NAME, detail: '本地离线桌面宠物与提醒助手。', buttons: ['知道了'] }) }] }
  ]));
}

function loginItemOptions(openAtLogin) {
  const options = { openAtLogin: Boolean(openAtLogin), openAsHidden: false };
  if (process.defaultApp) { options.path = process.execPath; options.args = [app.getAppPath()]; }
  return options;
}

function applyAutoLaunchSetting() {
  try { app.setLoginItemSettings(loginItemOptions(config?.autoLaunch)); } catch (error) { writeLog('开机自启动设置失败。', error); }
}

function sanitizeRendererAssets(items) {
  if (!Array.isArray(items)) return config.assets;
  const current = new Map(config.assets.map((asset) => [asset.id, asset]));
  const validButtonIds = new Set(config.interactionButtons.map((button) => button.id));
  return items.map((candidate) => {
    const source = current.get(String(candidate?.id));
    if (!source) return null;
    const patch = {};
    for (const field of ASSET_PATCH_FIELDS) if (Object.prototype.hasOwnProperty.call(candidate || {}, field)) patch[field] = candidate[field];
    return normalizeAsset({ ...source, ...patch }, validButtonIds);
  }).filter(Boolean);
}

function sanitizeRendererButtons(items) {
  if (!Array.isArray(items)) return config.interactionButtons;
  return normalizeButtons(items.map((item) => ({ id: item?.id, label: item?.label, actionKeys: item?.actionKeys, responses: item?.responses })));
}

function applyConfigPatch(patch) {
  const input = patch && typeof patch === 'object' ? patch : {};
  const next = { ...config };
  if (Object.prototype.hasOwnProperty.call(input, 'size')) next.size = clamp(Number(input.size) || config.size, MIN_PET_SIZE, MAX_PET_SIZE);
  if (Object.prototype.hasOwnProperty.call(input, 'autoLaunch')) next.autoLaunch = input.autoLaunch === true;
  if (Object.prototype.hasOwnProperty.call(input, 'cliAutoReconnect')) next.cliAutoReconnect = input.cliAutoReconnect !== false;
  if (Object.prototype.hasOwnProperty.call(input, 'petLowResourceMode')) next.petLowResourceMode = input.petLowResourceMode !== false;
  if (Object.prototype.hasOwnProperty.call(input, 'doNotDisturbMode')) next.doNotDisturbMode = input.doNotDisturbMode === true;
  if (Object.prototype.hasOwnProperty.call(input, 'timeZones')) next.timeZones = normalizeTimeZones(input.timeZones);
  if (Object.prototype.hasOwnProperty.call(input, 'anniversaries')) next.anniversaries = normalizeAnniversaries(input.anniversaries);
  if (Object.prototype.hasOwnProperty.call(input, 'chinaHolidayEnabled')) next.chinaHolidayEnabled = input.chinaHolidayEnabled !== false;
  if (Object.prototype.hasOwnProperty.call(input, 'usHolidayEnabled')) next.usHolidayEnabled = input.usHolidayEnabled === true;
  if (Object.prototype.hasOwnProperty.call(input, 'calendarViewMode')) next.calendarViewMode = normalizeCalendarViewMode(input.calendarViewMode);
  if (Object.prototype.hasOwnProperty.call(input, 'employeePolicy')) {
    const employeePatch = input.employeePolicy && typeof input.employeePolicy === 'object' ? input.employeePolicy : {};
    next.employeePolicy = normalizePolicySettings({ ...config.employeePolicy, ...employeePatch });
  }
  if (Object.prototype.hasOwnProperty.call(input, 'responses')) next.responses = asList(input.responses, config.responses);
  if (Object.prototype.hasOwnProperty.call(input, 'idleMessages')) next.idleMessages = asList(input.idleMessages, config.idleMessages);
  if (Object.prototype.hasOwnProperty.call(input, 'interactionButtons')) next.interactionButtons = sanitizeRendererButtons(input.interactionButtons);
  if (Object.prototype.hasOwnProperty.call(input, 'assets')) next.assets = sanitizeRendererAssets(input.assets);
  if (Object.prototype.hasOwnProperty.call(input, 'actionMessages') && input.actionMessages && typeof input.actionMessages === 'object') next.actionMessages = input.actionMessages;
  const oldAutoLaunch = config.autoLaunch;
  const oldCliAutoReconnect = config.cliAutoReconnect;
  config = normalizeConfig(next);
  const policyChanged = JSON.stringify(config.employeePolicy) !== JSON.stringify(next.employeePolicy) || Object.prototype.hasOwnProperty.call(input, 'employeePolicy');
  if (policyChanged) {
    applyStoredEmployeePolicy();
    scheduler?.reschedule('employee-policy-settings');
    scheduleEmployeePolicySync();
    scheduleHandbookSprinkle();
  }
  if (config.autoLaunch !== oldAutoLaunch) applyAutoLaunchSetting();
  if (config.cliAutoReconnect !== oldCliAutoReconnect && config.cliAutoReconnect) {
    connectorManuallyPaused = false;
    maintainForcomeConnector({ immediate: true }).catch((error) => writeLog('启用 FORCOME AI 自动重连失败。', error));
  }
  saveConfigSoon();
  broadcastConfig();
  return publicConfig();
}

function saveReminders(reason) {
  config.reminders = sortReminders(config.reminders);
  saveConfigSoon();
  broadcastConfig();
  writeLog(`提醒已保存：${reason}`);
}

function saveReminder(input) {
  const requestedId = typeof input?.id === 'string' ? input.id.trim() : '';
  const existingReminder = config.reminders.find((item) => item.id === requestedId);
  if (input?.managedBy === EMPLOYEE_POLICY_MANAGER || existingReminder?.managedBy === EMPLOYEE_POLICY_MANAGER) {
    return { ok: false, errors: ['员工守则提醒由同步内容管理，不能手工编辑。'], config: publicConfig() };
  }
  const result = validateReminder(input);
  if (!result.valid) return { ok: false, errors: result.errors, config: publicConfig() };
  const index = config.reminders.findIndex((item) => item.id === result.reminder.id);
  const now = new Date().toISOString();
  const existing = index >= 0 ? config.reminders[index] : null;
  const reminder = { ...result.reminder, createdAt: existing?.createdAt || result.reminder.createdAt, updatedAt: now, sortOrder: existing?.sortOrder ?? config.reminders.length, lastTriggeredAt: existing?.lastTriggeredAt || null, nextTriggerAt: null };
  if (index >= 0) config.reminders[index] = reminder;
  else config.reminders.push(reminder);
  config.reminders = normalizeReminders(config.reminders);
  saveReminders('edit');
  scheduler?.reschedule('edit');
  return { ok: true, config: publicConfig() };
}

function deleteReminder(reminderId) {
  const id = typeof reminderId === 'string' ? reminderId.trim() : '';
  if (!id) return { ...publicConfig(), ok: false, error: '日程 ID 无效。' };
  const previous = config.reminders;
  const target = previous.find((item) => item.id === id);
  if (target?.managedBy === EMPLOYEE_POLICY_MANAGER) return { ...publicConfig(), ok: false, error: '员工守则提醒由同步内容管理，不能手工删除。' };
  const next = previous.filter((item) => item.id !== id);
  if (next.length === previous.length) return { ...publicConfig(), ok: true, affected: 0 };
  config.reminders = sortReminders(next);
  try {
    configStore.save(config);
  } catch (error) {
    config.reminders = previous;
    writeLog('删除日程失败，已恢复原数据。', error);
    return { ...publicConfig(), ok: false, error: '删除日程失败，原数据未更改。' };
  }
  broadcastConfig();
  scheduler?.reschedule('delete');
  writeLog('提醒已保存：delete');
  return { ...publicConfig(), ok: true, affected: 1 };
}

function bulkUpdateReminders(reminderIds, action) {
  const result = applyReminderBulkAction(config.reminders, reminderIds, action);
  if (!result.affected) return { affected: 0, config: publicConfig() };
  config.reminders = result.reminders;
  saveReminders(`bulk-${action}`);
  scheduler?.reschedule(`bulk-${action}`);
  return { affected: result.affected, config: publicConfig() };
}

function reorderReminders(ids) {
  if (!Array.isArray(ids)) return publicConfig();
  const lookup = new Map(config.reminders.map((item) => [item.id, item]));
  const requestedIds = ids.map(String);
  const manualIds = requestedIds.filter((id) => lookup.get(id)?.managedBy !== EMPLOYEE_POLICY_MANAGER);
  const existingManual = config.reminders.filter((item) => item.managedBy !== EMPLOYEE_POLICY_MANAGER);
  if (manualIds.length !== existingManual.length || new Set(manualIds).size !== manualIds.length || manualIds.some((id) => !lookup.has(id))) return publicConfig();
  const manualQueue = manualIds.map((id) => lookup.get(id));
  let manualIndex = 0;
  config.reminders = config.reminders.map((item) => item.managedBy === EMPLOYEE_POLICY_MANAGER ? item : manualQueue[manualIndex++]);
  config.reminders = config.reminders.map((item, index) => ({ ...item, sortOrder: index }));
  saveReminders('reorder');
  return publicConfig();
}

async function uploadAssets() {
  const result = await dialog.showOpenDialog(panelWindow || petWindow, { title: '选择康康熊素材', buttonLabel: '上传素材', properties: ['openFile', 'multiSelections'], filters: [{ name: '康康熊素材', extensions: ['png', 'jpg', 'jpeg', 'webp', 'webm', 'mp4', 'mov', 'gif'] }] });
  if (result.canceled) return publicConfig();
  const assets = [];
  for (const sourcePath of result.filePaths) {
    if (ALLOWED_EXTENSIONS.has(path.extname(sourcePath).toLowerCase()) && !isDeletedAssetName(sourcePath)) {
      try { assets.push(makeAssetFromFile(sourcePath)); } catch (error) { writeLog(`素材导入失败：${sourcePath}`, error); }
    }
  }
  if (assets.length) {
    config.assets = [...assets, ...config.assets];
    config.activeAssetId = assets[0].id;
    saveConfigSoon();
    broadcastConfig();
  }
  return publicConfig();
}

function deleteAsset(assetId) {
  const target = config.assets.find((asset) => asset.id === String(assetId));
  if (!target) return publicConfig();
  config.assets = config.assets.filter((asset) => asset.id !== target.id);
  if (config.activeAssetId === target.id) config.activeAssetId = config.assets.find((asset) => asset.enabled)?.id || null;
  if (target.path && path.dirname(target.path) === mediaDir) fs.rm(target.path, { force: true }, (error) => { if (error) writeLog('素材文件删除失败。', error); });
  saveConfigSoon();
  broadcastConfig();
  return publicConfig();
}

function reminderMediaType(extension) {
  if (['.mp3', '.wav', '.m4a', '.aac', '.ogg', '.flac'].includes(extension)) return 'audio';
  if (['.webm', '.mp4', '.mov'].includes(extension)) return 'video';
  return 'image';
}

function makeReminderDraftFromFile(sourcePath) {
  const id = crypto.randomUUID();
  const name = path.basename(sourcePath);
  const targetPath = path.join(mediaDir, `${id}-${safeFileName(name)}`);
  fs.copyFileSync(sourcePath, targetPath);
  const extension = path.extname(sourcePath).toLowerCase();
  const type = reminderMediaType(extension);
  return normalizeReminderDraft({
    id,
    title: `${type === 'audio' ? '语音' : type === 'video' ? '视频' : '图片'}提醒 · ${path.basename(name, extension)}`,
    message: `来源文件：${name}。请补充日期和时间后启用提醒。`,
    sourceType: type,
    sourceName: name,
    path: targetPath,
    createdAt: new Date().toISOString()
  });
}

function appendReminderDrafts(items) {
  if (!Array.isArray(items) || !items.length) return 0;
  const before = config.reminderDrafts.length;
  config.reminderDrafts = normalizeReminderDrafts([...config.reminderDrafts, ...items]);
  return config.reminderDrafts.length - before;
}

function removeReminderDraft(draftId, keepFile = false) {
  const target = config.reminderDrafts.find((draft) => draft.id === String(draftId));
  if (!target) return false;
  config.reminderDrafts = config.reminderDrafts.filter((draft) => draft.id !== target.id);
  if (!keepFile && target.path && path.dirname(path.resolve(target.path)) === path.resolve(mediaDir)) {
    fs.rm(target.path, { force: true }, (error) => { if (error) writeLog('提醒来源文件删除失败。', error); });
  }
  saveConfigSoon();
  broadcastConfig();
  return true;
}

function deleteReminderDraft(draftId) {
  removeReminderDraft(draftId, false);
  return publicConfig();
}

function promoteReminderDraft(draftId, reminder) {
  const draft = config.reminderDrafts.find((item) => item.id === String(draftId));
  if (!draft) return { ok: false, errors: ['找不到待排期素材。'], config: publicConfig() };
  const source = normalizeSource({ type: draft.sourceType, name: draft.sourceName, path: draft.path, text: draft.message });
  const result = saveReminder({ ...(reminder || {}), source });
  if (result.ok) {
    removeReminderDraft(draft.id, true);
    result.config = publicConfig();
  }
  return result;
}

function importReminderText(text) {
  const parsed = parseReminderText(text);
  const merged = mergeImportedReminders(config.reminders, parsed.reminders);
  config.reminders = merged.reminders;
  const draftsImported = appendReminderDrafts(parsed.drafts);
  if (merged.imported) saveReminders('text-import');
  else if (draftsImported) { saveConfigSoon(); broadcastConfig(); }
  if (merged.imported) scheduler?.reschedule('text-import');
  return { canceled: false, imported: merged.imported, draftsImported, errors: merged.errors, config: publicConfig() };
}

async function importReminders() {
  const result = await dialog.showOpenDialog(panelWindow, {
    title: '导入提醒内容',
    buttonLabel: '导入到康康熊',
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: '提醒内容', extensions: ['json', 'csv', 'xlsx', 'txt', 'md', 'log', 'png', 'jpg', 'jpeg', 'webp', 'gif', 'mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac', 'webm', 'mp4', 'mov'] }]
  });
  if (result.canceled || !result.filePaths.length) return { canceled: true, config: publicConfig() };
  let imported = 0;
  let draftsImported = 0;
  const errors = [];
  let remindersChanged = false;
  for (const filePath of result.filePaths) {
    const extension = path.extname(filePath).toLowerCase();
    try {
      if (REMINDER_MEDIA_EXTENSIONS.has(extension)) {
        const draft = makeReminderDraftFromFile(filePath);
        draftsImported += appendReminderDrafts([draft]);
        continue;
      }
      const source = fs.readFileSync(filePath);
      if (REMINDER_TEXT_EXTENSIONS.has(extension)) {
        const parsed = parseReminderText(source.toString('utf8'));
        const merged = mergeImportedReminders(config.reminders, parsed.reminders);
        config.reminders = merged.reminders;
        imported += merged.imported;
        errors.push(...merged.errors.map((item) => `${path.basename(filePath)}：第 ${Number(item.index) + 1} 条未导入`));
        draftsImported += appendReminderDrafts(parsed.drafts);
        remindersChanged = remindersChanged || merged.imported > 0;
        continue;
      }
      const incoming = extension === '.xlsx'
        ? await parseReminderXlsx(source)
        : extension === '.csv'
          ? parseReminderCsv(source.toString('utf8'))
          : parseReminderBackup(source.toString('utf8'));
      const merged = mergeImportedReminders(config.reminders, incoming);
      config.reminders = merged.reminders;
      imported += merged.imported;
      errors.push(...merged.errors.map((item) => `${path.basename(filePath)}：第 ${Number(item.index) + 1} 条未导入`));
      remindersChanged = remindersChanged || merged.imported > 0;
    } catch (error) {
      writeLog(`提醒导入失败：${filePath}`, error);
      errors.push(`${path.basename(filePath)}：${error.message || '无法读取文件'}`);
    }
  }
  if (remindersChanged) {
    saveReminders('import');
    scheduler?.reschedule('import');
  } else if (draftsImported) {
    saveConfigSoon();
    broadcastConfig();
  }
  return { canceled: false, imported, draftsImported, errors, config: publicConfig() };
}

async function exportReminders() {
  const result = await dialog.showSaveDialog(panelWindow, { title: '导出提醒备份', defaultPath: `康康熊提醒备份-${new Date().toISOString().slice(0, 10)}.json`, filters: [{ name: 'JSON 提醒备份', extensions: ['json'] }] });
  if (result.canceled || !result.filePath) return { canceled: true };
  fs.writeFileSync(result.filePath, serializeReminderBackup(config.reminders), 'utf8');
  return { canceled: false, filePath: result.filePath };
}

async function saveReminderTemplate(csv) {
  const result = await dialog.showSaveDialog(panelWindow, {
    title: '保存康康熊提醒导入模板',
    defaultPath: `康康熊提醒导入模板-${new Date().toISOString().slice(0, 10)}.csv`,
    filters: [{ name: 'CSV 提醒模板', extensions: ['csv'] }]
  });
  if (result.canceled || !result.filePath) return { canceled: true };
  fs.writeFileSync(result.filePath, String(csv || ''), 'utf8');
  return { canceled: false, filePath: result.filePath };
}

async function notifyReminder(reminder) {
  const mode = reminder.notificationMode;
  let bubbleDelivered = false;
  if (mode === 'bubble' || mode === 'both' || reminder.strongReminder) {
    showPet();
    petWindow?.webContents.send('reminder:triggered', reminder);
    bubbleDelivered = true;
  }
  if (mode === 'system' || mode === 'both') {
    try {
      if (!Notification.isSupported()) throw new Error('系统通知不可用');
      const notification = new Notification({ title: reminder.title, body: reminder.message || '康康熊提醒你注意这件事。', icon: appIconPath() || undefined, silent: false });
      notification.show();
    } catch (error) {
      writeLog('系统通知失败。', error);
      if (!bubbleDelivered) {
        showPet();
        petWindow?.webContents.send('reminder:triggered', reminder);
      }
    }
  }
}

function openConfiguredPwa() {
  if (pwaOpenPromise) return pwaOpenPromise;
  pwaOpenPromise = openPwa(config?.pwa, { openExternal: shell.openExternal, openPath: shell.openPath, log: writeLog })
    .catch((error) => {
      writeLog('目标 PWA 启动流程异常。', error);
      return { ok: false, message: '无法打开目标 PWA，请检查设置或默认浏览器。' };
    })
    .finally(() => { pwaOpenPromise = null; });
  return pwaOpenPromise;
}

function setupIpc() {
  ipcMain.handle('app:get-info', () => ({ version: app.getVersion(), isPackaged: app.isPackaged, updater: publicUpdaterState() }));
  ipcMain.handle('app:check-for-updates', () => checkForUpdates());
  ipcMain.handle('app:get-release-notes', () => getReleaseNotes());
  ipcMain.handle('forcome-cli:get-status', () => refreshForcomeStatus());
  ipcMain.handle('forcome-cli:login', (_event, options) => startForcomeLogin(options));
  ipcMain.handle('forcome-cli:start', async () => {
    const before = await refreshForcomeStatus();
    if (!before.available) return { ...before, ok: false, error: '内置 FORCOME AI CLI 文件不完整。' };
    if (!before.authenticated) return { ...before, ok: false, error: '请先登录 FORCOME AI。' };
    if (before.externalConnectorRunning) return { ...before, ok: false, error: '检测到独立安装版连接器正在运行，请先退出或卸载旧版，避免两个连接器抢占调用。' };
    return reconnectForcomeConnector();
  });
  ipcMain.handle('forcome-cli:stop', () => pauseForcomeConnector());
  ipcMain.handle('china-holidays:get', (_event, year) => holidayService?.getYear(year) || { year, items: [], available: false });
  ipcMain.handle('us-holidays:get', (_event, year) => usHolidayService?.getYear(year) || { year, items: [], available: false });
  ipcMain.handle('config:get', () => publicConfig());
  ipcMain.handle('config:update', (_event, patch) => applyConfigPatch(patch));
  ipcMain.handle('assets:upload', uploadAssets);
  ipcMain.handle('assets:delete', (_event, assetId) => deleteAsset(assetId));
  ipcMain.handle('panel:open', (_event, tab) => { createPanelWindow(typeof tab === 'string' ? tab : null); return true; });
  ipcMain.handle('quick-reminder:open', () => { createQuickReminderWindow(); return true; });
  ipcMain.handle('quick-reminder:close', () => { quickReminderWindow?.close(); return true; });
  ipcMain.handle('quick-reminder:save', (_event, reminder) => {
    const result = saveReminder(reminder);
    if (result.ok) quickReminderWindow?.close();
    return result;
  });
  ipcMain.handle('reminders:save', (_event, reminder) => saveReminder(reminder));
  ipcMain.handle('reminders:delete', (_event, reminderId) => deleteReminder(reminderId));
  ipcMain.handle('reminders:bulk-update', (_event, reminderIds, action) => bulkUpdateReminders(reminderIds, action));
  ipcMain.handle('reminders:reorder', (_event, ids) => reorderReminders(ids));
  ipcMain.handle('reminders:import', importReminders);
  ipcMain.handle('reminders:import-text', (_event, text) => importReminderText(text));
  ipcMain.handle('reminders:draft-delete', (_event, draftId) => deleteReminderDraft(draftId));
  ipcMain.handle('reminders:draft-promote', (_event, draftId, reminder) => promoteReminderDraft(draftId, reminder));
  ipcMain.handle('reminders:export', exportReminders);
  ipcMain.handle('reminders:template-save', (_event, csv) => saveReminderTemplate(csv));
  ipcMain.handle('pet:open-pwa', () => openConfiguredPwa());
  ipcMain.handle('notes:create', () => createNote());
  ipcMain.handle('notes:show-all', () => showAllNotes());
  ipcMain.handle('notes:hide-all', () => hideAllNotes());
  ipcMain.handle('notes:get', (event) => {
    const note = noteById(currentNoteId(event));
    return note ? { ok: true, note } : { ok: false, error: '便利贴不存在。' };
  });
  ipcMain.handle('notes:update', (event, patch) => {
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return { ok: false, error: '便利贴内容无效。' };
    const noteId = currentNoteId(event);
    return noteId ? updateNote(noteId, patch) : { ok: false, error: '便利贴不存在。' };
  });
  ipcMain.handle('notes:hide', (event) => {
    const noteId = currentNoteId(event);
    return noteId ? hideNote(noteId) : { ok: false, error: '便利贴不存在。' };
  });
  ipcMain.handle('notes:delete', (event) => {
    const noteId = currentNoteId(event);
    return noteId ? deleteNote(noteId) : { ok: false, error: '便利贴不存在。' };
  });
  ipcMain.handle('notes:toggle-always-on-top', (event) => {
    const note = noteById(currentNoteId(event));
    return note ? updateNote(note.id, { alwaysOnTop: !note.alwaysOnTop }) : { ok: false, error: '便利贴不存在。' };
  });
  ipcMain.on('pet:set-click-through', (_event, ignore) => setPetClickThrough(ignore));
  ipcMain.on('pet:update-layout', (_event, layout) => updatePetLayout(layout));
  ipcMain.on('pet:context-menu', showPetContextMenu);
  ipcMain.on('pet:drag-start', (event) => {
    if (!petWindow || petWindow.isDestroyed() || event.sender !== petWindow.webContents) return;
    const cursor = screen.getCursorScreenPoint();
    const bounds = petWindow.getBounds();
    petDragState = { offsetX: cursor.x - bounds.x, offsetY: cursor.y - bounds.y };
  });
  ipcMain.on('pet:drag-move', (event) => {
    if (!petWindow || petWindow.isDestroyed() || event.sender !== petWindow.webContents || !petDragState) return;
    const cursor = screen.getCursorScreenPoint();
    config.position = {
      x: Math.round(cursor.x - petDragState.offsetX),
      y: Math.round(cursor.y - petDragState.offsetY)
    };
    petWindow.setPosition(config.position.x, config.position.y, false);
    saveConfigSoon();
  });
  ipcMain.on('pet:drag-end', (event) => {
    if (!petWindow || petWindow.isDestroyed() || event.sender !== petWindow.webContents || !petDragState) return;
    const applyDeferredLayout = petLayoutDeferredDuringDrag;
    petDragState = null;
    petLayoutDeferredDuringDrag = false;
    if (applyDeferredLayout && petLayoutState) applyPetLayout(petLayoutState);
  });
  ipcMain.on('pet:move-by', (_event, delta) => {
    if (!petWindow || petWindow.isDestroyed()) return;
    const dx = Number(delta?.dx);
    const dy = Number(delta?.dy);
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) return;
    const [x, y] = petWindow.getPosition();
    config.position = { x: Math.round(x + dx), y: Math.round(y + dy) };
    petWindow.setPosition(config.position.x, config.position.y, false);
    saveConfigSoon();
  });
}

const openPanelOnLaunch = process.argv.includes('--open-panel');

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => createPanelWindow());
  app.whenReady().then(() => {
    app.setAppUserModelId(APP_ID);
    ensureStorage();
    forcomeCli = new ForcomeCliManager({
      appRoot: __dirname,
      resourcesPath: process.resourcesPath,
      isPackaged: app.isPackaged,
      log: writeLog,
      onProcessExit: ({ kind, code, signal }) => {
        writeLog(`FORCOME AI ${kind}进程已退出：code=${code ?? 'null'} signal=${signal || 'none'}`);
        if (!isQuitting) scheduleForcomeMaintenance(kind === '连接器' ? 1500 : 800, true);
      }
    });
    forcomeStatusWatchPath = forcomeCli.daemonStatusPath;
    fs.watchFile(forcomeStatusWatchPath, { interval: 5000, persistent: false }, () => refreshForcomeStatus());
    writeLog('应用启动。');
    writeLog(`启动参数：${process.argv.join(' | ')}；启动控制面板：${openPanelOnLaunch}`);
    createChineseAppMenu();
    loadConfig();
    setupIpc();
    createPetWindow();
    createTray();
    maintainForcomeConnector({ immediate: app.isPackaged }).catch((error) => writeLog('自动启动 FORCOME AI 连接器失败。', error));
    notes.filter((note) => note.visible).forEach((note) => createNoteWindow(note.id));
    if (openPanelOnLaunch) createPanelWindow();
    setupAutoUpdater();
    scheduler = new ReminderScheduler({ getReminders: () => config.reminders, saveReminders, notify: notifyReminder, log: writeLog });
    scheduler.start();
    startHandbookReminders();
    scheduleEmployeePolicySync();
    syncEmployeePolicy().catch(() => {});
    powerMonitor.on('resume', () => { scheduler?.reschedule('resume'); petWindow?.webContents.send('pet:performance-suspend', false); maintainForcomeConnector({ immediate: true }).catch((error) => writeLog('系统恢复后重连 FORCOME AI 失败。', error)); });
    powerMonitor.on('lock-screen', () => petWindow?.webContents.send('pet:performance-suspend', true));
    powerMonitor.on('suspend', () => petWindow?.webContents.send('pet:performance-suspend', true));
    powerMonitor.on('unlock-screen', () => { scheduler?.reschedule('unlock'); petWindow?.webContents.send('pet:performance-suspend', false); maintainForcomeConnector({ immediate: true }).catch((error) => writeLog('解锁后重连 FORCOME AI 失败。', error)); });
    screen.on('display-removed', restorePanelToVisibleArea);
    screen.on('display-metrics-changed', restorePanelToVisibleArea);
    writeLog('应用启动完成。');
  }).catch((error) => { writeLog('应用启动失败。', error); throw error; });
}

process.on('uncaughtException', (error) => writeLog('未捕获异常。', error));
process.on('unhandledRejection', (error) => writeLog('未处理的 Promise 拒绝。', error));

app.on('activate', () => showPet());
app.on('window-all-closed', () => {
  // CLI and the FORCOME tray are the primary application. Closing or releasing
  // every optional UI window must not terminate the background connector.
  writeLog('所有界面窗口均已关闭，FORCOME AI CLI 与托盘继续运行。');
});
app.on('before-quit', (event) => {
  if (updaterInstalling && updaterShutdownPromise) return;
  isQuitting = true;
  if (shutdownCleanupComplete) return;
  event.preventDefault();
  if (shutdownCleanupStarted) return;
  shutdownCleanupStarted = true;
  scheduler?.stop();
  stopHandbookReminders();
  clearTimeout(employeePolicyTimer);
  employeePolicyAbortController?.abort();
  clearTimeout(forcomeSupervisorTimer);
  if (forcomeStatusWatchPath) fs.unwatchFile(forcomeStatusWatchPath);
  flushPendingNoteBounds();
  saveConfigNow();
  forcomeCli?.stopTrackedProcesses();
  const stopPromise = forcomeCli?.stopConnector().catch((error) => writeLog('退出时停止 FORCOME AI 连接器失败。', error)) || Promise.resolve();
  Promise.race([stopPromise, new Promise((resolve) => setTimeout(resolve, 5000))]).finally(() => {
    shutdownCleanupComplete = true;
    app.quit();
  });
});
