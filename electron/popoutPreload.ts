import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('dhurtaPip', {
  close: () => ipcRenderer.invoke('pip:winClose'),
  goBack: () => ipcRenderer.invoke('pip:goBack'),
  goForward: () => ipcRenderer.invoke('pip:goForward'),
  setAlwaysOnTop: (val: boolean) => ipcRenderer.invoke('pip:setAlwaysOnTop', val),
  openInMain: () => ipcRenderer.invoke('pip:openInMain'),
  onUrlChanged: (cb: (url: string) => void) => {
    ipcRenderer.on('pip:urlChanged', (_e, url) => cb(url))
  },
  onTitleChanged: (cb: (t: string) => void) => {
    ipcRenderer.on('pip:titleChanged', (_e, t) => cb(t))
  },
})
