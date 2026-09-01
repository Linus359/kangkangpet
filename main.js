'use strict';

const { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, Notification, powerMonitor, screen, shell, Tray } = require('electron');
const { autoUpdater } = require('electron-updater');
const crypto = require('crypto');
const { spawn } = require('child_process');
const fs = require('fs');
const https = require('https');
const path = require('path');
const { pathToFileURL } = require('url');
const { ConfigStore } = require('./src/main/config-store');
const { Logger } = require('./src/main/logger');
const { migrateLegacyPayload } = require('./src/main/migration');
const { parseReminderBackup, parseReminderCsv, parseReminderText, parseReminderXlsx, serializeReminderBackup } = require('./src/main/reminder-backup');
const { ReminderScheduler } = require('./src/main/reminder-scheduler');
const { applyReminderBulkAction, mergeImportedReminders, normalizeReminders, normalizeSource, sortReminders, validateReminder } = require('./src/main/reminders');
const { DEFAULT_PET_SIZE, MAX_PET_SIZE, MIN_PET_SIZE, chooseDefaultAsset, clampPetPosition, defaultPetPosition, getPetBounds: calculatePetBounds, normalizePetSize } = require('./src/main/pet-layout');

const APP_NAME = '康康熊桌宠';
const APP_ID = 'com.forcome.kangkangpet';
const FORCOME_AI_URL = 'https://ai.forcome.com';
const RELEASE_NOTES_URL = 'https://api.github.com/repos/Linus359/kangkangpet/releases?per_page=100';
const FORCOME_AI_NAME_PATTERN = /forcome\s*ai|forcome/i;
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
  configVersion: 4,
  reminderFeatureVersion: 3,
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
  reminderDrafts: []
};

