const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, dialog, powerMonitor, screen } = require('electron');
// Set app identity for Windows (Task Manager, taskbar grouping, etc.)
app.setName('Deskly Academic Edition');
if (process.platform === 'win32') {
    app.setAppUserModelId('edu.deskly.academic');
}

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// Deskly Academic Edition - Local-only distribution
const Store = require('electron-store');
const { initDatabase, getSetting, setSetting, resetAllData, getAllData, incrementUnlockCount, getUnlockCount, getToday, invalidateAppCategoryCache, flushData } = require('./database/db');
const { startTracking, stopTracking, forceTrackingUpdate, trackerEvents } = require('./tracker/activity-tracker');
const { getTodayStats, getWeeklyStats, getAppUsage, getBrowserBreakdown } = require('./tracker/data-aggregator');
const { startBreakReminders, stopBreakReminders, updateBreakInterval, sendTestNotification } = require('./services/break-reminder');
const { getDailyGoal, setDailyGoal, getStreakData, getTodayProgress, getAchievements, updateStreak } = require('./services/goals-streaks');
const { getCustomCategories, setAppCategory } = require('./services/smart-features');
const { getAllAchievements, getAchievementStats, exportToJSON, exportToCSV, getAutoStartEnabled, setAutoStart } = require('./services/polish');
const { getTodayWebsiteUsage, getWebsitesByCategory, getTopWebsites, getBrowserStats, getWeeklyWebsiteUsage } = require('./services/browser-intelligence');
const {
    getCategories,
    createCategory,
    updateCategory,
    deleteCategory,
    assignAppToCategory,
    getCategoryStats,
    getAppsByCategory,
    getAppCategoryMap,
    getAppCategoryMapWithNames,
    assignWebsiteToCategory,
    getWebsitesByCategory: getUserWebsitesByCategory,
    getWebsiteCategoryMap,
    getWebsiteCategoryStats,
    getBrowserCategories,
    createBrowserCategory,
    updateBrowserCategory,
    deleteBrowserCategory,
    getWebsitesByBrowserCategory,
    getSuggestedCategoriesForApp,
} = require('./services/user-categories');
const { getAppIcon, getCachedIcons, clearIconCache, preExtractIcons } = require('./services/app-icons');
const { resolveWindowIconPath, resolveTrayIconPath } = require('./utils/icon-paths');
const vaultManager = require('./services/vault-manager');
const productRuntime = require('./services/product-runtime');
const { getReportStats } = require('./services/reports-stats');
const { getWeeklyInsights } = require('./services/insights');
const appGoalsService = require('./services/app-goals');
const appLimits = require('./services/app-limits');
const { startVaultWatcher, stopVaultWatcher, getVaultWatcher, onVaultDeleted, onVaultHealthChanged } = require('./services/vault-watcher');
const lockStore          = require('./services/app-lock/lock-store');
const lockEnforcer       = require('./services/app-lock/lock-enforcer');
const lockOverlayManager = require('./services/app-lock/lock-overlay-manager');
const lockWatchdog       = require('./services/app-lock/watchdog');
const { isProtectedProcess } = require('./services/app-lock/system-processes');
const focusStore         = require('./services/focus/focus-store');
const focusEngine        = require('./services/focus/focus-engine');
const focusOverlayManager = require('./services/focus/focus-overlay-manager');

// Start/stop the Task-Manager-resilience watchdog based on whether any locks
// are active. Packaged builds only (see watchdog.js). Quit authorization stops it.
function syncLockWatchdog() {
    if (!app.isPackaged) return;
    if (lockEnforcer.hasActiveLocks()) {
        lockWatchdog.start(app.getPath('exe'), path.basename(app.getPath('exe')));
    } else {
        lockWatchdog.stop();
    }
}

/**
 * Single entry point for ALL quit requests (tray, menu, anywhere). If App Lock
 * is active and the user hasn't authenticated, it shows the PIN overlay instead
 * of quitting. On correct PIN, the overlay's auth-success callback sets
 * quitAuthorized and calls app.quit() again, which falls straight through here.
 */
function requestQuit() {
    if (!quitAuthorized && lockEnforcer.hasActiveLocks()) {
        try {
            lockOverlayManager.show({ appName: '__quit__', displayName: 'Deskly', mode: 'quit' });
            return; // wait for PIN; do NOT set appIsQuitting
        } catch (err) {
            // Overlay unavailable — fail open rather than trap the user.
            quitAuthorized = true;
        }
    }
    appIsQuitting = true;
    app.quit();
}

// Production logger - suppress verbose logs in production
const isProd = app.isPackaged;
const isDev = !isProd;
// true when running as an MSIX/Desktop-Bridge package (Microsoft Store build) —
// the Store manages updates itself, so electron-updater must stay off.
const isWindowsStore = process.windowsStore === true;

// Suppress all console.log calls across every service file in production.
// Service files (activity-tracker, db, limits-engine, etc.) use raw console.log;
// overriding here ensures nothing leaks vault paths or session data in the shipped build.
if (isProd) {
    console.log = () => {};
}

const bootContext = productRuntime.initialize(app);
let launchContext = {
    ...bootContext,
    firstRun: false,
    mode: 'returning',
    telemetryEnabled: false,
};

const logger = {
    info: (...args) => {
        productRuntime.appendLog('info', 'main.info', { message: args.map((x) => String(x)).join(' ') });
        !isProd && console.log('[DWB]', ...args);
    },
    warn: (...args) => {
        productRuntime.appendLog('warn', 'main.warn', { message: args.map((x) => String(x)).join(' ') });
        console.warn('[DWB]', ...args);
    },
    error: (...args) => {
        console.error('[DWB]', ...args);
        productRuntime.appendLog('error', 'main.error', { message: args.map((x) => String(x)).join(' ') });
        productRuntime.incrementMetric('errors.total');
    }
};

const TRACKING_REFRESH_THROTTLE_MS = 2000;
let lastForcedTrackingRefreshAt = 0;
let trackingRefreshInFlight = null;

function scheduleDeferredStartupTask(label, delayMs, task) {
    setTimeout(async () => {
        try {
            await task();
        } catch (error) {
            logger.warn(`Deferred startup task failed: ${label}`, error?.message || error);
        }
    }, delayMs);
}

function ensureVaultPathStillExists() {
    const vaultPath = vaultManager.getVaultPath();
    if (!vaultPath) {
        return;
    }

    if (!fs.existsSync(vaultPath)) {
        logger.warn('Vault folder no longer exists. Resetting vault pointer to trigger onboarding.');
        const vaultPointer = new Store({ name: 'vault-pointer' });
        vaultPointer.delete('vaultPath');
    }
}

function runVaultIntegrityMaintenance() {
    const vaultPath = vaultManager.getVaultPath();
    if (!vaultPath || !fs.existsSync(vaultPath)) {
        return;
    }

    try {
        const health = vaultManager.checkVaultIntegrity();
        if (health.healthy) {
            return;
        }

        logger.warn(
            `Vault integrity maintenance found issues: ${health.issues.length} repairable, ${health.criticalIssues.length} critical.`
        );

        if (health.repairable.length > 0 || health.criticalIssues.length > 0) {
            const repairResult = vaultManager.autoRepairVault();
            if (repairResult.failed.length > 0) {
                logger.warn(`Vault auto-repair failed for ${repairResult.failed.length} files.`);

                const criticalFailed = repairResult.failed.filter((f) =>
                    f.includes('vault.json') || f.includes('config.json')
                );

                if (criticalFailed.length > 0) {
                    logger.error('Critical vault repair failed. Resetting vault so onboarding can recover safely.');
                    vaultManager.nukeVault();
                }
            }
        }
    } catch (error) {
        logger.warn('Vault integrity maintenance failed', error?.message || error);
    }
}

