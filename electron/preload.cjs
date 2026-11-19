const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  minimizeWindow: () => ipcRenderer.send('archivetune:window-minimize'),
  maximizeWindow: () => ipcRenderer.send('archivetune:window-maximize'),
  closeWindow: () => ipcRenderer.send('archivetune:window-close'),
  toggleOverlayWindow: () => ipcRenderer.send('archivetune:toggle-overlay'),
  closeOverlayWindow: () => ipcRenderer.send('archivetune:close-overlay'),
  setOverlayMovable: (movable) => ipcRenderer.send('archivetune:set-overlay-movable', movable),
  setMinimizeToTray: (enabled) => ipcRenderer.send('archivetune:set-minimize-to-tray', enabled),
  selectDirectory: () => ipcRenderer.invoke('archivetune:select-directory'),
  getDefaultStoragePath: () => ipcRenderer.invoke('archivetune:get-default-storage-path'),
  getCacheSize: () => ipcRenderer.invoke('archivetune:get-cache-size'),
  clearCache: () => ipcRenderer.invoke('archivetune:clear-cache'),
  onOverlayState: (callback) => {
    const handler = (_event, state) => callback(state);
    ipcRenderer.on('archivetune:overlay-state', handler);
    return () => ipcRenderer.removeListener('archivetune:overlay-state', handler);
  },
  openGoogleSignIn: () => ipcRenderer.invoke('archivetune:google-signin'),
  openYtMusicSignIn: () => ipcRenderer.invoke('archivetune:ytmusic-signin'),
  clearYtMusicSession: () => ipcRenderer.invoke('archivetune:ytmusic-signout'),
  onMediaAction: (callback) => {
    const handler = (_event, action) => callback(action);
    ipcRenderer.on('archivetune:media', handler);
    return () => ipcRenderer.removeListener('archivetune:media', handler);
  },
});
