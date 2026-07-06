import { app, BrowserWindow, dialog, session } from 'electron';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { startServer } from '../server/server';
import { resolveActivationServerUrl } from '../server/license/config';

let closeServer: (() => Promise<void>) | undefined;

async function createWindow() {
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  const dataDir = app.getPath('userData');
  const apiToken = randomBytes(24).toString('hex');
  const portableExecutableDir = process.env.PORTABLE_EXECUTABLE_DIR;
  const portableExecutableFileDir = process.env.PORTABLE_EXECUTABLE_FILE
    ? path.dirname(process.env.PORTABLE_EXECUTABLE_FILE)
    : undefined;
  const activationConfig = await resolveActivationServerUrl({
    candidateDirs: [
      portableExecutableDir,
      portableExecutableFileDir,
      path.dirname(process.execPath),
      process.resourcesPath,
      dataDir,
      app.getAppPath(),
    ],
  });
  const server = await startServer({
    port: 0,
    dataDir,
    enableCors: true,
    licenseRequired: true,
    licenseActivationUrl: activationConfig.url,
    licenseAppVersion: app.getVersion(),
    apiToken,
  });
  closeServer = server.close;
  const windowIcon = app.isPackaged
    ? path.join(process.resourcesPath, 'icon.png')
    : path.join(app.getAppPath(), 'build', 'icon.png');

  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 1000,
    minHeight: 720,
    title: '民航客票销售订座系统',
    backgroundColor: '#eef5fb',
    icon: windowIcon,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('file://')) event.preventDefault();
  });

  await win.loadFile(path.join(app.getAppPath(), 'dist', 'index.html'), { query: { apiPort: String(server.port), apiToken } });
}

app.whenReady().then(createWindow).catch((error) => {
  dialog.showErrorBox('启动失败', error instanceof Error ? error.message : String(error));
  app.quit();
});

app.on('window-all-closed', () => {
  app.quit();
});

app.on('before-quit', async () => {
  if (closeServer) await closeServer();
});
