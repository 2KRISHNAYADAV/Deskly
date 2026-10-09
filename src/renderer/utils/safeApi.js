/**
 * Safe API Wrapper - Bulletproof IPC calls with automatic error handling
 * Deskly Academic Edition - Local-only distribution
 */

const isRendererDev = typeof import.meta !== 'undefined' && Boolean(import.meta.env?.DEV);

function logSafeApi(level, message, details) {
    if (!isRendererDev) return;
    if (level === 'warn') {
        console.warn(message, details ?? '');
        return;
    }
    console.error(message, details ?? '');
}

/**
 * Safely call any electronAPI method with automatic error handling
 */
async function safeCall(method, args = [], fallback = null) {
    try {
        if (!window.electronAPI) {
            logSafeApi('warn', `[SafeAPI] electronAPI not available for: ${method}`);
            return fallback;
        }

        if (typeof window.electronAPI[method] !== 'function') {
            logSafeApi('warn', `[SafeAPI] Method not found: ${method}`);
            return fallback;
        }

        const result = await window.electronAPI[method](...args);
        return result ?? fallback;
    } catch (error) {
        logSafeApi('error', `[SafeAPI] Error in ${method}:`, error);
        return fallback;
    }
}

// Pre-defined safe API methods with proper fallbacks
export const SafeAPI = {
    // Stats
    getTodayStats: () => safeCall('getTodayStats', [], {
        totalSeconds: 0,
        formattedTotal: '0m',
        apps: [],
        categories: {}
    }),

    getWeeklyStats: () => safeCall('getWeeklyStats', [], {
        days: [],
        totalSeconds: 0,
        apps: [],
        categories: []
    }),

    getUnlockCount: () => safeCall('getUnlockCount', [], 0),

    getAppUsage: (params) => safeCall('getAppUsage', [params], []),

    // Browser Lock
    getBrowserLockStatus: () => safeCall('getBrowserLockStatus', [], { enabled: false }),
    setBrowserLock: (newPassword, currentPassword) => safeCall('setBrowserLock', [newPassword, currentPassword], { success: false, error: 'Unavailable' }),
    verifyBrowserLock: (password) => safeCall('verifyBrowserLock', [password], { success: false }),
    removeBrowserLock: (currentPassword) => safeCall('removeBrowserLock', [currentPassword], { success: false, error: 'Unavailable' }),

    // Browser
    getBrowserUsage: () => safeCall('getBrowserUsage', [], { websites: [], totalSeconds: 0 }),
    getBrowserBreakdown: () => safeCall('getBrowserBreakdown', [], { 
        totalBrowserTime: 0, 
        totalWebsiteTime: 0, 
        browsers: [], 
        allWebsites: [],
        browserCount: 0,
        websiteCount: 0,
        syncPercentage: 100
    }),
    getBrowserStats: () => safeCall('getBrowserStats', [], { totalBrowserTime: 0, uniqueSites: 0 }),
    getWeeklyBrowserUsage: () => safeCall('getWeeklyBrowserUsage', [], []),

    // Categories
    getCategories: () => safeCall('getCategories', [], []),
    getCategoryStats: () => safeCall('getCategoryStats', [], []),
    getAppsByCategory: () => safeCall('getAppsByCategory', [], []),
    getAppCategoryMapWithNames: () => safeCall('getAppCategoryMapWithNames', [], {}),
    createCategory: (name, color, icon) => safeCall('createCategory', [name, color, icon], false),
    deleteCategory: (id) => safeCall('deleteCategory', [id], false),
    assignAppToCategory: (app, cat) => safeCall('assignAppToCategory', [app, cat], false),

    // App Limits 3.0
    getAppLimits: () => safeCall('getAppLimits', [], {}),
    getAppLimit: (appName) => safeCall('getAppLimit', [appName], null),
    setAppLimit: (appName, dailyMinutes, mode) => safeCall('setAppLimit', [appName, dailyMinutes, mode], false),
    removeAppLimit: (appName) => safeCall('removeAppLimit', [appName], false),
    toggleAppLimit: (appName, enabled) => safeCall('toggleAppLimit', [appName, enabled], false),
    setLimitMode: (appName, mode) => safeCall('setLimitMode', [appName, mode], false),
    addLimitTime: (appName, minutes) => safeCall('addLimitTime', [appName, minutes], false),
    getLimitsSettings: () => safeCall('getLimitsSettings', [], {}),
    
    // Real-time limit updates
    onLimitTriggered: (callback) => window.electronAPI?.onLimitTriggered?.(callback),
    removeLimitTriggeredListener: () => window.electronAPI?.removeLimitTriggeredListener?.(),

    // Intelligence + Timeline
    getWeeklyInsights: () => safeCall('getWeeklyInsights', [], { hasData: false, insights: [], generatedAt: null }),
    getTimeline: (date) => safeCall('getTimeline', [date], { sessions: [], totalSeconds: 0, switchCount: 0 }),

    // Per-App Goals
    getAppGoals: () => safeCall('getAppGoals', [], {}),
    getAppGoal: (appName) => safeCall('getAppGoal', [appName], null),
    setAppGoal: (appName, targetMinutes, type, label) => safeCall('setAppGoal', [appName, targetMinutes, type, label], null),
    removeAppGoal: (appName) => safeCall('removeAppGoal', [appName], false),
    getAppGoalsProgress: (dateStr) => safeCall('getAppGoalsProgress', [dateStr], []),
    getAppDailyScore: (dateStr) => safeCall('getAppDailyScore', [dateStr], 50),

    // Streaks & Goals
    getStreak: () => safeCall('getStreak', [], { currentStreak: 0, longestStreak: 0 }),
    getDailyGoal: () => safeCall('getDailyGoal', [], 8),
    setDailyGoal: (hours) => safeCall('setDailyGoal', [hours], false),
    getAchievements: () => safeCall('getAchievements', [], []),
    getGoalsCalendar: (days) => safeCall('getGoalsCalendar', [days || 30], []),

    // Settings
    getSetting: (key) => safeCall('getSetting', [key], null),
    setSetting: (key, value) => safeCall('setSetting', [key, value], false),
    getAutoStart: () => safeCall('getAutoStart', [], false),
    setAutoStart: (enabled) => safeCall('setAutoStart', [enabled], false),

    // Break Reminders
    toggleBreakReminder: (enabled) => safeCall('toggleBreakReminder', [enabled], false),
    setBreakInterval: (mins) => safeCall('setBreakInterval', [mins], false),
    sendTestNotification: () => safeCall('sendTestNotification', [], false),

    // Export
    exportJSON: () => safeCall('exportJSON', [], { success: false }),
    exportCSV: () => safeCall('exportCSV', [], { success: false }),

    // Data Management
    resetData: () => safeCall('resetAllData', [], false),
    openExternal: (url) => safeCall('openExternal', [url], { success: false }),

    // App + Runtime
    getAppVersion: () => safeCall('getAppVersion', [], '1.0.0'),
    getLaunchContext: () => safeCall('getLaunchContext', [], null),
    getFeatureFlags: () => safeCall('getFeatureFlags', [], {}),
    getFeatureFlag: (name) => safeCall('getFeatureFlag', [name], null),
    setFeatureFlag: (name, enabled) => safeCall('setFeatureFlag', [name, enabled], { success: false }),
    getDiagnosticsSummary: () => safeCall('getDiagnosticsSummary', [], null),
};

export default SafeAPI;
