'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  compareVersions,
  createUpdateInfoFromRelease,
  fetchLatestGitHubRelease,
  getPublicErrorMessage,
  getUpdateAvailability,
  isMissingUpdateMetadataError,
  normalizeVersion,
} = require('./update-utils.cjs');

test('normalizeVersion removes a leading v and trims whitespace', () => {
  assert.equal(normalizeVersion(' v1.1.0 '), '1.1.0');
  assert.equal(normalizeVersion('1.2.0'), '1.2.0');
  assert.equal(normalizeVersion('version-1'), 'version-1');
});

test('compareVersions compares strict SemVer release versions', () => {
  assert.equal(compareVersions('1.1.0', 'v1.1.0'), 0);
  assert.equal(compareVersions('1.1.1', '1.1.0'), 1);
  assert.equal(compareVersions('1.0.9', '1.1.0'), -1);
  assert.equal(compareVersions('1.10.0', '1.9.0'), 1);
});

test('compareVersions rejects incomplete or malformed versions', () => {
  assert.throws(() => compareVersions('1.2', '1.2.0'), /Invalid version comparison/);
  assert.throws(() => compareVersions('01.2.3', '1.2.3'), /Invalid version comparison/);
});

test('compareVersions handles prerelease versions', () => {
  assert.equal(compareVersions('1.2.0-beta.1', '1.2.0'), -1);
  assert.equal(compareVersions('1.2.0-beta.2', '1.2.0-beta.1'), 1);
  assert.equal(compareVersions('1.2.0-beta.1', '1.2.0-beta.1'), 0);
});

test('getUpdateAvailability reports current, newer, and newer-than-release versions', () => {
  assert.deepEqual(getUpdateAvailability('1.1.0', '1.1.0'), {
    comparison: 0,
    isCurrent: true,
    isUpdateAvailable: false,
  });
  assert.deepEqual(getUpdateAvailability('1.2.0', '1.1.0'), {
    comparison: 1,
    isCurrent: false,
    isUpdateAvailable: true,
  });
  assert.deepEqual(getUpdateAvailability('1.0.0', '1.1.0'), {
    comparison: -1,
    isCurrent: false,
    isUpdateAvailable: false,
  });
});

test('missing latest.yml errors are recognized as recoverable', () => {
  const error = new Error(
    'Cannot find latest.yml in the latest release artifacts: HttpError: 404\nmethod: GET url: https://example.test/latest.yml',
  );
  assert.equal(isMissingUpdateMetadataError(error), true);
  assert.equal(
    isMissingUpdateMetadataError(
      Object.assign(new Error('Update metadata file was not found'), {
        code: 'ERR_UPDATER_CHANNEL_FILE_NOT_FOUND',
      }),
    ),
    true,
  );
  assert.equal(isMissingUpdateMetadataError(new Error('Network connection failed')), false);
});

test('public error messages omit response headers and stack details', () => {
  const error = new Error('Cannot find latest.yml: HttpError: 404\nHeaders: {\"secret\": \"value\"}');
  assert.equal(getPublicErrorMessage(error), 'Cannot find latest.yml: HttpError: 404');
});

test('fetchLatestGitHubRelease returns normalized release information', async () => {
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      tag_name: 'v1.1.0',
      name: 'Riri Player v1.1.0',
      published_at: '2026-11-23T10:57:46Z',
      body: 'Release notes',
      html_url: 'https://github.com/feelthevenom/Riri-Player/releases/tag/v1.1.0',
      assets: [],
    }),
  });

  const release = await fetchLatestGitHubRelease({ appVersion: '1.1.0', fetchImpl });
  assert.equal(release.version, '1.1.0');
  assert.equal(release.tagName, 'v1.1.0');
  assert.equal(release.releaseNotes, 'Release notes');
});

test('fetchLatestGitHubRelease reports non-success responses', async () => {
  const fetchImpl = async () => ({ ok: false, status: 403, json: async () => ({}) });
  await assert.rejects(
    fetchLatestGitHubRelease({
      owner: 'non-success-owner',
      repo: 'non-success-repo',
      appVersion: '1.1.0',
      fetchImpl,
    }),
    /HTTP 403/,
  );
});

test('fetchLatestGitHubRelease rejects release tags that are not strict SemVer', async () => {
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ tag_name: 'v1.2', assets: [] }),
  });
  await assert.rejects(
    fetchLatestGitHubRelease({
      owner: 'invalid-version-owner',
      repo: 'invalid-version-repo',
      appVersion: '1.1.0',
      fetchImpl,
    }),
    /valid SemVer version/,
  );
});

test('fetchLatestGitHubRelease caches a successful response briefly', async () => {
  let requestCount = 0;
  const fetchImpl = async () => {
    requestCount += 1;
    return {
      ok: true,
      status: 200,
      json: async () => ({ tag_name: 'v2.0.0', assets: [] }),
    };
  };

  const first = await fetchLatestGitHubRelease({
    owner: 'cache-test-owner',
    repo: 'cache-test-repo',
    appVersion: '1.1.0',
    fetchImpl,
    cacheTtlMs: 60_000,
  });
  const second = await fetchLatestGitHubRelease({
    owner: 'cache-test-owner',
    repo: 'cache-test-repo',
    appVersion: '1.1.0',
    fetchImpl,
    cacheTtlMs: 60_000,
  });

  assert.equal(requestCount, 1);
  assert.equal(first.cached, false);
  assert.equal(second.cached, true);
});

test('createUpdateInfoFromRelease keeps the version used for comparison', () => {
  const info = createUpdateInfoFromRelease({
    version: '1.1.0',
    releaseDate: '2026-11-23T10:57:46Z',
    releaseNotes: 'Notes',
  });
  assert.equal(info.version, '1.1.0');
  assert.equal(info.releaseDate, '2026-11-23T10:57:46Z');
});
