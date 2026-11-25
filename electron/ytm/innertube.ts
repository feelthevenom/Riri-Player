import vm from 'node:vm';
import { Innertube, Platform, UniversalCache, Utils } from 'youtubei.js';
import {
  buildInnerTubeContext,
  computeSapisidHash,
  extractBrandPageId,
  getClientApiUrl,
  getClientOrigin,
  getClientReferer,
  hasYouTubeLoginCookie,
  YOUTUBE_CLIENTS,
  YouTubeClientProfile,
} from './clients';
import {
  getActiveYtAccount,
  getAnonymousVisitorData,
  getYtAccountById,
  setAnonymousVisitorData,
  type StoredYtAccount,
} from './credentials';

let evalConfigured = false;
let anonymousInnertubePromise: Promise<Innertube> | null = null;
const authedInnertubeCache = new Map<string, { yt: Innertube; cookie: string }>();

export function ensureSandboxedEval(): void {
  if (evalConfigured) return;
  evalConfigured = true;

  Platform.shim.eval = async (data, env) => {
    const properties: string[] = [];
    if (env?.n) {
      properties.push(
        `n: typeof exportedVars?.nFunction === 'function' ? exportedVars.nFunction(${JSON.stringify(env.n)}) : undefined`,
      );
    }
    if (env?.sig) {
      properties.push(
        `sig: typeof exportedVars?.sigFunction === 'function' ? exportedVars.sigFunction(${JSON.stringify(env.sig)}) : undefined`,
      );
    }

    const code = `${data.output}\nreturn { ${properties.join(', ')} };`;
    const result = new Function(code)() as
      | { n?: string; sig?: string }
      | undefined;

    if (result && (result.n !== undefined || result.sig !== undefined)) {
      return result;
    }

    // Fallback for newer youtubei.js builds where exportedVars is returned directly
    const exported = new Function(
      `${data.output}\nreturn typeof exportedVars !== 'undefined' ? exportedVars : undefined;`,
    )() as
      | {
          n?: string;
          sig?: string;
          nFunction?: (n: string) => string;
          sigFunction?: (s: string) => string;
        }
      | undefined;

    if (exported && typeof exported === 'object') {
      return {
        n:
          typeof env?.n === 'string' && typeof exported.nFunction === 'function'
            ? exported.nFunction(env.n)
            : exported.n,
        sig:
          typeof env?.sig === 'string' && typeof exported.sigFunction === 'function'
            ? exported.sigFunction(env.sig)
            : exported.sig,
      };
    }

    return { n: undefined, sig: undefined };
  };
}

export async function getInnertubeClient(opts?: {
  cookie?: string;
  visitorData?: string;
  gl?: string;
  hl?: string;
}): Promise<Innertube> {
  ensureSandboxedEval();
  const active = await getActiveYtAccount();
  const rawCookie = opts?.cookie ?? active?.cookie;
  const cookie = hasYouTubeLoginCookie(rawCookie) ? rawCookie : undefined;
  const gl = (opts?.gl || 'US').toUpperCase();
  const hl = opts?.hl || 'en';

  if (cookie) {
    const cacheKey = `${active?.id || 'custom'}:${gl}:${hl}`;
    const existing = authedInnertubeCache.get(cacheKey);
    if (existing && existing.cookie === cookie) {
      return existing.yt;
    }
    const yt = await Innertube.create({
      cookie,
      visitor_data: opts?.visitorData || active?.visitorData || undefined,
      location: gl,
      lang: hl,
      generate_session_locally: true,
      cache: new UniversalCache(false),
    });
    authedInnertubeCache.set(cacheKey, { yt, cookie });
    return yt;
  }

  if (!anonymousInnertubePromise) {
    const visitorData = opts?.visitorData || (await ensureVisitorData());
    anonymousInnertubePromise = Innertube.create({
      visitor_data: visitorData || undefined,
      location: gl,
      lang: hl,
      generate_session_locally: false,
      cache: new UniversalCache(false),
    })
      .catch(() =>
        Innertube.create({
          visitor_data: visitorData || undefined,
          location: gl,
          lang: hl,
          generate_session_locally: true,
          cache: new UniversalCache(false),
        }),
      )
      .then((yt) => {
        const vd = yt.session.context.client.visitorData;
        if (vd && vd.startsWith('Cg')) {
          void setAnonymousVisitorData(vd).catch(() => undefined);
        }
        return yt;
      });
  }
  return anonymousInnertubePromise;
}

export function resetInnertubeClientCache(): void {
  authedInnertubeCache.clear();
  anonymousInnertubePromise = null;
}

let refreshCookieCallback: ((expectedAccountId?: string) => Promise<boolean>) | null = null;
export function registerCookieRefreshCallback(
  fn: ((expectedAccountId?: string) => Promise<boolean>) | null,
): void {
  refreshCookieCallback = fn;
}

async function fetchVisitorDataFromSwJs(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': YOUTUBE_CLIENTS.WEB_REMIX.userAgent,
        Accept: 'application/json,text/plain,*/*',
      },
      signal: AbortSignal.timeout(7000),
    });
    if (!res.ok) return null;
    const text = await res.text();
    const cleaned = text.replace(/^\)\]\}'\s*/, '');
    const verMatch = cleaned.match(/"INNERTUBE_CLIENT_VERSION"\s*:\s*"(1\.\d+\.\d+\.\d+)"/);
    if (verMatch?.[1] && url.includes('music.youtube.com')) {
      YOUTUBE_CLIENTS.WEB_REMIX.clientVersion = verMatch[1];
    }
    const match = cleaned.match(/"(Cg[A-Za-z0-9\-_]{10,})"/);
    return match?.[1] || null;
  } catch {
    return null;
  }
}

