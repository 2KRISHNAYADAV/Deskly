/**
 * Vault Manager Service
 * 
 * Manages the user's data vault - an Obsidian-style folder structure
 * where all Deskly data lives in a user-visible location.
 * 
 * Vault Structure:
 * 📁 Deskly Vault/
 * ├── .deskly/                    (hidden config)
 * │   ├── config.json          (app settings)
 * │   ├── categories.json      (user categories)
 * │   ├── app-category-map.json
 * │   ├── goals-streaks.json   (daily goals & streak data)
 * │   ├── achievements.json    (unlocked achievements)
 * │   └── app-limits.json      (app time limits)
 * ├── data/
 * │   ├── 2026-01.json         (monthly usage)
 * │   └── websites/
 * │       └── 2026-01.json     (monthly website usage)
 * └── vault.json               (vault metadata)
 * 
 * RESILIENCE FEATURES:
 * - Auto-repair: Missing files are recreated with defaults
 * - JSON validation: Corrupted files are replaced with safe defaults
 * - Runtime health monitoring: Detect vault issues during operation
 * - Critical failure: If vault is beyond repair, it gets deleted and app shows onboarding
 */

const { app } = require('electron');
const Store = require('electron-store');
const fs = require('fs');
const path = require('path');

// Small store just for vault pointer (not user data)
const vaultPointer = new Store({ name: 'vault-pointer' });

// In-memory cache of vault path
let cachedVaultPath = null;

// Track vault health state
let vaultHealthy = true;
let lastHealthCheck = null;

// Default file contents for auto-repair
const VAULT_DEFAULTS = {
    'vault.json': {
        version: '1.0.0',
        createdAt: new Date().toISOString(),
        appName: 'Deskly',
        repairedAt: null
    },
    '.deskly/config.json': {
        theme: 'dark',
        startOnBoot: false,
        showInTray: true,
        idleTimeout: 5,
        dailyGoal: 480,
        breakReminder: true,
        breakInterval: 60,
    },
    '.deskly/categories.json': [],
    '.deskly/app-category-map.json': {},
    '.deskly/goals-streaks.json': {
        dailyGoal: 8,
        streakData: {
            currentStreak: 0,
            longestStreak: 0,
            lastHealthyDate: null,
            totalHealthyDays: 0
        }
    },
    '.deskly/achievements.json': {
        unlockedIds: [],
        dates: {}
    },
    '.deskly/app-limits.json': {
        limits: {},
        dailyState: {},
        settings: {
            defaultMode: 'warning',
            warningThresholds: [80, 100],
            addTimeOptions: [5, 10, 15]
        }
    }
};

// Critical files that MUST exist for app to function
const CRITICAL_FILES = [
    'vault.json',
    '.deskly/config.json'
];

// Files that should be auto-repaired if missing (non-critical but important)
const REPAIRABLE_FILES = [
    '.deskly/categories.json',
    '.deskly/app-category-map.json',
    '.deskly/goals-streaks.json',
    '.deskly/achievements.json',
    '.deskly/app-limits.json'
];

/**
 * Get the default vault location
 * Standardized for Deskly Academic Edition
 */
function getDefaultVaultPath() {
    return path.join(app.getPath('documents'), 'Deskly Academic Vault');
}

function recoverDefaultVaultPointer() {
    const defaultVaultPath = getDefaultVaultPath();
    const vaultMetadataPath = path.join(defaultVaultPath, 'vault.json');

    if (!fs.existsSync(vaultMetadataPath)) {
        return null;
    }

    vaultPointer.set('vaultPath', defaultVaultPath);
    cachedVaultPath = defaultVaultPath;
    return defaultVaultPath;
}

/**
 * Get the current vault path (cached for performance)
 */
function getVaultPath() {
    if (cachedVaultPath) return cachedVaultPath;

    cachedVaultPath = vaultPointer.get('vaultPath', null);
    if (!cachedVaultPath) {
        return recoverDefaultVaultPointer();
    }

    return cachedVaultPath;
}

