import Dexie from 'dexie';
import { ContactRecord, FileRecord, GroupRecord, IdentityRecord, MessageRecord } from '../types/index';

/**
 * Storage that cannot be blocked.
 * ---------------------------------------------------------------------------
 * The app talks to a small table/collection API (the subset of Dexie it uses)
 * which is served by the first backend that actually works on the device:
 *
 *   1. `indexeddb`    - normal path, full persistence (Dexie).
 *   2. `localstorage` - used when IndexedDB is blocked (private windows,
 *                       blocked-cookies policies, partitioned/embedded frames).
 *   3. `memory`       - always available session-only fallback, so the app
 *                       still opens on locked-down browsers.
 */

export type StorageDriverName = 'indexeddb' | 'localstorage' | 'memory';

export interface CollectionLike<T> {
  toArray(): Promise<T[]>;
  first(): Promise<T | undefined>;
  count(): Promise<number>;
  delete(): Promise<number>;
  modify(changes: Partial<T>): Promise<number>;
  sortBy(index: string): Promise<T[]>;
}

export interface DbTable<T> {
  toArray(): Promise<T[]>;
  get(key: any): Promise<T | undefined>;
  put(item: T): Promise<any>;
  add(item: T): Promise<any>;
  update(key: any, changes: Partial<T>): Promise<number>;
  delete(key: any): Promise<void>;
  clear(): Promise<void>;
  filter(predicate: (item: T) => boolean): CollectionLike<T>;
  orderBy(index: string): { reverse(): CollectionLike<T> };
  where(index: string): { equals(value: any): CollectionLike<T> };
}

export type TableName = 'identity' | 'contacts' | 'files' | 'messages' | 'groups';

interface TableSpec {
  /** Primary key path. */
  key: string;
  /** Auto-increment primary key (`++id`). */
  auto: boolean;
  /** Indexed key paths available to `where()` / `orderBy()`. */
  indexes: string[];
}

export const TABLE_SPECS: Record<TableName, TableSpec> = {
  identity: { key: 'deviceId', auto: false, indexes: ['deviceId'] },
  contacts: {
    key: 'deviceId',
    auto: false,
    indexes: ['deviceId', 'verificationStatus', 'lastSeenAt'],
  },
  files: { key: 'fileId', auto: false, indexes: ['fileId', 'hashSHA256', 'mimeType'] },
  messages: {
    key: 'id',
    auto: true,
    indexes: ['id', 'chatDeviceId', 'chatDeviceId+timestamp', 'timestamp', 'fileId', 'status', 'groupId', 'messageId'],
  },
  groups: {
    key: 'groupId',
    auto: false,
    indexes: ['groupId', 'name', 'createdAt', 'adminDeviceId', 'lastActivityAt'],
  },
};

export const TABLE_NAMES: TableName[] = ['identity', 'contacts', 'files', 'messages', 'groups'];

export interface StorageDriver {
  readonly name: StorageDriverName;
  table<T>(name: TableName): DbTable<T>;
  clear(): Promise<void>;
}

/* -------------------------------------------------------------------------- */
/* Browser capability probes                                                  */
/* -------------------------------------------------------------------------- */

type Row = Record<string, any>;

let cachedLocalStorage: Storage | null | undefined;

/** A localStorage handle, or null when the browser refuses to expose/use it. */
export function getSafeLocalStorage(): Storage | null {
  if (cachedLocalStorage !== undefined) return cachedLocalStorage;
  try {
    const store = typeof window !== 'undefined' ? window.localStorage : null;
    if (!store) {
      cachedLocalStorage = null;
      return null;
    }
    const probe = '__scryptchat_probe__';
    store.setItem(probe, '1');
    store.removeItem(probe);
    cachedLocalStorage = store;
  } catch {
    cachedLocalStorage = null;
  }
  return cachedLocalStorage;
}

export function getSafeSessionStorage(): Storage | null {
  try {
    const store = typeof window !== 'undefined' ? window.sessionStorage : null;
    if (!store) return null;
    const probe = '__scryptchat_probe__';
    store.setItem(probe, '1');
    store.removeItem(probe);
    return store;
  } catch {
    return null;
  }
}

/* -------------------------------------------------------------------------- */
/* In-memory / localStorage driver                                            */
/* -------------------------------------------------------------------------- */

const LS_PREFIX = 'scryptchat_db_';
const LS_META_KEY = 'scryptchat_db_driver';

