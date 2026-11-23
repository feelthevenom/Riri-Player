import React, { useState } from 'react';
import { Radio, Users } from 'lucide-react';
import { useRiriPlayer } from '../context/RiriPlayerContext';

export const TogetherScreen: React.FC = () => {
  const { settings, currentTrack, showToast } = useRiriPlayer();
  const [roomCode, setRoomCode] = useState('');
  const [joinedRoom, setJoinedRoom] = useState<string | null>(null);

  const serverUrl = settings.customTogetherServerUrl.trim();

  const handleJoin = (e: React.FormEvent) => {
    e.preventDefault();
    if (!roomCode.trim()) return;
    setJoinedRoom(roomCode.trim().toUpperCase());
    showToast(`Configured room ${roomCode.trim().toUpperCase()} against ${serverUrl}`);
  };

  return (
    <div className="space-y-6 max-w-2xl pb-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Radio className="w-6 h-6 text-[var(--md-primary)]" />
          <span>Listen Together</span>
        </h1>
        <p className="text-xs text-[var(--md-on-surface-variant)]">
          Connected custom server: <span className="font-mono">{serverUrl}</span>
        </p>
      </div>

      <div className="rounded-2xl border border-[var(--md-outline-variant)]/40 bg-[var(--md-surface-container-low)] p-6 space-y-4">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Users className="w-4 h-4 text-[var(--md-primary)]" />
          <span>Join or Host Synchronized Session</span>
        </div>

        <form onSubmit={handleJoin} className="flex gap-2">
          <input
            type="text"
            aria-label="Room code"
            placeholder="Enter Room Code (e.g. ARCH-402)"
            value={roomCode}
            onChange={(e) => setRoomCode(e.target.value)}
            className="flex-1 h-10 rounded-xl border border-[var(--md-outline-variant)] bg-[var(--md-surface-container)] px-3 text-xs"
          />
          <button
            type="submit"
            className="px-4 h-10 rounded-xl bg-[var(--md-primary)] text-[var(--md-on-primary)] text-xs font-bold cursor-pointer"
          >
            Connect Room
          </button>
        </form>

        {joinedRoom && (
          <div className="rounded-xl bg-[var(--md-surface-container)] p-4 text-xs space-y-1">
            <div className="font-bold text-[var(--md-primary)]">
              Session Room: {joinedRoom}
            </div>
            <div className="text-[var(--md-on-surface-variant)]">
              Current Track: {currentTrack ? `${currentTrack.title} — ${currentTrack.artist}` : 'None'}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
