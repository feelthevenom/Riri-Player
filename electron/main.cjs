const {
  app,
  BrowserWindow,
  globalShortcut,
  ipcMain,
  Menu,
  Tray,
  nativeImage,
  session,
  safeStorage,
  dialog,
  shell,
} = require('electron');
const crypto = require('node:crypto');
const path = require('node:path');
const fs = require('node:fs');
const {
  UPDATE_REPOSITORY,
  createUpdateInfoFromRelease,
  fetchLatestGitHubRelease,
  getPublicErrorMessage,
  getUpdateAvailability,
  isMissingUpdateMetadataError,
} = require('./update-utils.cjs');

// Auto-updater setup
let autoUpdater = null;
let updateCheckInProgress = false;

// Initialize electron-log first for proper logging
let log = null;
try {
  log = require('electron-log');
  // Set log file path explicitly - works for both installed and portable
  const logPath = path.join(app.getPath('userData'), 'logs', 'main.log');
  // Ensure log directory exists
  const logDir = path.dirname(logPath);
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }
  log.transports.file.resolvePath = () => logPath;
  log.transports.file.level = 'info';
  log.transports.console.level = 'info';
  // Don't use preload - initialize manually
  Object.assign(console, log.functions);
  console.log('[AutoUpdater] electron-log initialized, log path:', logPath);
} catch (err) {
  console.warn('[AutoUpdater] Failed to initialize electron-log:', err?.message || err);
}

// Try to initialize auto-updater for both installed and portable builds
// app.isPackaged should be true for both NSIS and portable builds from electron-builder
const isProduction = app.isPackaged || process.env.NODE_ENV === 'production';
console.log('[AutoUpdater] isProduction:', isProduction, 'app.isPackaged:', app.isPackaged, 'NODE_ENV:', process.env.NODE_ENV);
if (isProduction) {
  try {
    console.log('[AutoUpdater] Attempting to load electron-updater...');
    const { autoUpdater: au } = require('electron-updater');
    autoUpdater = au;
    if (log) autoUpdater.logger = log;
    autoUpdater.autoDownload = false; // Respect user setting
    autoUpdater.autoInstallOnAppQuit = true;
    // Configure GitHub update server explicitly
    autoUpdater.setFeedURL({
      provider: 'github',
      owner: UPDATE_REPOSITORY.owner,
      repo: UPDATE_REPOSITORY.repo,
    });
    console.log('[AutoUpdater] Initialized for GitHub releases');
    console.log('[AutoUpdater] Feed URL:', autoUpdater.feedURL);
    console.log('[AutoUpdater] App path:', app.getPath('exe'));
    console.log('[AutoUpdater] UserData path:', app.getPath('userData'));
  } catch (err) {
    console.warn('[AutoUpdater] Failed to load electron-updater:', err?.message || err);
    console.warn('[AutoUpdater] Stack:', err?.stack);
  }
} else {
  console.log('[AutoUpdater] Not initialized (development mode)');
}

// Must be called before app.whenReady():
// 1) Keeps navigator.webdriver natively false in Blink without JS overrides
// 2) Disables WebAuthn / Passkey conditional UI in C++ so Windows Security does not pop up
app.commandLine.appendSwitch('disable-blink-features', 'AutomationControlled');
app.commandLine.appendSwitch(
  'disable-features',
  'WebAuthentication,WebAuthenticationConditionalUI,WebAuthn',
);
// Keep Electron/Chromium RAM usage lean
app.commandLine.appendSwitch('js-flags', '--max-old-space-size=384');
app.commandLine.appendSwitch('disk-cache-size', String(50 * 1024 * 1024));
app.commandLine.appendSwitch('media-cache-size', String(50 * 1024 * 1024));
app.commandLine.appendSwitch('renderer-process-limit', '2');

// Default YouTube Music login mode to 'native' (works better than 'firefox' fallback)
if (!process.env.RIRI_YTM_LOGIN_MODE) {
  process.env.RIRI_YTM_LOGIN_MODE = 'native';
}

process.on('uncaughtException', (err) => {
  console.warn('[Riri Player Main Process Warning]:', err?.message || err);
});
process.on('unhandledRejection', (reason) => {
  console.warn('[Riri Player Main Process Unhandled Rejection]:', reason?.message || reason);
});

let mainWindow = null;
let overlayWindow = null;
let tray = null;
let appServer = null;
let appPort = 3000;
let isQuitting = false;
let minimizeToTraySetting = false;

