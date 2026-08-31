'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('petApi', {
  getConfig: () => ipcRenderer.invoke('config:get'),
  openPanel: (tab) => ipcRenderer.invoke('panel:open', tab),
  openQuickReminder: () => ipcRenderer.invoke('quick-reminder:open'),
  moveBy: (delta) => ipcRenderer.send('pet:move-by', delta),
  reportActivity: () => ipcRenderer.send('pet:activity'),
  wakeFromEdge: () => ipcRenderer.invoke('pet:wake-edge'),
  finishEdgeWake: () => ipcRenderer.invoke('pet:finish-edge-wake'),
  updateLayout: (layout) => ipcRenderer.send('pet:update-layout', layout),
  setClickThrough: (ignore) => ipcRenderer.send('pet:set-click-through', Boolean(ignore)),
  showContextMenu: () => ipcRenderer.send('pet:context-menu'),
  openPwa: () => ipcRenderer.invoke('pet:open-pwa'),
  onConfigChanged: (callback) => ipcRenderer.on('config:changed', (_event, config) => callback(config)),
  onVisibilityChanged: (callback) => ipcRenderer.on('pet:visibility', (_event, visible) => callback(Boolean(visible))),
  onEdgeStateChanged: (callback) => ipcRenderer.on('pet:edge-state', (_event, state) => callback(state || {})),
  onReminder: (callback) => ipcRenderer.on('reminder:triggered', (_event, reminder) => callback(reminder))
});
