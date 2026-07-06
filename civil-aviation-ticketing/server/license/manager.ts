import path from 'node:path';
import { activateWithServer } from './activationClient';
import { verifyLicenseEnvelope } from './crypto';
import { createDeviceDisplayCode, getDeviceHash } from './device';
import { LicenseStore, resolveLicenseFile } from './store';
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
}

export class LicenseManager {
  private readonly store: LicenseStore;
  private readonly deviceHash: string;

  constructor(private readonly options: LicenseManagerOptions) {
    const filePath = options.filePath ?? resolveLicenseFile(options.dataDir);
    this.store = new LicenseStore(filePath);
    this.deviceHash = options.deviceHash ?? getDeviceHash();
  }

  getDeviceHash(): string {
    return this.deviceHash;
  }

  getDeviceDisplayCode(): string {
    return createDeviceDisplayCode(this.deviceHash);
  }

  async status(): Promise<LicenseStatusResponse> {
    const envelope = await this.store.read();
    if (!envelope) return this.unlicensed('MISSING', '请先输入邀请码完成授权激活');
    const result = this.verify(envelope);
    if (!result.valid) return this.unlicensed(result.reason, result.message);
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
      return { ...this.unlicensed('MISSING', remote.message), message: remote.message };
    }
    const imported = await this.importOffline(remote.envelope);
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
