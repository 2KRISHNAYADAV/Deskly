const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods to the renderer process
contextBridge.exposeInMainWorld('electronAPI', {
    // Window controls
    minimize: () => ipcRenderer.send('window:minimize'),
    maximize: () => ipcRenderer.send('window:maximize'),
    close: () => ipcRenderer.send('window:close'),

    // Stats
    getTodayStats: () => ipcRenderer.invoke('stats:today'),
    getWeeklyStats: () => ipcRenderer.invoke('stats:weekly'),
    getWeeklyInsights: () => ipcRenderer.invoke('insights:getWeekly'),
    getTimeline: (date) => ipcRenderer.invoke('timeline:getDay', date),
    getReportStats: (period) => ipcRenderer.invoke('stats:report', period),
    getAppUsage: (options) => ipcRenderer.invoke('stats:apps', options),
    getUnlockCount: () => ipcRenderer.invoke('stats:unlocks'),

    // Settings
    getSetting: (key) => ipcRenderer.invoke('settings:get', key),
    setSetting: (key, value) => ipcRenderer.invoke('settings:set', key, value),

    // Data management
    resetAllData: () => ipcRenderer.invoke('data:reset'),
    exportData: () => ipcRenderer.invoke('data:export'),

    // Tracking
    getTrackingStatus: () => ipcRenderer.invoke('tracking:status'),
    toggleTracking: () => ipcRenderer.send('tracking:toggle'),

    // Break reminders
    toggleBreakReminder: (enabled) => ipcRenderer.invoke('break:toggle', enabled),
    setBreakInterval: (minutes) => ipcRenderer.invoke('break:setInterval', minutes),
    sendTestNotification: () => ipcRenderer.invoke('break:test'),

    // App Limits 3.0
    getAppLimits: () => ipcRenderer.invoke('limits:getAll'),
    getAppLimit: (appName) => ipcRenderer.invoke('limits:get', appName),
    setAppLimit: (appName, dailyMinutes, mode) => ipcRenderer.invoke('limits:set', appName, dailyMinutes, mode),
    removeAppLimit: (appName) => ipcRenderer.invoke('limits:remove', appName),
    toggleAppLimit: (appName, enabled) => ipcRenderer.invoke('limits:toggle', appName, enabled),
    setLimitMode: (appName, mode) => ipcRenderer.invoke('limits:setMode', appName, mode),
    addLimitTime: (appName, minutes) => ipcRenderer.invoke('limits:addTime', appName, minutes),
    getLimitsSettings: () => ipcRenderer.invoke('limits:getSettings'),

    // Limit overlay communication
    limitsAction: (action, appName, payload) => ipcRenderer.send('limits:action', { action, appName, payload }),
    onOverlayData: (callback) => ipcRenderer.on('overlay:data', (event, data) => callback(data)),
    onOverlayHide: (callback) => ipcRenderer.on('overlay:hide', () => callback()),
    overlayAnimationDone: () => ipcRenderer.send('overlay:animation-done'),
    onOverlayCountdown: (callback) => ipcRenderer.on('overlay:countdown', (event, remaining) => callback(remaining)),
    onOverlayCountdownComplete: (callback) => ipcRenderer.on('overlay:countdown-complete', () => callback()),

    // Real-time limit state updates
    onLimitTriggered: (callback) => {
        const handler = (event, data) => callback(data);
        ipcRenderer.on('limits:triggered', handler);
        return () => ipcRenderer.removeListener('limits:triggered', handler);
    },
    removeLimitTriggeredListener: () => ipcRenderer.removeAllListeners('limits:triggered'),

    // Per-App Goals
    getAppGoals: () => ipcRenderer.invoke('appgoals:getAll'),
    getAppGoal: (appName) => ipcRenderer.invoke('appgoals:get', appName),
    setAppGoal: (appName, targetMinutes, type, label) => ipcRenderer.invoke('appgoals:set', appName, targetMinutes, type, label),
    removeAppGoal: (appName) => ipcRenderer.invoke('appgoals:remove', appName),
    getAppGoalsProgress: (dateStr) => ipcRenderer.invoke('appgoals:progress', dateStr),
    getAppDailyScore: (dateStr) => ipcRenderer.invoke('appgoals:dailyScore', dateStr),

    // Goals and streaks
    getDailyGoal: () => ipcRenderer.invoke('goals:get'),
    setDailyGoal: (hours) => ipcRenderer.invoke('goals:set', hours),
    getStreak: () => ipcRenderer.invoke('goals:streak'),
    getGoalProgress: () => ipcRenderer.invoke('goals:progress'),
    getAchievements: () => ipcRenderer.invoke('goals:achievements'),
    getGoalsCalendar: (days) => ipcRenderer.invoke('goals:calendar', days),

    // Achievements
    getAllAchievements: () => ipcRenderer.invoke('achievements:getAll'),
    getAchievementStats: () => ipcRenderer.invoke('achievements:stats'),

    // Export
    exportJSON: () => ipcRenderer.invoke('export:json'),
    exportCSV: () => ipcRenderer.invoke('export:csv'),

    // Auto-start
    getAutoStart: () => ipcRenderer.invoke('autostart:get'),
    setAutoStart: (enabled) => ipcRenderer.invoke('autostart:set', enabled),

    // Vault Management (Onboarding + Settings)
    isFirstRun: () => ipcRenderer.invoke('vault:isFirstRun'),
    getDefaultVaultPath: () => ipcRenderer.invoke('vault:getDefaultPath'),
    selectVaultFolder: () => ipcRenderer.invoke('vault:selectFolder'),
    createVault: (path) => ipcRenderer.invoke('vault:create', path),
    getVaultPath: () => ipcRenderer.invoke('vault:getPath'),
    changeVaultLocation: () => ipcRenderer.invoke('vault:changeLocation'),
    openVaultFolder: () => ipcRenderer.invoke('vault:openFolder'),

    // Shell links
    openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),

    // Authentication stubs (Local Academic Edition - always standalone)
    authSignIn: () => Promise.resolve({ success: false, reason: 'Academic Edition runs offline without accounts.' }),
    authSignOut: () => Promise.resolve({ error: null }),
    authGetUser: () => Promise.resolve({ user: null }),
    authIsSignedIn: () => Promise.resolve(false),
    authGetDeviceId: () => Promise.resolve('academic-local'),
    onAuthStateChanged: () => () => {},
    closeGoodbyeWindow: () => ipcRenderer.send('goodbye:close'),

    // Vault Health & Integrity
    checkVaultHealth: () => ipcRenderer.invoke('vault:checkHealth'),
    repairVault: () => ipcRenderer.invoke('vault:repair'),
    isVaultHealthy: () => ipcRenderer.invoke('vault:isHealthy'),
    recoverDeletedVault: () => ipcRenderer.invoke('vault:recoverDeleted'),
    nukeVault: () => ipcRenderer.invoke('vault:nuke'),

    // Real-time vault monitoring events
    onVaultDeleted: (callback) => {
        const handler = (event, data) => callback(data);
        ipcRenderer.on('vault:deleted', handler);
        return () => ipcRenderer.removeListener('vault:deleted', handler);
    },
    onVaultHealthChanged: (callback) => {
        const handler = (event, data) => callback(data);
        ipcRenderer.on('vault:health-changed', handler);
        return () => ipcRenderer.removeListener('vault:health-changed', handler);
    },

    // Browser Lock
    getBrowserLockStatus: () => ipcRenderer.invoke('browser:lock:status'),
    setBrowserLock: (newPassword, currentPassword) => ipcRenderer.invoke('browser:lock:set', newPassword, currentPassword),
    verifyBrowserLock: (password) => ipcRenderer.invoke('browser:lock:verify', password),
    removeBrowserLock: (currentPassword) => ipcRenderer.invoke('browser:lock:remove', currentPassword),

    // Browser Intelligence
    getBrowserUsage: () => ipcRenderer.invoke('browser:usage'),
    getBrowserBreakdown: () => ipcRenderer.invoke('browser:breakdown'),
    getBrowserWebsiteCategories: () => ipcRenderer.invoke('browser:categories'),
    getTopWebsites: (limit) => ipcRenderer.invoke('browser:top', limit),
    getBrowserStats: () => ipcRenderer.invoke('browser:stats'),
    getWeeklyBrowserUsage: () => ipcRenderer.invoke('browser:weekly'),

    // User-Defined Categories
    getCategories: () => ipcRenderer.invoke('categories:getAll'),
    createCategory: (name, color, icon) => ipcRenderer.invoke('categories:create', name, color, icon),
    updateCategory: (id, updates) => ipcRenderer.invoke('categories:update', id, updates),
    deleteCategory: (id) => ipcRenderer.invoke('categories:delete', id),
    assignAppToCategory: (appName, categoryId) => ipcRenderer.invoke('categories:assignApp', appName, categoryId),
    getCategoryStats: () => ipcRenderer.invoke('categories:stats'),
    getAppsByCategory: () => ipcRenderer.invoke('categories:appsByCategory'),
    getAppCategoryMap: () => ipcRenderer.invoke('categories:appMap'),
    getAppCategoryMapWithNames: () => ipcRenderer.invoke('categories:appMapWithNames'),
    getCategorySuggestionsForApp: (appName) => ipcRenderer.invoke('categories:suggestForApp', appName),

    // Website Categories
    assignWebsiteToCategory: (websiteId, categoryId) => ipcRenderer.invoke('categories:assignWebsite', websiteId, categoryId),
    getWebsitesByCategory: () => ipcRenderer.invoke('categories:websitesByCategory'),
    getWebsiteCategoryMap: () => ipcRenderer.invoke('categories:websiteMap'),
    getWebsiteCategoryStats: () => ipcRenderer.invoke('categories:websiteStats'),

    // Browser Categories
    getBrowserCategories: () => ipcRenderer.invoke('browserCategories:getAll'),
    createBrowserCategory: (name, color, icon) => ipcRenderer.invoke('browserCategories:create', name, color, icon),
    updateBrowserCategory: (id, updates) => ipcRenderer.invoke('browserCategories:update', id, updates),
    deleteBrowserCategory: (id) => ipcRenderer.invoke('browserCategories:delete', id),
    getWebsitesByBrowserCategory: () => ipcRenderer.invoke('browserCategories:websitesByCategory'),

    // Native App Icons
    getAppIcon: (appName) => ipcRenderer.invoke('icons:get', appName),
    getCachedIcons: () => ipcRenderer.invoke('icons:getCached'),
    clearIconCache: () => ipcRenderer.invoke('icons:clear'),
    preExtractIcons: (appNames) => ipcRenderer.invoke('icons:preExtract', appNames),

    // App info & Runtime
    getAppVersion: () => ipcRenderer.invoke('app:getVersion'),
    getLaunchContext: () => ipcRenderer.invoke('app:getLaunchContext'),
    getFeatureFlags: () => ipcRenderer.invoke('app:getFeatureFlags'),
    getFeatureFlag: (name) => ipcRenderer.invoke('app:getFeatureFlag', name),
    setFeatureFlag: (name, enabled) => ipcRenderer.invoke('app:setFeatureFlag', name, enabled),
    getDiagnosticsSummary: () => ipcRenderer.invoke('diagnostics:getSummary'),

    // Events
    onStatsUpdate: (callback) => {
        const handler = (event, data) => callback(data);
        ipcRenderer.on('stats:updated', handler);
        return () => ipcRenderer.removeListener('stats:updated', handler);
    },
    onLimitExceeded: (callback) => {
        const handler = (event, data) => callback(data);
        ipcRenderer.on('app:limitExceeded', handler);
        return () => ipcRenderer.removeListener('app:limitExceeded', handler);
    },
    onRefreshStats: (callback) => {
        const subscription = (event, ...args) => callback(...args);
        ipcRenderer.on('app:refresh-stats', subscription);
        return () => ipcRenderer.removeListener('app:refresh-stats', subscription);
    },

    // App Lock
    isMasterConfigured:  ()                   => ipcRenderer.invoke('applock:isMasterConfigured'),
    getAppLockMeta:      ()                   => ipcRenderer.invoke('applock:getMeta'),
    setupMaster:         (secret, method)     => ipcRenderer.invoke('applock:setupMaster', secret, method),
    verifyMaster:        (secret)             => ipcRenderer.invoke('applock:verifyMaster', secret),
    changeMaster:        (oldS, newS, method) => ipcRenderer.invoke('applock:changeMaster', oldS, newS, method),
    getAppLocks:         ()                   => ipcRenderer.invoke('applock:getAll'),
    getAppLockStatus:    ()                   => ipcRenderer.invoke('applock:getStatus'),
    getLockableApps:     ()                   => ipcRenderer.invoke('applock:getLockableApps'),
    addAppLock:          (appName, config)    => ipcRenderer.invoke('applock:add', appName, config),
    removeAppLock:       (appName, secret)    => ipcRenderer.invoke('applock:remove', appName, secret),
    toggleAppLock:       (appName, enabled)   => ipcRenderer.invoke('applock:toggle', appName, enabled),
    authenticateAppLock: (appName, secret)    => ipcRenderer.invoke('applock:authenticate', appName, secret),
    resetAppLock:        ()                   => ipcRenderer.invoke('applock:reset'),
    getAppLockSettings:  ()                   => ipcRenderer.invoke('applock:getSettings'),
    updateAppLockSettings: (patch)            => ipcRenderer.invoke('applock:updateSettings', patch),
    hasActiveLocks:      ()                   => ipcRenderer.invoke('applock:hasActive'),

    onAppLockStatusUpdate: (callback) => {
        const handler = (_, data) => callback(data);
        ipcRenderer.on('applock:statusUpdate', handler);
        return () => ipcRenderer.removeListener('applock:statusUpdate', handler);
    },

    // Focus Mode
    getFocusState:       ()                    => ipcRenderer.invoke('focus:getState'),
    getFocusStats:       ()                    => ipcRenderer.invoke('focus:getStats'),
    getFocusSettings:    ()                    => ipcRenderer.invoke('focus:getSettings'),
    updateFocusSettings: (patch)               => ipcRenderer.invoke('focus:updateSettings', patch),
    startFocus:          (config)              => ipcRenderer.invoke('focus:start', config),
    endFocus:            (early)               => ipcRenderer.invoke('focus:end', early),
    getFocusBlockableApps: ()                  => ipcRenderer.invoke('focus:getBlockableApps'),
    getFocusCategories:  ()                    => ipcRenderer.invoke('focus:getCategories'),

    onFocusStateUpdate: (callback) => {
        const handler = (_, data) => callback(data);
        ipcRenderer.on('focus:stateUpdate', handler);
        return () => ipcRenderer.removeListener('focus:stateUpdate', handler);
    },
});
