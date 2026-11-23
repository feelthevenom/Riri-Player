# Riri Player - Implementation Documentation

## Overview
This document describes the key implementation details of Riri Player, focusing on audio streaming, data flow, and extensibility points for future maintenance.

---

## Audio Streaming Architecture

### Stream URL Resolution Flow

```
User plays track
      │
      ▼
playTrack() in RiriPlayerContext.tsx (line ~1231)
      │
      ▼
resolveArchPluginStream() for plugin tracks
      │
      ▼
Audio URL Construction in playTrack():
  - If streamUrl starts with '/api/ytmusic/stream':
    → Append gl, hl, quality params from settings
  - For other sources (local, online):
    → Use streamUrl directly
      │
      ▼
audioEngine.loadAndPlay(streamUrl) in audioEngine.ts (line ~208)
      │
      ▼
Audio Element Setup:
  - crossOrigin = 'anonymous'
  - preload = 'auto'
  - Proxy wrapping for external URLs:
    → '/api/proxy-audio?url=<encoded_url>'
  - Internal API URLs used directly
      │
      ▼
Electron Main Process (/electron/ytm/stream.ts):
  1. resolveYtmAudioStream() called via /api/ytmusic/resolve-stream
  2. Tries multiple YouTube InnerTube clients:
     - Authenticated: TVHTML5_SIMPLY, WEB_EMBEDDED, WEB_CREATOR, etc.
     - Anonymous: IOS, ANDROID, ANDROID_VR, TVHTML5_SIMPLY
  3. Deciphers signatureCipher/cipher if needed
  4. Probes stream URLs for valid audio containers
  5. Wraps in local HTTP range proxy (127.0.0.1:random_port)
  6. Returns proxied URL: http://127.0.0.1:PORT/stream?key=<cache_key>
      │
      ▼
Browser Audio Element plays from local proxy
      │
      ▼
Local Proxy (ensureLocalStreamProxy in stream.ts):
  - Serves CORS + byte-range responses
  - Handles 403 fallback to next client
  - Caches streams with expiry tracking
```

### Key Files for Audio Streaming

| File | Purpose |
|------|---------|
| `src/context/RiriPlayerContext.tsx` | `playTrack()` - entry point, URL construction |
| `src/utils/audioEngine.ts` | `RiriPlayerAudioEngine` - HTMLAudioElement wrapper, Web Audio API DSP |
| `electron/ytm/stream.ts` | `resolveYtmAudioStream()` - core stream resolution logic |
| `electron/ytm/innertube.ts` | InnerTube API client for YouTube Music |
| `electron/ytm/clients.ts` | YouTube client definitions (user agents, capabilities) |
| `src/utils/ytmClient.ts` | Frontend API client (`resolveStream` method) |

### Stream Quality Selection

The `preferredAudioQuality` setting (AUTO/LOW/MEDIUM/HIGH/MAX) is passed to:
1. `playTrack()` → adds `quality` param to `/api/ytmusic/stream` URL
2. `resolveYtmAudioStream()` → `extractQualityRank()` sorts formats by bitrate preference
3. Client selection chain respects quality preference

### Adding New Stream Resolution Methods

To add a new stream source (e.g., different API, CDN, or protocol):

1. **Create a new resolver function** in `electron/ytm/stream.ts` or a new file:
   ```typescript
   // Example: New resolver for alternative source
   export async function resolveAlternativeStream(payload: ResolveStreamPayload): Promise<ResolvedAudioStream> {
     // Implementation
   }
   ```

2. **Add to client chain** in `resolveYtmAudioStream()`:
   ```typescript
   // After plugin fallback, before throwing error
   const alternative = await resolveAlternativeStream(payload);
   if (alternative) return alternative;
   ```

3. **Or create a new .arch plugin** (recommended for external sources):
   - Implement `search()` and `resolveStream()` in plugin code
   - Register via Plugin Manager in Settings
   - Falls back automatically via `resolveFallbackPluginStream()`

4. **No frontend changes needed** - the proxy architecture handles new sources transparently.

---

## Image/Thumbnail Quality

### Current Implementation
Thumbnails come from YouTube Music API responses. The URLs typically point to `yt3.ggpht.com` or `i.ytimg.com` with size parameters.

