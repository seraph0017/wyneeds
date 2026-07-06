import { generateKeyPairSync, randomInt } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createInviteRecord, loadInviteDatabase, saveInviteDatabase } from '../server/license/issuer';
import { hashInviteCode, normalizeInviteCode } from '../server/license/device';

const DEFAULT_DB = path.resolve(process.cwd(), '.license-server', 'invites.json');

function parseArgs(argv: string[]): { command?: string; options: Record<string, string | boolean> } {
  const [command, ...rest] = argv;
  const options: Record<string, string | boolean> = {};
  for (let i = 0; i < rest.length; i += 1) {
    const item = rest[i];
    if (!item.startsWith('--')) continue;
    const key = item.slice(2);
    const next = rest[i + 1];
    if (!next || next.startsWith('--')) options[key] = true;
    else {
      options[key] = next;
      i += 1;
    }
  }
  return { command, options };
}

function stringOption(options: Record<string, string | boolean>, key: string, fallback = ''): string {
  const value = options[key];
  return typeof value === 'string' ? value : fallback;
}

function numberOption(options: Record<string, string | boolean>, key: string, fallback: number): number {
  const raw = stringOption(options, key, String(fallback));
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) throw new Error(`--${key} 必须是正整数`);
  return value;
}

function assertDateOption(value: string): string | undefined {
  if (!value) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error('--expires-at 必须是 YYYY-MM-DD 格式');
  }
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    throw new Error('--expires-at 必须是 YYYY-MM-DD 格式');
  }
  return value;
}

function randomCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const chars = Array.from({ length: 28 }, () => alphabet[randomInt(alphabet.length)]).join('');
  return `WY-${new Date().getUTCFullYear()}-${chars.match(/.{1,4}/g)!.join('-')}`;
}

async function generateKeys(options: Record<string, string | boolean>): Promise<void> {
  const outDir = path.resolve(stringOption(options, 'out-dir', 'secrets/license'));
  await mkdir(outDir, { recursive: true });
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  await writeFile(path.join(outDir, 'license-private-key.pem'), privateKeyPem, { encoding: 'utf8', mode: 0o600 });
  await writeFile(path.join(outDir, 'license-public-key.pem'), publicKeyPem, 'utf8');
  console.log(JSON.stringify({ privateKey: path.join(outDir, 'license-private-key.pem'), publicKey: path.join(outDir, 'license-public-key.pem') }, null, 2));
}

async function createInvite(options: Record<string, string | boolean>): Promise<void> {
  const dbPath = path.resolve(stringOption(options, 'db', DEFAULT_DB));
  const customerName = stringOption(options, 'customer').trim();
  if (!customerName) throw new Error('缺少 --customer "客户名称"');
  const code = normalizeInviteCode(stringOption(options, 'code', randomCode()));
  const database = await loadInviteDatabase(dbPath);
  if (database.invites.some((invite) => invite.codeHash === hashInviteCode(code))) throw new Error('邀请码已存在');
  const invite = createInviteRecord({
    code,
    customerName,
    maxDevices: numberOption(options, 'max-devices', 1),
    licenseDays: numberOption(options, 'license-days', 365),
    expiresAt: assertDateOption(stringOption(options, 'expires-at')),
  });
  database.invites.push(invite);
  await saveInviteDatabase(dbPath, database);
  console.log(JSON.stringify({ code, customerName, maxDevices: invite.maxDevices, expiresAt: invite.expiresAt, dbPath }, null, 2));
}

async function listInvites(options: Record<string, string | boolean>): Promise<void> {
  const dbPath = path.resolve(stringOption(options, 'db', DEFAULT_DB));
  const database = await loadInviteDatabase(dbPath);
  console.log(JSON.stringify(database.invites.map((invite) => ({
    customerName: invite.customerName,
    status: invite.status,
    maxDevices: invite.maxDevices,
    usedDevices: invite.activations.length,
    expiresAt: invite.expiresAt,
    licenseIds: invite.activations.map((activation) => activation.licenseId),
  })), null, 2));
}

async function revokeInvite(options: Record<string, string | boolean>): Promise<void> {
  const dbPath = path.resolve(stringOption(options, 'db', DEFAULT_DB));
  const code = stringOption(options, 'code');
  if (!code) throw new Error('缺少 --code');
  const database = await loadInviteDatabase(dbPath);
  const invite = database.invites.find((item) => item.codeHash === hashInviteCode(code));
  if (!invite) throw new Error('邀请码不存在');
  invite.status = 'revoked';
  await saveInviteDatabase(dbPath, database);
  console.log(JSON.stringify({ revoked: true, code: normalizeInviteCode(code) }, null, 2));
}

async function revokeLicense(options: Record<string, string | boolean>): Promise<void> {
  const dbPath = path.resolve(stringOption(options, 'db', DEFAULT_DB));
  const licenseId = stringOption(options, 'license-id').trim();
  if (!licenseId) throw new Error('缺少 --license-id');
  const database = await loadInviteDatabase(dbPath);
  database.revokedLicenseIds = Array.from(new Set([...(database.revokedLicenseIds ?? []), licenseId]));
  await saveInviteDatabase(dbPath, database);
  console.log(JSON.stringify({ revoked: true, licenseId }, null, 2));
}

function usage(): void {
  console.log(`Usage:
  npm run license:keys
  npm run license:invite -- --customer "某某学校" [--db .license-server/invites.json] [--max-devices 1] [--license-days 365] [--expires-at 2027-07-06]
  npx tsx scripts/license-admin.ts list [--db .license-server/invites.json]
  npx tsx scripts/license-admin.ts revoke-invite --code WY-2026-XXXX [--db .license-server/invites.json]
  npx tsx scripts/license-admin.ts revoke-license --license-id LIC-XXXXXXXX [--db .license-server/invites.json]`);
}

const { command, options } = parseArgs(process.argv.slice(2));
try {
  if (command === 'generate-keys') await generateKeys(options);
  else if (command === 'create-invite') await createInvite(options);
  else if (command === 'list') await listInvites(options);
  else if (command === 'revoke-invite') await revokeInvite(options);
  else if (command === 'revoke-license') await revokeLicense(options);
  else usage();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
