import express from 'express';
import rateLimit from 'express-rate-limit';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { activateInvite, checkLicense } from '../server/license/issuer';
import { signLicenseCheckReceipt } from '../server/license/crypto';
import { normalizeActivationServerUrl } from '../server/license/config';
import { LICENSE_APP_ID, LICENSE_SCHEMA_VERSION } from '../server/license/types';

const DEFAULT_DB = path.resolve(process.cwd(), '.license-server', 'invites.json');
const DEFAULT_PRIVATE_KEY = path.resolve(process.cwd(), 'secrets', 'license', 'license-private-key.pem');
const PORT = Number(process.env.CA_LICENSE_PORT || 8787);
const HOST = process.env.CA_LICENSE_HOST || '127.0.0.1';
const DB_PATH = path.resolve(process.env.CA_LICENSE_DB_PATH || DEFAULT_DB);
const PRIVATE_KEY_PATH = path.resolve(process.env.CA_LICENSE_PRIVATE_KEY_PATH || DEFAULT_PRIVATE_KEY);
const KEY_ID = process.env.CA_LICENSE_KEY_ID || 'wyneeds-license-key-2026-07';
const PUBLIC_URL = normalizeActivationServerUrl(process.env.CA_LICENSE_PUBLIC_URL || process.env.CA_LICENSE_SERVER_URL);

async function privateKeyPem(): Promise<string> {
  return readFile(PRIVATE_KEY_PATH, 'utf8');
}

const app = express();
app.disable('x-powered-by');
if (process.env.CA_LICENSE_TRUST_PROXY === 'true') app.set('trust proxy', 1);
app.use(express.json({ limit: '100kb' }));
app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 120, standardHeaders: true, legacyHeaders: false }));
app.use('/v1/activate', rateLimit({ windowMs: 15 * 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false }));
app.use('/v1/check', rateLimit({ windowMs: 15 * 60 * 1000, max: 60, standardHeaders: true, legacyHeaders: false }));

app.get('/health', (_req, res) => res.json({ ok: true, service: 'wyneeds-license-server' }));

app.post('/v1/activate', async (req, res) => {
  try {
    const result = await activateInvite(DB_PATH, {
      inviteCode: String(req.body?.inviteCode ?? ''),
      deviceHash: String(req.body?.deviceHash ?? ''),
      appVersion: typeof req.body?.appVersion === 'string' ? req.body.appVersion.slice(0, 40) : undefined,
    }, {
      privateKeyPem: await privateKeyPem(),
      keyId: KEY_ID,
      licenseServerUrl: PUBLIC_URL,
    });
    if (!result.ok) return res.status(result.status).json({ ok: false, code: result.code, message: result.message });
    return res.json({ ok: true, envelope: result.envelope, reused: result.reused });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ ok: false, code: 'SERVER_ERROR', message: '授权服务异常' });
  }
});

app.post('/v1/check', async (req, res) => {
  try {
    const result = await checkLicense(DB_PATH, {
      licenseId: typeof req.body?.licenseId === 'string' ? req.body.licenseId : undefined,
      deviceHash: typeof req.body?.deviceHash === 'string' ? req.body.deviceHash : undefined,
    });
    if (!result.ok) return res.status(result.statusCode).json({ ok: false, code: result.code, message: result.message });
    const receipt = signLicenseCheckReceipt({
      schemaVersion: LICENSE_SCHEMA_VERSION,
      appId: LICENSE_APP_ID,
      licenseId: String(req.body?.licenseId ?? ''),
      deviceHash: String(req.body?.deviceHash ?? ''),
      status: result.status,
      message: result.message,
      checkedAt: new Date().toISOString(),
    }, await privateKeyPem(), KEY_ID);
    return res.json({ ...result, receipt });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ ok: false, code: 'SERVER_ERROR', message: '授权服务异常' });
  }
});

app.use((_req, res) => res.status(404).json({ ok: false, code: 'NOT_FOUND', message: '接口不存在' }));

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if ((error as { type?: string }).type === 'entity.parse.failed') {
    return res.status(400).json({ ok: false, code: 'INVALID_JSON', message: '请求 JSON 格式不正确' });
  }
  console.error(error);
  return res.status(500).json({ ok: false, code: 'SERVER_ERROR', message: '授权服务异常' });
});

app.listen(PORT, HOST, () => {
  console.log(`License server listening on http://${HOST}:${PORT}`);
  console.log(`Invite DB: ${DB_PATH}`);
  console.log('Private key: loaded from configured path');
  if (PUBLIC_URL) console.log(`Public URL: ${PUBLIC_URL}`);
});
