import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  configureCredentialStorage,
  getActiveYtAccount,
  getPendingYtAuthReset,
  getVaultDiagnostic,
  getYtPartitionTombstone,
  upsertYtAccount,
  YtResetPendingError,
  YtVaultUnreadableError,
  type StoredYtAccount,
} from './credentials.ts';
import type {
  ElectronBrowserWindowConstructorLike,
  ElectronSessionModuleLike,
} from './electronTypes.ts';
import { registerCookieRefreshCallback } from './innertube.ts';
import {
  closeCurrentAuthWin,
  configureElectronYtmCookieRefresh,
  getYtmAuthStatus,
  loginYouTubeMusicWindow,
  logoutYtmAccount,
  resetYtmAuth,
  restoreYtmAccountFromSession,
  YtmLogoutError,
  YtmPartitionOwnershipConflictError,
} from './auth.ts';

const temporaryDirectories: string[] = [];
const originalFetch = globalThis.fetch;

// The production YTM bundle is CommonJS and therefore has __dirname. The
// source-level ESM test runner does not, so provide the equivalent for the
// preload-path lookup exercised by the sign-in window.
(globalThis as typeof globalThis & { __dirname?: string }).__dirname =
  path.dirname(fileURLToPath(import.meta.url));

function createTestStorage(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'riri-auth-test-'));
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

function createAccount(
  id: string,
  email: string,
  cookie = `SAPISID=${id}-cookie; SID=${id}-session`,
): StoredYtAccount {
  return {
    id,
    name: email,
    handle: `@${email.split('@')[0]}`,
    email,
    accountIndex: 0,
    cookie,
    visitorData: `${id}-visitor`,
    dataSyncId: `${id}-sync`,
    addedAt: 1,
    lastValidatedAt: 1,
  };
}

function accountMenuResponse(email: string, name = email): Record<string, unknown> {
  return {
    activeAccountHeaderRenderer: {
      accountName: { simpleText: name },
      email: { simpleText: email },
      channelHandle: { runs: [{ text: `@${email.split('@')[0]}` }] },
      accountPhoto: { thumbnails: [{ url: `https://example.com/${email}.png` }] },
    },
  };
}

function fakeResponse(
  status: number,
  body: Record<string, unknown> = {},
): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response;
}

interface FakeSessionState {
  cookie: string;
  cleared: boolean;
  clearCalls: number;
}

function createFakeSessionModule(opts?: {
  cookie?: string;
  clearError?: Error;
  preserveCookieOnClear?: boolean;
  cookieNames?: string[];
}): {
  module: ElectronSessionModuleLike;
  session: ReturnType<typeof createFakeSession>;
  state: FakeSessionState;
} {
  const session = createFakeSession(opts);
  return {
    module: { fromPartition: () => session },
    session,
    state: session.state,
  };
}

function createFakeSession(opts?: {
  cookie?: string;
  clearError?: Error;
  preserveCookieOnClear?: boolean;
  cookieNames?: string[];
}) {
  const state: FakeSessionState = {
    cookie: opts?.cookie || '',
    cleared: false,
    clearCalls: 0,
  };
  const cookieNames = opts?.cookieNames || ['SAPISID', 'SID'];
  const cookies = () =>
    state.cookie
      ? cookieNames.map((name) => ({
          name,
          value: name === 'SID' ? `${state.cookie}-session` : state.cookie,
        }))
      : [];
  const session = {
    state,
    getUserAgent: () => 'test-agent',
    setUserAgent: () => undefined,
    clearCache: async () => undefined,
    webRequest: {
      onBeforeSendHeaders: () => undefined,
    },
    cookies: {
      get: async () => cookies(),
    },
    clearStorageData: async () => {
      state.clearCalls += 1;
      if (opts?.clearError) throw opts.clearError;
      state.cleared = true;
      if (!opts?.preserveCookieOnClear) state.cookie = '';
    },
  };
  return session;
}

interface LoginHarness {
  BrowserWindow: ElectronBrowserWindowConstructorLike;
  session: ElectronSessionModuleLike;
}

