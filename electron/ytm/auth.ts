import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { YtAuthStatusPayload } from '../../src/types/music';
import {
  computeSapisidHash,
  hasYouTubeLoginCookie,
  ORIGIN_YOUTUBE_MUSIC,
  REFERER_YOUTUBE_MUSIC,
  YOUTUBE_CLIENTS,
} from './clients';
import {
  getActiveYtAccount,
  getPublicYtAuthStatus,
  removeYtAccountById,
  switchActiveYtAccount,
  updateActiveYtAccountAuth,
  upsertYtAccount,
} from './credentials';
import type {
  ElectronBeforeSendHeadersDetailsLike,
  ElectronBrowserWindowConstructorLike,
  ElectronBrowserWindowInstanceLike,
  ElectronOnErrorOccurredDetailsLike,
  ElectronSessionLike,
  ElectronSessionModuleLike,
  ElectronWebContentsLike,
} from './electronTypes';
import {
  registerCookieRefreshCallback,
  resetInnertubeClientCache,
} from './innertube';

export const YTM_PARTITION = 'persist:ytm-login';
export const YTM_LOGIN_URL =
  'https://accounts.google.com/ServiceLogin?service=youtube&uilel=3&passive=true&continue=' +
  encodeURIComponent('https://music.youtube.com/?feature=autologin') +
  '&hl=en';

// 'firefox' avoids Google's 2026 Chrome UA-laundering rejection without requiring
// proprietary Google Chrome attestation; set RIRI_YTM_LOGIN_MODE=native to use untouched Electron UA.
export const YTM_AUTH_UA_MODE: 'firefox' | 'native' =
  process.env.RIRI_YTM_LOGIN_MODE === 'native' ? 'native' : 'firefox';

const FIREFOX_WIN_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:135.0) Gecko/20100101 Firefox/135.0';

export function getAuthWindowUserAgent(ses?: ElectronSessionLike): string {
  if (YTM_AUTH_UA_MODE === 'native' && ses) {
    return ses.getUserAgent();
  }
  return FIREFOX_WIN_UA;
}

const configuredSessions = new WeakSet<ElectronSessionLike>();

function safeUrlForLog(rawUrl: string): string {
  if (!rawUrl) return '(empty)';
  try {
    const parsed = new URL(rawUrl);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return rawUrl.split('?')[0] || '(invalid)';
  }
}

function isAllowedAuthPopupUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'https:') return false;
    const host = parsed.hostname.toLowerCase();
    return (
      host === 'accounts.google.com' ||
      host === 'myaccount.google.com' ||
      host === 'gds.google.com' ||
      host === 'music.youtube.com' ||
      host === 'www.youtube.com' ||
      host === 'youtube.com' ||
      host.endsWith('.accounts.google.com')
    );
  } catch {
    return false;
  }
}

function isGoogleSignInUrl(rawUrl: string): boolean {
  try {
    const host = new URL(rawUrl).hostname.toLowerCase();
    return (
      host === 'accounts.google.com' ||
      host === 'myaccount.google.com' ||
      host === 'gds.google.com' ||
      host.endsWith('.accounts.google.com')
    );
  } catch {
    return false;
  }
}

interface AccountMenuInfo {
  accountName: string;
  email: string;
  handle: string;
  avatarUrl: string;
}

