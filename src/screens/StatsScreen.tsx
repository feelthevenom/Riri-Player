import React, { useMemo, useState } from 'react';
import { BarChart3, Clock, Disc3, Play, User } from 'lucide-react';
import { useArchiveTune } from '../context/ArchiveTuneContext';
import { StatPeriod } from '../types/music';
import { computeListeningStats } from '../utils/trackSorting';
import { FALLBACK_ARTWORK_DATA_URL } from '../data/catalog';

const PERIODS: Array<{ id: StatPeriod; label: string }> = [
  { id: 'WEEK_1', label: '7 Days' },
  { id: 'MONTH_1', label: '1 Month' },
  { id: 'MONTH_3', label: '3 Months' },
  { id: 'MONTH_6', label: '6 Months' },
  { id: 'YEAR_1', label: '1 Year' },
  { id: 'ALL', label: 'All Time' },
];

export const StatsScreen: React.FC = () => {
  const { playEvents, tracks, homeTracks, playTrack, navigate } = useArchiveTune();
  const [period, setPeriod] = useState<StatPeriod>('ALL');

  const stats = useMemo(
    () => computeListeningStats(playEvents, period),
    [playEvents, period],
  );

  const maxSlot = Math.max(1, ...stats.slots);
  const slotLabels = ['Night (00–06)', 'Morning (06–12)', 'Afternoon (12–18)', 'Evening (18–24)'];

  return (
    <div className="space-y-6 pb-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <BarChart3 className="w-6 h-6 text-[var(--md-primary)]" />
            <span>Listening Analytics</span>
          </h1>
          <p className="text-xs text-[var(--md-on-surface-variant)]">
            Computed locally from your real playback history
          </p>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {PERIODS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setPeriod(p.id)}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold cursor-pointer ${
                period === p.id
                  ? 'bg-[var(--md-primary)] text-[var(--md-on-primary)]'
                  : 'bg-[var(--md-surface-container-high)] text-[var(--md-on-surface-variant)] hover:text-[var(--md-on-surface)]'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* KPI Row */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="rounded-2xl border border-[var(--md-outline-variant)]/40 bg-[var(--md-surface-container)] p-5">
          <div className="text-xs text-[var(--md-on-surface-variant)] flex items-center gap-1.5">
            <Clock className="w-4 h-4 text-[var(--md-primary)]" />
            <span>Total Minutes Listened</span>
          </div>
          <div className="text-3xl font-bold mt-2 tabular-nums">{stats.totalMinutes}</div>
        </div>
        <div className="rounded-2xl border border-[var(--md-outline-variant)]/40 bg-[var(--md-surface-container)] p-5">
          <div className="text-xs text-[var(--md-on-surface-variant)] flex items-center gap-1.5">
            <Play className="w-4 h-4 text-[var(--md-primary)]" />
            <span>Total Streams</span>
          </div>
          <div className="text-3xl font-bold mt-2 tabular-nums">{stats.filteredCount}</div>
        </div>
        <div className="rounded-2xl border border-[var(--md-outline-variant)]/40 bg-[var(--md-surface-container)] p-5">
          <div className="text-xs text-[var(--md-on-surface-variant)] flex items-center gap-1.5">
            <Disc3 className="w-4 h-4 text-[var(--md-primary)]" />
            <span>Unique Tracks</span>
          </div>
          <div className="text-3xl font-bold mt-2 tabular-nums">{stats.uniqueTracks}</div>
        </div>
      </div>

      {/* Listening Rhythm */}
      <section className="rounded-2xl border border-[var(--md-outline-variant)]/40 bg-[var(--md-surface-container-low)] p-5">
        <h2 className="text-sm font-bold mb-4">Daily Listening Rhythm</h2>
        <div className="grid grid-cols-4 gap-4 items-end h-36">
          {stats.slots.map((count, idx) => (
            <div key={slotLabels[idx]} className="flex flex-col items-center gap-2 h-full justify-end">
              <span className="text-xs font-semibold tabular-nums">{count}</span>
              <div className="w-full max-w-[60px] rounded-t-xl bg-[var(--md-surface-container-highest)] h-24 flex items-end overflow-hidden">
                <div
                  style={{ height: `${Math.max(8, (count / maxSlot) * 100)}%` }}
                  className="w-full bg-[var(--md-primary)] rounded-t-xl transition-all"
                />
              </div>
              <span className="text-[11px] text-center text-[var(--md-on-surface-variant)]">
                {slotLabels[idx]}
              </span>
            </div>
          ))}
        </div>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Top Artists */}
        <section className="rounded-2xl border border-[var(--md-outline-variant)]/40 bg-[var(--md-surface-container-low)] p-5">
          <h2 className="text-sm font-bold mb-3 flex items-center gap-2">
            <User className="w-4 h-4 text-[var(--md-primary)]" />
            <span>Top Artists</span>
          </h2>
          {stats.topArtists.length === 0 ? (
            <div className="text-xs text-[var(--md-on-surface-variant)] py-6 text-center">
              Play some music to generate real artist statistics.
            </div>
          ) : (
            <div className="space-y-2">
              {stats.topArtists.slice(0, 8).map((a, idx) => (
                <button
                  key={a.artist}
                  type="button"
                  onClick={() => navigate('artist', a.artist)}
                  className="w-full flex items-center justify-between px-3 py-2 rounded-xl hover:bg-[var(--md-surface-container-high)] text-left cursor-pointer"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="text-xs font-bold w-5 text-[var(--md-primary)]">
                      {idx + 1}
                    </span>
                    <span className="text-sm font-semibold truncate">{a.artist}</span>
                  </div>
                  <span className="text-xs text-[var(--md-on-surface-variant)] tabular-nums">
                    {a.plays} play(s) · {Math.round(a.sec / 60)}m
                  </span>
                </button>
              ))}
            </div>
          )}
        </section>

        {/* Most Played Tracks */}
        <section className="rounded-2xl border border-[var(--md-outline-variant)]/40 bg-[var(--md-surface-container-low)] p-5">
          <h2 className="text-sm font-bold mb-3">Most Played Tracks</h2>
          {stats.topSongs.length === 0 ? (
            <div className="text-xs text-[var(--md-on-surface-variant)] py-6 text-center">
              Play tracks to see your most streamed songs here.
            </div>
          ) : (
            <div className="space-y-2">
              {stats.topSongs.slice(0, 8).map((s, idx) => {
                const fullTrack =
                  tracks.find((t) => t.id === s.trackId) ||
                  homeTracks.find((t) => t.id === s.trackId);
                return (
                  <button
                    key={s.trackId}
                    type="button"
                    onClick={() => fullTrack && void playTrack(fullTrack)}
                    className="w-full flex items-center justify-between gap-3 px-3 py-2 rounded-xl hover:bg-[var(--md-surface-container-high)] text-left cursor-pointer"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="text-xs font-bold w-5 text-[var(--md-primary)]">
                        {idx + 1}
                      </span>
                      <img
                        src={s.thumbnailUrl || FALLBACK_ARTWORK_DATA_URL}
                        alt={s.title}
                        onError={(e) => {
                          e.currentTarget.src = FALLBACK_ARTWORK_DATA_URL;
                        }}
                        className="w-9 h-9 rounded-lg object-cover shrink-0"
                      />
                      <div className="min-w-0">
                        <div className="text-xs font-semibold truncate">{s.title}</div>
                        <div className="text-[11px] text-[var(--md-on-surface-variant)] truncate">
                          {s.artist}
                        </div>
                      </div>
                    </div>
                    <span className="text-xs text-[var(--md-on-surface-variant)] tabular-nums shrink-0">
                      {s.plays} play(s)
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  );
};
