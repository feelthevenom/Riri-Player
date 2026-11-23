import crypto from 'node:crypto';
import { BotGuardClient, getChallenge } from 'bgutils-js/botguard';
import { WebPoMinter } from 'bgutils-js/webpo';
import { buildURL, getHeaders } from 'bgutils-js/utils';
import type { IntegrityTokenData, WebPoSignalOutput } from 'bgutils-js/shared-types';

interface CachedPoToken {
  poToken: string;
  visitorData: string;
  createdAt: number;
}

const PO_TOKEN_TTL_MS = 4 * 60 * 60 * 1000;
const REQUEST_KEY = 'O43z0dpjhgX20SCx4KAo';
const poTokenCache = new Map<string, CachedPoToken>();

let electronProvider: {
  createHiddenWindow?: (url: string) => Promise<{
    evalJs: <T>(script: string) => Promise<T>;
    close: () => void;
  }>;
} = {};

export function configureBotGuardWindowFactory(
  factory: {
    createHiddenWindow?: (url: string) => Promise<{
      evalJs: <T>(script: string) => Promise<T>;
      close: () => void;
    }>;
  },
) {
  electronProvider = factory;
}

export function invalidateAllPoTokens(): void {
  poTokenCache.clear();
}

export function getCachedPoToken(identifier: string): string | null {
  const entry = poTokenCache.get(identifier);
  if (!entry) return null;
  if (Date.now() - entry.createdAt > PO_TOKEN_TTL_MS) {
    poTokenCache.delete(identifier);
    return null;
  }
  return entry.poToken;
}

async function fetchIntegrityToken(botguardResponse: string): Promise<IntegrityTokenData | null> {
  try {
    const response = await fetch(buildURL('GenerateIT'), {
      method: 'POST',
      headers: getHeaders(REQUEST_KEY),
      body: JSON.stringify([REQUEST_KEY, botguardResponse]),
    });
    if (!response.ok) return null;
    const raw = (await response.json()) as [string?, number?, number?, string?];
    return {
      integrityToken: raw[0],
      estimatedTtlSecs: raw[1],
      mintRefreshThreshold: raw[2],
      websafeFallbackToken: raw[3],
    };
  } catch {
    return null;
  }
}

export async function generatePoToken(
  identifier: string,
  visitorData?: string,
): Promise<{ poToken: string; visitorData: string } | null> {
  const key = identifier || visitorData || 'default';
  const existing = poTokenCache.get(key);
  if (existing && Date.now() - existing.createdAt < PO_TOKEN_TTL_MS) {
    return { poToken: existing.poToken, visitorData: existing.visitorData };
  }

  const contentBinding = identifier || visitorData || crypto.randomUUID();

  try {
    const challenge = await getChallenge({
      requestKey: REQUEST_KEY,
      fetchFunction: globalThis.fetch.bind(globalThis),
    });
    if (!challenge?.program || !challenge.globalName) return null;

    const interpreterJs =
      challenge.interpreterJavascript?.privateDoNotAccessOrElseSafeScriptWrappedValue;
    if (electronProvider.createHiddenWindow && interpreterJs) {
      let winHandle:
        | Awaited<ReturnType<NonNullable<typeof electronProvider.createHiddenWindow>>>
        | null = null;
      try {
        winHandle = await electronProvider.createHiddenWindow('https://music.youtube.com/robots.txt');

        const snapshotResult = await winHandle.evalJs<{ bgResponse: string; hasMinter: boolean } | null>(`
          (async () => {
            try {
              const fn = new Function(${JSON.stringify(interpreterJs)});
              fn();
              const vm = window[${JSON.stringify(challenge.globalName)}];
              if (!vm || typeof vm.a !== 'function') return null;

              let asyncSnapshotFn = null;
              await vm.a(
                ${JSON.stringify(challenge.program)},
                (snapFn) => { asyncSnapshotFn = snapFn; },
                true,
                undefined,
                () => {},
                [[], []],
                undefined,
                false,
                undefined
              );
              if (typeof asyncSnapshotFn !== 'function') return null;

              const webPoSignalOutput = [];
              const bgResponse = await new Promise((resolve) => {
                asyncSnapshotFn((res) => resolve(res), [undefined, undefined, webPoSignalOutput, undefined]);
                setTimeout(() => resolve(null), 8000);
              });
              if (!bgResponse) return null;
              window.__ririWebPo = webPoSignalOutput;
              return { bgResponse: String(bgResponse), hasMinter: typeof webPoSignalOutput[0] === 'function' };
            } catch {
              return null;
            }
          })()
        `);

        if (snapshotResult?.bgResponse && snapshotResult.hasMinter) {
          const integrity = await fetchIntegrityToken(snapshotResult.bgResponse);
          if (integrity?.integrityToken) {
            const mintedToken = await winHandle.evalJs<string | null>(`
              (async () => {
                try {
                  const getMinter = window.__ririWebPo && window.__ririWebPo[0];
                  if (typeof getMinter !== 'function') return null;
                  const b64 = ${JSON.stringify(integrity.integrityToken)}.replace(/-/g, '+').replace(/_/g, '/');
                  const bin = atob(b64);
                  const tokenBytes = new Uint8Array(bin.length);
                  for (let i = 0; i < bin.length; i++) tokenBytes[i] = bin.charCodeAt(i);
                  const mintFn = await getMinter(tokenBytes);
                  if (typeof mintFn !== 'function') return null;
                  const outBytes = await mintFn(new TextEncoder().encode(${JSON.stringify(contentBinding)}));
                  if (!(outBytes instanceof Uint8Array)) return null;
                  let outStr = '';
                  for (let i = 0; i < outBytes.length; i++) outStr += String.fromCharCode(outBytes[i]);
                  return btoa(outStr).replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/, '');
                } catch {
                  return null;
                }
              })()
            `);

            if (mintedToken) {
              const result = { poToken: mintedToken, visitorData: visitorData || contentBinding };
              poTokenCache.set(key, { ...result, createdAt: Date.now() });
              return result;
            }
          }
        }
      } catch {
        // Fall through to pure BotGuardClient path
      } finally {
        winHandle?.close();
      }
    }

    if (interpreterJs) {
      const dummyGlobal: Record<string, unknown> = {};
      try {
        const execInGlobal = new Function('window', 'globalThis', interpreterJs);
        execInGlobal(dummyGlobal, dummyGlobal);
      } catch {
        // Interpreter requires real browser DOM
      }

      if (dummyGlobal[challenge.globalName]) {
        const bgClient = await BotGuardClient.create({
          program: challenge.program,
          globalName: challenge.globalName,
          globalObject: dummyGlobal,
        });
        const webPoSignalOutput: WebPoSignalOutput = [];
        const bgResponse = await bgClient.snapshot({ webPoSignalOutput });
        const integrity = await fetchIntegrityToken(bgResponse);
        if (integrity?.integrityToken) {
          const minter = await WebPoMinter.create(integrity, webPoSignalOutput);
          const poToken = await minter.mintAsWebsafeString(contentBinding);
          if (poToken) {
            const result = { poToken, visitorData: visitorData || contentBinding };
            poTokenCache.set(key, { ...result, createdAt: Date.now() });
            return result;
          }
        }
      }
    }
  } catch {
    // BotGuard challenge failed or blocked offline
  }

  return null;
}