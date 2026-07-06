import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import os from 'node:os';

const DEVICE_HASH_PREFIX = 'wyneeds-civil-aviation-ticketing-device-v1';

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function hashDeviceFingerprint(rawFingerprint: string): string {
  return sha256Hex(`${DEVICE_HASH_PREFIX}:${rawFingerprint.trim()}`);
}

export function normalizeInviteCode(inviteCode: string): string {
  return inviteCode.trim().toUpperCase().replace(/\s+/g, '');
}

export function hashInviteCode(inviteCode: string): string {
  return sha256Hex(`wyneeds-invite-v1:${normalizeInviteCode(inviteCode)}`);
}

export function createDeviceDisplayCode(deviceHash: string): string {
  const upper = deviceHash.replace(/[^a-fA-F0-9]/g, '').toUpperCase().padEnd(12, '0');
  return `${upper.slice(0, 4)}-${upper.slice(4, 8)}-${upper.slice(8, 12)}`;
}

function tryReadWindowsMachineGuid(): string | undefined {
  if (process.platform !== 'win32') return undefined;
  try {
    const output = execFileSync('reg', ['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid'], { encoding: 'utf8', windowsHide: true });
    const match = output.match(/MachineGuid\s+REG_SZ\s+([^\r\n]+)/i);
    return match?.[1]?.trim();
  } catch {
    return undefined;
  }
}

function tryReadMacPlatformUuid(): string | undefined {
  if (process.platform !== 'darwin') return undefined;
  try {
    const output = execFileSync('ioreg', ['-rd1', '-c', 'IOPlatformExpertDevice'], { encoding: 'utf8' });
    const match = output.match(/"IOPlatformUUID"\s=\s"([^"]+)"/);
    return match?.[1]?.trim();
  } catch {
    return undefined;
  }
}

function tryReadLinuxMachineId(): string | undefined {
  for (const file of ['/etc/machine-id', '/var/lib/dbus/machine-id']) {
    try {
      if (existsSync(file)) {
        const value = readFileSync(file, 'utf8').trim();
        if (value) return value;
      }
    } catch {
      // Continue to the next source.
    }
  }
  return undefined;
}

function fallbackFingerprint(): string {
  const cpu = os.cpus()[0]?.model ?? 'unknown-cpu';
  const user = (() => {
    try { return os.userInfo().username; } catch { return 'unknown-user'; }
  })();
  return [os.hostname(), user, os.platform(), os.arch(), cpu].join('|');
}

export function readRawDeviceFingerprint(): string {
  return tryReadWindowsMachineGuid()
    ?? tryReadMacPlatformUuid()
    ?? tryReadLinuxMachineId()
    ?? fallbackFingerprint();
}

export function getDeviceHash(): string {
  return hashDeviceFingerprint(readRawDeviceFingerprint());
}
