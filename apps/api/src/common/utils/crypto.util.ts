import * as crypto from 'crypto';
import { RouterDto } from '@isp-crm/shared';

const DEFAULT_SECRET = 'ispcrm-default-32-byte-secret-key-1234567890';

function getDerivedKey(customSecret?: string): Buffer {
  const secret = customSecret || process.env.ROUTER_ENCRYPTION_KEY || process.env.JWT_SECRET || DEFAULT_SECRET;
  return crypto.createHash('sha256').update(secret).digest();
}

/**
 * Encrypts sensitive router credentials (passwords, API tokens) using AES-256-GCM.
 * Output format: iv_hex:auth_tag_hex:ciphertext_hex
 */
export function encryptCredential(plainText: string, customSecret?: string): string {
  if (!plainText) {
    throw new Error('Cannot encrypt empty or null credential');
  }

  const key = getDerivedKey(customSecret);
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

  const encrypted = Buffer.concat([
    cipher.update(plainText, 'utf8'),
    cipher.final(),
  ]);

  const authTag = cipher.getAuthTag();

  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

/**
 * Decrypts AES-256-GCM encrypted router credentials in-memory for RouterOS API dispatch.
 * Plaintext should NEVER be logged, returned in API responses, or leaked in error messages.
 */
export function decryptCredential(encryptedPayload: string, customSecret?: string): string {
  if (!encryptedPayload) {
    throw new Error('Cannot decrypt empty or null credential payload');
  }

  const parts = encryptedPayload.split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted credential format. Expected iv:authTag:ciphertext');
  }

  const [ivHex, authTagHex, cipherTextHex] = parts;
  const key = getDerivedKey(customSecret);
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  const cipherText = Buffer.from(cipherTextHex, 'hex');

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);

  try {
    const decrypted = Buffer.concat([
      decipher.update(cipherText),
      decipher.final(),
    ]);
    return decrypted.toString('utf8');
  } catch (err) {
    throw new Error('Failed to decrypt credential: Authentication tag mismatch or corrupted data');
  }
}

/**
 * Strictly sanitizes router entities before serialization to the frontend or API consumers.
 * Strips encryptedCredential, password, or any raw credential fields.
 */
export function sanitizeRouter<T extends Record<string, any>>(router: T): RouterDto {
  const sanitized = { ...router };
  delete sanitized.encryptedCredential;
  delete sanitized.password;
  delete sanitized.apiPassword;
  return sanitized as unknown as RouterDto;
}

/**
 * Sanitizes an array of router entities.
 */
export function sanitizeRouters<T extends Record<string, any>>(routers: T[]): RouterDto[] {
  return routers.map((r) => sanitizeRouter(r));
}

/**
 * Masks sensitive values in log messages or error messages.
 */
export function maskSecret(val: string): string {
  return '[REDACTED]';
}

/**
 * Removes any detected secrets or credentials from log strings and error messages.
 */
export function sanitizeMessage(message: string, secrets: string[] = []): string {
  let safeMessage = message;
  for (const secret of secrets) {
    if (secret && secret.length >= 3) {
      safeMessage = safeMessage.split(secret).join('[REDACTED]');
    }
  }
  // Also strip common Basic auth or Authorization header values
  safeMessage = safeMessage.replace(/Authorization:\s*Basic\s+[A-Za-z0-9+/=]+/gi, 'Authorization: Basic [REDACTED]');
  safeMessage = safeMessage.replace(/password[:=]["']?[^"',\s}]+/gi, 'password=[REDACTED]');
  safeMessage = safeMessage.replace(/secret[:=]["']?[^"',\s}]+/gi, 'secret=[REDACTED]');
  return safeMessage;
}
