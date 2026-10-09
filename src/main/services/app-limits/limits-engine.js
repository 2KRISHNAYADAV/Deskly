/**
 * Limits Engine 3.1 - Redesigned
 * 
 * New approach:
 * - Warning mode only (for now)
 * - Shows overlay ONLY when blocked app is active
 * - Hides overlay when user switches to another app
 * - Re-shows overlay when user returns to blocked app
 * - Tracks extension count per app (max 3 per day)
 * - Extension adds 5 minutes each time
 * 
 * Flow:
 * 1. User uses app normally
 * 2. Hits limit → overlay shows (only if that app is focused)
 * 3. User can: Take Break (closes overlay) OR +5min (adds time, closes overlay)
 * 4. If user switches to another app → overlay hides automatically
 * 5. If user returns to blocked app → overlay re-shows
 * 6. After using extensions → no more extensions available
 */

const limitsStore = require('./limits-store');

let overlayManager = null;
let isActive = false;
let currentBlockedApp = null; // Which app triggered the current overlay

// Track extensions per app for today
const extensionTracker = new Map(); // appName -> { count: number, lastExtendedAt: timestamp }
const MAX_EXTENSIONS_PER_DAY = 3;
const EXTENSION_MINUTES = 5;

// --- Initialization ---

function init(overlayMgr) {
    overlayManager = overlayMgr;
    limitsStore.init();

    // Restore in-memory extension tracker from persisted daily state.
    // Without this, force-quitting and relaunching resets the extension budget,
    // allowing users to bypass limits by simply restarting the app.
    const allLimits = limitsStore.getAll();
    for (const appName of Object.keys(allLimits)) {
        const count = limitsStore.getExtensionCount(appName);
        if (count > 0) {
            extensionTracker.set(appName.toLowerCase(), { count, lastExtendedAt: null });
            console.log(`⚙️ Restored ${count} extension(s) used today for ${appName}`);
        }
    }

    console.log('⚙️ Limits Engine 3.1 initialized');
}

function start() {
    isActive = true;
    console.log('▶️ Limits enforcement started');
}

function stop() {
    isActive = false;
    currentBlockedApp = null;
    if (overlayManager) {
        overlayManager.hide();
    }
    console.log('⏸️ Limits enforcement stopped');
}

function isRunning() {
    return isActive;
}

// --- Extension Management ---

function getExtensionsLeft(appName) {
    const key = appName.toLowerCase();
    const tracker = extensionTracker.get(key);
    if (!tracker) return MAX_EXTENSIONS_PER_DAY;
    return Math.max(0, MAX_EXTENSIONS_PER_DAY - tracker.count);
}

/**
 * Reset extension tracker for a specific app
 * Called when user manually changes the limit
 */
function resetExtensionTracker(appName) {
    const key = appName.toLowerCase();
    extensionTracker.delete(key);
    // Also clear the persisted count so the reset survives a restart
    limitsStore.resetExtensionCount(appName);
    console.log(`🔄 Extension tracker reset for ${appName}`);
}

function useExtension(appName) {
    const key = appName.toLowerCase();
    let tracker = extensionTracker.get(key);
    
    if (!tracker) {
        tracker = { count: 0, lastExtendedAt: null };
        extensionTracker.set(key, tracker);
    }
    
    if (tracker.count >= MAX_EXTENSIONS_PER_DAY) {
        return false; // No extensions left
    }
    
    tracker.count++;
    tracker.lastExtendedAt = Date.now();
    
    // Add time to the limit
    limitsStore.addTime(appName, EXTENSION_MINUTES);

    // Persist the updated count so a restart doesn't refill the budget
    limitsStore.incrementExtensionCount(appName);
    
    console.log(`⏱️ Extension used for ${appName}: ${tracker.count}/${MAX_EXTENSIONS_PER_DAY}`);
    return true;
}

// --- Core Check Logic ---

/**
 * Check if an app has exceeded its limit
 * Called from activity-tracker on each tick
 * 
 * @param {string} appName - Process name (currently active app)
 * @param {number} usedSeconds - Total seconds used today
 * @returns {Object} Status object
 */
function check(appName, usedSeconds) {
    if (!isActive) {
        return { status: 'inactive' };
    }

    const effectiveLimit = limitsStore.getEffectiveLimit(appName);

    if (!effectiveLimit) {
        // No limit for this app - hide overlay if showing
        // This handles: user switched away OR limit was removed/disabled
        if (currentBlockedApp) {
            hideOverlay();
        }
        return { status: 'no-limit' };
    }

    const usedMinutes = Math.floor(usedSeconds / 60);
    const limitMinutes = effectiveLimit.effectiveMinutes;
    const percentUsed = Math.round((usedMinutes / limitMinutes) * 100);

    // App has a limit but user switched to a different app
    if (currentBlockedApp && currentBlockedApp.toLowerCase() !== appName.toLowerCase()) {
        hideOverlay();
    }

    // Check if limit exceeded
    if (usedMinutes >= limitMinutes) {
        return {
            status: 'exceeded',
            appName,
            usedMinutes,
            limitMinutes,
            percentUsed,
            mode: effectiveLimit.mode,
            displayName: effectiveLimit.displayName,
            extensionsLeft: getExtensionsLeft(appName)
        };
    }

    // Not exceeded yet
    return {
        status: 'ok',
        appName,
        usedMinutes,
        limitMinutes,
        percentUsed,
        remainingMinutes: limitMinutes - usedMinutes
    };
}

