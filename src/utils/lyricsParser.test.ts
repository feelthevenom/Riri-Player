import test from 'node:test';
import assert from 'node:assert/strict';
import { findActiveLyricIndex, formatTime, parseLrcLyrics } from './lyricsParser';

test('parseLrcLyrics parses sorted timestamps and skips blank lines', () => {
  const raw = `[00:12.50] Second line
[00:02.10] First line
[00:25.00]
[01:05.250] Third line`;
  const lines = parseLrcLyrics(raw);
  assert.equal(lines.length, 3);
  assert.deepEqual(
    lines.map((l) => [l.timeMs, l.text]),
    [
      [2100, 'First line'],
      [12500, 'Second line'],
      [65250, 'Third line'],
    ],
  );
});

test('findActiveLyricIndex handles offsets and boundaries', () => {
  const lines = parseLrcLyrics('[00:05.00] A\n[00:10.00] B\n[00:20.00] C');
  assert.equal(findActiveLyricIndex(lines, 4000, 0), -1);
  assert.equal(findActiveLyricIndex(lines, 5000, 0), 0);
  assert.equal(findActiveLyricIndex(lines, 15000, 0), 1);
  assert.equal(findActiveLyricIndex(lines, 19500, 600), 2);
});

test('formatTime formats mm:ss and hh:mm:ss', () => {
  assert.equal(formatTime(0), '0:00');
  assert.equal(formatTime(65), '1:05');
  assert.equal(formatTime(3661), '1:01:01');
  assert.equal(formatTime(-5), '0:00');
});
