'use strict';

const semver = require('semver');

const UPDATE_REPOSITORY = Object.freeze({
  owner: 'feelthevenom',
  repo: 'Riri-Player',
});

const DEFAULT_RELEASE_CACHE_TTL_MS = 5 * 60 * 1000;
const releaseCache = new Map();

function normalizeVersion(value) {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  return trimmed.replace(/^v(?=\d)/i, '');
}

function parseVersion(value) {
  const normalized = normalizeVersion(value);
  return normalized ? semver.parse(normalized, { loose: false }) : null;
}

/**
 * Compare two strict SemVer versions.
 * Returns -1 when left is older, 0 when equal, and 1 when left is newer.
 */
function compareVersions(left, right) {
  const parsedLeft = parseVersion(left);
  const parsedRight = parseVersion(right);
  if (!parsedLeft || !parsedRight) {
    throw new Error(`Invalid version comparison: "${left}" and "${right}"`);
  }
  return semver.compare(parsedLeft, parsedRight);
}

function getUpdateAvailability(latestVersion, currentVersion) {
  const comparison = compareVersions(latestVersion, currentVersion);
  return {
    comparison,
    isCurrent: comparison === 0,
    isUpdateAvailable: comparison > 0,
  };
}

function getErrorMessage(error) {
  if (!error) return '';
  if (typeof error === 'string') return error;
  return error.message || error.stack || String(error);
}

/**
 * electron-updater reports a missing GitHub update manifest as a 404 while
 * looking for latest.yml. This is recoverable by comparing release tags.
 */
function isMissingUpdateMetadataError(error) {
  if (error?.code === 'ERR_UPDATER_CHANNEL_FILE_NOT_FOUND') return true;
  const message = getErrorMessage(error);
  if (/cannot find latest\.yml/i.test(message)) return true;
  return /latest\.yml/i.test(message) && /(?:http(?:error)?\s*)?404\b|not found/i.test(message);
}

function getPublicErrorMessage(error, fallback = 'Update check failed') {
  const message = getErrorMessage(error).split(/\r?\n/)[0].trim();
  return message.replace(/^(?:Error:\s*)+/i, '') || fallback;
}

async function fetchLatestGitHubRelease({
  owner = UPDATE_REPOSITORY.owner,
  repo = UPDATE_REPOSITORY.repo,
  appVersion = 'unknown',
  fetchImpl = globalThis.fetch,
  timeoutMs = 10_000,
  cacheTtlMs = DEFAULT_RELEASE_CACHE_TTL_MS,
} = {}) {
  if (typeof fetchImpl !== 'function') {
    throw new Error('Fetch API is unavailable');
  }

  const cacheKey = `${owner}/${repo}`;
  const cached = releaseCache.get(cacheKey);
  if (cacheTtlMs > 0 && cached && Date.now() - cached.cachedAt < cacheTtlMs) {
    return { ...cached.release, cached: true };
  }

  const controller = new AbortController();
  let didTimeout = false;
  const timeout = setTimeout(() => {
    didTimeout = true;
    controller.abort();
  }, timeoutMs);

  try {
    const response = await fetchImpl(
      `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/releases/latest`,
      {
        headers: {
          Accept: 'application/vnd.github+json',
          'User-Agent': `Riri-Player/${appVersion}`,
          'X-GitHub-Api-Version': '2022-11-28',
        },
        signal: controller.signal,
      },
    );

    if (!response.ok) {
      throw new Error(`GitHub release check failed (HTTP ${response.status})`);
    }

    const release = await response.json();
    const version = normalizeVersion(release?.tag_name || release?.name);
    if (!version || !semver.valid(version)) {
      throw new Error('GitHub release response did not contain a valid SemVer version');
    }

    const result = {
      version,
      tagName: release.tag_name || `v${version}`,
      name: release.name || `v${version}`,
      releaseDate: release.published_at || release.created_at || null,
      releaseNotes: release.body || '',
      htmlUrl: release.html_url || null,
      assets: Array.isArray(release.assets)
        ? release.assets.map((asset) => ({
            name: asset.name,
            url: asset.browser_download_url,
          }))
        : [],
      cached: false,
    };

    releaseCache.set(cacheKey, { cachedAt: Date.now(), release: result });
    return result;
  } catch (error) {
    if (didTimeout) {
      throw new Error(`GitHub release check timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function createUpdateInfoFromRelease(release) {
  return {
    version: release.version,
    releaseDate: release.releaseDate || new Date().toISOString(),
    releaseNotes: release.releaseNotes || '',
  };
}

module.exports = {
  UPDATE_REPOSITORY,
  compareVersions,
  createUpdateInfoFromRelease,
  fetchLatestGitHubRelease,
  getPublicErrorMessage,
  getUpdateAvailability,
  isMissingUpdateMetadataError,
  normalizeVersion,
  parseVersion,
};
