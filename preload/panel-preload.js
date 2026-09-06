'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('panelApi', {
  getAppInfo: () => ipcRenderer.invoke('app:get-info'),
  checkForUpdates: () => ipcRenderer.invoke('app:check-for-updates'),
  getReleaseNotes: () => ipcRenderer.invoke('app:get-release-notes'),
  getForcomeCliStatus: () => ipcRenderer.invoke('forcome-cli:get-status'),
  loginForcomeCli: () => ipcRenderer.invoke('forcome-cli:login'),
  openForcomeAi: () => ipcRenderer.invoke('pet:open-pwa'),
  startForcomeConnector: () => ipcRenderer.invoke('forcome-cli:start'),
  stopForcomeConnector: () => ipcRenderer.invoke('forcome-cli:stop'),
  getConfig: () => ipcRenderer.invoke('config:get'),
  updateConfig: (patch) => ipcRenderer.invoke('config:update', patch),
  uploadAssets: () => ipcRenderer.invoke('assets:upload'),
  deleteAsset: (assetId) => ipcRenderer.invoke('assets:delete', assetId),
  saveReminder: (reminder) => ipcRenderer.invoke('reminders:save', reminder),
  deleteReminder: (reminderId) => ipcRenderer.invoke('reminders:delete', reminderId),
  bulkUpdateReminders: (ids, action) => ipcRenderer.invoke('reminders:bulk-update', ids, action),
  reorderReminders: (ids) => ipcRenderer.invoke('reminders:reorder', ids),
  importReminders: () => ipcRenderer.invoke('reminders:import'),
  importReminderText: (text) => ipcRenderer.invoke('reminders:import-text', text),
  deleteReminderDraft: (draftId) => ipcRenderer.invoke('reminders:draft-delete', draftId),
  promoteReminderDraft: (draftId, reminder) => ipcRenderer.invoke('reminders:draft-promote', draftId, reminder),
  exportReminders: () => ipcRenderer.invoke('reminders:export'),
  saveReminderTemplate: (csv) => ipcRenderer.invoke('reminders:template-save', csv),
  openQuickReminder: () => ipcRenderer.invoke('quick-reminder:open'),
  onConfigChanged: (callback) => ipcRenderer.on('config:changed', (_event, config) => callback(config)),
  onUpdateStatus: (callback) => ipcRenderer.on('app:update-status', (_event, status) => callback(status)),
  onForcomeCliStatus: (callback) => ipcRenderer.on('forcome-cli:status', (_event, status) => callback(status)),
  getChinaHolidays: (year) => ipcRenderer.invoke('china-holidays:get', year),
  onOpenTab: (callback) => ipcRenderer.on('panel:open-tab', (_event, tab) => callback(tab))
});