function parseAccountMenuResponse(json: unknown): AccountMenuInfo {
  const info: AccountMenuInfo = {
    accountName: '',
    email: '',
    handle: '',
    avatarUrl: '',
  };
  if (!json || typeof json !== 'object') return info;

  const walk = (node: unknown, depth = 0) => {
    if (!node || typeof node !== 'object' || depth > 14) return;
    if (Array.isArray(node)) {
      for (const el of node) walk(el, depth + 1);
      return;
    }
    const obj = node as Record<string, unknown>;
    const header = obj.activeAccountHeaderRenderer as Record<string, unknown> | undefined;
    if (header) {
      const nameRuns = (header.accountName as { runs?: Array<{ text?: string }> } | undefined)?.runs;
      const simpleName = (header.accountName as { simpleText?: string } | undefined)?.simpleText;
      info.accountName =
        info.accountName ||
        (nameRuns || []).map((r) => r.text || '').join('').trim() ||
        simpleName ||
        '';

      const emailRuns = (header.email as { runs?: Array<{ text?: string }> } | undefined)?.runs;
      const simpleEmail = (header.email as { simpleText?: string } | undefined)?.simpleText;
      info.email =
        info.email ||
        (emailRuns || []).map((r) => r.text || '').join('').trim() ||
        simpleEmail ||
        '';

      const handleRuns = (header.channelHandle as { runs?: Array<{ text?: string }> } | undefined)?.runs;
      info.handle =
        info.handle ||
        (handleRuns || []).map((r) => r.text || '').join('').trim() ||
        '';

      const thumbs = (header.accountPhoto as { thumbnails?: Array<{ url?: string }> } | undefined)
        ?.thumbnails;
      if (thumbs && thumbs.length > 0 && !info.avatarUrl) {
        info.avatarUrl = String(thumbs[thumbs.length - 1]?.url || thumbs[0]?.url || '');
      }
    }
    for (const val of Object.values(obj)) {
      if (val && typeof val === 'object') walk(val, depth + 1);
    }
  };

  walk(json, 0);
  return info;
}

function extractDelegatedBrandPageId(dataSyncId: string): string | null {
  const sep = dataSyncId.indexOf('||');
  if (sep <= 0) return null;
  const pageId = dataSyncId.slice(0, sep).trim();
  const userId = dataSyncId.slice(sep + 2).trim();
  if (!pageId || !userId) return null;
  return pageId;
}

async function fetchAccountMenuWithCookies(
  cookie: string,
  visitorData: string,
  dataSyncId: string,
  accountIndex: number,
): Promise<AccountMenuInfo> {
  const profile = YOUTUBE_CLIENTS.WEB_REMIX;
  const brandPageId = extractDelegatedBrandPageId(dataSyncId);

  const payload = {
    context: {
      client: {
        clientName: profile.clientName,
        clientVersion: profile.clientVersion,
        gl: 'US',
        hl: 'en',
        visitorData: visitorData || undefined,
      },
      user: brandPageId
        ? { onBehalfOfUser: brandPageId, lockedSafetyMode: false }
        : { lockedSafetyMode: false },
    },
  };

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'User-Agent': profile.userAgent,
    Origin: ORIGIN_YOUTUBE_MUSIC,
    Referer: REFERER_YOUTUBE_MUSIC,
    'X-YouTube-Client-Name': profile.clientId,
    'X-YouTube-Client-Version': profile.clientVersion,
    Cookie: cookie,
    'X-Goog-AuthUser': String(accountIndex),
  };
  if (visitorData) headers['X-Goog-Visitor-Id'] = visitorData;
  const sapisid = computeSapisidHash(cookie, ORIGIN_YOUTUBE_MUSIC);
  if (sapisid) {
    headers['Authorization'] = sapisid;
    headers['X-Origin'] = ORIGIN_YOUTUBE_MUSIC;
  }
  if (brandPageId) {
    headers['X-Goog-PageId'] = brandPageId;
  }

  const res = await fetch(`${ORIGIN_YOUTUBE_MUSIC}/youtubei/v1/account/account_menu?prettyPrint=false`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) {
    return { accountName: '', email: '', handle: '', avatarUrl: '' };
  }
  const json = await res.json().catch(() => null);
  return parseAccountMenuResponse(json);
}

/**
 * Configures User-Agent and Client Hint headers on the login partition:
 * - 'firefox': sets Firefox UA and removes Sec-CH-UA* headers so Client Hints match Firefox.
 * - 'native': preserves Electron's native UA and Client Hints without spoofing Chrome.
 */
