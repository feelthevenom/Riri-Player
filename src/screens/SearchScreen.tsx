import React, { useEffect, useMemo, useState } from 'react';
import {
  Clock,
  Disc,
  History,
  ListMusic,
  Loader2,
  Mic2,
  Music,
  Play,
  Search,
  Trash2,
  User,
  X,
} from 'lucide-react';
import { useRiriPlayer } from '../context/RiriPlayerContext';
import { FALLBACK_ARTWORK_DATA_URL } from '../data/catalog';
import { Track, YtMusicBrowseItem } from '../types/music';
import { SortableTrackTable } from '../components/SortableTrackTable';

type SearchCategory = 'all' | 'songs' | 'albums' | 'artists' | 'playlists';

export const SearchScreen: React.FC = () => {
  const {
    globalSearchQuery,
    setGlobalSearchQuery,
    searchOnlineTracks,
    searchYtMusicFull,
    fetchSearchSuggestions,
    tracks,
    searchHistory,
    recordSearchQuery,
    clearSearchHistory,
    playTrack,
    openYtMusicBrowse,
    navigate,
    settings,
  } = useRiriPlayer();

  const [category, setCategory] = useState<SearchCategory>('all');
  const [resultTracks, setResultTracks] = useState<Track[]>([]);
  const [resultCards, setResultCards] = useState<YtMusicBrowseItem[]>([]);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [suggestedItems, setSuggestedItems] = useState<YtMusicBrowseItem[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [searching, setSearching] = useState(false);

  // Auto-fetch suggestions (queries + recommended items)
  useEffect(() => {
    const q = globalSearchQuery.trim();
    if (!q) {
      setSuggestions([]);
      setSuggestedItems([]);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void fetchSearchSuggestions(q).then((res) => {
        if (!cancelled) {
          setSuggestions(res.queries || []);
          setSuggestedItems(res.items || []);
        }
      });
    }, 180);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [fetchSearchSuggestions, globalSearchQuery]);

  // Execute full search when query or category changes
  useEffect(() => {
    const q = globalSearchQuery.trim();
    if (!q) {
      setResultTracks([]);
      setResultCards([]);
      setSearching(false);
      return;
    }

    let cancelled = false;
    setSearching(true);
    const timer = window.setTimeout(() => {
      void searchYtMusicFull(q, category).then((res) => {
        if (!cancelled) {
          setResultTracks(res.tracks || []);
          setResultCards(res.cards || []);
          setSearching(false);
        }
      });
    }, 280);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [category, globalSearchQuery, searchYtMusicFull]);

  // Split cards by kind for "all" tab
  const { topResultCard, albumCards, artistCards, playlistCards } = useMemo(() => {
    let top: YtMusicBrowseItem | null = null;
    const albums: YtMusicBrowseItem[] = [];
    const artists: YtMusicBrowseItem[] = [];
    const playlists: YtMusicBrowseItem[] = [];

    for (const card of resultCards) {
      if (!top && (card.subtitle?.toLowerCase().includes('top result') || card.id.startsWith('top-'))) {
        top = card;
        continue;
      }
      if (card.kind === 'album') albums.push(card);
      else if (card.kind === 'artist') artists.push(card);
      else if (card.kind === 'playlist') playlists.push(card);
    }

    // If no explicit top result card, use the first artist or first album
    if (!top) {
      if (artists.length > 0) top = artists[0];
      else if (albums.length > 0) top = albums[0];
      else if (resultTracks.length > 0) {
        top = {
          id: resultTracks[0].id,
          kind: 'song',
          title: resultTracks[0].title,
          subtitle: `Song • ${resultTracks[0].artist}`,
          thumbnailUrl: resultTracks[0].thumbnailUrl,
          videoId: resultTracks[0].ytMusicVideoId,
          track: resultTracks[0],
        };
      }
    }

    return {
      topResultCard: top,
      albumCards: albums,
      artistCards: artists,
      playlistCards: playlists,
    };
  }, [resultCards, resultTracks]);

  const handleCardClick = (card: YtMusicBrowseItem) => {
    if (card.track) {
      void playTrack(card.track);
      return;
    }
    if (card.videoId) {
      const pseudoTrack: Track = {
        id: `ytm-${card.videoId}`,
        title: card.title,
        artist: card.subtitle || 'YouTube Music',
        album: 'YouTube Music',
        durationSec: 180,
        thumbnailUrl: card.thumbnailUrl || FALLBACK_ARTWORK_DATA_URL,
        streamUrl: `/api/ytmusic/stream?videoId=${card.videoId}&title=${encodeURIComponent(card.title)}&artist=${encodeURIComponent(card.subtitle || '')}`,
        ytMusicVideoId: card.videoId,
        genre: 'YouTube Music',
        qualityLabel: 'YTM AAC',
        source: 'ytmusic',
      };
      void playTrack(pseudoTrack);
      return;
    }
    if (card.kind === 'artist') {
      navigate('artist', card.title);
      return;
    }
    if (card.browseId) {
      void openYtMusicBrowse(card.browseId, card.title, card.params);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setShowSuggestions(false);
    if (globalSearchQuery.trim()) {
      recordSearchQuery(globalSearchQuery.trim());
    }
  };

  const handleSelectQuery = (text: string) => {
    setGlobalSearchQuery(text);
    recordSearchQuery(text);
    setShowSuggestions(false);
  };

  return (
    <div className="space-y-6 pb-12 max-w-7xl mx-auto">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight">Search</h1>
        <p className="text-xs text-[var(--md-on-surface-variant)] mt-0.5">
          Fast online search with live auto-suggestions for songs, artists, albums, and playlists
        </p>
      </div>

      {/* Search Input Bar with Rich Popup Suggestions */}
      <div className="relative">
        <form onSubmit={handleSubmit} className="flex gap-2">
          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--md-on-surface-variant)]" />
            <input
              type="search"
              aria-label="Search music catalog"
              placeholder="Search songs, artists, albums, or playlists..."
              value={globalSearchQuery}
              onFocus={() => setShowSuggestions(true)}
              onBlur={() => {
                window.setTimeout(() => setShowSuggestions(false), 220);
              }}
              onChange={(e) => {
                setGlobalSearchQuery(e.target.value);
                setShowSuggestions(true);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setShowSuggestions(false);
              }}
              className="w-full h-11 pl-10 pr-10 rounded-xl border border-[var(--md-outline-variant)] bg-[var(--md-surface-container)] text-sm focus:outline-none focus:border-[var(--md-primary)] transition-colors"
            />
            {globalSearchQuery && (
              <button
                type="button"
                onClick={() => setGlobalSearchQuery('')}
                className="absolute right-3.5 top-1/2 -translate-y-1/2 text-[var(--md-on-surface-variant)] hover:text-[var(--md-on-surface)] cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
          <button
            type="submit"
            className="px-5 h-11 rounded-xl bg-[var(--md-primary)] text-[var(--md-on-primary)] text-xs font-semibold cursor-pointer whitespace-nowrap shadow-md hover:opacity-90 transition-opacity"
          >
            Search
          </button>
        </form>

        {/* Rich Auto-Suggestions Dropdown */}
        {showSuggestions && (
          <div
            role="listbox"
            aria-label="Search suggestions"
            className="absolute left-0 right-0 top-12 z-40 rounded-xl border border-[var(--md-outline-variant)] bg-[var(--md-surface-container-high)] shadow-2xl overflow-hidden divide-y divide-[var(--md-outline-variant)]/20 animate-in fade-in slide-in-from-top-1 duration-150"
          >
            {/* 1. Recommended Entity Items (Artists, Albums, Songs) */}
            {suggestedItems.length > 0 && (
              <div className="p-2 space-y-1 bg-[var(--md-surface-container)]/50">
                <div className="px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-[var(--md-primary)]">
                  Top Results
                </div>
                {suggestedItems.map((item) => {
                  const isArtist = item.kind === 'artist';
                  return (
                    <button
                      key={`sug-item-${item.id}`}
                      type="button"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        setShowSuggestions(false);
                        handleCardClick(item);
                      }}
                      className="w-full flex items-center gap-3 px-2.5 py-2 rounded-lg text-left hover:bg-[var(--md-surface-container-highest)] cursor-pointer transition-colors"
                    >
                      <img
                        src={item.thumbnailUrl || FALLBACK_ARTWORK_DATA_URL}
                        alt={item.title}
                        referrerPolicy="no-referrer"
                        onError={(e) => {
                          e.currentTarget.src = FALLBACK_ARTWORK_DATA_URL;
                        }}
                        className={`w-9 h-9 object-cover shrink-0 shadow-sm ${
                          isArtist ? 'rounded-full' : 'rounded-md'
                        }`}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="text-xs font-semibold truncate text-[var(--md-on-surface)]">
                          {item.title}
                        </div>
                        <div className="text-[11px] text-[var(--md-on-surface-variant)] truncate">
                          {item.subtitle || (isArtist ? 'Artist' : item.kind === 'album' ? 'Album' : 'Song')}
                        </div>
                      </div>
                      {item.kind === 'song' ? (
                        <Play className="w-3.5 h-3.5 text-[var(--md-primary)] shrink-0 fill-current" />
                      ) : (
                        <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-[var(--md-surface-container)] text-[var(--md-on-surface-variant)] shrink-0 capitalize">
                          {item.kind}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}

            {/* 2. Text Query Suggestions */}
            {suggestions.length > 0 && (
              <div className="p-1.5 space-y-0.5">
                {suggestions.map((q) => (
                  <button
                    key={`sug-query-${q}`}
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      handleSelectQuery(q);
                    }}
                    className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-left text-xs hover:bg-[var(--md-primary-container)]/30 text-[var(--md-on-surface)] cursor-pointer transition-colors"
                  >
                    <Search className="w-3.5 h-3.5 text-[var(--md-on-surface-variant)] shrink-0" />
                    <span className="truncate flex-1">{q}</span>
                  </button>
                ))}
              </div>
            )}

            {/* 3. Recent Search History (shown when query is empty or partially matching) */}
            {searchHistory.length > 0 && suggestions.length === 0 && (
              <div className="p-2 space-y-1">
                <div className="flex items-center justify-between px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-[var(--md-on-surface-variant)]">
                  <span>Recent Searches</span>
                  <button
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      clearSearchHistory();
                    }}
                    className="hover:text-red-400 cursor-pointer flex items-center gap-1 normal-case tracking-normal"
                  >
                    <Trash2 className="w-3 h-3" />
                    <span>Clear</span>
                  </button>
                </div>
                {searchHistory.slice(0, 6).map((term) => (
                  <button
                    key={`hist-${term}`}
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      handleSelectQuery(term);
                    }}
                    className="w-full flex items-center gap-2.5 px-3 py-1.5 rounded-lg text-left text-xs hover:bg-[var(--md-surface-container-highest)] text-[var(--md-on-surface)] cursor-pointer"
                  >
                    <History className="w-3.5 h-3.5 text-[var(--md-on-surface-variant)] shrink-0" />
                    <span className="truncate flex-1">{term}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Category Filter Chips */}
      <div className="flex flex-wrap items-center gap-2" role="tablist" aria-label="Search filter chips">
        {(
          [
            { id: 'all', label: 'All', icon: Search },
            { id: 'songs', label: 'Songs', icon: Music },
            { id: 'albums', label: 'Albums', icon: Disc },
            { id: 'artists', label: 'Artists', icon: User },
            { id: 'playlists', label: 'Playlists', icon: ListMusic },
          ] as Array<{ id: SearchCategory; label: string; icon: React.FC<{ className?: string }> }>
        ).map((item) => {
          const Icon = item.icon;
          const active = category === item.id;
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setCategory(item.id)}
              className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer ${
                active
                  ? 'bg-[var(--md-primary)] text-[var(--md-on-primary)] shadow-sm'
                  : 'bg-[var(--md-surface-container-high)] text-[var(--md-on-surface-variant)] hover:text-[var(--md-on-surface)]'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{item.label}</span>
            </button>
          );
        })}
      </div>

      {/* Search Results Display */}
      {searching ? (
        <div className="flex items-center gap-2.5 py-12 text-xs text-[var(--md-on-surface-variant)]">
          <Loader2 className="w-4 h-4 animate-spin text-[var(--md-primary)]" />
          <span>Searching for &ldquo;{globalSearchQuery}&rdquo;...</span>
        </div>
      ) : globalSearchQuery.trim() ? (
        <div className="space-y-8">
          {category === 'all' ? (
            /* ── ALL VIEW: Top Result Spotlight + Songs + Albums + Artists + Playlists ── */
            <>
              {/* Top Result Card */}
              {topResultCard && (
                <section aria-label="Top Result">
                  <h2 className="text-sm font-bold uppercase tracking-wider text-[var(--md-primary)] mb-3">
                    Top Result
                  </h2>
                  <div className="at-glass-card group flex flex-col sm:flex-row items-start sm:items-center gap-5 p-5 rounded-2xl border border-[var(--md-outline-variant)]/40 bg-[var(--md-surface-container)] hover:bg-[var(--md-surface-container-high)] transition-all max-w-xl">
                    <div
                      className={`relative w-24 h-24 overflow-hidden shrink-0 shadow-md ${
                        topResultCard.kind === 'artist' ? 'rounded-full' : 'rounded-xl'
                      }`}
                    >
                      <img
                        src={topResultCard.thumbnailUrl || FALLBACK_ARTWORK_DATA_URL}
                        alt={topResultCard.title}
                        referrerPolicy="no-referrer"
                        onError={(e) => {
                          e.currentTarget.src = FALLBACK_ARTWORK_DATA_URL;
                        }}
                        className="w-full h-full object-cover"
                      />
                    </div>
                    <div className="min-w-0 flex-1">
                      <span className="inline-block text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-[var(--md-primary-container)] text-[var(--md-on-primary-container)] mb-1.5">
                        {topResultCard.kind}
                      </span>
                      <h3 className="text-lg font-bold truncate text-[var(--md-on-surface)]">
                        {topResultCard.title}
                      </h3>
                      <p className="text-xs text-[var(--md-on-surface-variant)] truncate mt-0.5">
                        {topResultCard.subtitle || (topResultCard.kind === 'artist' ? 'Artist' : 'Collection')}
                      </p>
                      <div className="mt-3.5">
                        <button
                          type="button"
                          onClick={() => handleCardClick(topResultCard!)}
                          className="flex items-center gap-2 px-4 py-1.5 rounded-full bg-[var(--md-primary)] text-[var(--md-on-primary)] text-xs font-semibold cursor-pointer hover:opacity-90 transition-opacity shadow-sm"
                        >
                          <Play className="w-3.5 h-3.5 fill-current ml-0.5" />
                          <span>{topResultCard.kind === 'song' ? 'Play Now' : 'Explore'}</span>
                        </button>
                      </div>
                    </div>
                  </div>
                </section>
              )}

              {/* Songs Section */}
              {resultTracks.length > 0 && (
                <section aria-label="Songs" className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h2 className="text-lg font-bold">Songs</h2>
                    <button
                      type="button"
                      onClick={() => setCategory('songs')}
                      className="text-xs font-semibold text-[var(--md-primary)] hover:underline cursor-pointer"
                    >
                      See all songs
                    </button>
                  </div>
                  <SortableTrackTable
                    tracks={resultTracks.slice(0, 5)}
                    emptyMessage="No songs found."
                  />
                </section>
              )}

              {/* Albums Section */}
              {albumCards.length > 0 && (
                <section aria-label="Albums" className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h2 className="text-lg font-bold">Albums</h2>
                    <button
                      type="button"
                      onClick={() => setCategory('albums')}
                      className="text-xs font-semibold text-[var(--md-primary)] hover:underline cursor-pointer"
                    >
                      See all albums
                    </button>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3.5">
                    {albumCards.slice(0, 6).map((album) => (
                      <button
                        key={album.id}
                        type="button"
                        onClick={() => handleCardClick(album)}
                        className="at-glass-card group text-left rounded-xl bg-[var(--md-surface-container-low)] hover:bg-[var(--md-surface-container-high)] p-3 border border-[var(--md-outline-variant)]/30 transition-all cursor-pointer flex flex-col"
                      >
                        <div className="aspect-square w-full rounded-lg overflow-hidden mb-2 bg-[var(--md-surface-container)] relative shadow-sm">
                          <img
                            src={album.thumbnailUrl || FALLBACK_ARTWORK_DATA_URL}
                            alt={album.title}
                            referrerPolicy="no-referrer"
                            onError={(e) => {
                              e.currentTarget.src = FALLBACK_ARTWORK_DATA_URL;
                            }}
                            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                          />
                          <span className="absolute bottom-2 right-2 w-8 h-8 rounded-full bg-[var(--md-primary)] text-[var(--md-on-primary)] flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow-lg">
                            <Play className="w-3.5 h-3.5 fill-current ml-0.5" />
                          </span>
                        </div>
                        <div className="text-xs font-semibold truncate w-full">{album.title}</div>
                        <div className="text-[11px] text-[var(--md-on-surface-variant)] truncate w-full mt-0.5">
                          {album.subtitle || 'Album'}
                        </div>
                      </button>
                    ))}
                  </div>
                </section>
              )}

              {/* Artists Section */}
              {artistCards.length > 0 && (
                <section aria-label="Artists" className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h2 className="text-lg font-bold">Artists</h2>
                    <button
                      type="button"
                      onClick={() => setCategory('artists')}
                      className="text-xs font-semibold text-[var(--md-primary)] hover:underline cursor-pointer"
                    >
                      See all artists
                    </button>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3.5">
                    {artistCards.slice(0, 6).map((artist) => (
                      <button
                        key={artist.id}
                        type="button"
                        onClick={() => handleCardClick(artist)}
                        className="at-glass-card group text-center rounded-xl bg-[var(--md-surface-container-low)] hover:bg-[var(--md-surface-container-high)] p-3 border border-[var(--md-outline-variant)]/30 transition-all cursor-pointer flex flex-col items-center"
                      >
                        <div className="w-24 h-24 rounded-full overflow-hidden mb-2.5 bg-[var(--md-surface-container)] relative shadow-sm">
                          <img
                            src={artist.thumbnailUrl || FALLBACK_ARTWORK_DATA_URL}
                            alt={artist.title}
                            referrerPolicy="no-referrer"
                            onError={(e) => {
                              e.currentTarget.src = FALLBACK_ARTWORK_DATA_URL;
                            }}
                            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                          />
                        </div>
                        <div className="text-xs font-semibold truncate w-full">{artist.title}</div>
                        <div className="text-[11px] text-[var(--md-on-surface-variant)] truncate w-full mt-0.5">
                          {artist.subtitle || 'Artist'}
                        </div>
                      </button>
                    ))}
                  </div>
                </section>
              )}

              {/* Playlists Section */}
              {playlistCards.length > 0 && (
                <section aria-label="Playlists" className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h2 className="text-lg font-bold">Playlists</h2>
                    <button
                      type="button"
                      onClick={() => setCategory('playlists')}
                      className="text-xs font-semibold text-[var(--md-primary)] hover:underline cursor-pointer"
                    >
                      See all playlists
                    </button>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3.5">
                    {playlistCards.slice(0, 6).map((pl) => (
                      <button
                        key={pl.id}
                        type="button"
                        onClick={() => handleCardClick(pl)}
                        className="at-glass-card group text-left rounded-xl bg-[var(--md-surface-container-low)] hover:bg-[var(--md-surface-container-high)] p-3 border border-[var(--md-outline-variant)]/30 transition-all cursor-pointer flex flex-col"
                      >
                        <div className="aspect-square w-full rounded-lg overflow-hidden mb-2 bg-[var(--md-surface-container)] relative shadow-sm">
                          <img
                            src={pl.thumbnailUrl || FALLBACK_ARTWORK_DATA_URL}
                            alt={pl.title}
                            referrerPolicy="no-referrer"
                            onError={(e) => {
                              e.currentTarget.src = FALLBACK_ARTWORK_DATA_URL;
                            }}
                            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                          />
                          <span className="absolute bottom-2 right-2 w-8 h-8 rounded-full bg-[var(--md-primary)] text-[var(--md-on-primary)] flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow-lg">
                            <Play className="w-3.5 h-3.5 fill-current ml-0.5" />
                          </span>
                        </div>
                        <div className="text-xs font-semibold truncate w-full">{pl.title}</div>
                        <div className="text-[11px] text-[var(--md-on-surface-variant)] truncate w-full mt-0.5">
                          {pl.subtitle || 'Playlist'}
                        </div>
                      </button>
                    ))}
                  </div>
                </section>
              )}
            </>
          ) : category === 'songs' ? (
            /* ── FULL SONGS VIEW ── */
            <section aria-label="All Songs" className="space-y-3">
              <div className="text-xs font-semibold text-[var(--md-on-surface-variant)]">
                {resultTracks.length} song(s) found
              </div>
              <SortableTrackTable
                tracks={resultTracks}
                emptyMessage={`No songs matched "${globalSearchQuery}".`}
              />
            </section>
          ) : category === 'albums' ? (
            /* ── FULL ALBUMS VIEW ── */
            <section aria-label="All Albums" className="space-y-3">
              <div className="text-xs font-semibold text-[var(--md-on-surface-variant)]">
                {resultCards.length} album(s) found
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3.5">
                {resultCards.map((album) => (
                  <button
                    key={album.id}
                    type="button"
                    onClick={() => handleCardClick(album)}
                    className="at-glass-card group text-left rounded-xl bg-[var(--md-surface-container-low)] hover:bg-[var(--md-surface-container-high)] p-3 border border-[var(--md-outline-variant)]/30 transition-all cursor-pointer flex flex-col"
                  >
                    <div className="aspect-square w-full rounded-lg overflow-hidden mb-2 bg-[var(--md-surface-container)] relative shadow-sm">
                      <img
                        src={album.thumbnailUrl || FALLBACK_ARTWORK_DATA_URL}
                        alt={album.title}
                        referrerPolicy="no-referrer"
                        onError={(e) => {
                          e.currentTarget.src = FALLBACK_ARTWORK_DATA_URL;
                        }}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                      />
                      <span className="absolute bottom-2 right-2 w-8 h-8 rounded-full bg-[var(--md-primary)] text-[var(--md-on-primary)] flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow-lg">
                        <Play className="w-3.5 h-3.5 fill-current ml-0.5" />
                      </span>
                    </div>
                    <div className="text-xs font-semibold truncate w-full">{album.title}</div>
                    <div className="text-[11px] text-[var(--md-on-surface-variant)] truncate w-full mt-0.5">
                      {album.subtitle || 'Album'}
                    </div>
                  </button>
                ))}
              </div>
            </section>
          ) : category === 'artists' ? (
            /* ── FULL ARTISTS VIEW ── */
            <section aria-label="All Artists" className="space-y-3">
              <div className="text-xs font-semibold text-[var(--md-on-surface-variant)]">
                {resultCards.length} artist(s) found
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3.5">
                {resultCards.map((artist) => (
                  <button
                    key={artist.id}
                    type="button"
                    onClick={() => handleCardClick(artist)}
                    className="at-glass-card group text-center rounded-xl bg-[var(--md-surface-container-low)] hover:bg-[var(--md-surface-container-high)] p-3 border border-[var(--md-outline-variant)]/30 transition-all cursor-pointer flex flex-col items-center"
                  >
                    <div className="w-24 h-24 rounded-full overflow-hidden mb-2.5 bg-[var(--md-surface-container)] relative shadow-sm">
                      <img
                        src={artist.thumbnailUrl || FALLBACK_ARTWORK_DATA_URL}
                        alt={artist.title}
                        referrerPolicy="no-referrer"
                        onError={(e) => {
                          e.currentTarget.src = FALLBACK_ARTWORK_DATA_URL;
                        }}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                      />
                    </div>
                    <div className="text-xs font-semibold truncate w-full">{artist.title}</div>
                    <div className="text-[11px] text-[var(--md-on-surface-variant)] truncate w-full mt-0.5">
                      {artist.subtitle || 'Artist'}
                    </div>
                  </button>
                ))}
              </div>
            </section>
          ) : (
            /* ── FULL PLAYLISTS VIEW ── */
            <section aria-label="All Playlists" className="space-y-3">
              <div className="text-xs font-semibold text-[var(--md-on-surface-variant)]">
                {resultCards.length} playlist(s) found
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3.5">
                {resultCards.map((pl) => (
                  <button
                    key={pl.id}
                    type="button"
                    onClick={() => handleCardClick(pl)}
                    className="at-glass-card group text-left rounded-xl bg-[var(--md-surface-container-low)] hover:bg-[var(--md-surface-container-high)] p-3 border border-[var(--md-outline-variant)]/30 transition-all cursor-pointer flex flex-col"
                  >
                    <div className="aspect-square w-full rounded-lg overflow-hidden mb-2 bg-[var(--md-surface-container)] relative shadow-sm">
                      <img
                        src={pl.thumbnailUrl || FALLBACK_ARTWORK_DATA_URL}
                        alt={pl.title}
                        referrerPolicy="no-referrer"
                        onError={(e) => {
                          e.currentTarget.src = FALLBACK_ARTWORK_DATA_URL;
                        }}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                      />
                      <span className="absolute bottom-2 right-2 w-8 h-8 rounded-full bg-[var(--md-primary)] text-[var(--md-on-primary)] flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow-lg">
                        <Play className="w-3.5 h-3.5 fill-current ml-0.5" />
                      </span>
                    </div>
                    <div className="text-xs font-semibold truncate w-full">{pl.title}</div>
                    <div className="text-[11px] text-[var(--md-on-surface-variant)] truncate w-full mt-0.5">
                      {pl.subtitle || 'Playlist'}
                    </div>
                  </button>
                ))}
              </div>
            </section>
          )}
        </div>
      ) : (
        <div className="at-glass-card rounded-2xl border border-[var(--md-outline-variant)]/40 bg-[var(--md-surface-container-low)] p-12 text-center text-sm text-[var(--md-on-surface-variant)]">
          <Search className="w-8 h-8 mx-auto mb-3 opacity-40 text-[var(--md-primary)]" />
          <p className="font-medium text-[var(--md-on-surface)]">Search YouTube Music &amp; Local Audio</p>
          <p className="text-xs mt-1">
            Type an artist, song, album, or playlist above or press <span className="font-mono bg-[var(--md-surface-container-high)] px-1.5 py-0.5 rounded">Ctrl+K</span>
          </p>
        </div>
      )}
    </div>
  );
};
