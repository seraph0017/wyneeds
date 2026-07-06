import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { signLicensePayload } from './crypto';
import { hashInviteCode } from './device';
import {
  DEFAULT_LICENSE_KEY_ID,
  LICENSE_APP_ID,
  LICENSE_PRODUCT,
  LICENSE_SCHEMA_VERSION,
  type LicenseEnvelope,
  type LicenseFeature,
  type LicensePayload,
} from './types';

export type InviteStatus = 'active' | 'revoked';
export type ActivationErrorCode = 'INVITE_NOT_FOUND' | 'INVITE_REVOKED' | 'INVITE_EXPIRED' | 'DEVICE_LIMIT_REACHED' | 'INVALID_REQUEST';

export interface InviteActivationRecord {
  licenseId: string;
  deviceHash: string;
  activatedAt: string;
  appVersion?: string;
}

export interface InviteRecord {
  codeHash: string;
  customerName: string;
  maxDevices: number;
  licenseDays: number;
  expiresAt: string;
  status: InviteStatus;
  createdAt: string;
  features: LicenseFeature[];
  activations: InviteActivationRecord[];
}

export interface InviteDatabase {
  schemaVersion: 1;
  invites: InviteRecord[];
  revokedLicenseIds?: string[];
}

export interface CreateInviteInput {
  code: string;
  customerName: string;
  maxDevices?: number;
  licenseDays?: number;
  expiresAt?: string;
  features?: LicenseFeature[];
  now?: Date;
}

export interface ActivationRequest {
  inviteCode: string;
  deviceHash: string;
  appVersion?: string;
}

export interface IssuerOptions {
  privateKeyPem: string;
  keyId?: string;
  now?: Date;
  licenseServerUrl?: string;
}

export type ActivationResult =
  | { ok: true; envelope: LicenseEnvelope; reused: boolean }
  | { ok: false; code: ActivationErrorCode; message: string; status: number };

export type LicenseCheckResult =
  | { ok: true; status: 'active' | 'revoked' | 'expired' | 'unknown'; message: string }
  | { ok: false; code: 'INVALID_REQUEST'; message: string; statusCode: number };

const databaseQueues = new Map<string, Promise<unknown>>();
const defaultFeatures: LicenseFeature[] = ['ticketing', 'training', 'desktop'];
const allowedFeatures = new Set<LicenseFeature>(defaultFeatures);

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
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

function assertPositiveInteger(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 1) throw new Error(`${label}必须是正整数`);
  return value;
}

function assertDateOnly(value: string, label: string): string {
  if (!parseDateEndOfDay(value)) throw new Error(`${label}必须是 YYYY-MM-DD 格式`);
  return value;
}

function assertNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label}不能为空`);
  return value.trim();
}

function normalizeFeatures(value: unknown): LicenseFeature[] {
  if (!Array.isArray(value) || value.length === 0) return defaultFeatures;
  const features = value.filter((item): item is LicenseFeature => typeof item === 'string' && allowedFeatures.has(item as LicenseFeature));
  return features.length > 0 ? Array.from(new Set(features)) : defaultFeatures;
}

function isValidDeviceHash(value: string): boolean {
  return /^[a-f0-9]{64}$/i.test(value);
}

function isValidInviteCode(value: string): boolean {
  return /^[A-Z0-9-]{6,80}$/i.test(value);
}

function shortHash(value: string): string {
  return value.replace(/[^a-fA-F0-9]/g, '').toUpperCase().slice(0, 16).padEnd(16, '0');
}

function createLicenseId(codeHash: string, deviceHash: string): string {
  return `LIC-${shortHash(hashInviteCode(`${codeHash}:${deviceHash}`))}`;
}

export function createInviteRecord(input: CreateInviteInput): InviteRecord {
  const now = input.now ?? new Date();
  const licenseDays = input.licenseDays ?? 365;
  const maxDevices = assertPositiveInteger(input.maxDevices ?? 1, '可绑定设备数');
  assertPositiveInteger(licenseDays, '授权天数');
  const expiresAt = assertDateOnly(input.expiresAt ?? isoDate(addDays(now, licenseDays)), '授权到期日');
  const customerName = input.customerName.trim();
  if (!customerName) throw new Error('客户名称不能为空');
  const code = assertNonEmptyString(input.code, '邀请码');
  return {
    codeHash: hashInviteCode(code),
    customerName,
    maxDevices,
    licenseDays,
    expiresAt,
    status: 'active',
    createdAt: now.toISOString(),
    features: normalizeFeatures(input.features),
    activations: [],
  };
}

export async function loadInviteDatabase(dbPath: string): Promise<InviteDatabase> {
  try {
    const raw = await readFile(dbPath, 'utf8');
    const parsed = JSON.parse(raw) as Partial<InviteDatabase>;
    const invites = Array.isArray(parsed.invites) ? parsed.invites as InviteRecord[] : [];
    for (const invite of invites) {
      invite.codeHash = assertNonEmptyString(invite.codeHash, '邀请码哈希');
      invite.customerName = assertNonEmptyString(invite.customerName, '客户名称');
      invite.maxDevices = assertPositiveInteger(Number(invite.maxDevices), '可绑定设备数');
      invite.licenseDays = assertPositiveInteger(Number(invite.licenseDays), '授权天数');
      invite.expiresAt = assertDateOnly(String(invite.expiresAt ?? ''), '授权到期日');
      if (!Array.isArray(invite.activations)) throw new Error('激活记录格式不正确');
      for (const activation of invite.activations) {
        activation.licenseId = assertNonEmptyString(activation.licenseId, '授权编号');
        activation.deviceHash = assertNonEmptyString(activation.deviceHash, '设备信息');
        activation.activatedAt = assertNonEmptyString(activation.activatedAt, '激活时间');
        if (activation.appVersion !== undefined && typeof activation.appVersion !== 'string') delete activation.appVersion;
      }
      invite.features = normalizeFeatures(invite.features);
      if (invite.status !== 'active' && invite.status !== 'revoked') invite.status = 'revoked';
    }
    return {
      schemaVersion: 1,
      invites,
      revokedLicenseIds: Array.isArray(parsed.revokedLicenseIds) ? parsed.revokedLicenseIds : [],
    };
  } catch (error: unknown) {
    if ((error as { code?: string }).code === 'ENOENT') return { schemaVersion: 1, invites: [], revokedLicenseIds: [] };
    throw error;
  }
}

export async function saveInviteDatabase(dbPath: string, database: InviteDatabase): Promise<void> {
  await mkdir(path.dirname(dbPath), { recursive: true });
  const tempPath = `${dbPath}.tmp`;
  await writeFile(tempPath, JSON.stringify({ ...database, schemaVersion: 1 }, null, 2), 'utf8');
  await rename(tempPath, dbPath);
}

async function withDatabaseLock<T>(dbPath: string, task: () => Promise<T>): Promise<T> {
  const previous = databaseQueues.get(dbPath) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(task);
  const tail = next.catch(() => undefined);
  databaseQueues.set(dbPath, tail);
  tail.finally(() => {
    if (databaseQueues.get(dbPath) === tail) databaseQueues.delete(dbPath);
  }).catch(() => undefined);
  return next;
}

function signActivation(invite: InviteRecord, activation: InviteActivationRecord, options: IssuerOptions): LicenseEnvelope {
  const now = options.now ?? new Date();
  const payload: LicensePayload = {
    schemaVersion: LICENSE_SCHEMA_VERSION,
    appId: LICENSE_APP_ID,
    product: LICENSE_PRODUCT,
    licenseId: activation.licenseId,
    inviteCodeHash: invite.codeHash,
    customerName: invite.customerName,
    deviceHash: activation.deviceHash,
    maxDevices: invite.maxDevices,
    features: invite.features,
    issuedAt: now.toISOString(),
    activatedAt: activation.activatedAt,
    expiresAt: invite.expiresAt,
    offlineGraceDays: 30,
    licenseServerUrl: options.licenseServerUrl,
  };
  return signLicensePayload(payload, options.privateKeyPem, options.keyId ?? DEFAULT_LICENSE_KEY_ID);
}

export async function activateInvite(dbPath: string, request: ActivationRequest, options: IssuerOptions): Promise<ActivationResult> {
  return withDatabaseLock(dbPath, async () => activateInviteUnlocked(dbPath, request, options));
}

async function activateInviteUnlocked(dbPath: string, request: ActivationRequest, options: IssuerOptions): Promise<ActivationResult> {
  const inviteCode = request.inviteCode?.trim();
  const deviceHash = request.deviceHash?.trim();
  if (!inviteCode || !deviceHash) {
    return { ok: false, code: 'INVALID_REQUEST', message: '邀请码和设备信息不能为空', status: 422 };
  }
  if (!isValidInviteCode(inviteCode) || !isValidDeviceHash(deviceHash)) {
    return { ok: false, code: 'INVALID_REQUEST', message: '邀请码或设备信息格式不正确', status: 422 };
  }

  const database = await loadInviteDatabase(dbPath);
  const codeHash = hashInviteCode(inviteCode);
  const invite = database.invites.find((item) => item.codeHash === codeHash);
  if (!invite) return { ok: false, code: 'INVITE_NOT_FOUND', message: '邀请码不存在或已失效', status: 404 };
  if (invite.status !== 'active') return { ok: false, code: 'INVITE_REVOKED', message: '邀请码已被停用', status: 403 };

  const now = options.now ?? new Date();
  const expires = parseDateEndOfDay(invite.expiresAt);
  if (!expires || now.getTime() > expires.getTime()) {
    return { ok: false, code: 'INVITE_EXPIRED', message: '邀请码已过期', status: 403 };
  }

  const existing = invite.activations.find((activation) => activation.deviceHash === deviceHash);
  if (existing) return { ok: true, envelope: signActivation(invite, existing, options), reused: true };
  if (invite.activations.length >= invite.maxDevices) {
    return { ok: false, code: 'DEVICE_LIMIT_REACHED', message: '邀请码可绑定设备数已用完', status: 409 };
  }

  const activation: InviteActivationRecord = {
    licenseId: createLicenseId(invite.codeHash, deviceHash),
    deviceHash,
    activatedAt: now.toISOString(),
    appVersion: request.appVersion,
  };
  invite.activations.push(activation);
  await saveInviteDatabase(dbPath, database);
  return { ok: true, envelope: signActivation(invite, activation, options), reused: false };
}

export async function checkLicense(dbPath: string, request: { licenseId?: string; deviceHash?: string }, now = new Date()): Promise<LicenseCheckResult> {
  if (!request.licenseId || !request.deviceHash) {
    return { ok: false, code: 'INVALID_REQUEST', message: '授权编号和设备信息不能为空', statusCode: 422 };
  }
  const database = await loadInviteDatabase(dbPath);
  if ((database.revokedLicenseIds ?? []).includes(request.licenseId)) {
    return { ok: true, status: 'revoked', message: '授权已被停用' };
  }
  const invite = database.invites.find((item) => item.activations.some((activation) => activation.licenseId === request.licenseId && activation.deviceHash === request.deviceHash));
  if (!invite) return { ok: true, status: 'unknown', message: '授权记录不存在' };
  if (invite.status !== 'active') return { ok: true, status: 'revoked', message: '授权已被停用' };
  const expires = parseDateEndOfDay(invite.expiresAt);
  if (!expires || now.getTime() > expires.getTime()) return { ok: true, status: 'expired', message: '授权已过期' };
  return { ok: true, status: 'active', message: '授权有效' };
}
