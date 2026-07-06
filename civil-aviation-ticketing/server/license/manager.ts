import path from 'node:path';
import { activateWithServer, checkWithServer } from './activationClient';
import { verifyLicenseCheckReceipt, verifyLicenseEnvelope } from './crypto';
import { createDeviceDisplayCode, getDeviceHash } from './device';
import { LicenseFileMalformedError, LicenseStateStore, LicenseStore, resolveLicenseFile, resolveLicenseStateFile } from './store';
import { normalizeActivationServerUrl } from './config';
import {
  LICENSE_APP_ID,
  LICENSE_PRODUCT,
  type LicenseEnvelope,
  type LicenseStatusResponse,
  type LicenseValidationResult,
} from './types';

export interface LicenseManagerOptions {
  dataDir?: string;
  filePath?: string;
  publicKeyPem: string;
  deviceHash?: string;
  activationServerUrl?: string;
  appVersion?: string;
  now?: () => Date;
}

export interface LicenseActivationResponse extends LicenseStatusResponse {
  remoteReused?: boolean;
  remoteCode?: string;
  remoteStatus?: number;
}

export class LicenseManager {
  private readonly store: LicenseStore;
  private readonly stateStore: LicenseStateStore;
  private readonly deviceHash: string;

  constructor(private readonly options: LicenseManagerOptions) {
    const filePath = options.filePath ?? resolveLicenseFile(options.dataDir);
    this.store = new LicenseStore(filePath);
    this.stateStore = new LicenseStateStore(resolveLicenseStateFile(options.dataDir));
    this.deviceHash = options.deviceHash ?? getDeviceHash();
  }

  getDeviceHash(): string {
    return this.deviceHash;
  }

  getDeviceDisplayCode(): string {
    return createDeviceDisplayCode(this.deviceHash);
  }

  async status(): Promise<LicenseStatusResponse> {
    let envelope;
    try {
      envelope = await this.store.read();
    } catch (error) {
      if (error instanceof LicenseFileMalformedError) return this.unlicensed('MALFORMED', '授权文件格式不正确，请重新激活或导入授权文件');
      throw error;
    }
    if (!envelope) return this.unlicensed('MISSING', '请先输入邀请码完成授权激活');
    const result = this.verify(envelope);
    if (!result.valid) return this.unlicensed(result.reason, result.message);
    const recheck = await this.enforceOnlineCheck(result.envelope);
    if (recheck) return recheck;
    return {
      licensed: true,
      deviceHash: this.deviceHash,
      deviceDisplayCode: this.getDeviceDisplayCode(),
      summary: result.summary,
      activationRequired: false,
      activationServerConfigured: Boolean(this.options.activationServerUrl),
    };
  }

  async importOffline(envelope: LicenseEnvelope): Promise<LicenseActivationResponse> {
    const result = this.verify(envelope);
    if (!result.valid) {
      return { ...this.unlicensed(result.reason, result.message), message: result.message };
    }
    await this.store.write(envelope);
    return { ...(await this.status()) };
  }

  async activate(inviteCode: string): Promise<LicenseActivationResponse> {
    if (!this.options.activationServerUrl) {
      return this.unlicensed('MISSING', '未配置授权服务器地址，无法在线激活');
    }
    const remote = await activateWithServer(this.options.activationServerUrl, {
      inviteCode,
      deviceHash: this.deviceHash,
      appVersion: this.options.appVersion,
    });
    if (!remote.ok) {
      return {
        ...this.unlicensed('MISSING', remote.message),
        message: remote.message,
        remoteCode: remote.code,
        remoteStatus: remote.status,
      };
    }
    const result = this.verify(remote.envelope);
    if (!result.valid) return { ...this.unlicensed(result.reason, result.message), message: result.message };
    await this.store.write(remote.envelope);
    await this.stateStore.write({
      schemaVersion: 1,
      licenseId: remote.envelope.payload.licenseId,
      lastOnlineCheckAt: this.now().toISOString(),
      lastCheckStatus: 'active',
    });
    const imported = await this.status();
    return { ...imported, remoteReused: remote.reused };
  }

