/**
 * Focus Overlay Manager
 *
 * Singleton overlay window shown when a blocked app is opened during a focus
 * session (mirror of app-lock/lock-overlay-manager.js). Two modes:
 *   • strict → "Stay focused", shows time left, "End session" (renderer confirms)
 *   • nudge  → dismissible reminder
 */

'use strict';

const { BrowserWindow, screen, app, ipcMain } = require('electron');
const path = require('path');
const fs   = require('fs');

let win = null;
let currentData = null;
let onEnd = null;        // () => void  — end the session (wired by main → engine.end)
let ipcWired = false;

function init(onEndSession) {
    onEnd = onEndSession;
    wireIpc();
}

function getHtmlPath() {
    const candidates = [
        path.join(__dirname, '../../../../dist/renderer/focus-screen.html'),
        path.join(__dirname, '../../../renderer/focus-screen.html'),
    ];
    if (typeof app?.getAppPath === 'function') {
        candidates.push(path.join(app.getAppPath(), 'dist/renderer/focus-screen.html'));
    }
    for (const p of candidates) if (fs.existsSync(p)) return p;
    console.error('[Focus] focus-screen.html not found');
    return null;
}

function forceFocus() {
    if (!win || win.isDestroyed()) return;
    win.show(); win.moveTop(); win.focus();
    try { win.webContents.focus(); } catch {}
}

function create() {
    if (win && !win.isDestroyed()) return win;
    const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize;
    const W = 420, H = 360;

    win = new BrowserWindow({
        width: W, height: H,
        x: Math.floor((sw - W) / 2),
        y: Math.floor((sh - H) / 2),
        frame: false, resizable: false, movable: false,
        minimizable: false, maximizable: false, closable: false,
        fullscreenable: false, alwaysOnTop: true, skipTaskbar: false,
        show: false, backgroundColor: '#0A0A0F',
        webPreferences: {
            nodeIntegration: false, contextIsolation: true,
            preload: path.join(__dirname, '../../preload-focus.js'),
        },
    });
    win.setAlwaysOnTop(true, 'screen-saver');

    const html = getHtmlPath();
    if (!html) return null;
    win.loadFile(html);

    win.once('ready-to-show', () => {
        forceFocus();
        if (win && !win.isDestroyed()) win.webContents.send('focus:data', currentData);
    });
    win.on('focus', () => { try { win.webContents.focus(); } catch {} });
    win.on('closed', () => { win = null; });
    return win;
}

function wireIpc() {
    if (ipcWired) return;
    ipcWired = true;
    ipcMain.on('focus:end', () => { if (onEnd) onEnd(); hide(); });
    ipcMain.on('focus:dismiss', () => hide());
}

function show(data) {
    currentData = { mode: 'strict', ...data };
    if (win && !win.isDestroyed()) {
        win.webContents.send('focus:data', currentData);
        forceFocus();
        return;
    }
    create();
}

function hide() { if (win && !win.isDestroyed()) win.hide(); }
function destroy() { if (win && !win.isDestroyed()) { win.destroy(); win = null; } }

module.exports = { init, show, hide, destroy };
