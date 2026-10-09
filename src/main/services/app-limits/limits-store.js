/**
 * App Limits Store 3.0
 * 
 * Vault-based storage for app limits with per-app enforcement modes.
 * 
 * Storage structure (.deskly/app-limits.json):
 * {
 *   "limits": {
 *     "chrome": {
 *       "dailyMinutes": 120,
 *       "mode": "minimize",  // "warning" | "minimize" | "strict"
 *       "enabled": true,
 *       "displayName": "Chrome"
 *     }
 *   },
 *   "dailyState": {
 *     "2026-01-25": {
 *       "chrome": {
 *         "addedMinutes": 10,     // Extra time granted today
 *         "triggered": false,     // Has limit been triggered today?
 *         "lastWarning": null     // Timestamp of last warning
 *       }
 *     }
 *   },
 *   "settings": {
 *     "defaultMode": "warning",
 *     "warningThresholds": [80, 100],  // Percentage thresholds
 *     "addTimeOptions": [5, 10, 15]    // Minutes options for "add time"
 *   }
 * }
 */

const fs = require('fs');
const path = require('path');
const Store = require('electron-store');

// Vault pointer
const vaultPointer = new Store({ name: 'vault-pointer' });

// Enforcement modes
const MODES = {
    WARNING: 'warning',     // Show overlay, user dismisses
    MINIMIZE: 'minimize',   // Minimize app + block focus
    STRICT: 'strict'        // Terminate immediately
};

// Default configuration
const DEFAULT_DATA = {
    limits: {},
    dailyState: {},
    settings: {
        defaultMode: MODES.WARNING,
        warningThresholds: [80, 100],
        addTimeOptions: [5, 10, 15]
    }
};

let data = null;
let filePath = null;

// --- Helpers ---

function getToday() {
    // Use local date (matches db.js and the rest of the app) — NOT UTC ISO date
    return new Date().toLocaleDateString('en-CA', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    });
}

function getVaultPath() {
    return vaultPointer.get('vaultPath');
}

// --- Initialization ---

function init() {
    const vaultPath = getVaultPath();
    if (!vaultPath) {
        console.log('⏳ Limits store waiting for vault...');
        data = { ...DEFAULT_DATA };
        return false;
    }

    const dwbDir = path.join(vaultPath, '.deskly');
    filePath = path.join(dwbDir, 'app-limits.json');

    // Ensure directory exists
    if (!fs.existsSync(dwbDir)) {
        fs.mkdirSync(dwbDir, { recursive: true });
    }

    // Load or create
    if (fs.existsSync(filePath)) {
        try {
            const content = fs.readFileSync(filePath, 'utf-8');
            data = { ...DEFAULT_DATA, ...JSON.parse(content) };
            console.log('📋 App limits loaded from vault');
        } catch (err) {
            console.error('Failed to load app limits:', err);
            
            // Try to load from backup
            const backupPath = filePath + '.backup';
            if (fs.existsSync(backupPath)) {
                try {
                    const backupContent = fs.readFileSync(backupPath, 'utf-8');
                    data = { ...DEFAULT_DATA, ...JSON.parse(backupContent) };
                    console.log('📋 App limits restored from backup');
                    save(); // Save to main file
                } catch (backupErr) {
                    console.error('Backup also failed:', backupErr);
                    data = { ...DEFAULT_DATA };
                }
            } else {
                data = { ...DEFAULT_DATA };
            }
        }
    } else {
        data = { ...DEFAULT_DATA };
        save();
        console.log('📋 App limits file created');
    }

    // Clean old daily state (keep only last 7 days)
    cleanOldDailyState();

    return true;
}