async function refreshTrackingSnapshotIfNeeded() {
    if (!isTracking) {
        return;
    }

    const now = Date.now();
    if (trackingRefreshInFlight) {
        await trackingRefreshInFlight;
        return;
    }

    if (now - lastForcedTrackingRefreshAt < TRACKING_REFRESH_THROTTLE_MS) {
        return;
    }

    trackingRefreshInFlight = Promise.race([
        forceTrackingUpdate(),
        new Promise((resolve) => setTimeout(resolve, 1200)),
    ]).catch(() => {
        // Keep stats responsive even if the force-update probe fails.
    });

    try {
        await trackingRefreshInFlight;
        lastForcedTrackingRefreshAt = Date.now();
    } finally {
        trackingRefreshInFlight = null;
    }
}



function resolveSelectedVaultPath(selectedPath) {
    const folderName = path.basename(selectedPath || '').trim().toLowerCase();

    if (folderName === 'deskly academic vault' || folderName === 'deskly vault' || folderName === 'deskly') {
        return selectedPath;
    }

    return path.join(selectedPath, 'Deskly Academic Vault');
}





// Global error handlers - prevent crashes from unhandled errors
process.on('uncaughtException', (error) => {
    productRuntime.markCrash('process.uncaughtException', error);
    logger.error('Uncaught Exception:', error.message);
    // Emergency flush: persist any in-memory tracking data before the process potentially
    // becomes unstable. flushData() is synchronous-safe (write-through) so this is fast.
    try { require('./database/db').flushData(); } catch (_) {}
    // Don't exit - try to keep running
});

process.on('unhandledRejection', (reason, promise) => {
    productRuntime.markCrash('process.unhandledRejection', reason);
    logger.error('Unhandled Promise Rejection:', reason);
    // Flush on rejection too — async errors can happen mid-tracking cycle
    try { require('./database/db').flushData(); } catch (_) {}
});

let mainWindow = null;
let tray = null;

// Throttle timestamps — prevent per-second work that should run at most every few seconds
let lastStatsPush   = 0;  // last time stats:updated was sent to the renderer
let isTracking = false;
let trayUpdateInterval = null;
let appIsQuitting = false; // module-level flag; avoids dynamic property on the app object
let quitAuthorized = false; // set true once the user PIN-confirms quit (App Lock)
let lastCachedStats = null; // reused by tray so it doesn't call getTodayStats() independently

// Real-time stats pushing - only when window is visible to avoid CPU/IPC waste.
// Tracker ticks every 1s, but a 3s freshness window is imperceptible to the user
// and avoids rebuilding + serializing the full stats object every single second.
trackerEvents.on('activity-tracked', async () => {
    const now = Date.now();

    if (now - lastStatsPush >= 3000 &&
        mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible() && !mainWindow.isMinimized()) {
        lastStatsPush = now;
        try {
            const stats = await getTodayStats();
            lastCachedStats = stats; // tray reuses this — avoids a second getTodayStats() call
            mainWindow.webContents.send('stats:updated', stats);
        } catch (err) {
            // Silently ignore - can happen during shutdown
        }
    }
});

// Single instance lock - prevent multiple instances
const gotTheLock = app.requestSingleInstanceLock();

// ── Goodbye window (uninstall farewell) ──────────────────────────────────────
// Launched by the NSIS uninstaller via: Deskly.exe --goodbye
// Shows the Aurora farewell screen for ~4s then exits so NSIS can continue cleanup.
if (process.argv.includes('--goodbye')) {
    app.whenReady().then(() => {
        const win = new BrowserWindow({
            width: 480,
            height: 360,
            frame: false,
            resizable: false,
            center: true,
            alwaysOnTop: true,
            backgroundColor: '#000000',
            show: false,
            webPreferences: {
                nodeIntegration: false,
                contextIsolation: true,
                preload: path.join(__dirname, 'preload.js'),
            },
        });
        const goodbyePath = app.isPackaged
            ? path.join(app.getAppPath(), 'dist/renderer/goodbye.html')
            : path.join(__dirname, '../../dist/renderer/goodbye.html');
        win.loadFile(goodbyePath).catch((error) => {
            console.error('Failed to load goodbye window:', error);
            app.quit();
        });
        win.once('ready-to-show', () => win.show());
        // Safety net — force-quit after 5s even if renderer hangs
        setTimeout(() => app.quit(), 5000);
    });
    // Skip all normal startup — return prevents the rest of the module running
    // (the block below never executes because app.whenReady callback owns the lifecycle)
}
if (!process.argv.includes('--goodbye')) {

if (!gotTheLock) {
    // Another instance is already running, quit immediately
    app.quit();
    // Prevent any further execution
    process.exit(0);
}

// This is the first instance - handle second instance attempts
app.on('second-instance', (event, commandLine, workingDirectory) => {
    // Someone tried to run a second instance, focus our window
    if (mainWindow) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.show();
        mainWindow.focus();
        mainWindow.webContents.send('app:refresh-stats');
    }
});

function createWindow() {
    // ── Splash screen ──────────────────────────────────────────────────────
    const { bounds: displayBounds } = screen.getPrimaryDisplay();
    let splashWindow = new BrowserWindow({
        width: displayBounds.width,
        height: displayBounds.height,
        x: displayBounds.x,
        y: displayBounds.y,
        frame: false,
        transparent: false,
        resizable: false,
        movable: false,
        alwaysOnTop: true,
        skipTaskbar: true,
        show: false,
        backgroundColor: '#0a0a0a',
        webPreferences: { nodeIntegration: false, contextIsolation: true },
    });

    const splashPath = isDev
        ? path.join(__dirname, '../../dist/renderer/splash.html')
        : path.join(app.getAppPath(), 'dist/renderer/splash.html');

    splashWindow.loadFile(splashPath).catch(() => {});
    splashWindow.once('ready-to-show', () => splashWindow.show());
    splashWindow.on('closed', () => { splashWindow = null; });

    // Minimum time the splash is visible so the animation can play through
    const splashMinTime = new Promise(resolve => setTimeout(resolve, 1400));
    // ───────────────────────────────────────────────────────────────────────

    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        minWidth: 900,
        minHeight: 600,
        frame: false,
        roundedCorners: true,
        backgroundColor: '#000000',
        show: false,
        skipTaskbar: true,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js'),
            // Memory: disable unused Chromium subsystems
            spellcheck: false,
            enableWebSQL: false,
            // Cache V8 bytecode so JS re-parses don't inflate heap on reload
            v8CacheOptions: 'bypassHMR',
            // Throttle background timers / JS when the window is hidden (default true, be explicit)
            backgroundThrottling: true,
        },
        icon: resolveWindowIconPath() || undefined,
    });

    // Load the app - use app.getAppPath() for correct path in packaged app
    const appPath = app.getAppPath();
    const indexPath = isDev
        ? path.join(__dirname, '../../dist/renderer/index.html')
        : path.join(appPath, 'dist/renderer/index.html');

    // Only log in development mode
    logger.info('Loading from:', indexPath);
    logger.info('App path:', appPath);

    // Once the main window is painted AND the splash minimum time has elapsed,
    // show main window FIRST (splash stays on top while it's alwaysOnTop), then
    // close splash — this eliminates the frame gap between the two windows.
    mainWindow.once('ready-to-show', async () => {
        await splashMinTime;
        mainWindow.setSkipTaskbar(false);
        // Windows focus-stealing prevention blocks focus() unless we briefly set alwaysOnTop
        mainWindow.setAlwaysOnTop(true);
        mainWindow.maximize();
        mainWindow.show(); // main renders behind the still-visible splash
        if (splashWindow && !splashWindow.isDestroyed()) splashWindow.close(); // now close splash
        mainWindow.focus();
        mainWindow.setAlwaysOnTop(false);
    });

    mainWindow.loadFile(indexPath).catch((err) => {
        logger.error('Failed to load index.html:', err);
                // Show a user-safe fallback screen without leaking local paths/stack details.
        mainWindow.loadURL(`data:text/html,
      <html>
        <head><title>Error</title></head>
        <body style="background:#121212;color:white;font-family:sans-serif;padding:40px;">
                    <h1>Deskly could not start correctly</h1>
                    <p>The app ran into a startup issue.</p>
                    <p>Please restart Deskly. If this keeps happening, reinstall the latest version.</p>
        </body>
      </html>
    `);
    });

    // DevTools: only accessible in dev mode via Ctrl+Shift+I.
    // In production builds DevTools are fully disabled to prevent source inspection.
    if (isDev) {
        mainWindow.webContents.on('before-input-event', (event, input) => {
            if (input.type === 'keyDown' && input.control && input.shift && input.key === 'I') {
                if (mainWindow.webContents.isDevToolsOpened()) {
                    mainWindow.webContents.closeDevTools();
                } else {
                    mainWindow.webContents.openDevTools({ mode: 'detach' });
                }
            }
        });
    }

    // Refresh stats whenever the window is restored from the system tray
    mainWindow.on('show', () => {
        mainWindow.webContents.send('app:refresh-stats');
    });

    mainWindow.on('close', (event) => {
        if (!appIsQuitting) {
            event.preventDefault();
            mainWindow.hide();
        }
    });

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

