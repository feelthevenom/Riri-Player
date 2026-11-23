import type { LibrarySyncProgress, SpotifySyncSchedule } from '../../src/types/music';
import {
  attachCleanChromeHeaders,
  closeCurrentAuthWin,
  configureElectronYtmCookieRefresh,
  getYtmAuthStatus,
  importYtmSessionFallback,
  loginYouTubeMusicWindow,
  logoutYtmAccount,
  switchYtmAccount,
  YTM_PARTITION,
} from './auth';
import { configureBotGuardWindowFactory } from './botguard';
import { configureCredentialStorage, updateSpotifyCredentials } from './credentials';
import {
  browseYtmCollection,
  fetchExploreCharts,
  fetchHomeFeed,
  fetchNextQueue,
  fetchYtmLyrics,
  fetchYtmSearchSuggestions,
  searchYtm,
} from './homeSearchQueue';
import { setYtmLikeStatus, syncYtmLibrary } from './library';
import {
  configureSpotifyBearerCaptureFallback,
  createElectronSpotifyBearerCapturer,
  getSpotifyStatus,
  loginSpotifyWindow,
  logoutSpotifyAccount,
  resolveManualSpotifyTrackList,
  setSpotifySyncSchedule,
  syncSpotifyLibraryToYtm,
} from './spotify';
import type {
  ElectronAppLike,
  ElectronBrowserWindowConstructorLike,
  ElectronBrowserWindowInstanceLike,
  ElectronIpcMainLike,
  ElectronSafeStorageLike,
  ElectronSessionModuleLike,
} from './electronTypes';

export interface RegisterYtmIpcParams {
  app: ElectronAppLike;
  BrowserWindow: ElectronBrowserWindowConstructorLike;
  session: ElectronSessionModuleLike;
  ipcMain: ElectronIpcMainLike;
  safeStorage: ElectronSafeStorageLike;
  getMainWindow: () => ElectronBrowserWindowInstanceLike | null;
}