/**
 * Safely parse JSON with validation
 * Returns { valid: boolean, data: any, error?: string }
 */
function safeParseJson(content, filePath) {
    try {
        if (!content || content.trim() === '') {
            return { valid: false, data: null, error: 'File is empty' };
        }
        
        const parsed = JSON.parse(content);
        
        // Basic type validation
        if (parsed === null || typeof parsed === 'undefined') {
            return { valid: false, data: null, error: 'Parsed to null/undefined' };
        }
        
        return { valid: true, data: parsed };
    } catch (err) {
        return { valid: false, data: null, error: `JSON parse error: ${err.message}` };
    }
}

/**
 * Check if a vault exists and is valid
 */
function vaultExists() {
    const vaultPath = getVaultPath();
    if (!vaultPath) return false;

    try {
        const vaultJsonPath = path.join(vaultPath, 'vault.json');
        return fs.existsSync(vaultJsonPath);
    } catch (err) {
        console.error('Error checking vault existence:', err);
        return false;
    }
}

/**
 * Check if this is a first run (no vault configured)
 */
function isFirstRun() {
    return !vaultExists();
}

// --- VAULT INTEGRITY & AUTO-REPAIR ---

/**
 * Check the integrity of a single JSON file
 * Returns { exists: boolean, valid: boolean, error?: string }
 */
function checkFileIntegrity(filePath) {
    try {
        if (!fs.existsSync(filePath)) {
            return { exists: false, valid: false, error: 'File does not exist' };
        }
        
        const content = fs.readFileSync(filePath, 'utf-8');
        const parseResult = safeParseJson(content, filePath);
        
        return { 
            exists: true, 
            valid: parseResult.valid, 
            error: parseResult.error 
        };
    } catch (err) {
        return { exists: false, valid: false, error: `Read error: ${err.message}` };
    }
}

/**
 * Repair a single vault file by restoring defaults
 * Returns true if repair succeeded
 */