  private verify(envelope: unknown): LicenseValidationResult {
    return verifyLicenseEnvelope(envelope, {
      publicKeyPem: this.options.publicKeyPem,
      expectedDeviceHash: this.deviceHash,
      now: this.options.now?.(),
      expectedAppId: LICENSE_APP_ID,
      expectedProduct: LICENSE_PRODUCT,
    });
  }

  private now(): Date {
    return this.options.now?.() ?? new Date();
  }

  private async enforceOnlineCheck(envelope: LicenseEnvelope): Promise<LicenseStatusResponse | undefined> {
    const graceDays = envelope.payload.offlineGraceDays;
    if (!Number.isFinite(graceDays) || graceDays <= 0) return undefined;
    const now = this.now();

    const state = await this.stateStore.read();
    const lastOnline = state?.licenseId === envelope.payload.licenseId
      ? state.lastOnlineCheckAt
      : undefined;
    const lastOnlineAt = this.safeOnlineCheckDate(lastOnline) ?? new Date(envelope.payload.activatedAt ?? envelope.payload.issuedAt);
    const dueAt = new Date(lastOnlineAt);
    dueAt.setUTCDate(dueAt.getUTCDate() + graceDays);
    if (now.getTime() <= dueAt.getTime()) return undefined;

    const checkUrl = normalizeActivationServerUrl(envelope.payload.licenseServerUrl ?? this.options.activationServerUrl);
    if (!checkUrl) return this.unlicensed('ONLINE_CHECK_REQUIRED', '授权已超过离线宽限期，需要连接正式授权服务器复核');

    const check = await checkWithServer(checkUrl, {
      licenseId: envelope.payload.licenseId,
      deviceHash: this.deviceHash,
    });
    if (!check.ok) return this.unlicensed('ONLINE_CHECK_REQUIRED', `授权需要联网复核：${check.message}`);
    const receipt = verifyLicenseCheckReceipt(check.receipt, {
      publicKeyPem: this.options.publicKeyPem,
      expectedLicenseId: envelope.payload.licenseId,
      expectedDeviceHash: this.deviceHash,
      now,
    });
    if (!receipt.valid) return this.unlicensed('ONLINE_CHECK_REQUIRED', `授权复核失败：${receipt.message}`);

    if (receipt.status !== 'active') {
      const reason = receipt.status === 'expired' ? 'EXPIRED' : receipt.status === 'unknown' ? 'REMOTE_UNKNOWN' : 'REVOKED';
      const message = receipt.status === 'unknown' ? '授权记录不存在，请联系供应商' : receipt.message;
      await this.stateStore.write({
        schemaVersion: 1,
        licenseId: envelope.payload.licenseId,
        lastOnlineCheckAt: receipt.checkedAt,
        lastCheckStatus: receipt.status,
      });
      return this.unlicensed(reason, message);
    }

    await this.stateStore.write({
      schemaVersion: 1,
      licenseId: envelope.payload.licenseId,
      lastOnlineCheckAt: receipt.checkedAt,
      lastCheckStatus: 'active',
    });
    return undefined;
  }

  private safeOnlineCheckDate(value?: string): Date | undefined {
    if (!value) return undefined;
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return undefined;
    if (parsed.getTime() > this.now().getTime() + 5 * 60 * 1000) return undefined;
    return parsed;
  }

  private unlicensed(reason: LicenseStatusResponse['reason'], message: string): LicenseStatusResponse {
    return {
      licensed: false,
      reason,
      message,
      deviceHash: this.deviceHash,
      deviceDisplayCode: this.getDeviceDisplayCode(),
      activationRequired: true,
      activationServerConfigured: Boolean(this.options.activationServerUrl),
    };
  }
}

export function resolveLicenseDataDir(customDir?: string): string {
  return customDir ?? process.env.CA_TICKETING_DATA_DIR ?? path.resolve(process.cwd(), '.local-data');
}
