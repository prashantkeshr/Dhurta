// Preload for download and warmth popup BrowserWindows
// Runs in popup windows to bridge IPC between the popup page and main process
'use strict'
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('popup', {
  on:     (ch, fn) => ipcRenderer.on(ch, (_e, ...a) => fn(...a)),
  invoke: (ch, ...a) => ipcRenderer.invoke(ch, ...a),
  close:  () => ipcRenderer.invoke('popup:close'),
})
