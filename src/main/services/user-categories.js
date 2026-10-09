/**
 * User Categories Service
 *
 * VAULT-ONLY STORAGE
 * All category data is stored in the vault.
 *
 * This module also exposes lightweight "smart" helpers for
 * suggesting categories for apps. The suggestion logic is:
 * - 100% local (no network)
 * - Heuristic / rule-based for now
 * - Designed so we can later plug in ML models without
 *   changing the public API surface.
 */

const { getDailySummary, getToday } = require('../database/db');

// Vault manager - loaded lazily to avoid circular deps
let vaultManager = null;
function getVaultManager() {
    if (!vaultManager) {
        try {
            vaultManager = require('./vault-manager');
        } catch (e) {
            console.warn('[Categories] Vault manager not available');
        }
    }
    return vaultManager;
}

// Default category colors
const CATEGORY_COLORS = [
    '#4CAF50', // Green
    '#2196F3', // Blue
    '#FF9800', // Orange
    '#E91E63', // Pink
    '#9C27B0', // Purple
    '#00BCD4', // Cyan
    '#FF5722', // Deep Orange
    '#607D8B', // Blue Grey
];

// Helper to normalize the dataset (handle legacy vs new structure)
function getUsageData(summary) {
    if (!summary) return {};
    return summary.aggregates || summary;
}

// System keys to skip during iteration
const SKIPPED_KEYS = ['unlockCount', 'sessions', 'aggregates'];

// ============================================
// AI/ML-READY CATEGORY SUGGESTION HELPERS
// ============================================

// Canonical "intent" labels we use to loosely describe
// what a category or app is about. This is intentionally
// simple; think of it as a vocabulary we can later map
// an ML model onto.
const INTENT_LABELS = {
    DEVELOPMENT: 'development',
    PRODUCTIVITY: 'productivity',
    COMMUNICATION: 'communication',
    ENTERTAINMENT: 'entertainment',
    BROWSING: 'browsing',
    UTILITIES: 'utilities',
    GENERIC_WORK: 'work',
};

// Map category names → intent labels using simple
// keyword rules. This is our current "AI" brain for
// understanding what a user-created category might mean.
const CATEGORY_NAME_RULES = [
    {
        intent: INTENT_LABELS.DEVELOPMENT,
        keywords: ['dev', 'code', 'coding', 'programming', 'engineering', 'developer'],
    },
    {
        intent: INTENT_LABELS.PRODUCTIVITY,
        keywords: ['productivity', 'study', 'studies', 'school', 'college', 'notes', 'focus'],
    },
    {
        intent: INTENT_LABELS.COMMUNICATION,
        keywords: ['chat', 'communication', 'messages', 'social', 'friends'],
    },
    {
        intent: INTENT_LABELS.ENTERTAINMENT,
        keywords: ['entertainment', 'fun', 'games', 'gaming', 'music', 'video', 'movies'],
    },
    {
        intent: INTENT_LABELS.BROWSING,
        keywords: ['browsing', 'browser', 'web', 'internet'],
    },
    {
        intent: INTENT_LABELS.UTILITIES,
        keywords: ['utilities', 'tools', 'system'],
    },
    {
        intent: INTENT_LABELS.GENERIC_WORK,
        keywords: ['work', 'office', 'job', 'career'],
    },
];

