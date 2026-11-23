'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '..');
const releaseDir = path.join(rootDir, 'release');
const metadataPath = path.join(releaseDir, 'latest.yml');
const packagePath = path.join(rootDir, 'package.json');

function fail(message) {
  console.error(`[release-metadata] ${message}`);
  process.exitCode = 1;
}

if (!fs.existsSync(metadataPath)) {
  fail('release/latest.yml was not generated.');
  process.exit(process.exitCode || 1);
}

const metadata = fs.readFileSync(metadataPath, 'utf8');
const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
const versionMatch = metadata.match(/^version:\s*['"]?([^'"\s]+)['"]?\s*$/m);
const metadataVersion = versionMatch?.[1];

if (!metadataVersion) {
  fail('release/latest.yml does not contain a version.');
} else if (metadataVersion !== packageJson.version) {
  fail(
    `release/latest.yml version ${metadataVersion} does not match package.json version ${packageJson.version}.`,
  );
}

const fileEntries = [
  ...metadata.matchAll(
    /^[ \t]*-[ \t]+url:[ \t]*['"]?([^'"\r\n]+?)['"]?[ \t]*\r?\n[ \t]+sha512:[ \t]*['"]?([^'"\s]+)['"]?[ \t]*(?:\r?\n[ \t]+size:[ \t]*(\d+))?/gm,
  ),
].map((match) => ({
  url: match[1].trim(),
  sha512: match[2].trim(),
  size: match[3] ? Number(match[3]) : null,
}));

if (fileEntries.length === 0) {
  fail('release/latest.yml does not reference any update files.');
}

for (const entry of fileEntries) {
  const fileName = path.basename(entry.url.replace(/\\/g, '/'));
  const filePath = path.join(releaseDir, fileName);

  if (!fs.existsSync(filePath)) {
    fail(`release/latest.yml references "${fileName}", but that file does not exist in release/.`);
    continue;
  }

  const actualSize = fs.statSync(filePath).size;
  if (entry.size !== null && entry.size !== actualSize) {
    fail(`release/${fileName} size ${actualSize} does not match latest.yml size ${entry.size}.`);
  }

  const actualSha512 = crypto
    .createHash('sha512')
    .update(fs.readFileSync(filePath))
    .digest('base64');
  if (actualSha512 !== entry.sha512) {
    fail(`release/${fileName} SHA-512 does not match latest.yml.`);
  }
}

const fileUrls = fileEntries.map((entry) => entry.url);

const setupAsset = fileUrls.find((fileUrl) => /-Setup-.*\.exe$/i.test(fileUrl));

if (!setupAsset) {
  fail('release/latest.yml does not reference a Windows setup executable.');
} else {
  const setupFile = path.basename(setupAsset.replace(/\\/g, '/'));
  const blockmapPath = path.join(releaseDir, `${setupFile}.blockmap`);
  if (!fs.existsSync(blockmapPath)) {
    fail(`Missing setup blockmap: release/${path.basename(blockmapPath)}`);
  }
}

const releaseFiles = fs.readdirSync(releaseDir);
const expectedPortableName = `Riri.Player-Portable-${packageJson.version}-win-x64.exe`;
if (!releaseFiles.includes(expectedPortableName)) {
  fail(`Missing portable executable: release/${expectedPortableName}`);
}

if (process.exitCode) {
  process.exit(process.exitCode);
}

console.log(
  `[release-metadata] Validated v${metadataVersion}: ${fileUrls.length} update file reference(s).`,
);