/**
 * Enforce the limit (show overlay)
 * Called when check() returns 'exceeded' and app is in focus
 */
async function enforce(checkResult) {
    if (!isActive || !overlayManager) return;

    const { appName, usedMinutes, limitMinutes, displayName, extensionsLeft } = checkResult;

    // Already showing overlay for this app
    if (currentBlockedApp?.toLowerCase() === appName.toLowerCase() && overlayManager.isVisible()) {
        return;
    }

    console.log(`🚨 LIMIT REACHED: ${appName} - ${usedMinutes}m / ${limitMinutes}m`);
    
    // Mark as triggered (for UI indicator)
    limitsStore.markTriggered(appName);
    
    // Set current blocked app
    currentBlockedApp = appName;
    
    // Show overlay
    overlayManager.show({
        type: 'warning',
        appName,
        displayName: displayName || appName,
        usedMinutes,
        limitMinutes,
        extensionsLeft
    });
    
    // Notify renderer for real-time UI update
    notifyLimitTriggered(appName, usedMinutes, limitMinutes);
}

/**
 * Re-show overlay when user returns to a blocked app
 */
async function reshowOverlay(checkResult) {
    if (!isActive || !overlayManager) return;
    
    const { appName, usedMinutes, limitMinutes, displayName, extensionsLeft } = checkResult;
    
    // Check if already showing for this app
    if (currentBlockedApp?.toLowerCase() === appName.toLowerCase() && overlayManager.isVisible()) {
        return;
    }
    
    console.log(`🔄 User returned to blocked app: ${appName}`);
    
    currentBlockedApp = appName;
    
    overlayManager.show({
        type: 'warning',
        appName,
        displayName: displayName || appName,
        usedMinutes,
        limitMinutes,
        extensionsLeft
    });
}

// --- Hide Overlay ---

function hideOverlay() {
    if (overlayManager && overlayManager.isVisible()) {
        overlayManager.hide();
        console.log(`🙈 Overlay hidden (user switched away from ${currentBlockedApp})`);
    }
    currentBlockedApp = null;
}

// --- Actions from Overlay ---

async function handleOverlayAction(action, appName, payload = null) {
    console.log(`📱 Overlay action: ${action} for ${appName}`, payload);

    switch (action) {
        case 'dismiss':
            // User chose "Take a break"
            overlayManager.hide();
            currentBlockedApp = null;
            console.log(`✅ User taking a break from ${appName}`);
            break;

        case 'add-time':
            // User chose "+5 minutes"
            const success = useExtension(appName);
            if (success) {
                overlayManager.hide();
                currentBlockedApp = null;
                console.log(`⏱️ Added ${EXTENSION_MINUTES}m to ${appName}`);
                
                // Notify UI to refresh and show updated effective limit
                const effectiveLimit = limitsStore.getEffectiveLimit(appName);
                notifyLimitTriggered(appName, effectiveLimit?.effectiveMinutes || 0, effectiveLimit?.effectiveMinutes || 0);
            } else {
                console.log(`❌ No extensions left for ${appName}`);
            }
            break;

        case 'close':
            overlayManager.hide();
            currentBlockedApp = null;
            break;
    }
}

// --- Daily Reset ---

function resetDaily() {
    limitsStore.resetDailyState();
    extensionTracker.clear();
    currentBlockedApp = null;
    console.log('🔄 Daily limits reset');
}

// --- Notify renderer of limit changes ---

function notifyLimitTriggered(appName, usedMinutes, limitMinutes) {
    if (overlayManager) {
        overlayManager.notifyMain('limits:triggered', {
            appName,
            usedMinutes,
            limitMinutes,
            timestamp: Date.now()
        });
    }
}

// --- Get current state ---

function getCurrentTarget() {
    return currentBlockedApp;
}

// --- Exports ---

module.exports = {
    init,
    start,
    stop,
    isRunning,
    check,
    enforce,
    reshowOverlay,
    handleOverlayAction,
    resetDaily,
    hideOverlay,
    getCurrentTarget,
    notifyLimitTriggered,
    getExtensionsLeft,
    resetExtensionTracker,
    // Re-export store methods
    store: limitsStore
};