function save() {
    if (!filePath) return false;

    try {
        const jsonData = JSON.stringify(data, null, 2);
        
        // Ensure directory exists (in case it was deleted)
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        
        // Create backup of existing file before overwriting
        if (fs.existsSync(filePath)) {
            try {
                fs.copyFileSync(filePath, filePath + '.backup');
            } catch (backupErr) {
                // Backup failed, but continue with save
                console.warn('Failed to create backup:', backupErr.message);
            }
        }
        
        fs.writeFileSync(filePath, jsonData);
        return true;
    } catch (err) {
        console.error('Failed to save app limits:', err);
        return false;
    }
}

function cleanOldDailyState() {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 7);
    // Use local date to match getToday() and the rest of the app
    const cutoffStr = cutoff.toLocaleDateString('en-CA', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    });

    const oldDates = Object.keys(data.dailyState).filter(d => d < cutoffStr);
    oldDates.forEach(d => delete data.dailyState[d]);

    if (oldDates.length > 0) {
        save();
        console.log(`🧹 Cleaned ${oldDates.length} old daily states`);
    }
}

// --- Limit CRUD ---

function getAll() {
    return data?.limits || {};
}

/**
 * Get all limits with their effective values (base + extensions)
 * Used by the UI to show accurate limit info
 */
function getAllWithEffective() {
    const limits = data?.limits || {};
    const result = {};
    
    for (const [key, limit] of Object.entries(limits)) {
        const state = getDailyState(key);
        result[key] = {
            ...limit,
            // Daily state info
            addedMinutes: state.addedMinutes || 0,
            effectiveMinutes: limit.dailyMinutes + (state.addedMinutes || 0),
            triggered: state.triggered || false
        };
    }
    
    return result;
}

function get(appName) {
    const key = appName.toLowerCase();
    return data?.limits?.[key] || null;
}

function set(appName, dailyMinutes, mode = null, enabled = true) {
    if (!data) init();

    const key = appName.toLowerCase();
    const existingLimit = data.limits[key];
    const existingMode = existingLimit?.mode;
    
    // Check if the limit value actually changed
    const limitChanged = existingLimit && existingLimit.dailyMinutes !== dailyMinutes;

    data.limits[key] = {
        dailyMinutes: Math.max(1, dailyMinutes),
        mode: mode || existingMode || data.settings.defaultMode,
        enabled,
        displayName: appName,
        createdAt: existingLimit?.createdAt || Date.now(),
        updatedAt: Date.now()
    };

    // If user manually changed the limit, reset extensions for that app
    // This prevents confusion: old extensions shouldn't stack on new limit
    if (limitChanged) {
        const today = getToday(); // use local date to stay consistent with getDailyState()
        if (!data.dailyState) data.dailyState = {};
        if (!data.dailyState[today]) data.dailyState[today] = {};
        
        // Reset daily state for this app (clears extensions)
        data.dailyState[today][key] = {
            triggered: false,
            warningShown: false,
            addedMinutes: 0
        };
        console.log(`📋 Reset extensions for ${appName} (limit changed)`);
    }

    save();
    console.log(`📋 Limit set: ${appName} = ${dailyMinutes}m (${data.limits[key].mode})`);
    return data.limits[key];
}

function remove(appName) {
    if (!data) init();

    const key = appName.toLowerCase();
    if (data.limits[key]) {
        delete data.limits[key];
        save();
        console.log(`📋 Limit removed: ${appName}`);
        return true;
    }
    return false;
}

function toggle(appName, enabled) {
    if (!data) init();

    const key = appName.toLowerCase();
    if (data.limits[key]) {
        data.limits[key].enabled = enabled;
        save();
        return true;
    }
    return false;
}

function setMode(appName, mode) {
    if (!data) init();

    if (!Object.values(MODES).includes(mode)) {
        throw new Error(`Invalid mode: ${mode}`);
    }

    const key = appName.toLowerCase();
    if (data.limits[key]) {
        data.limits[key].mode = mode;
        data.limits[key].updatedAt = Date.now();
        save();
        console.log(`📋 Mode changed: ${appName} → ${mode}`);
        return true;
    }
    return false;
}

// --- Daily State ---

