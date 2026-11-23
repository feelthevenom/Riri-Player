import React from 'react';
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Download,
  Info,
  Maximize2,
  Menu,
  Minimize2,
  Minus,
  Search,
  Sliders,
  Square,
  X,
} from 'lucide-react';
import { useRiriPlayer } from '../context/RiriPlayerContext';
import { ProfileMenu } from './ProfileMenu';

interface ElectronWindowBridge {
  minimizeWindow?: () => void;
  maximizeWindow?: () => void;
  closeWindow?: () => void;
}

interface WindowTitleBarProps {
  variant?: 'shell' | 'cinema';
  onToggleMobileNav?: () => void;
  searchInputRef?: React.RefObject<HTMLInputElement | null>;
  isSolidTheme?: boolean;
}

export const WindowTitleBar: React.FC<WindowTitleBarProps> = ({
  variant = 'shell',
  onToggleMobileNav,
  searchInputRef,
  isSolidTheme = false,
}) => {
  const {
    route,
    navigate,
    goBack,
    goForward,
    canGoBack,
    canGoForward,
    globalSearchQuery,
    setGlobalSearchQuery,
    currentTrack,
    setFullscreenPlayer,
    isAppFullscreen,
    toggleAppFullscreen,
    setShowEqModal,
    showToast,
  } = useRiriPlayer();

  // Hide the draggable top bar only when user enters true fullscreen (F11 or Expand button)
  if (isAppFullscreen) return null;

  const electronAPI = (window as unknown as { electronAPI?: ElectronWindowBridge }).electronAPI;
  const noDrag = { WebkitAppRegion: 'no-drag' } as React.CSSProperties;

  // Changelog modal state
  const [showChangelog, setShowChangelog] = React.useState(false);
  const [changelogData, setChangelogData] = React.useState<{ version: string; releaseDate: string; releaseNotes: string; currentVersion: string } | null>(null);
  const [loadingChangelog, setLoadingChangelog] = React.useState(false);

  const fetchChangelog = async () => {
    setLoadingChangelog(true);
    try {
      // Try to get from electronAPI first (for update info)
      const api = (window as any).electronAPI;
      let releaseData = null;
      
      // Fetch from GitHub API
      const response = await fetch('https://api.github.com/repos/feelthevenom/Riri-Player/releases/latest', {
        headers: { 'Accept': 'application/vnd.github.v3+json' },
      });
      
      if (response.ok) {
        releaseData = await response.json();
      }
      
      const currentVersion = '1.1.0'; // From package.json
      if (releaseData) {
        setChangelogData({
          version: releaseData.tag_name?.replace('v', '') || 'Unknown',
          releaseDate: releaseData.published_at?.split('T')[0] || 'Unknown',
          releaseNotes: releaseData.body || 'No release notes available.',
          currentVersion,
        });
      } else {
        setChangelogData({
          version: currentVersion,
          releaseDate: 'Unknown',
          releaseNotes: 'Could not fetch release notes. Check GitHub releases page.',
          currentVersion,
        });
      }
      setShowChangelog(true);
    } catch (err) {
      setChangelogData({
        version: '1.0.0',
        releaseDate: 'Unknown',
        releaseNotes: 'Failed to fetch changelog. Please check GitHub releases manually.',
        currentVersion: '1.0.0',
      });
      setShowChangelog(true);
    } finally {
      setLoadingChangelog(false);
    }
  };

  const handleGlobalSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (route !== 'search') {
      navigate('search');
    }
  };

  const renderWindowControls = (lightOnDark = false) => {
    const btnCls = lightOnDark
      ? 'hidden sm:flex p-1.5 rounded-lg text-white/80 hover:text-white hover:bg-white/15 cursor-pointer'
      : 'hidden sm:flex p-1.5 rounded-lg text-[var(--md-on-surface-variant)] hover:text-[var(--md-on-surface)] hover:bg-[var(--md-surface-container-high)] cursor-pointer';

    return (
      <>
        <button
          type="button"
          onClick={() => {
            if (electronAPI?.minimizeWindow) electronAPI.minimizeWindow();
            else showToast('Window minimize is active in the Windows desktop app.');
          }}
          aria-label="Minimize window"
          className={btnCls}
          style={noDrag}
        >
          <Minus className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          onClick={() => {
            if (electronAPI?.maximizeWindow) {
              electronAPI.maximizeWindow();
            } else {
              toggleAppFullscreen();
            }
          }}
          aria-label="Maximize window"
          className={btnCls}
          style={noDrag}
        >
          <Square className="w-3 h-3" />
        </button>
        <button
          type="button"
          onClick={() => {
            if (electronAPI?.closeWindow) electronAPI.closeWindow();
            else showToast('Window close is active in the Windows desktop app.');
          }}
          aria-label="Close window"
          className={`hidden sm:flex p-1.5 rounded-lg hover:text-white hover:bg-red-600/85 cursor-pointer ${
            lightOnDark ? 'text-white/80' : 'text-[var(--md-on-surface-variant)]'
          }`}
          style={noDrag}
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </>
    );
  };

  if (variant === 'cinema') {
    const useDarkBackdrop = !isSolidTheme;
    const headerCls = useDarkBackdrop
      ? 'h-12 shrink-0 flex items-center justify-between gap-3 px-3 border-b border-white/10 bg-black/35 backdrop-blur-md text-white relative z-20'
      : 'at-glass-panel h-12 shrink-0 flex items-center justify-between gap-3 px-3 border-b border-[var(--md-outline-variant)]/40 bg-[var(--md-surface-container-low)] text-[var(--md-on-surface)] relative z-20';

    const actionBtnCls = useDarkBackdrop
      ? 'flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-white/25 bg-zinc-900/75 hover:bg-zinc-800/90 text-white text-xs font-semibold shadow-sm transition-colors cursor-pointer'
      : 'flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-[var(--md-outline-variant)] bg-[var(--md-surface-container-highest)] hover:bg-[var(--md-surface-container-high)] text-[var(--md-on-surface)] text-xs font-semibold shadow-sm transition-colors cursor-pointer';

    return (
      <header className={headerCls} style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}>
        <div className="flex items-center gap-2 min-w-0">
          <div className="flex items-center gap-2 px-1.5 py-1 whitespace-nowrap shrink-0">
            <span className="w-6 h-6 rounded-lg bg-[var(--md-primary)] text-[var(--md-on-primary)] flex items-center justify-center font-bold text-xs">
              RP
            </span>
            <span className="font-display font-bold text-sm tracking-tight hidden sm:inline">
              Riri Player
            </span>
          </div>

          <button
            type="button"
            onClick={() => setFullscreenPlayer(false)}
            aria-label="Minimize Player"
            className={actionBtnCls}
            style={noDrag}
          >
            <ChevronDown className="w-4 h-4 shrink-0" />
            <span>Minimize Player</span>
          </button>
        </div>

        <div
          className={`hidden md:block text-xs font-semibold tracking-wide truncate ${
            useDarkBackdrop ? 'text-white/75' : 'text-[var(--md-on-surface-variant)]'
          }`}
        >
          Now Playing
          {currentTrack
            ? ` · ${currentTrack.qualityLabel || currentTrack.source.toUpperCase()}`
            : ''}
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={() => setShowEqModal(true)}
            aria-label="Open 10-band Equalizer"
            className={actionBtnCls}
            style={noDrag}
          >
            <Sliders className="w-3.5 h-3.5 shrink-0" />
            <span className="hidden sm:inline">10-Band EQ</span>
          </button>

          <button
            type="button"
            onClick={toggleAppFullscreen}
            aria-label="Expand to fullscreen"
            title="Expand to true fullscreen (F11)"
            className={actionBtnCls}
            style={noDrag}
          >
            <Maximize2 className="w-3.5 h-3.5 shrink-0" />
            <span className="hidden lg:inline">Expand</span>
          </button>

          <div
            className={`h-4 w-px mx-1 hidden sm:block ${
              useDarkBackdrop ? 'bg-white/20' : 'bg-[var(--md-outline-variant)]/50'
            }`}
            style={noDrag}
          />

          {renderWindowControls(useDarkBackdrop)}
        </div>
      </header>
    );
  }

  return (
    <header
      className="at-glass-panel h-12 shrink-0 flex items-center justify-between gap-3 px-3 border-b border-[var(--md-outline-variant)]/40 bg-[var(--md-surface-container-low)]"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      <div className="flex items-center gap-1.5 min-w-0">
        {onToggleMobileNav && (
          <button
            type="button"
            onClick={onToggleMobileNav}
            aria-label="Toggle mobile navigation"
            className="md:hidden p-1.5 rounded-lg text-[var(--md-on-surface-variant)] hover:text-[var(--md-on-surface)] hover:bg-[var(--md-surface-container-high)] cursor-pointer"
            style={noDrag}
          >
            <Menu className="w-4 h-4" />
          </button>
        )}

        <button
          type="button"
          onClick={() => navigate('home')}
          className="flex items-center gap-2 px-2 py-1 rounded-lg hover:bg-[var(--md-surface-container-high)] whitespace-nowrap shrink-0 cursor-pointer"
          style={noDrag}
        >
          <span className="w-6 h-6 rounded-lg bg-[var(--md-primary)] text-[var(--md-on-primary)] flex items-center justify-center font-bold text-xs">
            RP
          </span>
          <span className="font-display font-bold text-sm tracking-tight hidden sm:inline">
            Riri Player
          </span>
        </button>

        <div className="hidden sm:flex items-center gap-1 ml-1">
          <button
            type="button"
            onClick={goBack}
            disabled={!canGoBack}
            aria-label="Navigate back"
            className="p-1.5 rounded-lg text-[var(--md-on-surface-variant)] hover:text-[var(--md-on-surface)] hover:bg-[var(--md-surface-container-high)] disabled:opacity-30 cursor-pointer"
            style={noDrag}
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={goForward}
            disabled={!canGoForward}
            aria-label="Navigate forward"
            className="p-1.5 rounded-lg text-[var(--md-on-surface-variant)] hover:text-[var(--md-on-surface)] hover:bg-[var(--md-surface-container-high)] disabled:opacity-30 cursor-pointer"
            style={noDrag}
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Center Instant Global Search */}
      <form onSubmit={handleGlobalSearchSubmit} className="flex-1 max-w-md min-w-0">
        <div className="relative flex items-center">
          {/* Info/Changelog Icon - Top Left Next to Search */}
          <button
            type="button"
            onClick={fetchChangelog}
            disabled={loadingChangelog}
            aria-label="View changelog and version info"
            className="absolute left-3 p-1.5 rounded-lg text-[var(--md-on-surface-variant)] hover:text-[var(--md-primary)] hover:bg-[var(--md-surface-container-high)] cursor-pointer transition-colors"
            style={noDrag}
          >
            <Info className="w-4 h-4" />
          </button>
          <Search className="w-4 h-4 absolute left-11 text-[var(--md-on-surface-variant)] pointer-events-none" />
          <input
            ref={searchInputRef}
            type="search"
            aria-label="Global search"
            placeholder="Search YouTube Music, songs, artists..."
            value={globalSearchQuery}
            onChange={(e) => {
              setGlobalSearchQuery(e.target.value);
              if (e.target.value.trim() && route !== 'search') {
                navigate('search');
              }
            }}
            className="w-full h-8 pl-17 pr-16 rounded-xl bg-[var(--md-surface-container-high)]/80 border border-[var(--md-outline-variant)]/50 text-xs text-[var(--md-on-surface)] placeholder:text-[var(--md-on-surface-variant)] focus:outline-none focus:border-[var(--md-primary)]"
            style={noDrag}
          />
          <span className="hidden md:inline-block absolute right-2.5 text-[10px] font-mono-tabular px-1.5 py-0.5 rounded bg-[var(--md-surface-container)] text-[var(--md-on-surface-variant)]">
            Ctrl+K
          </span>
        </div>
      </form>

      {/* Changelog Modal */}
      {showChangelog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={() => setShowChangelog(false)}>
          <div className="at-glass-card w-full max-w-2xl max-h-[80vh] overflow-hidden rounded-2xl border border-[var(--md-outline-variant)]/40 bg-[var(--md-surface-container-low)]" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b border-[var(--md-outline-variant)]/30">
              <div className="flex items-center gap-2">
                <Info className="w-5 h-5 text-[var(--md-primary)]" />
                <h3 className="text-lg font-bold">Changelog & Version Info</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowChangelog(false)}
                className="p-1.5 rounded-lg text-[var(--md-on-surface-variant)] hover:text-[var(--md-on-surface)] hover:bg-[var(--md-surface-container-high)] cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-4 space-y-4 max-h-[60vh] overflow-y-auto">
              <div className="grid grid-cols-2 gap-4 text-xs">
                <div>
                  <span className="text-[var(--md-on-surface-variant)]">Current Version</span>
                  <p className="font-mono font-semibold">{changelogData?.currentVersion || '1.0.0'}</p>
                </div>
                <div>
                  <span className="text-[var(--md-on-surface-variant)]">Latest Version</span>
                  <p className="font-mono font-semibold text-[var(--md-primary)]">{changelogData?.version || 'Unknown'}</p>
                </div>
                <div className="col-span-2">
                  <span className="text-[var(--md-on-surface-variant)]">Release Date</span>
                  <p className="font-mono">{changelogData?.releaseDate || 'Unknown'}</p>
                </div>
              </div>
              <div className="pt-2 border-t border-[var(--md-outline-variant)]/30">
                <h4 className="text-xs font-semibold text-[var(--md-on-surface-variant)] mb-2">Release Notes</h4>
                <div className="text-xs text-[var(--md-on-surface)] whitespace-pre-wrap bg-[var(--md-surface-container)] p-3 rounded-lg border border-[var(--md-outline-variant)]/30 max-h-64 overflow-y-auto">
                  {changelogData?.releaseNotes || 'Loading...'}
                </div>
              </div>
              {changelogData && changelogData.version !== changelogData.currentVersion && (
                <div className="pt-2 border-t border-[var(--md-outline-variant)]/30">
                  <a
                    href="https://github.com/feelthevenom/Riri-Player/releases"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-[var(--md-primary)] text-[var(--md-on-primary)] text-xs font-bold cursor-pointer hover:opacity-90"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>View All Releases on GitHub</span>
                  </a>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Right Profile Dropdown & Desktop Window Controls */}
      <div className="flex items-center gap-1 shrink-0">
        <ProfileMenu style={noDrag} />

        <div
          className="h-4 w-px bg-[var(--md-outline-variant)]/50 mx-1 hidden sm:block"
          style={noDrag}
        />

        {renderWindowControls(false)}
      </div>
    </header>
  );
};