function repairFile(relativeFilePath) {
    const vaultPath = getVaultPath();
    if (!vaultPath) return false;
    
    const fullPath = path.join(vaultPath, relativeFilePath);
    const defaultContent = VAULT_DEFAULTS[relativeFilePath];
    
    if (!defaultContent) {
        console.warn(`⚠️ No default content defined for: ${relativeFilePath}`);
        return false;
    }
    
    try {
        // Ensure directory exists
        const dir = path.dirname(fullPath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        
        // Write the default content
        const contentToWrite = typeof defaultContent === 'object' 
            ? JSON.stringify(defaultContent, null, 2)
            : defaultContent;
            
        fs.writeFileSync(fullPath, contentToWrite);
        console.log(`🔧 Repaired: ${relativeFilePath}`);
        return true;
    } catch (err) {
        console.error(`❌ Failed to repair ${relativeFilePath}:`, err);
        return false;
    }
}

/**
 * Comprehensive vault integrity check
 * Returns detailed status of all vault files and overall health
 */
function checkVaultIntegrity() {
    const vaultPath = getVaultPath();
    
    if (!vaultPath) {
        return { 
            healthy: false, 
            vaultExists: false,
            error: 'No vault path configured',
            files: {},
            needsOnboarding: true
        };
    }
    
    // Check if vault folder itself exists
    if (!fs.existsSync(vaultPath)) {
        return { 
            healthy: false, 
            vaultExists: false,
            error: 'Vault folder was deleted',
            vaultPath,
            files: {},
            needsOnboarding: true
        };
    }
    
    const result = {
        healthy: true,
        vaultExists: true,
        vaultPath,
        files: {},
        issues: [],
        criticalIssues: [],
        repairable: []
    };
    
    // Check critical files
    for (const file of CRITICAL_FILES) {
        const fullPath = path.join(vaultPath, file);
        const status = checkFileIntegrity(fullPath);
        result.files[file] = status;
        
        if (!status.exists || !status.valid) {
            result.criticalIssues.push({ file, ...status });
            result.healthy = false;
        }
    }
    
    // Check repairable files
    for (const file of REPAIRABLE_FILES) {
        const fullPath = path.join(vaultPath, file);
        const status = checkFileIntegrity(fullPath);
        result.files[file] = status;
        
        if (!status.exists || !status.valid) {
            result.issues.push({ file, ...status });
            result.repairable.push(file);
        }
    }
    
    // Check data directories exist
    const dataDir = path.join(vaultPath, 'data');
    const websiteDir = path.join(vaultPath, 'data', 'websites');
    
    if (!fs.existsSync(dataDir)) {
        result.issues.push({ file: 'data/', error: 'Data directory missing' });
        result.repairable.push('data/');
    }
    
    if (!fs.existsSync(websiteDir)) {
        result.issues.push({ file: 'data/websites/', error: 'Website data directory missing' });
        result.repairable.push('data/websites/');
    }
    
    lastHealthCheck = {
        timestamp: Date.now(),
        result
    };
    vaultHealthy = result.healthy;
    
    return result;
}

/**
 * Auto-repair the vault - fix all repairable issues
 * Returns { success: boolean, repaired: string[], failed: string[] }
 */
function autoRepairVault() {
    const vaultPath = getVaultPath();
    
    if (!vaultPath) {
        return { success: false, error: 'No vault configured', repaired: [], failed: [] };
    }
    
    console.log('🔧 Starting vault auto-repair...');
    
    const result = {
        success: true,
        repaired: [],
        failed: []
    };
    
    // First, ensure directories exist
    const dirs = [
        vaultPath,
        path.join(vaultPath, '.deskly'),
        path.join(vaultPath, 'data'),
        path.join(vaultPath, 'data', 'websites'),
        path.join(vaultPath, 'exports'),
    ];
    
    for (const dir of dirs) {
        try {
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
                console.log(`📁 Created directory: ${dir}`);
            }
        } catch (err) {
            console.error(`Failed to create directory ${dir}:`, err);
            result.failed.push(dir);
            result.success = false;
        }
    }
    
    // Check and repair all vault files
    const allFiles = [...CRITICAL_FILES, ...REPAIRABLE_FILES];
    
    for (const file of allFiles) {
        const fullPath = path.join(vaultPath, file);
        const status = checkFileIntegrity(fullPath);
        
        if (!status.exists || !status.valid) {
            console.log(`🔍 Issue found: ${file} - ${status.error}`);
            
            if (repairFile(file)) {
                result.repaired.push(file);
            } else {
                result.failed.push(file);
                // Critical file failure = overall failure
                if (CRITICAL_FILES.includes(file)) {
                    result.success = false;
                }
            }
        }
    }
    
    // Re-check vault health after repairs
    const healthCheck = checkVaultIntegrity();
    vaultHealthy = healthCheck.healthy;
    
    console.log(`✅ Vault repair complete. Repaired: ${result.repaired.length}, Failed: ${result.failed.length}`);
    
    return result;
}

/**
 * Handle a completely deleted vault situation
 * This is called when the vault folder is gone entirely
 * Returns true if vault was successfully recreated
 */
function handleDeletedVault() {
    const vaultPath = getVaultPath();
    
    if (!vaultPath) {
        console.log('No vault was ever configured');
        return false;
    }
    
    console.log('⚠️ Vault folder was deleted, attempting recovery...');
    
    // Try to recreate the vault structure
    try {
        createVaultStructure(vaultPath);
        
        // Update vault.json to indicate this is a recovered vault
        const vaultMeta = {
            version: '1.0.0',
            createdAt: new Date().toISOString(),
            appName: 'Deskly',
            recoveredAt: new Date().toISOString(),
            note: 'Vault was auto-recovered after deletion. Previous data may have been lost.'
        };
        fs.writeFileSync(
            path.join(vaultPath, 'vault.json'),
            JSON.stringify(vaultMeta, null, 2)
        );
        
        console.log('✅ Vault recovered successfully');
        return true;
    } catch (err) {
        console.error('❌ Failed to recover vault:', err);
        return false;
    }
}

/**
 * Get vault health status (cached)
 */
