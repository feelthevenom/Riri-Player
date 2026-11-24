import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import type {
  SpotifyConnection,
  UnmatchedSpotifyTrack,
  YtAccountSummary,
  YtAuthStatusPayload,
} from '../../src/types/music';

export interface StoredYtAccount {
  id: string;
  name: string;
  handle?: string;
  email?: string;
  avatarUrl?: string;
  accountIndex: number;
  cookie: string;
  visitorData: string;
  dataSyncId: string;
  poToken?: string;
  addedAt: number;
  lastValidatedAt?: number;
}

export interface StoredSpotifyCredentials {
  userId: string;
  displayName: string;
  email?: string;
  avatarUrl?: string;
  profileUrl?: string;
  spDc: string;
  spKey: string;
  accessToken?: string;
  expiresAt?: number;
  syncSchedule: 'MANUAL' | 'DAILY' | 'WEEKLY' | 'YEARLY';
  lastSyncedAt?: number;
  lastSyncedCount?: number;
  unmatchedTracks?: UnmatchedSpotifyTrack[];
  lastError?: string;
}

interface StoredVaultPayload {
  ytAccounts: StoredYtAccount[];
  activeYtAccountId: string | null;
  anonymousVisitorData: string;
  spotify: StoredSpotifyCredentials | null;
}

const DEFAULT_VAULT: StoredVaultPayload = {
  ytAccounts: [],
  activeYtAccountId: null,
  anonymousVisitorData: '',
  spotify: null,
};

let cachedVault: StoredVaultPayload | null = null;
let vaultCacheValid = false;
let vaultDiagnostic: { error?: string; unreadableFile?: boolean; encryptionAvailable?: boolean } | null = null;
let electronBridge: {
  userDataPath?: string;
  safeStorage?: {
    isEncryptionAvailable?: () => boolean;
    encryptString?: (plainText: string) => Buffer;
    decryptString?: (cipherText: Buffer) => string;
    isAsyncEncryptionAvailable?: () => Promise<boolean>;
    encryptStringAsync?: (plainText: string) => Promise<Buffer>;
    decryptStringAsync?: (cipherText: Buffer) => Promise<string>;
  };
} = {};

export function configureCredentialStorage(opts: {
  userDataPath?: string;
  safeStorage?: {
    isEncryptionAvailable?: () => boolean;
    encryptString?: (plainText: string) => Buffer;
    decryptString?: (cipherText: Buffer) => string;
    isAsyncEncryptionAvailable?: () => Promise<boolean>;
    encryptStringAsync?: (plainText: string) => Promise<Buffer>;
    decryptStringAsync?: (cipherText: Buffer) => Promise<string>;
  };
}) {
  electronBridge = opts;
  cachedVault = null;
  vaultCacheValid = false;
}

function getVaultFilePath(): string {
  const baseDir =
    electronBridge.userDataPath || path.join(os.homedir(), '.riri-player');
  try {
    if (!fs.existsSync(baseDir)) {
      fs.mkdirSync(baseDir, { recursive: true, mode: 0o700 });
    }
  } catch {
    // ignore
  }
  return path.join(baseDir, 'session-vault.dat');
}

function getMachineKey(): Buffer {
  const salt = `${os.hostname()}|${os.userInfo().username}|riri-player-vault-v1`;
  return crypto.scryptSync(salt, 'riri-session-salt', 32);
}

function encryptFallback(plaintext: string): string {
  const iv = crypto.randomBytes(12);
  const key = getMachineKey();
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `AES:${iv.toString('base64')}:${tag.toString('base64')}:${enc.toString('base64')}`;
}

function decryptFallback(encoded: string): string {
  const [, ivB64, tagB64, dataB64] = encoded.split(':');
  const key = getMachineKey();
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    key,
    Buffer.from(ivB64, 'base64'),
  );
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  const dec = Buffer.concat([
    decipher.update(Buffer.from(dataB64, 'base64')),
    decipher.final(),
  ]);
  return dec.toString('utf8');
}

async function decryptVaultBuffer(buf: Buffer): Promise<string> {
  const ss = electronBridge.safeStorage;

  // Per Electron docs, the async encryptor is initialized lazily the first time
  // decryptStringAsync is called after app ready. Calling it directly triggers
  // initialization — don't wait for isAsyncEncryptionAvailable() alone.
  if (ss?.decryptStringAsync) {
    let lastErr: unknown = null;
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        return await ss.decryptStringAsync(buf);
      } catch (err) {
        lastErr = err;
        // Brief backoff between retries to let the encryptor initialize.
        await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
      }
    }
    throw lastErr;
  }

  if (ss?.isEncryptionAvailable && ss.decryptString && ss.isEncryptionAvailable()) {
    return ss.decryptString(buf);
  }

  throw new Error('Encryption is not available.');
}

