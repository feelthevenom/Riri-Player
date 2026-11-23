/**
 * ArchiveTune-derived Spotify-to-YouTube-Music track matching helper.
 * Ported from ArchiveTune SpotifyMapper.kt (GPL-3.0).
 * Weighted score: 0.45 * titleBigramDice + 0.35 * artistBigramDice + 0.20 * durationScore.
 */

const FEAT_PATTERN = /\(feat\..*?\)/gi;
const FT_PATTERN = /\(ft\..*?\)/gi;
const BRACKET_PATTERN = /\[.*?\]/g;
const REMASTER_PATTERN = /\(.*?remaster.*?\)/gi;
const REMIX_PATTERN = /\(.*?remix.*?\)/gi;
const NON_ALNUM_PATTERN = /[^a-z0-9\s]/g;
const MULTI_SPACE_PATTERN = /\s+/g;

export const SPOTIFY_MATCH_ACCEPT_THRESHOLD = 0.35;
export const SPOTIFY_MATCH_EARLY_EXIT_THRESHOLD = 0.95;

export interface PrecomputedSpotifyTrack {
  normalizedTitle: string;
  titleBigrams: Set<string>;
  normalizedArtist: string;
  artistBigrams: Set<string>;
  durationMs: number;
}

export function normalizeSpotifyMatchText(text: string): string {
  return String(text || '')
    .toLowerCase()
    .replace(FEAT_PATTERN, '')
    .replace(FT_PATTERN, '')
    .replace(BRACKET_PATTERN, '')
    .replace(REMASTER_PATTERN, '')
    .replace(REMIX_PATTERN, '')
    .replace(NON_ALNUM_PATTERN, '')
    .replace(MULTI_SPACE_PATTERN, ' ')
    .trim();
}

export function extractBigrams(normalized: string): Set<string> {
  if (normalized.length < 2) return new Set<string>();
  const bigrams = new Set<string>();
  for (let i = 0; i < normalized.length - 1; i++) {
    bigrams.add(normalized.slice(i, i + 2));
  }
  return bigrams;
}

export function bigramDiceSimilarity(
  a: string,
  bigramsA: Set<string>,
  b: string,
  bigramsB: Set<string>,
): number {
  if (a === b && a.length > 0) return 1.0;
  if (bigramsA.size === 0 || bigramsB.size === 0) return 0.0;
  let intersection = 0;
  for (const bg of bigramsA) {
    if (bigramsB.has(bg)) intersection += 1;
  }
  return (2.0 * intersection) / (bigramsA.size + bigramsB.size);
}

export function computeDurationScore(
  spotifyDurationMs: number,
  candidateDurationSec?: number | null,
): number {
  if (!candidateDurationSec || candidateDurationSec <= 0 || spotifyDurationMs <= 0) {
    return 0.5;
  }
  const diffSec = Math.abs(Math.round(spotifyDurationMs / 1000) - Math.round(candidateDurationSec));
  if (diffSec <= 2) return 1.0;
  if (diffSec <= 5) return 0.8;
  if (diffSec <= 10) return 0.5;
  if (diffSec <= 30) return 0.2;
  return 0.0;
}

export function precomputeSpotifyTrack(
  title: string,
  artist: string,
  durationMs: number,
): PrecomputedSpotifyTrack {
  const normalizedTitle = normalizeSpotifyMatchText(title);
  const normalizedArtist = normalizeSpotifyMatchText(artist);
  return {
    normalizedTitle,
    titleBigrams: extractBigrams(normalizedTitle),
    normalizedArtist,
    artistBigrams: extractBigrams(normalizedArtist),
    durationMs,
  };
}

export function matchSpotifyScorePrecomputed(
  precomputed: PrecomputedSpotifyTrack,
  candidateTitle: string,
  candidateArtist: string,
  candidateDurationSec?: number | null,
): number {
  const normCandidateTitle = normalizeSpotifyMatchText(candidateTitle);
  const normCandidateArtist = normalizeSpotifyMatchText(candidateArtist);

  const titleScore = bigramDiceSimilarity(
    precomputed.normalizedTitle,
    precomputed.titleBigrams,
    normCandidateTitle,
    extractBigrams(normCandidateTitle),
  );
  const artistScore = bigramDiceSimilarity(
    precomputed.normalizedArtist,
    precomputed.artistBigrams,
    normCandidateArtist,
    extractBigrams(normCandidateArtist),
  );
  const durationScore = computeDurationScore(precomputed.durationMs, candidateDurationSec);

  return titleScore * 0.45 + artistScore * 0.35 + durationScore * 0.2;
}

export function pickBestYtMatchForSpotifyTrack<
  T extends { title: string; artist: string; durationSec: number },
>(
  spotifyTrack: { name: string; artist: string; durationMs: number },
  candidates: T[],
): { match: T | null; bestCandidate: T | null; bestScore: number } {
  if (candidates.length === 0) {
    return { match: null, bestCandidate: null, bestScore: 0 };
  }
  const precomputed = precomputeSpotifyTrack(
    spotifyTrack.name,
    spotifyTrack.artist,
    spotifyTrack.durationMs,
  );
  let bestCandidate: T | null = null;
  let bestScore = -1;

  for (const cand of candidates) {
    const score = matchSpotifyScorePrecomputed(
      precomputed,
      cand.title,
      cand.artist,
      cand.durationSec,
    );
    if (score > bestScore) {
      bestScore = score;
      bestCandidate = cand;
    }
    if (bestScore >= SPOTIFY_MATCH_EARLY_EXIT_THRESHOLD) {
      break;
    }
  }

  return {
    match: bestScore >= SPOTIFY_MATCH_ACCEPT_THRESHOLD ? bestCandidate : null,
    bestCandidate,
    bestScore: Math.max(0, bestScore),
  };
}