/**
 * Fetches a genuine server-issued visitorData for anonymous and signed-in requests.
 */
export async function ensureVisitorData(forceRefresh = false): Promise<string> {
  const active = await getActiveYtAccount();
  const existing = active?.visitorData || (await getAnonymousVisitorData());
  if (existing && !forceRefresh) return existing;

  const fromYtm = await fetchVisitorDataFromSwJs('https://music.youtube.com/sw.js_data');
  if (fromYtm) {
    await setAnonymousVisitorData(fromYtm).catch(() => undefined);
    return fromYtm;
  }

  const fromYt = await fetchVisitorDataFromSwJs('https://www.youtube.com/sw.js_data');
  if (fromYt) {
    await setAnonymousVisitorData(fromYt).catch(() => undefined);
    return fromYt;
  }

  try {
    const yt = await Innertube.create({
      generate_session_locally: false,
      cache: new UniversalCache(false),
    });
    const vd = yt.session.context.client.visitorData;
    if (vd) {
      await setAnonymousVisitorData(vd).catch(() => undefined);
      return vd;
    }
  } catch {
    // ignore
  }

  return existing || Utils.generateRandomString(11);
}

export class InnerTubeAuthenticationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InnerTubeAuthenticationError';
  }
}

export interface InnerTubeRequestOptions {
  endpoint: string;
  body?: Record<string, unknown>;
  clientKey?: string;
  gl?: string;
  hl?: string;
  useAuth?: boolean;
  poToken?: string;
  disablePoToken?: boolean;
  visitorDataOverride?: string;
  retryOnAuthError?: boolean;
  requireAuth?: boolean;
  /**
   * Use one immutable account snapshot for an entire operation. This prevents
   * a mid-request account switch from mixing credentials from two accounts.
   */
  accountOverride?: StoredYtAccount;
}

export async function innerTubePost<T = Record<string, unknown>>(
  opts: InnerTubeRequestOptions,
): Promise<T> {
  const profile: YouTubeClientProfile =
    YOUTUBE_CLIENTS[opts.clientKey || 'WEB_REMIX'] || YOUTUBE_CLIENTS.WEB_REMIX;

  const rawActive =
    opts.useAuth !== false
      ? opts.accountOverride || (await getActiveYtAccount())
      : null;
  const active = rawActive && hasYouTubeLoginCookie(rawActive.cookie) ? rawActive : null;
  if (opts.requireAuth && !active) {
    throw new Error('YouTube Music authentication is required for this request.');
  }
  const visitorData =
    opts.visitorDataOverride ||
    active?.visitorData ||
    (opts.accountOverride ? '' : await ensureVisitorData());

  const effectivePoToken = opts.disablePoToken
    ? undefined
    : opts.poToken || (active ? active.poToken : undefined);

  const context = buildInnerTubeContext(profile, {
    gl: opts.gl || 'US',
    hl: opts.hl || 'en',
    visitorData,
    dataSyncId: active?.dataSyncId,
    poToken: effectivePoToken,
  });

  const payload = {
    context,
    ...(opts.body || {}),
  };

  const origin = getClientOrigin(profile);
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'User-Agent': profile.userAgent,
    Origin: origin,
    Referer: getClientReferer(profile),
    'X-YouTube-Client-Name': profile.clientId,
    'X-YouTube-Client-Version': profile.clientVersion,
  };

  if (visitorData) {
    headers['X-Goog-Visitor-Id'] = visitorData;
  }

  if (active?.cookie && profile.supportsCookieAuthentication) {
    headers['Cookie'] = active.cookie;
    const sapisidHash = computeSapisidHash(active.cookie, origin);
    if (sapisidHash) {
      headers['Authorization'] = sapisidHash;
      headers['X-Origin'] = origin;
    }
    headers['X-Goog-AuthUser'] = String(active.accountIndex ?? 0);
    const brandPageId = extractBrandPageId(active.dataSyncId);
    if (brandPageId) {
      headers['X-Goog-PageId'] = brandPageId;
    }
  }

  const url = getClientApiUrl(profile, opts.endpoint);
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(15000),
  });

  if (
    (res.status === 401 || res.status === 403) &&
    active &&
    opts.retryOnAuthError !== false &&
    refreshCookieCallback
  ) {
    const refreshed = await refreshCookieCallback(active.id);
    if (refreshed) {
      // Re-read only the account that was refreshed. If the user switched
      // accounts in the meantime, the refresh callback rejects the update and
      // this request fails instead of silently using another account.
      const refreshedAccount = await getYtAccountById(active.id);
      if (!refreshedAccount) {
        throw new InnerTubeAuthenticationError(
          `InnerTube ${opts.endpoint} authentication failed because account ${active.id} was removed during the credential refresh.`,
        );
      }
      return await innerTubePost<T>({
        ...opts,
        accountOverride: refreshedAccount,
        retryOnAuthError: false,
      });
    }
  }

  if (!res.ok) {
    if ((res.status === 401 || res.status === 403) && active && opts.useAuth !== false) {
      if (!opts.requireAuth) {
        return await innerTubePost<T>({ ...opts, useAuth: false, disablePoToken: true });
      }
      const authErrorText = await res.text().catch(() => '');
      throw new Error(
        `InnerTube ${opts.endpoint} authentication failed (${res.status}): ${authErrorText.slice(0, 180)}`,
      );
    }
    const errText = await res.text().catch(() => '');
    throw new Error(`InnerTube ${opts.endpoint} failed (${res.status}): ${errText.slice(0, 180)}`);
  }

  return (await res.json()) as T;
}