export function attachCleanChromeHeaders(ses: ElectronSessionLike): void {
  const targetUa = getAuthWindowUserAgent(ses);
  if (YTM_AUTH_UA_MODE === 'firefox') {
    ses.setUserAgent(targetUa);
  }

  if (configuredSessions.has(ses)) {
    return;
  }
  configuredSessions.add(ses);

  ses.webRequest.onBeforeSendHeaders((details: ElectronBeforeSendHeadersDetailsLike, callback) => {
    const reqHeaders: Record<string, string> = {};
    for (const [k, v] of Object.entries(details.requestHeaders)) {
      const lower = k.toLowerCase();
      if (lower === 'x-requested-with') {
        continue;
      }
      if (YTM_AUTH_UA_MODE === 'firefox') {
        if (lower === 'user-agent') {
          reqHeaders[k] = targetUa;
          continue;
        }
        if (lower.startsWith('sec-ch-ua')) {
          continue;
        }
      }
      reqHeaders[k] = v;
    }

    if (
      YTM_AUTH_UA_MODE === 'firefox' &&
      !Object.keys(reqHeaders).some((k) => k.toLowerCase() === 'user-agent')
    ) {
      reqHeaders['User-Agent'] = targetUa;
    }

    callback({ requestHeaders: reqHeaders });
  });

  if (typeof ses.webRequest.onErrorOccurred === 'function') {
    ses.webRequest.onErrorOccurred((details: ElectronOnErrorOccurredDetailsLike) => {
      if (details.error === 'net::ERR_ABORTED') return;
      console.warn(
        `[YTM Auth Network Error] ${details.error} (${details.resourceType}) -> ${safeUrlForLog(details.url)}`,
      );
    });
  }
}

/**
 * Aligns JS navigator properties with Firefox when YTM_AUTH_UA_MODE === 'firefox'
 * (undefines navigator.userAgentData and removes window.chrome).
 * In 'native' mode, performs no JS overrides at all.
 */
function buildAuthMainWorldShimScript(): string {
  if (YTM_AUTH_UA_MODE === 'native') {
    return '';
  }

  return `
    (() => {
      if (window.__ririAuthShimApplied) return;
      window.__ririAuthShimApplied = true;
      try {
        const getter = function userAgentData() { return undefined; };
        try {
          Object.defineProperty(getter, 'toString', {
            value: () => 'function get userAgentData() { [native code] }',
            configurable: true,
          });
        } catch {}
        Object.defineProperty(Navigator.prototype, 'userAgentData', {
          get: getter,
          configurable: true,
        });
      } catch {}
      try { delete window.chrome; } catch {}
    })();
  `;
}

function injectMainWorldShim(webContents: ElectronWebContentsLike): void {
  const script = buildAuthMainWorldShimScript();
  if (!script) return;
  try {
    void webContents.executeJavaScript(script).catch(() => undefined);
  } catch {
    // ignore mid-navigation
  }
}

async function inspectGooglePageVisibleError(webContents: ElectronWebContentsLike): Promise<void> {
  try {
    const currentUrl = webContents.getURL();
    if (!isGoogleSignInUrl(currentUrl)) return;
    const summary = await webContents.executeJavaScript<{
      heading: string;
      errorText: string;
      observerInstalled: boolean;
    } | null>(`
      (() => {
        try {
          const readText = () => {
            const headingEl = document.querySelector('#headingText, h1');
            const heading = headingEl ? (headingEl.textContent || '').trim() : '';
            const selectors = [
              '[aria-live="assertive"]',
              '[role="alert"]',
              '.Ekjuhf',
              '.o6cuMc',
              '.dEOOab',
            ];
            const found = [];
            for (const sel of selectors) {
              document.querySelectorAll(sel).forEach((el) => {
                const txt = (el.textContent || '').trim();
                if (txt && !found.includes(txt)) found.push(txt);
              });
            }
            return { heading, errorText: found.join(' | ') };
          };

          let observerInstalled = Boolean(window.__ririGoogleErrObserver);
          if (!observerInstalled && document.body) {
            let lastLogged = '';
            const emitIfError = () => {
              const snap = readText();
              if (snap.errorText && snap.errorText !== lastLogged) {
                lastLogged = snap.errorText;
                console.warn('[YTM Auth Google Error] ' + snap.errorText);
              }
            };
            const obs = new MutationObserver(() => emitIfError());
            obs.observe(document.body, { childList: true, subtree: true, characterData: true });
            window.__ririGoogleErrObserver = obs;
            observerInstalled = true;
          }
          const initial = readText();
          return { ...initial, observerInstalled };
        } catch {
          return null;
        }
      })()
    `);
    if (summary?.errorText) {
      console.warn(`[YTM Auth Google Page Error] (${summary.heading}): ${summary.errorText}`);
    } else if (summary?.heading) {
      console.log(`[YTM Auth Google Page] ${summary.heading} (${safeUrlForLog(currentUrl)})`);
    }
  } catch {
    // Page may be navigating mid-script
  }
}

