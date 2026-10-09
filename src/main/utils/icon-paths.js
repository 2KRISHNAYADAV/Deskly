const { app } = require('electron');
const path = require('path');
const fs = require('fs');

function existingPath(candidates) {
    for (const candidate of candidates) {
        if (candidate && fs.existsSync(candidate)) return candidate;
    }
    return null;
}

function iconCandidates(fileName) {
    return [
        path.join(process.resourcesPath || '', 'resources', fileName),
        path.join(app.getAppPath(), 'assets', 'icons', fileName),
        path.join(__dirname, '../../../assets/icons', fileName),
    ];
}

function resolveIconPath(fileName) {
    return existingPath(iconCandidates(fileName));
}

function resolveWindowIconPath() {
    return resolveIconPath('icon.ico') || resolveIconPath('icon.png');
}

function resolveNotificationIconPath() {
    return resolveIconPath('icon.png') || resolveIconPath('icon-256.png');
}

function resolveTrayIconPath() {
    // Always prefer the 32px @2x source — Windows scales it down to the correct
    // DPI-appropriate display size automatically, giving the sharpest result at every scale.
    return resolveIconPath('tray-icon@2x.png') || resolveIconPath('tray-icon.png') || resolveIconPath('icon.png');
}

module.exports = {
    resolveIconPath,
    resolveWindowIconPath,
    resolveNotificationIconPath,
    resolveTrayIconPath,
};
