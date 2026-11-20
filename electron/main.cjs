const { app, BrowserWindow, globalShortcut, ipcMain, Menu, Tray, nativeImage, shell } = require('electron');
const path = require('node:path');
const http = require('node:http');
const fs = require('node:fs');

// Catch any unhandled timeout or background exceptions gracefully
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

async function startInternalBackend() {
  if (app.isPackaged) {
    try {
      const { startAppServer } = require('./server.cjs');
      const distDir = path.join(__dirname, '..', 'dist');
      const res = await startAppServer({ distDir });
      appPort = res.port;
      appServer = res.server;
      console.log(`Internal Riri Player backend listening on port ${appPort}`);
    } catch (err) {
      console.error('Failed to start internal backend:', err);
    }
  }
}

if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient('ririplayer', process.execPath, [path.resolve(process.argv[1])]);
  }
} else {
  app.setAsDefaultProtocolClient('ririplayer');
}

function createWindow() {
  const iconPath = path.join(__dirname, '..', 'build', 'icon.ico');
  mainWindow = new BrowserWindow({
    width: 1366,
    height: 820,
    minWidth: 1024,
    minHeight: 640,
    frame: false,
    backgroundColor: '#121011',
    title: 'Riri Player',
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
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

  const overlayWidth = 380;
  const overlayHeight = 185;
  const overlayX = Math.max(10, Math.round(width - overlayWidth - 24));
  const overlayY = Math.max(10, Math.round(height - overlayHeight - 24));

  const iconPath = path.join(__dirname, '..', 'build', 'icon.ico');

  overlayWindow = new BrowserWindow({
    width: overlayWidth,
    height: overlayHeight,
    x: overlayX,
    y: overlayY,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: false,
    resizable: false,
    hasShadow: false,
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  const isDev = !app.isPackaged;
  const targetUrl = isDev
    ? 'http://localhost:3000/#/mini-overlay'
    : `http://127.0.0.1:${appPort}/#/mini-overlay`;

  overlayWindow.loadURL(targetUrl);

  overlayWindow.on('closed', () => {
    overlayWindow = null;
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
      mainWindow.webContents.send('ririplayer:overlay-state', false);
    }
  });

  // Unified Mini-Player hides main application window while active
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('ririplayer:overlay-state', true);
    mainWindow.hide();
  }
  return true;
}

function createTray() {
  const iconPath = path.join(__dirname, '..', 'build', 'icon.ico');
  const trayIcon = fs.existsSync(iconPath) ? nativeImage.createFromPath(iconPath) : nativeImage.createEmpty();
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
  createWindow();
  createTray();

  ipcMain.on('ririplayer:set-minimize-to-tray', (_event, enabled) => {
    minimizeToTraySetting = Boolean(enabled);
  });
  ipcMain.on('ririplayer:window-minimize', () => {
    if (!mainWindow) return;
    if (minimizeToTraySetting) {
      mainWindow.hide();
    } else {
      mainWindow.minimize();
    }
  });
  ipcMain.on('ririplayer:window-maximize', () => {
    if (!mainWindow) return;
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
  });
  ipcMain.on('ririplayer:window-close', () => {
    if (!mainWindow) return;
    if (minimizeToTraySetting) {
      mainWindow.hide();
    } else {
      mainWindow.close();
    }
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
      const { session } = require('electron');
      const sizeBytes = await session.defaultSession.getCacheSize();
      return { ok: true, sizeBytes };
    } catch {
      return { ok: false, sizeBytes: 0 };
    }
  });

  ipcMain.handle('ririplayer:clear-cache', async () => {
    try {
      const { session } = require('electron');
      await session.defaultSession.clearCache();
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err?.message };
    }
  });

  // Open the user's default system browser (Chrome/Edge) for Google account selection and loopback redirect back into Riri Player
  ipcMain.handle('ririplayer:google-signin', async () => {
    return await new Promise((resolve) => {
      let finished = false;
      let timeoutId = null;
      const distDir = path.join(__dirname, '..', 'dist');

      const mimeTypes = {
        '.html': 'text/html; charset=utf-8',
        '.js': 'application/javascript; charset=utf-8',
        '.css': 'text/css; charset=utf-8',
        '.json': 'application/json; charset=utf-8',
        '.svg': 'image/svg+xml',
        '.png': 'image/png',
        '.ico': 'image/x-icon',
      };

      const server = http.createServer((req, res) => {
        const reqUrl = new URL(req.url || '/', 'http://127.0.0.1');

        if (req.method === 'OPTIONS') {
          res.writeHead(204, {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
          });
          res.end();
          return;
        }

        if (req.method === 'POST' && reqUrl.pathname === '/callback') {
          let body = '';
          req.on('data', (chunk) => {
            body += chunk.toString();
            if (body.length > 1024 * 64) body = body.slice(0, 1024 * 64);
          });
          req.on('end', () => {
            res.writeHead(200, {
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*',
            });
            res.end(JSON.stringify({ ok: true }));

            try {
              const parsed = JSON.parse(body || '{}');
              cleanup();
              if (mainWindow) {
                if (mainWindow.isMinimized()) mainWindow.restore();
                mainWindow.show();
                mainWindow.focus();
              }
              resolve({
                ok: Boolean(parsed.ok),
                uid: parsed.uid || '',
                name: parsed.name || '',
                email: parsed.email || '',
                avatarUrl: parsed.avatarUrl || '',
                accessToken: parsed.accessToken || '',
              });
            } catch {
              cleanup();
              resolve({ ok: false, error: 'Failed to parse Google sign-in callback.' });
            }
          });
          return;
        }

        // Serve built app assets locally in packaged mode so default browser opens on http://localhost:<port>
        const safeRel = reqUrl.pathname === '/' ? 'index.html' : reqUrl.pathname.replace(/^\/+/, '');
        const candidate = path.normalize(path.join(distDir, safeRel));
        const filePath = candidate.startsWith(distDir) && fs.existsSync(candidate) && fs.statSync(candidate).isFile()
          ? candidate
          : path.join(distDir, 'index.html');

        if (fs.existsSync(filePath)) {
          const ext = path.extname(filePath).toLowerCase();
          res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' });
          fs.createReadStream(filePath).pipe(res);
        } else {
          res.writeHead(404);
          res.end('Not found');
        }
      });

      const cleanup = () => {
        if (finished) return;
        finished = true;
        if (timeoutId) clearTimeout(timeoutId);
        try {
          server.close();
        } catch {
          // ignore
        }
      };

      server.on('error', () => {
        cleanup();
        resolve({ ok: false, error: 'Could not start local browser sign-in listener.' });
      });

      server.listen(0, '127.0.0.1', () => {
        const addr = server.address();
        const callbackPort = typeof addr === 'object' && addr ? addr.port : 0;
        if (!callbackPort) {
          cleanup();
          resolve({ ok: false, error: 'Could not bind local sign-in callback port.' });
          return;
        }

        const isDev = !app.isPackaged;
        const authUrl = isDev
          ? `http://localhost:3000/?desktopAuthPort=${callbackPort}`
          : `http://127.0.0.1:${appPort}/?desktopAuthPort=${callbackPort}`;

        void shell.openExternal(authUrl);

        timeoutId = setTimeout(() => {
          cleanup();
          resolve({ ok: false, error: 'Google sign-in timed out in browser.' });
        }, 5 * 60 * 1000);
      });
    });
  });

  ipcMain.handle('ririplayer:ytmusic-signin', async () => {
    return await new Promise((resolve) => {
      let finished = false;
      const done = (payload) => {
        if (finished) return;
        finished = true;
        resolve(payload);
      };

      const authWin = new BrowserWindow({
        width: 500,
        height: 680,
        parent: mainWindow || undefined,
        modal: false,
        title: 'Sign in - Google Accounts',
        backgroundColor: '#ffffff',
        autoHideMenuBar: true,
        webPreferences: {
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
          partition: 'persist:ytmusic_auth',
        },
      });

      const ses = authWin.webContents.session;
      const checkLogin = async () => {
        try {
          const currentUrl = authWin.webContents.getURL();
          if (!currentUrl.startsWith('https://music.youtube.com')) return;
          const [ytCookies, googleCookies] = await Promise.all([
            ses.cookies.get({ domain: '.youtube.com' }),
            ses.cookies.get({ domain: '.google.com' }),
          ]);
          const seen = new Map();
          for (const c of [...googleCookies, ...ytCookies]) {
            if (c.name && c.value) seen.set(c.name, c.value);
          }
          const hasSapisid = seen.has('SAPISID') || seen.has('__Secure-3PAPISID');
          if (!hasSapisid) return;

          // Poll up to 6 times (3 seconds) for ytcfg and avatar DOM elements to fully render
          let meta = { visitorData: '', dataSyncId: '', accountName: '', accountHandle: '', avatarUrl: '' };
          for (let attempt = 0; attempt < 6; attempt++) {
            try {
              meta = await authWin.webContents.executeJavaScript(
                `(() => {
                  try {
                    const cfg = window.ytcfg && window.ytcfg.data_ ? window.ytcfg.data_ : {};
                    let name = cfg.USER_NAME || '';
                    let handle = cfg.USER_EMAIL || '';
                    let avatarUrl = cfg.AVATAR_URL || '';

                    try {
                      const avatarImg = document.querySelector('ytmusic-app-header #avatar img, ytmusic-settings-button #avatar img, button#avatar-btn img, img#img, .yt-img-shadow img');
                      if (avatarImg && avatarImg.src && !avatarImg.src.startsWith('data:')) {
                        avatarUrl = avatarUrl || avatarImg.src;
                      }
                      const nameEl = document.querySelector('#account-name, ytd-active-account-header-renderer #account-name, yt-formatted-string.ytd-active-account-header-renderer');
                      if (nameEl && nameEl.textContent) {
                        name = name || nameEl.textContent.trim();
                      }
                    } catch {}

                    return {
                      visitorData: cfg.VISITOR_DATA || '',
                      dataSyncId: cfg.DATASYNC_ID || '',
                      accountName: name || '',
                      accountHandle: handle || '',
                      avatarUrl: avatarUrl || '',
                    };
                  } catch {
                    return { visitorData: '', dataSyncId: '', accountName: '', accountHandle: '', avatarUrl: '' };
                  }
                })()`,
              );
              if (meta.accountName || meta.avatarUrl || attempt === 5) break;
            } catch {}
            await new Promise((r) => setTimeout(r, 500));
          }

          const cookieStr = Array.from(seen.entries())
            .map(([k, v]) => `${k}=${v}`)
            .join('; ');
          done({
            ok: true,
            cookie: cookieStr,
            visitorData: meta.visitorData || '',
            dataSyncId: meta.dataSyncId || '',
            accountName: meta.accountName || '',
            accountHandle: meta.accountHandle || '',
            avatarUrl: meta.avatarUrl || '',
          });
          if (!authWin.isDestroyed()) authWin.close();
        } catch {
          // continue waiting
        }
      };

      authWin.webContents.on('did-finish-load', () => {
        void checkLogin();
      });
      authWin.webContents.on('did-navigate', () => {
        void checkLogin();
      });
      authWin.on('closed', () => {
        done({ ok: false, error: 'Google sign-in window closed.' });
      });

      void authWin.loadURL(
        'https://accounts.google.com/ServiceLogin?continue=https%3A%2F%2Fmusic.youtube.com',
      );
    });
  });

  ipcMain.handle('ririplayer:ytmusic-signout', async () => {
    try {
      const { session } = require('electron');
      const authSession = session.fromPartition('persist:ytmusic_auth');
      await authSession.clearStorageData({ storages: ['cookies', 'localstorage'] });
      return { ok: true };
    } catch {
      return { ok: false };
    }
  });

  // Automated Spotify Web Sign-In via Electron BrowserWindow (zero developer API keys needed)
  ipcMain.handle('ririplayer:spotify-signin', async () => {
    return await new Promise((resolve) => {
      let finished = false;
      const done = (payload) => {
        if (finished) return;
        finished = true;
        resolve(payload);
      };

      const authWin = new BrowserWindow({
        width: 520,
        height: 700,
        parent: mainWindow || undefined,
        modal: false,
        title: 'Sign in - Spotify',
        backgroundColor: '#121212',
        autoHideMenuBar: true,
        webPreferences: {
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
          partition: 'persist:spotify_auth',
        },
      });

      const ses = authWin.webContents.session;
      const checkSpotifyLogin = async () => {
        try {
          const currentUrl = authWin.webContents.getURL();
          if (!currentUrl.startsWith('https://open.spotify.com')) return;
          const spCookies = await ses.cookies.get({ domain: '.spotify.com' });
          const hasSpDc = spCookies.some((c) => c.name === 'sp_dc' && c.value);
          if (!hasSpDc) return;

          const sessionData = await authWin.webContents.executeJavaScript(
            `(async () => {
              try {
                const tokRes = await fetch('https://open.spotify.com/get_access_token?reason=transport&productType=web_player', {
                  credentials: 'include'
                });
                if (!tokRes.ok) return null;
                const tokJson = await tokRes.json();
                if (!tokJson || !tokJson.accessToken || tokJson.isAnonymous) return null;
                const meRes = await fetch('https://api.spotify.com/v1/me', {
                  headers: { Authorization: 'Bearer ' + tokJson.accessToken }
                });
                const me = meRes.ok ? await meRes.json() : {};
                return {
                  accessToken: tokJson.accessToken,
                  expiresAt: tokJson.accessTokenExpirationTimestampMs || (Date.now() + 3500 * 1000),
                  userId: me.id || 'spotify-user',
                  displayName: me.display_name || me.email || 'Spotify Listener',
                  email: me.email || '',
                  avatarUrl: (me.images && me.images[0] && me.images[0].url) || '',
                };
              } catch {
                return null;
              }
            })()`,
          );

          if (sessionData && sessionData.accessToken) {
            done({ ok: true, session: sessionData });
            if (!authWin.isDestroyed()) authWin.close();
          }
        } catch {
          // continue waiting for login completion
        }
      };

      authWin.webContents.on('did-finish-load', () => {
        void checkSpotifyLogin();
      });
      authWin.webContents.on('did-navigate', () => {
        void checkSpotifyLogin();
      });
      authWin.on('closed', () => {
        done({ ok: false, error: 'Spotify sign-in window closed.' });
      });

      void authWin.loadURL(
        'https://accounts.spotify.com/login?continue=' + encodeURIComponent('https://open.spotify.com/'),
      );
    });
  });

  ipcMain.handle('ririplayer:spotify-signout', async () => {
    try {
      const { session } = require('electron');
      const authSession = session.fromPartition('persist:spotify_auth');
      await authSession.clearStorageData({ storages: ['cookies', 'localstorage'] });
      return { ok: true };
    } catch {
      return { ok: false };
    }
  });

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
