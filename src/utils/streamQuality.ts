export type AudioQuality = 'AUTO' | 'LOW' | 'MEDIUM' | 'HIGH' | 'MAX';

export interface AdaptiveAudioFormat {
  itag?: number;
  url?: string;
  signatureCipher?: string;
  cipher?: string;
  mimeType?: string;
  bitrate?: number;
  audioSampleRate?: string | number;
  approxDurationMs?: string | number;
  audioQuality?: string;
}

export const QUALITY_TARGET_BITRATE_BPS: Record<Exclude<AudioQuality, 'AUTO' | 'MAX'>, number> = {
  LOW: 70_000,
  MEDIUM: 135_000,
  HIGH: 192_000,
};

export function normalizeAudioQuality(raw?: string | null): AudioQuality {
  const upper = String(raw || 'HIGH').trim().toUpperCase();
  if (upper === 'LOW' || upper === 'MEDIUM' || upper === 'HIGH' || upper === 'MAX' || upper === 'AUTO') {
    return upper;
  }
  if (upper === 'HIGHEST' || upper === 'BEST' || upper === 'ULTRA') {
    return 'MAX';
  }
  return 'HIGH';
}

export function extractCodec(mimeType?: string): string | null {
  if (!mimeType) return null;
  const match = mimeType.match(/codecs="([^"]+)"/i);
  if (!match) return null;
  const first = match[1].split(',')[0]?.trim();
  return first || null;
}

/**
 * Mirrors Riri Player's YTPlayerUtils.codecRank:
 * Opus delivers superior perceptual fidelity per bit over AAC (mp4a).
 */
export function codecRank(codec: string | null): number {
  if (!codec) return 0;
  const lower = codec.toLowerCase();
  if (lower.includes('opus')) return 3;
  if (lower.includes('mp4a') || lower.includes('aac')) return 2;
  return 1;
}

/**
 * Mirrors Riri Player's YTPlayerUtils.isLikelyPreview guard:
 * Rejects 30s-90s preview clips when the expected track duration is >= 90s.
 */
export function isLikelyPreviewFormat(
  approxDurationMs: string | number | undefined,
  expectedDurationSec: number,
): boolean {
  const approx = typeof approxDurationMs === 'string' ? Number(approxDurationMs) : approxDurationMs;
  if (!approx || !Number.isFinite(approx) || approx <= 0) return false;
  if (!Number.isFinite(expectedDurationSec) || expectedDurationSec < 90) return false;
  const expectedMs = expectedDurationSec * 1000;
  const thresholdMs = Math.min(90_000, Math.floor((expectedMs * 9) / 10));
  return approx >= 1 && approx <= thresholdMs;
}

function parseSampleRate(rate?: string | number): number {
  const num = typeof rate === 'string' ? Number(rate) : rate;
  return num && Number.isFinite(num) ? num : 0;
}

/**
 * Mirrors Riri Player's YTPlayerUtils.selectAudioFormatCandidates across
 * LOW / MEDIUM / HIGH / MAX / AUTO tiers.
 */
export function selectAudioFormatCandidates<T extends AdaptiveAudioFormat>(
  adaptiveFormats: T[],
  quality: AudioQuality = 'HIGH',
  expectedDurationSec = 0,
  networkMetered = false,
): T[] {
  const audioFormats = adaptiveFormats.filter(
    (f) =>
      Boolean(f.mimeType?.toLowerCase().startsWith('audio/')) &&
      (f.bitrate || 0) > 0 &&
      Boolean(f.url || f.signatureCipher || f.cipher) &&
      !isLikelyPreviewFormat(f.approxDurationMs, expectedDurationSec),
  );

  if (audioFormats.length === 0) return [];

  const effectiveQuality: Exclude<AudioQuality, 'AUTO'> =
    quality === 'AUTO' ? (networkMetered ? 'HIGH' : 'MAX') : quality;

  const preferHigher = (a: T, b: T): number => {
    const directDiff = Number(Boolean(b.url)) - Number(Boolean(a.url));
    if (directDiff !== 0) return directDiff;
    const bitrateDiff = (b.bitrate || 0) - (a.bitrate || 0);
    if (bitrateDiff !== 0) return bitrateDiff;
    const codecDiff = codecRank(extractCodec(b.mimeType)) - codecRank(extractCodec(a.mimeType));
    if (codecDiff !== 0) return codecDiff;
    return parseSampleRate(b.audioSampleRate) - parseSampleRate(a.audioSampleRate);
  };

  const preferLowerAboveTarget = (a: T, b: T): number => {
    const directDiff = Number(Boolean(b.url)) - Number(Boolean(a.url));
    if (directDiff !== 0) return directDiff;
    const bitrateDiff = (a.bitrate || 0) - (b.bitrate || 0);
    if (bitrateDiff !== 0) return bitrateDiff;
    const codecDiff = codecRank(extractCodec(b.mimeType)) - codecRank(extractCodec(a.mimeType));
    if (codecDiff !== 0) return codecDiff;
    return parseSampleRate(b.audioSampleRate) - parseSampleRate(a.audioSampleRate);
  };

  if (effectiveQuality === 'MAX') {
    return [...audioFormats].sort(preferHigher);
  }

  const targetBitrateBps = QUALITY_TARGET_BITRATE_BPS[effectiveQuality];
  const preferred = audioFormats.filter((f) => (f.bitrate || 0) <= targetBitrateBps).sort(preferHigher);
  const fallback = audioFormats
    .filter((f) => (f.bitrate || 0) > targetBitrateBps)
    .sort(preferLowerAboveTarget);

  return [...preferred, ...fallback];
}

