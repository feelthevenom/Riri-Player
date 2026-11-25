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

/** Original shared Electron partition used by accounts saved before per-account isolation. */
export const LEGACY_YTM_PARTITION = 'persist:ytm-login';

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
  /**
   * Electron partition that owns this account's browser session. Legacy
   * accounts without this field use the original shared login partition.
   */
  partitionName?: string;
  poToken?: string;
  addedAt: number;
  lastValidatedAt?: number;
}

export interface VaultDiagnostic {
  error?: string;
  unreadableFile?: boolean;
  encryptionAvailable?: boolean;
}

export class YtVaultUnreadableError extends Error {
  readonly diagnostic: VaultDiagnostic;

  constructor(diagnostic: VaultDiagnostic) {
    const detail = diagnostic.error?.trim();
    const message = detail?.startsWith('Session vault is unreadable;')
      ? detail
      : detail
        ? `Session vault is unreadable; refusing to treat the account as signed out. ${detail}`
        : 'Session vault is unreadable; refusing to treat the account as signed out.';
    super(message);
    this.name = 'YtVaultUnreadableError';
    this.diagnostic = { ...diagnostic, unreadableFile: true };
  }
}

export class YtAccountStateConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'YtAccountStateConflictError';
  }
}

export class YtSessionInvalidatedError extends Error {
  constructor(message = 'The persistent YouTube Music session was invalidated by logout.') {
    super(message);
    this.name = 'YtSessionInvalidatedError';
  }
}

export class YtAccountNotFoundError extends Error {
  constructor(accountId: string) {
    super(`YouTube Music account ${accountId} was not found.`);
    this.name = 'YtAccountNotFoundError';
  }
}

export class YtAuthOperationCancelledError extends Error {
  constructor(message = 'The YouTube Music authentication operation was cancelled.') {
    super(message);
    this.name = 'YtAuthOperationCancelledError';
  }
}

export class YtResetPendingError extends Error {
  constructor(message = 'A YouTube Music factory reset is still in progress.') {
    super(message);
    this.name = 'YtResetPendingError';
  }
}

/**
 * A durable marker that prevents the shared Electron partition from being
 * treated as an authoritative recovery source after logout. The marker lives
 * in the encrypted vault and is cleared only by an explicit sign-in/import.
 */
export interface YtPartitionTombstone {
  generation: number;
  accountId: string | null;
  invalidatedAt: number;
  /** Browser partition that was invalidated. */
  partitionName?: string;
}

/**
 * Durable state for a factory reset that has removed the vault accounts but
 * not yet finished clearing every browser partition.
 */
export interface YtResetPendingState {
  generation: number;
  accountIds: string[];
  partitionNames: string[];
  startedAt: number;
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
  /** Legacy single-marker field retained for old vault compatibility. */
  ytPartitionTombstone: YtPartitionTombstone | null;
  /** Per-partition logout markers prevent one account's logout from reviving another. */
  ytPartitionTombstones: YtPartitionTombstone[];
  /** A reset remains pending until every captured partition has been cleared. */
  ytResetPending: YtResetPendingState | null;
}

const DEFAULT_VAULT: StoredVaultPayload = {
  ytAccounts: [],
  activeYtAccountId: null,
  anonymousVisitorData: '',
  spotify: null,
  ytPartitionTombstone: null,
  ytPartitionTombstones: [],
  ytResetPending: null,
};

interface CredentialStorageBridge {
  userDataPath?: string;
  safeStorage?: {
    isEncryptionAvailable?: () => boolean;
    encryptString?: (plainText: string) => Buffer;
    decryptString?: (cipherText: Buffer) => string;
    isAsyncEncryptionAvailable?: () => Promise<boolean>;
    encryptStringAsync?: (plainText: string) => Promise<Buffer>;
    decryptStringAsync?: (
      cipherText: Buffer,
    ) => Promise<string | { result: string; shouldReEncrypt?: boolean }>;
  };
}

interface CredentialStoreState {
  electronBridge: CredentialStorageBridge;
  cachedVault: StoredVaultPayload | null;
  vaultCacheValid: boolean;
  vaultDiagnostic: VaultDiagnostic | null;
  vaultOperationQueue: Promise<void>;
  vaultReencryptScheduled: boolean;
}

/**
 * The packaged server bundle is loaded by Electron before the YTM IPC bundle
 * registers its handlers. Detect Electron's storage bridge at module load so
 * the server copy never creates or reads the standalone fallback vault. The
 * dynamic module name intentionally keeps the normal Node/development build
 * free of a static `electron` dependency.
 */
function detectElectronCredentialStorage(): CredentialStorageBridge {
  if (!process.versions.electron) return {};
  try {
    const runtimeRequire: NodeRequire | null =
      typeof require === 'function' ? require : null;
    if (!runtimeRequire) return {};
    const electronModuleName = 'electron';
    const electron = runtimeRequire(electronModuleName) as {
      app?: { getPath?: (name: string) => string };
      safeStorage?: NonNullable<CredentialStorageBridge['safeStorage']>;
    };
    if (!electron.app?.getPath || !electron.safeStorage) return {};
    return {
      userDataPath: electron.app.getPath('userData'),
      safeStorage: electron.safeStorage,
    };
  } catch {
    return {};
  }
}

