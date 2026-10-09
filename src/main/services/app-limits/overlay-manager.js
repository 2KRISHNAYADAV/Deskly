/**
 * Overlay Manager
 * 
 * Manages the limit overlay window.
 * Creates a beautiful, branded overlay that:
 * - Shows time limit warnings
 * - Displays countdown for minimize mode
 * - Handles "add time" requests
 * - Stays on top and captures focus when needed
 */

const { BrowserWindow, screen, app } = require('electron');
const path = require('path');
const fs = require('fs');

let overlayWindow = null;
let mainWindow = null;
let currentData = null;
let countdownInterval = null;

// --- Initialization ---

function init(mainWin) {
    mainWindow = mainWin;
    console.log('🖼️ Overlay Manager initialized');
}

// Get the correct overlay HTML path (must be called after app is ready)
function getOverlayPath() {
    // Use __dirname-based paths that work at require time
    // __dirname is: src/main/services/app-limits/
    
    // First try dist path (after vite build)
    const distPath = path.join(__dirname, '../../../../dist/renderer/limit-overlay.html');
    if (fs.existsSync(distPath)) {
        console.log('📂 Using dist overlay:', distPath);
        return distPath;
    }
    
    // Then try src path (for development before build)
    const srcPath = path.join(__dirname, '../../../renderer/limit-overlay.html');
    if (fs.existsSync(srcPath)) {
        console.log('📂 Using src overlay:', srcPath);
        return srcPath;
    }
    
    // Finally try app.getAppPath() based paths (for packaged app)
    if (app && typeof app.getAppPath === 'function') {
        const appPath = app.getAppPath();
        const prodPath = path.join(appPath, 'dist', 'renderer', 'limit-overlay.html');
        if (fs.existsSync(prodPath)) {
            console.log('📂 Using packaged overlay:', prodPath);
            return prodPath;
        }
    }
    
    console.error('❌ Could not find limit-overlay.html');
    return null;
}

// --- Window Creation ---

function createWindow() {
    if (overlayWindow && !overlayWindow.isDestroyed()) {
        return overlayWindow;
    }

    const display = screen.getPrimaryDisplay();
    const { width: screenWidth, height: screenHeight } = display.workAreaSize;

    // Size to fit content with padding
    const winWidth = 440;
    const winHeight = 580;

    overlayWindow = new BrowserWindow({
        width: winWidth,
        height: winHeight,
        x: Math.floor((screenWidth - winWidth) / 2),
        y: Math.floor((screenHeight - winHeight) / 2),
        frame: false,
        transparent: true,
        backgroundColor: '#00000000', // Fully transparent background
        alwaysOnTop: true,
        skipTaskbar: true,
        resizable: false,
        movable: false,
        focusable: true,
        show: false,
        hasShadow: false, // Disable native shadow
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, '../../preload.js'),
        },
    });

    // Load overlay HTML using correct path
    const overlayPath = getOverlayPath();
    
    if (overlayPath) {
        overlayWindow.loadFile(overlayPath);
    } else {
        console.error('❌ Overlay HTML not found anywhere!');
    }

    // Keep overlay focused when showing - removed re-focus on blur since we use warning mode only
    overlayWindow.on('blur', () => {
        // In warning mode, we don't force re-focus - user can click away
    });

    overlayWindow.on('closed', () => {
        overlayWindow = null;
        currentData = null;
        if (countdownInterval) {
            clearInterval(countdownInterval);
            countdownInterval = null;
        }
    });

    overlayWindow.webContents.on('did-finish-load', () => {
        console.log('✅ Overlay window loaded');
    });
    
    overlayWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
        console.error('❌ Overlay failed to load:', errorCode, errorDescription);
    });

    return overlayWindow;
}

// --- Show/Hide ---

function show(data) {
    console.log('📺 Overlay show() called with:', JSON.stringify(data, null, 2));
    
    const window = createWindow();
    currentData = data;

    // Wait for window to be ready
    // Use showInactive() to NOT steal focus from the app being tracked
    // This prevents the activity tracker from detecting "electron" as active app
    if (window.webContents.isLoading()) {
        console.log('📺 Waiting for overlay to finish loading...');
        window.webContents.once('did-finish-load', () => {
            console.log('📺 Overlay loaded, sending data and showing (inactive)...');
            sendDataToOverlay(data);
            window.showInactive(); // Don't steal focus!
        });
    } else {
        console.log('📺 Overlay already loaded, sending data and showing (inactive)...');
        sendDataToOverlay(data);
        window.showInactive(); // Don't steal focus!
    }

    // Start countdown if needed
    if (data.countdown) {
        startCountdown(data.countdown);
    }

    // Auto-dismiss if set
    if (data.autoDismiss) {
        setTimeout(() => {
            hide();
        }, data.autoDismiss);
    }

    console.log(`🖼️ Overlay shown: ${data.type} for ${data.appName}`);
}

let isHiding = false;

function hide() {
    if (isHiding) return; // Prevent double hide
    
    if (countdownInterval) {
        clearInterval(countdownInterval);
        countdownInterval = null;
    }

    if (overlayWindow && !overlayWindow.isDestroyed() && overlayWindow.isVisible()) {
        isHiding = true;
        // Trigger fade out animation
        overlayWindow.webContents.send('overlay:hide');
        
        // Wait for animation then hide
        setTimeout(() => {
            if (overlayWindow && !overlayWindow.isDestroyed()) {
                overlayWindow.hide();
            }
            isHiding = false;
            currentData = null;
            console.log('🖼️ Overlay hidden');
        }, 350); // Match animation duration (320ms + buffer)
    } else {
        currentData = null;
    }
}

function hideImmediate() {
    // For cases where we need instant hide (e.g., window close)
    if (countdownInterval) {
        clearInterval(countdownInterval);
        countdownInterval = null;
    }
    if (overlayWindow && !overlayWindow.isDestroyed()) {
        overlayWindow.hide();
    }
    isHiding = false;
    currentData = null;
}

function close() {
    hide();
    if (overlayWindow && !overlayWindow.isDestroyed()) {
        overlayWindow.close();
        overlayWindow = null;
    }
}

function isVisible() {
    return overlayWindow && !overlayWindow.isDestroyed() && overlayWindow.isVisible();
}

// --- Communication ---

function sendDataToOverlay(data) {
    if (overlayWindow && !overlayWindow.isDestroyed()) {
        overlayWindow.webContents.send('overlay:data', data);
    }
}

function startCountdown(seconds) {
    if (countdownInterval) {
        clearInterval(countdownInterval);
    }

    let remaining = seconds;

    countdownInterval = setInterval(() => {
        remaining--;

        if (overlayWindow && !overlayWindow.isDestroyed()) {
            overlayWindow.webContents.send('overlay:countdown', remaining);
        }

        if (remaining <= 0) {
            clearInterval(countdownInterval);
            countdownInterval = null;

            // Notify that countdown completed
            if (overlayWindow && !overlayWindow.isDestroyed()) {
                overlayWindow.webContents.send('overlay:countdown-complete');
            }
        }
    }, 1000);
}

// --- Notify Main Window ---

function notifyMain(channel, data) {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(channel, data);
    }
}

// --- Get current data ---

function getCurrentData() {
    return currentData;
}

// --- Exports ---

module.exports = {
    init,
    show,
    hide,
    close,
    isVisible,
    notifyMain,
    getCurrentData,
    get currentData() { return currentData; }
};
