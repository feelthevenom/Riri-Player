# Riri Player (Web / Desktop Edition)

**Riri Player** is a Material 3 Expressive music player and discovery client inspired by the Android Jetpack Compose codebase, built with React, TypeScript, Vite, Tailwind CSS, and Express for desktop runtime.

## Features

- **Home & Discovery**: Category filter chips (`All`, `Relax`, `Energize`, `Workout`, `Focus`, `Commute`), Speed Dial quick-access grid, Quick Picks, and live online catalog search.
- **Immersive Player & MiniPlayer**: Dynamic artwork color extraction (`Theme.kt` palette engine), Gradient / Glow / Blur / Solid player backgrounds, Wavy Expressive seekbar, real-time Web Audio frequency spectrum visualizer, playback speed, and sleep timer.
- **Live Synced Lyrics**: LrcLib integration (`/api/lyrics`) with clickable timestamp seeking, auto-scroll, sync offset calibration, and font scaling.
- **5-Band Web Audio Equalizer & DSP**: Parametric 5-band EQ (`60Hz`, `230Hz`, `910Hz`, `3.6kHz`, `14kHz`), Bass Boost (`85Hz`), Output Preamp Gain, and presets (`Flat`, `Riri Warm`, `Deep Bass`, `Vocal Clarity`, `Acoustic Hall`).
- **Library & Local PC Audio**: Filterable library (`All`, `Playlists`, `Songs`, `Artists`, `Albums`, `Local Audio`), playlist tag filtering, and drag-and-drop local audio playback (`.mp3`, `.flac`, `.wav`, `.ogg`, `.m4a`).
- **Listening Stats & Backup**: Time-period insights (`1W` to `All Time`), hourly listening rhythm chart, top artists/tracks, and JSON backup export/restore.

## Running Locally

```bash
npm install
npm run dev
```

The server listens on `http://0.0.0.0:3000`.

## Building Windows Standalone Application (.exe)

To build the standalone `.exe` packages for Windows 10 and Windows 11:

```bash
npm run dist:win
```

This generates the following binaries in the `release/` folder:
- **`Riri Player-Portable-1.0-win-x64.exe`**: Standalone single-file executable that requires no installation. Run directly anywhere.
- **`Riri Player-Setup-1.0-win-x64.exe`**: Full Windows installer wizard that installs Desktop & Start Menu shortcuts with uninstaller.
- **`release/win-unpacked/Riri Player.exe`**: Pre-extracted standalone application folder.
