/**
 * Goals & Streaks Service
 * 
 * UPDATED: Now uses vault storage via vault-manager
 * Falls back to electron-store for backwards compatibility
 */

const Store = require('electron-store');
const path = require('path');
const { getToday, getDailySummary } = require('../database/db');

// Fallback store for non-vault storage
const store = new Store({ name: 'wellbeing-data' });

// Vault manager - loaded lazily to avoid circular deps
let vaultManager = null;
function getVaultManager() {
    if (!vaultManager) {
        try {
            vaultManager = require('./vault-manager');
        } catch (e) {
            console.warn('[GoalsStreaks] Vault manager not available');
        }
    }
    return vaultManager;
}

// ============================================
// VAULT STORAGE HELPERS
// ============================================

function getGoalsDataPath() {
    const vm = getVaultManager();
    if (!vm || !vm.vaultExists()) return null;
    const vaultPath = vm.getVaultPath();
    return path.join(vaultPath, '.deskly', 'goals-streaks.json');
}

function getGoalsDataFromVault() {
    const vm = getVaultManager();
    if (!vm || !vm.vaultExists()) return null;
    const filePath = getGoalsDataPath();
    if (!filePath) return null;
    return vm.readJsonFile(filePath, null);
}

function saveGoalsDataToVault(data) {
    const vm = getVaultManager();
    if (!vm || !vm.vaultExists()) return false;
    const filePath = getGoalsDataPath();
    if (!filePath) return false;
    return vm.writeJsonFile(filePath, data);
}

// Default data structure
const DEFAULT_GOALS_DATA = {
    dailyGoal: 8,
    streakData: {
        currentStreak: 0,
        longestStreak: 0,
        lastHealthyDate: null,
        totalHealthyDays: 0
    }
};

// Get the daily goal (in hours)
function getDailyGoal() {
    // Try vault first
    const vaultData = getGoalsDataFromVault();
    if (vaultData && vaultData.dailyGoal !== undefined) {
        return vaultData.dailyGoal;
    }
    // Fallback to store
    return store.get('dailyGoal', 8); // Default 8 hours
}

// Set the daily goal
function setDailyGoal(hours) {
    // Update vault
    let vaultData = getGoalsDataFromVault() || { ...DEFAULT_GOALS_DATA };
    vaultData.dailyGoal = hours;
    saveGoalsDataToVault(vaultData);
    
    // Also update store for backwards compatibility
    store.set('dailyGoal', hours);
    console.log(`🎯 Daily goal set to ${hours} hours`);
}

// Get streak data
function getStreakData() {
    // Try vault first
    const vaultData = getGoalsDataFromVault();
    if (vaultData && vaultData.streakData) {
        return vaultData.streakData;
    }
    // Fallback to store
    return store.get('streakData', {
        currentStreak: 0,
        longestStreak: 0,
        lastHealthyDate: null,
        totalHealthyDays: 0
    });
}

// Check if a day was "healthy" (under goal)
// Updated to use vault data via getDailySummary
function isDayHealthy(date) {
    const goal = getDailyGoal();
    const goalSeconds = goal * 3600;

    // Get day data from vault via db.js
    const dayData = getDailySummary(date);
    if (!dayData) return false;

    // Handle both old structure and new aggregates structure
    const aggregates = dayData.aggregates || dayData;
    const skippedKeys = ['unlockCount', 'sessions', 'aggregates'];
    
    let totalSeconds = 0;
    for (const [appName, appData] of Object.entries(aggregates)) {
        if (skippedKeys.includes(appName)) continue;
        if (!appData || typeof appData !== 'object') continue;
        totalSeconds += appData.totalSeconds || appData.seconds || 0;
    }

    return totalSeconds < goalSeconds;
}

// Update streak based on yesterday's usage
// Updated to use vault data internally
function updateStreak() {
    const streakData = getStreakData();
    const today = getToday();

    // Get yesterday's date
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split('T')[0];

    // If we already processed this, skip
    if (streakData.lastHealthyDate === yesterdayStr) {
        return streakData;
    }

    // Check if yesterday was healthy using vault data
    const wasHealthy = isDayHealthy(yesterdayStr);

    if (wasHealthy) {
        // Check if streak continues (yesterday was consecutive)
        const lastHealthy = streakData.lastHealthyDate;
        const lastDate = lastHealthy ? new Date(lastHealthy) : null;
        const yesterdayDate = new Date(yesterdayStr);

        const isConsecutive = lastDate &&
            (yesterdayDate.getTime() - lastDate.getTime()) <= 86400000 * 2; // Within 2 days

        if (isConsecutive || !lastHealthy) {
            streakData.currentStreak += 1;
        } else {
            // Streak broken, start new
            streakData.currentStreak = 1;
        }

        streakData.lastHealthyDate = yesterdayStr;
        streakData.totalHealthyDays += 1;

        // Update longest streak
        if (streakData.currentStreak > streakData.longestStreak) {
            streakData.longestStreak = streakData.currentStreak;
        }
    } else if (streakData.lastHealthyDate) {
        // Check if streak should be reset
        const lastDate = new Date(streakData.lastHealthyDate);
        const yesterdayDate = new Date(yesterdayStr);

        if ((yesterdayDate.getTime() - lastDate.getTime()) > 86400000) {
            // More than 1 day gap, reset streak
            streakData.currentStreak = 0;
        }
    }

    // Save to vault first
    let vaultData = getGoalsDataFromVault() || { ...DEFAULT_GOALS_DATA };
    vaultData.streakData = streakData;
    saveGoalsDataToVault(vaultData);
    
    // Also save to store for backwards compatibility
    store.set('streakData', streakData);
    console.log(`🔥 Streak updated: ${streakData.currentStreak} days`);

    return streakData;
}