function getVaultHealth() {
    // Return cached result if recent (within 60 seconds)
    if (lastHealthCheck && (Date.now() - lastHealthCheck.timestamp < 60000)) {
        return lastHealthCheck.result;
    }
    
    return checkVaultIntegrity();
}

/**
 * Check if vault is currently healthy
 */
function isVaultHealthy() {
    return vaultHealthy;
}

// --- END VAULT INTEGRITY ---

/**
 * Create the vault folder structure
 */
function createVaultStructure(vaultPath) {
    console.log('Creating vault structure at:', vaultPath);

    // Create directories
    const dirs = [
        vaultPath,
        path.join(vaultPath, '.deskly'),
        path.join(vaultPath, 'data'),
        path.join(vaultPath, 'data', 'websites'),
        path.join(vaultPath, 'exports'),
    ];

    for (const dir of dirs) {
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
    }

    // Create vault.json metadata
    const vaultMeta = {
        version: '1.0.0',
        createdAt: new Date().toISOString(),
        appName: 'Deskly',
    };
    fs.writeFileSync(
        path.join(vaultPath, 'vault.json'),
        JSON.stringify(vaultMeta, null, 2)
    );

    // Create default config
    const defaultConfig = {
        theme: 'dark',
        startOnBoot: false,
        showInTray: true,
        idleTimeout: 5,
        dailyGoal: 480,
        breakReminder: true,
        breakInterval: 60,
    };
    fs.writeFileSync(
        path.join(vaultPath, '.deskly', 'config.json'),
        JSON.stringify(defaultConfig, null, 2)
    );

    // Create default categories
    const defaultCategories = [];
    fs.writeFileSync(
        path.join(vaultPath, '.deskly', 'categories.json'),
        JSON.stringify(defaultCategories, null, 2)
    );

    // Create app category map
    const defaultAppCategoryMap = {};
    fs.writeFileSync(
        path.join(vaultPath, '.deskly', 'app-category-map.json'),
        JSON.stringify(defaultAppCategoryMap, null, 2)
    );

    // Create goals and streaks data
    const defaultGoalsData = {
        dailyGoal: 8,
        streakData: {
            currentStreak: 0,
            longestStreak: 0,
            lastHealthyDate: null,
            totalHealthyDays: 0
        }
    };
    fs.writeFileSync(
        path.join(vaultPath, '.deskly', 'goals-streaks.json'),
        JSON.stringify(defaultGoalsData, null, 2)
    );

    // Create achievements data
    const defaultAchievements = {
        unlockedIds: [],
        dates: {}
    };
    fs.writeFileSync(
        path.join(vaultPath, '.deskly', 'achievements.json'),
        JSON.stringify(defaultAchievements, null, 2)
    );

    console.log('✅ Vault structure created successfully');
    return true;
}

/**
 * Initialize vault at given path
 */
function initializeVault(vaultPath) {
    try {
        // Create structure
        createVaultStructure(vaultPath);

        // Save vault path pointer
        vaultPointer.set('vaultPath', vaultPath);
        cachedVaultPath = vaultPath;

        console.log('✅ Vault initialized at:', vaultPath);
        return { success: true, path: vaultPath };
    } catch (err) {
        console.error('Failed to initialize vault:', err);
        return { success: false, error: err.message };
    }
}

// --- Path Getters ---

function getConfigPath() {
    const vaultPath = getVaultPath();
    if (!vaultPath) return null;
    return path.join(vaultPath, '.deskly', 'config.json');
}

function getCategoriesPath() {
    const vaultPath = getVaultPath();
    if (!vaultPath) return null;
    return path.join(vaultPath, '.deskly', 'categories.json');
}

function getAppCategoryMapPath() {
    const vaultPath = getVaultPath();
    if (!vaultPath) return null;
    return path.join(vaultPath, '.deskly', 'app-category-map.json');
}

function getMonthlyDataPath(yearMonth) {
    const vaultPath = getVaultPath();
    if (!vaultPath) return null;
    // yearMonth format: "2026-01"
    return path.join(vaultPath, 'data', `${yearMonth}.json`);
}

