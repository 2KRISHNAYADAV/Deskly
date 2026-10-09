'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('focusOverlayAPI', {
    onData:  (cb) => ipcRenderer.on('focus:data', (_, data) => cb(data)),
    end:     ()   => ipcRenderer.send('focus:end'),     // end the whole session
    dismiss: ()   => ipcRenderer.send('focus:dismiss'), // hide nudge, keep session
});