// Map app names → intent labels using heuristics.
// This starts as a curated ruleset but can later be
// learned from data by a local ML model.
const APP_NAME_RULES = [
    {
        intent: INTENT_LABELS.DEVELOPMENT,
        keywords: ['code', 'vscode', 'visual studio', 'android studio', 'intellij', 'pycharm', 'webstorm', 'rider', 'xcode', 'sublime', 'atom', 'cursor', 'git', 'github desktop', 'terminal', 'cmd', 'powershell', 'bash', 'zsh', 'postman', 'docker', 'wsl'],
    },
    {
        intent: INTENT_LABELS.PRODUCTIVITY,
        keywords: ['notion', 'obsidian', 'todoist', 'slite', 'onenote', 'excel', 'word', 'powerpoint', 'outlook', 'calendar', 'notes', 'reminder', 'notepad', 'notepad++', 'evernote', 'trello', 'asana', 'clickup'],
    },
    {
        intent: INTENT_LABELS.COMMUNICATION,
        keywords: ['discord', 'whatsapp', 'telegram', 'signal', 'slack', 'teams', 'zoom', 'meet', 'skype', 'messenger', 'hangouts', 'mail', 'gmail'],
    },
    {
        intent: INTENT_LABELS.ENTERTAINMENT,
        keywords: ['spotify', 'vlc', 'netflix', 'prime video', 'twitch', 'hotstar', 'youtube music', 'music', 'player', 'media', 'video', 'movie', 'game', 'gaming', 'steam', 'epic'],
    },
    {
        intent: INTENT_LABELS.BROWSING,
        keywords: ['chrome', 'brave', 'firefox', 'edge', 'opera', 'vivaldi', 'browser', 'safari', 'chromium'],
    },
    {
        intent: INTENT_LABELS.UTILITIES,
        keywords: ['explorer', 'settings', 'snipping tool', 'calculator', 'task manager', 'control panel', 'file manager', 'winrar', '7zip', 'ccleaner'],
    },
];

function normalizeString(value) {
    return (value || '').toString().toLowerCase();
}

function inferIntentFromName(name, rules) {
    const normalized = normalizeString(name);
    if (!normalized) return null;

    for (const rule of rules) {
        if (rule.keywords.some((kw) => normalized.includes(kw))) {
            return rule.intent;
        }
    }
    return null;
}

function inferCategoryIntent(category) {
    if (!category || !category.name) return null;
    // Hard-code uncategorized to keep it out of "smart" matches
    if (category.id === 'uncategorized') return null;
    return inferIntentFromName(category.name, CATEGORY_NAME_RULES);
}

function inferAppIntent(appName) {
    return inferIntentFromName(appName, APP_NAME_RULES);
}


// ============================================
// VAULT STORAGE HELPERS
// ============================================

function getCategoriesFromVault() {
    const vm = getVaultManager();
    if (!vm || !vm.vaultExists()) return [];
    
    const vaultPath = vm.getVaultPath();
    const path = require('path');
    const filePath = path.join(vaultPath, '.deskly', 'categories.json');
    return vm.readJsonFile(filePath, []);
}

function saveCategoriesToVault(categories) {
    const vm = getVaultManager();
    if (!vm || !vm.vaultExists()) return false;
    
    const vaultPath = vm.getVaultPath();
    const path = require('path');
    const filePath = path.join(vaultPath, '.deskly', 'categories.json');
    return vm.writeJsonFile(filePath, categories);
}

function getAppMapFromVault() {
    const vm = getVaultManager();
    if (!vm || !vm.vaultExists()) return {};
    
    const vaultPath = vm.getVaultPath();
    const path = require('path');
    const filePath = path.join(vaultPath, '.deskly', 'app-category-map.json');
    return vm.readJsonFile(filePath, {});
}

function saveAppMapToVault(appMap) {
    const vm = getVaultManager();
    if (!vm || !vm.vaultExists()) return false;
    
    const vaultPath = vm.getVaultPath();
    const path = require('path');
    const filePath = path.join(vaultPath, '.deskly', 'app-category-map.json');
    return vm.writeJsonFile(filePath, appMap);
}

// ============================================
// CATEGORY OPERATIONS (vault-only)
// ============================================

// Get all user categories
function getCategories() {
    let categories = getCategoriesFromVault();

    // Initialize with defaults if empty
    if (!Array.isArray(categories) || categories.length === 0) {
        categories = [
            { id: 'uncategorized', name: 'Uncategorized', color: '#607D8B', icon: '📁' }
        ];
        saveCategoriesToVault(categories);
    }

    return categories;
}

// Create a new category
function createCategory(name, color, icon = '📁') {
    const categories = getCategories();

    // Generate unique ID
    const id = name.toLowerCase().replace(/[^a-z0-9]/g, '-') + '-' + Date.now();

    const newCategory = {
        id,
        name,
        color: color || CATEGORY_COLORS[categories.length % CATEGORY_COLORS.length],
        icon,
        createdAt: new Date().toISOString()
    };

    categories.push(newCategory);
    saveCategoriesToVault(categories);

    return newCategory;
}

