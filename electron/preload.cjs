const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Window & Shell Controls
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
  getProxyConfig: () => ipcRenderer.invoke('ririplayer:get-proxy-config'),
  onOverlayState: (callback) => {
    const handler = (_event, state) => callback(state);
    ipcRenderer.on('ririplayer:overlay-state', handler);
    return () => ipcRenderer.removeListener('ririplayer:overlay-state', handler);
  },
  onMediaAction: (callback) => {
    const handler = (_event, action) => callback(action);
    ipcRenderer.on('ririplayer:media', handler);
    return () => ipcRenderer.removeListener('ririplayer:media', handler);
  },

  // Auto-updater
  checkForUpdates: () => ipcRenderer.invoke('ririplayer:check-for-updates'),
  openReleasePage: (releaseUrl) => ipcRenderer.invoke('ririplayer:open-release-page', releaseUrl),
  downloadUpdate: () => ipcRenderer.invoke('ririplayer:download-update'),
  installUpdate: () => ipcRenderer.invoke('ririplayer:install-update'),
  getUpdateSettings: () => ipcRenderer.invoke('ririplayer:get-update-settings'),
  onUpdateStatus: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('ririplayer:update-status', handler);
    return () => ipcRenderer.removeListener('ririplayer:update-status', handler);
  },
  onUpdateProgress: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('ririplayer:update-progress', handler);
    return () => ipcRenderer.removeListener('ririplayer:update-progress', handler);
  },

  // ArchiveTune-style YouTube Music + Spotify Session IPC (no raw cookies exposed)
  auth: {
    ytmStatus: () => ipcRenderer.invoke('auth:ytm:status'),
    ytmVaultDiagnostic: () => ipcRenderer.invoke('auth:ytm:vault-diagnostic'),
    ytmInvalidateVaultCache: () => ipcRenderer.invoke('auth:ytm:invalidate-vault-cache'),
    ytmLogin: (options) => ipcRenderer.invoke('auth:ytm:login', options),
    ytmCancel: () => ipcRenderer.invoke('auth:ytm:cancel'),
    ytmImportBrowser: (payload) => ipcRenderer.invoke('auth:ytm:import-browser', payload),
    ytmSwitch: (accountId) => ipcRenderer.invoke('auth:ytm:switch', accountId),
    ytmLogout: (accountId) => ipcRenderer.invoke('auth:ytm:logout', accountId),
    spotifyStatus: () => ipcRenderer.invoke('auth:spotify:status'),
    spotifyLogin: () => ipcRenderer.invoke('auth:spotify:login'),
    spotifyLogout: () => ipcRenderer.invoke('auth:spotify:logout'),
  },

  library: {
    sync: (payload) => ipcRenderer.invoke('library:sync', payload),
    like: (payload) => ipcRenderer.invoke('library:like', payload),
    onProgress: (callback) => {
      const handler = (_event, progress) => callback(progress);
      ipcRenderer.on('library:progress', handler);
      return () => ipcRenderer.removeListener('library:progress', handler);
    },
  },

  home: {
    feed: (payload) => ipcRenderer.invoke('home:feed', payload),
    charts: (payload) => ipcRenderer.invoke('home:charts', payload),
    browse: (payload) => ipcRenderer.invoke('home:browse', payload),
  },

  search: {
    query: (payload) => ipcRenderer.invoke('search:query', payload),
    suggestions: (payload) => ipcRenderer.invoke('search:suggestions', payload),
  },

  queue: {
    next: (payload) => ipcRenderer.invoke('queue:next', payload),
    lyrics: (payload) => ipcRenderer.invoke('queue:lyrics', payload),
  },

  spotify: {
    sync: (payload) => ipcRenderer.invoke('spotify:sync', payload),
    importPlaylist: (payload) => ipcRenderer.invoke('spotify:import-playlist', payload),
    setSchedule: (schedule) => ipcRenderer.invoke('spotify:set-schedule', schedule),
    dismissUnmatched: (trackId) => ipcRenderer.invoke('spotify:dismiss-unmatched', trackId),
  },
});
