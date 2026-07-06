import { createPrivateKey, createPublicKey, sign, verify } from 'node:crypto';
import { canonicalJson } from './canonical';
import { createDeviceDisplayCode } from './device';
import {
  DEFAULT_LICENSE_KEY_ID,
  LICENSE_APP_ID,
  LICENSE_PRODUCT,
  LICENSE_SCHEMA_VERSION,
  type LicenseCheckReceipt,
  type LicenseCheckReceiptPayload,
  type LicenseEnvelope,
  type LicensePayload,
  type LicenseRemoteStatus,
  type LicenseValidationOptions,
  type LicenseValidationResult,
} from './types';

function payloadBytes(payload: LicensePayload): Buffer {
  return Buffer.from(canonicalJson(payload), 'utf8');
}

function parseDateEndOfDay(value: string): Date | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day, 23, 59, 59, 999));
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    return undefined;
  }
  return parsed;
}

function parseIsoDateTime(value: string): Date | undefined {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

export function signLicensePayload(payload: LicensePayload, privateKeyPem: string, keyId = DEFAULT_LICENSE_KEY_ID): LicenseEnvelope {
  const privateKey = createPrivateKey(privateKeyPem);
  const signature = sign(null, payloadBytes(payload), privateKey).toString('base64');
  return { algorithm: 'Ed25519', keyId, payload, signature };
}

function checkReceiptBytes(payload: LicenseCheckReceiptPayload): Buffer {
  return Buffer.from(canonicalJson(payload), 'utf8');
}

export function signLicenseCheckReceipt(payload: LicenseCheckReceiptPayload, privateKeyPem: string, keyId = DEFAULT_LICENSE_KEY_ID): LicenseCheckReceipt {
  const privateKey = createPrivateKey(privateKeyPem);
  const signature = sign(null, checkReceiptBytes(payload), privateKey).toString('base64');
  return { algorithm: 'Ed25519', keyId, payload, signature };
}

function isLicenseEnvelope(value: unknown): value is LicenseEnvelope {
  const candidate = value as Partial<LicenseEnvelope> | undefined;
  return Boolean(candidate)
    && candidate?.algorithm === 'Ed25519'
    && typeof candidate.keyId === 'string'
    && typeof candidate.signature === 'string'
    && typeof candidate.payload === 'object'
    && candidate.payload !== null;
}

function isLicenseCheckReceipt(value: unknown): value is LicenseCheckReceipt {
  const candidate = value as Partial<LicenseCheckReceipt> | undefined;
  return Boolean(candidate)
    && candidate?.algorithm === 'Ed25519'
    && typeof candidate.keyId === 'string'
    && typeof candidate.signature === 'string'
    && typeof candidate.payload === 'object'
    && candidate.payload !== null;
}

function isRemoteStatus(value: unknown): value is LicenseRemoteStatus {
  return value === 'active' || value === 'revoked' || value === 'expired' || value === 'unknown';
}

export function verifyLicenseEnvelope(envelope: unknown, options: LicenseValidationOptions): LicenseValidationResult {
  if (!isLicenseEnvelope(envelope)) {
    return { valid: false, reason: 'MALFORMED', message: '授权文件格式不正确' };
  }

  const payload = envelope.payload;
  if (payload.schemaVersion !== LICENSE_SCHEMA_VERSION) {
    return { valid: false, reason: 'SCHEMA_UNSUPPORTED', message: '授权文件版本不支持', envelope };
  }
  const expectedAppId = options.expectedAppId ?? LICENSE_APP_ID;
  const expectedProduct = options.expectedProduct ?? LICENSE_PRODUCT;
  if (payload.appId !== expectedAppId) {
    return { valid: false, reason: 'APP_MISMATCH', message: '授权不适用于当前应用', envelope };
  }
  if (payload.product !== expectedProduct) {
    return { valid: false, reason: 'PRODUCT_MISMATCH', message: '授权不适用于当前产品', envelope };
  }

  let signatureValid = false;
  try {
    const publicKey = createPublicKey(options.publicKeyPem);
    signatureValid = verify(null, payloadBytes(payload), publicKey, Buffer.from(envelope.signature, 'base64'));
  } catch {
    signatureValid = false;
  }
  if (!signatureValid) {
    return { valid: false, reason: 'SIGNATURE_INVALID', message: '授权签名校验失败', envelope };
  }

  if (payload.deviceHash !== options.expectedDeviceHash) {
    return { valid: false, reason: 'DEVICE_MISMATCH', message: '授权已绑定其他设备', envelope };
  }

  const expires = parseDateEndOfDay(payload.expiresAt);
  if (!expires || (options.now ?? new Date()).getTime() > expires.getTime()) {
    return { valid: false, reason: 'EXPIRED', message: '授权已过期', envelope };
  }

  return {
    valid: true,
    envelope,
    summary: {
      licenseId: payload.licenseId,
      customerName: payload.customerName,
      expiresAt: payload.expiresAt,
      features: payload.features,
      deviceHash: payload.deviceHash,
      deviceDisplayCode: createDeviceDisplayCode(payload.deviceHash),
      offlineGraceDays: payload.offlineGraceDays,
      licenseServerUrl: payload.licenseServerUrl,
    },
  };
}

export interface LicenseCheckReceiptValidationOptions {
  publicKeyPem: string;
  expectedLicenseId: string;
  expectedDeviceHash: string;
  now?: Date;
  maxAgeMs?: number;
  maxFutureSkewMs?: number;
}

export type LicenseCheckReceiptValidationResult =
  | { valid: true; status: LicenseRemoteStatus; message: string; checkedAt: string; receipt: LicenseCheckReceipt }
  | { valid: false; message: string };

export function verifyLicenseCheckReceipt(receipt: unknown, options: LicenseCheckReceiptValidationOptions): LicenseCheckReceiptValidationResult {
  if (!isLicenseCheckReceipt(receipt)) return { valid: false, message: '授权复核回执格式不正确' };

  const payload = receipt.payload;
  if (
    payload.schemaVersion !== LICENSE_SCHEMA_VERSION ||
    payload.appId !== LICENSE_APP_ID ||
    payload.licenseId !== options.expectedLicenseId ||
    payload.deviceHash !== options.expectedDeviceHash ||
    !isRemoteStatus(payload.status) ||
    typeof payload.message !== 'string' ||
    typeof payload.checkedAt !== 'string'
  ) {
    return { valid: false, message: '授权复核回执内容不匹配' };
  }

  let signatureValid = false;
  try {
    const publicKey = createPublicKey(options.publicKeyPem);
    signatureValid = verify(null, checkReceiptBytes(payload), publicKey, Buffer.from(receipt.signature, 'base64'));
  } catch {
    signatureValid = false;
  }
  if (!signatureValid) return { valid: false, message: '授权复核回执签名校验失败' };

  const checkedAt = parseIsoDateTime(payload.checkedAt);
  if (!checkedAt) return { valid: false, message: '授权复核回执时间不正确' };
  const now = options.now ?? new Date();
  const maxFutureSkewMs = options.maxFutureSkewMs ?? 5 * 60 * 1000;
  const maxAgeMs = options.maxAgeMs ?? 10 * 60 * 1000;
  if (checkedAt.getTime() > now.getTime() + maxFutureSkewMs) return { valid: false, message: '授权复核回执时间异常' };
  if (now.getTime() - checkedAt.getTime() > maxAgeMs) return { valid: false, message: '授权复核回执已过期' };

  return {
    valid: true,
    status: payload.status,
    message: payload.message,
    checkedAt: payload.checkedAt,
    receipt,
  };
}
