const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  selectDirectory: () => ipcRenderer.invoke('select-directory'),
  getSvnLog: (params) => ipcRenderer.invoke('get-svn-log', params),
  readFile: (filePath) => ipcRenderer.invoke('read-file', filePath),
  getSvnFile: (params) => ipcRenderer.invoke('get-svn-file', params),
  listFiles: (dirPath) => ipcRenderer.invoke('list-files', dirPath),
  writeFile: (filePath, content) => ipcRenderer.invoke('write-file', filePath, content)
})
