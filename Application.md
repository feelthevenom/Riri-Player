# Riri Player - Application Features & User Guide

## Overview
Riri Player is a high-performance, privacy-focused desktop music player for YouTube Music and local audio files. Built with React, TypeScript, Electron, and Material 3 Expressive design.

## Core Features

### 🎵 Music Playback
- **Local Audio**: MP3, FLAC, WAV, OGG, M4A, Opus support
- **YouTube Music Streaming**: Search, play, discover via InnerTube API
- **Gapless Playback**: Seamless transitions between tracks
- **Crossfade**: Configurable crossfade duration (0-12 seconds)
- **Playback Speed**: 0.5x - 2.0x with pitch preservation
- **Volume Normalization**: EBU R128 loudness normalization
- **Sleep Timer**: Auto-stop after configurable duration

### 🎧 Audio Quality & DSP
- **10-Band Parametric EQ**: 60Hz, 230Hz, 910Hz, 3.6kHz, 14kHz + Bass Boost (85Hz) + Preamp
- **EQ Presets**: Flat, Riri Warm, Deep Bass, Vocal Clarity, Acoustic Hall + Custom
- **Bitrate Selection**: Auto, Low, Medium, High, Max quality
- **SponsorBlock**: Auto-skip non-music segments (intros, outros, sponsors)

### 📱 YouTube Music Integration
- **Automated Sign-In**: One-click YouTube Music authentication via Electron BrowserWindow
- **Library Sync**: Liked Songs, Playlists, Albums, Artists, Cloud Uploads
- **Search**: Songs, Videos, Albums, Playlists, Artists
- **Recommendations**: Home feed, Mood/Genre chips, Charts
- **Radio Modes**: Song Radio, Artist Radio, Mix Radio via "Up Next" chips
- **Playlist Import**: Import YouTube Music playlists by URL

### 📚 Library Management
- **Filterable Views**: All, Playlists, Songs, Artists, Albums, Local Audio, YouTube Music
- **Playlist Management**: Create, edit, reorder, tag, export/import
- **Tags System**: Color-coded tags for playlist organization
- **Smart Collections**: Recently Played, Most Played, Recently Added
- **Drag & Drop**: Reorder tracks, add to playlists
- **Local File Import**: Drag & drop or file picker for local audio

### 🎤 Lyrics & Metadata
- **Synced Lyrics**: LRC format with karaoke-style highlighting
- **Auto-Scroll**: Follows playback position
- **Translation**: Line-by-line translation support
- **Plain Lyrics**: Fallback for unsynced tracks
- **Sources**: LRCLIB, KuGou, manual cache
- **Offset Calibration**: ±10s sync adjustment