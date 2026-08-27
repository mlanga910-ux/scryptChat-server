import Dexie, { Table } from 'dexie';
import { ContactRecord, FileRecord, IdentityRecord, MessageRecord } from '../types/index';

export class DevTChatDatabase extends Dexie {
  identity!: Table<IdentityRecord, string>;
  contacts!: Table<ContactRecord, string>;
  files!: Table<FileRecord, string>;
  messages!: Table<MessageRecord, number>;

  constructor() {
    super('DevTChatDB_v3.1');

    this.version(2).stores({
      identity: 'deviceId',
      contacts: 'deviceId, verificationStatus, lastSeenAt',
      files: 'fileId, hashSHA256, mimeType',
      messages: '++id, chatDeviceId, timestamp, fileId, status',
    });
  }
}

export const db = new DevTChatDatabase();

export async function clearAllLocalData(): Promise<void> {
  await Promise.all([
    db.messages.clear(),
    db.files.clear(),
    db.contacts.clear(),
    db.identity.clear(),
  ]);
  try {
    localStorage.clear();
    sessionStorage.clear();
  } catch (e) {
    console.error('Storage clear error:', e);
  }
}
