import React, { useEffect, useRef, useState } from 'react';
import {
  BarChart3,
  Compass,
  Disc3,
  Heart,
  Home,
  Library,
  ListMusic,
  Maximize2,
  Mic2,
  Minimize2,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Pause,
  PictureInPicture2,
  Play,
  Plus,
  Radio,
  Repeat,
  Repeat1,
  Search,
  Settings,
  Shuffle,
  SkipBack,
  SkipForward,
  Sliders,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { useRiriPlayer } from '../context/RiriPlayerContext';
import { ScreenRoute } from '../types/music';
import { formatTime } from '../utils/lyricsParser';
import { FALLBACK_ARTWORK_DATA_URL } from '../data/catalog';
import { RightContextPanel } from './RightContextPanel';
import { TrackContextMenu } from './TrackContextMenu';
import { SpotifyImportModal } from './SpotifyImportModal';
import { GoogleSignInModal } from './GoogleSignInModal';
import { WindowTitleBar } from './WindowTitleBar';
import { SeekBarSlider } from './SeekBarSlider';

export const DesktopShell: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const {
    route,
    routeParam,
    navigate,
    playlists,
    createPlaylist,
    settings,
    updateSettings,
    currentTrack,
    isPlaying,
    positionSec,
    durationSec,
    togglePlayPause,
    nextTrack,
    prevTrack,
    seekTo,
    repeatMode,
    cycleRepeatMode,
    shuffleEnabled,
    toggleShuffle,
    isTrackLiked,
    toggleLike,
    rightPanel,
    toggleRightPanel,
    setShowEqModal,
    setShowSpotifyModal,
    showMiniOverlay,
    openMiniPlayer,
    sleepTimerMinLeft,
    setSleepTimer,
    fullscreenPlayer,
    setFullscreenPlayer,
    toast,
  } = useRiriPlayer();

  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [creatingPlaylist, setCreatingPlaylist] = useState(false);
  const [newPlaylistName, setNewPlaylistName] = useState('');
  const [showSleepMenu, setShowSleepMenu] = useState(false);
  const [prevVolume, setPrevVolume] = useState(0.85);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  const togetherEnabled = settings.customTogetherServerUrl.trim().length > 0;

  // Desktop keyboard shortcuts
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isInputFocused =
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.tagName === 'SELECT' ||
        target?.isContentEditable;

      if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'k' || e.key.toLowerCase() === 'f')) {
        e.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'l') {
        e.preventDefault();
        toggleRightPanel('lyrics');
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'm') {
        e.preventDefault();
        openMiniPlayer();
        return;
      }

      if (e.key === 'Escape' && fullscreenPlayer) {
        setFullscreenPlayer(false);
        return;
      }

      if (isInputFocused) return;

      if (e.code === 'Space') {
        e.preventDefault();
        void togglePlayPause();
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'ArrowRight') {
        e.preventDefault();
        void nextTrack();
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'ArrowLeft') {
        e.preventDefault();
        void prevTrack();
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'ArrowUp') {
        e.preventDefault();
        updateSettings({ volume: Math.min(1, Number((settings.volume + 0.08).toFixed(2))) });
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'ArrowDown') {
        e.preventDefault();
        updateSettings({ volume: Math.max(0, Number((settings.volume - 0.08).toFixed(2))) });
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    fullscreenPlayer,
    nextTrack,
    openMiniPlayer,
    prevTrack,
    setFullscreenPlayer,
    settings.volume,
    togglePlayPause,
    toggleRightPanel,
    updateSettings,
  ]);

  const handleCreatePlaylistSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPlaylistName.trim()) return;
    const pl = createPlaylist(newPlaylistName);
    setNewPlaylistName('');
    setCreatingPlaylist(false);
    navigate('playlist', pl.id);
  };

  const navItems: Array<{ id: ScreenRoute; label: string; icon: React.ReactNode }> = [
    { id: 'home', label: 'Home', icon: <Home className="w-4 h-4" /> },
    { id: 'explore', label: 'Explore & Charts', icon: <Compass className="w-4 h-4" /> },
    { id: 'search', label: 'Search', icon: <Search className="w-4 h-4" /> },
    { id: 'library', label: 'Your Library', icon: <Library className="w-4 h-4" /> },
    { id: 'stats', label: 'Listening Stats', icon: <BarChart3 className="w-4 h-4" /> },
    ...(togetherEnabled
      ? [{ id: 'together' as ScreenRoute, label: 'Listen Together', icon: <Radio className="w-4 h-4" /> }]
      : []),
    { id: 'settings', label: 'Settings', icon: <Settings className="w-4 h-4" /> },
  ];

  const liked = currentTrack ? isTrackLiked(currentTrack.id) : false;

  return (
    <div className="at-workspace-bg h-screen w-screen flex flex-col overflow-hidden bg-[var(--md-background)] text-[var(--md-on-surface)] select-none">
      {/* 48px Draggable Custom Titlebar (hidden in F11 true fullscreen) */}
      <WindowTitleBar
        variant="shell"
        onToggleMobileNav={() => setMobileNavOpen((v) => !v)}
        searchInputRef={searchInputRef}
      />

      {/* Main 3-Zone Workspace */}
      <div className="flex-1 flex min-h-0 overflow-hidden relative">
        {/* Mobile Backdrop */}
        {mobileNavOpen && (
          <div
            onClick={() => setMobileNavOpen(false)}
            className="fixed inset-0 z-30 bg-black/50 md:hidden"
          />
        )}

        {/* Left Collapsible Sidebar */}
        <aside
          aria-label="Primary Sidebar"
          className={`at-glass-panel ${
            sidebarCollapsed ? 'md:w-[72px]' : 'md:w-60'
          } ${
            mobileNavOpen ? 'translate-x-0 w-64 fixed inset-y-12 left-0 z-40' : '-translate-x-full md:translate-x-0'
          } shrink-0 border-r border-[var(--md-outline-variant)]/40 bg-[var(--md-surface-container-low)] flex flex-col transition-all duration-200 overflow-hidden`}
        >
          <div className="flex items-center justify-between px-3 py-2.5">
            {(!sidebarCollapsed || mobileNavOpen) && (
              <span className="text-[11px] font-semibold text-[var(--md-on-surface-variant)] px-2">
                Navigation
              </span>
            )}
            <button
              type="button"
              onClick={() => setSidebarCollapsed((c) => !c)}
              aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              className="hidden md:flex p-1.5 rounded-lg text-[var(--md-on-surface-variant)] hover:text-[var(--md-on-surface)] hover:bg-[var(--md-surface-container-high)] cursor-pointer"
            >
              {sidebarCollapsed ? (
                <PanelLeftOpen className="w-4 h-4" />
              ) : (
                <PanelLeftClose className="w-4 h-4" />
              )}
            </button>
          </div>

          <nav aria-label="Main navigation" className="px-2 space-y-0.5">
            {navItems.map((item) => {
              const active = route === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    navigate(item.id);
                    setMobileNavOpen(false);
                  }}
                  title={item.label}
                  className={`w-full flex items-center gap-3 px-3 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition-colors cursor-pointer ${
                    active
                      ? 'bg-[var(--md-primary-container)] text-[var(--md-on-primary-container)]'
                      : 'text-[var(--md-on-surface-variant)] hover:text-[var(--md-on-surface)] hover:bg-[var(--md-surface-container-high)]/60'
                  }`}
                >
                  <span className="shrink-0">{item.icon}</span>
                  {(!sidebarCollapsed || mobileNavOpen) && (
                    <span className="truncate">{item.label}</span>
                  )}
                </button>
              );
            })}
          </nav>

          {/* Playlist Quick Actions & Scrollable List */}
          {(!sidebarCollapsed || mobileNavOpen) && (
            <div className="mt-4 pt-3 border-t border-[var(--md-outline-variant)]/40 flex-1 flex flex-col min-h-0 px-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] font-semibold text-[var(--md-on-surface-variant)]">
                  Playlists
                </span>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => {
                      setShowSpotifyModal(true);
                      setMobileNavOpen(false);
                    }}
                    title="Import YouTube Music or Spotify Playlist"
                    aria-label="Import Playlist"
                    className="p-1 rounded-md text-[var(--md-on-surface-variant)] hover:text-[var(--md-primary)] hover:bg-[var(--md-surface-container-high)] cursor-pointer"
                  >
                    <Disc3 className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setCreatingPlaylist((v) => !v)}
                    title="Create Playlist"
                    aria-label="Create Playlist"
                    className="p-1 rounded-md text-[var(--md-on-surface-variant)] hover:text-[var(--md-primary)] hover:bg-[var(--md-surface-container-high)] cursor-pointer"
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {creatingPlaylist && (
                <form onSubmit={handleCreatePlaylistSubmit} className="mb-2 flex gap-1">
                  <input
                    type="text"
                    autoFocus
                    aria-label="New playlist name"
                    placeholder="Playlist name..."
                    value={newPlaylistName}
                    onChange={(e) => setNewPlaylistName(e.target.value)}
                    className="flex-1 min-w-0 rounded-lg border border-[var(--md-outline-variant)] bg-[var(--md-surface-container)] px-2.5 py-1 text-xs focus:outline-none focus:border-[var(--md-primary)]"
                  />
                  <button
                    type="submit"
                    className="px-2.5 py-1 rounded-lg bg-[var(--md-primary)] text-[var(--md-on-primary)] text-xs font-semibold cursor-pointer"
                  >
                    Add
                  </button>
                </form>
              )}

              <div className="flex-1 overflow-y-auto space-y-0.5 pb-3">
                {playlists.map((pl) => {
                  const active = route === 'playlist' && routeParam === pl.id;
                  return (
                    <button
                      key={pl.id}
                      type="button"
                      onClick={() => {
                        navigate('playlist', pl.id);
                        setMobileNavOpen(false);
                      }}
                      className={`w-full flex items-center justify-between px-2.5 py-2 rounded-lg text-xs text-left transition-colors cursor-pointer ${
                        active
                          ? 'bg-[var(--md-surface-container-highest)] text-[var(--md-primary)] font-semibold'
                          : 'text-[var(--md-on-surface-variant)] hover:text-[var(--md-on-surface)] hover:bg-[var(--md-surface-container-high)]/50'
                      }`}
                    >
                      <span className="truncate">{pl.name}</span>
                      <span className="text-[11px] font-mono-tabular opacity-70 ml-2 shrink-0">
                        {pl.trackIds.length}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </aside>

        {/* Center Main Viewport */}
        <main className="flex-1 min-w-0 overflow-y-auto px-4 sm:px-6 py-6 select-text">
          {children}
        </main>

        {/* Right Contextual Lyrics / Queue Panel */}
        <RightContextPanel />
      </div>

      {/* 88px Persistent Bottom Transport Bar */}
      <footer
        aria-label="Playback Transport Bar"
        className="at-glass-panel h-[88px] shrink-0 border-t border-[var(--md-outline-variant)]/40 bg-[var(--md-surface-container-low)] px-3 sm:px-4 grid grid-cols-2 md:grid-cols-3 items-center gap-3 sm:gap-4"
      >
        {/* Left: Track Info */}
        <div className="flex items-center gap-3 min-w-0">
          {currentTrack ? (
            <>
              <button
                type="button"
                onClick={() => setFullscreenPlayer(true)}
                aria-label="Open Cinema Player"
                className="w-12 h-12 sm:w-14 sm:h-14 rounded-xl overflow-hidden shrink-0 border border-[var(--md-outline-variant)]/40 hover:scale-105 transition-transform cursor-pointer"
              >
                <img
                  src={currentTrack.thumbnailUrl || FALLBACK_ARTWORK_DATA_URL}
                  alt={currentTrack.title}
                  referrerPolicy="no-referrer"
                  onError={(e) => {
                    e.currentTarget.src = FALLBACK_ARTWORK_DATA_URL;
                  }}
                  className="w-full h-full object-cover"
                />
              </button>
              <div className="min-w-0">
                <button
                  type="button"
                  onClick={() => setFullscreenPlayer(true)}
                  className="font-semibold text-sm truncate hover:underline text-left block w-full cursor-pointer"
                >
                  {currentTrack.title}
                </button>
                <div className="flex items-center gap-1.5 text-xs text-[var(--md-on-surface-variant)] truncate">
                  <button
                    type="button"
                    onClick={() => navigate('artist', currentTrack.artist)}
                    className="hover:text-[var(--md-on-surface)] hover:underline truncate cursor-pointer"
                  >
                    {currentTrack.artist}
                  </button>
                  <span aria-hidden="true" className="hidden lg:inline">·</span>
                  <span className="hidden lg:inline text-[11px] font-mono-tabular">
                    {currentTrack.qualityLabel || currentTrack.source.toUpperCase()}
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => toggleLike(currentTrack.id, currentTrack)}
                aria-label={liked ? 'Remove from Liked Songs' : 'Save to Liked Songs'}
                className={`p-1.5 rounded-lg shrink-0 cursor-pointer ${
                  liked
                    ? 'text-[var(--md-primary)]'
                    : 'text-[var(--md-on-surface-variant)] hover:text-[var(--md-on-surface)]'
                }`}
              >
                <Heart className={`w-4 h-4 ${liked ? 'fill-current' : ''}`} />
              </button>
            </>
          ) : (
            <div className="text-xs text-[var(--md-on-surface-variant)] truncate">
              Select a track to start streaming
            </div>
          )}
        </div>

        {/* Center: Playback Controls + Seek Bar */}
        <div className="flex flex-col items-end md:items-center gap-1.5 max-w-xl w-full mx-auto">
          <div className="flex items-center gap-2 sm:gap-4">
            <button
              type="button"
              onClick={toggleShuffle}
              aria-label="Toggle shuffle"
              className={`hidden sm:inline-flex p-1.5 rounded-lg cursor-pointer ${
                shuffleEnabled
                  ? 'text-[var(--md-primary)]'
                  : 'text-[var(--md-on-surface-variant)] hover:text-[var(--md-on-surface)]'
              }`}
            >
              <Shuffle className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => void prevTrack()}
              aria-label="Previous track"
              className="p-1.5 rounded-lg text-[var(--md-on-surface-variant)] hover:text-[var(--md-on-surface)] cursor-pointer"
            >
              <SkipBack className="w-4 h-4 fill-current" />
            </button>
            <button
              type="button"
              onClick={() => void togglePlayPause()}
              aria-label={isPlaying ? 'Pause' : 'Play'}
              className="w-9 h-9 rounded-full bg-[var(--md-primary)] text-[var(--md-on-primary)] flex items-center justify-center hover:scale-105 transition-transform cursor-pointer"
            >
              {isPlaying ? (
                <Pause className="w-4 h-4 fill-current" />
              ) : (
                <Play className="w-4 h-4 fill-current ml-0.5" />
              )}
            </button>
            <button
              type="button"
              onClick={() => void nextTrack()}
              aria-label="Next track"
              className="p-1.5 rounded-lg text-[var(--md-on-surface-variant)] hover:text-[var(--md-on-surface)] cursor-pointer"
            >
              <SkipForward className="w-4 h-4 fill-current" />
            </button>
            <button
              type="button"
              onClick={cycleRepeatMode}
              aria-label={`Repeat mode: ${repeatMode}`}
              className={`hidden sm:inline-flex p-1.5 rounded-lg cursor-pointer ${
                repeatMode !== 'OFF'
                  ? 'text-[var(--md-primary)]'
                  : 'text-[var(--md-on-surface-variant)] hover:text-[var(--md-on-surface)]'
              }`}
            >
              {repeatMode === 'ONE' ? (
                <Repeat1 className="w-4 h-4" />
              ) : (
                <Repeat className="w-4 h-4" />
              )}
            </button>
          </div>

          <div className="hidden md:flex w-full items-center gap-2 text-[11px] font-mono-tabular text-[var(--md-on-surface-variant)]">
            <span className="w-9 text-right">{formatTime(positionSec)}</span>
            <SeekBarSlider
              sliderStyle={settings.sliderStyle}
              positionSec={positionSec}
              durationSec={durationSec}
              isPlaying={isPlaying}
              onSeek={seekTo}
              ariaLabel="Track progress"
              step={0.25}
              showHoverTime
              className="flex-1"
            />
            <span className="w-9">
              {durationSec > 0 ? `-${formatTime(Math.max(0, durationSec - positionSec))}` : '0:00'}
            </span>
          </div>
        </div>

        {/* Right: Mini-Player, Sleep Timer, Lyrics, Queue, EQ, Volume, Cinema */}
        <div className="hidden md:flex items-center justify-end gap-1 relative">
          <button
            type="button"
            onClick={openMiniPlayer}
            aria-label="Switch to Mini-Player"
            title="Switch to Mini-Player (Ctrl+M)"
            className={`p-2 rounded-lg cursor-pointer transition-colors ${
              showMiniOverlay
                ? 'text-[var(--md-primary)] bg-[var(--md-primary-container)]/35'
                : 'text-[var(--md-on-surface-variant)] hover:text-[var(--md-on-surface)]'
            }`}
          >
            <PictureInPicture2 className="w-4 h-4" />
          </button>

          <div className="relative">
            <button
              type="button"
              onClick={() => setShowSleepMenu((v) => !v)}
              aria-label="Sleep Timer"
              title="Sleep Timer"
              className={`p-2 rounded-lg flex items-center gap-1 cursor-pointer ${
                sleepTimerMinLeft !== null
                  ? 'text-[var(--md-primary)] bg-[var(--md-primary-container)]/35'
                  : 'text-[var(--md-on-surface-variant)] hover:text-[var(--md-on-surface)]'
              }`}
            >
              <Moon className="w-4 h-4" />
              {sleepTimerMinLeft !== null && (
                <span className="text-[10px] font-mono-tabular font-bold">
                  {sleepTimerMinLeft}m
                </span>
              )}
            </button>

            {showSleepMenu && (
              <div className="absolute bottom-11 right-0 z-50 w-36 rounded-xl border border-[var(--md-outline-variant)] bg-[var(--md-surface-container-high)] p-1.5 shadow-xl text-xs">
                <div className="px-2 py-1 text-[10px] font-semibold text-[var(--md-on-surface-variant)]">
                  Sleep Timer
                </div>
                {[15, 30, 45, 60].map((mins) => (
                  <button
                    key={mins}
                    type="button"
                    onClick={() => {
                      setSleepTimer(mins);
                      setShowSleepMenu(false);
                    }}
                    className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-[var(--md-surface-container-highest)] cursor-pointer"
                  >
                    {mins} minutes
                  </button>
                ))}
                {sleepTimerMinLeft !== null && (
                  <button
                    type="button"
                    onClick={() => {
                      setSleepTimer(null);
                      setShowSleepMenu(false);
                    }}
                    className="w-full text-left px-2.5 py-1.5 rounded-lg text-red-400 hover:bg-red-500/10 cursor-pointer"
                  >
                    Turn Off
                  </button>
                )}
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={() => toggleRightPanel('lyrics')}
            aria-label="Toggle Lyrics panel"
            title="Lyrics (Ctrl+L)"
            className={`p-2 rounded-lg cursor-pointer ${
              rightPanel === 'lyrics'
                ? 'text-[var(--md-primary)] bg-[var(--md-primary-container)]/35'
                : 'text-[var(--md-on-surface-variant)] hover:text-[var(--md-on-surface)]'
            }`}
          >
            <Mic2 className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={() => toggleRightPanel('queue')}
            aria-label="Toggle Queue panel"
            title="Up Next Queue"
            className={`p-2 rounded-lg cursor-pointer ${
              rightPanel === 'queue'
                ? 'text-[var(--md-primary)] bg-[var(--md-primary-container)]/35'
                : 'text-[var(--md-on-surface-variant)] hover:text-[var(--md-on-surface)]'
            }`}
          >
            <ListMusic className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={() => setShowEqModal(true)}
            aria-label="Open 10-band Equalizer"
            title="10-Band Equalizer & DSP"
            className="p-2 rounded-lg text-[var(--md-on-surface-variant)] hover:text-[var(--md-on-surface)] cursor-pointer"
          >
            <Sliders className="w-4 h-4" />
          </button>

          <div className="hidden xl:flex items-center gap-1.5 ml-1">
            <button
              type="button"
              onClick={() => {
                if (settings.volume > 0) {
                  setPrevVolume(settings.volume);
                  updateSettings({ volume: 0 });
                } else {
                  updateSettings({ volume: prevVolume || 0.85 });
                }
              }}
              aria-label={settings.volume === 0 ? 'Unmute' : 'Mute'}
              className="p-1.5 rounded-lg text-[var(--md-on-surface-variant)] hover:text-[var(--md-on-surface)] cursor-pointer"
            >
              {settings.volume === 0 ? (
                <VolumeX className="w-4 h-4" />
              ) : (
                <Volume2 className="w-4 h-4" />
              )}
            </button>
            <input
              type="range"
              aria-label="Master Volume"
              min={0}
              max={1}
              step={0.02}
              value={settings.volume}
              onChange={(e) => updateSettings({ volume: parseFloat(e.target.value) })}
              className="w-20 h-1.5 accent-[var(--md-primary)] cursor-pointer"
            />
          </div>

          <button
            type="button"
            onClick={() => setFullscreenPlayer(!fullscreenPlayer)}
            disabled={!currentTrack}
            aria-label="Open Cinema Player"
            className="p-2 rounded-lg text-[var(--md-on-surface-variant)] hover:text-[var(--md-on-surface)] disabled:opacity-35 cursor-pointer"
          >
            {fullscreenPlayer ? (
              <Minimize2 className="w-4 h-4" />
            ) : (
              <Maximize2 className="w-4 h-4" />
            )}
          </button>
        </div>
      </footer>

      {/* Toast Notification */}
      {toast && (
        <div
          role="status"
          className={`fixed bottom-24 right-6 z-50 rounded-xl px-4 py-2.5 text-xs font-semibold shadow-xl border ${
            toast.type === 'error'
              ? 'bg-red-950/95 text-red-100 border-red-500/50'
              : 'bg-[var(--md-surface-container-highest)] text-[var(--md-on-surface)] border-[var(--md-outline-variant)]'
          }`}
        >
          {toast.message}
        </div>
      )}

      <GoogleSignInModal />
      <TrackContextMenu />
      <SpotifyImportModal />
    </div>
  );
};
