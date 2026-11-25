# Riri Player - Architecture Documentation

## Overview
Riri Player is a desktop YouTube Music and local audio player built with Electron, React 19, TypeScript, Vite, and Tailwind CSS. Its InnerTube transport, multi-account session authentication, stream resolution fallback chain, and Spotify-to-YouTube-Music library mapping follow the architecture of **[ArchiveTune](https://github.com/rukamori/ArchiveTune)** (GPL-3.0).

## Architecture Boundaries

### 1. Main-Process InnerTube & Credential Vault (`electron/ytm/`)
All external YouTube Music and Spotify credentials stay strictly in the Electron main process:
- **`electron/ytm/credentials.ts`**: Encrypts YouTube Music (`cookie`, `SAPISID`, `visitorData`, `dataSyncId`, `accounts`) and Spotify (`sp_dc`, `sp_key`) credentials at rest using Electron `safeStorage` (including Electron 45's `{ result, shouldReEncrypt }` async decrypt shape and key-rotation re-encryption, with an AES-256-GCM fallback keyed from OS identity). Vault reads and read-modify-write operations are serialized and persisted atomically so visitor-data refreshes cannot erase a freshly saved account; an existing unreadable vault is preserved rather than overwritten. Exposes only sanitized summaries (`YtAccountSummary`, `SpotifyConnection`) to the renderer.
- **`electron/ytm/clients.ts`**: ArchiveTune-derived InnerTube client contexts (`WEB_REMIX`, `VISIONOS`, `ANDROID_VR`, `WEB`, `MWEB`, `WEB_CREATOR`) and `SAPISIDHASH` authorization signer.
- **`electron/ytm/auth.ts`**: Opens a visible modal `BrowserWindow` (`persist:ytm-login`) with stripped Electron UA/`sec-ch-ua` headers so Google sign-in succeeds cleanly, extracts cookies + `visitorData` + `dataSyncId`, fetches/validates `account_menu`, restores a lost vault from the persistent login partition, and supports multi-account switching, sign-out, and manual browser-session fallback.
- **`electron/ytm/innertube.ts` & `electron/ytm/botguard.ts`**: Initializes `youtubei.js` with `Platform.shim.eval` running in an isolated `node:vm` context (no hand-written player-JS regex deciphering), plus lazy BotGuard `poToken` minting via `bgutils-js`.
- **`electron/ytm/stream.ts`**: Multi-client stream resolver (`YTMUSIC` -> `VISIONOS` -> `ANDROID_VR` -> `WEB` -> `MWEB` -> `WEB_CREATOR`), LRU stream URL cache, single-flight deduplication, and `streamQuality.ts` Opus > AAC ranking with preview rejection.
- **`electron/ytm/library.ts` & `electron/ytm/homeSearchQueue.ts`**: Incremental YTM library sync (Liked Songs, Saved Library Songs, Playlists, Saved Albums, Followed Artists, Uploads, History with `library:progress` events), account-scoped request snapshots and per-account single-flight coalescing, authenticated Home feed, Charts, Search + Suggestions, Browse, Up Next queue (`next`), and Lyrics.
- **`electron/ytm/spotify.ts`**: ArchiveTune-style `open.spotify.com` modal login capturing `sp_dc` -> TOTP token exchange (with hidden-window Bearer capture fallback) -> Spotify Pathfinder GQL / REST fetch -> weighted fuzzy matcher (`spotifyMapper.ts`) onto YouTube Music.
- **`electron/ytm/index.ts` & `electron/preload.cjs`**: Exposes typed `window.electronAPI` channels (`auth:*`, `library:*`, `home:*`, `search:*`, `queue:*`, `stream:*`, `spotify:*`).

### 2. Local Audio & Asset Proxy (`server.ts` / `electron/main.cjs`)
- In Electron, `startAppServer()` binds strictly to `127.0.0.1` on an ephemeral random port (`0`) with a per-launch cryptographic secret (`x-riri-launch-secret` / `?token=`) validated via `crypto.timingSafeEqual`.
- `/api/proxy-audio`, `/api/ytmusic/stream`, and `/api/proxy-image` enforce `parseSafeExternalUrl` SSRF filtering (blocking localhost/private/link-local IP ranges).

### 3. Renderer State (`src/context/RiriPlayerContext.tsx` & `src/utils/ytmClient.ts`)
- Communicates with main process via `window.electronAPI` (with authenticated `/api/*` fallback for standalone Express dev mode).
- Persists sanitized library state and playback queue (`library_state_v3`, `queue_state_v1`) in IndexedDB (`src/utils/storageDb.ts`), strictly excluding raw session secrets. YouTube Music sync snapshots are account-scoped: stale cross-account responses are discarded, liked state is replaced from the authoritative Liked Songs snapshot, and cloud playlist membership is replaced rather than unioned with stale local state.
- Handles instant track switching, background queue pre-warming, mid-playback stream expiry auto-recovery, 10-band Web Audio EQ (`audioEngine.ts`), SponsorBlock skipping, and cached multi-provider lyrics with stale-request cancellation plus concurrent transliteration/translation.

## Project Structure

```
electron/
├── main.cjs             # Window lifecycle, 127.0.0.1:0 proxy boot + launchSecret
├── preload.cjs          # contextBridge IPC API (auth, library, home, search, queue, stream, spotify)
└── ytm/                 # Main-process InnerTube, Auth, BotGuard, Spotify, safeStorage vault
src/
├── context/RiriPlayerContext.tsx
├── utils/
│   ├── ytmClient.ts     # Renderer IPC + secret-injected proxy client
│   ├── audioEngine.ts   # Web Audio DSP + EQ + authenticated proxy URL builder
│   ├── streamQuality.ts # Codec/bitrate ranking & preview rejection
│   ├── spotifyMapper.ts # Bigram Dice track matcher
│   ├── ytMusicParser.ts # InnerTube JSON normalizer
│   └── storageDb.ts     # IndexedDB library + queue persistence
└── components/ & screens/
server.ts                # Express audio/image proxy + REST fallback routes
```

## Build & Test

```bash
npm test            # Run TypeScript unit tests via tsx --test
npm run build:all   # Build Vite frontend + bundle electron/ytm-main.cjs & electron/server.cjs
npm run dist:win    # Build Windows NSIS installer & Portable executable
```