function createLoginHarness(cookieValues: string[]): LoginHarness {
  let cookieReadCount = 0;
  const session = {
    getUserAgent: () => 'test-agent',
    setUserAgent: () => undefined,
    clearCache: async () => undefined,
    webRequest: {
      onBeforeSendHeaders: () => undefined,
    },
    cookies: {
      get: async () => {
        const index = Math.min(
          Math.floor(cookieReadCount / 3),
          cookieValues.length - 1,
        );
        cookieReadCount += 1;
        const value = cookieValues[index] || '';
        return [
          { name: 'SAPISID', value },
          { name: 'SID', value: `${value}-session` },
        ];
      },
    },
    clearStorageData: async () => undefined,
  };

  const listeners = new Map<string, Array<(...args: unknown[]) => void>>();
  const emit = (event: string, ...args: unknown[]) => {
    for (const listener of listeners.get(event) || []) listener(...args);
  };
  const webContents = {
    getURL: () => 'https://music.youtube.com/',
    executeJavaScript: async () => ({
      loggedIn: true,
      visitorData: 'login-visitor',
      dataSyncId: 'login-sync',
    }),
    on: (event: string, listener: (...args: unknown[]) => void) => {
      const current = listeners.get(event) || [];
      current.push(listener);
      listeners.set(event, current);
    },
    once: (event: string, listener: (...args: unknown[]) => void) => {
      const current = listeners.get(event) || [];
      current.push(listener);
      listeners.set(event, current);
    },
    setUserAgent: () => undefined,
  };

  class FakeBrowserWindow {
    webContents = webContents;
    isDestroyed = () => false;
    close = () => emit('closed');
    show = () => undefined;
    on = (event: string, listener: (...args: unknown[]) => void) => {
      const current = listeners.get(event) || [];
      current.push(listener);
      listeners.set(event, current);
    };
    loadURL = async () => {
      queueMicrotask(() => emit('did-finish-load'));
    };
  }

  return {
    BrowserWindow: FakeBrowserWindow as unknown as ElectronBrowserWindowConstructorLike,
    session: { fromPartition: () => session },
  };
}

