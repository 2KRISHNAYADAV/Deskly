/**
 * Database Layer
 * 
 * VAULT-ONLY STORAGE
 * All data is stored in the user's vault folder.
 * No electron-store fallback - if vault is broken, app shows onboarding.
 */

const path = require('path');
const fs = require('fs');
const { app } = require('electron');

// Vault Manager - THE ONLY storage system
let vaultManager = null;

// In-memory caches
let cachedSummary = null;
let cachedWebsiteUsage = null;
let cachedConfig = null;       // settings / config.json in-memory mirror
let cachedAppCategories = null; // app-category-map.json in-memory mirror
let loadedYearMonth = null;    // which month is currently in cachedSummary/cachedWebsiteUsage
let hasChanges = false;
let flushInterval = null;

function initDatabase() {
    console.log('Initializing database...');

    // Load vault manager - this is the ONLY storage system
    vaultManager = require('../services/vault-manager');
    
    if (!vaultManager.vaultExists()) {
        // No vault = app cannot function. Main.js should have caught this.
        console.error('❌ CRITICAL: No vault exists! App should show onboarding.');
        cachedSummary = {};
        cachedWebsiteUsage = {};
        cachedConfig = null;
        cachedAppCategories = null;
        return null;
    }
    
    console.log('📂 Using Vault storage at:', vaultManager.getVaultPath());
    
    // Load current month's data from vault
    const yearMonth = getCurrentYearMonth();
    const monthlyDataPath = vaultManager.getMonthlyDataPath(yearMonth);
    const monthlyWebsitePath = vaultManager.getMonthlyWebsiteDataPath(yearMonth);

    console.log('[DB] Loading vault data for month:', yearMonth);

    cachedSummary = vaultManager.readJsonFile(monthlyDataPath, {});
    cachedWebsiteUsage = vaultManager.readJsonFile(monthlyWebsitePath, {});
    loadedYearMonth = yearMonth;

    // Prime settings and category caches on startup (single disk read each)
    cachedConfig = vaultManager.readJsonFile(vaultManager.getConfigPath(), {});
    const mapPath = vaultManager.getAppCategoryMapPath ? vaultManager.getAppCategoryMapPath() : null;
    cachedAppCategories = mapPath ? vaultManager.readJsonFile(mapPath, {}) : {};


    // Setup periodic flush (every 30 seconds)
    // 30s limits the data-loss window from unexpected crashes to at most half a minute,
    // while still being cheap (only writes when hasChanges is true).
    if (flushInterval) clearInterval(flushInterval);
    flushInterval = setInterval(flushData, 30 * 1000);

    // Ensure data is saved on exit
    app.on('before-quit', () => {
        console.log('App closing, flushing database...');
        flushData();
    });

    console.log('Database initialized at:', vaultManager.getVaultPath());
    return true;
}

// Helper to get current year-month
function getCurrentYearMonth() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    return `${year}-${month}`;
}

// Helper to get year-month from date string
function getYearMonthFromDate(dateStr) {
    return dateStr.substring(0, 7); // "2026-01-22" → "2026-01"
}

function flushData() {
    if (!vaultManager || !vaultManager.vaultExists()) return;

    const yearMonth = getCurrentYearMonth();

    // ── Month rollover: flush old month, load new month ──────────────────
    if (loadedYearMonth && loadedYearMonth !== yearMonth) {
        console.log(`📅 Month rollover detected: ${loadedYearMonth} → ${yearMonth}. Rotating cache.`);

        // Flush old month first
        if (hasChanges) {
            try {
                const oldDataPath = vaultManager.getMonthlyDataPath(loadedYearMonth);
                const oldWebPath = vaultManager.getMonthlyWebsiteDataPath(loadedYearMonth);
                if (cachedSummary)      vaultManager.writeJsonFile(oldDataPath, cachedSummary);
                if (cachedWebsiteUsage) vaultManager.writeJsonFile(oldWebPath, cachedWebsiteUsage);
            } catch (err) {
                console.error('Failed to flush old month data:', err);
            }
        }

        // Load (empty) new month
        const newDataPath = vaultManager.getMonthlyDataPath(yearMonth);
        const newWebPath  = vaultManager.getMonthlyWebsiteDataPath(yearMonth);
        cachedSummary      = vaultManager.readJsonFile(newDataPath, {});
        cachedWebsiteUsage = vaultManager.readJsonFile(newWebPath, {});
        loadedYearMonth    = yearMonth;
        hasChanges         = false;
        return;
    }

    if (hasChanges) {
        try {
            const monthlyDataPath = vaultManager.getMonthlyDataPath(yearMonth);
            const monthlyWebsitePath = vaultManager.getMonthlyWebsiteDataPath(yearMonth);

            if (cachedSummary) {
                vaultManager.writeJsonFile(monthlyDataPath, cachedSummary);
            }
            if (cachedWebsiteUsage) {
                vaultManager.writeJsonFile(monthlyWebsitePath, cachedWebsiteUsage);
            }

            console.log('💾 Database flushed to vault');
            hasChanges = false;
        } catch (err) {
            console.error('Failed to flush database:', err);
        }
    }
}

