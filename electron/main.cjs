const { app, BrowserWindow, dialog, protocol, session, shell } = require('electron');
const { createHash } = require('node:crypto');
const { readFileSync } = require('node:fs');
const path = require('node:path');

const appUrl = 'curryclient://app/';
const externalHosts = new Set([
  'vrchat.com', 'avtrdb.com', 'vrclist.com', 'vrcmods.com', 'drive.google.com',
]);

protocol.registerSchemesAsPrivileged([{
  scheme: 'curryclient',
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
}]);

function openExternal(url) {
  try {
    const target = new URL(url);
    if (target.protocol !== 'https:' || target.port || target.username || target.password ||
        !externalHosts.has(target.hostname)) return;
    shell.openExternal(target.href).catch(() => {
      dialog.showErrorBox('Could not open link', 'Check that a default web browser is installed and try again.');
    });
  } catch {
    // Invalid URLs must never reach the operating system's protocol handlers.
  }
}

function createWindow() {
  const window = new BrowserWindow({
    title: 'CurryClient',
    width: 1280,
    height: 860,
    minWidth: 720,
    minHeight: 540,
    backgroundColor: '#111215',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      webviewTag: false,
    },
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    openExternal(url);
    return { action: 'deny' };
  });
  window.webContents.on('will-frame-navigate', (event) => {
    if (!event.isMainFrame &&
        (event.url === 'about:blank' || event.url.startsWith(`blob:${appUrl}`))) return;
    event.preventDefault();
    if (event.isMainFrame) openExternal(event.url);
  });
  window.webContents.on('will-redirect', (event) => event.preventDefault());
  window.webContents.on('will-attach-webview', (event) => event.preventDefault());
  window.once('ready-to-show', () => window.show());
  window.loadURL(appUrl).catch((error) => {
    dialog.showErrorBox('CurryClient could not start', error.message);
    app.quit();
  });
}

app.whenReady().then(() => {
  // Serve only the bundled page, without granting file:// access to local files.
  const html = readFileSync(path.join(__dirname, '..', 'VRCclient.html'), 'utf8');
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1].replace(/\r\n/g, '\n');
  const hash = createHash('sha256').update(script).digest('base64');
  const csp = [
    "default-src 'none'",
    `script-src 'sha256-${hash}'`,
    "style-src 'unsafe-inline'",
    'img-src https://thumb.avtrdb.com',
    'connect-src https://api.avtrdb.com',
    'frame-src blob:',
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');
  protocol.handle('curryclient', (request) => {
    if (request.url !== appUrl || request.method !== 'GET') {
      return new Response('Not found', { status: 404 });
    }
    return new Response(html, {
      headers: { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': csp },
    });
  });
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}).catch((error) => {
  dialog.showErrorBox('CurryClient could not start', error.message);
  app.quit();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
