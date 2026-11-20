import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AdaptiveAudioFormat,
  formatQualityBadge,
  isExactFullLengthMatch,
  isLikelyPreviewFormat,
  normalizeAudioQuality,
  pickBitrateByQuality,
  selectAudioFormatCandidates,
} from './streamQuality';

const SAMPLE_FORMATS: AdaptiveAudioFormat[] = [
  {
    itag: 249,
    mimeType: 'audio/webm; codecs="opus"',
    bitrate: 52_000,
    audioSampleRate: '48000',
    approxDurationMs: '202000',
    url: 'https://example.com/249',
  },
  {
    itag: 140,
    mimeType: 'audio/mp4; codecs="mp4a.40.2"',
    bitrate: 130_000,
    audioSampleRate: '44100',
    approxDurationMs: '202000',
    url: 'https://example.com/140',
  },
  {
    itag: 251,
    mimeType: 'audio/webm; codecs="opus"',
    bitrate: 162_000,
    audioSampleRate: '48000',
    approxDurationMs: '202000',
    url: 'https://example.com/251',
  },
  {
    itag: 774,
    mimeType: 'audio/webm; codecs="opus"',
    bitrate: 258_000,
    audioSampleRate: '48000',
    approxDurationMs: '202000',
    url: 'https://example.com/774',
  },
  {
    itag: 999,
    mimeType: 'audio/mp4; codecs="mp4a.40.2"',
    bitrate: 320_000,
    audioSampleRate: '48000',
    approxDurationMs: '30000', // 30s preview clip should be rejected
    url: 'https://example.com/preview',
  },
];

test('normalizeAudioQuality supports LOW, MEDIUM, HIGH, MAX, and AUTO', () => {
  assert.equal(normalizeAudioQuality('low'), 'LOW');
  assert.equal(normalizeAudioQuality('medium'), 'MEDIUM');
  assert.equal(normalizeAudioQuality('high'), 'HIGH');
  assert.equal(normalizeAudioQuality('max'), 'MAX');
  assert.equal(normalizeAudioQuality('highest'), 'MAX');
  assert.equal(normalizeAudioQuality('auto'), 'AUTO');
});

test('selectAudioFormatCandidates selects exact bitrates for LOW, MEDIUM, HIGH, and MAX and drops previews', () => {
  const low = selectAudioFormatCandidates(SAMPLE_FORMATS, 'LOW', 202);
  assert.equal(low[0]?.itag, 249);

  const medium = selectAudioFormatCandidates(SAMPLE_FORMATS, 'MEDIUM', 202);
  assert.equal(medium[0]?.itag, 140);

  const high = selectAudioFormatCandidates(SAMPLE_FORMATS, 'HIGH', 202);
  assert.equal(high[0]?.itag, 251);

  const max = selectAudioFormatCandidates(SAMPLE_FORMATS, 'MAX', 202);
  assert.equal(max[0]?.itag, 774);
  assert.equal(
    max.some((f) => f.itag === 999),
    false,
  );
});

test('selectAudioFormatCandidates prefers Opus over AAC at comparable bitrates', () => {
  const tiedFormats: AdaptiveAudioFormat[] = [
    {
      itag: 140,
      mimeType: 'audio/mp4; codecs="mp4a.40.2"',
      bitrate: 160_000,
      url: 'https://example.com/aac',
    },
    {
      itag: 251,
      mimeType: 'audio/webm; codecs="opus"',
      bitrate: 160_000,
      url: 'https://example.com/opus',
    },
  ];
  const ranked = selectAudioFormatCandidates(tiedFormats, 'MAX', 200);
  assert.equal(ranked[0]?.itag, 251);
});

test('isLikelyPreviewFormat rejects 30s clips on full songs but keeps genuinely short tracks', () => {
  assert.equal(isLikelyPreviewFormat('30000', 202), true);
  assert.equal(isLikelyPreviewFormat('200000', 202), false);
  assert.equal(isLikelyPreviewFormat('35000', 40), false);
});

test('pickBitrateByQuality maps 48/96/160/320 tiers accurately', () => {
  const streams = [
    { bitrateKbps: 48, url: '48' },
    { bitrateKbps: 96, url: '96' },
    { bitrateKbps: 160, url: '160' },
    { bitrateKbps: 320, url: '320' },
  ];
  assert.equal(pickBitrateByQuality(streams, 'LOW')?.bitrateKbps, 48);
  assert.equal(pickBitrateByQuality(streams, 'MEDIUM')?.bitrateKbps, 96);
  assert.equal(pickBitrateByQuality(streams, 'HIGH')?.bitrateKbps, 160);
  assert.equal(pickBitrateByQuality(streams, 'MAX')?.bitrateKbps, 320);
});

test('isExactFullLengthMatch rejects remixes, karaoke, lo-fi, acoustic, tributes, and loose artist substrings while accepting true matches', () => {
  assert.equal(
    isExactFullLengthMatch('Blinding Lights', 'The Weeknd', 202, 'Blinding Lights (Nightcore)', 'Glowave', 137),
    false,
  );
  assert.equal(
    isExactFullLengthMatch('Blinding Lights', 'The Weeknd', 202, 'Blinding Lights', 'The Weeknd', 30),
    false,
  );
  assert.equal(
    isExactFullLengthMatch('Kesariya', 'Arijit Singh', 268, 'Kesariya (Lo-Fi Version)', 'Arijit Singh', 265),
    false,
  );
  assert.equal(
    isExactFullLengthMatch('Apna Bana Le', 'Arijit Singh', 261, 'Apna Bana Le', 'Arijit Tribute Band', 260),
    false,
  );
  assert.equal(
    isExactFullLengthMatch('Cheap Thrills', 'Sia', 211, 'Cheap Thrills', 'Siaosi', 210),
    false,
  );
  assert.equal(
    isExactFullLengthMatch('Blinding Lights', 'The Weeknd', 202, 'Blinding Lights', 'The Weeknd', 200),
    true,
  );
  assert.equal(
    isExactFullLengthMatch('Kesariya', 'Pritam, Arijit Singh', 268, 'Kesariya (From "Brahmastra")', 'Arijit Singh', 268),
    true,
  );
});

test('formatQualityBadge formats codec and bitrate cleanly', () => {
  assert.equal(formatQualityBadge('audio/webm; codecs="opus"', 162_000), 'OPUS 162kbps');
  assert.equal(formatQualityBadge('audio/mp4; codecs="mp4a.40.2"', 256_000), 'AAC 256kbps');
});
