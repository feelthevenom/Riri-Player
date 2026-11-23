import React, { useEffect, useRef, useState } from 'react';
import {
  ChevronRight,
  Disc3,
  Download,
  Heart,
  ListEnd,
  ListPlus,
  Play,
  SkipForward,
  User,
} from 'lucide-react';
import { useRiriPlayer } from '../context/RiriPlayerContext';
import { decorateProxyUrl } from '../utils/ytmClient';

export const TrackContextMenu: React.FC = () => {
  const {
    contextMenu,
    setContextMenu,
    playTrack,
    playNext,
    addToQueue,
    playlists,
    addTrackToPlaylist,
    toggleLike,
    isTrackLiked,
    navigate,
    showToast,
  } = useRiriPlayer();

  const [showPlaylistSubmenu, setShowPlaylistSubmenu] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setShowPlaylistSubmenu(false);
  }, [contextMenu]);

  useEffect(() => {
    if (!contextMenu) return;
    const onPointerDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setContextMenu(null);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setContextMenu(null);
    };
    window.addEventListener('mousedown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('mousedown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [contextMenu, setContextMenu]);

  if (!contextMenu) return null;

  const { track } = contextMenu;
  const liked = isTrackLiked(track.id);
  const userPlaylists = playlists.filter((p) => p.id !== 'pl-liked');

  const vw = typeof window !== 'undefined' ? window.innerWidth : 1280;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 800;
  const clampedX = Math.max(12, Math.min(contextMenu.x, vw - 248));
  const clampedY = Math.max(12, Math.min(contextMenu.y, vh - 430));

  const handleDownload = async () => {
    setContextMenu(null);
    if (!track.streamUrl) {
      showToast('No downloadable stream URL available for this track.', 'error');
      return;
    }
    try {
      const targetUrl =
        track.streamUrl.startsWith('http://') || track.streamUrl.startsWith('https://')
          ? decorateProxyUrl(`/api/proxy-audio?url=${encodeURIComponent(track.streamUrl)}`)
          : decorateProxyUrl(track.streamUrl);
      const a = document.createElement('a');
      a.href = targetUrl;
      a.download = `${track.artist} - ${track.title}.mp3`.replace(/[/\\?%*:|"<>]/g, '_');
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      showToast(`Exporting "${track.title}"...`);
    } catch {
      showToast('Could not download audio file.', 'error');
    }
  };

  return (
    <div
      ref={menuRef}
      role="menu"
      aria-label={`Options for ${track.title}`}
      style={{ left: clampedX, top: clampedY }}
      className="fixed z-50 w-56 rounded-xl border border-[var(--md-outline-variant)] bg-[var(--md-surface-container-high)] p-1.5 shadow-2xl text-sm text-[var(--md-on-surface)]"
    >
      <div className="px-2.5 py-1.5 border-b border-[var(--md-outline-variant)]/40 mb-1">
        <div className="font-semibold truncate text-xs">{track.title}</div>
        <div className="text-[11px] text-[var(--md-on-surface-variant)] truncate">
          {track.artist}
        </div>
      </div>

      <button
        type="button"
        onClick={() => {
          void playTrack(track);
          setContextMenu(null);
        }}
        className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg hover:bg-[var(--md-surface-container-highest)] text-left cursor-pointer"
      >
        <Play className="w-4 h-4 text-[var(--md-primary)]" />
        <span>Play Now</span>
      </button>

      <button
        type="button"
        onClick={() => {
          playNext(track);
          setContextMenu(null);
        }}
        className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg hover:bg-[var(--md-surface-container-highest)] text-left cursor-pointer"
      >
        <SkipForward className="w-4 h-4" />
        <span>Play Next</span>
      </button>

      <button
        type="button"
        onClick={() => {
          addToQueue(track);
          setContextMenu(null);
        }}
        className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg hover:bg-[var(--md-surface-container-highest)] text-left cursor-pointer"
      >
        <ListEnd className="w-4 h-4" />
        <span>Add to Queue</span>
      </button>

      <button
        type="button"
        onClick={() => {
          toggleLike(track.id, track);
          setContextMenu(null);
        }}
        className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg hover:bg-[var(--md-surface-container-highest)] text-left cursor-pointer"
      >
        <Heart className={`w-4 h-4 ${liked ? 'text-[var(--md-primary)] fill-current' : ''}`} />
        <span>{liked ? 'Remove from Liked' : 'Save to Liked Songs'}</span>
      </button>

      <div className="relative">
        <button
          type="button"
          onClick={() => setShowPlaylistSubmenu((v) => !v)}
          className="w-full flex items-center justify-between px-2.5 py-2 rounded-lg hover:bg-[var(--md-surface-container-highest)] text-left cursor-pointer"
        >
          <span className="flex items-center gap-2.5">
            <ListPlus className="w-4 h-4" />
            <span>Add to Playlist</span>
          </span>
          <ChevronRight className="w-3.5 h-3.5" />
        </button>

        {showPlaylistSubmenu && (
          <div className="mt-1 ml-2 rounded-lg border border-[var(--md-outline-variant)]/50 bg-[var(--md-surface-container)] p-1 max-h-40 overflow-y-auto">
            {userPlaylists.length === 0 ? (
              <div className="px-2.5 py-1.5 text-xs text-[var(--md-on-surface-variant)]">
                No custom playlists yet
              </div>
            ) : (
              userPlaylists.map((pl) => (
                <button
                  key={pl.id}
                  type="button"
                  onClick={() => {
                    addTrackToPlaylist(pl.id, track);
                    setContextMenu(null);
                  }}
                  className="w-full truncate px-2.5 py-1.5 rounded-md text-xs text-left hover:bg-[var(--md-surface-container-highest)] cursor-pointer"
                >
                  {pl.name}
                </button>
              ))
            )}
          </div>
        )}
      </div>

      <div className="my-1 border-t border-[var(--md-outline-variant)]/40" />

      <button
        type="button"
        onClick={() => {
          navigate('artist', track.artist);
          setContextMenu(null);
        }}
        className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg hover:bg-[var(--md-surface-container-highest)] text-left cursor-pointer"
      >
        <User className="w-4 h-4" />
        <span>View Artist</span>
      </button>

      <button
        type="button"
        onClick={() => {
          navigate('album', track.album);
          setContextMenu(null);
        }}
        className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg hover:bg-[var(--md-surface-container-highest)] text-left cursor-pointer"
      >
        <Disc3 className="w-4 h-4" />
        <span>View Album</span>
      </button>

      <button
        type="button"
        onClick={() => void handleDownload()}
        className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg hover:bg-[var(--md-surface-container-highest)] text-left cursor-pointer"
      >
        <Download className="w-4 h-4" />
        <span>Download / Export</span>
      </button>
    </div>
  );
};
