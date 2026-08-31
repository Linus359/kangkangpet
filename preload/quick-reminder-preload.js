'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('quickReminderApi', {
  save: (reminder) => ipcRenderer.invoke('quick-reminder:save', reminder),
  cancel: () => ipcRenderer.invoke('quick-reminder:close')
});