/**
 * The desktop build loads the HTTP server and YTM IPC code as two separate
 * bundles in one Node process. Keep all mutable credential state behind one
 * process-wide symbol so those bundle copies cannot read or overwrite
 * different cached snapshots of the same vault.
 */
const CREDENTIAL_STORE_REGISTRY_KEY = Symbol.for(
  'riri-player.ytm.credential-store.v1',
);

function createCredentialStoreState(): CredentialStoreState {
  return {
    electronBridge: detectElectronCredentialStorage(),
    cachedVault: null,
    vaultCacheValid: false,
    vaultDiagnostic: null,
    vaultOperationQueue: Promise.resolve(),
    vaultReencryptScheduled: false,
  };
}

function getCredentialStoreState(): CredentialStoreState {
  const registry = globalThis as unknown as Record<PropertyKey, unknown>;
  const existing = registry[CREDENTIAL_STORE_REGISTRY_KEY];
  if (
    existing &&
    typeof existing === 'object' &&
    'electronBridge' in existing &&
    'vaultOperationQueue' in existing
  ) {
    const state = existing as CredentialStoreState;
    if (!state.electronBridge || typeof state.electronBridge !== 'object') {
      state.electronBridge = {};
    }
    const detected = detectElectronCredentialStorage();
    if (detected.userDataPath && !state.electronBridge.userDataPath) {
      state.electronBridge = {
        ...detected,
        ...state.electronBridge,
      };
    }
    return state;
  }
  const created = createCredentialStoreState();
  registry[CREDENTIAL_STORE_REGISTRY_KEY] = created;
  return created;
}

const credentialStore = getCredentialStoreState();

/**
 * Serializes every vault read and read-modify-write operation. Without this,
 * an asynchronous decrypt can finish after a newer write and republish an old
 * snapshot, or an anonymous visitor-data refresh can overwrite a freshly saved
 * account.
 */
function enqueueVaultOperation<T>(operation: () => Promise<T>): Promise<T> {
  const result = credentialStore.vaultOperationQueue.then(operation, operation);
  credentialStore.vaultOperationQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

export function configureCredentialStorage(opts: {
  userDataPath?: string;
  safeStorage?: {
    isEncryptionAvailable?: () => boolean;
    encryptString?: (plainText: string) => Buffer;
    decryptString?: (cipherText: Buffer) => string;
    isAsyncEncryptionAvailable?: () => Promise<boolean>;
    encryptStringAsync?: (plainText: string) => Promise<Buffer>;
    decryptStringAsync?: (
      cipherText: Buffer,
    ) => Promise<string | { result: string; shouldReEncrypt?: boolean }>;
  };
}) {
  credentialStore.electronBridge = opts;
  credentialStore.cachedVault = null;
  credentialStore.vaultCacheValid = false;
  credentialStore.vaultDiagnostic = null;
}

function getVaultFilePath(): string {
  const baseDir =
    credentialStore.electronBridge.userDataPath || path.join(os.homedir(), '.riri-player');
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

export type SafeStorageDecryptResult =
  | string
  | { result: string; shouldReEncrypt?: boolean };

export function getSafeStoragePlaintext(decrypted: SafeStorageDecryptResult): string {
  if (typeof decrypted === 'string') return decrypted;
  if (decrypted && typeof decrypted.result === 'string' && decrypted.result.length > 0) {
    return decrypted.result;
  }
  throw new Error('SafeStorage returned an invalid decrypted value.');
}

interface VaultDecryptDetails {
  plaintext: string;
  shouldReEncrypt: boolean;
}

async function decryptVaultBuffer(buf: Buffer): Promise<VaultDecryptDetails> {
  const ss = credentialStore.electronBridge.safeStorage;

  // Per Electron docs, the async encryptor is initialized lazily the first time
  // decryptStringAsync is called after app ready. Calling it directly triggers
  // initialization — don't wait for isAsyncEncryptionAvailable() alone.
  if (ss?.decryptStringAsync) {
    let lastErr: unknown = null;
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const decrypted = await ss.decryptStringAsync(buf);
        // Electron 45 returns { result, shouldReEncrypt } from the async API,
        // while older builds returned the plaintext string directly.
        if (typeof decrypted === 'string') {
          return { plaintext: decrypted, shouldReEncrypt: false };
        }
        if (decrypted && typeof decrypted.result === 'string') {
          return {
            plaintext: getSafeStoragePlaintext(decrypted),
            shouldReEncrypt: Boolean(decrypted.shouldReEncrypt),
          };
        }
        throw new Error('SafeStorage returned an invalid decrypted value.');
      } catch (err) {
        lastErr = err;
        // Brief backoff between retries to let the encryptor initialize.
        await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
      }
    }
    throw lastErr;
  }

  if (ss?.isEncryptionAvailable && ss.decryptString && ss.isEncryptionAvailable()) {
    return { plaintext: ss.decryptString(buf), shouldReEncrypt: false };
  }

  throw new Error('Encryption is not available.');
}

interface VaultReadResult {
  vault: StoredVaultPayload;
  unreadable: boolean;
}