/**
 * Deep-ish copy used when reading rows out of the memory store. Storage values
 * are plain JSON, so the only thing needing protection is Blob payloads, which
 * are kept by reference on purpose.
 */
function cloneRow<T extends Row>(row: T): T {
  const copy: Row = {};
  for (const [key, value] of Object.entries(row)) {
    if (value instanceof Blob || value instanceof ArrayBuffer) {
      copy[key] = value;
    } else if (value && typeof value === 'object') {
      try {
        copy[key] = structuredClone(value);
      } catch {
        copy[key] = value;
      }
    } else {
      copy[key] = value;
    }
  }
  return copy as T;
}

/** Records that survive JSON serialisation without losing information. */
function isPersistable(table: TableName, row: Row): boolean {
  if (table === 'files') return false; // Blob payloads stay in memory for the session.
  return Object.values(row).every((value) => !(value instanceof Blob) && !(value instanceof ArrayBuffer));
}

class MemoryCollection<T extends Row> implements CollectionLike<T> {
  constructor(
    private readonly store: MemoryStore,
    private readonly table: TableName,
    private readonly rows: T[]
  ) {}

  async toArray(): Promise<T[]> {
    return this.rows.map((row) => cloneRow(row));
  }

  async first(): Promise<T | undefined> {
    const row = this.rows[0];
    return row ? cloneRow(row) : undefined;
  }

  async count(): Promise<number> {
    return this.rows.length;
  }

  async delete(): Promise<number> {
    const count = await this.store.deleteRows(this.table, this.rows);
    return count;
  }

  async modify(changes: Partial<T>): Promise<number> {
    for (const row of this.rows) {
      Object.assign(row, changes);
    }
    await this.store.flush();
    return this.rows.length;
  }

  async sortBy(index: string): Promise<T[]> {
    const field = index.includes('+') ? index.split('+')[0] : index;
    return [...this.rows]
      .sort((a, b) => {
        const left = (a as Row)[field];
        const right = (b as Row)[field];
        if (left === right) return 0;
        return left > right ? 1 : -1;
      })
      .map((row) => cloneRow(row));
  }
}