function getDatabase() {
    // Legacy function - returns null, vault is the only storage
    return null;
}

// Helper functions for database operations
function getToday() {
    // Return local date in YYYY-MM-DD format
    const now = new Date();
    return now.toLocaleDateString('en-CA', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    });
}

function getSetting(key) {
    if (!vaultManager || !vaultManager.vaultExists()) return null;
    if (!cachedConfig) {
        cachedConfig = vaultManager.readJsonFile(vaultManager.getConfigPath(), {});
    }
    return cachedConfig[key];
}

function setSetting(key, value) {
    if (!vaultManager || !vaultManager.vaultExists()) return;
    if (!cachedConfig) {
        cachedConfig = vaultManager.readJsonFile(vaultManager.getConfigPath(), {});
    }
    cachedConfig[key] = value;
    // Write-through: persist immediately so other processes / restarts see the change
    vaultManager.writeJsonFile(vaultManager.getConfigPath(), cachedConfig);
}

function getAllSettings() {
    if (!vaultManager || !vaultManager.vaultExists()) return {};
    if (!cachedConfig) {
        cachedConfig = vaultManager.readJsonFile(vaultManager.getConfigPath(), {});
    }
    return { ...cachedConfig }; // Return a shallow copy to prevent external mutation
}

function getDailySummary(date) {
    // Check memory cache first
    if (cachedSummary && cachedSummary[date]) {
        return cachedSummary[date];
    }

    // Read from vault
    if (vaultManager && vaultManager.vaultExists()) {
        const yearMonth = getYearMonthFromDate(date);
        const monthlyDataPath = vaultManager.getMonthlyDataPath(yearMonth);
        
        try {
            const monthData = vaultManager.readJsonFile(monthlyDataPath, {});
            
            if (monthData[date]) {
                if (!cachedSummary) cachedSummary = {};
                cachedSummary[date] = monthData[date];
                return monthData[date];
            }
        } catch (err) {
            console.log(`Failed to read vault data for ${date}:`, err.message);
        }
    }

    return {};
}

function updateAppUsage(date, appName, seconds, category) {
    if (!cachedSummary) {
        cachedSummary = {};
    }

    if (!cachedSummary[date]) {
        cachedSummary[date] = { sessions: [], aggregates: {} };
    }

    // Update aggregates structure
    if (cachedSummary[date].aggregates) {
        if (!cachedSummary[date].aggregates[appName]) {
            cachedSummary[date].aggregates[appName] = {
                totalSeconds: 0,
                category: category || 'Uncategorized'
            };
        }
        cachedSummary[date].aggregates[appName].totalSeconds += seconds;

        if (category) {
            cachedSummary[date].aggregates[appName].category = category;
        }
    } else {
        // Old structure fallback
        if (!cachedSummary[date][appName]) {
            cachedSummary[date][appName] = {
                totalSeconds: 0,
                category: category || 'Uncategorized'
            };
        }
        cachedSummary[date][appName].totalSeconds += seconds;

        if (category) {
            cachedSummary[date][appName].category = category;
        }
    }

    hasChanges = true;
}

// ═══════════════════════════════════════════════════════════════════════════
// ⚠️  CRITICAL: logSession() - READ BEFORE MODIFYING!
// This function ONLY logs the session object to the sessions array.
// ❌ DO NOT update aggregates here! That causes DOUBLE COUNTING!
// ═══════════════════════════════════════════════════════════════════════════
function logSession(session) {
    if (!cachedSummary) {
        cachedSummary = {};
    }
    const date = getToday();

    if (!cachedSummary[date]) {
        cachedSummary[date] = { sessions: [], aggregates: {} };
    }

    if (!cachedSummary[date].sessions) {
        cachedSummary[date].sessions = [];
    }

    cachedSummary[date].sessions.push(session);
    hasChanges = true;
}

function getSessions(date) {
    const summary = getDailySummary(date);
    return summary.sessions || [];
}

