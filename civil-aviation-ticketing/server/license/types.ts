export const LICENSE_SCHEMA_VERSION = 1 as const;
export const LICENSE_APP_ID = 'cn.training.civil-aviation-ticketing';
export const LICENSE_PRODUCT = '民航客票销售订座系统';
export const DEFAULT_LICENSE_KEY_ID = 'wyneeds-license-key-2026-07';

export type LicenseFeature = 'ticketing' | 'training' | 'desktop';

export interface LicensePayload {
  schemaVersion: typeof LICENSE_SCHEMA_VERSION;
  appId: string;
  product: string;
  licenseId: string;
  inviteCodeHash: string;
  customerName: string;
  deviceHash: string;
  maxDevices: number;
  features: LicenseFeature[];
  issuedAt: string;
  activatedAt: string;
  expiresAt: string;
  offlineGraceDays: number;
  licenseServerUrl?: string;
}

export interface LicenseEnvelope {
  algorithm: 'Ed25519';
  keyId: string;
  payload: LicensePayload;
  signature: string;
}

export type LicenseInvalidReason =
  | 'MISSING'
  | 'MALFORMED'
  | 'SIGNATURE_INVALID'
  | 'DEVICE_MISMATCH'
  | 'EXPIRED'
  | 'REVOKED'
  | 'REMOTE_UNKNOWN'
  | 'ONLINE_CHECK_REQUIRED'
  | 'APP_MISMATCH'
  | 'PRODUCT_MISMATCH'
  | 'SCHEMA_UNSUPPORTED';

export interface LicenseSummary {
  licenseId: string;
  customerName: string;
  expiresAt: string;
  features: LicenseFeature[];
  deviceHash: string;
  deviceDisplayCode: string;
  offlineGraceDays: number;
  licenseServerUrl?: string;
}

export type LicenseRemoteStatus = 'active' | 'revoked' | 'expired' | 'unknown';

export interface LicenseCheckReceiptPayload {
  schemaVersion: typeof LICENSE_SCHEMA_VERSION;
  appId: string;
  licenseId: string;
  deviceHash: string;
  status: LicenseRemoteStatus;
  message: string;
  checkedAt: string;
}

export interface LicenseCheckReceipt {
  algorithm: 'Ed25519';
  keyId: string;
  payload: LicenseCheckReceiptPayload;
  signature: string;
}

export interface LicenseValidationOptions {
  publicKeyPem: string;
  expectedDeviceHash: string;
  now?: Date;
  expectedAppId?: string;
  expectedProduct?: string;
}

export type LicenseValidationResult =
  | { valid: true; summary: LicenseSummary; envelope: LicenseEnvelope }
  | { valid: false; reason: LicenseInvalidReason; message: string; envelope?: LicenseEnvelope };

export interface LicenseStatusResponse {
  licensed: boolean;
  reason?: LicenseInvalidReason;
  message?: string;
  deviceHash: string;
  deviceDisplayCode: string;
  summary?: LicenseSummary;
  activationRequired: boolean;
  activationServerConfigured: boolean;
}
