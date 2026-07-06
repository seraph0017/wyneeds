import { app, BrowserWindow, dialog, session } from 'electron';
import path from 'node:path';
import { startServer } from '../server/server';

let closeServer: (() => Promise<void>) | undefined;

async function createWindow() {
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  const dataDir = app.getPath('userData');
  const server = await startServer({
    port: 0,
    dataDir,
    enableCors: true,
    licenseRequired: true,
    licenseActivationUrl: process.env.CA_LICENSE_SERVER_URL,
    licenseAppVersion: app.getVersion(),
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

  await win.loadFile(path.join(app.getAppPath(), 'dist', 'index.html'), { query: { apiPort: String(server.port) } });
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