export function formatQualityBadge(
  mimeType?: string,
  bitrateBps?: number,
  fallbackQuality: AudioQuality = 'HIGH',
): string {
  const codec = extractCodec(mimeType);
  const kbps = bitrateBps && bitrateBps > 0 ? Math.round(bitrateBps / 1000) : 0;
  const label = codec
    ? codec.toLowerCase().includes('opus')
      ? 'OPUS'
      : codec.toLowerCase().includes('mp4a')
        ? 'AAC'
        : codec.toUpperCase().slice(0, 6)
    : 'YTM';
  if (kbps > 0) return `${label} ${kbps}kbps`;
  return `${label} ${fallbackQuality}`;
}

export function pickBitrateByQuality<T extends { bitrateKbps: number }>(
  items: T[],
  quality: AudioQuality,
): T | null {
  if (items.length === 0) return null;
  const sorted = [...items].sort((a, b) => a.bitrateKbps - b.bitrateKbps);
  const effective = quality === 'AUTO' ? 'HIGH' : quality;
  const maxKbps =
    effective === 'LOW'
      ? 64
      : effective === 'MEDIUM'
        ? 128
        : effective === 'HIGH'
          ? 192
          : Number.POSITIVE_INFINITY;

  if (effective === 'MAX') {
    return sorted[sorted.length - 1];
  }
  const within = sorted.filter((i) => i.bitrateKbps <= maxKbps);
  if (within.length > 0) return within[within.length - 1];
  return sorted[0];
}

function normalizeCompareText(value: string): string {
  return value
    .toLowerCase()
    .replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const DISALLOWED_VARIANT_WORDS = [
  'karaoke',
  'nightcore',
  'slowed',
  'reverb',
  'sped up',
  '8d',
  'instrumental',
  'cover',
  'remix',
  'flip',
  'mashup',
  'bootleg',
  'lofi',
  'lo-fi',
  'ringtone',
  'piano version',
  'tribute',
  'made famous',
  'originally performed',
  'type beat',
  '8-bit',
  'acoustic',
];

/**
 * Prevents substituting 30s previews, karaoke, slowed/reverb, tributes, or covers when matching full tracks.
 */
export function isExactFullLengthMatch(
  targetTitle: string,
  targetArtist: string,
  targetDurationSec: number,
  candidateTitle: string,
  candidateArtist: string,
  candidateDurationSec: number,
): boolean {
  if (!Number.isFinite(candidateDurationSec) || candidateDurationSec < 75) {
    return false;
  }

  if (Number.isFinite(targetDurationSec) && targetDurationSec >= 90) {
    const ratio = candidateDurationSec / targetDurationSec;
    if (ratio < 0.78 || ratio > 1.3) return false;
  }

  const rawTargetTitle = targetTitle.toLowerCase();
  const rawCandTitle = candidateTitle.toLowerCase();
  const rawCandArtist = candidateArtist.toLowerCase();
  for (const word of DISALLOWED_VARIANT_WORDS) {
    if (
      (rawCandTitle.includes(word) || rawCandArtist.includes(word)) &&
      !rawTargetTitle.includes(word)
    ) {
      return false;
    }
  }

  const normTargetTitle = normalizeCompareText(targetTitle);
  const normCandTitle = normalizeCompareText(candidateTitle);
  if (!normTargetTitle || !normCandTitle) return false;

  const titleWords = normTargetTitle.split(' ').filter((w) => w.length >= 2);
  const candTitleTokens = new Set(normCandTitle.split(' ').filter(Boolean));
  const titleMatch =
    normCandTitle === normTargetTitle ||
    normCandTitle.includes(normTargetTitle) ||
    normTargetTitle.includes(normCandTitle) ||
    (titleWords.length > 0 && titleWords.every((w) => candTitleTokens.has(w)));
  if (!titleMatch) return false;

  const artistSegments = targetArtist
    .split(/,|&|\bfeat\.?\b|\bft\.?\b|\bx\b/i)
    .map((s) => normalizeCompareText(s))
    .filter((s) => s.length >= 2);
  if (artistSegments.length === 0) return true;

  const normCandArtist = normalizeCompareText(candidateArtist);
  const candArtistTokens = new Set(normCandArtist.split(' ').filter(Boolean));
  return artistSegments.some((segment) => {
    const escaped = segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(`(^|\\s)${escaped}(\\s|$)`).test(normCandArtist)) return true;
    const words = segment.split(' ').filter((w) => w.length >= 2);
    return words.length > 0 && words.every((w) => candArtistTokens.has(w) || candTitleTokens.has(w));
  });
}
