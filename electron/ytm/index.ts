import type { LibrarySyncProgress, SpotifySyncSchedule } from '../../src/types/music';
import {
  attachCleanChromeHeaders,
  closeCurrentAuthWin,
  configureElectronYtmCookieRefresh,
  importYtmSessionFallback,
  loginYouTubeMusicWindow,
  logoutYtmAccount,
  resetYtmAuth,
  restoreYtmAccountFromSession,
  switchYtmAccount,
  YTM_PARTITION,
} from './auth';
import { configureBotGuardWindowFactory } from './botguard';
import {
  configureCredentialStorage,
  getActiveYtAccount,
  getVaultDiagnostic,
  invalidateVaultCache,
  resetYtVaultWithBackup,
  updateSpotifyCredentials,
} from './credentials';
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

function toYtmErrorPayload(error: unknown): {
  ok: false;
  error: string;
  code: string;
  retryable: boolean;
} {
  const candidate = error as { code?: unknown; retryable?: unknown } | null;
  const message =
    error instanceof Error && error.message
      ? error.message
      : 'YouTube Music authentication failed.';
  return {
    ok: false,
    error: message,
    code:
      typeof candidate?.code === 'string' && candidate.code
        ? candidate.code
        : error instanceof Error && error.name
          ? error.name
          : 'YtmAuthError',
    retryable: candidate?.retryable === true,
  };
}

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

  configureElectronYtmCookieRefresh((account) =>
    session.fromPartition(account.partitionName?.trim() || YTM_PARTITION),
  );

  configureBotGuardWindowFactory({
    createHiddenWindow: async (url: string) => {
      const active = await getActiveYtAccount();
      const partitionName = active?.partitionName?.trim() || YTM_PARTITION;
      const ses = session.fromPartition(partitionName);
      attachCleanChromeHeaders(ses);
      const win = new BrowserWindow({
        show: false,
        width: 480,
        height: 480,
        webPreferences: {
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
          partition: partitionName,
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
  ipcMain.handle('auth:ytm:status', async () => {
    // The persistent Electron partition remains signed in even if the
    // encrypted vault was lost. Recover the account before reporting status
    // so Home and Library use real authenticated credentials.
    return await restoreYtmAccountFromSession(session);
  });

  ipcMain.handle('auth:ytm:vault-diagnostic', () => getVaultDiagnostic());

  ipcMain.handle('auth:ytm:invalidate-vault-cache', async () => {
    await invalidateVaultCache();
    return { ok: true };
  });

  ipcMain.handle('auth:ytm:reset-vault', async () => {
    try {
      const result = await resetYtVaultWithBackup();
      return { ok: true, ...result };
    } catch (error) {
      return toYtmErrorPayload(error);
    }
  });

  ipcMain.handle('auth:ytm:reset', async () => {
    try {
      const status = await resetYtmAuth(session);
      return { ok: true, status };
    } catch (error) {
      return toYtmErrorPayload(error);
    }
  });

  ipcMain.handle(
    'auth:ytm:login',
    async (_ev, payload?: { cleanPartition?: boolean }) => {
      try {
        return await loginYouTubeMusicWindow({
          BrowserWindow,
          session,
          parentWindow: getMainWindow(),
          cleanPartition: payload?.cleanPartition === true,
        });
      } catch (error) {
        return toYtmErrorPayload(error);
      }
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
      const safePayload = {
        cookieHeader:
          typeof payload?.cookieHeader === 'string' ? payload.cookieHeader : '',
        visitorData:
          typeof payload?.visitorData === 'string' ? payload.visitorData : undefined,
        dataSyncId:
          typeof payload?.dataSyncId === 'string' ? payload.dataSyncId : undefined,
        accountIndex:
          typeof payload?.accountIndex === 'number' ? payload.accountIndex : undefined,
      };
      try {
        return await importYtmSessionFallback(safePayload);
      } catch (error) {
        return toYtmErrorPayload(error);
      }
    },
  );

  ipcMain.handle('auth:ytm:switch', async (_ev, accountId: string) => {
    try {
      return await switchYtmAccount(accountId);
    } catch (error) {
      return toYtmErrorPayload(error);
    }
  });

  ipcMain.handle('auth:ytm:logout', async (_ev, accountId?: string) => {
    try {
      return await logoutYtmAccount({ session, accountId });
    } catch (error) {
      return toYtmErrorPayload(error);
    }
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
      payload: {
        videoId: string;
        liked: boolean;
        gl?: string;
        hl?: string;
        expectedAccountId?: string | null;
      },
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
      payload: {
        videoId: string;
        lyricsBrowseId?: string;
        lyricsBrowseVideoId?: string;
        gl?: string;
        hl?: string;
      },
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
