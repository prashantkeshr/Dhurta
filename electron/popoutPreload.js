// Preload for the browser pop-out (mini-browser) window's chrome bar.
// Bridges IPC between the chrome bar HTML (loaded via data: URL) and the main process.
'use strict'
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('dhurtaPip', {
  goBack:        () => ipcRenderer.invoke('pip:goBack'),
  goForward:     () => ipcRenderer.invoke('pip:goForward'),
  reload:        () => ipcRenderer.invoke('pip:reload'),
  close:         () => ipcRenderer.invoke('pip:winClose'),
  openInMain:    () => ipcRenderer.invoke('pip:openInMain'),
  focusMain:     () => ipcRenderer.invoke('pip:focusMain'),
  setAlwaysOnTop:(val) => ipcRenderer.invoke('pip:setAlwaysOnTop', val),
  setOpacity:    (val) => ipcRenderer.invoke('pip:setOpacity', val),
  minimize:      () => ipcRenderer.invoke('pip:minimize'),
  toggleMaximize:() => ipcRenderer.invoke('pip:toggleMaximize'),
  onUrlChanged:  (fn) => ipcRenderer.on('pip:urlChanged', (_e, url) => fn(url)),
  onTitleChanged:(fn) => ipcRenderer.on('pip:titleChanged', (_e, title) => fn(title)),
  onNavState:    (fn) => ipcRenderer.on('pip:navState', (_e, state) => fn(state)),
  onMaximizeState:(fn) => ipcRenderer.on('pip:maximizeState', (_e, isMax) => fn(isMax)),
})