function normalizePartitionTombstone(value: unknown): YtPartitionTombstone | null {
  if (!value || typeof value !== 'object') return null;
  const tombstone = value as Partial<YtPartitionTombstone>;
  if (
    typeof tombstone.generation !== 'number' ||
    !Number.isFinite(tombstone.generation) ||
    typeof tombstone.invalidatedAt !== 'number' ||
    !Number.isFinite(tombstone.invalidatedAt)
  ) {
    return null;
  }
  const partitionName =
    typeof tombstone.partitionName === 'string' && tombstone.partitionName.trim()
      ? tombstone.partitionName.trim()
      : LEGACY_YTM_PARTITION;
  return {
    generation: tombstone.generation,
    accountId: typeof tombstone.accountId === 'string' ? tombstone.accountId : null,
    invalidatedAt: tombstone.invalidatedAt,
    partitionName,
  };
}

function latestPartitionTombstone(
  tombstones: YtPartitionTombstone[],
): YtPartitionTombstone | null {
  if (tombstones.length === 0) return null;
  return tombstones.reduce((latest, tombstone) =>
    tombstone.generation > latest.generation ? tombstone : latest,
  );
}

function dedupePartitionTombstones(
  tombstones: YtPartitionTombstone[],
): YtPartitionTombstone[] {
  const byPartition = new Map<string, YtPartitionTombstone>();
  for (const tombstone of tombstones) {
    const partitionName = tombstone.partitionName || LEGACY_YTM_PARTITION;
    const normalized = { ...tombstone, partitionName };
    const previous = byPartition.get(partitionName);
    if (!previous || normalized.generation > previous.generation) {
      byPartition.set(partitionName, normalized);
    }
  }
  return Array.from(byPartition.values()).sort(
    (left, right) => left.generation - right.generation,
  );
}

function normalizeYtResetPending(value: unknown): YtResetPendingState | null {
  if (!value || typeof value !== 'object') return null;
  const pending = value as Partial<YtResetPendingState>;
  if (
    typeof pending.generation !== 'number' ||
    !Number.isFinite(pending.generation) ||
    typeof pending.startedAt !== 'number' ||
    !Number.isFinite(pending.startedAt)
  ) {
    return null;
  }
  const accountIds = Array.isArray(pending.accountIds)
    ? pending.accountIds.filter((id): id is string => typeof id === 'string' && Boolean(id))
    : [];
  const partitionNames = Array.isArray(pending.partitionNames)
    ? pending.partitionNames.filter(
        (name): name is string => typeof name === 'string' && Boolean(name.trim()),
      )
    : [];
  return {
    generation: pending.generation,
    accountIds,
    partitionNames: partitionNames.map((name) => name.trim()),
    startedAt: pending.startedAt,
  };
}

/**
 * Tombstones and reset state are mirrored to a small sidecar so an unreadable
 * encrypted vault can still be reset without forgetting which browser
 * partitions were explicitly invalidated. The sidecar contains no cookies or
 * credentials.
 */
interface CredentialSidecar {
  tombstones: YtPartitionTombstone[];
  resetPending: YtResetPendingState | null;
}

function getTombstoneRegistryPath(): string {
  return `${getVaultFilePath()}.tombstones.json`;
}

function readCredentialSidecar(): CredentialSidecar {
  try {
    const registryPath = getTombstoneRegistryPath();
    if (!fs.existsSync(registryPath)) {
      return { tombstones: [], resetPending: null };
    }
    const parsed = JSON.parse(fs.readFileSync(registryPath, 'utf8')) as {
      tombstones?: unknown;
      resetPending?: unknown;
    };
    const tombstones = Array.isArray(parsed.tombstones)
      ? dedupePartitionTombstones(
          parsed.tombstones
            .map(normalizePartitionTombstone)
            .filter((tombstone): tombstone is YtPartitionTombstone => Boolean(tombstone)),
        )
      : [];
    return {
      tombstones,
      resetPending: normalizeYtResetPending(parsed.resetPending),
    };
  } catch {
    return { tombstones: [], resetPending: null };
  }
}