function getMonthlyWebsiteDataPath(yearMonth) {
    const vaultPath = getVaultPath();
    if (!vaultPath) return null;
    return path.join(vaultPath, 'data', 'websites', `${yearMonth}.json`);
}

function getExportsPath() {
    const vaultPath = getVaultPath();
    if (!vaultPath) return null;
    return path.join(vaultPath, 'exports');
}

// --- File Operations ---

/**
 * Read and parse a JSON file with validation and auto-repair
 * If file is corrupted/gibberish, it will be replaced with defaultValue
 * 
 * Options:
 * - autoRepair: boolean (default: true) - auto-repair corrupted files
 * - logErrors: boolean (default: true) - log errors to console
 */
function readJsonFile(filePath, defaultValue = {}, options = {}) {
    const { autoRepair = true, logErrors = true } = options;
    
    try {
        // File doesn't exist - return default
        if (!fs.existsSync(filePath)) {
            return defaultValue;
        }
        
        const content = fs.readFileSync(filePath, 'utf-8');
        
        // Empty file - treat as default
        if (!content || content.trim() === '') {
            if (logErrors) {
                console.warn(`⚠️ Empty file detected: ${filePath}`);
            }
            if (autoRepair) {
                writeJsonFile(filePath, defaultValue);
                console.log(`🔧 Auto-repaired empty file: ${filePath}`);
            }
            return defaultValue;
        }
        
        // Try to parse JSON
        const parseResult = safeParseJson(content, filePath);
        
        if (!parseResult.valid) {
            // File contains invalid/corrupted JSON (gibberish)
            if (logErrors) {
                console.error(`❌ Corrupted JSON in ${filePath}: ${parseResult.error}`);
            }
            
            if (autoRepair) {
                // Backup corrupted file before overwriting
                try {
                    const backupPath = filePath + '.corrupted.' + Date.now();
                    fs.writeFileSync(backupPath, content);
                    console.log(`📦 Backed up corrupted file to: ${backupPath}`);
                } catch (backupErr) {
                    console.warn('Failed to backup corrupted file:', backupErr.message);
                }
                
                // Write default value
                writeJsonFile(filePath, defaultValue);
                console.log(`🔧 Auto-repaired corrupted file: ${filePath}`);
            }
            
            return defaultValue;
        }
        
        return parseResult.data;
    } catch (err) {
        if (logErrors) {
            console.error('Error reading JSON file:', filePath, err);
        }
        return defaultValue;
    }
}

/**
 * Safely read a JSON file without auto-repair (for checking only)
 */
function readJsonFileRaw(filePath) {
    try {
        if (!fs.existsSync(filePath)) {
            return { exists: false, content: null, data: null };
        }
        
        const content = fs.readFileSync(filePath, 'utf-8');
        const parseResult = safeParseJson(content, filePath);
        
        return {
            exists: true,
            content,
            data: parseResult.valid ? parseResult.data : null,
            valid: parseResult.valid,
            error: parseResult.error
        };
    } catch (err) {
        return { exists: false, content: null, data: null, error: err.message };
    }
}

function writeJsonFile(filePath, data) {
    try {
        // Ensure directory exists
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }

        // Atomic write: write to temp file first, then rename.
        // This minimizes the chance of leaving a partially-written JSON file on crash.
        const tempFile = `${filePath}.tmp-${process.pid}-${Date.now()}`;
        fs.writeFileSync(tempFile, JSON.stringify(data, null, 2), 'utf8');
        fs.renameSync(tempFile, filePath);
        return true;
    } catch (err) {
        console.error('Error writing JSON file:', filePath, err);
        return false;
    }
}

// --- Migration ---

/**
 * Check if there's old electron-store data to migrate
 */
function hasLegacyData() {
    const legacyStore = new Store({ name: 'wellbeing-data' });
    const dailySummary = legacyStore.get('dailySummary', {});
    return Object.keys(dailySummary).length > 0;
}

/**
 * Migrate data from electron-store to vault
 */