function createTray() {
    // Use a DPI-aware tray icon path with strict fallbacks for packaged builds.
    const iconPath = resolveTrayIconPath(screen);
    let icon = iconPath ? nativeImage.createFromPath(iconPath) : nativeImage.createEmpty();

    if (!icon || icon.isEmpty()) {
        const fallbackWindowIconPath = resolveWindowIconPath();
        icon = fallbackWindowIconPath
            ? nativeImage.createFromPath(fallbackWindowIconPath)
            : nativeImage.createEmpty();
    }

    // Always resize to 32px — the maximum Windows renders in the system tray.
    // Windows scales it down to the DPI-appropriate slot size; 32px source gives sharpest result.
    if (icon && !icon.isEmpty()) {
        icon = icon.resize({ width: 32, height: 32 });
    }

    tray = new Tray(icon);

    const contextMenu = Menu.buildFromTemplate([
        {
            label: 'Open Deskly',
            click: () => {
                if (mainWindow) {
                    mainWindow.show();
                    mainWindow.focus();
                    mainWindow.webContents.send('app:refresh-stats');
                }
            },
        },
        { type: 'separator' },
        {
            label: 'Tracking in progress...',
            enabled: false,
            id: 'screenTime',
        },
        { type: 'separator' },
        {
            label: 'Quit',
            click: () => requestQuit(),
        },
    ]);

    tray.setToolTip('Deskly');
    tray.setContextMenu(contextMenu);

    // Single left-click: toggle window visibility (standard Windows tray convention)
    tray.on('click', () => {
        if (mainWindow) {
            if (mainWindow.isVisible() && !mainWindow.isMinimized()) {
                mainWindow.hide();
            } else {
                mainWindow.show();
                mainWindow.focus();
                mainWindow.webContents.send('app:refresh-stats');
            }
        }
    });

    tray.on('double-click', () => {
        if (mainWindow) {
            mainWindow.show();
            mainWindow.focus();
            mainWindow.webContents.send('app:refresh-stats');
        }
    });
}

function updateTrayMenu(screenTimeStr = null) {
    if (!tray) return;

    const contextMenu = Menu.buildFromTemplate([
        {
            label: 'Open Deskly',
            click: () => {
                if (mainWindow) {
                    mainWindow.show();
                    mainWindow.focus();
                    mainWindow.webContents.send('app:refresh-stats');
                }
            },
        },
        { type: 'separator' },
        {
            label: screenTimeStr ? `Today: ${screenTimeStr}` : 'Tracking in progress...',
            enabled: false,
            id: 'screenTime',
        },
        { type: 'separator' },
        {
            label: 'Quit',
            click: () => requestQuit(),
        },
    ]);

    tray.setContextMenu(contextMenu);
}

// Update tray tooltip, menu screen-time label, and Windows taskbar progress bar.
// Reuses lastCachedStats when available (populated every 3s by the push handler)
// to avoid a redundant getTodayStats() call — only fetches fresh if no cache yet.
async function updateTrayInfo() {
    if (!tray || tray.isDestroyed()) return;
    try {
        const stats = lastCachedStats || await getTodayStats();
        const totalSeconds = stats?.totalSeconds || 0;
        const hours = Math.floor(totalSeconds / 3600);
        const mins = Math.floor((totalSeconds % 3600) / 60);
        const timeStr = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;

        tray.setToolTip(`Deskly  —  ${timeStr} today`);
        updateTrayMenu(timeStr);

        // Reflect progress toward daily screen-time goal in the taskbar thumbnail
        if (mainWindow && !mainWindow.isDestroyed()) {
            const goalHours = getDailyGoal() || 8;
            const goalSeconds = goalHours * 3600;
            if (goalSeconds > 0 && totalSeconds > 0) {
                mainWindow.setProgressBar(Math.min(1, totalSeconds / goalSeconds));
            }
        }
    } catch (err) { /* runs on background interval — ignore transient errors */ }
}



