/**
 * Polish Service
 * 
 * Handles achievements, data export, and auto-start functionality.
 * 
 * UPDATED: Now uses vault storage for achievements
 * Falls back to electron-store for backwards compatibility
 */

const Store = require('electron-store');
const { app, dialog } = require('electron');
const fs = require('fs');
const path = require('path');

// Fallback store
const store = new Store({ name: 'wellbeing-data' });

// Vault manager - loaded lazily
let vaultManager = null;
function getVaultManager() {
    if (!vaultManager) {
        try {
            vaultManager = require('./vault-manager');
        } catch (e) {
            console.warn('[Polish] Vault manager not available');
        }
    }
    return vaultManager;
}

// ============================================
// VAULT STORAGE HELPERS
// ============================================

function getAchievementsDataPath() {
    const vm = getVaultManager();
    if (!vm || !vm.vaultExists()) return null;
    const vaultPath = vm.getVaultPath();
    return path.join(vaultPath, '.deskly', 'achievements.json');
}

function getAchievementsFromVault() {
    const vm = getVaultManager();
    if (!vm || !vm.vaultExists()) return null;
    const filePath = getAchievementsDataPath();
    if (!filePath) return null;
    return vm.readJsonFile(filePath, null);
}

function saveAchievementsToVault(data) {
    const vm = getVaultManager();
    if (!vm || !vm.vaultExists()) return false;
    const filePath = getAchievementsDataPath();
    if (!filePath) return false;
    return vm.writeJsonFile(filePath, data);
}

// Get goals-streaks data from vault or fallback
function getGoalsStreaksData() {
    const vm = getVaultManager();
    if (vm && vm.vaultExists()) {
        const vaultPath = vm.getVaultPath();
        const goalsPath = path.join(vaultPath, '.deskly', 'goals-streaks.json');
        const data = vm.readJsonFile(goalsPath, null);
        if (data) return data;
    }
    // Fallback to store
    return {
        dailyGoal: store.get('dailyGoal', 8),
        streakData: store.get('streakData', { currentStreak: 0 })
    };
}

// Get app limits data from vault or fallback
function getAppLimitsData() {
    const vm = getVaultManager();
    if (vm && vm.vaultExists()) {
        const vaultPath = vm.getVaultPath();
        const limitsPath = path.join(vaultPath, '.deskly', 'app-limits.json');
        const data = vm.readJsonFile(limitsPath, null);
        if (data && data.limits) return data.limits;
    }
    // Fallback to store
    return store.get('appLimits', {});
}

// All possible achievements
const ALL_ACHIEVEMENTS = [
    // Streak achievements
    { id: 'first_day', title: 'First Step', icon: '🌟', description: 'Complete your first healthy day', category: 'streak', target: 1 },
    { id: 'three_day', title: 'Hat Trick', icon: '🎩', description: '3-day healthy streak', category: 'streak', target: 3 },
    { id: 'week_streak', title: 'Weekly Warrior', icon: '🏆', description: '7-day healthy streak', category: 'streak', target: 7 },
    { id: 'two_week', title: 'Fortnight Fighter', icon: '⚔️', description: '14-day healthy streak', category: 'streak', target: 14 },
    { id: 'month_streak', title: 'Monthly Master', icon: '👑', description: '30-day healthy streak', category: 'streak', target: 30 },

    // Productivity achievements
    { id: 'productive_day', title: 'Productive Day', icon: '📈', description: 'Score 80+ productivity', category: 'productivity', target: 80 },
    { id: 'productivity_week', title: 'Productive Week', icon: '🚀', description: '5 days with 70+ productivity', category: 'productivity', target: 5 },

    // Usage achievements
    { id: 'early_bird', title: 'Early Bird', icon: '🐦', description: 'Use app before 7 AM', category: 'usage', target: 1 },
    { id: 'limit_setter', title: 'Boundary Builder', icon: '🚧', description: 'Set your first app limit', category: 'usage', target: 1 },
    { id: 'goal_setter', title: 'Goal Getter', icon: '🎯', description: 'Set a daily screen time goal', category: 'usage', target: 1 },
];