let config;
let configPath;
let mediaDir;
let configStore;
let logger;
let scheduler;
let petWindow;
let panelWindow;
let quickReminderWindow;
let tray;
let saveTimer;
let isQuitting = false;
let pendingPetLayout = null;
let petLayoutScheduled = false;
let updaterConfigured = false;
let updaterCheckPromise = null;
let updaterState = { status: 'idle', version: null, message: '尚未检查更新。' };

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
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('checking-for-update', () => setUpdaterState({ status: 'checking', message: '正在检查更新...' }));
  autoUpdater.on('error', (error) => {
    setUpdaterState({ status: 'error', version: null, message: '检查更新失败，请稍后重试。' });
    writeLog('在线更新检查失败。', error);
  });
  autoUpdater.on('update-available', (info) => {
    setUpdaterState({ status: 'downloading', version: info.version, message: `发现新版本 ${info.version}，正在下载...` });
    writeLog(`发现在线更新：${info.version}。`);
  });
  autoUpdater.on('update-not-available', () => setUpdaterState({ status: 'latest', version: app.getVersion(), message: `当前已是最新版本（${app.getVersion()}）。` }));
  autoUpdater.on('update-downloaded', (info) => {
    setUpdaterState({ status: 'downloaded', version: info.version, message: `新版本 ${info.version} 已下载，退出应用后安装。` });
    writeLog(`在线更新已下载：${info.version}。将在退出应用后安装。`);
    try {
      new Notification({ title: APP_NAME, body: `新版本 ${info.version} 已下载，将在退出康康熊后自动安装。` }).show();
    } catch (error) {
      writeLog('无法显示更新完成通知。', error);
    }
  });
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
        const next = { status: 'downloading', version: version || null, message: version ? `发现新版本 ${version}，正在下载...` : '发现新版本，正在下载...' };
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
  next.configVersion = 4;
  next.reminderFeatureVersion = 3;
  next.size = normalizePetSize(legacyDefaultSize ? DEFAULT_PET_SIZE : next.size);
  next.autoLaunch = next.autoLaunch === true;
  next.interactionButtons = normalizeButtons(next.interactionButtons);
  const buttonIds = new Set(next.interactionButtons.map((button) => button.id));
  next.assets = (Array.isArray(next.assets) ? next.assets : []).map((asset) => normalizeAsset(asset, buttonIds));
  next.responses = asList(next.responses, defaultConfig.responses);
  next.idleMessages = asList(next.idleMessages, defaultConfig.idleMessages);
  next.actionMessages = { ...defaultActionMessages, ...(next.actionMessages && typeof next.actionMessages === 'object' ? next.actionMessages : {}) };
  for (const [key, value] of Object.entries(next.actionMessages)) next.actionMessages[key] = asList(value, defaultActionMessages[key] || defaultConfig.idleMessages);
  next.reminders = normalizeReminders(next.reminders);
  next.reminderDrafts = normalizeReminderDrafts(next.reminderDrafts);
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
  tryMigrateLegacyReminders();
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
  return {
    ...config,
    assets: config.assets.map((asset) => ({ ...asset, fileUrl: asset.path && fs.existsSync(asset.path) ? pathToFileURL(asset.path).toString() : null })),
    reminders: config.reminders.map((reminder) => ({
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
    const display = displays.find(({ workArea }) => position.x >= workArea.x && position.x <= workArea.x + workArea.width && position.y >= workArea.y && position.y <= workArea.y + workArea.height) || screen.getPrimaryDisplay();
    return clampPetPosition(position, bounds, display.workArea);
  }
  const workArea = screen.getPrimaryDisplay().workArea;
  return defaultPetPosition(workArea, bounds);
}

function resizePetWindow() {
  if (!petWindow || petWindow.isDestroyed()) return;
  const bounds = getPetBounds();
  const position = visiblePetPosition(config.position || petWindow.getBounds(), bounds);
  const current = petWindow.getBounds();
  const nextBounds = { ...position, ...bounds };
  config.position = position;
  if (current.x === nextBounds.x && current.y === nextBounds.y && current.width === nextBounds.width && current.height === nextBounds.height) return;
  petWindow.setBounds(nextBounds, false);
}

function applyPetLayout(layout) {
  if (!petWindow || petWindow.isDestroyed() || !layout || typeof layout !== 'object') return;
  const bubble = layout.bubble?.visible ? layout.bubble : null;
  const menu = layout.menu?.visible ? layout.menu : null;
  const bounds = getPetBounds(bubble, layout.assetId, menu);
  const current = petWindow.getBounds();
  const oldBottom = current.y + current.height;
  const position = visiblePetPosition({ x: current.x + Math.round((current.width - bounds.width) / 2), y: oldBottom - bounds.height }, bounds);
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
  resizePetWindow();
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
    webPreferences: { preload: path.join(__dirname, 'preload', 'pet-preload.js'), contextIsolation: true, nodeIntegration: false }
  });
  config.position = position;
  petWindow.setAlwaysOnTop(true, 'screen-saver');
  petWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  petWindow.loadFile('pet.html');
  petWindow.on('show', () => petWindow?.webContents.send('pet:visibility', true));
  petWindow.on('hide', () => petWindow?.webContents.send('pet:visibility', false));
  petWindow.on('closed', () => { petWindow = null; });
  petWindow.webContents.on('render-process-gone', (_event, details) => writeLog(`桌宠渲染进程异常：${details.reason}`));
  return petWindow;
}

function createPanelWindow(tab = null) {
  writeLog(`正在创建控制面板窗口${tab ? `（${tab}）` : ''}。`);
  if (panelWindow && !panelWindow.isDestroyed()) {
    panelWindow.show();
    panelWindow.focus();
    if (tab) panelWindow.webContents.send('panel:open-tab', tab);
    return panelWindow;
  }
  const bounds = config.panelBounds || { width: 1040, height: 780 };
  panelWindow = new BrowserWindow({
    ...bounds,
    show: true,
    minWidth: 760,
    minHeight: 560,
    title: `${APP_NAME}控制面板`,
    backgroundColor: '#f6f4ef',
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload', 'panel-preload.js'), contextIsolation: true, nodeIntegration: false }
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
    backgroundColor: '#f6f4ef',
    parent: panelWindow || undefined,
    modal: Boolean(panelWindow),
    webPreferences: { preload: path.join(__dirname, 'preload', 'quick-reminder-preload.js'), contextIsolation: true, nodeIntegration: false }
  });
  quickReminderWindow.setMenuBarVisibility(false);
  quickReminderWindow.loadFile('quick-reminder.html');
  quickReminderWindow.on('closed', () => { quickReminderWindow = null; });
  return quickReminderWindow;
}