const LAUNCH_SECRET = crypto.randomBytes(24).toString('hex');
const PORT_STATE_FILE = path.join(app.getPath('userData'), 'launcher-port.json');

async function readPersistedPort() {
  try {
    const raw = await fs.promises.readFile(PORT_STATE_FILE, 'utf8');
    const obj = JSON.parse(raw);
    if (typeof obj.port === 'number' && obj.port > 0) return obj.port;
  } catch {
    // No persisted port yet; will use a random port and persist it.
  }
  return null;
}

async function persistPort(port) {
  try {
    await fs.promises.writeFile(
      PORT_STATE_FILE,
      JSON.stringify({ port, updatedAt: Date.now() }),
      { encoding: 'utf8', mode: 0o600 },
    );
  } catch {
    // Persisting the port is best-effort; a random port will be used next launch.
  }
}

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
  process.exit(0);
}

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
});

app.on('before-quit', () => {
  isQuitting = true;
});

app.on('child-process-gone', (_e, detail) => {
  const d = detail || {};
  console.error(
    `[Electron child-process-gone] exitCode=${d.exitCode ?? 'unknown'} reason="${d.reason ?? 'unknown'}" crashType="${d.crashType ?? 'unknown'}"`,
  );
});

async function startInternalBackend() {
  if (app.isPackaged) {
    try {
      const { startAppServer } = require('./server.cjs');
      const distDir = path.join(__dirname, '..', 'dist');
      const preferredPort = await readPersistedPort();
      let res;
      try {
        res = await startAppServer({
          distDir,
          port: preferredPort || 0,
          host: '127.0.0.1',
          launchSecret: LAUNCH_SECRET,
        });
      } catch (err) {
        // Preferred persisted port is in use; fall back to a random port.
        console.warn('[Backend] Preferred port in use, using random port:', err.message);
        res = await startAppServer({
          distDir,
          port: 0,
          host: '127.0.0.1',
          launchSecret: LAUNCH_SECRET,
        });
      }
      appPort = res.port;
      appServer = res.server;
      await persistPort(appPort);
      console.log(`Internal Riri Player proxy listening on http://127.0.0.1:${appPort}`);
    } catch (err) {
      console.error('Failed to start internal backend:', err);
    }
  }
}

function resolveAppIconPath() {
  const icoPath = path.join(__dirname, '..', 'build', 'icon.ico');
  if (fs.existsSync(icoPath)) return icoPath;
  const pngPath = path.join(__dirname, '..', 'public', 'icon.png');
  return fs.existsSync(pngPath) ? pngPath : undefined;
}