// Get user's achievements with unlock status
function getAllAchievements() {
    // Try to get data from vault first
    const vaultAchievements = getAchievementsFromVault() || {};
    const unlockedIds = vaultAchievements.unlockedIds || store.get('unlockedAchievements', []);
    const achievementDates = vaultAchievements.dates || {};
    
    // Get streak data from vault or store
    const goalsData = getGoalsStreaksData();
    const streakData = goalsData.streakData || { currentStreak: 0 };
    const dailyGoal = goalsData.dailyGoal;
    
    // Get app limits from vault or store
    const appLimits = getAppLimitsData();

    return ALL_ACHIEVEMENTS.map(achievement => {
        let unlocked = unlockedIds.includes(achievement.id);
        let progress = 0;

        // Calculate progress for each achievement type
        switch (achievement.category) {
            case 'streak':
                progress = Math.min(100, Math.round((streakData.currentStreak / achievement.target) * 100));
                unlocked = streakData.currentStreak >= achievement.target;
                break;
            case 'usage':
                if (achievement.id === 'limit_setter') {
                    unlocked = Object.keys(appLimits).length > 0;
                    progress = unlocked ? 100 : 0;
                } else if (achievement.id === 'goal_setter') {
                    unlocked = dailyGoal !== undefined;
                    progress = unlocked ? 100 : 0;
                }
                break;
        }

        return {
            ...achievement,
            unlocked,
            progress,
            unlockedAt: unlocked ? (achievementDates[achievement.id] || store.get(`achievement_${achievement.id}_date`) || null) : null
        };
    });
}

// Unlock an achievement
function unlockAchievement(achievementId) {
    // Get current data from vault or store
    let vaultAchievements = getAchievementsFromVault() || { unlockedIds: [], dates: {} };
    const unlockedIds = vaultAchievements.unlockedIds || [];
    
    if (!unlockedIds.includes(achievementId)) {
        unlockedIds.push(achievementId);
        const unlockDate = new Date().toISOString();
        
        // Update vault
        vaultAchievements.unlockedIds = unlockedIds;
        vaultAchievements.dates = vaultAchievements.dates || {};
        vaultAchievements.dates[achievementId] = unlockDate;
        saveAchievementsToVault(vaultAchievements);
        
        // Also update store for backwards compatibility
        store.set('unlockedAchievements', unlockedIds);
        store.set(`achievement_${achievementId}_date`, unlockDate);
        
        console.log(`🏅 Achievement unlocked: ${achievementId}`);
        return true;
    }
    return false;
}

// Get achievement stats
function getAchievementStats() {
    const achievements = getAllAchievements();
    const unlocked = achievements.filter(a => a.unlocked).length;
    const total = achievements.length;

    return {
        unlocked,
        total,
        percentage: Math.round((unlocked / total) * 100),
        recentUnlocks: achievements
            .filter(a => a.unlocked && a.unlockedAt)
            .sort((a, b) => new Date(b.unlockedAt) - new Date(a.unlockedAt))
            .slice(0, 3)
    };
}