### Quality Improvement Options

1. **Modify thumbnail URLs** in `ytmClient.ts` `decorateTrackThumb()` / `decorateBrowseThumb()`:
   ```typescript
   // Replace size parameters in URL
   thumbnailUrl = thumbnailUrl.replace(/=s\d+/, '=s512'); // Request 512px
   thumbnailUrl = thumbnailUrl.replace(/\/w\d+-h\d+/, '/w512-h512');
   ```

2. **Use higher resolution endpoints** in browse/search responses:
   - Check `thumbnailUrl` variants in API response
   - Some endpoints return `thumbnails` array with multiple sizes

3. **Client-side upscaling** (not recommended for bandwidth)

### Recommended Fix
Update `decorateTrackThumb()` in `src/utils/ytmClient.ts` to request higher resolution:
```typescript
function decorateTrackThumb(t: Track): Track {
  let thumb = t.thumbnailUrl;
  if (thumb) {
    // Request 512px thumbnails instead of default 88-128px
    thumb = thumb.replace(/=s\d+-c/, '=s512-c')
                 .replace(/=w\d+-h\d+/, '=w512-h512')
                 .replace(/\/s\d+\//, '/s512/');
  }
  return t.thumbnailUrl?.startsWith('/api/')
    ? { ...t, thumbnailUrl: decorateProxyUrl(thumb) }
    : { ...t, thumbnailUrl: thumb };
}
```

---

## Settings Implementation Verification

### Content Region (`contentRegion`)
- **Location**: `SettingsScreen.tsx` line ~349, `RiriPlayerContext.tsx` line ~799
- **Usage**: Passed as `gl` param to all YouTube Music API calls:
  - `getHomeFeed()`, `browseCollection()`, `getCharts()`, `searchYtm()`, `getQueueNext()`, `getLyrics()`, `syncYtmLibrary()`, `syncSpotify()`
- **Status**: ✅ Implemented and working

### Content Language (`contentLanguage`)
- **Location**: `SettingsScreen.tsx` line ~366, `RiriPlayerContext.tsx` line ~800
- **Usage**: Passed as `hl` param to all YouTube Music API calls (same as region)
- **Status**: ✅ Implemented and working

### Audio Stream Quality (`preferredAudioQuality`)
- **Location**: `SettingsScreen.tsx` line ~383, `RiriPlayerContext.tsx` line ~1253
- **Usage**: 
  - Added to `/api/ytmusic/stream` URL as `quality` param
  - Passed to `resolveYtmAudioStream()` → `extractQualityRank()`
- **Values**: AUTO, LOW, MEDIUM, HIGH, MAX
- **Status**: ✅ Implemented and working

---

## Fullscreen Handling

### F11 (App Fullscreen)
- **Toggle**: `toggleAppFullscreen()` in `RiriPlayerContext.tsx` line ~570
- **Key Handler**: F11 keydown listener (line ~587)
- **ESC Exit**: Added keydown handler for Escape key (line ~589)

### Cinema Player Fullscreen
- **Component**: `FullscreenCinemaPlayer.tsx`
- **ESC Handler**: Line ~148 - closes cinema player if not in app fullscreen
- **State**: `fullscreenPlayer` (cinema) vs `isAppFullscreen` (F11)

---

## Playlist Organization

### Source-Based Filtering (LibraryScreen)
- **Filter Dropdown**: Added `playlistSourceFilter` state (ALL/YTMUSIC/SPOTIFY/LIKED/LOCAL)
- **Logic**: Filters `visiblePlaylists` by:
  - `ytBrowseId` → YouTube Music
  - `spotifyId` → Spotify Music
  - `id === 'pl-liked'` → Liked Music (Riri)
  - None of above → Local Playlists

### Playlist Cover Collage Generation
- **Utility**: `src/utils/playlistCover.ts`
- **Function**: `generatePlaylistCoverCollage(tracks, size)`
- **Algorithm**: 
  1. Takes first 4 tracks with valid thumbnails
  2. Creates 2x2 grid canvas
  3. Scales images to fill cells maintaining aspect ratio
  4. Returns data URL (PNG)