function createPartitionedLoginHarness(): {
  BrowserWindow: ElectronBrowserWindowConstructorLike;
  session: ElectronSessionModuleLike;
  partitions: Map<string, { cookie: string; clearCalls: number }>;
  windowPartitions: string[];
} {
  const partitions = new Map<string, { cookie: string; clearCalls: number }>();
  const windowPartitions: string[] = [];
  const getPartition = (name: string) => {
    let state = partitions.get(name);
    if (!state) {
      state = { cookie: '', clearCalls: 0 };
      partitions.set(name, state);
    }
    return state;
  };

  const sessionModule: ElectronSessionModuleLike = {
    fromPartition: (partition) => {
      const state = getPartition(partition);
      return {
        getUserAgent: () => 'test-agent',
        setUserAgent: () => undefined,
        clearCache: async () => undefined,
        webRequest: {
          onBeforeSendHeaders: () => undefined,
        },
        cookies: {
          get: async () =>
            state.cookie
              ? [
                  { name: 'SAPISID', value: state.cookie },
                  { name: 'SID', value: `${state.cookie}-session` },
                ]
              : [],
        },
        clearStorageData: async () => {
          state.clearCalls += 1;
          state.cookie = '';
        },
      };
    },
  };

  class FakeBrowserWindow {
    private readonly listeners = new Map<string, Array<(...args: unknown[]) => void>>();
    private readonly partition: string;
    readonly webContents = {
      getURL: () => 'https://music.youtube.com/',
      executeJavaScript: async () => ({
        loggedIn: true,
        visitorData: 'partitioned-visitor',
        dataSyncId: 'partitioned-sync',
      }),
      on: (event: string, listener: (...args: unknown[]) => void) => {
        const current = this.listeners.get(event) || [];
        current.push(listener);
        this.listeners.set(event, current);
      },
      once: (event: string, listener: (...args: unknown[]) => void) => {
        const current = this.listeners.get(event) || [];
        current.push(listener);
        this.listeners.set(event, current);
      },
      setUserAgent: () => undefined,
    };

    constructor(options?: Record<string, unknown>) {
      const webPreferences = options?.webPreferences as
        | { partition?: string }
        | undefined;
      this.partition = webPreferences?.partition || 'persist:ytm-login';
      windowPartitions.push(this.partition);
    }

    isDestroyed = () => false;
    close = () => undefined;
    show = () => undefined;
    on = (event: string, listener: (...args: unknown[]) => void) => {
      const current = this.listeners.get(event) || [];
      current.push(listener);
      this.listeners.set(event, current);
    };
    loadURL = async () => {
      getPartition(this.partition).cookie = 'new-account-cookie';
      queueMicrotask(() => {
        for (const listener of this.listeners.get('did-finish-load') || []) {
          listener();
        }
      });
    };
  }

  return {
    BrowserWindow: FakeBrowserWindow as unknown as ElectronBrowserWindowConstructorLike,
    session: sessionModule,
    partitions,
    windowPartitions,
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

test('main-process status distinguishes a readable empty vault from an unreadable vault', async () => {
  const emptyDirectory = createTestStorage();
  const emptySession = createFakeSessionModule();
  const emptyStatus = await restoreYtmAccountFromSession(emptySession.module);
  assert.equal(emptyStatus.loggedIn, false);
  assert.deepEqual(emptyStatus.accounts, []);
  assert.equal(await getVaultDiagnostic(), null);

  const unreadableDirectory = createTestStorage();
  const vaultPath = path.join(unreadableDirectory, 'session-vault.dat');
  fs.writeFileSync(
    vaultPath,
    `SAFE:${Buffer.from('not-json', 'utf8').toString('base64')}`,
    'utf8',
  );
  configureCredentialStorage({
    userDataPath: unreadableDirectory,
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
    () => getYtmAuthStatus(),
    (err: unknown) =>
      err instanceof YtVaultUnreadableError && err.diagnostic.unreadableFile === true,
  );
  await assert.rejects(
    () => restoreYtmAccountFromSession(emptySession.module),
    (err: unknown) =>
      err instanceof YtVaultUnreadableError && err.diagnostic.unreadableFile === true,
  );

  const diagnostic = await getVaultDiagnostic();
  assert.equal(diagnostic?.unreadableFile, true);
});

test('a failed partition clear reports logout failure and cannot resurrect the account', async () => {
  createTestStorage();
  const account = createAccount('account-a', 'a@example.com');
  await upsertYtAccount(account);

  const fake = createFakeSessionModule({
    cookie: 'partition-cookie',
    clearError: new Error('clear failed'),
  });
  globalThis.fetch = (async () =>
    fakeResponse(200, accountMenuResponse(account.email || ''))) as typeof fetch;

  await assert.rejects(
    () => logoutYtmAccount({ session: fake.module }),
    (err: unknown) =>
      err instanceof YtmLogoutError && /persistent browser session could not be cleared/i.test(err.message),
  );

  // The failed logout is not reported as success, and the account snapshot is
  // retained until the user retries.
  assert.equal((await getActiveYtAccount())?.id, account.id);
  assert.equal((await getYtPartitionTombstone())?.accountId, account.id);
  assert.equal(fake.state.cookie, 'partition-cookie');

  // Even if the stored credentials are later rejected, the stale partition
  // must not be imported back over the durable logout marker.
  globalThis.fetch = (async () => fakeResponse(401)) as typeof fetch;
  const status = await restoreYtmAccountFromSession(fake.module);
  assert.equal(status.loggedIn, false);
  assert.deepEqual(status.accounts, []);
});

test('logout rejects a partial residual authentication cookie', async () => {
  createTestStorage();
  const account = createAccount('account-a', 'a@example.com');
  await upsertYtAccount(account);

  const fake = createFakeSessionModule({
    cookie: 'partition-cookie',
    preserveCookieOnClear: true,
    cookieNames: ['SAPISID'],
  });
  globalThis.fetch = (async () =>
    fakeResponse(200, accountMenuResponse(account.email || ''))) as typeof fetch;

  await assert.rejects(
    () => logoutYtmAccount({ session: fake.module }),
    (err: unknown) =>
      err instanceof YtmLogoutError &&
      /sensitive authentication cookies are still present/i.test(err.message),
  );
  assert.equal((await getActiveYtAccount())?.id, account.id);
  assert.equal(fake.state.cookie, 'partition-cookie');
});

test('factory auth reset clears every account and its browser partition', async () => {
  createTestStorage();
  await upsertYtAccount({
    ...createAccount('account-a', 'a@example.com'),
    partitionName: 'persist:ytm-login-a',
  });
  await upsertYtAccount({
    ...createAccount('account-b', 'b@example.com'),
    partitionName: 'persist:ytm-login-b',
  });

  const fake = createFakeSessionModule({ cookie: 'partition-cookie' });
  const status = await resetYtmAuth(fake.module);
  assert.equal(status.loggedIn, false);
  assert.deepEqual(status.accounts, []);
  assert.equal(await getActiveYtAccount(), null);
  assert.equal(fake.state.clearCalls, 3);
});

test('no-accountId logout removes the account captured before partition validation', async () => {
  createTestStorage();
  const accountA = createAccount('account-a', 'a@example.com');
  const accountB = createAccount('account-b', 'b@example.com');
  await upsertYtAccount(accountA);

  const fake = createFakeSessionModule({ cookie: 'partition-cookie' });
  let releaseFetch!: () => void;
  let markFetchStarted!: () => void;
  const fetchStarted = new Promise<void>((resolve) => {
    markFetchStarted = resolve;
  });
  const fetchGate = new Promise<void>((resolve) => {
    releaseFetch = resolve;
  });
  globalThis.fetch = (async () => {
    markFetchStarted?.();
    await fetchGate;
    return fakeResponse(200, accountMenuResponse(accountA.email || ''));
  }) as typeof fetch;

  const logoutPromise = logoutYtmAccount({ session: fake.module });
  await fetchStarted;

  // Switch the active account while partition identity validation is pending.
  await upsertYtAccount(accountB);
  releaseFetch();

  const status = await logoutPromise;
  assert.equal(status.activeAccountId, accountB.id);
  assert.deepEqual(status.accounts.map((entry) => entry.id), [accountB.id]);
  assert.equal((await getActiveYtAccount())?.id, accountB.id);
});

test('a temporary 403 during sign-in verification returns a retryable error', async () => {
  createTestStorage();
  const harness = createLoginHarness(['old-cookie', 'fresh-cookie']);
  let validationCookie = '';
  globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    validationCookie = new Headers(init?.headers).get('Cookie') || '';
    return fakeResponse(403);
  }) as typeof fetch;

  const result = await loginYouTubeMusicWindow({
    BrowserWindow: harness.BrowserWindow,
    session: harness.session,
  });

  assert.equal(result.ok, false);
  assert.equal(result.retryable, true);
  assert.match(result.error || '', /temporarily unavailable/i);
  assert.match(validationCookie, /fresh-cookie/);
  assert.ok(!validationCookie.includes('old-cookie'));
  assert.equal(await getActiveYtAccount(), null);
});

test('adding an account uses a fresh partition without clearing the active account', async () => {
  createTestStorage();
  const accountA = createAccount('account-a', 'a@example.com');
  await upsertYtAccount(accountA);

  const harness = createPartitionedLoginHarness();
  harness.partitions.set('persist:ytm-login', {
    cookie: 'account-a-cookie',
    clearCalls: 0,
  });
  globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    const cookie = new Headers(init?.headers).get('Cookie') || '';
    return fakeResponse(
      200,
      accountMenuResponse(cookie.includes('new-account-cookie') ? 'b@example.com' : 'a@example.com'),
    );
  }) as typeof fetch;

  const result = await loginYouTubeMusicWindow({
    BrowserWindow: harness.BrowserWindow,
    session: harness.session,
    cleanPartition: true,
  });

  assert.equal(result.ok, true);
  const active = await getActiveYtAccount();
  assert.equal(active?.email, 'b@example.com');
  assert.ok(active?.partitionName);
  assert.notEqual(active?.partitionName, 'persist:ytm-login');
  assert.equal(harness.windowPartitions[0], active?.partitionName);
  assert.equal(harness.partitions.get('persist:ytm-login')?.clearCalls, 0);
});