function appIconPath() {
  const ico = path.join(__dirname, 'build', 'face.ico');
  const png = path.join(__dirname, 'build', 'face.png');
  return fs.existsSync(ico) ? ico : fs.existsSync(png) ? png : null;
}

function showPet() {
  const win = createPetWindow();
  win.showInactive();
}

function hidePet() {
  if (petWindow && !petWindow.isDestroyed()) petWindow.hide();
}

function quitApp() {
  isQuitting = true;
  app.quit();
}

function trayMenuTemplate() {
  const petVisible = Boolean(petWindow && !petWindow.isDestroyed() && petWindow.isVisible());
  return [
    { label: petVisible ? '隐藏康康熊' : '显示康康熊', click: petVisible ? hidePet : showPet },
    { label: '开机自动启动', type: 'checkbox', checked: config.autoLaunch, click: (item) => applyConfigPatch({ autoLaunch: item.checked }) },
    { type: 'separator' },
    { label: '退出', click: quitApp }
  ];
}

function createTray() {
  if (tray) return;
  const iconPath = appIconPath();
  tray = new Tray(iconPath ? nativeImage.createFromPath(iconPath) : nativeImage.createEmpty());
  tray.setToolTip(APP_NAME);
  tray.on('click', () => createPanelWindow());
  tray.on('right-click', () => tray.popUpContextMenu(Menu.buildFromTemplate(trayMenuTemplate())));
}

function showPetContextMenu() {
  if (!petWindow || petWindow.isDestroyed()) return;
  Menu.buildFromTemplate(trayMenuTemplate()).popup({ window: petWindow });
}

function focusedWindow() {
  const win = BrowserWindow.getFocusedWindow();
  return win && !win.isDestroyed() ? win : null;
}

function createChineseAppMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: '文件', submenu: [{ label: '打开控制面板', accelerator: 'CommandOrControl+,', click: () => createPanelWindow() }, { label: '快速新建提醒', click: createQuickReminderWindow }, { type: 'separator' }, { label: '退出', accelerator: 'CommandOrControl+Q', click: quitApp }] },
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
  if (Object.prototype.hasOwnProperty.call(input, 'responses')) next.responses = asList(input.responses, config.responses);
  if (Object.prototype.hasOwnProperty.call(input, 'idleMessages')) next.idleMessages = asList(input.idleMessages, config.idleMessages);
  if (Object.prototype.hasOwnProperty.call(input, 'interactionButtons')) next.interactionButtons = sanitizeRendererButtons(input.interactionButtons);
  if (Object.prototype.hasOwnProperty.call(input, 'assets')) next.assets = sanitizeRendererAssets(input.assets);
  if (Object.prototype.hasOwnProperty.call(input, 'actionMessages') && input.actionMessages && typeof input.actionMessages === 'object') next.actionMessages = input.actionMessages;
  const oldAutoLaunch = config.autoLaunch;
  config = normalizeConfig(next);
  if (config.autoLaunch !== oldAutoLaunch) applyAutoLaunchSetting();
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
  const before = config.reminders.length;
  config.reminders = config.reminders.filter((item) => item.id !== String(reminderId));
  if (config.reminders.length !== before) {
    config.reminders = sortReminders(config.reminders);
    saveReminders('delete');
    scheduler?.reschedule('delete');
  }
  return publicConfig();
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
  const ordered = ids.map(String).map((id) => lookup.get(id)).filter(Boolean);
  if (ordered.length !== config.reminders.length || new Set(ids.map(String)).size !== ordered.length) return publicConfig();
  config.reminders = ordered.map((item, index) => ({ ...item, sortOrder: index }));
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