function createWindow() {
  const iconPath = resolveAppIconPath();
  mainWindow = new BrowserWindow({
    width: 1366,
    height: 820,
    minWidth: 1024,
    minHeight: 640,
    frame: false,
    backgroundColor: '#121011',
    title: 'Riri Player',
    icon: iconPath,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  const isDev = !app.isPackaged;
  const targetUrl = isDev ? 'http://localhost:3000' : `http://127.0.0.1:${appPort}`;
  mainWindow.loadURL(targetUrl);

  mainWindow.on('close', (e) => {
    if (!isQuitting && minimizeToTraySetting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on('enter-full-screen', () => {
    mainWindow?.webContents.send('ririplayer:fullscreen-state', true);
  });

  mainWindow.on('leave-full-screen', () => {
    mainWindow?.webContents.send('ririplayer:fullscreen-state', false);
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  mainWindow.webContents.on('render-process-gone', (_e, detail) => {
    const d = detail || {};
    console.error(
      `[Main render-process-gone] exitCode=${d.exitCode ?? 'unknown'} reason="${d.reason ?? 'unknown'}" crashType="${d.crashType ?? 'unknown'}"`,
    );
  });
  mainWindow.webContents.on('unresponsive', () => {
    console.error('[Main unresponsive] main window render process became unresponsive');
  });
}

function restoreMainFromOverlay(openCinema = false) {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.close();
    overlayWindow = null;
  }
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
    mainWindow.webContents.send('ririplayer:overlay-state', false);
    if (openCinema) {
      mainWindow.webContents.send('ririplayer:open-cinema');
    }
  }
}

function toggleOverlayWindow() {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    restoreMainFromOverlay(false);
    return false;
  }

  const { screen } = require('electron');
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height } = primaryDisplay.workAreaSize;

  const overlayWidth = 468;
  const overlayHeight = 192;
  const overlayX = Math.max(10, Math.round(width - overlayWidth - 24));
  const overlayY = Math.max(10, Math.round(height - overlayHeight - 24));

  const iconPath = resolveAppIconPath();

  overlayWindow = new BrowserWindow({
    width: overlayWidth,
    height: overlayHeight,
    minWidth: overlayWidth,
    minHeight: overlayHeight,
    maxWidth: overlayWidth,
    maxHeight: overlayHeight,
    x: overlayX,
    y: overlayY,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: false,
    resizable: false,
    hasShadow: false,
    fullscreenable: false,
    icon: iconPath,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // Pin mini-player at screen-saver level so it stays above fullscreen games and other apps
  const enforceOverlayTopmost = () => {
    if (overlayWindow && !overlayWindow.isDestroyed()) {
      overlayWindow.setAlwaysOnTop(true, 'screen-saver', 1);
    }
  };
  enforceOverlayTopmost();
  overlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  overlayWindow.once('ready-to-show', enforceOverlayTopmost);
  overlayWindow.on('show', enforceOverlayTopmost);
  overlayWindow.on('blur', enforceOverlayTopmost);
  const topmostInterval = setInterval(enforceOverlayTopmost, 2000);

  const isDev = !app.isPackaged;
  const targetUrl = isDev
    ? 'http://localhost:3000/#/mini-overlay'
    : `http://127.0.0.1:${appPort}/#/mini-overlay`;

  overlayWindow.loadURL(targetUrl);

  overlayWindow.on('closed', () => {
    clearInterval(topmostInterval);
    overlayWindow = null;
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
      mainWindow.webContents.send('ririplayer:overlay-state', false);
    }
  });

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('ririplayer:overlay-state', true);
    mainWindow.hide();
  }
  return true;
}

function createTray() {
  const iconPath = resolveAppIconPath();
  const trayIcon = iconPath
    ? nativeImage.createFromPath(iconPath)
    : nativeImage.createEmpty();
  tray = new Tray(trayIcon);
  tray.setToolTip('Riri Player Desktop Music Client');
  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show Riri Player',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        }
      },
    },
    { type: 'separator' },
    {
      label: 'Play / Pause',
      click: () => mainWindow?.webContents.send('ririplayer:media', 'play-pause'),
    },
    {
      label: 'Next Track',
      click: () => mainWindow?.webContents.send('ririplayer:media', 'next'),
    },
    {
      label: 'Previous Track',
      click: () => mainWindow?.webContents.send('ririplayer:media', 'prev'),
    },
    { type: 'separator' },
    {
      label: 'Quit Riri Player',
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);
  tray.setContextMenu(contextMenu);
  tray.on('double-click', () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

app.whenReady().then(async () => {
  await startInternalBackend();

  // Register ArchiveTune-style YouTube Music + Spotify IPC handlers in main process
  const ytmBundlePath = path.join(__dirname, 'ytm-main.cjs');
  if (fs.existsSync(ytmBundlePath)) {
    const { registerYtmIpcHandlers } = require(ytmBundlePath);
    registerYtmIpcHandlers({
      app,
      BrowserWindow,
      session,
      ipcMain,
      safeStorage,
      getMainWindow: () => mainWindow,
    });
  }

  // Register proxy config IPC handler BEFORE creating window
  // so frontend can get proxy config immediately on load
  ipcMain.handle('ririplayer:get-proxy-config', () => {
    return {
      baseUrl: app.isPackaged ? `http://127.0.0.1:${appPort}` : '',
      token: app.isPackaged ? LAUNCH_SECRET : '',
    };
  });

  createWindow();
  createTray();

  ipcMain.on('ririplayer:set-minimize-to-tray', (_event, enabled) => {
    minimizeToTraySetting = Boolean(enabled);
  });
  ipcMain.on('ririplayer:window-minimize', () => {
    if (!mainWindow) return;
    if (minimizeToTraySetting) mainWindow.hide();
    else mainWindow.minimize();
  });
  ipcMain.on('ririplayer:window-maximize', () => {
    if (!mainWindow) return;
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
  });
  ipcMain.on('ririplayer:window-close', () => {
    if (!mainWindow) return;
    if (minimizeToTraySetting) mainWindow.hide();
    else mainWindow.close();
  });
  ipcMain.on('ririplayer:set-fullscreen', (_event, fullscreen) => {
    if (!mainWindow) return;
    mainWindow.setFullScreen(Boolean(fullscreen));
  });
  ipcMain.on('ririplayer:toggle-overlay', () => toggleOverlayWindow());
  ipcMain.on('ririplayer:close-overlay', () => {
    restoreMainFromOverlay(false);
  });
  ipcMain.on('ririplayer:restore-from-mini', (_event, openCinema) => {
    restoreMainFromOverlay(Boolean(openCinema));
  });
  ipcMain.on('ririplayer:set-overlay-movable', (_event, movable) => {
    if (overlayWindow && !overlayWindow.isDestroyed()) {
      overlayWindow.setMovable(Boolean(movable));
    }
  });
  ipcMain.on('ririplayer:minimize-overlay', () => {
    if (overlayWindow && !overlayWindow.isDestroyed()) {
      overlayWindow.minimize();
    }
  });

  ipcMain.handle('ririplayer:select-directory', async () => {
    const { dialog } = require('electron');
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory', 'createDirectory'],
      title: 'Select Offline Storage Location',
    });
    if (!result.canceled && result.filePaths && result.filePaths[0]) {
      return { ok: true, path: result.filePaths[0] };
    }
    return { ok: false };
  });

  ipcMain.handle('ririplayer:get-default-storage-path', async () => {
    const defaultPath = path.join(app.getPath('userData'), 'OfflineMedia');
    if (!fs.existsSync(defaultPath)) {
      try {
        fs.mkdirSync(defaultPath, { recursive: true });
      } catch {}
    }
    return defaultPath;
  });

  ipcMain.handle('ririplayer:get-cache-size', async () => {
    try {
      const sizeBytes = await session.defaultSession.getCacheSize();
      return { ok: true, sizeBytes };
    } catch {
      return { ok: false, sizeBytes: 0 };
    }
  });

  ipcMain.handle('ririplayer:clear-cache', async () => {
    try {
      await session.defaultSession.clearCache();
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err?.message };
    }
  });

  // Auto-updater IPC handlers
  ipcMain.handle('ririplayer:check-for-updates', async () => {
    const currentVersion = app.getVersion();
    console.log('[AutoUpdater] check-for-updates called, autoUpdater:', autoUpdater ? 'exists' : 'null');
    console.log('[AutoUpdater] current version:', currentVersion);
    console.log('[AutoUpdater] app.isPackaged:', app.isPackaged);
    console.log('[AutoUpdater] userData path:', app.getPath('userData'));
    console.log('[AutoUpdater] exe path:', app.getPath('exe'));
    if (!autoUpdater) {
      return { ok: false, error: 'Auto-updater not available (not initialized)', currentVersion };
    }

    updateCheckInProgress = true;
    try {
      const result = await autoUpdater.checkForUpdates();
      console.log('[AutoUpdater] checkForUpdates result:', result);
      if (!result) {
        return { ok: false, error: 'Update check returned no result', currentVersion };
      }

      const updateInfo = result.updateInfo || null;
      // electron-updater always returns `updateInfo` (latest server version),
      // but `isUpdateAvailable` is the authoritative flag for whether it is newer
      // than the installed app version.
      return {
        ok: true,
        updateInfo,
        isUpdateAvailable: Boolean(result.isUpdateAvailable),
        currentVersion,
        source: 'electron-updater',
      };
    } catch (err) {
      console.error('[AutoUpdater] checkForUpdates error:', err);

      // A GitHub release may exist without the electron-builder update manifest.
      // In that case electron-updater cannot install anything, but the release
      // tag is still enough to determine whether the user is already current.
      if (isMissingUpdateMetadataError(err)) {
        try {
          const release = await fetchLatestGitHubRelease({
            owner: UPDATE_REPOSITORY.owner,
            repo: UPDATE_REPOSITORY.repo,
            appVersion: currentVersion,
            fetchImpl: session.defaultSession.fetch.bind(session.defaultSession),
          });
          const availability = getUpdateAvailability(release.version, currentVersion);
          console.log(
            `[AutoUpdater] Missing latest.yml; GitHub release v${release.version}, current v${currentVersion}, comparison: ${availability.comparison}`,
          );

          if (!availability.isUpdateAvailable) {
            return {
              ok: true,
              updateInfo: createUpdateInfoFromRelease(release),
              isUpdateAvailable: false,
              currentVersion,
              source: 'github-release-fallback',
            };
          }

          const metadataError =
            `Update v${release.version} is available, but automatic installation is unavailable because the release is missing latest.yml. ` +
            'Download and install it manually from the GitHub release page.';
          console.error(`[AutoUpdater] ${metadataError}`);
          return {
            ok: false,
            error: metadataError,
            currentVersion,
            latestVersion: release.version,
            metadataMissing: true,
            releaseUrl: release.htmlUrl,
            source: 'github-release-fallback',
          };
        } catch (fallbackError) {
          console.error('[AutoUpdater] GitHub release fallback failed:', fallbackError);
          return {
            ok: false,
            error:
              'Could not verify the latest GitHub release because the update metadata is missing. ' +
              getPublicErrorMessage(fallbackError, 'GitHub release check failed.'),
            currentVersion,
            metadataMissing: true,
            source: 'github-release-fallback',
          };
        }
      }

      return {
        ok: false,
        error: getPublicErrorMessage(err, 'Update check failed'),
        currentVersion,
      };
    } finally {
      updateCheckInProgress = false;
    }
  });

  ipcMain.handle('ririplayer:open-release-page', async (_event, releaseUrl) => {
    try {
      const parsedUrl = new URL(releaseUrl);
      if (parsedUrl.protocol !== 'https:' || parsedUrl.hostname !== 'github.com') {
        return { ok: false, error: 'Invalid GitHub release URL' };
      }
      await shell.openExternal(parsedUrl.toString());
      return { ok: true };
    } catch (err) {
      console.error('[AutoUpdater] Failed to open GitHub release page:', err);
      return { ok: false, error: err?.message || 'Failed to open the GitHub release page' };
    }
  });

  ipcMain.handle('ririplayer:download-update', async () => {
    if (!autoUpdater) {
      return { ok: false, error: 'Auto-updater not available' };
    }
    try {
      await autoUpdater.downloadUpdate();
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err?.message || 'Download failed' };
    }
  });

  ipcMain.handle('ririplayer:install-update', async () => {
    if (!autoUpdater) {
      return { ok: false, error: 'Auto-updater not available' };
    }
    autoUpdater.quitAndInstall(false, true);
    return { ok: true };
  });

  ipcMain.handle('ririplayer:get-update-settings', async () => {
    // Settings are stored in renderer localStorage, just return defaults here
    return { ok: true, autoDownload: false, checkOnStartup: true };
  });

  // Auto-updater events - forward to renderer
  if (autoUpdater) {
    autoUpdater.on('checking-for-update', () => {
      mainWindow?.webContents.send('ririplayer:update-status', { status: 'checking' });
    });
    autoUpdater.on('update-available', (info) => {
      mainWindow?.webContents.send('ririplayer:update-status', { status: 'available', info });
    });
    autoUpdater.on('update-not-available', () => {
      mainWindow?.webContents.send('ririplayer:update-status', { status: 'not-available' });
    });
    autoUpdater.on('error', (err) => {
      // The IPC handler resolves missing latest.yml errors through the GitHub
      // release-version fallback. Do not show a transient error toast before
      // that fallback can return the correct up-to-date result.
      if (updateCheckInProgress && isMissingUpdateMetadataError(err)) {
        console.warn('[AutoUpdater] Release metadata is missing; using GitHub release version fallback.');
        return;
      }
      mainWindow?.webContents.send('ririplayer:update-status', {
        status: 'error',
        error: getPublicErrorMessage(err, 'Update check failed'),
      });
    });
    autoUpdater.on('download-progress', (progress) => {
      mainWindow?.webContents.send('ririplayer:update-progress', progress);
    });
    autoUpdater.on('update-downloaded', (info) => {
      mainWindow?.webContents.send('ririplayer:update-status', { status: 'downloaded', info });
    });
  }

  globalShortcut.register('MediaPlayPause', () => {
    mainWindow?.webContents.send('ririplayer:media', 'play-pause');
  });
  globalShortcut.register('MediaNextTrack', () => {
    mainWindow?.webContents.send('ririplayer:media', 'next');
  });
  globalShortcut.register('MediaPreviousTrack', () => {
    mainWindow?.webContents.send('ririplayer:media', 'prev');
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    try {
      overlayWindow.close();
    } catch {}
  }
  if (appServer) {
    try {
      appServer.close();
    } catch {
      // ignore
    }
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});