class MemoryStore implements StorageDriver {
  private data: Record<TableName, Row[]>;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    public readonly name: StorageDriverName,
    private readonly persistent: boolean
  ) {
    this.data = {
      identity: [],
      contacts: [],
      files: [],
      messages: [],
      groups: [],
    };
    this.load();
    this.registerFlushHooks();
  }

  /**
   * Mobile browsers freeze or discard backgrounded pages without warning, so a
   * pending debounced write is flushed whenever the page is hidden or closed.
   */
  private registerFlushHooks() {
    if (!this.persistent || typeof window === 'undefined') return;
    const flushNow = () => this.flushNow();
    try {
      window.addEventListener('pagehide', flushNow);
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') flushNow();
      });
    } catch {
      /* ignore */
    }
  }

  /** Writes pending changes immediately. */
  flushNow() {
    const storage = this.storage;
    if (!storage) return;
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    this.writeNow(storage);
  }

  private get storage(): Storage | null {
    return this.persistent ? getSafeLocalStorage() : null;
  }

  private load() {
    const storage = this.storage;
    if (!storage) return;
    for (const table of TABLE_NAMES) {
      try {
        const raw = storage.getItem(LS_PREFIX + table);
        if (!raw) continue;
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) this.data[table] = parsed;
      } catch {
        // A corrupt payload must never stop the app from starting.
      }
    }
  }

  rows(table: TableName): Row[] {
    return this.data[table];
  }

  async deleteRows(table: TableName, rows: Row[]): Promise<number> {
    const target = this.data[table];
    const doomed = new Set(rows);
    const next = target.filter((row) => !doomed.has(row));
    const removed = target.length - next.length;
    this.data[table] = next;
    await this.flush();
    return removed;
  }

  /** Persists asynchronously so callers are never blocked by quota errors. */
  async flush(): Promise<void> {
    const storage = this.storage;
    if (!storage) return;
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = setTimeout(() => this.writeNow(storage), 250);
  }

  private writeNow(storage: Storage) {
    for (const table of TABLE_NAMES) {
      try {
        const rows = this.data[table].filter((row) => isPersistable(table, row));
        if (rows.length === 0) {
          storage.removeItem(LS_PREFIX + table);
          continue;
        }
        storage.setItem(LS_PREFIX + table, JSON.stringify(rows));
      } catch {
        // Quota exceeded or storage revoked mid-session: keep working in memory.
      }
    }
    try {
      storage.setItem(LS_META_KEY, this.name);
    } catch {
      /* ignore */
    }
  }

  table<T>(name: TableName): DbTable<T> {
    const spec = TABLE_SPECS[name];
    const self = this;

    const makeCollection = (rows: Row[]): CollectionLike<T> =>
      new MemoryCollection<T>(self, name, rows as T[]);

    return {
      async toArray() {
        return (await makeCollection(self.data[name]).toArray()) as T[];
      },
      async get(key: any) {
        const row = self.data[name].find((item) => item[spec.key] === key);
        return row ? (cloneRow(row) as T) : undefined;
      },
      async put(item: T) {
        const incoming = item as Row;
        if (spec.auto && (incoming[spec.key] === undefined || incoming[spec.key] === null)) {
          const maxId = self.data[name].reduce(
            (max, row) => Math.max(max, typeof row[spec.key] === 'number' ? row[spec.key] : 0),
            0
          );
          incoming[spec.key] = maxId + 1;
        }
        const index = self.data[name].findIndex((row) => row[spec.key] === incoming[spec.key]);
        if (index >= 0) {
          self.data[name][index] = incoming;
        } else {
          self.data[name].push(incoming);
        }
        await self.flush();
        return incoming[spec.key];
      },
      async add(item: T) {
        const incoming = item as Row;
        if (spec.auto) {
          const maxId = self.data[name].reduce(
            (max, row) => Math.max(max, typeof row[spec.key] === 'number' ? row[spec.key] : 0),
            0
          );
          incoming[spec.key] = maxId + 1;
        }
        self.data[name].push(incoming);
        await self.flush();
        return incoming[spec.key];
      },
      async update(key: any, changes: Partial<T>) {
        const row = self.data[name].find((item) => item[spec.key] === key);
        if (!row) return 0;
        Object.assign(row, changes);
        await self.flush();
        return 1;
      },
      async delete(key: any) {
        const rows = self.data[name].filter((item) => item[spec.key] === key);
        await self.deleteRows(name, rows);
      },
      async clear() {
        self.data[name] = [];
        await self.flush();
      },
      filter(predicate: (item: T) => boolean) {
        return makeCollection(self.data[name].filter((row) => predicate(row as T)));
      },
      orderBy(index: string) {
        const field = index.includes('+') ? spec.key : index;
        const sorted = [...self.data[name]].sort((a, b) => {
          const left = a[field];
          const right = b[field];
          if (left === right) return 0;
          return left > right ? 1 : -1;
        });
        return {
          reverse: () => makeCollection([...sorted].reverse()),
        };
      },
      where(index: string) {
        const field = index.includes('+') ? spec.key : index;
        return {
          equals: (value: any) =>
            makeCollection(self.data[name].filter((row) => row[field] === value)),
        };
      },
    };
  }

  async clear(): Promise<void> {
    for (const table of TABLE_NAMES) this.data[table] = [];
    const storage = this.storage;
    if (storage) {
      for (const table of TABLE_NAMES) {
        try {
          storage.removeItem(LS_PREFIX + table);
        } catch {
          /* ignore */
        }
      }
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Dexie (IndexedDB) driver                                                   */
/* -------------------------------------------------------------------------- */

class DexieDriver implements StorageDriver {
  public readonly name: StorageDriverName = 'indexeddb';

  constructor(private readonly dexie: Dexie) {}

  table<T>(name: TableName): DbTable<T> {
    const table = this.dexie.table(name) as any;
    return {
      toArray: () => table.toArray(),
      get: (key: any) => table.get(key),
      put: (item: T) => table.put(item),
      add: (item: T) => table.add(item),
      update: (key: any, changes: Partial<T>) => table.update(key, changes),
      delete: (key: any) => table.delete(key),
      clear: () => table.clear(),
      filter: (predicate: (item: T) => boolean) => table.filter(predicate),
      orderBy: (index: string) => ({
        reverse: () => table.orderBy(index).reverse(),
      }),
      where: (index: string) => ({
        equals: (value: any) => table.where(index).equals(value),
      }),
    };
  }

  async clear(): Promise<void> {
    for (const table of TABLE_NAMES) {
      try {
        await this.dexie.table(table).clear();
      } catch {
        /* ignore */
      }
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Driver selection                                                           */
/* -------------------------------------------------------------------------- */

export class ScryptChatDatabase extends Dexie {
  identity!: Dexie.Table<IdentityRecord, string>;
  contacts!: Dexie.Table<ContactRecord, string>;
  files!: Dexie.Table<FileRecord, string>;
  messages!: Dexie.Table<MessageRecord, number>;
  groups!: Dexie.Table<GroupRecord, string>;

  constructor() {
    super('DevTChatDB_v3.1');

    this.version(4).stores({
      identity: 'deviceId',
      contacts: 'deviceId, verificationStatus, lastSeenAt',
      files: 'fileId, hashSHA256, mimeType',
      messages: '++id, chatDeviceId, chatDeviceId+timestamp, timestamp, fileId, status, groupId',
      groups: 'groupId, name, createdAt, adminDeviceId, lastActivityAt',
    });

    // v5 adds the `messageId` index used for delivery acknowledgements.
    this.version(5).stores({
      identity: 'deviceId',
      contacts: 'deviceId, verificationStatus, lastSeenAt',
      files: 'fileId, hashSHA256, mimeType',
      messages:
        '++id, chatDeviceId, chatDeviceId+timestamp, timestamp, fileId, status, groupId, messageId',
      groups: 'groupId, name, createdAt, adminDeviceId, lastActivityAt',
    });
  }
}

let selectedDriver: StorageDriver | null = null;
let selectionPromise: Promise<StorageDriver> | null = null;

async function selectDriver(): Promise<StorageDriver> {
  // 1. IndexedDB, the only backend with real persistence guarantees.
  try {
    const dexie = new ScryptChatDatabase();
    await dexie.open();
    // Probe a read *and* a write: some browsers open the database and then
    // fail every transaction (blocked cookies, partitioned frames, quotas).
    await dexie.table('contacts').count();
    const probeTable = dexie.table('groups');
    const probeKey = `__probe__${Date.now()}`;
    await probeTable.put({ groupId: probeKey, name: '' } as any);
    await probeTable.delete(probeKey);
    dexie.on('versionchange', () => dexie.close());
    return new DexieDriver(dexie);
  } catch (err) {
    console.warn('IndexedDB unavailable, falling back:', err);
  }

  // 2. localStorage-backed store.
  if (getSafeLocalStorage()) {
    return new MemoryStore('localstorage', true);
  }

  // 3. Session-only memory store.
  return new MemoryStore('memory', false);
}

/** Resolves the active storage driver once per session. */
export function getStorageDriver(): Promise<StorageDriver> {
  if (selectedDriver) return Promise.resolve(selectedDriver);
  if (!selectionPromise) {
    selectionPromise = selectDriver()
      .then((driver) => {
        selectedDriver = driver;
        return driver;
      })
      .catch(() => {
        // Absolutely last resort: never reject, never block the UI.
        selectedDriver = new MemoryStore('memory', false);
        return selectedDriver;
      });
  }
  return selectionPromise;
}

export function getStorageDriverNameSync(): StorageDriverName | null {
  return selectedDriver?.name ?? null;
}

/** Human readable description used in Settings. */
export function describeStorage(name: StorageDriverName | null): string {
  switch (name) {
    case 'indexeddb':
      return 'IndexedDB (persistent)';
    case 'localstorage':
      return 'Browser storage (persistent)';
    case 'memory':
      return 'Session only (storage blocked)';
    default:
      return 'Checking…';
  }
}

/** Re-runs driver selection (used after a local data wipe). */
export function resetStorageDriver(): void {
  selectedDriver = null;
  selectionPromise = null;
}

/**
 * Device-profile snapshot cache.
 *
 * Used so chats, contact lists and the header all render the latest profile
 * image/color for a deviceId without re-querying the vault on every change.
 */
export const profileCache = new Map<string, { avatarUrl?: string; avatarColor?: string }>();

export function setProfileCache(deviceId: string, entry: { avatarUrl?: string; avatarColor?: string }) {
  if (deviceId) profileCache.set(deviceId, entry);
}

export function getProfileCache(deviceId: string): { avatarUrl?: string; avatarColor?: string } | undefined {
  return profileCache.get(deviceId);
}

export function clearProfileCache() {
  profileCache.clear();
}
