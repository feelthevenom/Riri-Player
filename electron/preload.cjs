const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  minimizeWindow: () => ipcRenderer.send('ririplayer:window-minimize'),
  maximizeWindow: () => ipcRenderer.send('ririplayer:window-maximize'),
  closeWindow: () => ipcRenderer.send('ririplayer:window-close'),
  setFullscreen: (fullscreen) => ipcRenderer.send('ririplayer:set-fullscreen', fullscreen),
  onFullscreenState: (callback) => {
    const handler = (_event, state) => callback(state);
    ipcRenderer.on('ririplayer:fullscreen-state', handler);
    return () => ipcRenderer.removeListener('ririplayer:fullscreen-state', handler);
  },
  toggleOverlayWindow: () => ipcRenderer.send('ririplayer:toggle-overlay'),
  closeOverlayWindow: () => ipcRenderer.send('ririplayer:close-overlay'),
  restoreFromMiniPlayer: (openCinema) =>
    ipcRenderer.send('ririplayer:restore-from-mini', Boolean(openCinema)),
  onRestoreCinema: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('ririplayer:open-cinema', handler);
    return () => ipcRenderer.removeListener('ririplayer:open-cinema', handler);
  },
  setOverlayMovable: (movable) => ipcRenderer.send('ririplayer:set-overlay-movable', movable),
  setMinimizeToTray: (enabled) => ipcRenderer.send('ririplayer:set-minimize-to-tray', enabled),
  selectDirectory: () => ipcRenderer.invoke('ririplayer:select-directory'),
  getDefaultStoragePath: () => ipcRenderer.invoke('ririplayer:get-default-storage-path'),
  getCacheSize: () => ipcRenderer.invoke('ririplayer:get-cache-size'),
  clearCache: () => ipcRenderer.invoke('ririplayer:clear-cache'),
  onOverlayState: (callback) => {
    const handler = (_event, state) => callback(state);
    ipcRenderer.on('ririplayer:overlay-state', handler);
    return () => ipcRenderer.removeListener('ririplayer:overlay-state', handler);
  },
  openGoogleSignIn: () => ipcRenderer.invoke('ririplayer:google-signin'),
  openYtMusicSignIn: () => ipcRenderer.invoke('ririplayer:ytmusic-signin'),
  clearYtMusicSession: () => ipcRenderer.invoke('ririplayer:ytmusic-signout'),
  openSpotifySignIn: () => ipcRenderer.invoke('ririplayer:spotify-signin'),
  clearSpotifySession: () => ipcRenderer.invoke('ririplayer:spotify-signout'),
  onMediaAction: (callback) => {
    const handler = (_event, action) => callback(action);
    ipcRenderer.on('ririplayer:media', handler);
    return () => ipcRenderer.removeListener('ririplayer:media', handler);
  },
});
