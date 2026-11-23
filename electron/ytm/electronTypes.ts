export interface ElectronCookieLike {
  name: string;
  value: string;
}

export interface ElectronBeforeSendHeadersDetailsLike {
  url: string;
  requestHeaders: Record<string, string>;
}

export interface ElectronOnErrorOccurredDetailsLike {
  url: string;
  method: string;
  resourceType: string;
  error: string;
}

export interface ElectronSessionLike {
  setUserAgent: (userAgent: string) => void;
  webRequest: {
    onBeforeSendHeaders: {
      (
        listener: (
          details: ElectronBeforeSendHeadersDetailsLike,
          callback: (response: { requestHeaders?: Record<string, string>; cancel?: boolean }) => void,
        ) => void,
      ): void;
      (
        filter: { urls: string[] },
        listener: (
          details: ElectronBeforeSendHeadersDetailsLike,
          callback: (response: { requestHeaders?: Record<string, string>; cancel?: boolean }) => void,
        ) => void,
      ): void;
    };
    onErrorOccurred?: (listener: ((details: ElectronOnErrorOccurredDetailsLike) => void) | null) => void;
  };
  cookies: {
    get: (filter: { domain?: string; url?: string; name?: string }) => Promise<ElectronCookieLike[]>;
  };
  clearStorageData: (options?: { storages?: string[] }) => Promise<void>;
}

export interface ElectronSessionModuleLike {
  fromPartition: (partition: string) => ElectronSessionLike;
}

export interface ElectronDebuggerLike {
  isAttached: () => boolean;
  attach: (protocolVersion?: string) => void;
  detach: () => void;
  sendCommand: (method: string, commandParams?: Record<string, unknown>) => Promise<unknown>;
  on: (event: string, listener: (...args: any[]) => void) => void;
}

export interface ElectronWebContentsLike {
  getURL: () => string;
  executeJavaScript: <T = unknown>(code: string) => Promise<T>;
  send: (channel: string, ...args: unknown[]) => void;
  on: (event: string, listener: (...args: any[]) => void) => void;
  once: (event: string, listener: (...args: any[]) => void) => void;
  setUserAgent: (userAgent: string) => void;
  isDestroyed?: () => boolean;
  setWindowOpenHandler?: (
    handler: (details: { url: string; frameName?: string }) => {
      action: 'allow' | 'deny';
      overrideBrowserWindowOptions?: Record<string, unknown>;
    },
  ) => void;
  debugger?: ElectronDebuggerLike;
}

export interface ElectronBrowserWindowInstanceLike {
  webContents: ElectronWebContentsLike;
  isDestroyed: () => boolean;
  close: () => void;
  show: () => void;
  loadURL: (url: string, options?: { userAgent?: string }) => Promise<void>;
  on: (event: string, listener: (...args: any[]) => void) => void;
}

export interface ElectronBrowserWindowConstructorLike {
  new (options?: Record<string, unknown>): ElectronBrowserWindowInstanceLike;
}

export interface ElectronAppLike {
  getPath: (name: string) => string;
}

export interface ElectronIpcMainLike {
  handle: (channel: string, listener: (event: unknown, ...args: any[]) => unknown) => void;
}

export interface ElectronSafeStorageLike {
  isAsyncEncryptionAvailable: () => Promise<boolean>;
  encryptStringAsync: (plainText: string) => Promise<Buffer>;
  decryptStringAsync: (encrypted: Buffer) => Promise<string>;
}