// IPC Handlers
function setupIpcHandlers() {
    const safeIpcHandle = (channel, handler, fallbackMessage = 'Something went wrong. Please try again.') => {
        ipcMain.handle(channel, async (event, ...args) => {
            try {
                return await handler(event, ...args);
            } catch (error) {
                logger.error(`IPC handler failed: ${channel}`, error?.message || String(error));
                productRuntime.incrementMetric('ipc.errors');
                return { success: false, error: fallbackMessage };
            }
        });
    };

    // Product runtime metadata, diagnostics, and feature flags
    ipcMain.handle('app:getLaunchContext', () => launchContext);
    ipcMain.handle('app:getFeatureFlags', () => productRuntime.getAllFlags());
    ipcMain.handle('app:getFeatureFlag', (event, flagName) => productRuntime.getFlag(flagName));
    ipcMain.handle('app:setFeatureFlag', (event, flagName, enabled) => {
        if (typeof flagName !== 'string' || !flagName.trim()) {
            return { success: false, error: 'Invalid flag name' };
        }
        const value = productRuntime.setFlag(flagName.trim(), Boolean(enabled));
        return { success: true, flagName: flagName.trim(), value };
    });
    ipcMain.handle('diagnostics:getSummary', () => productRuntime.getDiagnosticsSummary());

    // Window controls
    ipcMain.on('window:minimize', () => {
        if (mainWindow) mainWindow.minimize();
    });

    ipcMain.on('window:maximize', () => {
        if (mainWindow) {
            if (mainWindow.isMaximized()) {
                mainWindow.unmaximize();
            } else {
                mainWindow.maximize();
            }
        }
    });

    ipcMain.on('window:close', () => {
        if (mainWindow) mainWindow.hide();
    });

    // Vault Management (Onboarding)
    ipcMain.handle('vault:isFirstRun', () => {
        return vaultManager.isFirstRun();
    });

    ipcMain.handle('vault:getDefaultPath', () => {
        return vaultManager.getDefaultVaultPath();
    });

    ipcMain.handle('vault:selectFolder', async () => {
        const result = await dialog.showOpenDialog(mainWindow, {
            title: 'Select Vault Location',
            properties: ['openDirectory', 'createDirectory'],
            buttonLabel: 'Select Folder'
        });

        if (result.canceled || !result.filePaths.length) {
            return { canceled: true };
        }

        const vaultPath = resolveSelectedVaultPath(result.filePaths[0]);
        return { path: vaultPath };
    });

    safeIpcHandle('vault:create', async (event, vaultPath) => {
        // Check for legacy data to migrate
        const hasLegacy = vaultManager.hasLegacyData();

        // Initialize vault
        const result = vaultManager.initializeVault(vaultPath);

        if (result.success && hasLegacy) {
            // Migrate legacy data
            vaultManager.migrateLegacyData(vaultPath);
        }

        // Re-initialize limits store now that vault exists
        if (result.success) {
            appLimits.store.init();
            console.log('📋 Limits store re-initialized after vault creation');
        }

        return result;
    }, 'Could not create vault. Please choose another location and try again.');

    ipcMain.handle('vault:getPath', () => {
        return vaultManager.getVaultPath();
    });

    ipcMain.handle('vault:openFolder', async () => {
        const vaultPath = vaultManager.getVaultPath();
        if (vaultPath) {
            const { shell } = require('electron');
            shell.openPath(vaultPath);
            return { success: true };
        }
        return { success: false, error: 'No vault path configured' };
    });

    // Open external URLs in the user's default browser
    ipcMain.handle('shell:openExternal', async (event, url) => {
        try {
            // Only allow safe web URLs – block file://, data:, javascript:, etc.
            const parsed = new URL(url);
            if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
                console.warn('shell:openExternal blocked non-http URL:', parsed.protocol);
                return { success: false, error: 'Only http/https URLs are allowed' };
            }
            const { shell } = require('electron');
            await shell.openExternal(url);
            return { success: true };
        } catch (error) {
            console.error('Failed to open external URL:', error);
            return { success: false, error: 'Could not open that link right now. Please try again.' };
        }
    });

    safeIpcHandle('vault:changeLocation', async () => {
        const currentPath = vaultManager.getVaultPath();

        // Show folder picker
        const result = await dialog.showOpenDialog(mainWindow, {
            title: 'Select New Vault Location',
            properties: ['openDirectory', 'createDirectory'],
            buttonLabel: 'Move Vault Here',
            defaultPath: currentPath ? path.dirname(currentPath) : undefined
        });

        if (result.canceled || !result.filePaths.length) {
            return { canceled: true };
        }

        const newVaultPath = resolveSelectedVaultPath(result.filePaths[0]);

        // Don't allow moving to the same location
        if (newVaultPath === currentPath) {
            return { success: false, error: 'Same location selected' };
        }

        const fs = require('fs');

        // Flush in-memory data before copying so the new vault gets the latest records
        flushData();

        // Create new vault directory
        if (!fs.existsSync(newVaultPath)) {
            fs.mkdirSync(newVaultPath, { recursive: true });
        }

        // Copy all files from old vault to new vault (async to avoid blocking the main thread)
        if (currentPath && fs.existsSync(currentPath)) {
            await fs.promises.cp(currentPath, newVaultPath, { recursive: true });
            console.log('✅ Vault data copied to new location');
        } else {
            // No existing vault, create fresh structure
            vaultManager.createVaultStructure(newVaultPath);
        }

        // Update vault pointer to new location
        const Store = require('electron-store');
        const vaultPointer = new Store({ name: 'vault-pointer' });
        vaultPointer.set('vaultPath', newVaultPath);

        return {
            success: true,
            newPath: newVaultPath,
            oldPath: currentPath,
            message: 'Vault moved successfully. Please restart the app for changes to take effect.'
        };
    }, 'Could not move the vault right now. Your original data is safe. Please try again.');

    // Vault health and integrity checks
    ipcMain.handle('vault:checkHealth', () => {
        return vaultManager.checkVaultIntegrity();
    });

    ipcMain.handle('vault:repair', () => {
        return vaultManager.autoRepairVault();
    });

    ipcMain.handle('vault:isHealthy', () => {
        return vaultManager.isVaultHealthy();
    });

    ipcMain.handle('vault:recoverDeleted', () => {
        return vaultManager.handleDeletedVault();
    });

    ipcMain.handle('vault:nuke', () => {
        return vaultManager.nukeVault();
    });

    // Authentication (Local Academic Edition - No accounts)
    ipcMain.handle('auth:signIn', () => ({ success: false, reason: 'Auth disabled in Academic Edition' }));
    ipcMain.handle('auth:signOut', () => ({ error: null }));
    ipcMain.handle('auth:getUser', () => ({ user: null }));
    ipcMain.handle('auth:isSignedIn', () => false);
    ipcMain.handle('auth:getDeviceId', () => 'academic-local');

    // Goodbye window close (triggered by renderer after farewell animation)
    ipcMain.on('goodbye:close', () => { app.quit(); });

    // App Limits 3.0
    ipcMain.handle('limits:getAll', () => {
        // Return limits with effective values (base + extensions)
        const limits = appLimits.store.getAllWithEffective();

        // Add extensions remaining from the engine
        for (const [key, limit] of Object.entries(limits)) {
            limit.extensionsLeft = appLimits.engine.getExtensionsLeft(key);
        }

        return limits;
    });

    ipcMain.handle('limits:get', (event, appName) => {
        return appLimits.store.get(appName);
    });

    const isDesklyLimitTarget = (rawName) => {
        const value = String(rawName || '').trim().toLowerCase();
        if (!value) return false;
        return (
            value === 'deskly' ||
            value === 'deskly.exe' ||
            value.includes(' deskly') ||
            value.includes('deskly ') ||
            value.includes('deskly.exe')
        );
    };

    ipcMain.handle('limits:set', (event, appName, dailyMinutes, mode) => {
        if (typeof appName !== 'string' || !appName.trim() || appName.length > 256) {
            return { success: false, error: 'Invalid appName' };
        }
        if (isDesklyLimitTarget(appName)) {
            return { success: false, error: 'Deskly cannot be selected as an App Limit target' };
        }
        if (!Number.isFinite(dailyMinutes) || dailyMinutes <= 0 || dailyMinutes > 1440) {
            return { success: false, error: 'dailyMinutes must be a positive number ≤ 1440' };
        }
        const VALID_MODES = ['warning', 'strict'];
        if (mode !== undefined && !VALID_MODES.includes(mode)) {
            return { success: false, error: 'Invalid mode' };
        }

        // Check if limit value is actually changing
        const existing = appLimits.store.get(appName);
        const limitChanged = existing && existing.dailyMinutes !== dailyMinutes;

        return appLimits.store.set(appName, dailyMinutes, mode);
    });

    ipcMain.handle('limits:remove', (event, appName) => {
        if (typeof appName !== 'string' || !appName.trim() || appName.length > 256) {
            return { success: false, error: 'Invalid appName' };
        }
        // Also clear extension tracker when removing a limit
        appLimits.engine.resetExtensionTracker(appName);
        return appLimits.store.remove(appName);
    });

    ipcMain.handle('limits:toggle', (event, appName, enabled) => {
        if (typeof appName !== 'string' || !appName.trim() || appName.length > 256) {
            return { success: false, error: 'Invalid appName' };
        }
        return appLimits.store.toggle(appName, enabled);
    });

    ipcMain.handle('limits:setMode', (event, appName, mode) => {
        if (typeof appName !== 'string' || !appName.trim() || appName.length > 256) {
            return { success: false, error: 'Invalid appName' };
        }
        const VALID_MODES = ['warning', 'strict'];
        if (!VALID_MODES.includes(mode)) {
            return { success: false, error: 'Invalid mode' };
        }
        return appLimits.store.setMode(appName, mode);
    });

    ipcMain.handle('limits:addTime', (event, appName, minutes) => {
        if (typeof appName !== 'string' || !appName.trim() || appName.length > 256) {
            return { success: false, error: 'Invalid appName' };
        }
        if (!Number.isFinite(minutes) || minutes <= 0 || minutes > 1440) {
            return { success: false, error: 'minutes must be a positive number ≤ 1440' };
        }
        return appLimits.store.addTime(appName, minutes);
    });

    ipcMain.handle('limits:getSettings', () => {
        return appLimits.store.getSettings();
    });

    // Overlay actions from limit overlay window
    ipcMain.on('limits:action', (event, { action, appName, payload }) => {
        try {
            appLimits.engine.handleOverlayAction(action, appName, payload);
        } catch (error) {
            console.error('Error handling limits action:', error);
        }
    });

    // ── App Lock IPC (master-credential model) ─────────────────────────────────
    ipcMain.handle('applock:isMasterConfigured', () => lockStore.isMasterConfigured());

    ipcMain.handle('applock:getMeta', () => lockStore.getMasterMeta());

    ipcMain.handle('applock:setupMaster', (event, secret, method) => {
        if (typeof secret !== 'string' || secret.length < 4 || secret.length > 128) {
            return { success: false, reason: 'too_short' };
        }
        const m = method === 'password' ? 'password' : 'pin';
        return lockStore.setupMaster(secret, m);
    });

    ipcMain.handle('applock:verifyMaster', (event, secret) => {
        if (typeof secret !== 'string') return { success: false, reason: 'wrong' };
        return lockStore.verifyMaster(secret);
    });

    ipcMain.handle('applock:changeMaster', (event, oldSecret, newSecret, method) => {
        if (typeof newSecret !== 'string' || newSecret.length < 4 || newSecret.length > 128) {
            return { success: false, reason: 'too_short' };
        }
        const m = method === 'password' ? 'password' : (method === 'pin' ? 'pin' : null);
        return lockStore.changeMaster(oldSecret, newSecret, m);
    });

    ipcMain.handle('applock:getAll', () => lockStore.getAll());

    ipcMain.handle('applock:getStatus', () => lockEnforcer.getStatus());

    // Full historical app catalog (past 12 months), minus protected processes
    // and already-locked apps. So apps used yesterday still appear today — you
    // never have to re-lock daily.
    ipcMain.handle('applock:getLockableApps', () => {
        let apps = [];
        try {
            const report = getReportStats('year');
            apps = report?.topApps || [];
        } catch (err) {
            logger.warn('applock:getLockableApps failed', err.message);
        }
        const locked = lockStore.getAll();
        return apps
            .filter(a => a && a.name)
            .filter(a => !isProtectedProcess(a.name) && !isProtectedProcess(a.name + '.exe'))
            .filter(a => !locked[a.name.toLowerCase()])
            .map(a => ({
                name:        a.name,
                displayName: a.displayName || a.name,
                seconds:     a.seconds || 0,
                category:    a.category || null,
            }));
    });

    ipcMain.handle('applock:add', (event, appName, config) => {
        if (typeof appName !== 'string' || !appName.trim() || appName.length > 256) {
            return { success: false, reason: 'invalid' };
        }
        const proc = (config?.processName || appName + '.exe');
        if (isProtectedProcess(proc) || isProtectedProcess(appName)) {
            return { success: false, reason: 'protected' };
        }
        try {
            const r = lockStore.addLock(appName, config || {});
            if (r.success) syncLockWatchdog();
            return r;
        } catch (err) {
            logger.error('applock:add failed', err.message);
            return { success: false, reason: 'error' };
        }
    });

    // Removing a lock requires the master PIN (closes the "delete without auth" hole).
    ipcMain.handle('applock:remove', (event, appName, secret) => {
        if (typeof secret !== 'string') return { success: false, reason: 'wrong' };
        const r = lockStore.removeLock(appName, secret);
        if (r.success) syncLockWatchdog();
        return r;
    });

    ipcMain.handle('applock:toggle', (event, appName, enabled) => {
        const r = lockStore.toggleLock(appName, !!enabled);
        if (r.success) syncLockWatchdog();
        return r;
    });

    ipcMain.handle('applock:authenticate', (event, appName, secret) => {
        if (typeof secret !== 'string') return { success: false, reason: 'wrong' };
        return lockStore.authenticate(appName, secret);
    });

    // Reset everything (forgot-PIN escape hatch). Requires the renderer to gate
    // this behind a deliberate typed confirmation.
    ipcMain.handle('applock:reset', () => {
        const r = lockStore.resetAll();
        lockWatchdog.stop();
        return r;
    });

    ipcMain.handle('applock:getSettings', () => lockStore.getSettings());
    ipcMain.handle('applock:updateSettings', (event, patch) => lockStore.updateSettings(patch || {}));

    ipcMain.handle('applock:hasActive', () => lockEnforcer.hasActiveLocks());

    // ── Focus Mode IPC ────────────────────────────────────────────────────────
    ipcMain.handle('focus:getState', () => focusEngine.getState());
    ipcMain.handle('focus:getStats', () => focusStore.getStats());
    ipcMain.handle('focus:getSettings', () => focusStore.getSettings());
    ipcMain.handle('focus:updateSettings', (event, patch) => focusStore.updateSettings(patch || {}));
    ipcMain.handle('focus:start', (event, config) => focusEngine.start(config || {}));
    ipcMain.handle('focus:end', (event, early) => focusEngine.end(!!early));
    ipcMain.handle('focus:getBlockableApps', () => {
        let apps = [];
        try {
            const report = getReportStats('year');
            apps = report?.topApps || [];
        } catch {}
        return apps
            .filter(a => a && a.name)
            .filter(a => !isProtectedProcess(a.name) && !isProtectedProcess(a.name + '.exe'))
            .map(a => ({ name: a.name, displayName: a.displayName || a.name }));
    });
    ipcMain.handle('focus:getCategories', () => {
        try { return require('./services/user-categories').getCategories(); } catch { return []; }
    });

    // Data fetching
    ipcMain.handle('stats:today', async () => {
        try {
            // Fire tracking refresh in the background — never block the IPC response.
            // The 'stats:updated' push (every 3s) delivers any freshened data to the
            // renderer automatically; the UI doesn't need to wait here.
            refreshTrackingSnapshotIfNeeded().catch(() => {});
            return await getTodayStats();
        } catch (error) {
            console.error('Error getting today stats:', error);
            return { totalSeconds: 0, apps: [], categories: {} };
        }
    });

    ipcMain.handle('stats:weekly', async () => {
        try {
            const stats = await getWeeklyStats();
            return stats;
        } catch (error) {
            console.error('Error getting weekly stats:', error);
            return { days: [], totalSeconds: 0 };
        }
    });

    // New comprehensive reports endpoint
    ipcMain.handle('stats:report', async (event, period = 'week') => {
        try {
            const stats = getReportStats(period);
            return stats;
        } catch (error) {
            console.error('Error getting report stats:', error);
            return null;
        }
    });

    ipcMain.handle('insights:getWeekly', async () => {
        try {
            return getWeeklyInsights();
        } catch (error) {
            console.error('[IPC] insights:getWeekly error:', error);
            return { insights: [], generatedAt: new Date().toISOString(), hasData: false };
        }
    });

    ipcMain.handle('timeline:getDay', async (event, dateStr) => {
        try {
            const { getDailySummary, getAppDisplayName } = require('./database/db');
            const { getCategories } = require('./services/user-categories');
            const date = dateStr || new Date().toLocaleDateString('en-CA');
            const summary = getDailySummary(date);
            const sessions = (summary.sessions || [])
                .filter(s => s.startTime && s.endTime && s.duration > 0)
                .sort((a, b) => new Date(a.startTime) - new Date(b.startTime))
                .map(s => ({
                    id:          s.id,
                    appName:     s.appName,
                    displayName: getAppDisplayName(s.appName),
                    windowTitle: s.windowTitle || '',
                    category:    s.category   || 'Uncategorized',
                    startTime:   s.startTime,
                    endTime:     s.endTime,
                    duration:    s.duration,
                }));

            const totalSeconds = Object.values(summary.aggregates || {})
                .reduce((a, v) => a + (v.totalSeconds || 0), 0);

            // App-switch count (unique consecutive changes)
            let switches = 0;
            for (let i = 1; i < sessions.length; i++) {
                if (sessions[i].appName !== sessions[i - 1].appName) switches++;
            }

            return { date, sessions, totalSeconds, switchCount: switches };
        } catch (err) {
            console.error('[IPC] timeline:getDay error:', err);
            return { date: dateStr, sessions: [], totalSeconds: 0, switchCount: 0 };
        }
    });

    // ── Per-App Goals ──────────────────────────────────────────────────
    ipcMain.handle('appgoals:getAll', async () => {
        try { return appGoalsService.getAppGoals(); }
        catch (e) { console.error('[IPC] appgoals:getAll error:', e); return {}; }
    });

    ipcMain.handle('appgoals:get', async (event, appName) => {
        try { return appGoalsService.getAppGoal(appName); }
        catch (e) { console.error('[IPC] appgoals:get error:', e); return null; }
    });

    ipcMain.handle('appgoals:set', async (event, appName, targetMinutes, type, label) => {
        try { return appGoalsService.setAppGoal(appName, targetMinutes, type, label); }
        catch (e) { console.error('[IPC] appgoals:set error:', e); return null; }
    });

    ipcMain.handle('appgoals:remove', async (event, appName) => {
        try { appGoalsService.removeAppGoal(appName); return true; }
        catch (e) { console.error('[IPC] appgoals:remove error:', e); return false; }
    });

    ipcMain.handle('appgoals:progress', async (event, dateStr) => {
        try { return appGoalsService.getAppGoalsProgress(dateStr); }
        catch (e) { console.error('[IPC] appgoals:progress error:', e); return []; }
    });

    ipcMain.handle('appgoals:dailyScore', async (event, dateStr) => {
        try {
            const goalHours = getDailyGoal();
            return appGoalsService.getDailyScore(dateStr, goalHours);
        } catch (e) { console.error('[IPC] appgoals:dailyScore error:', e); return 50; }
    });

    ipcMain.handle('stats:apps', async (event, options = {}) => {
        try {
            return await getAppUsage(options);
        } catch (error) {
            console.error('Error getting app usage:', error);
            return [];
        }
    });

    ipcMain.handle('stats:unlocks', async () => {
        try {
            return getUnlockCount(getToday());
        } catch (error) {
            console.error('Error getting unlock count:', error);
            return 0;
        }
    });

    // Settings
    ipcMain.handle('settings:get', async (event, key) => {
        try {
            return getSetting(key);
        } catch (error) {
            console.error('Error getting setting:', error);
            return null;
        }
    });

    ipcMain.handle('settings:set', async (event, key, value) => {
        try {
            setSetting(key, value);
            return true;
        } catch (error) {
            console.error('Error setting setting:', error);
            return false;
        }
    });

    // ===== BROWSER LOCK =====
    // Password-protect the Browser Activity screen.
    // Passwords are hashed with PBKDF2 + random salt; plain text is never stored.
    function _hashBrowserPassword(password, saltHex) {
        return crypto
            .pbkdf2Sync(Buffer.from(password, 'utf8'), Buffer.from(saltHex, 'hex'), 100_000, 32, 'sha256')
            .toString('hex');
    }

    function _verifyBrowserPassword(password, storedHashHex, saltHex) {
        try {
            const attempt = Buffer.from(_hashBrowserPassword(password, saltHex), 'hex');
            const stored = Buffer.from(storedHashHex, 'hex');
            if (attempt.length !== stored.length) return false;
            return crypto.timingSafeEqual(attempt, stored);
        } catch {
            return false;
        }
    }

    ipcMain.handle('browser:lock:status', () => {
        try {
            return { enabled: Boolean(getSetting('browserLockHash')) };
        } catch {
            return { enabled: false };
        }
    });

    ipcMain.handle('browser:lock:set', (event, newPassword, currentPassword) => {
        try {
            if (!newPassword || typeof newPassword !== 'string' || newPassword.length < 4) {
                return { success: false, error: 'Password must be at least 4 characters' };
            }
            const existingHash = getSetting('browserLockHash');
            const existingSalt = getSetting('browserLockSalt');
            if (existingHash && existingSalt) {
                if (!currentPassword || !_verifyBrowserPassword(currentPassword, existingHash, existingSalt)) {
                    return { success: false, error: 'Current password is incorrect' };
                }
            }
            const salt = crypto.randomBytes(16).toString('hex');
            const hash = _hashBrowserPassword(newPassword, salt);
            setSetting('browserLockHash', hash);
            setSetting('browserLockSalt', salt);
            return { success: true };
        } catch {
            return { success: false, error: 'Could not save password' };
        }
    });

    ipcMain.handle('browser:lock:verify', (event, password) => {
        try {
            if (!password || typeof password !== 'string') return { success: false };
            const hash = getSetting('browserLockHash');
            const salt = getSetting('browserLockSalt');
            if (!hash || !salt) return { success: true }; // Not locked
            return { success: _verifyBrowserPassword(password, hash, salt) };
        } catch {
            return { success: false };
        }
    });

    ipcMain.handle('browser:lock:remove', (event, currentPassword) => {
        try {
            const hash = getSetting('browserLockHash');
            const salt = getSetting('browserLockSalt');
            if (!hash || !salt) return { success: true };
            if (!currentPassword || !_verifyBrowserPassword(currentPassword, hash, salt)) {
                return { success: false, error: 'Incorrect password' };
            }
            setSetting('browserLockHash', null);
            setSetting('browserLockSalt', null);
            return { success: true };
        } catch {
            return { success: false, error: 'Could not remove lock' };
        }
    });
    // ===== END BROWSER LOCK =====

    // Tracking control
    ipcMain.handle('tracking:status', () => isTracking);

    ipcMain.on('tracking:toggle', () => {
        try {
            if (isTracking) {
                stopTracking();
                isTracking = false;
            } else {
                startTracking();
                isTracking = true;
            }
        } catch (error) {
            console.error('Error toggling tracking:', error);
        }
    });

    // Data management
    safeIpcHandle('data:export', async () => {
        const data = getAllData();
        const { filePath } = await dialog.showSaveDialog(mainWindow, {
            title: 'Export Usage Data',
            defaultPath: `deskly-export-${new Date().toISOString().split('T')[0]}.json`,
            filters: [{ name: 'JSON', extensions: ['json'] }]
        });

        if (filePath) {
            // Use async write to avoid blocking the main process / freezing the UI
            // for users with large data sets (months of tracking history).
            await fs.promises.writeFile(filePath, JSON.stringify(data, null, 2));
            return { success: true };
        }
        return { success: false, cancelled: true };
    }, 'Could not export data right now. Please try again.');

    // Break reminder control
    ipcMain.handle('break:toggle', async (event, enabled) => {
        try {
            setSetting('breakReminder', enabled);
            if (enabled) {
                const interval = getSetting('breakInterval') || 30;
                startBreakReminders(interval, () => {
                    if (mainWindow && !mainWindow.isDestroyed()) {
                        mainWindow.show();
                        mainWindow.focus();
                    }
                });
            } else {
                stopBreakReminders();
            }
            return { success: true };
        } catch (error) {
            console.error('Error toggling break reminder:', error);
            return { success: false, error: 'Could not update break reminders right now. Please try again.' };
        }
    });

    ipcMain.handle('break:setInterval', async (event, minutes) => {
        try {
            if (!Number.isFinite(minutes) || minutes < 1 || minutes > 480) {
                return { success: false, error: 'minutes must be between 1 and 480' };
            }
            setSetting('breakInterval', minutes);
            const enabled = getSetting('breakReminder');
            if (enabled !== false) {
                updateBreakInterval(minutes);
            }
            return { success: true };
        } catch (error) {
            console.error('Error setting break interval:', error);
            return { success: false, error: 'Could not save reminder interval right now. Please try again.' };
        }
    });

    ipcMain.handle('break:test', async () => {
        try {
            sendTestNotification(() => {
                if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.show();
                    mainWindow.focus();
                }
            });
            return { success: true };
        } catch (error) {
            console.error('Error sending test notification:', error);
            return { success: false, error: 'Could not send a test reminder right now. Please try again.' };
        }
    });

    // Goals and streaks
    ipcMain.handle('goals:get', async () => {
        return getDailyGoal();
    });

    ipcMain.handle('goals:set', async (event, hours) => {
        try {
            if (!Number.isFinite(hours) || hours <= 0 || hours > 24) {
                return { success: false, error: 'hours must be between 0 and 24' };
            }
            setDailyGoal(hours);
            return { success: true };
        } catch (error) {
            console.error('Error setting goal:', error);
            return { success: false, error: 'Could not save your daily goal right now. Please try again.' };
        }
    });

    ipcMain.handle('goals:streak', async () => {
        // Update streak before returning (sets current streak based on yesterday)
        // Note: dailySummary is passed but updateStreak now internally uses vault via goals-streaks.js
        // We still pass it for backwards compatibility but it's not actively used
        updateStreak({});
        return getStreakData();
    });

    ipcMain.handle('goals:progress', async () => {
        // getTodayProgress now internally uses vault via goals-streaks.js
        // We pass empty object for backwards compatibility
        return getTodayProgress({});
    });

    ipcMain.handle('goals:achievements', async () => {
        return getAchievements();
    });

    ipcMain.handle('goals:calendar', async (event, days = 30) => {
        try {
            const { getDailySummary } = require('./database/db');
            const goalHours = getDailyGoal();
            const result = [];
            const today = new Date();
            for (let i = 0; i < days; i++) {
                const d = new Date(today);
                d.setDate(today.getDate() - i);
                const dateStr = d.toLocaleDateString('en-CA');
                const score   = appGoalsService.getDailyScore(dateStr, goalHours);
                const dayData = getDailySummary(dateStr);
                let totalSeconds = 0;
                if (dayData?.aggregates) {
                    for (const v of Object.values(dayData.aggregates)) {
                        if (v && typeof v === 'object') totalSeconds += v.totalSeconds || 0;
                    }
                }
                result.push({ date: dateStr, score, totalSeconds });
            }
            return result.reverse(); // oldest → newest
        } catch (e) {
            console.error('[IPC] goals:calendar error:', e);
            return [];
        }
    });

    // Achievements
    ipcMain.handle('achievements:getAll', async () => {
        return getAllAchievements();
    });

    ipcMain.handle('achievements:stats', async () => {
        return getAchievementStats();
    });

    // Export
    ipcMain.handle('export:json', async () => {
        return exportToJSON(mainWindow);
    });

    ipcMain.handle('export:csv', async () => {
        return exportToCSV(mainWindow);
    });

    // Auto-start
    ipcMain.handle('autostart:get', async () => {
        return getAutoStartEnabled();
    });

    ipcMain.handle('autostart:set', async (event, enabled) => {
        return setAutoStart(enabled);
    });

    // Browser Intelligence
    ipcMain.handle('browser:usage', async () => {
        return getTodayWebsiteUsage();
    });

    ipcMain.handle('browser:breakdown', async () => {
        return getBrowserBreakdown();
    });

    ipcMain.handle('browser:categories', async () => {
        return getWebsitesByCategory();
    });

    ipcMain.handle('browser:top', async (event, limit = 10) => {
        const safeLimit = Math.min(Math.max(Number.isFinite(limit) ? Math.floor(limit) : 10, 1), 100);
        return getTopWebsites(safeLimit);
    });

    ipcMain.handle('browser:stats', async () => {
        return getBrowserStats();
    });

    ipcMain.handle('browser:weekly', async () => {
        return getWeeklyWebsiteUsage();
    });

    // User-Defined Categories
    ipcMain.handle('categories:getAll', async () => {
        return getCategories();
    });

    ipcMain.handle('categories:create', async (event, name, color, icon) => {
        return createCategory(name, color, icon);
    });

    ipcMain.handle('categories:update', async (event, id, updates) => {
        return updateCategory(id, updates);
    });

    ipcMain.handle('categories:delete', async (event, id) => {
        return deleteCategory(id);
    });

    ipcMain.handle('categories:assignApp', async (event, appName, categoryId) => {
        const result = assignAppToCategory(appName, categoryId);
        invalidateAppCategoryCache(); // refresh in-memory map so tracker picks up new category
        return result;
    });

    ipcMain.handle('categories:stats', async () => {
        return getCategoryStats();
    });

    ipcMain.handle('categories:appsByCategory', async () => {
        return getAppsByCategory();
    });

    ipcMain.handle('categories:appMap', async () => {
        return getAppCategoryMap();
    });

    ipcMain.handle('categories:appMapWithNames', async () => {
        return getAppCategoryMapWithNames();
    });

    // Website Category handlers
    ipcMain.handle('categories:assignWebsite', async (event, websiteId, categoryId) => {
        return assignWebsiteToCategory(websiteId, categoryId);
    });

    ipcMain.handle('categories:websitesByCategory', async () => {
        return getUserWebsitesByCategory();
    });

    ipcMain.handle('categories:websiteMap', async () => {
        return getWebsiteCategoryMap();
    });

    ipcMain.handle('categories:websiteStats', async () => {
        return getWebsiteCategoryStats();
    });

    // Category suggestions (AI/ML-ready, currently heuristic)
    ipcMain.handle('categories:suggestForApp', async (event, appName) => {
        try {
            return getSuggestedCategoriesForApp(appName);
        } catch (error) {
            console.error('Error getting category suggestions:', error);
            return { appName, suggestions: [] };
        }
    });

    // Browser Categories (Separate System)
    ipcMain.handle('browserCategories:getAll', async () => {
        return getBrowserCategories();
    });

    ipcMain.handle('browserCategories:create', async (event, name, color, icon) => {
        return createBrowserCategory(name, color, icon);
    });

    ipcMain.handle('browserCategories:update', async (event, id, updates) => {
        return updateBrowserCategory(id, updates);
    });

    ipcMain.handle('browserCategories:delete', async (event, id) => {
        return deleteBrowserCategory(id);
    });

    ipcMain.handle('browserCategories:websitesByCategory', async () => {
        return getWebsitesByBrowserCategory();
    });

    // Reset Data
    // Reset Data
    ipcMain.removeHandler('data:reset'); // Prevent duplicate registration error
    ipcMain.handle('data:reset', async () => {
        const { clearActivityData } = require('./database/db');
        return clearActivityData();
    });

    // Auto-update handlers (Disabled in Academic Edition)
    ipcMain.handle('update:getStatus', () => null);
    ipcMain.handle('app:getVersion', () => '1.0.0');
    ipcMain.handle('update:checkNow', () => ({ success: false, message: 'Updates disabled in Academic Edition.' }));
    ipcMain.handle('update:downloadNow', () => ({ success: false, message: 'Updates disabled in Academic Edition.' }));
    ipcMain.handle('update:remindLater', () => ({ success: false }));
    ipcMain.handle('update:dismissNotice', () => ({ success: true }));

    // Native App Icons (Windows Shell API)
    ipcMain.handle('icons:get', async (event, appName) => {
        try {
            return await getAppIcon(appName);
        } catch (error) {
            console.error('Error getting app icon:', error);
            return { type: 'letter', letter: appName?.charAt(0)?.toUpperCase() || '?', color: '#6b7280' };
        }
    });

    ipcMain.handle('icons:getCached', async () => {
        return getCachedIcons();
    });

    ipcMain.handle('icons:clear', async () => {
        clearIconCache();
        return { success: true };
    });

    ipcMain.handle('icons:preExtract', async (event, appNames) => {
        return await preExtractIcons(appNames);
    });

}

