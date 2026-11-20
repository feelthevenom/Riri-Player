import React, { useEffect, useMemo, useState } from 'react';
import { History, Loader2, Search, Trash2 } from 'lucide-react';
import { useRiriPlayer } from '../context/RiriPlayerContext';
import { Track } from '../types/music';
import { SortableTrackTable } from '../components/SortableTrackTable';

type SearchScope = 'ALL' | 'YTMUSIC' | 'DISCOVERY' | 'LOCAL' | 'PLUGINS';
type YtmSubFilter = 'songs' | 'videos' | 'albums' | 'playlists' | 'artists';

export const SearchScreen: React.FC = () => {
  const {
    globalSearchQuery,
    setGlobalSearchQuery,
    searchOnlineTracks,
    searchYtMusicTracks,
    fetchSearchSuggestions,
    tracks,
    searchHistory,
    recordSearchQuery,
    clearSearchHistory,
    plugins,
    settings,
  } = useRiriPlayer();

  const [scope, setScope] = useState<SearchScope>('ALL');
  const [ytmFilter, setYtmFilter] = useState<YtmSubFilter>('songs');
  const [results, setResults] = useState<Track[]>([]);
  const [ytmResults, setYtmResults] = useState<Track[]>([]);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [searching, setSearching] = useState(false);

  const localMatches = useMemo(() => {
    const q = globalSearchQuery.trim().toLowerCase();
    if (!q) return [];
    return tracks.filter(
      (t) =>
        t.source === 'local' &&
        (t.title.toLowerCase().includes(q) ||
          t.artist.toLowerCase().includes(q) ||
          t.album.toLowerCase().includes(q)),
    );
  }, [globalSearchQuery, tracks]);

  useEffect(() => {
    const q = globalSearchQuery.trim();
    if (!q) {
      setSuggestions([]);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void fetchSearchSuggestions(q).then((list) => {
        if (!cancelled) setSuggestions(list);
      });
    }, 180);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [fetchSearchSuggestions, globalSearchQuery]);

  useEffect(() => {
    const q = globalSearchQuery.trim();
    if (!q) {
      setResults([]);
      setYtmResults([]);
      setSearching(false);
      return;
    }

    let cancelled = false;
    setSearching(true);
    const timer = window.setTimeout(() => {
      const task =
        scope === 'YTMUSIC'
          ? searchYtMusicTracks(q, ytmFilter).then((fetched) => {
              if (!cancelled) {
                setYtmResults(fetched);
                setSearching(false);
              }
            })
          : searchOnlineTracks(q).then((fetched) => {
              if (!cancelled) {
                setResults(fetched);
                setSearching(false);
              }
            });
      void task;
    }, 300);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [globalSearchQuery, scope, searchOnlineTracks, searchYtMusicTracks, ytmFilter]);

  const combinedResults = useMemo(() => {
    if (scope === 'YTMUSIC') return ytmResults;
    if (scope === 'LOCAL') return localMatches;
    if (scope === 'PLUGINS') return results.filter((t) => t.source === 'plugin');
    if (scope === 'DISCOVERY') {
      return results.filter((t) => t.source === 'online');
    }

    const seen = new Set<string>();
    const all: Track[] = [];
    for (const item of [...localMatches, ...results]) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      all.push(item);
    }
    return all;
  }, [localMatches, results, scope, ytmResults]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setShowSuggestions(false);
    if (globalSearchQuery.trim()) {
      recordSearchQuery(globalSearchQuery);
    }
  };

  const enabledPluginCount = plugins.filter((p) => p.enabled).length;

  return (
    <div className="space-y-6 pb-8">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight">Search</h1>
        <p className="text-xs text-[var(--md-on-surface-variant)]">
          Searching {settings.ytMusicEnabled ? `YouTube Music (${settings.contentRegion}), ` : ''}iTunes, Audius
          Discovery, Local Library
          {enabledPluginCount > 0 ? `, and ${enabledPluginCount} active .arch plugin(s)` : ''}
        </p>
      </div>

      <form onSubmit={handleSubmit} className="flex gap-2 relative">
        <div className="relative flex-1">
          <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--md-on-surface-variant)]" />
          <input
            type="search"
            aria-label="Search music catalog"
            placeholder="Search songs, artists, albums, or YouTube Music..."
            value={globalSearchQuery}
            onFocus={() => setShowSuggestions(true)}
            onBlur={() => {
              window.setTimeout(() => setShowSuggestions(false), 160);
            }}
            onChange={(e) => {
              setGlobalSearchQuery(e.target.value);
              setShowSuggestions(true);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setShowSuggestions(false);
            }}
            className="w-full h-11 pl-10 pr-4 rounded-xl border border-[var(--md-outline-variant)] bg-[var(--md-surface-container)] text-sm focus:outline-none focus:border-[var(--md-primary)]"
          />

          {showSuggestions && suggestions.length > 0 && globalSearchQuery.trim().length > 0 && (
            <div
              role="listbox"
              aria-label="Search suggestions"
              className="absolute left-0 right-0 top-12 z-30 rounded-xl border border-[var(--md-outline-variant)] bg-[var(--md-surface-container-high)] shadow-2xl overflow-hidden"
            >
              {suggestions.map((item) => (
                <button
                  key={item}
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    setGlobalSearchQuery(item);
                    recordSearchQuery(item);
                    setShowSuggestions(false);
                  }}
                  className="w-full flex items-center gap-2.5 px-3.5 py-2 text-left text-xs hover:bg-[var(--md-primary-container)]/35 cursor-pointer"
                >
                  <Search className="w-3.5 h-3.5 text-[var(--md-primary)] shrink-0" />
                  <span className="truncate">{item}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <button
          type="submit"
          className="px-5 h-11 rounded-xl bg-[var(--md-primary)] text-[var(--md-on-primary)] text-xs font-semibold cursor-pointer whitespace-nowrap"
        >
          Search
        </button>
      </form>

      {/* Source & YouTube Music Filter Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1.5" role="tablist" aria-label="Search source filter">
          {(
            [
              { id: 'ALL', label: 'All Sources' },
              { id: 'YTMUSIC', label: 'YouTube Music' },
              { id: 'DISCOVERY', label: 'Audius & iTunes' },
              { id: 'LOCAL', label: 'Local Files' },
              { id: 'PLUGINS', label: '.arch Plugins' },
            ] as Array<{ id: SearchScope; label: string }>
          ).map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={scope === item.id}
              onClick={() => setScope(item.id)}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer ${
                scope === item.id
                  ? 'bg-[var(--md-primary)] text-[var(--md-on-primary)]'
                  : 'bg-[var(--md-surface-container-high)] text-[var(--md-on-surface-variant)] hover:text-[var(--md-on-surface)]'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>

        {scope === 'YTMUSIC' && (
          <div className="flex flex-wrap items-center gap-1.5">
            {(['songs', 'videos', 'albums', 'playlists', 'artists'] as YtmSubFilter[]).map((sub) => (
              <button
                key={sub}
                type="button"
                onClick={() => setYtmFilter(sub)}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold capitalize whitespace-nowrap cursor-pointer ${
                  ytmFilter === sub
                    ? 'bg-[var(--md-primary-container)] text-[var(--md-on-primary-container)]'
                    : 'bg-[var(--md-surface-container-low)] text-[var(--md-on-surface-variant)]'
                }`}
              >
                {sub}
              </button>
            ))}
          </div>
        )}
      </div>

      {searchHistory.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs text-[var(--md-on-surface-variant)]">
            <span className="flex items-center gap-1.5 font-semibold">
              <History className="w-3.5 h-3.5" />
              Recent Searches
            </span>
            <button
              type="button"
              onClick={clearSearchHistory}
              className="flex items-center gap-1 hover:text-red-400 cursor-pointer"
            >
              <Trash2 className="w-3 h-3" />
              Clear
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            {searchHistory.map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => setGlobalSearchQuery(item)}
                className="px-3 py-1 rounded-xl text-xs bg-[var(--md-surface-container-high)] hover:bg-[var(--md-surface-container-highest)] cursor-pointer"
              >
                {item}
              </button>
            ))}
          </div>
        </div>
      )}

      {searching ? (
        <div className="flex items-center gap-2 py-8 text-xs text-[var(--md-on-surface-variant)]">
          <Loader2 className="w-4 h-4 animate-spin text-[var(--md-primary)]" />
          <span>
            Searching {scope === 'YTMUSIC' ? `YouTube Music (${ytmFilter})` : 'online streams & plugins'} for &ldquo;{globalSearchQuery}&rdquo;...
          </span>
        </div>
      ) : globalSearchQuery.trim() ? (
        <div className="space-y-3">
          <div className="text-xs font-semibold text-[var(--md-on-surface-variant)]">
            {combinedResults.length} result(s) for &ldquo;{globalSearchQuery}&rdquo;
          </div>
          <SortableTrackTable
            tracks={combinedResults}
            emptyMessage={`No tracks matched "${globalSearchQuery}" in this filter.`}
          />
        </div>
      ) : (
        <div className="at-glass-card rounded-2xl border border-[var(--md-outline-variant)]/40 bg-[var(--md-surface-container-low)] p-10 text-center text-sm text-[var(--md-on-surface-variant)]">
          Start typing above or press <span className="font-mono">Ctrl+K</span> anywhere to search
          YouTube Music, Audius, iTunes, and local files — with zero API keys required.
        </div>
      )}
    </div>
  );
};