function migrateLegacyData(vaultPath) {
    console.log('Migrating legacy data to vault...');

    try {
        const legacyStore = new Store({ name: 'wellbeing-data' });

        // Migrate settings
        const legacySettings = legacyStore.get('settings', {});
        const configPath = path.join(vaultPath, '.deskly', 'config.json');
        const existingConfig = readJsonFile(configPath, {});
        writeJsonFile(configPath, { ...existingConfig, ...legacySettings });

        // Migrate daily summary (group by month)
        const dailySummary = legacyStore.get('dailySummary', {});
        const monthlyData = {};

        for (const [date, data] of Object.entries(dailySummary)) {
            const yearMonth = date.substring(0, 7); // "2026-01-22" → "2026-01"
            if (!monthlyData[yearMonth]) {
                monthlyData[yearMonth] = {};
            }
            monthlyData[yearMonth][date] = data;
        }

        // Write monthly files
        for (const [yearMonth, data] of Object.entries(monthlyData)) {
            const monthPath = path.join(vaultPath, 'data', `${yearMonth}.json`);
            writeJsonFile(monthPath, data);
        }

        // Migrate website usage (group by month)
        const websiteUsage = legacyStore.get('websiteUsage', {});
        const monthlyWebsiteData = {};

        for (const [date, data] of Object.entries(websiteUsage)) {
            const yearMonth = date.substring(0, 7);
            if (!monthlyWebsiteData[yearMonth]) {
                monthlyWebsiteData[yearMonth] = {};
            }
            monthlyWebsiteData[yearMonth][date] = data;
        }

        // Write monthly website files
        for (const [yearMonth, data] of Object.entries(monthlyWebsiteData)) {
            const monthPath = path.join(vaultPath, 'data', 'websites', `${yearMonth}.json`);
            writeJsonFile(monthPath, data);
        }

        // Migrate categories
        const appCategories = legacyStore.get('appCategories', {});
        writeJsonFile(path.join(vaultPath, '.deskly', 'categories.json'), appCategories);

        // Migrate app category map
        const appCategoryMap = legacyStore.get('appCategoryMap', {});
        writeJsonFile(path.join(vaultPath, '.deskly', 'app-category-map.json'), appCategoryMap);

        console.log('✅ Legacy data migration complete');
        return { success: true };
    } catch (err) {
        console.error('Migration failed:', err);
        return { success: false, error: err.message };
    }
}

// --- Current Month Helper ---

function getCurrentYearMonth() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    return `${year}-${month}`;
}

/**
 * NUCLEAR RESET - Clear ALL vault data files
 * This is the most thorough reset possible
 */