test('re-signing the same legacy account migrates and invalidates its old partition', async () => {
  createTestStorage();
  const accountA = createAccount('account-a', 'a@example.com');
  await upsertYtAccount(accountA);

  const harness = createPartitionedLoginHarness();
  harness.partitions.set('persist:ytm-login', {
    cookie: 'account-a-cookie',
    clearCalls: 0,
  });
  globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    const cookie = new Headers(init?.headers).get('Cookie') || '';
    return fakeResponse(
      200,
      accountMenuResponse(cookie.includes('new-account-cookie') ? 'a@example.com' : 'a@example.com'),
    );
  }) as typeof fetch;

  const result = await loginYouTubeMusicWindow({
    BrowserWindow: harness.BrowserWindow,
    session: harness.session,
    cleanPartition: true,
  });

  assert.equal(result.ok, true);
  const active = await getActiveYtAccount();
  assert.equal(active?.email, 'a@example.com');
  assert.ok(active?.partitionName);
  assert.notEqual(active?.partitionName, 'persist:ytm-login');
  assert.equal(harness.partitions.get('persist:ytm-login')?.clearCalls, 1);
  assert.equal(
    (await getYtPartitionTombstone('persist:ytm-login'))?.accountId,
    accountA.id,
  );
});

test('an unreadable account-menu schema during sign-in returns a retryable error', async () => {
  createTestStorage();
  const harness = createLoginHarness(['old-cookie', 'fresh-cookie']);
  globalThis.fetch = (async () => fakeResponse(200, {})) as typeof fetch;

  const result = await loginYouTubeMusicWindow({
    BrowserWindow: harness.BrowserWindow,
    session: harness.session,
  });

  assert.equal(result.ok, false);
  assert.equal(result.retryable, true);
  assert.match(result.error || '', /could not be verified|temporarily unavailable/i);
  assert.equal(await getActiveYtAccount(), null);
});