// Update a category
function updateCategory(id, updates) {
    const categories = getCategories();
    const index = categories.findIndex(c => c.id === id);

    if (index === -1) return null;

    // Don't allow editing "uncategorized"
    if (id === 'uncategorized' && updates.name) {
        delete updates.name;
    }

    categories[index] = { ...categories[index], ...updates };
    saveCategoriesToVault(categories);

    return categories[index];
}

// Delete a category
function deleteCategory(id) {
    // Don't allow deleting "uncategorized"
    if (id === 'uncategorized') return false;

    const categories = getCategories();
    const filtered = categories.filter(c => c.id !== id);
    saveCategoriesToVault(filtered);

    // Move all apps from deleted category to uncategorized
    let appMap = getAppMapFromVault();
    for (const [app, catId] of Object.entries(appMap)) {
        if (catId === id) {
            appMap[app] = 'uncategorized';
        }
    }
    saveAppMapToVault(appMap);

    return true;
}

// Assign an app to a category
function assignAppToCategory(appName, categoryId) {
    let appMap = getAppMapFromVault();
    appMap[appName] = categoryId;
    saveAppMapToVault(appMap);
    return true;
}

// Get category for an app
function getAppCategoryId(appName) {
    const appMap = getAppMapFromVault() || store.get('appCategoryMap', {});
    return appMap[appName] || 'uncategorized';
}

// Get all app-to-category mappings
function getAppCategoryMap() {
    return getAppMapFromVault() || store.get('appCategoryMap', {});
}

// Get category NAME for an app (not just ID)
function getAppCategoryName(appName) {
    const appMap = getAppMapFromVault() || store.get('appCategoryMap', {});
    const categoryId = appMap[appName] || 'uncategorized';
    const categories = getCategories();
    const category = categories.find(c => c.id === categoryId);
    return category ? category.name : 'Uncategorized';
}

// Get full category map with names (for UI display)
function getAppCategoryMapWithNames() {
    const appMap = getAppMapFromVault() || store.get('appCategoryMap', {});
    const categories = getCategories();
    const result = {};
    for (const [appName, categoryId] of Object.entries(appMap)) {
        const category = categories.find(c => c.id === categoryId);
        result[appName] = {
            id: categoryId,
            name: category ? category.name : 'Uncategorized'
        };
    }
    return result;
}

// Get category stats (total time per category) - NOW USES VAULT
function getCategoryStats() {
    const categories = getCategories();
    const appMap = getAppMapFromVault() || store.get('appCategoryMap', {});

    // Get today's data from vault via getDailySummary
    const today = getToday();
    const todaySummary = getDailySummary(today);
    const dataset = getUsageData(todaySummary);

    // Initialize stats
    const stats = {};
    for (const cat of categories) {
        stats[cat.id] = {
            id: cat.id,
            name: cat.name,
            color: cat.color,
            icon: cat.icon,
            totalSeconds: 0,
            apps: []
        };
    }

    // Aggregate by category
    for (const [appName, appData] of Object.entries(dataset)) {
        // Skip system keys
        if (SKIPPED_KEYS.includes(appName)) continue;
        if (!appData || typeof appData.totalSeconds !== 'number') continue;

        const categoryId = appMap[appName] || 'uncategorized';
        if (!stats[categoryId]) {
            stats[categoryId] = {
                id: categoryId,
                name: 'Uncategorized',
                color: '#607D8B',
                icon: '📁',
                totalSeconds: 0,
                apps: []
            };
        }
        stats[categoryId].totalSeconds += appData.totalSeconds || 0;
        stats[categoryId].apps.push({
            name: appName,
            seconds: appData.totalSeconds || 0
        });
    }

    // Sort apps within each category
    for (const cat of Object.values(stats)) {
        cat.apps.sort((a, b) => b.seconds - a.seconds);
    }

    // Sort by time descending
    return Object.values(stats)
        .filter(s => s.totalSeconds > 0 || s.apps.length > 0)
        .sort((a, b) => b.totalSeconds - a.totalSeconds);
}