// App lifecycle
app.whenReady().then(async () => {
    // Keep startup path short: do only a cheap vault-path check up front.
    // Full integrity scan/repair is deferred until after first paint.
    ensureVaultPathStillExists();

    // Initialize database
    initDatabase();

    const firstRun = vaultManager.isFirstRun();

    // Default behavior for fresh installs: start with Windows enabled.
    // We gate this to first-run + one-time marker so existing users are never overridden.
    if (firstRun && getSetting('autoStartInitialized') !== true) {
        try {
            setAutoStart(true);
            setSetting('autoStartInitialized', true);
            logger.info('Auto-start default applied for first-run install.');
        } catch (error) {
            logger.warn('Failed to apply first-run auto-start default.', error?.message || error);
        }
    }

    launchContext = {
        ...launchContext,
        firstRun,
        mode: firstRun
            ? 'first-run'
            : (launchContext.resumedAfterUncleanShutdown
                ? 'crash-recovery'
                : (launchContext.updatedFromVersion ? 'post-update' : 'returning')),
        telemetryEnabled: false,
    };
    productRuntime.appendLog('info', 'app.launch.context', launchContext);

    // Setup IPC handlers
    setupIpcHandlers();

    // Create window and tray
    createWindow();
    createTray();

    scheduleDeferredStartupTask('streak-refresh', 600, async () => {
        updateStreak({});
    });

    scheduleDeferredStartupTask('tracking-start', 700, async () => {
        if (productRuntime.getFlag('tracking.enabled', true)) {
            startTracking();
            isTracking = true;
        } else {
            isTracking = false;
        }
    });

    scheduleDeferredStartupTask('tray-stats', 900, async () => {
        await updateTrayInfo().catch(() => {});
        trayUpdateInterval = setInterval(() => updateTrayInfo().catch(() => {}), 90 * 1000);
    });

    scheduleDeferredStartupTask('app-limits', 1100, async () => {
        appLimits.init(mainWindow);
        appLimits.start();
    });

    scheduleDeferredStartupTask('break-reminders', 1400, async () => {
        const breakReminderEnabled = getSetting('breakReminder');
        const breakInterval = getSetting('breakInterval') || 30;
        if (breakReminderEnabled !== false) {
            startBreakReminders(breakInterval, () => {
                if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.show();
                    mainWindow.focus();
                }
            });
        }
    });

    scheduleDeferredStartupTask('vault-watcher', 1700, async () => {
        const currentVaultPath = vaultManager.getVaultPath();
        if (currentVaultPath && productRuntime.getFlag('vault.watcher.enabled', true)) {
            startVaultWatcher(vaultManager);

            onVaultDeleted((data) => {
                if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.webContents.send('vault:deleted', data);
                }
            });

            onVaultHealthChanged((health) => {
                if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.webContents.send('vault:health-changed', health);
                }
            });
        }
    });



    scheduleDeferredStartupTask('vault-integrity-maintenance', 2300, async () => {
        runVaultIntegrityMaintenance();
    });

    // ── App Lock enforcer ────────────────────────────────────────────────────
    scheduleDeferredStartupTask('app-lock-enforcer', 1800, async () => {
        try {
            lockStore.init();

            // Auth-success callback from the lock screen.
            lockOverlayManager.init((appName) => {
                // Special "quit" auth — the user entered the PIN to exit Deskly.
                if (appName === '__quit__') {
                    quitAuthorized = true;
                    lockWatchdog.stop();
                    logger.info('[AppLock] Quit authorized via PIN');
                    app.quit();
                    return;
                }
                // Normal app unlock: start a re-lock session, relaunch the app,
                // and refresh the management page's status chips.
                lockEnforcer.onUnlocked(appName);
                lockEnforcer.relaunchApp(appName);
                if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.webContents.send('applock:statusUpdate', lockEnforcer.getStatus());
                }
                logger.info(`[AppLock] Access granted to ${appName}`);
            });

            lockEnforcer.init(lockOverlayManager);

            // Usage provider for "after_minutes" triggers (refreshed ~every 10s).
            lockEnforcer.setUsageProvider(async () => {
                const stats = lastCachedStats || await getTodayStats().catch(() => null);
                const map = {};
                for (const app of (stats?.apps || [])) {
                    const key = (app.name || '').toLowerCase().replace(/\.exe$/i, '');
                    if (key) map[key] = app.seconds || 0;
                }
                return map;
            });

            // When an app auto re-locks on close, push fresh status to the UI.
            lockEnforcer.setStatusNotifier(() => {
                if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.webContents.send('applock:statusUpdate', lockEnforcer.getStatus());
                }
            });

            lockEnforcer.start();
            syncLockWatchdog(); // resurrect-protection if locks already exist
            logger.info('[AppLock] Enforcer started');
        } catch (err) {
            logger.warn('[AppLock] Enforcer startup failed:', err.message);
        }
    });

    // ── Focus Mode ────────────────────────────────────────────────────────────
    scheduleDeferredStartupTask('focus-mode', 2200, () => {
        try {
            focusOverlayManager.init(() => focusEngine.end(true)); // "End session" from overlay
            focusEngine.init(
                focusOverlayManager,
                () => {
                    // Push state updates to the renderer whenever the engine ticks.
                    if (mainWindow && !mainWindow.isDestroyed()) {
                        mainWindow.webContents.send('focus:stateUpdate', focusEngine.getState());
                    }
                }
            );
            logger.info('[Focus] Engine ready');
        } catch (err) {
            logger.warn('[Focus] Startup failed:', err.message);
        }
    });

    productRuntime.markLaunchReady({ mode: launchContext.mode });

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });

    // Track unlocks; also resume tracking if it was paused by lock-screen
    powerMonitor.on('unlock-screen', () => {
        const date = getToday();
        incrementUnlockCount(date);
        if (!isTracking) {
            startTracking();
            isTracking = true;
        }
    });

    // Pause tracking when system sleeps — prevents sleep time being counted as screen time
    powerMonitor.on('suspend', () => {
        if (isTracking) {
            stopTracking();
            isTracking = false;
            logger.info('Tracking paused: system suspended');
        }
    });

    // Pause tracking when screen locks (Win+L or auto-lock policy)
    powerMonitor.on('lock-screen', () => {
        if (isTracking) {
            stopTracking();
            isTracking = false;
            logger.info('Tracking paused: screen locked');
        }
    });

    // Resume tracking when system wakes from sleep
    powerMonitor.on('resume', () => {
        if (!isTracking) {
            startTracking();
            isTracking = true;
            logger.info('Tracking resumed: system woke from sleep');
        }
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        // Don't quit, keep running in tray
    }
});

app.on('before-quit', (event) => {
    // Synchronous guard: if App Lock is active and unauthenticated, block the
    // quit and show the PIN overlay. preventDefault() MUST run before any await,
    // so this handler stays synchronous.
    if (!quitAuthorized && lockEnforcer.hasActiveLocks()) {
        event.preventDefault();
        try {
            lockOverlayManager.show({ appName: '__quit__', displayName: 'Deskly', mode: 'quit' });
        } catch (err) {
            quitAuthorized = true;
            app.quit();
        }
        return;
    }

    // Authorized (or no locks) → proceed with shutdown.
    lockWatchdog.stop();

    // Stop background intervals and clean up Windows taskbar state
    if (trayUpdateInterval) {
        clearInterval(trayUpdateInterval);
        trayUpdateInterval = null;
    }
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.setProgressBar(-1);
    }
    lockEnforcer.stop();
    lockOverlayManager.destroy();
    stopTracking();
    stopBreakReminders();
    stopVaultWatcher();

    productRuntime.markCleanShutdown();
    // Flush any buffered log lines synchronously before the process exits.
    productRuntime.flushLogBuffer();
});

} // end if (!process.argv.includes('--goodbye'))


