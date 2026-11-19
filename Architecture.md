# Riri Player - Architecture Documentation

## Overview
Riri Player is a high-performance, privacy-focused YouTube Music and local audio player built with React, TypeScript, Vite, Tailwind CSS, and Electron. It's inspired by the Android ArchiveTune project but built from scratch for desktop.

## Tech Stack

### Frontend
- **React 19** - UI library with hooks and concurrent features
- **TypeScript** - Type-safe development
- **Vite 6** - Fast build tool and dev server
- **Tailwind CSS 4** - Utility-first CSS framework
- **Lucide React** - Icon library

### Backend (Electron Main Process)
- **Electron 45** - Desktop app framework
- **Express.js** - Internal HTTP server for API endpoints
- **Node.js** - Runtime environment

### Audio Engine
- **Web Audio API** - Real-time audio processing
- **Custom audio engine** - Playback, EQ, crossfade, speed control
- **Supports**: MP3, FLAC, WAV, OGG, M4A, Opus

### YouTube Music Integration
- **InnerTube API** - Unofficial YouTube Music API
- **Automated authentication** - Electron BrowserWindow for cookie extraction
- **Stream URL resolution** - Signature cipher decryption
- **Queue management** - Up Next suggestions, radio modes

### Data Storage
- **IndexedDB** - Local database for tracks, playlists, settings
- **File System** - Local audio file handling
- **Settings persistence** - localStorage for preferences

## Project Structure

```
src/
├── components/          # React components
│   ├── DesktopShell.tsx      # Main app shell with titlebar
│   ├── RightContextPanel.tsx # Lyrics/Queue panel
│   ├── MiniPlayerOverlay.tsx # Pinned mini player
│   ├── FullscreenCinemaPlayer.tsx # Fullscreen player
│   ├── ProfileMenu.tsx       # User profile & YT Music sign-in
│   ├── TrackContextMenu.tsx  # Track right-click menu
│   ├── SpotifyImportModal.tsx # Spotify playlist import
│   ├── GoogleSignInModal.tsx # Google OAuth modal
│   └── ...
├── context/
│   └── ArchiveTuneContext.tsx # Global state management
├── screens/             # Page components
│   ├── HomeScreen.tsx
│   ├── SearchScreen.tsx
│   ├── LibraryScreen.tsx
│   ├── SettingsScreen.tsx
│   ├── DetailScreen.tsx
│   └── ...
├── utils/               # Utility functions
│   ├── audioEngine.ts        # Audio playback engine
│   ├── ytMusicParser.ts      # YouTube Music response parsing
│   ├── streamQuality.ts      # Stream quality selection
│   ├── themeEngine.ts        # Material 3 theming
│   ├── lyricsParser.ts       # LRC lyrics parsing
│   ├── googleAuth.ts         # Firebase Google OAuth
│   ├── archPluginRunner.ts   # Plugin system (removed)
│   └── storageDb.ts          # IndexedDB wrapper
├── types/
│   └── music.ts              # TypeScript interfaces
├── data/
│   ├── catalog.ts            # Constants & presets
│   └── translatorLanguages.ts
├── App.tsx               # Root component
├── main.tsx              # Entry point
└── index.css             # Global styles & Tailwind

electron/
├── main.cjs              # Electron main process
├── preload.cjs           # Preload script (IPC bridge)
└── server.cjs            # Bundled Express server

server.ts                 # Express server (TypeScript source)
```

## Key Architectural Patterns

### 1. Context-Based State Management
- Single `ArchiveTuneContext` provides all global state
- Uses React hooks (`useState`, `useCallback`, `useMemo`)
- Ref-based callbacks for circular dependencies

### 2. IPC Communication
- `electron/main.cjs` handles native operations
- `electron/preload.cjs` exposes safe IPC APIs
- Renderer communicates via `window.electronAPI`

### 3. Server-Side API Proxy
- Express server runs in Electron main process
- Proxies YouTube Music InnerTube requests
- Handles CORS, authentication, stream resolution
- Runs on `http://127.0.0.1:3000`

### 4. YouTube Music Integration Flow
```
User clicks "Sign in to YouTube Music"
  → Electron opens hidden BrowserWindow
  → Navigates to Google login → music.youtube.com
  → Waits for cookies + visitor data
  → Extracts SAPISID, visitorData, dataSyncId
  → Closes window, calls signInYtMusicAccount()
  → Syncs library (liked, playlists, albums, artists, uploads)
```

### 5. Queue System
- Simple array-based queue in context
- "Up Next" suggestions from InnerTube `next` API
- Radio chips (Song Radio, Artist Radio, etc.)
- Infinite pagination via continuation tokens

### 5. Audio Engine
- Single `AudioEngine` class in `audioEngine.ts`
- Web Audio API for EQ, crossfade, speed
- Handles format detection, buffering, playback
- Integrates with MiniPlayer and Fullscreen player

### 6. Theming System
- Material 3 Expressive design system
- Dynamic color extraction from artwork
- CSS custom properties for theming
- Glass/frosted/opaque surface styles

## Data Flow

### Playback Flow
```
User clicks track
  → playTrack() in context
  → audioEngine.loadAndPlay(url)
  → Web Audio API decodes & plays
  → Context updates currentTrack, isPlaying
  → Fetches lyrics, Up Next queue
  → UI updates via context subscribers
```

### YouTube Music Search
```
User types query
  → SearchScreen debounces
  → Calls searchYtMusicTracks()
  → Server proxies to InnerTube Search API
  → Parses results via ytMusicParser
  → Returns normalized Track[]
  → UI renders in SortableTrackTable
```

### Library Sync
```
User clicks "Sync Library"
  → syncYtMusicLibrary() in context
  → Server calls InnerTube Browse API
  → Fetches liked, playlists, albums, artists, uploads
  → Parses via ytMusicParser
  → Updates context tracks, playlists
  → Stores in IndexedDB
```

## Security Considerations

- **No API keys stored** - Uses InnerTube web client
- **Cookies isolated** - Electron session partition
- **No external analytics** - Privacy-focused
- **CSP headers** - Content Security Policy
- **Context isolation** - Electron contextIsolation: true
- **Sandbox** - Renderer sandbox enabled

## Performance Optimizations

- **Code splitting** - Vite automatic chunking
- **Memoization** - `useMemo`, `useCallback` throughout
- **Virtual scrolling** - Large lists in SortableTrackTable
- **Image lazy loading** - Native `loading="lazy"`
- **Audio streaming** - Range requests for large files
- **IndexedDB** - Async, non-blocking storage

## Build & Distribution

### Development
```bash
npm run dev          # Vite dev server
npm run dev:electron # Electron with Vite dev server
```

### Production Build
```bash
npm run build        # Vite production build
npm run build:server # esbuild server bundle
npm run dist:win     # Electron-builder Windows
```

### Output
- `release/Riri Player-Setup-1.0-win-x64.exe` - NSIS installer
- `release/Riri Player-Portable-1.0-win-x64.exe` - Portable executable

## Future Extensibility

- Plugin system architecture (prepared)
- Custom provider support
- Last.fm/ListenBrainz scrobbling
- Discord Rich Presence
- Mobile/Tablet responsive layout