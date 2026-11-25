import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { YtAuthStatusPayload } from '../../src/types/music';
import {
  computeSapisidHash,
  hasResidualYouTubeAuthCookie,
  hasYouTubeLoginCookie,
  ORIGIN_YOUTUBE_MUSIC,
  REFERER_YOUTUBE_MUSIC,
  YOUTUBE_CLIENTS,
} from './clients';
import {
  completeYtAuthReset,
  getActiveYtAccount,
  getAllYtAccounts,
  getPendingYtAuthReset,
  getPublicYtAuthStatus,
  getVaultDiagnostic,
  getYtAccountById,
  getYtPartitionTombstone,
  LEGACY_YTM_PARTITION,
  markYtPartitionInvalidated,
  preflightYtVaultWrite,
  removeYtAccountById,
  stageYtAuthReset,
  switchActiveYtAccount,
  updateActiveYtAccountAuth,
  upsertYtAccount,
  YtAccountNotFoundError,
  YtAccountStateConflictError,
  YtAuthOperationCancelledError,
  YtResetPendingError,
  YtSessionInvalidatedError,
  YtVaultUnreadableError,
  type StoredYtAccount,
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

export const YTM_PARTITION = LEGACY_YTM_PARTITION;
export const YTM_LOGIN_URL =
  'https://accounts.google.com/ServiceLogin?service=youtube&uilel=3&passive=true&continue=' +
  encodeURIComponent('https://music.youtube.com/?feature=autologin') +
  '&hl=en';

function getYtAccountPartition(account: StoredYtAccount | null | undefined): string {
  return account?.partitionName?.trim() || YTM_PARTITION;
}

function createPendingYtPartition(): string {
  return `persist:ytm-login-${crypto.randomUUID()}`;
}

// 'firefox' avoids Google's 2026 Chrome UA-laundering rejection without requiring
// proprietary Google Chrome attestation; set RIRI_YTM_LOGIN_MODE=native to use untouched Electron UA.
export const YTM_AUTH_UA_MODE: 'firefox' | 'native' =
  process.env.RIRI_YTM_LOGIN_MODE === 'native' ? 'native' : 'firefox';

const FIREFOX_WIN_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:135.0) Gecko/20100101 Firefox/135.0';

export function getAuthWindowUserAgent(ses?: ElectronSessionLike): string {
  if (YTM_AUTH_UA_MODE === 'native' && ses && ses.getUserAgent) {
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

function normalizeIdentity(value: string | undefined): string {
  return (value || '').trim().toLowerCase();
}

type AccountIdentityMatch = 'match' | 'different' | 'unknown';

function matchAccountIdentity(
  stored: { name?: string; handle?: string; email?: string },
  menu: AccountMenuInfo,
): AccountIdentityMatch {
  const storedEmail = normalizeIdentity(stored.email);
  const menuEmail = normalizeIdentity(menu.email);
  if (storedEmail && menuEmail) {
    return storedEmail === menuEmail ? 'match' : 'different';
  }

  const storedHandle = normalizeIdentity(stored.handle);
  const menuHandle = normalizeIdentity(menu.handle);
  if (storedHandle && menuHandle) {
    return storedHandle === menuHandle ? 'match' : 'different';
  }

  // Display names are not unique enough to prove that a shared browser
  // partition belongs to the selected account. Treat missing/weak identity
  // information as inconclusive and never refresh credentials from it.
  return 'unknown';
}

function accountMenuMatchesStoredAccount(
  stored: { name?: string; handle?: string; email?: string },
  menu: AccountMenuInfo,
): boolean {
  return matchAccountIdentity(stored, menu) === 'match';
}

export class YtmAuthRejectedError extends Error {
  constructor(readonly status: number) {
    super(`YouTube Music rejected the stored session (${status}).`);
    this.name = 'YtmAuthRejectedError';
  }
}

export class YtmAuthVerificationError extends Error {
  readonly retryable = true;

  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'YtmAuthVerificationError';
  }
}

export class YtmLogoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'YtmLogoutError';
  }
}

export class YtmPartitionOwnershipConflictError extends YtAccountStateConflictError {
  constructor(message: string) {
    super(message);
    this.name = 'YtmPartitionOwnershipConflictError';
  }
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
  strictAuth = false,
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
    // 401 is a definitive credential rejection. A 403 can also be produced by
    // bot protection, rate limiting, or a temporary upstream failure, so it
    // must remain distinguishable from an actually rejected session.
    if (strictAuth) {
      if (res.status === 401) {
        throw new YtmAuthRejectedError(res.status);
      }
      throw new YtmAuthVerificationError(
        `YouTube Music account verification is temporarily unavailable (${res.status}).`,
        res.status,
      );
    }
    return { accountName: '', email: '', handle: '', avatarUrl: '' };
  }

  let json: unknown = null;
  try {
    json = await res.json();
  } catch (err) {
    if (strictAuth) {
      throw new YtmAuthVerificationError(
        `YouTube Music account verification returned an unreadable response${
          err instanceof Error ? `: ${err.message}` : '.'
        }`,
        res.status,
      );
    }
    return { accountName: '', email: '', handle: '', avatarUrl: '' };
  }

  const menu = parseAccountMenuResponse(json);
  if (strictAuth && !menu.accountName && !menu.email && !menu.handle) {
    throw new YtmAuthVerificationError(
      'YouTube Music account verification is temporarily unavailable because the account response could not be verified.',
      res.status,
    );
  }
  return menu;
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