test('a definitive 401 during sign-in verification is not reported as retryable', async () => {
  createTestStorage();
  const harness = createLoginHarness(['old-cookie', 'fresh-cookie']);
  globalThis.fetch = (async () => fakeResponse(401)) as typeof fetch;

  const result = await loginYouTubeMusicWindow({
    BrowserWindow: harness.BrowserWindow,
    session: harness.session,
  });

  assert.equal(result.ok, false);
  assert.equal(result.retryable, false);
  assert.match(result.error || '', /rejected/i);
  assert.equal(await getActiveYtAccount(), null);
});

test('an inconclusive active-account check never falls through to partition recovery', async () => {
  createTestStorage();
  const account = createAccount('account-a', 'a@example.com');
  await upsertYtAccount(account);

  const fake = createFakeSessionModule({ cookie: 'partition-cookie' });
  let fetchCount = 0;
  globalThis.fetch = (async () => {
    fetchCount += 1;
    return fakeResponse(403);
  }) as typeof fetch;

  const status = await restoreYtmAccountFromSession(fake.module);
  assert.equal(status.activeAccountId, account.id);
  assert.equal((await getActiveYtAccount())?.id, account.id);
  assert.equal(fetchCount, 1);
});

test('partition recovery cannot replace an account activated during asynchronous validation', async () => {
  createTestStorage();
  const accountA = createAccount('account-a', 'a@example.com');
  const accountB = createAccount('account-b', 'b@example.com');
  await upsertYtAccount(accountA);

  const fake = createFakeSessionModule({ cookie: 'partition-cookie' });
  let releasePartitionFetch!: () => void;
  let markPartitionFetchStarted!: () => void;
  const partitionFetchStarted = new Promise<void>((resolve) => {
    markPartitionFetchStarted = resolve;
  });
  const partitionFetchGate = new Promise<void>((resolve) => {
    releasePartitionFetch = resolve;
  });

  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url === 'https://music.youtube.com/') {
      return {
        ok: true,
        status: 200,
        json: async () => ({}),
        text: async () => '',
      } as Response;
    }
    const cookie = new Headers(init?.headers).get('Cookie') || '';
    if (cookie.includes('account-a-cookie')) return fakeResponse(401);
    if (cookie.includes('partition-cookie')) {
      markPartitionFetchStarted?.();
      await partitionFetchGate;
      return fakeResponse(200, accountMenuResponse('c@example.com'));
    }
    return fakeResponse(403);
  }) as typeof fetch;

  const restorePromise = restoreYtmAccountFromSession(fake.module);
  await partitionFetchStarted;

  // This account becomes active while the recovered partition account is being
  // verified. The recovery write must conflict rather than switch away from it.
  await upsertYtAccount(accountB);
  releasePartitionFetch();

  const status = await restorePromise;
  assert.equal(status.activeAccountId, accountB.id);
  assert.ok(!status.accounts.some((entry) => entry.email === 'c@example.com'));
  assert.equal((await getActiveYtAccount())?.id, accountB.id);
});

