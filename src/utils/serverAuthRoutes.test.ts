import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { configureCredentialStorage } from '../../electron/ytm/credentials';
import { startAppServer } from '../../server';

test('HTTP YouTube Music auth routes return a structured unreadable-vault error', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'riri-server-auth-test-'));
  const vaultPath = path.join(directory, 'session-vault.dat');
  fs.writeFileSync(
    vaultPath,
    `SAFE:${Buffer.from('not-json', 'utf8').toString('base64')}`,
    'utf8',
  );
  configureCredentialStorage({
    userDataPath: directory,
    safeStorage: {
      isAsyncEncryptionAvailable: async () => true,
      encryptStringAsync: async (plainText: string) => Buffer.from(plainText, 'utf8'),
      decryptStringAsync: async () => ({
        result: 'not-json',
        shouldReEncrypt: false,
      }),
    },
  });

  const started = await startAppServer({
    port: 0,
    host: '127.0.0.1',
    distDir: path.join(process.cwd(), 'dist'),
  });

  try {
    const response = await fetch(`http://127.0.0.1:${started.port}/api/auth/ytm/status`);
    const body = (await response.json()) as {
      ok?: boolean;
      error?: string;
      diagnostic?: { unreadableFile?: boolean };
    };
    assert.equal(response.status, 503);
    assert.equal(body.ok, false);
    assert.equal(body.diagnostic?.unreadableFile, true);
    assert.match(body.error || '', /vault is unreadable/i);

    const libraryResponse = await fetch(
      `http://127.0.0.1:${started.port}/api/ytmusic/library`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gl: 'US', hl: 'en' }),
      },
    );
    assert.equal(libraryResponse.status, 503);
    const libraryBody = (await libraryResponse.json()) as { ok?: boolean };
    assert.equal(libraryBody.ok, false);
  } finally {
    await new Promise<void>((resolve) => started.server.close(() => resolve()));
    configureCredentialStorage({});
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