function incrementUnlockCount(date) {
    if (!cachedSummary) {
        cachedSummary = {};
    }

    if (!cachedSummary[date]) {
        cachedSummary[date] = {};
    }

    if (!cachedSummary[date].unlockCount) {
        cachedSummary[date].unlockCount = 0;
    }

    cachedSummary[date].unlockCount += 1;
    hasChanges = true;

    console.log(`🔓 Unlock recorded! Total today: ${cachedSummary[date].unlockCount}`);
    return cachedSummary[date].unlockCount;
}

function getUnlockCount(date) {
    if (cachedSummary && cachedSummary[date]) {
        return cachedSummary[date].unlockCount || 0;
    }
    
    // Try to read from vault
    const summary = getDailySummary(date);
    return summary.unlockCount || 0;
}

function getWebsiteUsage() {
    if (cachedWebsiteUsage) return cachedWebsiteUsage;
    
    // Load from vault for current month
    if (vaultManager && vaultManager.vaultExists()) {
        const yearMonth = getCurrentYearMonth();
        const monthlyWebsitePath = vaultManager.getMonthlyWebsiteDataPath(yearMonth);
        cachedWebsiteUsage = vaultManager.readJsonFile(monthlyWebsitePath, {});
    } else {
        cachedWebsiteUsage = {};
    }
    
    return cachedWebsiteUsage;
}

function updateWebsiteUsage(websiteData) {
    cachedWebsiteUsage = websiteData;
    hasChanges = true;
}

function getAppCategory(appName) {
    // Use in-memory cache — populated on initDatabase() and invalidated by invalidateAppCategoryCache()
    if (!vaultManager || !vaultManager.vaultExists()) return 'Uncategorized';
    if (!cachedAppCategories) {
        const mapPath = vaultManager.getAppCategoryMapPath ? vaultManager.getAppCategoryMapPath() : null;
        cachedAppCategories = mapPath ? vaultManager.readJsonFile(mapPath, {}) : {};
    }
    return cachedAppCategories[appName] || 'Uncategorized';
}

/** Call this after any operation that writes to the app-category-map so the cache refreshes. */
function invalidateAppCategoryCache() {
    cachedAppCategories = null;
}

function getAppDisplayName(appName) {
    const builtInNames = {
        'electron': 'Deskly',
        'deskly': 'Deskly',
        'antigravity': 'Cursor AI',
        'code': 'VS Code',
        'brave': 'Brave Browser',
        'chrome': 'Google Chrome',
        'firefox': 'Firefox',
        'msedge': 'Microsoft Edge',
        'slack': 'Slack',
        'discord': 'Discord',
        'spotify': 'Spotify',
        'notepad': 'Notepad',
        'explorer': 'File Explorer',
        'windowsterminal': 'Windows Terminal',
    };

    const lowerName = appName.toLowerCase();
    return builtInNames[lowerName] || appName;
}

function resetAllData() {
    console.log('🔥 RESETTING ALL TRACKING DATA...');
    
    // Clear in-memory cache
    cachedSummary = {};
    cachedWebsiteUsage = {};
    hasChanges = false;
    
    // Nuclear reset vault
    if (vaultManager && vaultManager.vaultExists()) {
        vaultManager.clearAllVaultData();
    }
    
    console.log('✅ ALL DATA RESET COMPLETE!');
    return true;
}

function getAllData() {
    if (!vaultManager || !vaultManager.vaultExists()) {
        return { settings: {}, dailySummary: {} };
    }
    
    const configPath = vaultManager.getConfigPath();
    return {
        settings: vaultManager.readJsonFile(configPath, {}),
        dailySummary: cachedSummary || {},
    };
}

function clearActivityData() {
    cachedSummary = {};
    cachedWebsiteUsage = {};
    hasChanges = false;
    
    // Clear vault data files
    if (vaultManager && vaultManager.vaultExists()) {
        vaultManager.clearAllVaultData();
    }
    
    console.log('💥 Activity data cleared!');
    return true;
}

module.exports = {
    initDatabase,
    getDatabase,
    getSetting,
    setSetting,
    getDailySummary,
    updateAppUsage,
    getAppCategory,
    getAppDisplayName,
    getAllSettings,
    getToday,
    getAllData,
    clearActivityData,
    incrementUnlockCount,
    getUnlockCount,
    getWebsiteUsage,
    updateWebsiteUsage,
    logSession,
    getSessions,
    resetAllData,
    invalidateAppCategoryCache,
    flushData,
};
