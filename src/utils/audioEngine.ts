import { EqProfile } from '../types/music';
import { EQ_CENTER_FREQS } from '../data/catalog';

interface YTPlayerInstance {
  loadVideoById: (videoId: string) => void;
  playVideo: () => void;
  pauseVideo: () => void;
  stopVideo: () => void;
  seekTo: (seconds: number, allowSeekAhead: boolean) => void;
  setVolume: (volumePercent: number) => void;
  setPlaybackRate: (rate: number) => void;
  getCurrentTime: () => number;
  getDuration: () => number;
  getPlayerState: () => number;
  destroy: () => void;
}

interface YTGlobal {
  Player: new (
    element: HTMLElement | string,
    options: {
      width?: number | string;
      height?: number | string;
      videoId?: string;
      playerVars?: Record<string, string | number>;
      events?: {
        onReady?: () => void;
        onStateChange?: (ev: { data: number }) => void;
        onError?: (ev: { data: number }) => void;
      };
    },
  ) => YTPlayerInstance;
  PlayerState?: {
    ENDED: number;
    PLAYING: number;
    PAUSED: number;
    BUFFERING: number;
    CUED: number;
  };
}

let ytApiLoadPromise: Promise<YTGlobal | null> | null = null;

function loadYoutubeIframeApi(): Promise<YTGlobal | null> {
  if (typeof window === 'undefined') return Promise.resolve(null);
  const win = window as unknown as {
    YT?: YTGlobal;
    onYouTubeIframeAPIReady?: () => void;
  };
  if (win.YT?.Player) return Promise.resolve(win.YT);
  if (ytApiLoadPromise) return ytApiLoadPromise;

  ytApiLoadPromise = new Promise((resolve) => {
    const prevReady = win.onYouTubeIframeAPIReady;
    const timeout = window.setTimeout(() => resolve(win.YT || null), 8000);

    win.onYouTubeIframeAPIReady = () => {
      window.clearTimeout(timeout);
      if (typeof prevReady === 'function') {
        try {
          prevReady();
        } catch {
          // ignore
        }
      }
      resolve(win.YT || null);
    };

    if (!document.querySelector('script[data-riri-yt-api="true"]')) {
      const script = document.createElement('script');
      script.src = 'https://www.youtube.com/iframe_api';
      script.async = true;
      script.dataset.ririYtApi = 'true';
      script.onerror = () => {
        window.clearTimeout(timeout);
        resolve(null);
      };
      document.head.appendChild(script);
    }
  });

  return ytApiLoadPromise;
}

class RiriPlayerAudioEngine {
  private audioEl: HTMLAudioElement | null = null;
  private ctx: AudioContext | null = null;
  private sourceNode: MediaElementAudioSourceNode | null = null;
  private preampNode: GainNode | null = null;
  private bassNode: BiquadFilterNode | null = null;
  private eqNodes: BiquadFilterNode[] = [];
  private compressorNode: DynamicsCompressorNode | null = null;
  private analyser: AnalyserNode | null = null;
  private freqData: Uint8Array<ArrayBuffer> = new Uint8Array(new ArrayBuffer(64));

  // YouTube IFrame Bridge state (used automatically when direct audio is bot-guarded)
  private mode: 'direct' | 'youtube' = 'direct';
  private ytContainer: HTMLDivElement | null = null;
  private ytPlayer: YTPlayerInstance | null = null;
  private ytReady = false;
  private ytPollTimer: number | null = null;
  private ytCandidates: string[] = [];
  private ytCandidateIdx = 0;
  private ytPlaySettler: ((ok: boolean) => void) | null = null;
  private ytIsPlaying = false;
  private loadSeq = 0;

  private playbackRate = 1;
  private preservePitch = true;
  private normalizeLoudness = true;
  private volume = 0.85;
  private crossfadeSec = 0;
  private currentEq: EqProfile | null = null;

  public onTimeUpdate: ((posSec: number, durSec: number) => void) | null = null;
  public onEnded: (() => void) | null = null;
  public onError: ((msg: string) => void) | null = null;

  private ensureContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    if (!this.ctx) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return null;
      this.ctx = new AudioCtx();
      this.preampNode = this.ctx.createGain();
      this.bassNode = this.ctx.createBiquadFilter();
      this.bassNode.type = 'lowshelf';
      this.bassNode.frequency.value = 85;