function getDailyState(appName) {
    // Ensure data is initialized
    if (!data) init();
    
    const today = getToday();
    const key = appName.toLowerCase();

    if (!data.dailyState) {
        data.dailyState = {};
    }

    if (!data.dailyState[today]) {
        data.dailyState[today] = {};
    }

    if (!data.dailyState[today][key]) {
        data.dailyState[today][key] = {
            addedMinutes: 0,
            triggered: false,
            lastWarning: null,
            warningsShown: [],
            extensionCount: 0  // persisted so restart doesn't reset used extensions
        };
    }

    // Back-fill field for records written before this field was added
    if (data.dailyState[today][key].extensionCount === undefined) {
        data.dailyState[today][key].extensionCount = 0;
    }

    return data.dailyState[today][key];
}

function addTime(appName, minutes) {
    if (!data) init();

    const state = getDailyState(appName);
    state.addedMinutes += minutes;
    state.triggered = false; // Reset triggered so they can use the app again
    save();

    console.log(`⏱️ Added ${minutes}m to ${appName} (total extra: ${state.addedMinutes}m)`);
    return state.addedMinutes;
}

function markTriggered(appName) {
    if (!data) init();

    const state = getDailyState(appName);
    // If already triggered, only update lastWarning timestamp — no disk write needed.
    // Without this guard, the enforcement loop calls save() (copyFileSync + writeFileSync)
    // every tracker tick (~1/sec) while an overlay is active, blocking IPC each time.
    if (state.triggered) {
        state.lastWarning = Date.now();
        return;
    }
    state.triggered = true;
    state.lastWarning = Date.now();
    save();
}

function markWarningShown(appName, threshold) {
    if (!data) init();

    const state = getDailyState(appName);
    if (!state.warningsShown.includes(threshold)) {
        state.warningsShown.push(threshold);
        save();
    }
}

function hasWarningBeenShown(appName, threshold) {
    const state = getDailyState(appName);
    return state.warningsShown.includes(threshold);
}

function getEffectiveLimit(appName) {
    const limit = get(appName);
    if (!limit || !limit.enabled) return null;

    const state = getDailyState(appName);
    return {
        ...limit,
        effectiveMinutes: limit.dailyMinutes + state.addedMinutes,
        addedMinutes: state.addedMinutes,
        triggered: state.triggered
    };
}

function isTriggered(appName) {
    const state = getDailyState(appName);
    return state.triggered;
}

// --- Settings ---

function getSettings() {
    return data?.settings || DEFAULT_DATA.settings;
}

function updateSettings(updates) {
    if (!data) init();

    data.settings = { ...data.settings, ...updates };
    save();
    return data.settings;
}

// --- Reset ---

function resetDailyState() {
    if (!data) init();

    const today = getToday();
    data.dailyState[today] = {};
    save();
    console.log('🔄 Daily limit state reset');
}

function resetAll() {
    data = { ...DEFAULT_DATA };
    save();
    console.log('🔄 All app limits reset');
}

// --- Extension count persistence ---
// Persisting extesion counts ensures that restarting the app does not refill
// the daily extension budget (users cannot bypass limits by force-quitting).

function getExtensionCount(appName) {
    const state = getDailyState(appName);
    return state.extensionCount || 0;
}

function incrementExtensionCount(appName) {
    const state = getDailyState(appName);
    state.extensionCount = (state.extensionCount || 0) + 1;
    save();
}

function resetExtensionCount(appName) {
    const state = getDailyState(appName);
    state.extensionCount = 0;
    save();
}

// --- Exports ---

module.exports = {
    MODES,
    init,
    getAll,
    getAllWithEffective,
    get,
    set,
    remove,
    toggle,
    setMode,
    getDailyState,
    addTime,
    markTriggered,
    markWarningShown,
    hasWarningBeenShown,
    getEffectiveLimit,
    isTriggered,
    getSettings,
    updateSettings,
    resetDailyState,
    resetAll,
    getExtensionCount,
    incrementExtensionCount,
    resetExtensionCount
};