function attachDiagnosticListeners(webContents: ElectronWebContentsLike, label = 'main'): void {
  webContents.on(
    'did-fail-load',
    (_e: unknown, errorCode: number, errorDescription: string, validatedUrl: string, isMainFrame: boolean) => {
      if (errorCode === -3) return;
      console.warn(
        `[YTM Auth ${label} did-fail-load] code=${errorCode} desc="${errorDescription}" mainFrame=${Boolean(isMainFrame)} url=${safeUrlForLog(validatedUrl)}`,
      );
    },
  );

  webContents.on(
    'did-fail-provisional-load',
    (_e: unknown, errorCode: number, errorDescription: string, validatedUrl: string, isMainFrame: boolean) => {
      if (errorCode === -3) return;
      console.warn(
        `[YTM Auth ${label} did-fail-provisional-load] code=${errorCode} desc="${errorDescription}" mainFrame=${Boolean(isMainFrame)} url=${safeUrlForLog(validatedUrl)}`,
      );
    },
  );

  webContents.on(
    'certificate-error',
    (_e: unknown, url: string, error: string, _cert: unknown, cb: (trusted: boolean) => void) => {
      console.warn(`[YTM Auth ${label} certificate-error] error="${error}" url=${safeUrlForLog(url)}`);
      cb(false);
    },
  );

  webContents.on('console-message', (_e: unknown, params: { level?: unknown; message?: string } | undefined) => {
    const level = params?.level ?? '';
    const message = String(params?.message || '');
    if (!message) return;
    if (message.startsWith('[YTM Auth Google Error]') || String(level) === 'error' || Number(level) >= 3) {
      console.warn(`[YTM Auth ${label} console(${String(level)})] ${message.slice(0, 400)}`);
    }
  });

  webContents.on('did-navigate', (_e: unknown, url: string) => {
    injectMainWorldShim(webContents);
    const safeUrl = safeUrlForLog(url);
    console.log(`[YTM Auth ${label} did-navigate] ${safeUrl}`);
    if (url.includes('/signin/rejected')) {
      console.warn(
        `[YTM Auth] Google redirected to /signin/rejected in mode="${YTM_AUTH_UA_MODE}". Try RIRI_YTM_LOGIN_MODE=${YTM_AUTH_UA_MODE === 'firefox' ? 'native' : 'firefox'}.`,
      );
    } else if (isGoogleSignInUrl(url)) {
      console.log(`[YTM Auth] Login page reached: ${safeUrl}`);
    }
  });

  webContents.on('did-navigate-in-page', (_e: unknown, url: string) => {
    injectMainWorldShim(webContents);
    console.log(`[YTM Auth ${label} did-navigate-in-page] ${safeUrlForLog(url)}`);
  });

  webContents.on('dom-ready', () => {
    injectMainWorldShim(webContents);
  });

  webContents.on('render-process-gone', (e: unknown) => {
    const detail = e as { exitCode?: number; reason?: string; crashType?: string } | undefined;
    console.error(
      `[YTM Auth ${label} render-process-gone] exitCode=${detail?.exitCode ?? 'unknown'} reason="${detail?.reason ?? 'unknown'}" crashType="${detail?.crashType ?? 'unknown'}"`,
    );
  });

  webContents.on('unresponsive', () => {
    console.error(`[YTM Auth ${label} unresponsive] render process became unresponsive`);
  });
}