      this.eqNodes = EQ_CENTER_FREQS.map((freq) => {
        const filter = this.ctx!.createBiquadFilter();
        filter.type = 'peaking';
        filter.frequency.value = freq;
        filter.Q.value = 1.4;
        filter.gain.value = 0;
        return filter;
      });

      this.compressorNode = this.ctx.createDynamicsCompressor();
      this.applyCompressorParams();

      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 128;
      this.freqData = new Uint8Array(new ArrayBuffer(this.analyser.frequencyBinCount));

      // Chain: preamp -> bass -> eq[0..9] -> compressor (loudness norm) -> analyser -> destination
      let prev: AudioNode = this.preampNode;
      prev.connect(this.bassNode);
      prev = this.bassNode;
      for (const node of this.eqNodes) {
        prev.connect(node);
        prev = node;
      }
      prev.connect(this.compressorNode);
      this.compressorNode.connect(this.analyser);
      this.analyser.connect(this.ctx.destination);
    }

    if (this.ctx.state === 'suspended') {
      void this.ctx.resume().catch(() => undefined);
    }
    return this.ctx;
  }

  private applyCompressorParams() {
    if (!this.compressorNode || !this.ctx) return;
    const now = this.ctx.currentTime;
    if (this.normalizeLoudness) {
      this.compressorNode.threshold.setTargetAtTime(-18, now, 0.02);
      this.compressorNode.knee.setTargetAtTime(16, now, 0.02);
      this.compressorNode.ratio.setTargetAtTime(3.2, now, 0.02);
      this.compressorNode.attack.setTargetAtTime(0.005, now, 0.02);
      this.compressorNode.release.setTargetAtTime(0.22, now, 0.02);
    } else {
      this.compressorNode.threshold.setTargetAtTime(0, now, 0.02);
      this.compressorNode.ratio.setTargetAtTime(1, now, 0.02);
    }
  }

  private ensureAudioElement(): HTMLAudioElement | null {
    if (typeof window === 'undefined') return null;
    if (!this.audioEl) {
      const audio = new Audio();
      audio.crossOrigin = 'anonymous';
      audio.preload = 'auto';
      audio.volume = this.volume;
      audio.playbackRate = this.playbackRate;
      if ('preservesPitch' in audio) {
        audio.preservesPitch = this.preservePitch;
      }

      audio.addEventListener('timeupdate', () => {
        if (this.mode !== 'direct') return;
        this.onTimeUpdate?.(
          audio.currentTime || 0,
          Number.isFinite(audio.duration) ? audio.duration : 0,
        );
      });
      audio.addEventListener('ended', () => {
        if (this.mode !== 'direct') return;
        this.onEnded?.();
      });
      audio.addEventListener('error', () => {
        if (this.mode !== 'direct' || !audio.getAttribute('src')) return;
        this.onError?.('Unable to stream this track. Try another source or check network.');
      });

      this.audioEl = audio;
    }

    const ctx = this.ensureContext();
    if (ctx && this.audioEl && !this.sourceNode && this.preampNode) {
      try {
        this.sourceNode = ctx.createMediaElementSource(this.audioEl);
        this.sourceNode.connect(this.preampNode);
      } catch {
        // Already attached
      }
    }

    return this.audioEl;
  }

  private stopYtPolling() {
    if (this.ytPollTimer !== null) {
      window.clearInterval(this.ytPollTimer);
      this.ytPollTimer = null;
    }
  }

  private startYtPolling() {
    this.stopYtPolling();
    this.ytPollTimer = window.setInterval(() => {
      if (this.mode !== 'youtube' || !this.ytPlayer || !this.ytReady) return;
      try {
        const pos = this.ytPlayer.getCurrentTime?.() || 0;
        const dur = this.ytPlayer.getDuration?.() || 0;
        const st = this.ytPlayer.getPlayerState?.();
        this.ytIsPlaying = st === 1 || st === 3;
        if (dur > 0 || pos > 0) {
          this.onTimeUpdate?.(pos, dur);
        }
      } catch {
        // ignore polling race
      }
    }, 250);
  }

  private stopYoutubeInternal() {
    this.stopYtPolling();
    this.ytIsPlaying = false;
    if (this.ytPlaySettler) {
      const settle = this.ytPlaySettler;
      this.ytPlaySettler = null;
      settle(false);
    }
    if (this.ytPlayer && this.ytReady) {
      try {
        this.ytPlayer.pauseVideo();
        this.ytPlayer.stopVideo();
      } catch {
        // ignore
      }
    }
  }

  public stopImmediate() {
    this.loadSeq += 1;
    this.stopYoutubeInternal();
    if (this.audioEl) {
      try {
        this.audioEl.pause();
        this.audioEl.removeAttribute('src');
        this.audioEl.load();
      } catch {
        // ignore
      }
    }
  }

  private async ensureYtPlayer(initialVideoId: string): Promise<YTPlayerInstance | null> {
    if (typeof window === 'undefined') return null;
    const YT = await loadYoutubeIframeApi();
    if (!YT?.Player) return null;

    if (this.ytPlayer && this.ytReady) {
      return this.ytPlayer;
    }

    if (!this.ytContainer) {
      const div = document.createElement('div');
      div.id = 'riri-yt-audio-bridge';
      div.setAttribute('aria-hidden', 'true');
      div.style.cssText =
        'position:fixed;width:240px;height:135px;left:-9999px;top:-9999px;opacity:0;pointer-events:none;overflow:hidden;';
      const inner = document.createElement('div');
      div.appendChild(inner);
      document.body.appendChild(div);
      this.ytContainer = div;
    }

    const hostEl = this.ytContainer.firstElementChild as HTMLElement;
    return await new Promise<YTPlayerInstance | null>((resolve) => {
      let settled = false;
      const timer = window.setTimeout(() => {
        if (!settled) {
          settled = true;
          resolve(this.ytPlayer);
        }
      }, 6000);

      this.ytPlayer = new YT.Player(hostEl, {
        width: 240,
        height: 135,
        videoId: initialVideoId,
        playerVars: {
          autoplay: 1,
          controls: 0,
          disablekb: 1,
          fs: 0,
          iv_load_policy: 3,
          modestbranding: 1,
          playsinline: 1,
          rel: 0,
          origin: window.location.origin,
        },
        events: {
          onReady: () => {
            this.ytReady = true;
            try {
              this.ytPlayer?.setVolume(Math.round(this.volume * 100));
              this.ytPlayer?.setPlaybackRate(this.playbackRate);
            } catch {
              // ignore
            }
            if (!settled) {
              settled = true;
              window.clearTimeout(timer);
              resolve(this.ytPlayer);
            }
          },
          onStateChange: (ev) => {
            if (this.mode !== 'youtube') return;
            if (ev.data === 1) {
              // PLAYING
              this.ytIsPlaying = true;
              if (this.ytPlaySettler) {
                const settle = this.ytPlaySettler;
                this.ytPlaySettler = null;
                settle(true);
              }
            } else if (ev.data === 2) {
              // PAUSED
              this.ytIsPlaying = false;
            } else if (ev.data === 0) {
              // ENDED
              this.ytIsPlaying = false;
              this.onEnded?.();
            }
          },
          onError: () => {
            if (this.mode !== 'youtube') return;
            // Try next alternate videoId if embedding is restricted on current ID
            if (this.ytCandidateIdx + 1 < this.ytCandidates.length) {
              this.ytCandidateIdx += 1;
              const nextVid = this.ytCandidates[this.ytCandidateIdx];
              try {
                this.ytPlayer?.loadVideoById(nextVid);
                return;
              } catch {
                // fall through to failure
              }
            }
            this.ytIsPlaying = false;
            if (this.ytPlaySettler) {
              const settle = this.ytPlaySettler;
              this.ytPlaySettler = null;
              settle(false);
            } else {
              this.onError?.('Unable to stream this track. Try another source or check network.');
            }
          },
        },
      });
    });
  }

  public async loadAndPlayYoutubeEmbed(
    videoId: string,
    alternateVideoIds: string[] = [],
  ): Promise<boolean> {
    const candidates = Array.from(
      new Set([videoId, ...alternateVideoIds].map((v) => v.trim()).filter(Boolean)),
    );
    if (candidates.length === 0) return false;

    const mySeq = ++this.loadSeq;

    // Pause any direct audio element cleanly
    if (this.audioEl) {
      this.audioEl.pause();
      this.audioEl.removeAttribute('src');
    }

    this.mode = 'youtube';
    this.ytCandidates = candidates;
    this.ytCandidateIdx = 0;
    this.ytIsPlaying = false;

    const alreadyInitialized = Boolean(this.ytPlayer && this.ytReady);
    const player = await this.ensureYtPlayer(candidates[0]);
    if (!player || mySeq !== this.loadSeq) return false;

    return await new Promise<boolean>((resolve) => {
      let resolved = false;
      const done = (ok: boolean) => {
        if (resolved) return;
        resolved = true;
        window.clearTimeout(fallbackTimer);
        if (this.ytPlaySettler === done) this.ytPlaySettler = null;
        if (mySeq !== this.loadSeq) {
          resolve(false);
          return;
        }
        if (ok) this.startYtPolling();
        resolve(ok);
      };

      // If YouTube player doesn't report error within 4.5s, allow UI play state when CUED/BUFFERING
      const fallbackTimer = window.setTimeout(() => {
        if (mySeq !== this.loadSeq) {
          done(false);
          return;
        }
        try {
          const st = player.getPlayerState?.();
          if (st === 1 || st === 3 || st === 5) {
            done(true);
            return;
          }
        } catch {
          // ignore
        }
        done(false);
      }, 5000);

      this.ytPlaySettler = done;
      try {
        player.setVolume(Math.round(this.volume * 100));
        player.setPlaybackRate(this.playbackRate);
        if (alreadyInitialized) {
          player.loadVideoById(candidates[0]);
        } else {
          player.playVideo();
        }
        this.startYtPolling();
      } catch {
        done(false);
      }
    });
  }

  public applyEq(profile: EqProfile) {
    this.currentEq = profile;
    const ctx = this.ctx;
    if (!ctx || !this.preampNode || !this.bassNode) return;

    const now = ctx.currentTime;
    if (!profile.enabled) {
      this.preampNode.gain.setTargetAtTime(this.volume, now, 0.02);
      this.bassNode.gain.setTargetAtTime(0, now, 0.02);
      this.eqNodes.forEach((n) => n.gain.setTargetAtTime(0, now, 0.02));
      return;
    }

    const preampLinear = Math.pow(10, profile.outputGainDb / 20) * this.volume;
    this.preampNode.gain.setTargetAtTime(Math.min(2.2, preampLinear), now, 0.02);
    this.bassNode.gain.setTargetAtTime(profile.bassBoostDb, now, 0.02);
    this.eqNodes.forEach((node, idx) => {
      node.gain.setTargetAtTime(profile.bandLevelsDb[idx] ?? 0, now, 0.02);
    });
  }

  public setVolume(vol: number) {
    this.volume = Math.max(0, Math.min(1, vol));
    if (this.audioEl) {
      this.audioEl.volume = this.volume;
    }
    if (this.ytPlayer && this.ytReady) {
      try {
        this.ytPlayer.setVolume(Math.round(this.volume * 100));
      } catch {
        // ignore
      }
    }
    if (this.currentEq) {
      this.applyEq(this.currentEq);
    } else if (this.preampNode && this.ctx) {
      this.preampNode.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.02);
    }
  }

  public setPlaybackSpeed(rate: number) {
    this.playbackRate = Math.max(0.5, Math.min(2.0, rate));
    if (this.audioEl) {
      this.audioEl.playbackRate = this.playbackRate;
    }
    if (this.ytPlayer && this.ytReady) {
      try {
        this.ytPlayer.setPlaybackRate(this.playbackRate);
      } catch {
        // ignore
      }
    }
  }

  public setPreservePitch(preserve: boolean) {
    this.preservePitch = preserve;
    if (this.audioEl && 'preservesPitch' in this.audioEl) {
      this.audioEl.preservesPitch = preserve;
    }
  }

  public setNormalizeLoudness(enabled: boolean) {
    this.normalizeLoudness = enabled;
    this.applyCompressorParams();
  }

  public setCrossfadeSec(sec: number) {
    this.crossfadeSec = Math.max(0, Math.min(12, sec));
  }

  public async loadAndPlay(streamUrl: string): Promise<boolean> {
    if (!streamUrl) {
      this.onError?.('No playable audio stream URL found for this track.');
      return false;
    }

    const mySeq = ++this.loadSeq;
    this.stopYoutubeInternal();
    this.mode = 'direct';

    const audio = this.ensureAudioElement();
    if (!audio) return false;

    const resolvedSrc =
      streamUrl.startsWith('http://') || streamUrl.startsWith('https://')
        ? `/api/proxy-audio?url=${encodeURIComponent(streamUrl)}`
        : streamUrl;

    if (this.crossfadeSec > 0 && this.preampNode && this.ctx) {
      const now = this.ctx.currentTime;
      this.preampNode.gain.setValueAtTime(0.01, now);
      const targetGain =
        this.currentEq && this.currentEq.enabled
          ? Math.min(2.2, Math.pow(10, this.currentEq.outputGainDb / 20) * this.volume)
          : this.volume;
      this.preampNode.gain.linearRampToValueAtTime(
        targetGain,
        now + Math.min(this.crossfadeSec, 4),
      );
    }

    audio.pause();
    audio.src = resolvedSrc;
    audio.playbackRate = this.playbackRate;
    if ('preservesPitch' in audio) {
      audio.preservesPitch = this.preservePitch;
    }
    audio.volume = this.volume;
    if (this.currentEq && this.crossfadeSec === 0) {
      this.applyEq(this.currentEq);
    }

    try {
      await audio.play();
      if (mySeq !== this.loadSeq) {
        audio.pause();
        return false;
      }
      return true;
    } catch {
      return false;
    }
  }

  public async play() {
    if (this.mode === 'youtube' && this.ytPlayer && this.ytReady) {
      try {
        this.ytPlayer.playVideo();
        this.ytIsPlaying = true;
        this.startYtPolling();
      } catch {
        // ignore
      }
      return;
    }
    const audio = this.ensureAudioElement();
    if (!audio) return;
    const ctx = this.ensureContext();
    if (ctx?.state === 'suspended') {
      await ctx.resume().catch(() => undefined);
    }
    await audio.play().catch(() => undefined);
  }

  public pause() {
    if (this.mode === 'youtube' && this.ytPlayer && this.ytReady) {
      this.ytIsPlaying = false;
      try {
        this.ytPlayer.pauseVideo();
      } catch {
        // ignore
      }
      return;
    }
    this.audioEl?.pause();
  }

  public seek(sec: number) {
    if (!Number.isFinite(sec)) return;
    const clamped = Math.max(0, sec);
    if (this.mode === 'youtube' && this.ytPlayer && this.ytReady) {
      try {
        this.ytPlayer.seekTo(clamped, true);
        const dur = this.ytPlayer.getDuration?.() || 0;
        this.onTimeUpdate?.(clamped, dur);
      } catch {
        // ignore
      }
      return;
    }
    if (this.audioEl) {
      this.audioEl.currentTime = clamped;
      this.onTimeUpdate?.(this.audioEl.currentTime, this.audioEl.duration || 0);
    }
  }

  public getFrequencyLevels(barCount = 32): number[] {
    if (this.mode === 'youtube') {
      if (!this.ytIsPlaying) {
        return new Array(barCount).fill(0);
      }
      const t = performance.now() * 0.004;
      const out: number[] = [];
      for (let i = 0; i < barCount; i++) {
        const wave =
          0.32 +
          0.26 * Math.sin(t * 1.4 + i * 0.55) +
          0.18 * Math.cos(t * 2.3 - i * 0.35);
        out.push(Math.max(0.08, Math.min(0.95, wave)));
      }
      return out;
    }

    if (this.analyser) {
      this.analyser.getByteFrequencyData(this.freqData);
      const out: number[] = [];
      const usableBins = Math.max(barCount, Math.floor(this.freqData.length * 0.75));
      const step = Math.max(1, Math.floor(usableBins / barCount));
      for (let i = 0; i < barCount; i++) {
        const val = this.freqData[Math.min(i * step, this.freqData.length - 1)] || 0;
        out.push(val / 255);
      }
      return out;
    }
    return new Array(barCount).fill(0);
  }
}

export const audioEngine = new RiriPlayerAudioEngine();