function startMenuRoots() {
  const roots = [];
  try { roots.push(path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs')); } catch (_) { /* app may not be ready in tests */ }
  if (process.env.PROGRAMDATA) roots.push(path.join(process.env.PROGRAMDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs'));
  return [...new Set(roots)];
}

function collectFiles(root, predicate, maxDepth = 4, depth = 0, result = []) {
  if (!root || depth > maxDepth || !fs.existsSync(root)) return result;
  let entries;
  try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch (_) { return result; }
  for (const entry of entries) {
    const fullPath = path.join(root, entry.name);
    if (entry.isFile() && predicate(fullPath, entry.name)) result.push(fullPath);
    else if (entry.isDirectory()) collectFiles(fullPath, predicate, maxDepth, depth + 1, result);
  }
  return result;
}

function browserAppCandidates() {
  const candidates = [];
  const chromeRoots = [
    path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'User Data'),
    path.join(process.env.APPDATA || '', 'Google', 'Chrome', 'User Data')
  ];
  const edgeRoots = [
    path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'Edge', 'User Data'),
    path.join(process.env.APPDATA || '', 'Microsoft', 'Edge', 'User Data')
  ];
  for (const root of [...chromeRoots, ...edgeRoots]) {
    const appDirs = collectFiles(root, (_file, name) => FORCOME_AI_NAME_PATTERN.test(name) && /\.(ico|png|json)$/i.test(name), 5)
      .map((file) => path.dirname(file))
      .filter((dir) => /Web Applications[\\/]_crx_[^\\/]+$/i.test(dir));
    for (const dir of appDirs) {
      const match = dir.match(/[\\/]_crx_([^\\/]+)$/i);
      if (match) candidates.push({ appId: match[1], profileDirectory: path.basename(path.dirname(path.dirname(dir))), browser: root.includes('Microsoft\\Edge') ? 'edge' : 'chrome' });
    }
  }
  return candidates;
}

function browserExecutable(browser) {
  const paths = browser === 'edge'
    ? [path.join(process.env.PROGRAMFILES || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'), path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe')]
    : [path.join(process.env.PROGRAMFILES || '', 'Google', 'Chrome', 'Application', 'chrome.exe'), path.join(process.env['PROGRAMFILES(X86)'] || '', 'Google', 'Chrome', 'Application', 'chrome.exe'), path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe')];
  return paths.find((candidate) => candidate && fs.existsSync(candidate)) || null;
}

function launchDetached(executable, args) {
  if (!executable || !fs.existsSync(executable)) return false;
  try {
    const child = spawn(executable, args, { detached: true, stdio: 'ignore', windowsHide: true });
    child.unref();
    return true;
  } catch (error) {
    writeLog(`启动 FORCOME AI 失败：${executable}`, error);
    return false;
  }
}

async function installBrowserAppShortcut() {
  const candidate = browserAppCandidates()[0];
  const browser = candidate?.browser || ['chrome', 'edge'].find((name) => browserExecutable(name));
  if (!browser || typeof shell.writeShortcutLink !== 'function') return null;
  const executable = browserExecutable(browser);
  const proxy = browser === 'chrome'
    ? path.join(path.dirname(executable || ''), 'chrome_proxy.exe')
    : path.join(path.dirname(executable || ''), 'msedge_proxy.exe');
  const target = candidate?.appId && fs.existsSync(proxy) ? proxy : null;
  if (!target) return null;
  let shortcut;
  try {
    const shortcutDir = path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Chrome 应用');
    fs.mkdirSync(shortcutDir, { recursive: true });
    shortcut = path.join(shortcutDir, 'FORCOME AI.lnk');
    const created = shell.writeShortcutLink(shortcut, fs.existsSync(shortcut) ? 'replace' : 'create', {
      target,
      args: `--profile-directory=${candidate.profileDirectory || 'Default'} --app-id=${candidate.appId}`,
      cwd: path.dirname(target),
      description: 'FORCOME AI · 内部 AI 门户'
    });
    if (!created) return null;
    const error = await shell.openPath(shortcut);
    if (!error) return shortcut;
    writeLog(`无法打开自动创建的 FORCOME 快捷方式：${shortcut}`, new Error(error));
  } catch (error) {
    writeLog('自动创建 FORCOME AI 应用入口失败。', error);
  }
  return null;
}

async function openInstalledPwa() {
  // Prefer the browser-managed PWA proxy so a stale URL shortcut cannot change
  // the window chrome or launch mode.
  for (const candidate of browserAppCandidates()) {
    const executable = browserExecutable(candidate.browser);
    const proxy = candidate.browser === 'chrome'
      ? path.join(path.dirname(executable || ''), 'chrome_proxy.exe')
      : path.join(path.dirname(executable || ''), 'msedge_proxy.exe');
    if (launchDetached(fs.existsSync(proxy) ? proxy : executable, [`--profile-directory=${candidate.profileDirectory || 'Default'}`, `--app-id=${candidate.appId}`])) {
      return { opened: true, installed: true, message: '正在打开 FORCOME AI。' };
    }
  }

  const shortcutNames = ['FORCOME AI.lnk', 'FORCOME AI.url', 'FORCOME.lnk'];
  const shortcuts = startMenuRoots().flatMap((root) => collectFiles(root, (_file, name) => shortcutNames.includes(name), 4));
  for (const shortcut of shortcuts) {
    // A previously generated URL-style shortcut is not the installed PWA; skip it
    // so the browser's real app-id entry can be selected below.
    if (/\.lnk$/i.test(shortcut)) {
      try {
        const shortcutText = fs.readFileSync(shortcut, 'utf8');
        if (/--app=https:\/\/ai\.forcome\.com/i.test(shortcutText)) continue;
      } catch (_) { /* binary .lnk files are inspected by the shell below */ }
    }
    const error = await shell.openPath(shortcut);
    if (!error) return { opened: true, installed: true, message: '正在打开 FORCOME AI。' };
    writeLog(`无法打开 FORCOME 快捷方式：${shortcut}`, new Error(error));
  }

  if (await installBrowserAppShortcut()) {
    return { opened: true, installed: true, message: '已自动创建并打开 FORCOME AI 应用入口。' };
  }

  for (const browser of ['chrome', 'edge']) {
    const executable = browserExecutable(browser);
    if (launchDetached(executable, [`--app=${FORCOME_AI_URL}`])) {
      return { opened: true, installed: false, message: '正在打开 FORCOME AI 应用窗口。首次使用可在窗口菜单中安装。' };
    }
  }

  try {
    const opened = await shell.openExternal(FORCOME_AI_URL);
    if (opened === undefined || opened === true) {
      return { opened: true, installed: false, message: '正在打开 FORCOME AI。首次使用可在浏览器菜单中安装为应用。' };
    }
  } catch (error) {
    writeLog('打开 FORCOME AI 网页失败。', error);
  }
  return { opened: false, installed: false, message: '无法打开 FORCOME AI，请检查浏览器或网络连接。' };
}

function setupIpc() {
  ipcMain.handle('app:get-info', () => ({ version: app.getVersion(), isPackaged: app.isPackaged, updater: publicUpdaterState() }));
  ipcMain.handle('app:check-for-updates', () => checkForUpdates());
  ipcMain.handle('app:get-release-notes', () => getReleaseNotes());
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
  ipcMain.handle('pet:open-pwa', openInstalledPwa);
  ipcMain.on('pet:set-click-through', (_event, ignore) => setPetClickThrough(ignore));
  ipcMain.on('pet:update-layout', (_event, layout) => updatePetLayout(layout));
  ipcMain.on('pet:context-menu', showPetContextMenu);
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
    writeLog('应用启动。');
    writeLog(`启动参数：${process.argv.join(' | ')}；启动控制面板：${openPanelOnLaunch}`);
    createChineseAppMenu();
    loadConfig();
    setupIpc();
    createPetWindow();
    createTray();
    if (openPanelOnLaunch) createPanelWindow();
    setupAutoUpdater();
    scheduler = new ReminderScheduler({ getReminders: () => config.reminders, saveReminders, notify: notifyReminder, log: writeLog });
    scheduler.start();
    powerMonitor.on('resume', () => scheduler?.reschedule('resume'));
    powerMonitor.on('unlock-screen', () => scheduler?.reschedule('unlock'));
    writeLog('应用启动完成。');
  }).catch((error) => { writeLog('应用启动失败。', error); throw error; });
}

process.on('uncaughtException', (error) => writeLog('未捕获异常。', error));
process.on('unhandledRejection', (error) => writeLog('未处理的 Promise 拒绝。', error));

app.on('activate', () => showPet());
app.on('window-all-closed', () => { saveConfigNow(); });
app.on('before-quit', () => { isQuitting = true; scheduler?.stop(); saveConfigNow(); });
