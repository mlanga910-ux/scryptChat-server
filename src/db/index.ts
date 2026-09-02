import Dexie, { Table } from 'dexie';
import { ContactRecord, FileRecord, GroupRecord, IdentityRecord, MessageRecord } from '../types/index';

export class DevTChatDatabase extends Dexie {
  identity!: Table<IdentityRecord, string>;
  contacts!: Table<ContactRecord, string>;
  files!: Table<FileRecord, string>;
  messages!: Table<MessageRecord, number>;
  groups!: Table<GroupRecord, string>;

  constructor() {
    super('DevTChatDB_v3.1');

    this.version(3).stores({
      identity: 'deviceId',
      contacts: 'deviceId, verificationStatus, lastSeenAt',
      files: 'fileId, hashSHA256, mimeType',
      messages: '++id, chatDeviceId, timestamp, fileId, status, groupId',
      groups: 'groupId, name, createdAt, adminDeviceId, lastActivityAt',
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
    db.groups.clear(),
  ]);
  try {
    localStorage.clear();
    sessionStorage.clear();
  } catch (e) {
    console.error('Storage clear error:', e);
  }
}