// Get today's progress toward goal
// Updated to use vault data via getDailySummary
function getTodayProgress() {
    const today = getToday();
    const goal = getDailyGoal();
    const goalSeconds = goal * 3600;

    // Get today's data from vault via db.js
    const dayData = getDailySummary(today);
    
    // Calculate total seconds - handle both old and new structure
    let totalSeconds = 0;
    if (dayData) {
        const aggregates = dayData.aggregates || dayData;
        const skippedKeys = ['unlockCount', 'sessions', 'aggregates'];
        
        for (const [appName, appData] of Object.entries(aggregates)) {
            if (skippedKeys.includes(appName)) continue;
            if (!appData || typeof appData !== 'object') continue;
            totalSeconds += appData.totalSeconds || appData.seconds || 0;
        }
    }

    const percentUsed = Math.round((totalSeconds / goalSeconds) * 100);
    const isOnTrack = totalSeconds < goalSeconds;

    // Calculate projected usage based on current rate
    const now = new Date();
    const hourOfDay = now.getHours() + now.getMinutes() / 60;
    const hoursRemaining = Math.max(0, 24 - hourOfDay);
    const currentRate = hourOfDay > 0 ? totalSeconds / hourOfDay : 0;
    const projectedTotal = totalSeconds + (currentRate * hoursRemaining);
    const projectedPercent = Math.round((projectedTotal / goalSeconds) * 100);

    return {
        goal,
        goalSeconds,
        totalSeconds,
        percentUsed,
        isOnTrack,
        projectedPercent,
        hoursRemaining: Math.floor(hoursRemaining),
        remainingSeconds: Math.max(0, goalSeconds - totalSeconds)
    };
}

// Get milestones and achievements
function getAchievements() {
    const streakData = getStreakData();
    const achievements = [];

    // Streak-based achievements
    if (streakData.currentStreak >= 1) {
        achievements.push({
            id: 'first_day',
            title: 'First Healthy Day!',
            icon: '🌟',
            description: 'Stayed under your goal for a day',
            unlocked: true
        });
    }

    if (streakData.currentStreak >= 3) {
        achievements.push({
            id: 'three_day',
            title: 'Hat Trick',
            icon: '🎩',
            description: '3-day healthy streak',
            unlocked: true
        });
    }

    if (streakData.currentStreak >= 7) {
        achievements.push({
            id: 'week_streak',
            title: 'Weekly Warrior',
            icon: '🏆',
            description: '7-day healthy streak',
            unlocked: true
        });
    }

    if (streakData.currentStreak >= 30) {
        achievements.push({
            id: 'month_streak',
            title: 'Monthly Master',
            icon: '👑',
            description: '30-day healthy streak',
            unlocked: true
        });
    }

    if (streakData.totalHealthyDays >= 10) {
        achievements.push({
            id: 'ten_days',
            title: 'Dedicated',
            icon: '💪',
            description: '10 total healthy days',
            unlocked: true
        });
    }

    // Add locked achievements
    const allAchievements = [
        { id: 'first_day', title: 'First Healthy Day!', icon: '🌟', target: 1 },
        { id: 'three_day', title: 'Hat Trick', icon: '🎩', target: 3 },
        { id: 'week_streak', title: 'Weekly Warrior', icon: '🏆', target: 7 },
        { id: 'month_streak', title: 'Monthly Master', icon: '👑', target: 30 },
    ];

    return allAchievements.map(a => ({
        ...a,
        unlocked: streakData.currentStreak >= a.target,
        progress: Math.min(100, Math.round((streakData.currentStreak / a.target) * 100))
    }));
}

// Reset streak data (for testing or user reset)
function resetStreakData() {
    const defaultStreak = {
        currentStreak: 0,
        longestStreak: 0,
        lastHealthyDate: null,
        totalHealthyDays: 0
    };
    
    // Reset in vault
    let vaultData = getGoalsDataFromVault() || { ...DEFAULT_GOALS_DATA };
    vaultData.streakData = defaultStreak;
    saveGoalsDataToVault(vaultData);
    
    // Reset in store
    store.set('streakData', defaultStreak);
}

module.exports = {
    getDailyGoal,
    setDailyGoal,
    getStreakData,
    updateStreak,
    getTodayProgress,
    getAchievements,
    resetStreakData,
};

