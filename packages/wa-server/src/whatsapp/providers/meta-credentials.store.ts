import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { SessionConfig } from '../whatsapp-adapter.interface';
import { MetaCredentials } from './provider.types';

const ENVELOPE_VERSION = 1;
const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;
const INVALID_STORAGE = 'Meta credential storage is invalid or tampered; original file was preserved';

export interface StoredMetaSession {
  creds: MetaCredentials;
  config?: SessionConfig;
}

export class MetaCredentialStorageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MetaCredentialStorageError';
  }
}

interface MetaCredentialEnvelope {
  version: 1;
  iv: string;
  ciphertext: string;
  authTag: string;
}

export function requireMetaCredentialsEncryptionKey(): Buffer {
  const value = process.env.META_CREDENTIALS_ENCRYPTION_KEY;
  if (!value || !/^[0-9a-fA-F]{64}$/.test(value)) {
    throw new MetaCredentialStorageError(
      'META_CREDENTIALS_ENCRYPTION_KEY must be exactly 64 hexadecimal characters',
    );
  }
  return Buffer.from(value, 'hex');
}

export function writeMetaSession(filePath: string, state: StoredMetaSession): void {
  const key = requireMetaCredentialsEncryptionKey();
  writeEncrypted(filePath, state, key);
}

export function readMetaSession(filePath: string): StoredMetaSession {
  const key = requireMetaCredentialsEncryptionKey();
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    throw new MetaCredentialStorageError(INVALID_STORAGE);
  }

  if (isRecord(parsed) && Object.prototype.hasOwnProperty.call(parsed, 'version')) {
    if (!isEnvelope(parsed)) throw new MetaCredentialStorageError(INVALID_STORAGE);
    return decryptState(parsed, key);
  }

  const state = validateState(parsed);
  // The old plaintext shape is accepted only for this one-way rewrite.
  writeEncrypted(filePath, state, key);
  return state;
}

function writeEncrypted(filePath: string, state: StoredMetaSession, key: Buffer): void {
  const validState = validateState(state);
  let serialized: string;
  try {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, key, iv);
    const plaintext = Buffer.from(JSON.stringify(validState), 'utf8');
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const envelope: MetaCredentialEnvelope = {
      version: ENVELOPE_VERSION,
      iv: iv.toString('base64'),
      ciphertext: ciphertext.toString('base64'),
      authTag: cipher.getAuthTag().toString('base64'),
    };
    serialized = JSON.stringify(envelope);
  } catch {
    throw new MetaCredentialStorageError('Meta credential storage could not be encrypted');
  }

  atomicWrite(filePath, serialized);
}

function decryptState(envelope: MetaCredentialEnvelope, key: Buffer): StoredMetaSession {
  try {
    const iv = decodeBase64(envelope.iv);
    const ciphertext = decodeBase64(envelope.ciphertext);
    const authTag = decodeBase64(envelope.authTag);
    if (iv.length !== IV_BYTES || authTag.length !== AUTH_TAG_BYTES) throw new Error();

    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return validateState(JSON.parse(plaintext.toString('utf8')));
  } catch {
    throw new MetaCredentialStorageError(INVALID_STORAGE);
  }
}

function atomicWrite(filePath: string, contents: string): void {
  const directory = path.dirname(filePath);
  const tempPath = `${filePath}.${process.pid}.${randomBytes(8).toString('hex')}.tmp`;
  try {
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    const fd = fs.openSync(tempPath, 'wx', 0o600);
    try {
      fs.writeFileSync(fd, contents, 'utf8');
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    try {
      fs.chmodSync(tempPath, 0o600);
    } catch {
      // File modes are not enforced on every supported platform.
    }
    fs.renameSync(tempPath, filePath);
  } catch {
    try {
      fs.rmSync(tempPath, { force: true });
    } catch {
      // Preserve the original file if cleanup is unavailable.
    }
    throw new MetaCredentialStorageError(
      'Meta credential storage could not be updated; original file was preserved',
    );
  }
}

function isEnvelope(value: unknown): value is MetaCredentialEnvelope {
  return (
    isRecord(value) &&
    value.version === ENVELOPE_VERSION &&
    typeof value.iv === 'string' &&
    typeof value.ciphertext === 'string' &&
    typeof value.authTag === 'string'
  );
}

function validateState(value: unknown): StoredMetaSession {
  if (!isRecord(value) || !isMetaCredentials(value.creds)) {
    throw new MetaCredentialStorageError(INVALID_STORAGE);
  }
  if (value.config !== undefined && (!isRecord(value.config) || Array.isArray(value.config))) {
    throw new MetaCredentialStorageError(INVALID_STORAGE);
  }
  return {
    creds: value.creds,
    config: value.config as SessionConfig | undefined,
  };
}

function isMetaCredentials(value: unknown): value is MetaCredentials {
  return (
    isRecord(value) &&
    value.kind === 'meta' &&
    typeof value.phoneNumberId === 'string' &&
    typeof value.accessToken === 'string' &&
    typeof value.wabaId === 'string' &&
    typeof value.verifyToken === 'string' &&
    (value.appSecret === undefined || typeof value.appSecret === 'string')
  );
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function decodeBase64(value: string): Buffer {
  if (!value || value.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) throw new Error();
  const decoded = Buffer.from(value, 'base64');
  if (decoded.toString('base64') !== value) throw new Error();
  return decoded;
}