// Get all apps grouped by category - NOW USES VAULT
function getAppsByCategory() {
    const categories = getCategories();
    const appMap = getAppMapFromVault() || store.get('appCategoryMap', {});

    // Collect all apps from last 7 days via getDailySummary
    const allApps = new Map(); // appName -> { totalSeconds, lastSeen }

    for (let i = 0; i < 7; i++) {
        const date = new Date();
        date.setDate(date.getDate() - i);
        const dateStr = date.toISOString().split('T')[0];
        
        const summary = getDailySummary(dateStr);
        const dataset = getUsageData(summary);

        for (const [appName, data] of Object.entries(dataset)) {
            if (SKIPPED_KEYS.includes(appName)) continue;
            if (!data) continue;

            const existing = allApps.get(appName) || { totalSeconds: 0, lastSeen: dateStr };
            existing.totalSeconds += data.totalSeconds || 0;
            if (i === 0) existing.lastSeen = dateStr;
            allApps.set(appName, existing);
        }
    }

    // Group by category
    const grouped = {};
    for (const cat of categories) {
        grouped[cat.id] = {
            id: cat.id,
            name: cat.name,
            color: cat.color,
            icon: cat.icon,
            apps: []
        };
    }

    // Ensure uncategorized exists
    if (!grouped['uncategorized']) {
        grouped['uncategorized'] = {
            id: 'uncategorized',
            name: 'Uncategorized',
            color: '#607D8B',
            icon: '📁',
            apps: []
        };
    }

    for (const [appName, data] of allApps.entries()) {
        const categoryId = appMap[appName] || 'uncategorized';
        const target = grouped[categoryId] || grouped['uncategorized'];
        
        target.apps.push({
            name: appName,
            totalSeconds: data.totalSeconds,
            lastSeen: data.lastSeen
        });
    }

    // Sort apps by time within each category
    for (const group of Object.values(grouped)) {
        group.apps.sort((a, b) => b.totalSeconds - a.totalSeconds);
    }

    return Object.values(grouped).sort((a, b) => {
        if (a.id === 'uncategorized') return 1;
        if (b.id === 'uncategorized') return -1;
        return b.apps.length - a.apps.length;
    });
}

// ==========================================
// WEBSITE CATEGORY FUNCTIONS
// ==========================================

// Assign a website to a category
function assignWebsiteToCategory(websiteId, categoryId) {
    const websiteMap = store.get('websiteCategoryMap', {});
    websiteMap[websiteId] = categoryId;
    store.set('websiteCategoryMap', websiteMap);
    return true;
}

// Get category for a website
function getWebsiteCategoryId(websiteId) {
    const websiteMap = store.get('websiteCategoryMap', {});
    return websiteMap[websiteId] || 'uncategorized';
}

// Get all website-to-category mappings
function getWebsiteCategoryMap() {
    return store.get('websiteCategoryMap', {});
}

// Get websites grouped by category with usage stats
function getWebsitesByCategory() {
    const categories = getCategories();
    const websiteMap = store.get('websiteCategoryMap', {});
    const websiteData = store.get('websiteUsage', {});

    // Get today's date
    const now = new Date();
    const today = now.toLocaleDateString('en-CA', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    });
    const todayData = websiteData[today] || { websites: {} };

    // Get all unique website IDs from recent data
    const allWebsites = new Set();
    for (const [date, dayData] of Object.entries(websiteData)) {
        if (dayData.websites) {
            for (const websiteId of Object.keys(dayData.websites)) {
                allWebsites.add(websiteId);
            }
        }
    }

    // Group by category
    const grouped = {};
    for (const cat of categories) {
        grouped[cat.id] = {
            ...cat,
            websites: []
        };
    }

    for (const websiteId of allWebsites) {
        const categoryId = websiteMap[websiteId] || 'uncategorized';
        if (!grouped[categoryId]) {
            grouped[categoryId] = {
                id: 'uncategorized',
                name: 'Uncategorized',
                color: '#607D8B',
                icon: '📁',
                websites: []
            };
        }

        // Get website details from today's data if available
        const websiteInfo = todayData.websites[websiteId] || {};
        grouped[categoryId].websites.push({
            id: websiteId,
            name: websiteInfo.name || websiteId.replace(/-/g, '.'),
            seconds: websiteInfo.seconds || 0,
            browser: websiteInfo.browser || ''
        });
    }

    return Object.values(grouped);
}

