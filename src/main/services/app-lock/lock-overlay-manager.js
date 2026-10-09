/**
 * App Lock Overlay Manager
 *
 * Singleton lock-screen BrowserWindow. Reused across lock events; only its data
 * changes. Authenticates against the MASTER credential via lockStore.authenticate.
 *
 * INPUT FOCUS (the bug we fixed)
 * ──────────────────────────────
 * A screen-saver-level always-on-top window does not reliably receive keyboard
 * focus just from .show(). We must, in order: show → focus the window → focus
 * the webContents → moveTop, and re-focus webContents whenever the window gains
 * focus. The renderer ALSO keeps a hidden input focused and listens for keydown.
 * Both layers together guarantee the PIN can be typed.
 */

'use strict';

const { BrowserWindow, screen, app, ipcMain } = require('electron');
const path = require('path');
const fs   = require('fs');
const lockStore = require('./lock-store');

let lockWindow    = null;
let currentData   = null;
let onAuthSuccess = null;
let ipcWired      = false;

function init(authSuccessCallback) {
    onAuthSuccess = authSuccessCallback;
    wireIpc();
}

function getLockScreenPath() {
    const candidates = [
        path.join(__dirname, '../../../../dist/renderer/lock-screen.html'),
        path.join(__dirname, '../../../renderer/lock-screen.html'),
    ];
    if (typeof app?.getAppPath === 'function') {
        candidates.push(path.join(app.getAppPath(), 'dist/renderer/lock-screen.html'));
    }
    for (const p of candidates) if (fs.existsSync(p)) return p;
    console.error('[LockOverlay] lock-screen.html not found');
    return null;
}

function forceFocus() {
    if (!lockWindow || lockWindow.isDestroyed()) return;
    lockWindow.show();
    lockWindow.moveTop();
    lockWindow.focus();
    // Focus the web contents so keystrokes land in the renderer
    try { lockWindow.webContents.focus(); } catch {}
}

function createWindow() {
    if (lockWindow && !lockWindow.isDestroyed()) return lockWindow;

    const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize;
    const W = 420, H = 600;

    lockWindow = new BrowserWindow({
        width: W, height: H,
        x: Math.floor((sw - W) / 2),
        y: Math.floor((sh - H) / 2),
        frame:       false,
        resizable:   false,
        movable:     false,
        minimizable: false,
        maximizable: false,
        closable:    false,
        fullscreenable: false,
        alwaysOnTop: true,
        skipTaskbar: false,
        focusable:   true,
        show:        false,
        backgroundColor: '#0A0A0F',
        webPreferences: {
            nodeIntegration:  false,
            contextIsolation: true,
            preload: path.join(__dirname, '../../preload-lock.js'),
        },
    });

    lockWindow.setAlwaysOnTop(true, 'screen-saver');

    const htmlPath = getLockScreenPath();
    if (!htmlPath) return null;
    lockWindow.loadFile(htmlPath);

    lockWindow.once('ready-to-show', () => {
        forceFocus();
        if (lockWindow && !lockWindow.isDestroyed()) {
            lockWindow.webContents.send('lock:data', currentData);
        }
    });

    // Re-assert webContents focus whenever the window gains focus — keeps the
    // hidden input ready to receive keystrokes.
    lockWindow.on('focus', () => {
        try { lockWindow.webContents.focus(); } catch {}
    });

    lockWindow.on('closed', () => { lockWindow = null; });
    return lockWindow;
}

function wireIpc() {
    if (ipcWired) return;
    ipcWired = true;

    ipcMain.on('lock:authenticate', (event, { appName, secret }) => {
        // Quit mode authenticates against the master credential directly.
        const result = appName === '__quit__'
            ? lockStore.verifyMaster(secret)
            : lockStore.authenticate(appName, secret);

        if (lockWindow && !lockWindow.isDestroyed()) {
            lockWindow.webContents.send('lock:authResult', result);
        }
        if (result.success) {
            if (onAuthSuccess) onAuthSuccess(appName);
            setTimeout(() => hide(), 1100);
        }
    });

    // Cancel — only meaningful in quit mode (abort the quit, keep running).
    ipcMain.on('lock:cancel', () => hide());
}

function show(data) {
    // Tell the lock screen which credential type to render (PIN vs password)
    // and whether this is a normal app-unlock or a quit-confirmation.
    const meta = lockStore.getMasterMeta();
    currentData = { mode: 'unlock', ...data, authMethod: meta?.authMethod || 'pin' };
    if (lockWindow && !lockWindow.isDestroyed()) {
        lockWindow.webContents.send('lock:data', currentData);
        forceFocus();
        return;
    }
    createWindow();
}

function hide() {
    if (lockWindow && !lockWindow.isDestroyed()) lockWindow.hide();
}

function destroy() {
    if (lockWindow && !lockWindow.isDestroyed()) { lockWindow.destroy(); lockWindow = null; }
}

module.exports = { init, show, hide, destroy };
