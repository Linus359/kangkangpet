'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('noteApi', {
  get: () => ipcRenderer.invoke('notes:get'),
  update: (patch) => ipcRenderer.invoke('notes:update', patch),
  hide: () => ipcRenderer.invoke('notes:hide'),
  remove: () => ipcRenderer.invoke('notes:delete'),
  toggleAlwaysOnTop: () => ipcRenderer.invoke('notes:toggle-always-on-top'),
  onChanged: (callback) => ipcRenderer.on('notes:changed', (_event, note) => callback(note)),
  onError: (callback) => ipcRenderer.on('notes:error', (_event, message) => callback(String(message || '便利贴保存失败。')))
});
