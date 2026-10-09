/**
 * Smart Features Service
 * 
 * DEPRECATED: Use user-categories.js instead!
 * This file is kept for backwards compatibility only.
 * 
 * UPDATED: Now uses vault storage via vault-manager
 * Falls back to electron-store for backwards compatibility
 */

const Store = require('electron-store');
const path = require('path');

// Fallback store
const store = new Store({ name: 'wellbeing-data' });

// Vault manager - loaded lazily to avoid circular deps
let vaultManager = null;
function getVaultManager() {
    if (!vaultManager) {
        try {
            vaultManager = require('./vault-manager');
        } catch (e) {
            console.warn('[SmartFeatures] Vault manager not available');
        }
    }
    return vaultManager;
}

// VAULT STORAGE HELPERS
function getCustomCategoriesPath() {
    const vm = getVaultManager();
    if (!vm || !vm.vaultExists()) return null;
    const vaultPath = vm.getVaultPath();
    return path.join(vaultPath, '.deskly', 'custom-categories-legacy.json');
}

function getCustomCategoriesFromVault() {
    const vm = getVaultManager();
    if (!vm || !vm.vaultExists()) return null;
    const filePath = getCustomCategoriesPath();
    if (!filePath) return null;
    return vm.readJsonFile(filePath, null);
}

function saveCustomCategoriesToVault(data) {
    const vm = getVaultManager();
    if (!vm || !vm.vaultExists()) return false;
    const filePath = getCustomCategoriesPath();
    if (!filePath) return false;
    return vm.writeJsonFile(filePath, data);
}

// Custom categories for apps (DEPRECATED - use user-categories.js)
function getCustomCategories() {
    // Try vault first
    const vaultData = getCustomCategoriesFromVault();
    if (vaultData !== null) {
        return vaultData;
    }
    // Fallback to store
    return store.get('customCategories', {});
}

function setAppCategory(appName, category) {
    const categories = getCustomCategories();
    categories[appName.toLowerCase()] = category;
    
    // Save to vault
    saveCustomCategoriesToVault(categories);
    // Save to store for backwards compatibility
    store.set('customCategories', categories);
    
    console.log(`🏷️ Set ${appName} category to ${category}`);
    return categories;
}

function removeAppCategory(appName) {
    const categories = getCustomCategories();
    delete categories[appName.toLowerCase()];
    
    // Save to vault
    saveCustomCategoriesToVault(categories);
    // Save to store
    store.set('customCategories', categories);
    
    return categories;
}

function getAppCategory(appName) {
    const categories = getCustomCategories();
    return categories[appName.toLowerCase()] || null;
}

module.exports = {
    getCustomCategories,
    setAppCategory,
    removeAppCategory,
    getAppCategory,
};