async function readCookiesFromPartitionStrict(ses: ElectronSessionLike): Promise<string> {
  const [googleCookies, allCookies, ytCookies] = await Promise.all([
    ses.cookies.get({ url: 'https://accounts.google.com' }),
    ses.cookies.get({}),
    ses.cookies.get({ url: 'https://music.youtube.com' }),
  ]);
  const seen = new Map<string, string>();
  for (const c of [...googleCookies, ...allCookies, ...ytCookies]) {
    if (c.name && c.value) seen.set(c.name, c.value);
  }
  return Array.from(seen.entries())
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
}

async function getPartitionAccountState(
  ses: ElectronSessionLike,
  account: StoredYtAccount | null,
): Promise<'match' | 'different' | 'unknown' | 'empty'> {
  if (!account) return 'unknown';
  try {
    // A cookie-read failure is inconclusive, not proof that the partition is
    // empty. Using the strict reader ensures that an unavailable cookie store
    // still causes logout to attempt (and verify) partition invalidation.
    const cookie = await readCookiesFromPartitionStrict(ses);
    if (!hasYouTubeLoginCookie(cookie)) {
      // A partial credential can still identify or revive a session. Treat it
      // as inconclusive so logout clears and verifies the partition.
      return hasResidualYouTubeAuthCookie(cookie) ? 'unknown' : 'empty';
    }
    const menu = await fetchAccountMenuWithCookies(
      cookie,
      account.visitorData,
      account.dataSyncId,
      account.accountIndex,
      false,
    );
    if (!menu.accountName && !menu.email && !menu.handle) return 'unknown';
    return matchAccountIdentity(account, menu);
  } catch {
    return 'unknown';
  }
}

/**
 * Serializes destructive auth operations with credential refreshes. In
 * particular, a refresh cannot replace an account's cookie while logout is
 * validating that account and then lose the race after its partition was
 * already cleared. The queue is process-global so the separately bundled
 * HTTP server and Electron IPC entry points cannot race each other.
 */
interface AuthMutationState {
  queue: Promise<void>;
}

const AUTH_MUTATION_LOCK_KEY = Symbol.for('riri-player.ytm.auth-mutation-lock.v1');

function getAuthMutationState(): AuthMutationState {
  const registry = globalThis as unknown as Record<PropertyKey, unknown>;
  const existing = registry[AUTH_MUTATION_LOCK_KEY];
  if (existing && typeof existing === 'object' && 'queue' in existing) {
    return existing as AuthMutationState;
  }
  const created: AuthMutationState = { queue: Promise.resolve() };
  registry[AUTH_MUTATION_LOCK_KEY] = created;
  return created;
}

const authMutationState = getAuthMutationState();

