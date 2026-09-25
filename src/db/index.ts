import {
  ContactRecord,
  FileRecord,
  GroupRecord,
  IdentityRecord,
  MessageRecord,
  TransferStateRecord,
} from '../types/index';
import {
  DbTable,
  getSafeLocalStorage,
  getSafeSessionStorage,
  getStorageDriver,
  StorageDriverName,
  TableName,
} from './storage';

export * from './storage';

/**
 * Local vault.
 * ---------------------------------------------------------------------------
 * `db` exposes the table API the app uses and forwards every call to the
 * storage driver that actually works on this device (IndexedDB, then
 * localStorage, then memory). All screens therefore keep working - including
 * profile, history, contacts and settings - on browsers or contexts where
 * storage is blocked.
 */
function lazyTable<T>(name: TableName): DbTable<T> {
  return {
    async toArray() {
      const driver = await getStorageDriver();
      return driver.table<T>(name).toArray();
    },
    async get(key: any) {
      const driver = await getStorageDriver();
      return driver.table<T>(name).get(key);
    },
    async put(item: T) {
      const driver = await getStorageDriver();
      return driver.table<T>(name).put(item);
    },
    async add(item: T) {
      const driver = await getStorageDriver();
      return driver.table<T>(name).add(item);
    },
    async update(key: any, changes: Partial<T>) {
      const driver = await getStorageDriver();
      return driver.table<T>(name).update(key, changes);
    },
    async delete(key: any) {
      const driver = await getStorageDriver();
      return driver.table<T>(name).delete(key);
    },
    async clear() {
      const driver = await getStorageDriver();
      return driver.table<T>(name).clear();
    },
    filter(predicate: (item: T) => boolean) {
      let collection: ReturnType<DbTable<T>['filter']> | null = null;
      const ready = getStorageDriver().then((driver) => {
        collection = driver.table<T>(name).filter(predicate);
        return collection;
      });
      const through = <R>(run: (c: NonNullable<typeof collection>) => Promise<R>) =>
        ready.then((c) => run(c!));
      return {
        toArray: () => through((c) => c.toArray()),
        first: () => through((c) => c.first()),
        count: () => through((c) => c.count()),
        delete: () => through((c) => c.delete()),
        modify: (changes: Partial<T>) => through((c) => c.modify(changes)),
        sortBy: (field: string) => through((c) => c.sortBy(field)),
      };
    },
    orderBy(index: string) {
      return {
        reverse: () => {
          const ready = getStorageDriver().then((driver) =>
            driver.table<T>(name).orderBy(index).reverse()
          );
          const through = <R>(run: (c: Awaited<typeof ready>) => Promise<R>) =>
            ready.then((c) => run(c));
          return {
            toArray: () => through((c) => c.toArray()),
            first: () => through((c) => c.first()),
            count: () => through((c) => c.count()),
            delete: () => through((c) => c.delete()),
            modify: (changes: Partial<T>) => through((c) => c.modify(changes)),
            sortBy: (field: string) => through((c) => c.sortBy(field)),
          };
        },
      };
    },
    where(index: string) {
      return {
        equals: (value: any) => {
          const ready = getStorageDriver().then((driver) =>
            driver.table<T>(name).where(index).equals(value)
          );
          const through = <R>(run: (c: Awaited<typeof ready>) => Promise<R>) =>
            ready.then((c) => run(c));
          return {
            toArray: () => through((c) => c.toArray()),
            first: () => through((c) => c.first()),
            count: () => through((c) => c.count()),
            delete: () => through((c) => c.delete()),
            modify: (changes: Partial<T>) => through((c) => c.modify(changes)),
            sortBy: (field: string) => through((c) => c.sortBy(field)),
          };
        },
      };
    },
  };
}

export const db = {
  identity: lazyTable<IdentityRecord>('identity'),
  contacts: lazyTable<ContactRecord>('contacts'),
  files: lazyTable<FileRecord>('files'),
  messages: lazyTable<MessageRecord>('messages'),
  groups: lazyTable<GroupRecord>('groups'),
  transfers: lazyTable<TransferStateRecord>('transfers'),
};

/** Resolves the storage backend in use. Never rejects. */
export async function initDatabase(): Promise<StorageDriverName> {
  const driver = await getStorageDriver();
  return driver.name;
}

export async function clearAllLocalData(): Promise<void> {
  try {
    const driver = await getStorageDriver();
    await driver.clear();
  } catch (err) {
    console.error('Vault clear error:', err);
  }
  try {
    getSafeLocalStorage()?.clear();
  } catch (err) {
    console.error('Local storage clear error:', err);
  }
  try {
    getSafeSessionStorage()?.clear();
  } catch (err) {
    console.error('Session storage clear error:', err);
  }
}