// Export data functions - reads from vault
async function exportToJSON(mainWindow) {
    const { getDailySummary } = require('../database/db');
    const vm = getVaultManager();
    
    // Get data from vault or fallback
    let dailySummary = {};
    if (vm && vm.vaultExists()) {
        // Read all monthly files from vault for complete export
        const vaultPath = vm.getVaultPath();
        const dataDir = path.join(vaultPath, 'data');
        if (fs.existsSync(dataDir)) {
            const files = fs.readdirSync(dataDir).filter(f => f.endsWith('.json'));
            for (const file of files) {
                const monthData = vm.readJsonFile(path.join(dataDir, file), {});
                Object.assign(dailySummary, monthData);
            }
        }
    } else {
        dailySummary = store.get('dailySummary', {});
    }
    
    const goalsData = getGoalsStreaksData();
    const appLimits = getAppLimitsData();
    
    const settings = {
        dailyGoal: goalsData.dailyGoal || 8,
        appLimits: appLimits,
    };
    const streakData = goalsData.streakData || {};
    const achievements = getAllAchievements().filter(a => a.unlocked);

    const exportData = {
        exportedAt: new Date().toISOString(),
        appVersion: app.getVersion(),
        data: {
            dailySummary,
            settings,
            streakData,
            achievements
        }
    };

    const { filePath } = await dialog.showSaveDialog(mainWindow, {
        title: 'Export Data as JSON',
        defaultPath: `deskly-export-${new Date().toISOString().split('T')[0]}.json`,
        filters: [{ name: 'JSON Files', extensions: ['json'] }]
    });

    if (filePath) {
        await fs.promises.writeFile(filePath, JSON.stringify(exportData, null, 2));
        console.log('📦 Data exported to JSON:', filePath);
        return { success: true, path: filePath };
    }

    return { success: false, cancelled: true };
}

async function exportToCSV(mainWindow) {
    const vm = getVaultManager();
    
    // Get data from vault or fallback
    let dailySummary = {};
    if (vm && vm.vaultExists()) {
        const vaultPath = vm.getVaultPath();
        const dataDir = path.join(vaultPath, 'data');
        if (fs.existsSync(dataDir)) {
            const files = fs.readdirSync(dataDir).filter(f => f.endsWith('.json'));
            for (const file of files) {
                const monthData = vm.readJsonFile(path.join(dataDir, file), {});
                Object.assign(dailySummary, monthData);
            }
        }
    } else {
        dailySummary = store.get('dailySummary', {});
    }

    // Create CSV content
    let csv = 'Date,App,Category,Duration (seconds),Duration (formatted)\n';

    Object.entries(dailySummary).forEach(([date, dayData]) => {
        // Handle both old structure (dayData.apps) and new structure (dayData.aggregates)
        const apps = dayData.aggregates || dayData.apps || dayData;
        if (apps && typeof apps === 'object') {
            Object.entries(apps).forEach(([appName, appData]) => {
                // Skip system keys
                if (['unlockCount', 'sessions', 'aggregates'].includes(appName)) return;
                if (!appData || typeof appData !== 'object') return;
                
                const seconds = appData.totalSeconds || appData.seconds || 0;
                if (seconds <= 0) return;
                
                const hours = Math.floor(seconds / 3600);
                const mins = Math.floor((seconds % 3600) / 60);
                const formatted = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
                csv += `"${date}","${appName}","${appData.category || 'Other'}",${seconds},"${formatted}"\n`;
            });
        }
    });

    const { filePath } = await dialog.showSaveDialog(mainWindow, {
        title: 'Export Data as CSV',
        defaultPath: `deskly-export-${new Date().toISOString().split('T')[0]}.csv`,
        filters: [{ name: 'CSV Files', extensions: ['csv'] }]
    });

    if (filePath) {
        await fs.promises.writeFile(filePath, csv);
        console.log('📊 Data exported to CSV:', filePath);
        return { success: true, path: filePath };
    }

    return { success: false, cancelled: true };
}

// Auto-start functions
function getAutoStartEnabled() {
    return app.getLoginItemSettings().openAtLogin;
}

function setAutoStart(enabled) {
    app.setLoginItemSettings({
        openAtLogin: enabled,
        openAsHidden: true // Start minimized to tray
    });
    console.log(`🚀 Auto-start ${enabled ? 'enabled' : 'disabled'}`);
    return enabled;
}

module.exports = {
    ALL_ACHIEVEMENTS,
    getAllAchievements,
    unlockAchievement,
    getAchievementStats,
    exportToJSON,
    exportToCSV,
    getAutoStartEnabled,
    setAutoStart,
};