function withAuthMutationLock<T>(operation: () => Promise<T>): Promise<T> {
  const result = authMutationState.queue.then(operation, operation);
  authMutationState.queue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

export function configureElectronYtmCookieRefresh(
  getSession: (account: StoredYtAccount) => ElectronSessionLike,
): (expectedAccountId?: string) => Promise<boolean> {
  const refresh = async (expectedAccountId?: string): Promise<boolean> => {
    try {
      return await withAuthMutationLock(async () => {
        const active = await getActiveYtAccount();
        if (!active) return false;
        if (expectedAccountId && active.id !== expectedAccountId) return false;
        const ses = getSession(active);
        const freshCookie = await readCookiesFromPartitionStrict(ses);
        if (!hasYouTubeLoginCookie(freshCookie)) return false;
        try {
          const menu = await fetchAccountMenuWithCookies(
            freshCookie,
            active.visitorData,
            active.dataSyncId,
            active.accountIndex,
            true,
          );
          if (!accountMenuMatchesStoredAccount(active, menu)) {
            // The shared partition currently contains another account, or its
            // identity cannot be verified. Never replace the selected account
            // with those credentials.
            return false;
          }
        } catch {
          return false;
        }
        const updated = await updateActiveYtAccountAuth(
          { cookie: freshCookie, lastValidatedAt: Date.now() },
          active.id,
        );
        if (!updated) return false;
        resetInnertubeClientCache();
        return true;
      });
    } catch (err) {
      if (err instanceof YtVaultUnreadableError) throw err;
      return false;
    }
  };
  registerCookieRefreshCallback(refresh);
  return refresh;
}

interface AuthAttempt {
  generation: number;
  cancelled: boolean;
  window: ElectronBrowserWindowInstanceLike | null;
  abort: (() => void) | null;
  completion: Promise<void>;
  resolveCompletion: () => void;
}

let currentAuthWin: ElectronBrowserWindowInstanceLike | null = null;
let authAttemptGeneration = 0;
let activeAuthAttempt: AuthAttempt | null = null;
let authResetInProgress = false;

function beginAuthAttempt(): AuthAttempt {
  let resolveCompletion!: () => void;
  const completion = new Promise<void>((resolve) => {
    resolveCompletion = resolve;
  });
  const attempt: AuthAttempt = {
    generation: ++authAttemptGeneration,
    cancelled: false,
    window: null,
    abort: null,
    completion,
    resolveCompletion,
  };
  activeAuthAttempt = attempt;
  return attempt;
}

function isAuthAttemptCurrent(attempt: AuthAttempt): boolean {
  return (
    !attempt.cancelled &&
    attempt.generation === authAttemptGeneration &&
    activeAuthAttempt === attempt
  );
}

function invalidateAuthAttempt(attempt: AuthAttempt): void {
  attempt.cancelled = true;
  if (attempt.generation === authAttemptGeneration) {
    authAttemptGeneration += 1;
  }
}

function finishAuthAttempt(attempt: AuthAttempt): void {
  if (activeAuthAttempt === attempt) {
    activeAuthAttempt = null;
  }
  attempt.abort = null;
  attempt.resolveCompletion();
}

function closeAuthWindow(win: ElectronBrowserWindowInstanceLike | null): void {
  try {
    if (win && !win.isDestroyed()) {
      win.close();
    }
  } catch {
    // ignore
  }
}

function cancelAuthAttempt(attempt: AuthAttempt): void {
  invalidateAuthAttempt(attempt);
  closeAuthWindow(attempt.window || currentAuthWin);
  // Abort resolves the sign-in promise even on platforms/test doubles whose
  // close() event is delayed or omitted.
  attempt.abort?.();
}

export function closeCurrentAuthWin(): void {
  const attempt = activeAuthAttempt;
  if (attempt) {
    cancelAuthAttempt(attempt);
    return;
  }
  closeAuthWindow(currentAuthWin);
  currentAuthWin = null;
}

async function cancelAndAwaitActiveAuthAttempt(): Promise<void> {
  const attempt = activeAuthAttempt;
  if (!attempt) return;
  cancelAuthAttempt(attempt);
  await attempt.completion;
}

export async function loginYouTubeMusicWindow(opts: {
  BrowserWindow: ElectronBrowserWindowConstructorLike;
  session: ElectronSessionModuleLike;
  parentWindow?: ElectronBrowserWindowInstanceLike | null;
  cleanPartition?: boolean;
}): Promise<{
  ok: boolean;
  status?: YtAuthStatusPayload;
  blocked?: boolean;
  cancelled?: boolean;
  error?: string;
  retryable?: boolean;
  warning?: string;
}> {
  const { BrowserWindow, session, parentWindow, cleanPartition = false } = opts;

  if (authResetInProgress) {
    return {
      ok: false,
      retryable: true,
      error: 'A YouTube Music factory reset is still in progress. Please retry after it finishes.',
    };
  }

  // Only one sign-in attempt may own the auth window or a partition at a
  // time. Wait for the previous attempt's cleanup before allocating the next
  // one, and re-check the reset flag because a reset may have started while
  // this call was awaiting cancellation.
  await cancelAndAwaitActiveAuthAttempt();
  if (authResetInProgress) {
    return {
      ok: false,
      retryable: true,
      error: 'A YouTube Music factory reset is still in progress. Please retry after it finishes.',
    };
  }

  const attempt = beginAuthAttempt();
  const canPublish = () => isAuthAttemptCurrent(attempt);

  try {
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

  // Prove that the encrypted vault is readable and writable before any
  // browser session is invalidated. Otherwise a vault/encryption failure could
  // destroy the only recoverable signed-in session.
  try {
    await preflightYtVaultWrite();
  } catch (err) {
    const unreadable = err instanceof YtVaultUnreadableError;
    const resetPending = err instanceof YtResetPendingError;
    return {
      ok: false,
      retryable: !unreadable,
      error: resetPending
        ? err.message
        : unreadable
          ? err.message
          : `Could not verify the encrypted YouTube Music session store before sign-in: ${
              err instanceof Error ? err.message : 'vault write failed.'
            } Please retry.`,
    };
  }
  if (!canPublish()) {
    return {
      ok: false,
      cancelled: true,
      error: 'Sign-in was cancelled before the browser session started.',
    };
  }

  let activeBefore: StoredYtAccount | null = null;
  try {
    activeBefore = await getActiveYtAccount();
  } catch (err) {
    return {
      ok: false,
      retryable: !(err instanceof YtVaultUnreadableError),
      error:
        err instanceof Error
          ? err.message
          : 'Could not read the active YouTube Music account.',
    };
  }
  if (!canPublish()) {
    return {
      ok: false,
      cancelled: true,
      error: 'Sign-in was cancelled before the account session started.',
    };
  }

  let partitionName = getYtAccountPartition(activeBefore);
  let pendingPartition = false;
  if (cleanPartition && activeBefore) {
    // Sign in to a fresh partition so adding/replacing an account never
    // destroys the active account's recoverable browser session.
    partitionName = createPendingYtPartition();
    pendingPartition = true;
  } else if (cleanPartition) {
    partitionName = YTM_PARTITION;
  }

  const ses = session.fromPartition(partitionName);
  const ua = getAuthWindowUserAgent(ses);

  if (cleanPartition && !pendingPartition) {
    try {
      await ses.clearStorageData({
        storages: ['cookies', 'localstorage', 'sessionstorage', 'indexdb', 'serviceworkers', 'cachestorage'],
      });
      if (ses.clearCache) {
        await ses.clearCache().catch(() => undefined);
      }
      const remainingCookie = await readCookiesFromPartitionStrict(ses);
      if (hasResidualYouTubeAuthCookie(remainingCookie)) {
        throw new Error('sensitive authentication cookies are still present');
      }
    } catch (err) {
      return {
        ok: false,
        retryable: true,
        error: `Could not reset the YouTube Music sign-in session: ${
          err instanceof Error ? err.message : 'storage clearing failed.'
        } Please retry.`,
      };
    }
    if (!canPublish()) {
      return {
        ok: false,
        cancelled: true,
        error: 'Sign-in was cancelled while the browser session was being reset.',
      };
    }
  }

  attachCleanChromeHeaders(ses);
  if (!canPublish()) {
    return {
      ok: false,
      cancelled: true,
      error: 'Sign-in was cancelled before the sign-in window opened.',
    };
  }

  return await new Promise((resolve) => {
    let finished = false;
    let capturing = false;
    let publishedAccount = false;
    let authWin: ElectronBrowserWindowInstanceLike;
    let loadWatchdog: NodeJS.Timeout | null = null;

    const clearLoadWatchdog = () => {
      if (loadWatchdog) {
        clearTimeout(loadWatchdog);
        loadWatchdog = null;
      }
    };

    const done = async (result: {
      ok: boolean;
      status?: YtAuthStatusPayload;
      blocked?: boolean;
      cancelled?: boolean;
      error?: string;
      retryable?: boolean;
      warning?: string;
    }) => {
      if (finished) return;
      finished = true;
      clearLoadWatchdog();
      if (currentAuthWin === authWin) currentAuthWin = null;
      if (attempt.window === authWin) attempt.window = null;
      attempt.abort = null;
      if (!result.ok && pendingPartition && !publishedAccount) {
        // The pending partition was never published to the vault. Remove any
        // partial credentials so a failed/cancelled add-account attempt cannot
        // become an unreferenced browser session. Wait for and verify the
        // cleanup before reporting the original sign-in failure.
        try {
          await clearPartitionStorage(session, partitionName);
        } catch (err) {
          // Durably register the failed cleanup so the partition cannot be
          // recovered later. This prevents an incomplete sign-in from leaving
          // an unverified browser session that could be mistaken for a valid
          // account on a future launch.
          try {
            await markYtPartitionInvalidated(null, partitionName);
          } catch {
            // If even the tombstone write fails, log and continue with the
            // warning. The original sign-in error is still reported.
          }
          result = {
            ...result,
            warning: `The incomplete sign-in session could not be fully cleared: ${
              err instanceof Error ? err.message : 'partition cleanup failed.'
            }`,
          };
        }
      }
      resolve(result);
    };

    attempt.abort = () => {
      void done({
        ok: false,
        cancelled: true,
        error: 'Sign-in was cancelled before completing authentication.',
      });
    };

    const failWithError = (error: string, cancelled = false, retryable = false) => {
      clearLoadWatchdog();
      done({ ok: false, cancelled, error, retryable });
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
        failWithError("Couldn't reach Google - Retry", false, true);
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
        partition: partitionName,
      },
    });
    currentAuthWin = authWin;
    attempt.window = authWin;

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
        failWithError("Couldn't reach Google - Retry", false, true);
      }
    });

    authWin.webContents.on('unresponsive', () => {
      console.error('[YTM Auth unresponsive] render process became unresponsive');
      if (!finished) {
        failWithError("Couldn't reach Google - Retry", false, true);
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
                partition: partitionName,
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
      if (capturing || finished || !canPublish()) return;
      try {
        if (authWin.isDestroyed()) return;
        const currentUrl = authWin.webContents.getURL();
        if (!currentUrl.startsWith('https://music.youtube.com')) return;

        let cookieStr: string;
        try {
          cookieStr = await readCookiesFromPartitionStrict(ses);
        } catch (err) {
          throw new YtmAuthVerificationError(
            `Could not read the YouTube Music sign-in cookies: ${
              err instanceof Error ? err.message : 'cookie storage is unavailable.'
            }`,
          );
        }
        if (!hasYouTubeLoginCookie(cookieStr)) return;
        if (!canPublish()) return;

        capturing = true;

        let meta = { loggedIn: false, visitorData: '', dataSyncId: '' };
        for (let pollAttempt = 0; pollAttempt < 10; pollAttempt++) {
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
            if (meta.loggedIn && meta.visitorData && (meta.dataSyncId || pollAttempt >= 5)) break;
          } catch {
            // continue polling briefly
          }
          await new Promise((r) => setTimeout(r, 450));
        }

        if (!canPublish()) return;

        // Cookie rotation is common while the Music page finishes loading.
        // Read the partition again immediately before validation so the
        // account-menu request uses the newest SAPISID/SID pair rather than
        // the snapshot captured before the page settled.
        const freshCookieStr = await readCookiesFromPartitionStrict(ses);
        if (!hasYouTubeLoginCookie(freshCookieStr)) {
          throw new YtmAuthVerificationError(
            'The YouTube Music sign-in session changed before it could be verified.',
          );
        }

        if (!canPublish()) return;

        const menu = await fetchAccountMenuWithCookies(
          freshCookieStr,
          meta.visitorData,
          meta.dataSyncId,
          0,
          true,
        );
        if (!canPublish()) return;

        const accountId =
          menu.email ||
          crypto.createHash('sha1').update(freshCookieStr.slice(0, 64)).digest('hex').slice(0, 12);

        const nextAccountId = `ytm-${accountId}`;
        const existingAccount = (await getAllYtAccounts()).find(
          (candidate) =>
            candidate.id === nextAccountId ||
            Boolean(
              menu.email &&
                candidate.email &&
                candidate.email.toLowerCase() === menu.email.toLowerCase(),
            ),
        );
        const previousPartition = existingAccount
          ? getYtAccountPartition(existingAccount)
          : null;

        const status = await withAuthMutationLock(async () => {
          if (!canPublish()) {
            throw new YtAuthOperationCancelledError();
          }
          return await upsertYtAccount(
            {
              id: nextAccountId,
              name: menu.accountName || menu.email || 'YouTube Music Listener',
              handle: menu.handle || menu.email || '',
              email: menu.email || '',
              avatarUrl: menu.avatarUrl || '',
              accountIndex: 0,
              cookie: freshCookieStr,
              visitorData: meta.visitorData || '',
              dataSyncId: meta.dataSyncId || '',
              partitionName,
              addedAt: Date.now(),
              lastValidatedAt: Date.now(),
            },
            {
              canPublish,
              onCommitted: () => {
                publishedAccount = true;
              },
            },
          );
        });
        publishedAccount = true;

        let warning: string | undefined;
        if (existingAccount && previousPartition && previousPartition !== partitionName) {
          try {
            // The account was migrated to a fresh partition. Invalidate the
            // previous browser profile only after the encrypted account points
            // at the verified new partition, so the old session remains
            // recoverable until this write succeeds.
            await invalidatePersistentPartition(
              session,
              existingAccount.id,
              previousPartition,
            );
          } catch (err) {
            // The durable tombstone is written before partition clearing, so a
            // failed cleanup cannot let the old session be restored later.
            warning = `The account was saved in a new browser partition, but the previous browser session could not be fully cleared: ${
              err instanceof Error ? err.message : 'partition cleanup failed.'
            }`;
            console.warn('[YTM Auth]', warning);
          }
        }

        resetInnertubeClientCache();
        done({ ok: true, status, ...(warning ? { warning } : {}) });
        if (!authWin.isDestroyed()) {
          authWin.close();
        }
      } catch (err) {
        capturing = false;
        if (finished) return;

        let message: string;
        let retryable = true;
        let cancelled = false;
        if (err instanceof YtAuthOperationCancelledError) {
          message = err.message;
          cancelled = true;
          retryable = false;
        } else if (err instanceof YtmAuthRejectedError) {
          message = `Google rejected the YouTube Music sign-in session (${err.status}). Please sign in again.`;
          retryable = false;
        } else if (err instanceof YtmAuthVerificationError) {
          message = `${err.message} Please retry.`;
        } else if (err instanceof YtVaultUnreadableError) {
          message = err.message;
          retryable = false;
        } else {
          message = `Could not verify the YouTube Music sign-in${
            err instanceof Error ? `: ${err.message}` : '.'
          } Please retry.`;
        }

        failWithError(message, cancelled, retryable);
        if (!authWin.isDestroyed()) {
          authWin.close();
        }
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
            retryable: true,
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
  } finally {
    finishAuthAttempt(attempt);
  }
}

async function importYtmSessionFallbackInternal(opts: {
  cookieHeader: string;
  visitorData?: string;
  dataSyncId?: string;
  accountIndex?: number;
  expectedActiveAccountId?: string | null;
  expectedActiveAccountCookie?: string | null;
  partitionName?: string | null;
  source?: 'explicit' | 'partition-restore';
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

  let menu: AccountMenuInfo;
  try {
    menu = await fetchAccountMenuWithCookies(
      cookieStr,
      visitorData,
      dataSyncId,
      accountIndex,
      true,
    );
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'YouTube Music rejected the session.',
    };
  }
  if (!menu.accountName && !menu.email) {
    return {
      ok: false,
      error: 'YouTube Music did not recognize the imported session. Please sign in again.',
    };
  }

  const accountId =
    menu.email ||
    crypto.createHash('sha1').update(cookieStr.slice(0, 64)).digest('hex').slice(0, 12);

  const account = {
    id: `ytm-${accountId}`,
    name: menu.accountName || menu.email || 'YouTube Music Listener',
    handle: menu.handle || menu.email || '',
    email: menu.email || '',
    avatarUrl: menu.avatarUrl || '',
    accountIndex,
    cookie: cookieStr,
    visitorData,
    dataSyncId,
    ...(opts.partitionName?.trim() ? { partitionName: opts.partitionName.trim() } : {}),
    addedAt: Date.now(),
    lastValidatedAt: Date.now(),
  };
  const upsertOptions = {
    ...(Object.prototype.hasOwnProperty.call(opts, 'expectedActiveAccountId')
      ? { expectedActiveAccountId: opts.expectedActiveAccountId }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(opts, 'expectedActiveAccountCookie')
      ? { expectedActiveAccountCookie: opts.expectedActiveAccountCookie }
      : {}),
    ...(opts.source ? { source: opts.source } : {}),
  };
  let status: YtAuthStatusPayload;
  try {
    status = await withAuthMutationLock(async () => {
      return await upsertYtAccount(account, upsertOptions);
    });
  } catch (err) {
    if (err instanceof YtSessionInvalidatedError) {
      return { ok: false, error: err.message };
    }
    throw err;
  }

  resetInnertubeClientCache();
  return { ok: true, status };
}

export async function importYtmSessionFallback(opts: {
  cookieHeader: string;
  visitorData?: string;
  dataSyncId?: string;
  accountIndex?: number;
  expectedActiveAccountId?: string | null;
  expectedActiveAccountCookie?: string | null;
}): Promise<{ ok: boolean; status?: YtAuthStatusPayload; error?: string }> {
  // Public API: never accept partitionName or source from external callers.
  // These are strictly internal and determined by the caller's context.
  return await importYtmSessionFallbackInternal({
    cookieHeader: opts.cookieHeader,
    visitorData: opts.visitorData,
    dataSyncId: opts.dataSyncId,
    accountIndex: opts.accountIndex,
    expectedActiveAccountId: opts.expectedActiveAccountId,
    expectedActiveAccountCookie: opts.expectedActiveAccountCookie,
    // partitionName and source are intentionally omitted — they are internal only
  });
}

export async function switchYtmAccount(accountId: string): Promise<YtAuthStatusPayload> {
  const status = await switchActiveYtAccount(accountId);
  resetInnertubeClientCache();
  return status;
}

async function clearPartitionStorage(
  session: ElectronSessionModuleLike,
  partitionName: string,
): Promise<void> {
  const ses = session.fromPartition(partitionName);
  await ses.clearStorageData({
    storages: [
      'cookies',
      'localstorage',
      'sessionstorage',
      'indexdb',
      'serviceworkers',
      'cachestorage',
    ],
  });
  if (ses.clearCache) {
    await ses.clearCache().catch(() => undefined);
  }
  const remainingCookie = await readCookiesFromPartitionStrict(ses);
  if (hasResidualYouTubeAuthCookie(remainingCookie)) {
    throw new Error('sensitive authentication cookies are still present');
  }
}

async function invalidatePersistentPartition(
  session: ElectronSessionModuleLike,
  accountId?: string | null,
  partitionName: string = YTM_PARTITION,
): Promise<void> {
  // Persist the invalidation marker first. If Electron cannot clear or
  // verify the partition, the marker still prevents that stale browser
  // session from becoming an authoritative account again.
  try {
    await markYtPartitionInvalidated(accountId || null, partitionName);
  } catch (err) {
    throw new YtmLogoutError(
      `Could not sign out of YouTube Music because the encrypted logout state could not be saved: ${
        err instanceof Error ? err.message : 'vault update failed.'
      } Please retry.`,
    );
  }

  try {
    await clearPartitionStorage(session, partitionName);
  } catch (err) {
    throw new YtmLogoutError(
      `Could not sign out of YouTube Music because the persistent browser session could not be cleared: ${
        err instanceof Error ? err.message : 'storage clearing failed.'
      } Please retry.`,
    );
  }
}

export async function logoutYtmAccount(opts?: {
  session?: ElectronSessionModuleLike;
  accountId?: string;
}): Promise<YtAuthStatusPayload> {
  return await withAuthMutationLock(async () => {
  // Capture the target before any asynchronous partition validation. If the
  // user changes accounts while validation is in flight, logout must still
  // remove this exact account and never whichever account is active later.
  const activeBefore = await getActiveYtAccount();
  const targetAccount = opts?.accountId
    ? await getYtAccountById(opts.accountId)
    : activeBefore;

  if (!targetAccount) {
    if (opts?.accountId) {
      throw new YtAccountNotFoundError(opts.accountId);
    }
    // The no-id path is a real logout request and must invalidate a stale
    // legacy partition even when the encrypted vault has no account left.
    if (opts?.session) {
      await invalidatePersistentPartition(opts.session, null, YTM_PARTITION);
    }
    return await getPublicYtAuthStatus();
  }

  const targetPartition = getYtAccountPartition(targetAccount);
  let partitionState: 'match' | 'different' | 'unknown' | 'empty' = 'unknown';
  if (opts?.session) {
    try {
      partitionState = await getPartitionAccountState(
        opts.session.fromPartition(targetPartition),
        targetAccount,
      );
    } catch {
      partitionState = 'unknown';
    }
  }

  if (opts?.session) {
    if (partitionState === 'different') {
      throw new YtmPartitionOwnershipConflictError(
        `The browser partition for ${targetAccount.id} is owned by a different YouTube Music account; logout was not applied.`,
      );
    }
    // Matched, empty, or inconclusive state is cleared and verified before
    // the vault entry can be removed. A verified mismatch is never treated as
    // a successful logout.
    await invalidatePersistentPartition(
      opts.session,
      targetAccount.id,
      targetPartition,
    );
  } else {
    // Non-Electron callers cannot clear the browser partition directly. Still
    // validate the stored delegated/brand-account context before removing the
    // vault entry, then keep a durable tombstone so a later Electron process
    // cannot restore the partition.
    if (hasYouTubeLoginCookie(targetAccount.cookie)) {
      try {
        const menu = await fetchAccountMenuWithCookies(
          targetAccount.cookie,
          targetAccount.visitorData,
          targetAccount.dataSyncId,
          targetAccount.accountIndex,
          false,
        );
        if (matchAccountIdentity(targetAccount, menu) === 'different') {
          throw new YtmPartitionOwnershipConflictError(
            `The stored credentials for ${targetAccount.id} belong to a different YouTube Music account; logout was not applied.`,
          );
        }
      } catch (err) {
        if (err instanceof YtmPartitionOwnershipConflictError) throw err;
      }
    }
    await markYtPartitionInvalidated(targetAccount.id, targetPartition);
  }

  const nextStatus = await removeYtAccountById(targetAccount.id, targetAccount);
  resetInnertubeClientCache();
  return nextStatus;
  });
}

async function clearPendingResetPartitions(
  session: ElectronSessionModuleLike,
  pending: { partitionNames: string[] },
): Promise<void> {
  for (const partitionName of pending.partitionNames) {
    await clearPartitionStorage(session, partitionName);
  }
}

/**
 * Resumes a reset that was durably staged before a process interruption. The
 * pending marker keeps account mutations disabled until every captured
 * partition has been cleared and verified.
 */
async function recoverPendingYtAuthReset(
  session: ElectronSessionModuleLike,
): Promise<boolean> {
  return await withAuthMutationLock(async () => {
    const pending = await getPendingYtAuthReset();
    if (!pending) return false;
    try {
      await clearPendingResetPartitions(session, pending);
    } catch (err) {
      throw new YtmLogoutError(
        `Could not finish the pending YouTube Music factory reset because a browser session could not be cleared: ${
          err instanceof Error ? err.message : 'storage clearing failed.'
        } Please retry.`,
      );
    }
    await completeYtAuthReset();
    resetInnertubeClientCache();
    return true;
  });
}

/**
 * Removes every YouTube Music account and invalidates each browser partition.
 * Account removal, logout tombstones, and the pending-reset marker are
 * committed atomically before any browser partition is touched. If clearing a
 * partition fails, the pending marker remains durable and recovery can resume
 * without orphaning a concurrently added account.
 */
export async function resetYtmAuth(
  session: ElectronSessionModuleLike,
): Promise<YtAuthStatusPayload> {
  authResetInProgress = true;
  try {
    // Invalidate and await the active sign-in before staging the reset. The
    // attempt's publication guard prevents a late cookie/menu read from
    // recreating an account after the reset has completed.
    await cancelAndAwaitActiveAuthAttempt();

    return await withAuthMutationLock(async () => {
      const pending = await stageYtAuthReset();
      try {
        await clearPendingResetPartitions(session, pending);
      } catch (err) {
        throw new YtmLogoutError(
          `Could not clear every YouTube Music browser session during the factory reset: ${
            err instanceof Error ? err.message : 'storage clearing failed.'
          } Please retry.`,
        );
      }
      const status = await completeYtAuthReset();
      resetInnertubeClientCache();
      return status;
    });
  } finally {
    authResetInProgress = false;
  }
}

async function preserveUnreadableVaultError(err: unknown): Promise<never> {
  if (!(err instanceof YtVaultUnreadableError)) throw err;
  // Sample diagnostics after the failed status/vault attempt. The error keeps
  // the original diagnostic even if a later retry happens to decrypt the file.
  const diagnostic = await getVaultDiagnostic().catch(() => null);
  throw new YtVaultUnreadableError({
    ...(diagnostic || {}),
    ...err.diagnostic,
    error: err.diagnostic.error || diagnostic?.error,
    unreadableFile: true,
  });
}

/**
 * Restores the encrypted account from the persistent sign-in partition when
 * the vault was lost, reset, or overwritten by an earlier concurrent write.
 * The partition still owns the valid Google/YouTube cookies, so the user does
 * not have to sign in again and the renderer can immediately load personalized
 * Home content and synchronize the real account library.
 */
export async function restoreYtmAccountFromSession(
  session: ElectronSessionModuleLike,
): Promise<YtAuthStatusPayload> {
  try {
    // The desktop status IPC is also the startup path. Resume a reset that
    // was staged durably before a crash or process termination.
    await recoverPendingYtAuthReset(session);
    const active = await getActiveYtAccount();
    let activeRejected = false;

    if (active && hasYouTubeLoginCookie(active.cookie)) {
      try {
        const menu = await fetchAccountMenuWithCookies(
          active.cookie,
          active.visitorData,
          active.dataSyncId,
          active.accountIndex,
          true,
        );
        const identityMatch = matchAccountIdentity(active, menu);
        if (identityMatch !== 'different') {
          // A matching account is valid. An unknown identity is inconclusive.
          // Neither case may fall through to partition recovery, because that
          // could replace the active account with a different partition user.
          return await getPublicYtAuthStatus();
        }
        // A verified different account proves that the stored credentials are
        // not for the account they claim to be.
        activeRejected = true;
      } catch (err) {
        if (!(err instanceof YtmAuthRejectedError)) {
          // 403 responses, schema changes, and network failures are
          // inconclusive. Keep the active account and do not touch partition
          // state; only a definitive 401 permits recovery.
          return await getPublicYtAuthStatus();
        }
        activeRejected = true;
      }
    } else if (active) {
      // Missing required login cookies make the stored account unusable.
      activeRejected = true;
    }

    // Partition recovery is allowed only when there was no active account or
    // the active account was definitively rejected.
    if (!active || activeRejected) {
      const recoveryPartition = active
        ? getYtAccountPartition(active)
        : YTM_PARTITION;
      const tombstone = await getYtPartitionTombstone(recoveryPartition);
      if (!tombstone) {
        let partitionCookie = '';
        try {
          const ses = session.fromPartition(recoveryPartition);
          partitionCookie = await readCookiesFromPartitionStrict(ses);
        } catch {
          // A missing/unavailable partition simply means no automatic restore.
        }

        if (hasYouTubeLoginCookie(partitionCookie)) {
          try {
            const restored = await importYtmSessionFallbackInternal({
              cookieHeader: partitionCookie,
              partitionName: recoveryPartition,
              source: 'partition-restore',
              expectedActiveAccountId: active?.id || null,
              ...(active ? { expectedActiveAccountCookie: active.cookie } : {}),
            });
            if (restored.ok && restored.status) {
              resetInnertubeClientCache();
              console.log(
                '[YTM Auth] Restored YouTube Music account from the persistent login session.',
              );
              return restored.status;
            }
          } catch (err) {
            if (err instanceof YtAccountStateConflictError) {
              // A valid/inconclusive account became active while the partition
              // account was being verified. Never switch away from it.
              return await getPublicYtAuthStatus();
            }
            throw err;
          }
        }
      }
    }

    // Only remove the account when its credentials were definitively rejected.
    // Temporary verification failures leave the encrypted account untouched.
    if (active && activeRejected) {
      try {
        await removeYtAccountById(active.id, active);
        resetInnertubeClientCache();
      } catch (err) {
        if (err instanceof YtAccountStateConflictError) {
          return await getPublicYtAuthStatus();
        }
        throw err;
      }
    }

    return await getPublicYtAuthStatus();
  } catch (err) {
    return await preserveUnreadableVaultError(err);
  }
}

export async function getYtmAuthStatus(): Promise<YtAuthStatusPayload> {
  try {
    return await getPublicYtAuthStatus();
  } catch (err) {
    return await preserveUnreadableVaultError(err);
  }
}
