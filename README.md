# Riri Player (Web / Desktop Edition)

**Riri Player** is a Material 3 Expressive YouTube Music and local audio desktop player built with React, TypeScript, Vite, Tailwind CSS, and Electron. Its session login, InnerTube client hierarchy, stream resolver, and Spotify library matcher are inspired by and ported in TypeScript from **[ArchiveTune](https://github.com/rukamori/ArchiveTune)** (licensed under GPL-3.0).

## Features

- **ArchiveTune-Style YouTube Music Session Auth (No API Keys)**: Opens a clean embedded Chrome BrowserWindow (`persist:ytm-login`) with CDP-level WebAuthn/passkey suppression and synchronized Chrome Windows client hints so sign-in falls back cleanly to password + 2FA, capturing `SAPISID`, `visitorData`, and `dataSyncId` into Electron `safeStorage` (or OS-keychain-derived AES-256-GCM fallback). Supports multi-account switching and automatic clean-partition retry.
- **Full Library Sync**: Syncs Liked Songs, cloud Playlists, Saved Albums, Followed Artists, Private Cloud Uploads, and Listening History with incremental progress updates.
- **InnerTube Home, Explore & Search**: Personalized YouTube Music Home feed, mood chips, global Top Charts, search suggestions, and category filters (`Songs`, `Videos`, `Albums`, `Playlists`, `Artists`), plus `.arch` user plugins and local files.
- **Clean Stream Resolution & Playback Recovery**: Resolves Opus/AAC audio streams via `youtubei.js` (`node:vm` sandboxed player evaluation, zero hand-regex cipher parsing) and ArchiveTune's multi-client fallback chain (`YTMUSIC`, `VISIONOS`, `ANDROID_VR`, `WEB`, `MWEB`, `WEB_CREATOR`) with lazy BotGuard `poToken` support, mid-playback expiry refresh, and pre-warming.
- **Spotify Session Sync & Fuzzy Mapper**: Captures an `sp_dc` session via `open.spotify.com` modal login, derives TOTP tokens to query Spotify Pathfinder GQL / REST playlists & liked tracks (zero developer client ID/secret), and matches tracks onto YouTube Music using weighted bigram Dice similarity with an unmatched review queue.
- **Immersive Player, Mini-Player & 10-Band EQ**: Dynamic artwork color extraction, Wavy Expressive seekbar, always-on-top Mini-Player overlay, synchronized LRCLIB + YouTube Music lyrics, and 10-band Web Audio parametric EQ.

## Windows Commands (Install, Dev & Build)

Run in PowerShell, Command Prompt (`cmd`), or Git Bash on Windows:

```bash
# 1. Install dependencies (includes electron, electron-builder, concurrently, wait-on)
npm install

# 2. Launch Vite + Express dev server on port 3000 and start Electron automatically
npm run dev:electron

# 3. Build Windows installers (.exe) into release/
npm run dist:win
```

Additional local development & verification commands:

```bash
npm test      # Run unit tests
npm run lint  # Run TypeScript check
npm run dev   # Run web-only dev server on http://localhost:3000
```

`npm run dist:win` outputs installers into `release/`:
- **`Riri Player-Portable-1.0.0-win-x64.exe`**: Portable standalone executable.
- **`Riri Player-Setup-1.0.0-win-x64.exe`**: NSIS Windows installer wizard.

## License & Attribution

Licensed under **GPL-3.0**. Session authentication, InnerTube client configuration, stream fallback heuristics, and Spotify-to-YouTube Music fuzzy matching logic are ported from **[ArchiveTune](https://github.com/rukamori/ArchiveTune)** (GPL-3.0).