async function readCookiesFromPartition(ses: ElectronSessionLike): Promise<string> {
  const [googleCookies, allCookies, ytCookies] = await Promise.all([
    ses.cookies.get({ url: 'https://accounts.google.com' }).catch(() => []),
    ses.cookies.get({}).catch(() => []),
    ses.cookies.get({ url: 'https://music.youtube.com' }).catch(() => []),
  ]);
  const seen = new Map<string, string>();
  for (const c of [...googleCookies, ...allCookies, ...ytCookies]) {
    if (c.name && c.value) seen.set(c.name, c.value);
  }
  return Array.from(seen.entries())
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
}

export function configureElectronYtmCookieRefresh(
  getSession: () => ElectronSessionLike,
): void {
  registerCookieRefreshCallback(async () => {
    try {
      const active = await getActiveYtAccount();
      if (!active) return false;
      const ses = getSession();
      const freshCookie = await readCookiesFromPartition(ses);
      if (!hasYouTubeLoginCookie(freshCookie)) return false;
      await updateActiveYtAccountAuth({ cookie: freshCookie, lastValidatedAt: Date.now() });
      resetInnertubeClientCache();
      return true;
    } catch {
      return false;
    }
  });
}

let currentAuthWin: ElectronBrowserWindowInstanceLike | null = null;

export function closeCurrentAuthWin(): void {
  try {
    if (currentAuthWin && !currentAuthWin.isDestroyed()) {
      currentAuthWin.close();
    }
  } catch {
    // ignore
  }
  currentAuthWin = null;
}

