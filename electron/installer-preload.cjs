/**
 * 安装向导的预加载脚本 —— 只暴露安装所需的几个方法。
 */
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('setup', {
  info: () => ipcRenderer.invoke('installer:info'),
  pickDir: () => ipcRenderer.invoke('installer:pickDir'),
  install: (opts) => ipcRenderer.invoke('installer:install', opts),
  finish: (opts) => ipcRenderer.invoke('installer:finish', opts),
  minimize: () => ipcRenderer.invoke('installer:minimize'),
  close: () => ipcRenderer.invoke('installer:close'),
  onProgress: (cb) => {
    const handler = (_e, p) => cb(p)
    ipcRenderer.on('installer:progress', handler)
    return () => ipcRenderer.removeListener('installer:progress', handler)
  },
})