function clearAllVaultData() {
    const vaultPath = getVaultPath();
    if (!vaultPath) {
        console.log('⚠️ No vault path found');
        return false;
    }

    console.log('🔥 NUCLEAR RESET: Clearing all vault data...');

    try {
        // Clear all monthly data files
        const dataDir = path.join(vaultPath, 'data');
        if (fs.existsSync(dataDir)) {
            const files = fs.readdirSync(dataDir);
            for (const file of files) {
                const filePath = path.join(dataDir, file);
                if (file.endsWith('.json')) {
                    fs.writeFileSync(filePath, '{}');
                    console.log(`  ✓ Cleared: ${file}`);
                }
            }
        }

        // Clear all monthly website data files
        const websiteDir = path.join(vaultPath, 'data', 'websites');
        if (fs.existsSync(websiteDir)) {
            const files = fs.readdirSync(websiteDir);
            for (const file of files) {
                const filePath = path.join(websiteDir, file);
                if (file.endsWith('.json')) {
                    fs.writeFileSync(filePath, '{}');
                    console.log(`  ✓ Cleared: websites/${file}`);
                }
            }
        }

        // Reset categories (but keep the file structure)
        const categoriesPath = path.join(vaultPath, '.deskly', 'categories.json');
        if (fs.existsSync(categoriesPath)) {
            fs.writeFileSync(categoriesPath, '[]');
            console.log('  ✓ Cleared: categories.json');
        }

        // Reset app category map
        const appMapPath = path.join(vaultPath, '.deskly', 'app-category-map.json');
        if (fs.existsSync(appMapPath)) {
            fs.writeFileSync(appMapPath, '{}');
            console.log('  ✓ Cleared: app-category-map.json');
        }

        // Reset goals and streaks
        const goalsPath = path.join(vaultPath, '.deskly', 'goals-streaks.json');
        if (fs.existsSync(goalsPath)) {
            const defaultGoals = {
                dailyGoal: 8,
                streakData: {
                    currentStreak: 0,
                    longestStreak: 0,
                    lastHealthyDate: null,
                    totalHealthyDays: 0
                }
            };
            fs.writeFileSync(goalsPath, JSON.stringify(defaultGoals, null, 2));
            console.log('  ✓ Reset: goals-streaks.json');
        }

        // Reset achievements
        const achievementsPath = path.join(vaultPath, '.deskly', 'achievements.json');
        if (fs.existsSync(achievementsPath)) {
            const defaultAchievements = { unlockedIds: [], dates: {} };
            fs.writeFileSync(achievementsPath, JSON.stringify(defaultAchievements, null, 2));
            console.log('  ✓ Reset: achievements.json');
        }

        // Reset app limits
        const limitsPath = path.join(vaultPath, '.deskly', 'app-limits.json');
        if (fs.existsSync(limitsPath)) {
            const defaultLimits = {
                limits: {},
                dailyState: {},
                settings: {
                    defaultMode: 'warning',
                    warningThresholds: [80, 100],
                    addTimeOptions: [5, 10, 15]
                }
            };
            fs.writeFileSync(limitsPath, JSON.stringify(defaultLimits, null, 2));
            console.log('  ✓ Reset: app-limits.json');
        }

        console.log('✅ NUCLEAR RESET COMPLETE');
        return true;
    } catch (err) {
        console.error('❌ Nuclear reset failed:', err);
        return false;
    }
}

/**
 * ULTIMATE NUKE - Delete the entire vault and clear pointer
 * This is the last resort when vault is completely corrupted
 * After this, app will show onboarding to create a fresh vault
 */
function nukeVault() {
    const vaultPath = getVaultPath();
    
    console.log('💣 NUKING VAULT - Complete destruction...');
    
    try {
        // Delete the entire vault folder
        if (vaultPath && fs.existsSync(vaultPath)) {
            fs.rmSync(vaultPath, { recursive: true, force: true });
            console.log('  ✓ Vault folder deleted:', vaultPath);
        }
        
        // Clear the vault pointer
        vaultPointer.delete('vaultPath');
        cachedVaultPath = null;
        vaultHealthy = false;
        lastHealthCheck = null;
        
        console.log('  ✓ Vault pointer cleared');
        console.log('💣 VAULT NUKED - App will show onboarding on restart');
        
        return { success: true, message: 'Vault completely destroyed. Restart app to create fresh vault.' };
    } catch (err) {
        console.error('❌ Failed to nuke vault:', err);
        return { success: false, error: err.message };
    }
}

module.exports = {
    getDefaultVaultPath,
    getVaultPath,
    vaultExists,
    isFirstRun,
    initializeVault,
    createVaultStructure,
    // Path getters
    getConfigPath,
    getCategoriesPath,
    getAppCategoryMapPath,
    getMonthlyDataPath,
    getMonthlyWebsiteDataPath,
    getExportsPath,
    // File operations
    readJsonFile,
    readJsonFileRaw,
    writeJsonFile,
    // Migration
    hasLegacyData,
    migrateLegacyData,
    // Helpers
    getCurrentYearMonth,
    // Reset
    clearAllVaultData,
    nukeVault,
    // Vault integrity & health
    checkVaultIntegrity,
    autoRepairVault,
    handleDeletedVault,
    getVaultHealth,
    isVaultHealthy,
    safeParseJson,
    VAULT_DEFAULTS,
    CRITICAL_FILES,
    REPAIRABLE_FILES,
};