test('logout serializes with a cookie refresh before clearing the partition', async () => {
  createTestStorage();
  const account = {
    ...createAccount('account-a', 'a@example.com'),
    cookie: 'SAPISID=partition-cookie; SID=partition-cookie-session',
  };
  await upsertYtAccount(account);

  const fake = createFakeSessionModule({ cookie: 'partition-cookie' });
  let accountMenuRequests = 0;
  let releaseLogoutMenu!: () => void;
  let releaseRefreshMenu!: () => void;
  let markLogoutMenuStarted!: () => void;
  let markRefreshMenuStarted!: () => void;
  const logoutMenuStarted = new Promise<void>((resolve) => {
    markLogoutMenuStarted = resolve;
  });
  const refreshMenuStarted = new Promise<void>((resolve) => {
    markRefreshMenuStarted = resolve;
  });
  const logoutMenuGate = new Promise<void>((resolve) => {
    releaseLogoutMenu = resolve;
  });
  const refreshMenuGate = new Promise<void>((resolve) => {
    releaseRefreshMenu = resolve;
  });

  globalThis.fetch = (async (input: string | URL | Request) => {
    if (!String(input).includes('/youtubei/v1/account/account_menu')) {
      throw new Error('unexpected fetch');
    }
    accountMenuRequests += 1;
    if (accountMenuRequests === 1) {
      markLogoutMenuStarted();
      await logoutMenuGate;
    } else {
      markRefreshMenuStarted();
      await refreshMenuGate;
    }
    return fakeResponse(200, accountMenuResponse(account.email || ''));
  }) as typeof fetch;

  const refresh = configureElectronYtmCookieRefresh(() => fake.session);
  const logoutPromise = logoutYtmAccount({ session: fake.module });
  await logoutMenuStarted;

  // Simulate the partition rotating its cookie while logout is waiting for
  // account-menu validation. A refresh that is allowed to run concurrently
  // would replace the vault cookie and make logout clear the partition before
  // discovering the conflict.
  fake.state.cookie = 'refreshed-cookie';
  const refreshPromise = refresh(account.id);
  const refreshReachedMenu = await Promise.race([
    refreshMenuStarted.then(() => true),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 100)),
  ]);

  if (refreshReachedMenu) {
    releaseRefreshMenu();
    await refreshPromise;
  }
  releaseLogoutMenu();

  const status = await logoutPromise;
  await refreshPromise;
  assert.equal(status.loggedIn, false);
  assert.deepEqual(status.accounts, []);
  assert.equal((await getActiveYtAccount()), null);
  assert.equal(fake.state.clearCalls, 1);
});