- **Usage**: 
  - `LibraryScreen` - generates covers for all playlists without covers
  - `DetailScreen` - generates hero art for playlist view

---

## Liked Songs Sorting

### Default Sort: Newest First
- **Configuration**: `getDefaultSortConfig('liked')` in `trackSorting.ts`
- **Returns**: `{ column: 'addedAt', direction: 'desc' }`
- **Applied**: `SortableTrackTable` with `sortContext='liked'` prop
- **Column**: Added 'Added' column (hidden on small screens) with `addedAt` sort

---

## Spotify Sync Progress Bar

### Progress Phases
1. **fetching** - Connecting to Spotify, fetching liked songs
2. **matching** - Matching tracks on YouTube Music
3. **importing** - Importing playlists (per-playlist updates)
4. **complete** - Summary message
5. **error** - Error message

### Display Locations
1. **SpotifyImportModal** - Detailed progress with current item name
2. **SettingsScreen** - Horizontal progress bar below sync button

### Implementation
- **State**: `spotifySyncProgress` in `RiriPlayerContext`
- **Updates**: `setSpotifySyncProgress()` called at each phase in `syncSpotifyLibraryWithConnection()`
- **Auto-clear**: Progress cleared 5 seconds after completion

---

## Data Persistence

### IndexedDB (storageDb.ts)
- **Library State**: Tracks, playlists, tags, play events, search history, plugins
- **Queue State**: Current queue, index, repeat mode, shuffle, position
- **YT Music Data**: Saved albums, followed artists, uploads, history
- **Spotify Connection**: Sync schedule, last sync time, unmatched tracks

### LocalStorage
- **Settings**: `ririp_c_settings_v2`
- **EQ Profiles**: `ririp_c_eq_v2`

---

## Extensibility Points

### Adding New Audio Sources
1. **Arch Plugins** (Recommended):
   - Create `.arch` plugin with `resolveStream()` method
   - Auto-discovered via plugin fallback chain
   - No core code changes needed

2. **Electron Stream Resolver**:
   - Add new client to `clients.ts`
   - Add to client chain in `stream.ts`
   - Handles authentication, deciphering, probing

3. **Frontend API Route**:
   - Add new `/api/*` endpoint in Electron main
   - Call from `ytmClient.ts` via `apiFetch()`

### Adding New Metadata Sources
- Extend `Track` interface in `types/music.ts`
- Update `decorateTrackThumb()` in `ytmClient.ts`
- Modify `SortableTrackTable` columns if needed

---

## Known Issues / Future Improvements

1. **Thumbnail Quality**: Implement higher resolution request (see Image Quality section)
2. **Offline Support**: Queue local blob URLs for offline playback
3. **Stream Caching**: Implement persistent stream cache across sessions
4. **Gapless Playback**: Improve crossfade transition logic
5. **Lyrics Sync**: Better offset calibration UI

---

## File Structure Reference

```
src/
├── context/
│   └── RiriPlayerContext.tsx      # Main state management, playTrack()
├── utils/
│   ├── audioEngine.ts             # Web Audio API wrapper
│   ├── ytmClient.ts               # Frontend API client
│   ├── trackSorting.ts            # Sorting logic
│   ├── playlistCover.ts           # Collage generation
│   └── spotifySyncHelpers.ts      # Spotify sync utilities
├── screens/
│   ├── LibraryScreen.tsx          # Playlist filtering, cover generation
│   ├── DetailScreen.tsx           # Playlist/Album/Artist view
│   └── SettingsScreen.tsx         # Settings with progress bars
├── components/
│   ├── SortableTrackTable.tsx     # Track list with sorting
│   ├── SpotifyImportModal.tsx     # Spotify sync UI with progress
│   └── FullscreenCinemaPlayer.tsx # Fullscreen player
└── types/
    └── music.ts                   # TypeScript interfaces

electron/ytm/
├── stream.ts                      # Core stream resolution
├── innertube.ts                   # InnerTube API client
├── clients.ts                     # YouTube client definitions
├── credentials.ts                 # Cookie/token management
└── pluginFallback.ts              # .arch plugin integration
```

---

*Last Updated: 2025*
*Version: 2.0*