// Get website category stats (total time per category from websites)
function getWebsiteCategoryStats() {
    const categories = getCategories();
    const websiteMap = store.get('websiteCategoryMap', {});
    const websiteData = store.get('websiteUsage', {});

    // Get today's date
    const now = new Date();
    const today = now.toLocaleDateString('en-CA', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    });
    const todayData = websiteData[today] || { websites: {} };

    // Initialize stats
    const stats = {};
    for (const cat of categories) {
        stats[cat.id] = {
            id: cat.id,
            name: cat.name,
            color: cat.color,
            icon: cat.icon,
            totalSeconds: 0,
            websites: []
        };
    }

    // Aggregate by category
    for (const [websiteId, websiteInfo] of Object.entries(todayData.websites || {})) {
        const categoryId = websiteMap[websiteId] || 'uncategorized';
        if (!stats[categoryId]) {
            stats[categoryId] = {
                id: categoryId,
                name: 'Uncategorized',
                color: '#607D8B',
                icon: '📁',
                totalSeconds: 0,
                websites: []
            };
        }
        stats[categoryId].totalSeconds += websiteInfo.seconds || 0;
        stats[categoryId].websites.push({
            id: websiteId,
            name: websiteInfo.name || websiteId.replace(/-/g, '.'),
            seconds: websiteInfo.seconds || 0
        });
    }

    // Sort by time descending
    return Object.values(stats)
        .filter(s => s.totalSeconds > 0 || s.websites.length > 0)
        .sort((a, b) => b.totalSeconds - a.totalSeconds);
}

// =====================================
// BROWSER CATEGORIES (Completely Separate System)
// =====================================

// Get all browser categories (separate from app categories)
function getBrowserCategories() {
    const categories = store.get('browserCategories', []);

    // If no categories exist, create default "Uncategorized"
    if (categories.length === 0) {
        const defaults = [
            { id: 'uncategorized', name: 'Uncategorized', color: '#607D8B', icon: '🌐' }
        ];
        store.set('browserCategories', defaults);
        return defaults;
    }

    return categories;
}

// Create a new browser category
function createBrowserCategory(name, color, icon = '🌐') {
    const categories = getBrowserCategories();

    // Generate unique ID
    const id = 'browser-' + name.toLowerCase().replace(/[^a-z0-9]/g, '-') + '-' + Date.now();

    const newCategory = {
        id,
        name,
        color: color || CATEGORY_COLORS[categories.length % CATEGORY_COLORS.length],
        icon,
        createdAt: new Date().toISOString()
    };

    categories.push(newCategory);
    store.set('browserCategories', categories);

    return newCategory;
}

// Update a browser category
function updateBrowserCategory(id, updates) {
    const categories = getBrowserCategories();
    const index = categories.findIndex(c => c.id === id);

    if (index === -1) return null;

    // Don't allow editing "uncategorized"
    if (id === 'uncategorized' && updates.name) {
        delete updates.name;
    }

    categories[index] = { ...categories[index], ...updates };
    store.set('browserCategories', categories);

    return categories[index];
}

// Delete a browser category
function deleteBrowserCategory(id) {
    // Don't allow deleting "uncategorized"
    if (id === 'uncategorized') return false;

    const categories = getBrowserCategories();
    const filtered = categories.filter(c => c.id !== id);
    store.set('browserCategories', filtered);

    // Move all websites from deleted category to uncategorized
    const websiteMap = store.get('websiteCategoryMap', {});
    for (const [website, catId] of Object.entries(websiteMap)) {
        if (catId === id) {
            websiteMap[website] = 'uncategorized';
        }
    }
    store.set('websiteCategoryMap', websiteMap);

    return true;
}