test('logout validates the target delegated account context and rejects a verified mismatch', async () => {
  createTestStorage();
  const account = {
    ...createAccount('brand-account', 'brand@example.com'),
    accountIndex: 3,
    dataSyncId: 'brand-page||brand-user',
    partitionName: 'persist:ytm-login-brand',
  };
  await upsertYtAccount(account);

  const fake = createFakeSessionModule({ cookie: 'partition-cookie' });
  let capturedHeaders: Headers | null = null;
  let capturedBody = '';
  globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    capturedHeaders = new Headers(init?.headers);
    capturedBody = String(init?.body || '');
    return fakeResponse(200, accountMenuResponse('different@example.com'));
  }) as typeof fetch;

  await assert.rejects(
    () => logoutYtmAccount({ session: fake.module, accountId: account.id }),
    (err: unknown) => err instanceof YtmPartitionOwnershipConflictError,
  );

  assert.equal((await getActiveYtAccount())?.id, account.id);
  assert.equal(fake.state.clearCalls, 0);
  assert.ok(capturedHeaders);
  const headers = capturedHeaders as Headers;
  assert.equal(headers.get('X-Goog-AuthUser'), '3');
  assert.equal(headers.get('X-Goog-PageId'), 'brand-page');
  assert.match(capturedBody, /onBehalfOfUser/);
  assert.match(capturedBody, /brand-page/);
});

test('a factory reset does not clear browser partitions when its vault write fails', async () => {
  const directory = createTestStorage();
  const account = {
    ...createAccount('account-a', 'a@example.com'),
    partitionName: 'persist:ytm-login-a',
  };
  await upsertYtAccount(account);

  configureCredentialStorage({
    userDataPath: directory,
    safeStorage: {
      isEncryptionAvailable: () => true,
      encryptString: () => {
        throw new Error('simulated vault write failure');
      },
      decryptString: (encrypted: Buffer) => encrypted.toString('utf8'),
    },
  });

  const fake = createFakeSessionModule({ cookie: 'partition-cookie' });
  await assert.rejects(
    () => resetYtmAuth(fake.module),
    /simulated vault write failure/i,
  );

  assert.equal(fake.state.clearCalls, 0);
  assert.equal((await getActiveYtAccount())?.id, account.id);
});

test('a staged factory reset rejects accounts added while partitions are being cleared', async () => {
  createTestStorage();
  const accountA = {
    ...createAccount('account-a', 'a@example.com'),
    partitionName: 'persist:ytm-login-a',
  };
  await upsertYtAccount(accountA);

  let releaseClear!: () => void;
  let markClearStarted!: () => void;
  const clearStarted = new Promise<void>((resolve) => {
    markClearStarted = resolve;
  });
  const clearGate = new Promise<void>((resolve) => {
    releaseClear = resolve;
  });
  const state = { clearCalls: 0 };
  const session = {
    getUserAgent: () => 'test-agent',
    setUserAgent: () => undefined,
    clearCache: async () => undefined,
    webRequest: { onBeforeSendHeaders: () => undefined },
    cookies: { get: async () => [] },
    clearStorageData: async () => {
      state.clearCalls += 1;
      markClearStarted();
      await clearGate;
    },
  };
  const sessionModule = { fromPartition: () => session };

  const resetPromise = resetYtmAuth(sessionModule);
  await clearStarted;
  await assert.rejects(
    () => upsertYtAccount(createAccount('account-b', 'b@example.com')),
    (err: unknown) => err instanceof YtResetPendingError,
  );
  releaseClear();

  const status = await resetPromise;
  assert.equal(status.loggedIn, false);
  assert.deepEqual(status.accounts, []);
  assert.equal(await getActiveYtAccount(), null);
  assert.equal(await getPendingYtAuthReset(), null);
});

