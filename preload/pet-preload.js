'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('petApi', {
  getConfig: () => ipcRenderer.invoke('config:get'),
  openPanel: (tab) => ipcRenderer.invoke('panel:open', tab),
  openQuickReminder: () => ipcRenderer.invoke('quick-reminder:open'),
  moveBy: (delta) => ipcRenderer.send('pet:move-by', delta),
  updateLayout: (layout) => ipcRenderer.send('pet:update-layout', layout),
  setClickThrough: (ignore) => ipcRenderer.send('pet:set-click-through', Boolean(ignore)),
  showContextMenu: () => ipcRenderer.send('pet:context-menu'),
  openPwa: () => ipcRenderer.invoke('pet:open-pwa'),
  onConfigChanged: (callback) => ipcRenderer.on('config:changed', (_event, config) => callback(config)),
  onVisibilityChanged: (callback) => ipcRenderer.on('pet:visibility', (_event, visible) => callback(Boolean(visible))),
  onPerformanceSuspend: (callback) => ipcRenderer.on('pet:performance-suspend', (_event, suspended) => callback(Boolean(suspended))),
  onReminder: (callback) => ipcRenderer.on('reminder:triggered', (_event, reminder) => callback(reminder))
});