export async function loginYouTubeMusicWindow(opts: {
  BrowserWindow: ElectronBrowserWindowConstructorLike;
  session: ElectronSessionModuleLike;
  parentWindow?: ElectronBrowserWindowInstanceLike | null;
  cleanPartition?: boolean;
}): Promise<{ ok: boolean; status?: YtAuthStatusPayload; blocked?: boolean; cancelled?: boolean; error?: string }> {
  const { BrowserWindow, session, parentWindow, cleanPartition = true } = opts;

  const possiblePreloadPaths = [
    path.join(__dirname, 'ytm', 'ytm-login-preload.cjs'),
    path.join(__dirname, 'ytm-login-preload.cjs'),
    path.join(process.cwd(), 'electron', 'ytm', 'ytm-login-preload.cjs'),
  ];
  let LOGIN_PRELOAD_PATH = possiblePreloadPaths[0];
  for (const p of possiblePreloadPaths) {
    if (fs.existsSync(p)) {
      LOGIN_PRELOAD_PATH = p;
      break;
    }
  }

  const ses = session.fromPartition(YTM_PARTITION);
  const ua = getAuthWindowUserAgent(ses);

  if (cleanPartition) {
    await ses
      .clearStorageData({
        storages: ['cookies', 'localstorage', 'sessionstorage', 'indexdb', 'serviceworkers', 'cachestorage'],
      })
      .catch(() => undefined);
    await ses.clearCache().catch(() => undefined);
  }

  attachCleanChromeHeaders(ses);

  return await new Promise((resolve) => {
    let finished = false;
    let capturing = false;
    let authWin: ElectronBrowserWindowInstanceLike;
    let loadWatchdog: NodeJS.Timeout | null = null;

    const clearLoadWatchdog = () => {
      if (loadWatchdog) {
        clearTimeout(loadWatchdog);
        loadWatchdog = null;
      }
    };

    const done = (result: {
      ok: boolean;
      status?: YtAuthStatusPayload;
      blocked?: boolean;
      cancelled?: boolean;
      error?: string;
    }) => {
      if (finished) return;
      finished = true;
      clearLoadWatchdog();
      currentAuthWin = null;
      resolve(result);
    };

    const failWithError = (error: string, cancelled = false) => {
      clearLoadWatchdog();
      done({ ok: false, cancelled, error });
    };

    const startInitialLoadWatchdog = () => {
      clearLoadWatchdog();
      loadWatchdog = setTimeout(() => {
        clearLoadWatchdog();
        if (!authWin.isDestroyed()) {
          try {
            authWin.close();
          } catch {
            // ignore
          }
        }
        failWithError("Couldn't reach Google - Retry", false);
      }, 30000);
    };

    authWin = new BrowserWindow({
      width: 520,
      height: 700,
      parent: parentWindow || undefined,
      modal: Boolean(parentWindow),
      show: false,
      title: 'Sign in - YouTube Music',
      backgroundColor: '#ffffff',
      autoHideMenuBar: true,
      webPreferences: {
        preload:
          YTM_AUTH_UA_MODE === 'firefox' && fs.existsSync(LOGIN_PRELOAD_PATH)
            ? LOGIN_PRELOAD_PATH
            : undefined,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        partition: YTM_PARTITION,
      },
    });
    currentAuthWin = authWin;

    if (YTM_AUTH_UA_MODE === 'firefox') {
      try {
        authWin.webContents.setUserAgent(ua);
      } catch {
        // ignore
      }
    }

    attachDiagnosticListeners(authWin.webContents, 'main');

    authWin.webContents.on('render-process-gone', (_e: unknown, detail: unknown) => {
      const d = detail as { exitCode?: number; reason?: string; crashType?: string } | undefined;
      console.error(
        `[YTM Auth render-process-gone] exitCode=${d?.exitCode ?? 'unknown'} reason="${d?.reason ?? 'unknown'}" crashType="${d?.crashType ?? 'unknown'}"`,
      );
      if (!finished) {
        failWithError("Couldn't reach Google - Retry", false);
      }
    });

    authWin.webContents.on('unresponsive', () => {
      console.error('[YTM Auth unresponsive] render process became unresponsive');
      if (!finished) {
        failWithError("Couldn't reach Google - Retry", false);
      }
    });

    authWin.webContents.once('ready-to-show', () => {
      if (!authWin.isDestroyed()) {
        authWin.show();
      }
    });

    if (typeof authWin.webContents.setWindowOpenHandler === 'function') {
      authWin.webContents.setWindowOpenHandler((details) => {
        if (isAllowedAuthPopupUrl(details.url)) {
          return {
            action: 'allow',
            overrideBrowserWindowOptions: {
              width: 500,
              height: 660,
              parent: authWin,
              modal: false,
              autoHideMenuBar: true,
              webPreferences: {
                contextIsolation: true,
                nodeIntegration: false,
                sandbox: true,
                partition: YTM_PARTITION,
                preload:
                  YTM_AUTH_UA_MODE === 'firefox' && fs.existsSync(LOGIN_PRELOAD_PATH)
                    ? LOGIN_PRELOAD_PATH
                    : undefined,
              },
            },
          };
        }
        return { action: 'deny' };
      });
    }

    authWin.webContents.on('did-create-window', (childWin: ElectronBrowserWindowInstanceLike) => {
      if (!childWin?.webContents) return;
      if (YTM_AUTH_UA_MODE === 'firefox') {
        try {
          childWin.webContents.setUserAgent(ua);
        } catch {
          // ignore
        }
      }
      attachDiagnosticListeners(childWin.webContents, 'popup');
      childWin.webContents.on('did-finish-load', () => {
        injectMainWorldShim(childWin.webContents);
        void inspectGooglePageVisibleError(childWin.webContents);
        void checkLogin();
      });
      childWin.webContents.on('did-navigate', () => {
        injectMainWorldShim(childWin.webContents);
        void checkLogin();
      });
    });

    const checkLogin = async () => {
      if (capturing || finished) return;
      try {
        if (authWin.isDestroyed()) return;
        const currentUrl = authWin.webContents.getURL();
        if (!currentUrl.startsWith('https://music.youtube.com')) return;

        const cookieStr = await readCookiesFromPartition(ses);
        if (!hasYouTubeLoginCookie(cookieStr)) return;

        capturing = true;

        let meta = { loggedIn: false, visitorData: '', dataSyncId: '' };
        for (let attempt = 0; attempt < 10; attempt++) {
          if (authWin.isDestroyed() || finished) return;
          try {
            meta = await authWin.webContents.executeJavaScript(`
              (() => {
                try {
                  const c = window.ytcfg;
                  const y = window.yt && window.yt.config_;
                  const loggedInRaw =
                    (c && c.get && c.get('LOGGED_IN')) ??
                    (c && c.data_ && c.data_.LOGGED_IN) ??
                    (y && y.LOGGED_IN);
                  let v = (c && c.get && c.get('VISITOR_DATA')) || (c && c.data_ && c.data_.VISITOR_DATA) || (y && y.VISITOR_DATA) || '';
                  let d = (c && c.get && c.get('DATASYNC_ID')) || (c && c.data_ && c.data_.DATASYNC_ID) || (y && y.DATASYNC_ID) || '';
                  const scripts = document.querySelectorAll('script');
                  for (let i = 0; i < scripts.length && (!v || !d); i++) {
                    const txt = scripts[i].textContent || '';
                    if (!v) {
                      const vm = txt.match(/["']VISITOR_DATA["']\\s*:\\s*["']([^"']+)["']/);
                      if (vm) v = vm[1];
                    }
                    if (!d) {
                      const dm = txt.match(/["'](?:DATASYNC_ID|dataSyncId)["']\\s*:\\s*["']([^"']+)["']/);
                      if (dm) d = dm[1];
                    }
                  }
                  return {
                    loggedIn: Boolean(loggedInRaw) || Boolean(d),
                    visitorData: v || '',
                    dataSyncId: d || '',
                  };
                } catch {
                  return { loggedIn: false, visitorData: '', dataSyncId: '' };
                }
              })()
            `);
            if (meta.loggedIn && meta.visitorData && (meta.dataSyncId || attempt >= 5)) break;
          } catch {
            // continue polling briefly
          }
          await new Promise((r) => setTimeout(r, 450));
        }

        const menu = await fetchAccountMenuWithCookies(
          cookieStr,
          meta.visitorData,
          meta.dataSyncId,
          0,
        );

        const isVerified = meta.loggedIn || Boolean(menu.accountName || menu.email);
        if (!isVerified) {
          capturing = false;
          return;
        }

        const accountId =
          menu.email ||
          crypto.createHash('sha1').update(cookieStr.slice(0, 64)).digest('hex').slice(0, 12);

        const status = await upsertYtAccount({
          id: `ytm-${accountId}`,
          name: menu.accountName || menu.email || 'YouTube Music Listener',
          handle: menu.handle || menu.email || '',
          email: menu.email || '',
          avatarUrl: menu.avatarUrl || '',
          accountIndex: 0,
          cookie: cookieStr,
          visitorData: meta.visitorData || '',
          dataSyncId: meta.dataSyncId || '',
          addedAt: Date.now(),
          lastValidatedAt: Date.now(),
        });

        resetInnertubeClientCache();
        if (!authWin.isDestroyed()) {
          authWin.close();
        }
        done({ ok: true, status });
      } catch {
        capturing = false;
      }
    };

    authWin.webContents.on('did-finish-load', () => {
      clearLoadWatchdog();
      injectMainWorldShim(authWin.webContents);
      void inspectGooglePageVisibleError(authWin.webContents);
      void checkLogin();
    });
    authWin.webContents.on('did-navigate', () => {
      injectMainWorldShim(authWin.webContents);
      void checkLogin();
    });
    authWin.webContents.once('did-start-load', () => {
      startInitialLoadWatchdog();
    });
    authWin.webContents.on('did-navigate-in-page', () => {
      injectMainWorldShim(authWin.webContents);
      void inspectGooglePageVisibleError(authWin.webContents);
      void checkLogin();
    });
    authWin.webContents.on(
      'did-fail-load',
      (
        _e: unknown,
        errorCode: number,
        errorDescription: string,
        validatedUrl: string,
        isMainFrame: boolean,
      ) => {
        if (isMainFrame && validatedUrl?.includes('accounts.google.com') && errorCode !== -3) {
          clearLoadWatchdog();
          done({
            ok: false,
            blocked: true,
            error: `Google sign-in could not load (${errorDescription}). Click Try again to reopen with a clean session.`,
          });
        }
      },
    );
    authWin.on('closed', () => {
      done({
        ok: false,
        cancelled: true,
        error: 'Sign-in window closed before completing authentication.',
      });
    });

    if (!authWin.isDestroyed()) {
      void authWin.loadURL(
        YTM_LOGIN_URL,
        YTM_AUTH_UA_MODE === 'firefox' ? { userAgent: ua } : undefined,
      );
    }
  });
}

