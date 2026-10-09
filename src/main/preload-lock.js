'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('lockAPI', {
    // Receive lock data (which app is locked, display name, etc.)
    onLockData: (cb) => ipcRenderer.on('lock:data', (_, data) => cb(data)),

    // Send authentication attempt to main
    authenticate: (appName, secret) =>
        ipcRenderer.send('lock:authenticate', { appName, secret }),

    // Receive auth result
    onAuthResult: (cb) => ipcRenderer.on('lock:authResult', (_, result) => cb(result)),

    // Cancel / close the lock screen (only valid after successful auth)
    cancel: () => ipcRenderer.send('lock:cancel'),
});
