'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('browser', {
  command: (action, data) => ipcRenderer.invoke('command', action, data),
  onState: callback => ipcRenderer.on('state', (_, state) => callback(state)),
  onFocusAddress: callback => ipcRenderer.on('focus-address', () => callback())
});
