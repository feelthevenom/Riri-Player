import { EqProfile } from '../types/music';
import { EQ_CENTER_FREQS } from '../data/catalog';

class ArchiveTuneAudioEngine {
  private audioEl: HTMLAudioElement | null = null;
  private ctx: AudioContext | null = null;
  private sourceNode: MediaElementAudioSourceNode | null = null;
  private preampNode: GainNode | null = null;
  private bassNode: BiquadFilterNode | null = null;
  private eqNodes: BiquadFilterNode[] = [];
  private compressorNode: DynamicsCompressorNode | null = null;
  private analyser: AnalyserNode | null = null;
  private freqData: Uint8Array<ArrayBuffer> = new Uint8Array(new ArrayBuffer(64));

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
        this.onTimeUpdate?.(
          audio.currentTime || 0,
          Number.isFinite(audio.duration) ? audio.duration : 0,
        );
      });
      audio.addEventListener('ended', () => {
        this.onEnded?.();
      });
      audio.addEventListener('error', () => {
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
      return true;
    } catch {
      return false;
    }
  }

  public async play() {
    const audio = this.ensureAudioElement();
    if (!audio) return;
    const ctx = this.ensureContext();
    if (ctx?.state === 'suspended') {
      await ctx.resume().catch(() => undefined);
    }
    await audio.play().catch(() => undefined);
  }

  public pause() {
    this.audioEl?.pause();
  }

  public seek(sec: number) {
    if (this.audioEl && Number.isFinite(sec)) {
      this.audioEl.currentTime = Math.max(0, sec);
      this.onTimeUpdate?.(this.audioEl.currentTime, this.audioEl.duration || 0);
    }
  }

  public getFrequencyLevels(barCount = 32): number[] {
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

export const audioEngine = new ArchiveTuneAudioEngine();
