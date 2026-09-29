const path = require('path');
const { app, BrowserWindow, screen, session } = require('electron');

require('../server.js');
const config = require('../config');

async function clearStaleSessionState() {
  const ses = session.defaultSession;
  await ses.clearCache();
  await ses.clearStorageData({
    storages: ['serviceworkers', 'cachestorage', 'appcache', 'shadercache', 'websql', 'indexdb', 'localstorage', 'cookies']
  });
}

const BEZEL_ASPECT_RATIO = 421 / 880; // width / height, matches demo/bezel.css

function computeWindowSize() {
  const workArea = screen.getPrimaryDisplay().workAreaSize;
  const margin = 60;
  let height = Math.min(880, workArea.height - margin);
  let width = Math.round(height * BEZEL_ASPECT_RATIO);
  if (width > workArea.width - margin) {
    width = workArea.width - margin;
    height = Math.round(width / BEZEL_ASPECT_RATIO);
  }
  return { width, height };
}

function createWindow() {
  const { width, height } = computeWindowSize();
  const win = new BrowserWindow({
    width,
    height,
    frame: false,
    resizable: false,
    autoHideMenuBar: true,
    backgroundColor: '#1b1b1f'
  });
  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, '..', 'demo', 'mockup.html'), {
    search: `port=${config.server.port}`
  });
}

// The microphone (voice) and GPS (store reminders), for the local app only.
const ALLOWED_PERMISSIONS = ['media', 'geolocation'];

function allowMicrophoneForLocalApp() {
  const ses = session.defaultSession;
  const isLocalApp = (url) => {
    try {
      return new URL(url).hostname === 'localhost';
    } catch (err) {
      return false;
    }
  };
  ses.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const allowed = ALLOWED_PERMISSIONS.includes(permission) && isLocalApp(details.requestingUrl || webContents.getURL());
    console.log(`[electron] permission request: ${permission} from ${details.requestingUrl} -> ${allowed ? 'granted' : 'denied'}`);
    callback(allowed);
  });
  ses.setPermissionCheckHandler((webContents, permission, requestingOrigin) => {
    return ALLOWED_PERMISSIONS.includes(permission) && isLocalApp(requestingOrigin);
  });
}

app.whenReady().then(async () => {
  await clearStaleSessionState();
  allowMicrophoneForLocalApp();
  setTimeout(createWindow, 500);
});

app.on('window-all-closed', () => app.quit());
