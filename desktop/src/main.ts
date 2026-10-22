import { app, BrowserWindow, session, shell, systemPreferences } from 'electron';
import path from 'node:path';

const isDev = process.argv.includes('--dev');
const DEV_URL = 'http://localhost:5173';
const PROD_INDEX = path.join(__dirname, '../../client/dist/index.html');

/** Only our own app content may use the camera/mic. */
function isTrustedOrigin(url: string): boolean {
  if (isDev) return url.startsWith(DEV_URL);
  return url.startsWith('file://');
}

/**
 * macOS gates camera/mic per app (System Settings → Privacy & Security).
 * Asking up front shows the OS prompt before getUserMedia runs.
 * Windows/Linux have no equivalent API here, so they just proceed.
 */
async function ensureOsMediaAccess(): Promise<void> {
  if (process.platform !== 'darwin') return;
  for (const media of ['camera', 'microphone'] as const) {
    const status = systemPreferences.getMediaAccessStatus(media);
    if (status !== 'granted') {
      const granted = await systemPreferences.askForMediaAccess(media);
      console.log(`[desktop] macOS ${media} access: ${granted ? 'granted' : 'denied'}`);
    }
  }
}

function configurePermissions(): void {
  // Chromium-level permission prompt (what a browser would show as a popup).
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    const allowed = permission === 'media' && isTrustedOrigin(webContents.getURL());
    callback(allowed);
  });
  session.defaultSession.setPermissionCheckHandler((_webContents, permission, requestingOrigin) => {
    return permission === 'media' && isTrustedOrigin(requestingOrigin);
  });
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1100,
    height: 760,
    minWidth: 640,
    minHeight: 480,
    backgroundColor: '#0f1115',
    title: 'Video Call',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // Never navigate the app window away from our UI; open external links in the browser.
  win.webContents.on('will-navigate', (event, url) => {
    if (!isTrustedOrigin(url)) {
      event.preventDefault();
      void shell.openExternal(url);
    }
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  if (isDev) {
    void win.loadURL(DEV_URL);
    win.webContents.openDevTools({ mode: 'detach' });
  } else {
    void win.loadFile(PROD_INDEX);
  }
}

app.whenReady().then(async () => {
  configurePermissions();
  await ensureOsMediaAccess();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
