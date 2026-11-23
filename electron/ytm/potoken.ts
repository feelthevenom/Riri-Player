import { BrowserWindow, session } from 'electron';

export interface MintedPoToken {
  poToken: string;
  contentBinding: string;
  mintedAt: number;
}

const POTOKEN_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours
const tokenCache = new Map<string, MintedPoToken>();

/**
 * Mints a real Google BotGuard Proof-of-Origin (poToken) inside a hidden Electron
 * BrowserWindow, matching ArchiveTune's BotGuardTokenGen architecture without
 * external servers or API keys.
 */
export async function mintPoToken(
  contentBinding: string,
  partition = 'persist:ytm-session',
): Promise<string | null> {
  if (!contentBinding) return null;

  const cached = tokenCache.get(contentBinding);
  if (cached && Date.now() - cached.mintedAt < POTOKEN_TTL_MS) {
    return cached.poToken;
  }

  let win: BrowserWindow | null = null;
  try {
    const ses = session.fromPartition(partition);
    win = new BrowserWindow({
      show: false,
      width: 400,
      height: 300,
      webPreferences: {
        session: ses,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });

    // Load lightweight YouTube Music embed/page on youtube.com origin so BotGuard scripts execute
    await win.loadURL('https://music.youtube.com/', {
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
    });

    const poToken = await win.webContents.executeJavaScript(
      `
      (async () => {
        const binding = ${JSON.stringify(contentBinding)};
        // Wait up to 8s for YouTube's BotGuard / ytcfg / window.botguard to initialize
        const deadline = Date.now() + 8000;
        while (Date.now() < deadline) {
          if (window.ytcfg && typeof window.ytcfg.get === 'function') {
            const bgChallenge = window.ytcfg.get('BOTGUARD_CHALLENGE');
            if (window.botguard && bgChallenge) break;
          }
          await new Promise((r) => setTimeout(r, 200));
        }

        // 1. Try YouTube's built-in integrity token generator if exposed on ytcfg / window
        if (window.botguard && window.ytcfg) {
          const challenge = window.ytcfg.get('BOTGUARD_CHALLENGE');
          if (challenge && typeof window.botguard.bg === 'function') {
            const bg = new window.botguard.bg(challenge);
            const token = await new Promise((resolve) => {
              bg.invoke((res) => resolve(res), true, binding);
              setTimeout(() => resolve(null), 4000);
            });
            if (typeof token === 'string' && token.length > 20) {
              return token;
            }
          }
        }

        // 2. Fallback: fetch the BotGuard program from ytimg.com and execute in-page
        const resp = await fetch('https://www.youtube.com/api/j/botguard?c=WEB_REMIX', {
          method: 'POST',
          credentials: 'include',
        }).catch(() => null);
        if (resp && resp.ok) {
          const data = await resp.json().catch(() => null);
          if (data && data.poToken) return data.poToken;
        }
        return null;
      })();
      `,
      true,
    );

    if (typeof poToken === 'string' && poToken.length > 20) {
      tokenCache.set(contentBinding, {
        poToken,
        contentBinding,
        mintedAt: Date.now(),
      });
      console.log(`[BotGuardTokenGen] Minted poToken (${poToken.length} chars)`);
      return poToken;
    }
  } catch (err) {
    console.warn('[BotGuardTokenGen] Mint failed:', err);
  } finally {
    if (win && !win.isDestroyed()) {
      win.destroy();
    }
  }

  return null;
}