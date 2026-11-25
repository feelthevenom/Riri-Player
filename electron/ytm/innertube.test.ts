import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  configureCredentialStorage,
  removeYtAccountById,
  upsertYtAccount,
  type StoredYtAccount,
} from './credentials.ts';
import {
  InnerTubeAuthenticationError,
  innerTubePost,
  registerCookieRefreshCallback,
} from './innertube.ts';

const temporaryDirectories: string[] = [];
const originalFetch = globalThis.fetch;

function createAccount(
  id: string,
  email: string,
  cookie: string,
  visitorData: string,
): StoredYtAccount {
  return {
    id,
    name: email,
    email,
    accountIndex: 0,
    cookie,
    visitorData,
    dataSyncId: `${id}-sync`,
    addedAt: 1,
    lastValidatedAt: 1,
  };
}

test.afterEach(() => {
  globalThis.fetch = originalFetch;
  registerCookieRefreshCallback(null);
  configureCredentialStorage({});
  while (temporaryDirectories.length > 0) {
    const directory = temporaryDirectories.pop();
    if (directory) fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('an account override keeps one account snapshot for the request', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'riri-innertube-test-'));
  temporaryDirectories.push(directory);
  configureCredentialStorage({
    userDataPath: directory,
    safeStorage: {
      isAsyncEncryptionAvailable: async () => true,
      encryptStringAsync: async (plainText: string) => Buffer.from(plainText, 'utf8'),
      decryptStringAsync: async (encrypted: Buffer) => ({
        result: encrypted.toString('utf8'),
        shouldReEncrypt: false,
      }),
    },
  });

  const accountA = createAccount(
    'account-a',
    'a@example.com',
    'SAPISID=account-a-cookie; SID=account-a-session',
    'visitor-a',
  );
  const accountB = createAccount(
    'account-b',
    'b@example.com',
    'SAPISID=account-b-cookie; SID=account-b-session',
    'visitor-b',
  );
  await upsertYtAccount(accountA);
  await upsertYtAccount(accountB);

  let capturedHeaders: Headers | null = null;
  globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    capturedHeaders = new Headers(init?.headers);
    return {
      ok: true,
      status: 200,
      json: async () => ({ ok: true }),
      text: async () => '',
    } as Response;
  }) as typeof fetch;

  await innerTubePost({
    endpoint: 'browse',
    body: { browseId: 'FEmusic_home' },
    requireAuth: true,
    accountOverride: accountA,
  });

  assert.ok(capturedHeaders);
  const headers = capturedHeaders as Headers;
  assert.equal(headers.get('Cookie'), accountA.cookie);
  assert.equal(headers.get('X-Goog-Visitor-Id'), accountA.visitorData);
  assert.ok(!headers.get('Cookie')?.includes('account-b-cookie'));
});

test('a refresh cannot fall through to a newly active account when the expected account disappears', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'riri-innertube-test-'));
  temporaryDirectories.push(directory);
  configureCredentialStorage({
    userDataPath: directory,
    safeStorage: {
      isAsyncEncryptionAvailable: async () => true,
      encryptStringAsync: async (plainText: string) => Buffer.from(plainText, 'utf8'),
      decryptStringAsync: async (encrypted: Buffer) => ({
        result: encrypted.toString('utf8'),
        shouldReEncrypt: false,
      }),
    },
  });

  const accountA = createAccount(
    'account-a',
    'a@example.com',
    'SAPISID=account-a-cookie; SID=account-a-session',
    'visitor-a',
  );
  const accountB = createAccount(
    'account-b',
    'b@example.com',
    'SAPISID=account-b-cookie; SID=account-b-session',
    'visitor-b',
  );
  await upsertYtAccount(accountA);

  registerCookieRefreshCallback(async (expectedAccountId) => {
    assert.equal(expectedAccountId, accountA.id);
    // Simulate an account switch during refresh and remove the account whose
    // credentials the request was already scoped to.
    await upsertYtAccount(accountB);
    await removeYtAccountById(accountA.id, accountA);
    return true;
  });

  let fetchCount = 0;
  const capturedCookies: string[] = [];
  globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    fetchCount += 1;
    capturedCookies.push(new Headers(init?.headers).get('Cookie') || '');
    return {
      ok: false,
      status: 401,
      json: async () => ({}),
      text: async () => 'expired',
    } as Response;
  }) as typeof fetch;

  await assert.rejects(
    () => innerTubePost({
      endpoint: 'browse',
      body: { browseId: 'FEmusic_home' },
      requireAuth: true,
    }),
    (err: unknown) =>
      err instanceof InnerTubeAuthenticationError && /removed during the credential refresh/i.test(err.message),
  );

  assert.equal(fetchCount, 1);
  assert.deepEqual(capturedCookies, [accountA.cookie]);
  assert.ok(!capturedCookies.some((cookie) => cookie.includes('account-b-cookie')));
});