test('a pending factory reset is recovered on the next status check', async () => {
  createTestStorage();
  await upsertYtAccount({
    ...createAccount('account-a', 'a@example.com'),
    partitionName: 'persist:ytm-login-a',
  });

  let clearAttempts = 0;
  const state = { clearCalls: 0 };
  const session = {
    getUserAgent: () => 'test-agent',
    setUserAgent: () => undefined,
    clearCache: async () => undefined,
    webRequest: { onBeforeSendHeaders: () => undefined },
    cookies: { get: async () => [] },
    clearStorageData: async () => {
      clearAttempts += 1;
      state.clearCalls += 1;
      if (clearAttempts === 1) throw new Error('simulated clear failure');
    },
  };
  const sessionModule = { fromPartition: () => session };

  await assert.rejects(
    () => resetYtmAuth(sessionModule),
    (err: unknown) => err instanceof YtmLogoutError,
  );
  assert.ok(await getPendingYtAuthReset());
  assert.equal(await getActiveYtAccount(), null);

  const status = await restoreYtmAccountFromSession(sessionModule);
  assert.equal(status.loggedIn, false);
  assert.deepEqual(status.accounts, []);
  assert.equal(await getPendingYtAuthReset(), null);
  assert.equal(state.clearCalls, 3);
});

test('a cancelled sign-in cannot publish after asynchronous account validation', async () => {
  createTestStorage();
  const accountA = {
    ...createAccount('account-a', 'a@example.com'),
    partitionName: 'persist:ytm-login-a',
  };
  await upsertYtAccount(accountA);

  const harness = createPartitionedLoginHarness();
  let releaseMenu!: () => void;
  let markMenuStarted!: () => void;
  const menuStarted = new Promise<void>((resolve) => {
    markMenuStarted = resolve;
  });
  const menuGate = new Promise<void>((resolve) => {
    releaseMenu = resolve;
  });
  globalThis.fetch = (async () => {
    markMenuStarted();
    await menuGate;
    return fakeResponse(200, accountMenuResponse('b@example.com'));
  }) as typeof fetch;

  const loginPromise = loginYouTubeMusicWindow({
    BrowserWindow: harness.BrowserWindow,
    session: harness.session,
    cleanPartition: true,
  });
  await menuStarted;
  closeCurrentAuthWin();
  releaseMenu();

  const result = await loginPromise;
  assert.equal(result.ok, false);
  assert.equal(result.cancelled, true);
  assert.equal((await getActiveYtAccount())?.id, accountA.id);
  assert.ok(!(await getActiveYtAccount())?.email?.includes('b@example.com'));
});

test('factory reset cancels and awaits an active sign-in before staging accounts', async () => {
  createTestStorage();
  const accountA = {
    ...createAccount('account-a', 'a@example.com'),
    partitionName: 'persist:ytm-login-a',
  };
  await upsertYtAccount(accountA);

  const harness = createPartitionedLoginHarness();
  let releaseMenu!: () => void;
  let markMenuStarted!: () => void;
  const menuStarted = new Promise<void>((resolve) => {
    markMenuStarted = resolve;
  });
  const menuGate = new Promise<void>((resolve) => {
    releaseMenu = resolve;
  });
  globalThis.fetch = (async () => {
    markMenuStarted();
    await menuGate;
    return fakeResponse(200, accountMenuResponse('b@example.com'));
  }) as typeof fetch;

  const loginPromise = loginYouTubeMusicWindow({
    BrowserWindow: harness.BrowserWindow,
    session: harness.session,
    cleanPartition: true,
  });
  await menuStarted;

  const status = await resetYtmAuth(harness.session);
  assert.equal(status.loggedIn, false);
  assert.deepEqual(status.accounts, []);
  assert.equal(await getActiveYtAccount(), null);

  releaseMenu();
  const loginResult = await loginPromise;
  assert.equal(loginResult.ok, false);
  assert.equal(loginResult.cancelled, true);
  assert.equal(await getActiveYtAccount(), null);
});