function writeCredentialSidecar(
  tombstones: YtPartitionTombstone[],
  resetPending: YtResetPendingState | null,
): void {
  const registryPath = getTombstoneRegistryPath();
  const normalized = dedupePartitionTombstones(tombstones).map((tombstone) => ({
    ...tombstone,
    // Account IDs may contain an email address. They are not needed for
    // partition recovery, so keep the sidecar metadata-only.
    accountId: null,
  }));
  const sanitizedResetPending = resetPending
    ? { ...resetPending, accountIds: [] }
    : null;
  const tempPath = `${registryPath}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  try {
    fs.writeFileSync(
      tempPath,
      JSON.stringify({ version: 2, tombstones: normalized, resetPending: sanitizedResetPending }),
      { encoding: 'utf8', mode: 0o600 },
    );
    fs.renameSync(tempPath, registryPath);
  } catch (err) {
    try {
      fs.rmSync(tempPath, { force: true });
    } catch {
      // ignore temporary-file cleanup failure
    }
    throw err;
  }
}

function readTombstoneRegistry(): YtPartitionTombstone[] {
  return readCredentialSidecar().tombstones;
}

function writeTombstoneRegistry(tombstones: YtPartitionTombstone[]): void {
  const sidecar = readCredentialSidecar();
  writeCredentialSidecar(tombstones, sidecar.resetPending);
}

function mergePartitionTombstones(
  ...sources: YtPartitionTombstone[][]
): YtPartitionTombstone[] {
  return dedupePartitionTombstones(sources.flat());
}

async function readVaultUnlocked(): Promise<VaultReadResult> {
  // Return cached successful read.
  if (credentialStore.vaultCacheValid && credentialStore.cachedVault) {
    credentialStore.vaultDiagnostic = null;
    return { vault: credentialStore.cachedVault, unreadable: false };
  }

  const filePath = getVaultFilePath();
  if (!fs.existsSync(filePath)) {
    // Don't cache a missing file — it may be created later (e.g. after sign-in).
    const sidecar = readCredentialSidecar();
    const latestTombstone = latestPartitionTombstone(sidecar.tombstones);
    credentialStore.vaultDiagnostic = null;
    return {
      vault: {
        ...DEFAULT_VAULT,
        ytPartitionTombstone: latestTombstone,
        ytPartitionTombstones: sidecar.tombstones,
        ytResetPending: sidecar.resetPending,
      },
      unreadable: false,
    };
  }

  credentialStore.vaultDiagnostic = null;
  try {
    const raw = fs.readFileSync(filePath, 'utf8').trim();
    let jsonStr = '';
    let shouldReEncrypt = false;
    if (raw.startsWith('SAFE:')) {
      const buf = Buffer.from(raw.slice(5), 'base64');
      try {
        const decrypted = await decryptVaultBuffer(buf);
        jsonStr = decrypted.plaintext;
        shouldReEncrypt = decrypted.shouldReEncrypt;
      } catch (err) {
        // Preserve the unreadable vault file and report the error. Do NOT cache
        // the empty result — safeStorage may not be ready yet on Windows, and
        // the next call should retry decryption.
        credentialStore.vaultDiagnostic = {
          error: err instanceof Error ? err.message : 'Failed to decrypt session vault.',
          unreadableFile: true,
        };
        credentialStore.vaultCacheValid = false;
        credentialStore.cachedVault = null;
        return { vault: { ...DEFAULT_VAULT }, unreadable: true };
      }
    } else if (raw.startsWith('AES:')) {
      jsonStr = decryptFallback(raw);
    } else {
      jsonStr = raw;
    }

    const parsed = JSON.parse(jsonStr) as Partial<StoredVaultPayload>;
    const legacyTombstone = normalizePartitionTombstone(parsed.ytPartitionTombstone);
    const parsedTombstones = Array.isArray(parsed.ytPartitionTombstones)
      ? parsed.ytPartitionTombstones
          .map(normalizePartitionTombstone)
          .filter((tombstone): tombstone is YtPartitionTombstone => Boolean(tombstone))
      : [];
    const tombstones = mergePartitionTombstones(
      parsedTombstones,
      legacyTombstone ? [legacyTombstone] : [],
      readTombstoneRegistry(),
    );
    const latestTombstone = latestPartitionTombstone(tombstones);
    credentialStore.cachedVault = {
      ytAccounts: Array.isArray(parsed.ytAccounts)
        ? parsed.ytAccounts
            .filter(
              (account): account is StoredYtAccount =>
                Boolean(account && typeof account === 'object'),
            )
            .map((account) => {
              const { partitionName, ...rest } = account;
              return typeof partitionName === 'string' && partitionName.trim()
                ? { ...rest, partitionName: partitionName.trim() }
                : rest;
            })
        : [],
      activeYtAccountId: parsed.activeYtAccountId || null,
      anonymousVisitorData: parsed.anonymousVisitorData || '',
      spotify: parsed.spotify || null,
      ytPartitionTombstone: latestTombstone,
      ytPartitionTombstones: tombstones,
      ytResetPending: normalizeYtResetPending(parsed.ytResetPending),
    };
    credentialStore.vaultCacheValid = true;
    credentialStore.vaultDiagnostic = null;
    if (shouldReEncrypt && !credentialStore.vaultReencryptScheduled) {
      // The OS key rotated. Re-encrypt the latest cached vault through the
      // operation queue so this migration cannot overwrite a concurrent
      // account or visitor-data update.
      credentialStore.vaultReencryptScheduled = true;
      void enqueueVaultOperation(async () => {
        const current = await readVaultUnlocked();
        if (current.unreadable) {
          throw new Error('Session vault became unreadable during key rotation.');
        }
        await writeVault(current.vault);
      })
        .catch((err) => {
          console.warn(
            '[YTM Auth] Could not re-encrypt the rotated session vault:',
            err instanceof Error ? err.message : String(err),
          );
        })
        .finally(() => {
          credentialStore.vaultReencryptScheduled = false;
        });
    }
    return { vault: credentialStore.cachedVault, unreadable: false };
  } catch (err) {
    credentialStore.vaultDiagnostic = {
      error: err instanceof Error ? err.message : 'Failed to read session vault.',
      unreadableFile: true,
    };
    credentialStore.vaultCacheValid = false;
    credentialStore.cachedVault = null;
    return { vault: { ...DEFAULT_VAULT }, unreadable: true };
  }
}

async function readVault(): Promise<StoredVaultPayload> {
  const result = await enqueueVaultOperation(() => readVaultUnlocked());
  if (result.unreadable) {
    throw new YtVaultUnreadableError(
      credentialStore.vaultDiagnostic || {
        error: 'Session vault is unreadable.',
        unreadableFile: true,
      },
    );
  }
  return result.vault;
}

async function readVaultForMutation(): Promise<StoredVaultPayload> {
  const result = await readVaultUnlocked();
  if (result.unreadable) {
    const diagnostic = credentialStore.vaultDiagnostic || { unreadableFile: true };
    const detail = diagnostic.error?.trim();
    throw new YtVaultUnreadableError({
      ...diagnostic,
      error: `Session vault is unreadable; refusing to overwrite the existing credentials.${
        detail && !detail.startsWith('Session vault is unreadable;') ? ` ${detail}` : ''
      }`,
    });
  }
  return result.vault;
}

async function writeVault(
  vault: StoredVaultPayload,
  canPublish?: () => boolean,
): Promise<void> {
  if (canPublish && !canPublish()) {
    throw new YtAuthOperationCancelledError();
  }
  const filePath = getVaultFilePath();
  const plaintext = JSON.stringify(vault);
  let serialized = '';
  const ss = credentialStore.electronBridge.safeStorage;

  // Encrypt with retry — the async encryptor initializes lazily on first call.
  if (ss?.encryptStringAsync) {
    let lastErr: unknown = null;
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const enc = await ss.encryptStringAsync(plaintext);
        if (!Buffer.isBuffer(enc) || enc.length === 0) {
          throw new Error('SafeStorage returned an invalid encrypted value.');
        }
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
    if (!Buffer.isBuffer(enc) || enc.length === 0) {
      throw new Error('SafeStorage returned an invalid encrypted value.');
    }
    serialized = `SAFE:${enc.toString('base64')}`;
  } else {
    serialized = encryptFallback(plaintext);
  }

  // The guard is checked immediately before the synchronous atomic rename. An
  // event-loop turn cannot interleave between this check and the write, so a
  // cancelled sign-in cannot publish after its cancellation was observed.
  if (canPublish && !canPublish()) {
    throw new YtAuthOperationCancelledError();
  }

  const tempPath = `${filePath}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  try {
    // Write and rename within the same directory so a crash cannot leave a
    // truncated vault that loses the signed-in account on the next launch.
    fs.writeFileSync(tempPath, serialized, { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(tempPath, filePath);
  } catch (err) {
    try {
      fs.rmSync(tempPath, { force: true });
    } catch {
      // ignore temporary-file cleanup failure
    }
    credentialStore.vaultCacheValid = false;
    credentialStore.cachedVault = null;
    throw err;
  }

  // Only publish the in-memory snapshot after the encrypted file was actually
  // written. Otherwise a disk/encryption failure would make the app look
  // authenticated in this process while the next launch loses the account.
  credentialStore.cachedVault = vault;
  credentialStore.vaultCacheValid = true;
  credentialStore.vaultDiagnostic = null;
}

/**
 * Returns the latest vault diagnostic. If a real status/vault read has
 * already failed, preserve that unreadable state instead of replacing it with
 * the result of an unrelated follow-up read. With no prior diagnostic, perform
 * a real read so callers cannot mistake "not attempted yet" for "readable".
 */
export async function getVaultDiagnostic(): Promise<VaultDiagnostic | null> {
  if (credentialStore.vaultDiagnostic?.unreadableFile) {
    return { ...credentialStore.vaultDiagnostic };
  }
  const result = await enqueueVaultOperation(() => readVaultUnlocked());
  if (result.unreadable) {
    return { ...(credentialStore.vaultDiagnostic || { unreadableFile: true }) };
  }
  return null;
}

export async function invalidateVaultCache(): Promise<void> {
  await enqueueVaultOperation(async () => {
    credentialStore.vaultCacheValid = false;
    credentialStore.cachedVault = null;
    credentialStore.vaultDiagnostic = null;
  });
}

function findActiveAccount(vault: StoredVaultPayload): StoredYtAccount | null {
  if (vault.ytAccounts.length === 0) return null;
  return vault.ytAccounts.find((a) => a.id === vault.activeYtAccountId) || vault.ytAccounts[0];
}

function toPublicYtAuthStatus(vault: StoredVaultPayload): YtAuthStatusPayload {
  const active = findActiveAccount(vault);
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
    activeAccountId: active?.id || null,
    visitorData: active?.visitorData || vault.anonymousVisitorData || '',
    accounts,
  };
}

export async function getActiveYtAccount(): Promise<StoredYtAccount | null> {
  return findActiveAccount(await readVault());
}

export async function getYtAccountById(accountId: string): Promise<StoredYtAccount | null> {
  const vault = await readVault();
  return vault.ytAccounts.find((account) => account.id === accountId) || null;
}

export async function getAnonymousVisitorData(): Promise<string> {
  return (await readVault()).anonymousVisitorData || '';
}

export async function setAnonymousVisitorData(visitorData: string): Promise<void> {
  if (!visitorData) return;
  await enqueueVaultOperation(async () => {
    const vault = await readVaultForMutation();
    if (vault.anonymousVisitorData === visitorData) return;
    await writeVault({ ...vault, anonymousVisitorData: visitorData });
  });
}

export type YtAccountUpsertSource = 'explicit' | 'partition-restore';

export interface UpsertYtAccountOptions {
  /** Whether the imported account should become active. Defaults to true. */
  activate?: boolean;
  /**
   * Require the vault's active account to still have this id at write time.
   * `null` means that no account may be active. This prevents a recovered
   * partition account from replacing an account that became active while
   * asynchronous validation was in progress.
   */
  expectedActiveAccountId?: string | null;
  /**
   * Optionally pin the exact active-account credential snapshot. An id alone
   * is insufficient because a refresh may replace the cookie while retaining
   * the same account id.
   */
  expectedActiveAccountCookie?: string | null;
  /**
   * Explicit sign-in/import is authoritative and may clear a logout
   * tombstone. Partition recovery is not authoritative and must never clear
   * one or restore a session invalidated by logout.
   */
  source?: YtAccountUpsertSource;
  /**
   * Internal cancellation guard. It is evaluated inside the serialized vault
   * operation and immediately before the atomic file replacement.
   */
  canPublish?: () => boolean;
  /** Internal callback invoked after the new vault snapshot is committed. */
  onCommitted?: () => void;
}

export async function upsertYtAccount(
  account: StoredYtAccount,
  options: UpsertYtAccountOptions = {},
): Promise<YtAuthStatusPayload> {
  return await enqueueVaultOperation(async () => {
    const vault = await readVaultForMutation();
    if (vault.ytResetPending) {
      throw new YtResetPendingError();
    }
    if (options.canPublish && !options.canPublish()) {
      throw new YtAuthOperationCancelledError();
    }
    const currentActive = findActiveAccount(vault);
    if (
      Object.prototype.hasOwnProperty.call(options, 'expectedActiveAccountId') &&
      (currentActive?.id || null) !== options.expectedActiveAccountId
    ) {
      throw new YtAccountStateConflictError(
        'The active YouTube Music account changed while the recovered session was being imported.',
      );
    }
    if (
      Object.prototype.hasOwnProperty.call(options, 'expectedActiveAccountCookie') &&
      currentActive &&
      currentActive.cookie !== options.expectedActiveAccountCookie
    ) {
      throw new YtAccountStateConflictError(
        'The active YouTube Music credentials changed while the recovered session was being imported.',
      );
    }

    const source = options.source || 'explicit';
    const accountPartition =
      account.partitionName?.trim() || LEGACY_YTM_PARTITION;
    const partitionTombstone = vault.ytPartitionTombstones.find(
      (tombstone) => (tombstone.partitionName || null) === accountPartition,
    );
    if (source === 'partition-restore' && partitionTombstone) {
      throw new YtSessionInvalidatedError(
        'The persistent YouTube Music session was invalidated by logout and cannot be restored automatically.',
      );
    }

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
    const importedId = existingIdx >= 0 ? nextAccounts[existingIdx].id : account.id;
    const activeId = options.activate === false ? vault.activeYtAccountId : importedId;
    const nextTombstones =
      source === 'explicit'
        ? vault.ytPartitionTombstones.filter(
            (tombstone) => (tombstone.partitionName || null) !== accountPartition,
          )
        : vault.ytPartitionTombstones;
    const latestTombstone = latestPartitionTombstone(nextTombstones);
    const nextVault = {
      ...vault,
      ytAccounts: nextAccounts,
      activeYtAccountId: activeId,
      ytPartitionTombstone: latestTombstone,
      ytPartitionTombstones: nextTombstones,
    };
    if (source === 'explicit' && nextTombstones.length !== vault.ytPartitionTombstones.length) {
      // Remove the sidecar marker first. If the encrypted-vault write then
      // fails, the encrypted marker remains authoritative and recovery stays
      // blocked.
      writeTombstoneRegistry(nextTombstones);
    }
    await writeVault(nextVault, options.canPublish);
    if (options.canPublish && !options.canPublish()) {
      // Cancellation was observed after the atomic write but before this
      // operation returned. Restore the previous serialized snapshot while the
      // vault queue still excludes other mutations.
      await writeVault(vault);
      throw new YtAuthOperationCancelledError();
    }
    options.onCommitted?.();
    return toPublicYtAuthStatus(nextVault);
  });
}

/**
 * Persists a logout marker before the browser partition is cleared. If the
 * clear fails, the marker still prevents that partition from resurrecting an
 * account during a later vault/partition recovery attempt.
 */
export async function markYtPartitionInvalidated(
  accountId?: string | null,
  partitionName?: string | null,
): Promise<YtPartitionTombstone> {
  return await enqueueVaultOperation(async () => {
    const vault = await readVaultForMutation();
    const normalizedPartition = partitionName?.trim() || LEGACY_YTM_PARTITION;
    const previousGeneration = vault.ytPartitionTombstones.reduce(
      (max, tombstone) => Math.max(max, tombstone.generation),
      vault.ytPartitionTombstone?.generation || 0,
    );
    const tombstone: YtPartitionTombstone = {
      generation: previousGeneration + 1,
      accountId: accountId || null,
      invalidatedAt: Date.now(),
      ...(normalizedPartition ? { partitionName: normalizedPartition } : {}),
    };
    const nextTombstones = [
      ...vault.ytPartitionTombstones.filter(
        (entry) => (entry.partitionName || null) !== normalizedPartition,
      ),
      tombstone,
    ];
    // Mirror the invalidation before changing the encrypted vault. If the
    // encrypted write fails, the conservative sidecar marker still prevents a
    // stale partition from being recovered later.
    writeCredentialSidecar(nextTombstones, vault.ytResetPending);
    await writeVault({
      ...vault,
      ytPartitionTombstone: tombstone,
      ytPartitionTombstones: nextTombstones,
    });
    return tombstone;
  });
}

export async function getYtPartitionTombstone(
  partitionName?: string | null,
): Promise<YtPartitionTombstone | null> {
  const vault = await readVault();
  if (partitionName === undefined) {
    return vault.ytPartitionTombstone;
  }
  const normalizedPartition = partitionName?.trim() || LEGACY_YTM_PARTITION;
  return (
    vault.ytPartitionTombstones.find(
      (tombstone) => tombstone.partitionName === normalizedPartition,
    ) || null
  );
}

export async function updateActiveYtAccountAuth(
  patch: Partial<StoredYtAccount>,
  expectedAccountId?: string,
): Promise<boolean> {
  return await enqueueVaultOperation(async () => {
    const vault = await readVaultForMutation();
    if (vault.ytResetPending) throw new YtResetPendingError();
    const active = findActiveAccount(vault);
    if (!active) return false;
    if (expectedAccountId && active.id !== expectedAccountId) return false;
    const nextAccounts = vault.ytAccounts.map((a) =>
      a.id === active.id ? { ...a, ...patch } : a,
    );
    await writeVault({ ...vault, ytAccounts: nextAccounts });
    return true;
  });
}

export async function switchActiveYtAccount(accountId: string): Promise<YtAuthStatusPayload> {
  return await enqueueVaultOperation(async () => {
    const vault = await readVaultForMutation();
    if (vault.ytResetPending) throw new YtResetPendingError();
    const exists = vault.ytAccounts.find((a) => a.id === accountId);
    if (!exists) throw new YtAccountNotFoundError(accountId);
    const nextVault = { ...vault, activeYtAccountId: exists.id };
    await writeVault(nextVault);
    return toPublicYtAuthStatus(nextVault);
  });
}

export async function getAllYtAccounts(): Promise<StoredYtAccount[]> {
  return [...(await readVault()).ytAccounts];
}

export async function clearYtAccounts(): Promise<YtAuthStatusPayload> {
  return await enqueueVaultOperation(async () => {
    const vault = await readVaultForMutation();
    const nextVault = {
      ...vault,
      ytAccounts: [],
      activeYtAccountId: null,
    };
    await writeVault(nextVault);
    return toPublicYtAuthStatus(nextVault);
  });
}

/**
 * Removes every account from the encrypted vault and records the partitions
 * that must still be cleared. The account removal and reset-pending marker are
 * committed in one atomic vault write before callers touch browser storage.
 */
export async function stageYtAuthReset(): Promise<YtResetPendingState> {
  return await enqueueVaultOperation(async () => {
    const vault = await readVaultForMutation();
    if (vault.ytResetPending) {
      writeCredentialSidecar(vault.ytPartitionTombstones, vault.ytResetPending);
      return vault.ytResetPending;
    }

    const accountIds = vault.ytAccounts.map((account) => account.id);
    const partitionNames = Array.from(
      new Set([
        LEGACY_YTM_PARTITION,
        ...vault.ytAccounts.map(
          (account) => account.partitionName?.trim() || LEGACY_YTM_PARTITION,
        ),
      ]),
    );
    let generation = vault.ytPartitionTombstones.reduce(
      (max, tombstone) => Math.max(max, tombstone.generation),
      vault.ytPartitionTombstone?.generation || 0,
    );
    const nextTombstones = [...vault.ytPartitionTombstones];
    for (const partitionName of partitionNames) {
      generation += 1;
      const account = vault.ytAccounts.find(
        (candidate) =>
          (candidate.partitionName?.trim() || LEGACY_YTM_PARTITION) === partitionName,
      );
      const tombstone: YtPartitionTombstone = {
        generation,
        accountId: account?.id || null,
        invalidatedAt: Date.now(),
        partitionName,
      };
      nextTombstones.push(tombstone);
    }
    const dedupedTombstones = mergePartitionTombstones(nextTombstones);
    const pending: YtResetPendingState = {
      generation: generation + 1,
      accountIds,
      partitionNames,
      startedAt: Date.now(),
    };

    // Commit the account removal, invalidation markers, and pending-reset
    // state in one encrypted-vault write before any browser partition is
    // touched. If this write fails, the original account snapshot remains
    // authoritative and no partition has been cleared.
    const latestTombstone = latestPartitionTombstone(dedupedTombstones);
    await writeVault({
      ...vault,
      ytAccounts: [],
      activeYtAccountId: null,
      ytPartitionTombstone: latestTombstone,
      ytPartitionTombstones: dedupedTombstones,
      ytResetPending: pending,
    });
    writeCredentialSidecar(dedupedTombstones, pending);
    return pending;
  });
}

/** Marks a staged factory reset complete after all partitions were cleared. */
export async function completeYtAuthReset(): Promise<YtAuthStatusPayload> {
  return await enqueueVaultOperation(async () => {
    const vault = await readVaultForMutation();
    if (!vault.ytResetPending) return toPublicYtAuthStatus(vault);
    const nextVault = { ...vault, ytResetPending: null };
    await writeVault(nextVault);
    writeCredentialSidecar(nextVault.ytPartitionTombstones, null);
    return toPublicYtAuthStatus(nextVault);
  });
}

/** Returns durable reset state that must be recovered before normal use. */
export async function getPendingYtAuthReset(): Promise<YtResetPendingState | null> {
  return (await readVault()).ytResetPending;
}

/**
 * Verifies that the encrypted vault can be read and written before a sign-in
 * flow is allowed to invalidate the only recoverable browser partition.
 */
export async function preflightYtVaultWrite(): Promise<void> {
  await enqueueVaultOperation(async () => {
    const vault = await readVaultForMutation();
    if (vault.ytResetPending) throw new YtResetPendingError();
    await writeVault(vault);
  });
}

/**
 * Explicitly replaces an unreadable encrypted vault after preserving the old
 * file as a backup. This is intentionally separate from ordinary sign-in and
 * logout mutations, which must never overwrite an unreadable vault.
 */
export async function resetYtVaultWithBackup(): Promise<{ backupPath: string | null }> {
  return await enqueueVaultOperation(async () => {
    const filePath = getVaultFilePath();
    let backupPath: string | null = null;
    if (fs.existsSync(filePath)) {
      backupPath = `${filePath}.unreadable-${Date.now()}-${crypto
        .randomBytes(4)
        .toString('hex')}.bak`;
      fs.copyFileSync(filePath, backupPath, fs.constants.COPYFILE_EXCL);
    }

    // Preserve logout invalidations from both the readable vault and the
    // non-secret sidecar. Resetting an unreadable vault must not make a
    // previously logged-out partition eligible for automatic recovery. A
    // durable pending reset is preserved as well so its partition cleanup can
    // still be resumed.
    const current = await readVaultUnlocked();
    const sidecar = readCredentialSidecar();
    const preservedTombstones = mergePartitionTombstones(
      current.unreadable ? [] : current.vault.ytPartitionTombstones,
      sidecar.tombstones,
    );
    const preservedReset = current.unreadable
      ? sidecar.resetPending
      : current.vault.ytResetPending;
    const latestTombstone = latestPartitionTombstone(preservedTombstones);
    await writeVault({
      ...DEFAULT_VAULT,
      ytPartitionTombstone: latestTombstone,
      ytPartitionTombstones: preservedTombstones,
      ytResetPending: preservedReset,
    });
    writeCredentialSidecar(preservedTombstones, preservedReset);
    return { backupPath };
  });
}

export async function removeYtAccountById(
  accountId?: string,
  expectedAccount?: Pick<StoredYtAccount, 'id' | 'cookie'>,
): Promise<YtAuthStatusPayload> {
  return await enqueueVaultOperation(async () => {
    const vault = await readVaultForMutation();
    if (vault.ytResetPending) throw new YtResetPendingError();
    const targetId = accountId || expectedAccount?.id || vault.activeYtAccountId;

    if (expectedAccount) {
      const currentTarget = vault.ytAccounts.find((account) => account.id === targetId);
      // The requested account was already removed. Do not let an optional id
      // fall through to whichever account happens to be active now.
      if (!currentTarget) return toPublicYtAuthStatus(vault);
      if (currentTarget.cookie !== expectedAccount.cookie) {
        throw new YtAccountStateConflictError(
          'The YouTube Music account changed while logout was in progress; please retry.',
        );
      }
    }

    const nextAccounts = vault.ytAccounts.filter((a) => a.id !== targetId);
    const nextActive =
      nextAccounts.length === 0
        ? null
        : vault.activeYtAccountId === targetId
          ? nextAccounts[0].id
          : vault.activeYtAccountId;
    const nextVault = {
      ...vault,
      ytAccounts: nextAccounts,
      activeYtAccountId: nextActive,
    };
    await writeVault(nextVault);
    return toPublicYtAuthStatus(nextVault);
  });
}

export async function getPublicYtAuthStatus(): Promise<YtAuthStatusPayload> {
  return toPublicYtAuthStatus(await readVault());
}

export async function getSpotifyCredentials(): Promise<StoredSpotifyCredentials | null> {
  return (await readVault()).spotify;
}

function toPublicSpotifyConnection(
  sp: StoredSpotifyCredentials | null,
): SpotifyConnection | null {
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

export async function setSpotifyCredentials(
  spotify: StoredSpotifyCredentials | null,
): Promise<SpotifyConnection | null> {
  return await enqueueVaultOperation(async () => {
    const vault = await readVaultForMutation();
    const nextVault = { ...vault, spotify };
    await writeVault(nextVault);
    return toPublicSpotifyConnection(nextVault.spotify);
  });
}

export async function updateSpotifyCredentials(
  patch: Partial<StoredSpotifyCredentials>,
): Promise<SpotifyConnection | null> {
  return await enqueueVaultOperation(async () => {
    const vault = await readVaultForMutation();
    const current = vault.spotify;
    if (!current) return null;
    const nextVault = { ...vault, spotify: { ...current, ...patch } };
    await writeVault(nextVault);
    return toPublicSpotifyConnection(nextVault.spotify);
  });
}

export async function getPublicSpotifyConnection(): Promise<SpotifyConnection | null> {
  return toPublicSpotifyConnection(await getSpotifyCredentials());
}