async function readVault(): Promise<StoredVaultPayload> {
  // Return cached successful read
  if (vaultCacheValid && cachedVault) return cachedVault;

  const filePath = getVaultFilePath();
  if (!fs.existsSync(filePath)) {
    // Don't cache a missing file — it may be created later (e.g. after sign-in).
    return { ...DEFAULT_VAULT };
  }

  vaultDiagnostic = null;
  try {
    const raw = fs.readFileSync(filePath, 'utf8').trim();
    let jsonStr = '';
    if (raw.startsWith('SAFE:')) {
      const buf = Buffer.from(raw.slice(5), 'base64');
      try {
        jsonStr = await decryptVaultBuffer(buf);
      } catch (err) {
        // Preserve the unreadable vault file and report the error. Do NOT cache
        // the empty result — safeStorage may not be ready yet on Windows, and
        // the next call should retry decryption.
        vaultDiagnostic = {
          error: err instanceof Error ? err.message : 'Failed to decrypt session vault.',
          unreadableFile: true,
        };
        vaultCacheValid = false;
        cachedVault = null;
        return { ...DEFAULT_VAULT };
      }
    } else if (raw.startsWith('AES:')) {
      jsonStr = decryptFallback(raw);
    } else {
      jsonStr = raw;
    }

    const parsed = JSON.parse(jsonStr) as Partial<StoredVaultPayload>;
    cachedVault = {
      ytAccounts: Array.isArray(parsed.ytAccounts) ? parsed.ytAccounts : [],
      activeYtAccountId: parsed.activeYtAccountId || null,
      anonymousVisitorData: parsed.anonymousVisitorData || '',
      spotify: parsed.spotify || null,
    };
    vaultCacheValid = true;
    vaultDiagnostic = null;
    return cachedVault;
  } catch (err) {
    vaultDiagnostic = {
      error: err instanceof Error ? err.message : 'Failed to read session vault.',
      unreadableFile: true,
    };
    vaultCacheValid = false;
    cachedVault = null;
    return { ...DEFAULT_VAULT };
  }
}

async function writeVault(vault: StoredVaultPayload): Promise<void> {
  cachedVault = vault;
  vaultCacheValid = true;
  const filePath = getVaultFilePath();
  const plaintext = JSON.stringify(vault);
  let serialized = '';
  const ss = electronBridge.safeStorage;

  // Encrypt with retry — the async encryptor initializes lazily on first call.
  if (ss?.encryptStringAsync) {
    let lastErr: unknown = null;
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const enc = await ss.encryptStringAsync(plaintext);
        serialized = `SAFE:${enc.toString('base64')}`;
        break;
      } catch (err) {
        lastErr = err;
        await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
      }
    }
    if (!serialized) throw lastErr;
  } else if (ss?.isEncryptionAvailable && ss.encryptString && ss.isEncryptionAvailable()) {
    const enc = ss.encryptString(plaintext);
    serialized = `SAFE:${enc.toString('base64')}`;
  } else {
    serialized = encryptFallback(plaintext);
  }

  try {
    fs.writeFileSync(filePath, serialized, { encoding: 'utf8', mode: 0o600 });
  } catch {
    // ignore disk failure
  }
}

export function getVaultDiagnostic(): { error?: string; unreadableFile?: boolean; encryptionAvailable?: boolean } | null {
  return vaultDiagnostic;
}

export function invalidateVaultCache(): void {
  vaultCacheValid = false;
  cachedVault = null;
}

export async function getActiveYtAccount(): Promise<StoredYtAccount | null> {
  const vault = await readVault();
  if (vault.ytAccounts.length === 0) return null;
  const found = vault.ytAccounts.find((a) => a.id === vault.activeYtAccountId);
  return found || vault.ytAccounts[0];
}

export async function getAnonymousVisitorData(): Promise<string> {
  return (await readVault()).anonymousVisitorData || '';
}

export async function setAnonymousVisitorData(visitorData: string): Promise<void> {
  if (!visitorData) return;
  const vault = await readVault();
  if (vault.anonymousVisitorData === visitorData) return;
  await writeVault({ ...vault, anonymousVisitorData: visitorData });
}

