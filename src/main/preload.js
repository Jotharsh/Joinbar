'use strict';
const { contextBridge, ipcRenderer } = require('electron');

// The only things the pages can ask for. Anything else is refused in the main process.
contextBridge.exposeInMainWorld('joinbar', {
  state: () => ipcRenderer.invoke('jb:state'),
  do: (action) => ipcRenderer.invoke('jb:do', action),
  onState: (cb) => ipcRenderer.on('jb:state', (_e, s) => cb(s)),
  onTab: (cb) => ipcRenderer.on('jb:tab', (_e, t) => cb(t)),
  toast: () => ipcRenderer.invoke('jb:toast'),
  toastAction: (a) => ipcRenderer.invoke('jb:toastAction', a),
});