// Get websites grouped by browser category
function getWebsitesByBrowserCategory() {
    const categories = getBrowserCategories();
    const websiteMap = store.get('websiteCategoryMap', {});

    // Get today's usage from browser-intelligence
    let todayUsage = { websites: [] };
    try {
        const browserIntelligence = require('./browser-intelligence');
        todayUsage = browserIntelligence.getTodayWebsiteUsage() || { websites: [] };
    } catch (e) {
        console.error('Failed to get browser usage:', e);
    }

    // Create a map of website usage
    const usageMap = {};
    (todayUsage.websites || []).forEach(w => {
        usageMap[w.id] = w;
    });

    // Group by category
    const grouped = {};
    categories.forEach(cat => {
        grouped[cat.id] = {
            id: cat.id,
            name: cat.name,
            color: cat.color,
            icon: cat.icon,
            websites: [],
            totalSeconds: 0
        };
    });

    // Ensure uncategorized exists
    if (!grouped['uncategorized']) {
        grouped['uncategorized'] = {
            id: 'uncategorized',
            name: 'Uncategorized',
            color: '#607D8B',
            icon: '🌐',
            websites: [],
            totalSeconds: 0
        };
    }

    // Get all unique websites from usage
    const allWebsites = new Set(Object.keys(usageMap));
    Object.keys(websiteMap).forEach(w => allWebsites.add(w));

    for (const websiteId of allWebsites) {
        const categoryId = websiteMap[websiteId] || 'uncategorized';
        const usage = usageMap[websiteId] || { seconds: 0 };

        if (!grouped[categoryId]) {
            grouped[categoryId] = grouped['uncategorized'];
        }

        grouped[categoryId].websites.push({
            id: websiteId,
            name: usage.name || websiteId.replace(/-/g, '.'),
            seconds: usage.seconds || 0,
            browser: usage.browser
        });
        grouped[categoryId].totalSeconds += usage.seconds || 0;
    }

    return Object.values(grouped);
}

module.exports = {
    CATEGORY_COLORS,
    INTENT_LABELS,
    inferAppIntent,
    inferCategoryIntent,
    // App category functions
    getCategories,
    createCategory,
    updateCategory,
    deleteCategory,
    assignAppToCategory,
    getAppCategoryId,
    getAppCategoryMap,
    getAppCategoryName,
    getAppCategoryMapWithNames,
    getCategoryStats,
    getAppsByCategory,
    // Website category mapping (uses browser categories)
    assignWebsiteToCategory,
    getWebsiteCategoryId,
    getWebsiteCategoryMap,
    getWebsitesByCategory,
    getWebsiteCategoryStats,
    // Browser categories (separate system)
    getBrowserCategories,
    createBrowserCategory,
    updateBrowserCategory,
    deleteBrowserCategory,
    getWebsitesByBrowserCategory,
    // AI/ML-ready helpers
    // NOTE: This is intentionally simple and synchronous so it can run
    // on every "Move App" click without any performance concerns.
    getSuggestedCategoriesForApp(appName) {
        const categories = getCategories();
        const appMap = getAppMapFromVault();

        const currentCategoryId = appMap[appName] || 'uncategorized';
        const appIntent = inferAppIntent(appName);

        // Pre-compute intent per category
        const categoryIntents = {};
        for (const cat of categories) {
            categoryIntents[cat.id] = inferCategoryIntent(cat);
        }

        const suggestions = [];

        // Find current category
        const currentCategory = categories.find((c) => c.id === currentCategoryId) || {
            id: 'uncategorized',
            name: 'Uncategorized',
        };

        // ONLY suggest categories if we can infer a real intent for the app
        // Don't fake suggestions by dumping all categories
        if (appIntent) {
            for (const cat of categories) {
                if (cat.id === 'uncategorized') continue; // Never suggest uncategorized
                if (categoryIntents[cat.id] === appIntent) {
                    suggestions.push({
                        categoryId: cat.id,
                        categoryName: cat.name,
                        reason: 'intent-keyword-match',
                        confidence: 0.9,
                    });
                }
            }
        }

        // If no intent match but app is already in a non-uncategorized category,
        // that's probably correct - don't suggest moving it
        // If app is in uncategorized and we have no suggestions, return empty
        // (the UI will just show "Select a category" without fake suggestions)

        return {
            appName,
            appIntent: appIntent || null, // Include for debugging/UI
            suggestions,
        };
    },
};