export async function upsertYtAccount(account: StoredYtAccount): Promise<YtAuthStatusPayload> {
  const vault = await readVault();
  const existingIdx = vault.ytAccounts.findIndex(
    (a) =>
      a.id === account.id ||
      (account.email && a.email && a.email.toLowerCase() === account.email.toLowerCase()),
  );
  const nextAccounts = [...vault.ytAccounts];
  if (existingIdx >= 0) {
    nextAccounts[existingIdx] = {
      ...nextAccounts[existingIdx],
      ...account,
      id: nextAccounts[existingIdx].id,
      addedAt: nextAccounts[existingIdx].addedAt,
    };
  } else {
    nextAccounts.unshift(account);
  }
  const activeId = existingIdx >= 0 ? nextAccounts[existingIdx].id : account.id;
  await writeVault({
    ...vault,
    ytAccounts: nextAccounts,
    activeYtAccountId: activeId,
  });
  return await getPublicYtAuthStatus();
}

export async function updateActiveYtAccountAuth(patch: Partial<StoredYtAccount>): Promise<void> {
  const vault = await readVault();
  const active = await getActiveYtAccount();
  if (!active) return;
  const nextAccounts = vault.ytAccounts.map((a) =>
    a.id === active.id ? { ...a, ...patch } : a,
  );
  await writeVault({ ...vault, ytAccounts: nextAccounts });
}

export async function switchActiveYtAccount(accountId: string): Promise<YtAuthStatusPayload> {
  const vault = await readVault();
  const exists = vault.ytAccounts.find((a) => a.id === accountId);
  if (!exists) return await getPublicYtAuthStatus();
  await writeVault({ ...vault, activeYtAccountId: exists.id });
  return await getPublicYtAuthStatus();
}

export async function removeYtAccountById(accountId?: string): Promise<YtAuthStatusPayload> {
  const vault = await readVault();
  const targetId = accountId || vault.activeYtAccountId;
  const nextAccounts = vault.ytAccounts.filter((a) => a.id !== targetId);
  const nextActive =
    nextAccounts.length === 0
      ? null
      : vault.activeYtAccountId === targetId
        ? nextAccounts[0].id
        : vault.activeYtAccountId;
  await writeVault({
    ...vault,
    ytAccounts: nextAccounts,
    activeYtAccountId: nextActive,
  });
  return await getPublicYtAuthStatus();
}

export async function getPublicYtAuthStatus(): Promise<YtAuthStatusPayload> {
  const vault = await readVault();
  const active = await getActiveYtAccount();
  const accounts: YtAccountSummary[] = vault.ytAccounts.map((acc) => ({
    id: acc.id,
    name: acc.name,
    handle: acc.handle,
    email: acc.email,
    avatarUrl: acc.avatarUrl,
    accountIndex: acc.accountIndex,
    visitorData: acc.visitorData,
    addedAt: acc.addedAt,
  }));
  return {
    loggedIn: Boolean(active),
    accountName: active?.name || '',
    email: active?.email || active?.handle || '',
    avatar: active?.avatarUrl || '',
    accountIndex: active?.accountIndex ?? 0,
    visitorData: active?.visitorData || vault.anonymousVisitorData || '',
    accounts,
  };
}

export async function getSpotifyCredentials(): Promise<StoredSpotifyCredentials | null> {
  return (await readVault()).spotify;
}

export async function setSpotifyCredentials(
  spotify: StoredSpotifyCredentials | null,
): Promise<SpotifyConnection | null> {
  const vault = await readVault();
  await writeVault({ ...vault, spotify });
  return await getPublicSpotifyConnection();
}

export async function updateSpotifyCredentials(
  patch: Partial<StoredSpotifyCredentials>,
): Promise<SpotifyConnection | null> {
  const current = await getSpotifyCredentials();
  if (!current) return null;
  return await setSpotifyCredentials({ ...current, ...patch });
}

export async function getPublicSpotifyConnection(): Promise<SpotifyConnection | null> {
  const sp = await getSpotifyCredentials();
  if (!sp || !sp.spDc) return null;
  return {
    userId: sp.userId,
    displayName: sp.displayName,
    email: sp.email,
    avatarUrl: sp.avatarUrl,
    profileUrl: sp.profileUrl,
    loggedIn: true,
    syncSchedule: sp.syncSchedule || 'MANUAL',
    lastSyncedAt: sp.lastSyncedAt,
    lastSyncedCount: sp.lastSyncedCount,
    unmatchedCount: sp.unmatchedTracks?.length || 0,
    unmatchedTracks: sp.unmatchedTracks || [],
    lastError: sp.lastError,
  };
}