export function registerYtmIpcHandlers(params: RegisterYtmIpcParams): void {
  const { app, BrowserWindow, session, ipcMain, safeStorage, getMainWindow } = params;

  configureCredentialStorage({
    userDataPath: app.getPath('userData'),
    safeStorage,
  });

  configureElectronYtmCookieRefresh(() => session.fromPartition(YTM_PARTITION));

  configureBotGuardWindowFactory({
    createHiddenWindow: async (url: string) => {
      const ses = session.fromPartition(YTM_PARTITION);
      attachCleanChromeHeaders(ses);
      const win = new BrowserWindow({
        show: false,
        width: 480,
        height: 480,
        webPreferences: {
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
          partition: YTM_PARTITION,
        },
      });
      try {
        await Promise.race([
          win.loadURL(url),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('BotGuard loadURL timeout')), 12000),
          ),
        ]);
      } catch (err) {
        try {
          if (!win.isDestroyed()) win.close();
        } catch {
          // ignore
        }
        throw err;
      }
      return {
        evalJs: <T>(script: string) => win.webContents.executeJavaScript(script) as Promise<T>,
        close: () => {
          try {
            if (!win.isDestroyed()) win.close();
          } catch {
            // ignore
          }
        },
      };
    },
  });

  configureSpotifyBearerCaptureFallback(
    createElectronSpotifyBearerCapturer({ BrowserWindow, session }),
  );

  // ── Auth IPC (YTM + Spotify) ─────────────────────────────────────────────
  ipcMain.handle('auth:ytm:status', () => getYtmAuthStatus());

  ipcMain.handle(
    'auth:ytm:login',
    async (_ev, payload?: { cleanPartition?: boolean }) => {
      return await loginYouTubeMusicWindow({
        BrowserWindow,
        session,
        parentWindow: getMainWindow(),
        cleanPartition: Boolean(payload?.cleanPartition),
      });
    },
  );

  ipcMain.handle('auth:ytm:cancel', () => {
    closeCurrentAuthWin();
    return { ok: true };
  });

  ipcMain.handle(
    'auth:ytm:import-browser',
    async (
      _ev,
      payload: {
        cookieHeader: string;
        visitorData?: string;
        dataSyncId?: string;
        accountIndex?: number;
      },
    ) => {
      return await importYtmSessionFallback(payload || { cookieHeader: '' });
    },
  );

  ipcMain.handle('auth:ytm:switch', async (_ev, accountId: string) => {
    return await switchYtmAccount(accountId);
  });

  ipcMain.handle('auth:ytm:logout', async (_ev, accountId?: string) => {
    return await logoutYtmAccount({ session, accountId });
  });

  ipcMain.handle('auth:spotify:status', () => getSpotifyStatus());

  ipcMain.handle('auth:spotify:login', async () => {
    return await loginSpotifyWindow({
      BrowserWindow,
      session,
      parentWindow: getMainWindow(),
    });
  });

  ipcMain.handle('auth:spotify:logout', async () => {
    return await logoutSpotifyAccount(session);
  });

  // ── Library IPC ───────────────────────────────────────────────────────────
  ipcMain.handle(
    'library:sync',
    async (_ev, payload?: { gl?: string; hl?: string }) => {
      console.log('[YTM Auth] Starting YouTube Music library sync...');
      return await syncYtmLibrary({
        gl: payload?.gl,
        hl: payload?.hl,
        onProgress: (progress: LibrarySyncProgress) => {
          const win = getMainWindow();
          if (win && !win.isDestroyed()) {
            win.webContents.send('library:progress', progress);
          }
        },
      });
    },
  );

  ipcMain.handle(
    'library:like',
    async (
      _ev,
      payload: { videoId: string; liked: boolean; gl?: string; hl?: string },
    ) => {
      return await setYtmLikeStatus(payload);
    },
  );

  // ── Home & Browse IPC ─────────────────────────────────────────────────────
  ipcMain.handle(
    'home:feed',
    async (
      _ev,
      payload?: { params?: string; continuation?: string; gl?: string; hl?: string },
    ) => {
      return await fetchHomeFeed(payload || {});
    },
  );

  ipcMain.handle(
    'home:charts',
    async (_ev, payload?: { gl?: string; hl?: string }) => {
      return await fetchExploreCharts(payload || {});
    },
  );

  ipcMain.handle(
    'home:browse',
    async (
      _ev,
      payload: { browseId: string; continuation?: string; gl?: string; hl?: string },
    ) => {
      return await browseYtmCollection(payload);
    },
  );

  // ── Search IPC ────────────────────────────────────────────────────────────
  ipcMain.handle(
    'search:query',
    async (
      _ev,
      payload: {
        query: string;
        filter?: string;
        continuation?: string;
        gl?: string;
        hl?: string;
      },
    ) => {
      return await searchYtm(payload);
    },
  );

  ipcMain.handle(
    'search:suggestions',
    async (_ev, payload: { query: string; gl?: string; hl?: string }) => {
      return await fetchYtmSearchSuggestions(payload);
    },
  );

  // ── Queue & Lyrics IPC ────────────────────────────────────────────────────
  ipcMain.handle(
    'queue:next',
    async (
      _ev,
      payload: {
        videoId?: string;
        playlistId?: string;
        params?: string;
        continuation?: string;
        gl?: string;
        hl?: string;
      },
    ) => {
      return await fetchNextQueue(payload || {});
    },
  );

  ipcMain.handle(
    'queue:lyrics',
    async (
      _ev,
      payload: { videoId: string; lyricsBrowseId?: string; gl?: string; hl?: string },
    ) => {
      return await fetchYtmLyrics(payload);
    },
  );

  // ── Spotify Sync & Mapping IPC ────────────────────────────────────────────
  ipcMain.handle(
    'spotify:sync',
    async (_ev, payload?: { gl?: string; hl?: string }) => {
      return await syncSpotifyLibraryToYtm(payload || {});
    },
  );

  ipcMain.handle(
    'spotify:import-playlist',
    async (_ev, payload: { input: string; gl?: string; hl?: string }) => {
      return await resolveManualSpotifyTrackList(payload);
    },
  );

  ipcMain.handle(
    'spotify:set-schedule',
    (_ev, schedule: SpotifySyncSchedule) => {
      return setSpotifySyncSchedule(schedule);
    },
  );

  ipcMain.handle(
    'spotify:dismiss-unmatched',
    (_ev, trackId: string) => {
      const status = getSpotifyStatus();
      if (!status) return null;
      const remaining = (status.unmatchedTracks || []).filter((t) => t.id !== trackId);
      return updateSpotifyCredentials({ unmatchedTracks: remaining });
    },
  );
}
