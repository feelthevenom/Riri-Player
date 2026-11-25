import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  configureCredentialStorage,
  getActiveYtAccount,
  getAnonymousVisitorData,
  getPublicYtAuthStatus,
  getSafeStoragePlaintext,
  getVaultDiagnostic,
  getYtPartitionTombstone,
  invalidateVaultCache,
  markYtPartitionInvalidated,
  resetYtVaultWithBackup,
  setAnonymousVisitorData,
  switchActiveYtAccount,
  updateActiveYtAccountAuth,
  upsertYtAccount,
  YtAccountNotFoundError,
  YtVaultUnreadableError,
  type StoredYtAccount,
} from './credentials.ts';

const temporaryDirectories: string[] = [];

function createTestStorage(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'riri-vault-test-'));
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
  return directory;
}

function createAccount(): StoredYtAccount {
  return {
    id: 'ytm-test-account',
    name: 'Test Listener',
    email: 'listener@example.com',
    accountIndex: 0,
    cookie: 'SAPISID=secret-session-cookie',
    visitorData: 'visitor-data',
    dataSyncId: 'data-sync-id',
    addedAt: 1,
    lastValidatedAt: 1,
  };
}

test.afterEach(() => {
  configureCredentialStorage({});
  while (temporaryDirectories.length > 0) {
    const directory = temporaryDirectories.pop();
    if (directory) fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('getSafeStoragePlaintext accepts Electron async decrypt results', () => {
  assert.equal(
    getSafeStoragePlaintext({ result: '{"loggedIn":true}', shouldReEncrypt: true }),
    '{"loggedIn":true}',
  );
});

test('getSafeStoragePlaintext remains compatible with direct string results', () => {
  assert.equal(getSafeStoragePlaintext('plaintext'), 'plaintext');
});

test('getSafeStoragePlaintext rejects malformed decrypt results', () => {
  assert.throws(
    () => getSafeStoragePlaintext({ result: '' } as never),
    /invalid decrypted value/i,
  );
});

test('vault account and visitor data persist across a cache reload', async () => {
  const directory = createTestStorage();
  const account = createAccount();

  await upsertYtAccount(account);
  await setAnonymousVisitorData('anonymous-visitor-data');
  await invalidateVaultCache();

  const active = await getActiveYtAccount();
  assert.equal(active?.id, account.id);
  assert.equal(active?.cookie, account.cookie);
  assert.equal(await getAnonymousVisitorData(), 'anonymous-visitor-data');
  assert.equal((await getPublicYtAuthStatus()).activeAccountId, account.id);

  const rawVault = fs.readFileSync(path.join(directory, 'session-vault.dat'), 'utf8');
  assert.ok(rawVault.startsWith('SAFE:'));
  assert.equal(rawVault.includes(account.cookie), false);
  assert.equal(
    fs.readdirSync(directory).filter((name) => name.includes('.tmp')).length,
    0,
  );
});

test('a rotated safeStorage key re-encrypts the vault without losing the account', async () => {
  const directory = createTestStorage();
  let encryptCalls = 0;
  configureCredentialStorage({
    userDataPath: directory,
    safeStorage: {
      isAsyncEncryptionAvailable: async () => true,
      encryptStringAsync: async (plainText: string) => {
        encryptCalls += 1;
        return Buffer.from(`enc${encryptCalls}:${plainText}`, 'utf8');
      },
      decryptStringAsync: async (encrypted: Buffer) => {
        const stored = encrypted.toString('utf8');
        return {
          result: stored.slice(stored.indexOf(':') + 1),
          shouldReEncrypt: true,
        };
      },
    },
  });

  const account = createAccount();
  await upsertYtAccount(account);
  const encryptCallsBeforeRead = encryptCalls;
  await invalidateVaultCache();
  assert.equal((await getActiveYtAccount())?.id, account.id);

  const deadline = Date.now() + 1000;
  let reencryptedPayload = '';
  while (Date.now() < deadline) {
    const rawVault = fs.readFileSync(path.join(directory, 'session-vault.dat'), 'utf8');
    reencryptedPayload = Buffer.from(
      rawVault.slice('SAFE:'.length),
      'base64',
    ).toString('utf8');
    if (reencryptedPayload.startsWith('enc2:')) break;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  assert.ok(encryptCalls > encryptCallsBeforeRead);
  assert.ok(reencryptedPayload.startsWith('enc2:'));
  const persisted = JSON.parse(reencryptedPayload.slice('enc2:'.length)) as {
    ytAccounts: StoredYtAccount[];
    activeYtAccountId: string | null;
  };
  assert.equal(persisted.activeYtAccountId, account.id);
  assert.equal(persisted.ytAccounts[0]?.cookie, account.cookie);
});

test('an unreadable existing vault is never overwritten', async () => {
  const directory = createTestStorage();
  const vaultPath = path.join(directory, 'session-vault.dat');
  const original = `SAFE:${Buffer.from('unreadable-original-vault', 'utf8').toString('base64')}`;
  fs.writeFileSync(vaultPath, original, 'utf8');
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

  await assert.rejects(
    () => upsertYtAccount(createAccount()),
    (err: unknown) =>
      err instanceof YtVaultUnreadableError && /refusing to overwrite/i.test(err.message),
  );
  await assert.rejects(
    () => setAnonymousVisitorData('must-not-overwrite'),
    (err: unknown) =>
      err instanceof YtVaultUnreadableError && /refusing to overwrite/i.test(err.message),
  );
  assert.equal(fs.readFileSync(vaultPath, 'utf8'), original);
});

test('an unreadable vault is a failure rather than a confirmed empty status', async () => {
  const directory = createTestStorage();
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

  await assert.rejects(
    () => getPublicYtAuthStatus(),
    (err: unknown) =>
      err instanceof YtVaultUnreadableError && err.diagnostic.unreadableFile === true,
  );

  const diagnostic = await getVaultDiagnostic();
  assert.equal(diagnostic?.unreadableFile, true);
  assert.match(diagnostic?.error || '', /JSON|unexpected|parse/i);

  // The failure remains visible until an explicit cache invalidation/retry.
  assert.equal((await getVaultDiagnostic())?.unreadableFile, true);
  await invalidateVaultCache();
  assert.equal((await getVaultDiagnostic())?.unreadableFile, true);
});

test('a readable empty vault is reported as an empty logged-out status', async () => {
  createTestStorage();

  const status = await getPublicYtAuthStatus();
  assert.equal(status.loggedIn, false);
  assert.deepEqual(status.accounts, []);
  assert.equal(await getVaultDiagnostic(), null);
});

test('a logout tombstone blocks partition recovery until an explicit sign-in', async () => {
  createTestStorage();
  const account = createAccount();
  await upsertYtAccount(account);

  const tombstone = await markYtPartitionInvalidated(account.id);
  assert.equal(tombstone.accountId, account.id);
  assert.equal((await getYtPartitionTombstone())?.generation, tombstone.generation);

  await assert.rejects(
    () => upsertYtAccount({ ...account, cookie: 'SAPISID=partition-cookie' }, {
      source: 'partition-restore',
    }),
    /invalidated by logout/i,
  );

  // An explicit sign-in/import is authoritative and may replace the marker.
  await upsertYtAccount({ ...account, cookie: 'SAPISID=explicit-cookie' });
  assert.equal(await getYtPartitionTombstone(), null);
});

test('partition recovery cannot replace a refreshed active-account snapshot', async () => {
  createTestStorage();
  const account = createAccount();
  await upsertYtAccount(account);
  await updateActiveYtAccountAuth({ cookie: 'SAPISID=refreshed-cookie' }, account.id);

  await assert.rejects(
    () => upsertYtAccount(
      { ...account, id: 'ytm-recovered', email: 'recovered@example.com', cookie: 'SAPISID=partition-cookie' },
      {
        expectedActiveAccountId: account.id,
        expectedActiveAccountCookie: account.cookie,
        source: 'partition-restore',
      },
    ),
    /credentials changed/i,
  );

  assert.equal((await getActiveYtAccount())?.id, account.id);
  assert.equal((await getActiveYtAccount())?.cookie, 'SAPISID=refreshed-cookie');
});

test('concurrent account and visitor-data updates preserve both vault fields', async () => {
  const directory = createTestStorage();
  const account = createAccount();

  await Promise.all([
    upsertYtAccount(account),
    setAnonymousVisitorData('concurrent-visitor-data'),
  ]);
  await invalidateVaultCache();

  const rawVault = fs.readFileSync(path.join(directory, 'session-vault.dat'), 'utf8');
  const persisted = JSON.parse(
    Buffer.from(rawVault.slice('SAFE:'.length), 'base64').toString('utf8'),
  ) as {
    ytAccounts: StoredYtAccount[];
    activeYtAccountId: string | null;
    anonymousVisitorData: string;
  };

  assert.equal(persisted.activeYtAccountId, account.id);
  assert.equal(persisted.ytAccounts[0]?.cookie, account.cookie);
  assert.equal(persisted.anonymousVisitorData, 'concurrent-visitor-data');
});

test('an account with the same email updates the existing vault entry', async () => {
  createTestStorage();
  const account = createAccount();
  await upsertYtAccount(account);

  const status = await upsertYtAccount({
    ...account,
    id: 'ytm-refreshed-account-id',
    cookie: 'SAPISID=refreshed-session-cookie',
  });

  assert.equal(status.accounts.length, 1);
  assert.equal(status.activeAccountId, account.id);
  assert.equal((await getActiveYtAccount())?.cookie, 'SAPISID=refreshed-session-cookie');
});

test('accounts with different emails remain distinct vault entries', async () => {
  createTestStorage();
  const firstAccount = createAccount();
  const secondAccount: StoredYtAccount = {
    ...createAccount(),
    id: 'ytm-distinct-account',
    name: 'Distinct Listener',
    email: 'distinct@example.com',
    cookie: 'SAPISID=distinct-session-cookie',
  };

  await upsertYtAccount(firstAccount);
  const status = await upsertYtAccount(secondAccount);

  assert.equal(status.accounts.length, 2);
  assert.equal(status.activeAccountId, secondAccount.id);
  const accounts = status.accounts.map((account) => account.email).sort();
  assert.deepEqual(accounts, ['distinct@example.com', 'listener@example.com']);
});

test('switching to an unknown account fails instead of reporting a false success', async () => {
  createTestStorage();
  const account = createAccount();
  await upsertYtAccount(account);

  await assert.rejects(
    () => switchActiveYtAccount('missing-account'),
    (err: unknown) => err instanceof YtAccountNotFoundError,
  );
  assert.equal((await getActiveYtAccount())?.id, account.id);
  assert.equal((await getPublicYtAuthStatus()).activeAccountId, account.id);
});

test('an explicit vault reset preserves the unreadable original as a backup', async () => {
  const directory = createTestStorage();
  const vaultPath = path.join(directory, 'session-vault.dat');
  const original = `SAFE:${Buffer.from('unreadable-original-vault', 'utf8').toString('base64')}`;
  fs.writeFileSync(vaultPath, original, 'utf8');
  let unreadable = true;
  configureCredentialStorage({
    userDataPath: directory,
    safeStorage: {
      isAsyncEncryptionAvailable: async () => true,
      encryptStringAsync: async (plainText: string) => Buffer.from(plainText, 'utf8'),
      decryptStringAsync: async (encrypted: Buffer) => ({
        result: unreadable ? 'not-json' : encrypted.toString('utf8'),
        shouldReEncrypt: false,
      }),
    },
  });

  const result = await resetYtVaultWithBackup();
  assert.ok(result.backupPath);
  assert.equal(fs.readFileSync(result.backupPath as string, 'utf8'), original);
  assert.notEqual(fs.readFileSync(vaultPath, 'utf8'), original);
  unreadable = false;
  const status = await getPublicYtAuthStatus();
  assert.equal(status.loggedIn, false);
  assert.deepEqual(status.accounts, []);
});

test('logout tombstones are isolated by browser partition', async () => {
  createTestStorage();
  await markYtPartitionInvalidated('account-a', 'persist:ytm-login-a');
  await markYtPartitionInvalidated('account-b', 'persist:ytm-login-b');

  assert.equal(
    (await getYtPartitionTombstone('persist:ytm-login-a'))?.accountId,
    'account-a',
  );
  assert.equal(
    (await getYtPartitionTombstone('persist:ytm-login-b'))?.accountId,
    'account-b',
  );
  assert.equal(await getYtPartitionTombstone('persist:ytm-login-c'), null);
});

test('a stale cookie refresh cannot overwrite a newly active account', async () => {
  createTestStorage();
  const firstAccount = createAccount();
  const secondAccount: StoredYtAccount = {
    ...createAccount(),
    id: 'ytm-second-account',
    name: 'Second Listener',
    email: 'second@example.com',
    cookie: 'SAPISID=second-session-cookie',
  };

  await upsertYtAccount(firstAccount);
  await upsertYtAccount(secondAccount);
  const updated = await updateActiveYtAccountAuth(
    { cookie: 'SAPISID=stale-refresh-cookie' },
    firstAccount.id,
  );

  assert.equal(updated, false);
  assert.equal((await getActiveYtAccount())?.id, secondAccount.id);
  assert.equal((await getActiveYtAccount())?.cookie, secondAccount.cookie);
});

test('an explicit vault reset preserves logout tombstones', async () => {
  createTestStorage();
  await markYtPartitionInvalidated('account-a', 'persist:ytm-login-a');

  await resetYtVaultWithBackup();
  assert.equal(
    (await getYtPartitionTombstone('persist:ytm-login-a'))?.accountId,
    'account-a',
  );

  await invalidateVaultCache();
  assert.equal(
    (await getYtPartitionTombstone('persist:ytm-login-a'))?.accountId,
    'account-a',
  );
});

test('resetting an unreadable vault preserves tombstones from the sidecar registry', async () => {
  const directory = createTestStorage();
  await markYtPartitionInvalidated('account-a', 'persist:ytm-login-a');

  const vaultPath = path.join(directory, 'session-vault.dat');
  fs.writeFileSync(
    vaultPath,
    `SAFE:${Buffer.from('unreadable-original-vault', 'utf8').toString('base64')}`,
    'utf8',
  );
  let unreadable = true;
  configureCredentialStorage({
    userDataPath: directory,
    safeStorage: {
      isAsyncEncryptionAvailable: async () => true,
      encryptStringAsync: async (plainText: string) => Buffer.from(plainText, 'utf8'),
      decryptStringAsync: async (encrypted: Buffer) => ({
        result: unreadable ? 'not-json' : encrypted.toString('utf8'),
        shouldReEncrypt: false,
      }),
    },
  });

  await resetYtVaultWithBackup();
  unreadable = false;
  await invalidateVaultCache();
  const preserved = await getYtPartitionTombstone('persist:ytm-login-a');
  assert.ok(preserved);
  assert.equal(preserved.accountId, null);
});

test('separate credential bundle copies share configuration, cache, and operation state', async () => {
  const firstDirectory = createTestStorage();
  const secondDirectory = createTestStorage();
  const sharedCopyPath = './credentials.ts?shared-store-copy=1';
  const secondCopy = await import(sharedCopyPath);
  assert.notEqual(secondCopy.upsertYtAccount, upsertYtAccount);

  secondCopy.configureCredentialStorage({
    userDataPath: secondDirectory,
    safeStorage: {
      isAsyncEncryptionAvailable: async () => true,
      encryptStringAsync: async (plainText: string) => Buffer.from(plainText, 'utf8'),
      decryptStringAsync: async (encrypted: Buffer) => ({
        result: encrypted.toString('utf8'),
        shouldReEncrypt: false,
      }),
    },
  });

  // The first copy must observe the second copy's configuration through the
  // process-global registry rather than retaining its own fallback path.
  assert.equal((await getActiveYtAccount()), null);
  await secondCopy.upsertYtAccount(createAccount());
  assert.equal((await getActiveYtAccount())?.id, 'ytm-test-account');
  assert.ok(
    fs.existsSync(path.join(secondDirectory, 'session-vault.dat')),
    'the shared store should write to the configured directory',
  );
  assert.equal(
    fs.existsSync(path.join(firstDirectory, 'session-vault.dat')),
    false,
    'the first bundle copy should not retain a separate vault path',
  );
});