export async function importYtmSessionFallback(opts: {
  cookieHeader: string;
  visitorData?: string;
  dataSyncId?: string;
  accountIndex?: number;
}): Promise<{ ok: boolean; status?: YtAuthStatusPayload; error?: string }> {
  const cookieStr = (opts.cookieHeader || '').trim();
  if (!hasYouTubeLoginCookie(cookieStr)) {
    return {
      ok: false,
      error: 'Session cookie is missing required YouTube Music SAPISID credentials.',
    };
  }

  let visitorData = (opts.visitorData || '').trim();
  let dataSyncId = (opts.dataSyncId || '').trim();
  const accountIndex = Number.isFinite(opts.accountIndex) ? Number(opts.accountIndex) : 0;

  if (!visitorData || !dataSyncId) {
    try {
      const pageRes = await fetch('https://music.youtube.com/', {
        headers: {
          Cookie: cookieStr,
          'User-Agent': YOUTUBE_CLIENTS.WEB_REMIX.userAgent,
        },
        signal: AbortSignal.timeout(10000),
      });
      if (pageRes.ok) {
        const html = await pageRes.text();
        const vm = html.match(/["']VISITOR_DATA["']\s*:\s*["']([^"']+)["']/);
        const dm = html.match(/["'](?:DATASYNC_ID|dataSyncId)["']\s*:\s*["']([^"']+)["']/);
        if (!visitorData && vm?.[1]) visitorData = vm[1];
        if (!dataSyncId && dm?.[1]) dataSyncId = dm[1];
      }
    } catch {
      // ignore
    }
  }

  const menu = await fetchAccountMenuWithCookies(cookieStr, visitorData, dataSyncId, accountIndex);

  const accountId =
    menu.email ||
    crypto.createHash('sha1').update(cookieStr.slice(0, 64)).digest('hex').slice(0, 12);

  const status = await upsertYtAccount({
    id: `ytm-${accountId}`,
    name: menu.accountName || menu.email || 'YouTube Music Listener',
    handle: menu.handle || menu.email || '',
    email: menu.email || '',
    avatarUrl: menu.avatarUrl || '',
    accountIndex,
    cookie: cookieStr,
    visitorData,
    dataSyncId,
    addedAt: Date.now(),
    lastValidatedAt: Date.now(),
  });

  resetInnertubeClientCache();
  return { ok: true, status };
}

export async function switchYtmAccount(accountId: string): Promise<YtAuthStatusPayload> {
  const status = await switchActiveYtAccount(accountId);
  resetInnertubeClientCache();
  return status;
}

export async function logoutYtmAccount(opts?: {
  session?: ElectronSessionModuleLike;
  accountId?: string;
}): Promise<YtAuthStatusPayload> {
  const nextStatus = await removeYtAccountById(opts?.accountId);
  resetInnertubeClientCache();
  if (!nextStatus.loggedIn && opts?.session) {
    try {
      const ses = opts.session.fromPartition(YTM_PARTITION);
      await ses.clearStorageData({ storages: ['cookies', 'localstorage'] });
    } catch {
      // ignore
    }
  }
  return nextStatus;
}

export async function getYtmAuthStatus(): Promise<YtAuthStatusPayload> {
  return await getPublicYtAuthStatus();
}