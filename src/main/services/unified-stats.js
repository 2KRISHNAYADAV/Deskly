/**
 * Unified Stats Service
 * 
 * Single source of truth for all screen time statistics.
 * Combines app usage (dailySummary) and website usage (websiteUsage) 
 * into a consistent data structure used by all UI screens.
 */

const { getDailySummary, getToday, getAppDisplayName } = require('../database/db');
const { getTodayWebsiteUsage, isBrowser, BROWSERS } = require('./browser-intelligence');

// Format duration in human-readable form
function formatDuration(seconds) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);

    if (hours > 0) {
        return `${hours}h ${minutes}m`;
    }
    return `${minutes}m`;
}

// Check if an app is a browser
function isAppBrowser(appName) {
    if (!appName) return false;
    const name = appName.toLowerCase();
    return BROWSERS.some(browser => name.includes(browser));
}

// Helper to normalize data (handle legacy vs new structure)
function getUsageData(summary) {
    if (!summary) return {};
    // If we have an aggregates object (New Session Architecture), use it.
    // Otherwise fallback to the summary root (Old Counter Architecture).
    return summary.aggregates || summary;
}

/**
 * Get unified stats for today
 * This is THE single source of truth for all screen time data
 */
function getUnifiedTodayStats() {
    const today = getToday();
    const summary = getDailySummary(today);
    const dataset = getUsageData(summary);
    const websiteData = getTodayWebsiteUsage();

    // Calculate app totals
    let totalSeconds = 0;
    let browserAppSeconds = 0;
    let nonBrowserAppSeconds = 0;
    const apps = [];
    const categoryTotals = {};
    const skippedKeys = ['unlockCount', 'sessions', 'aggregates'];

    for (const [appName, data] of Object.entries(dataset)) {
        if (skippedKeys.includes(appName)) continue;
        if (!data || typeof data.totalSeconds !== 'number') continue;

        const seconds = data.totalSeconds;
        const category = data.category || 'Uncategorized';
        const isBrowserApp = isAppBrowser(appName);

        totalSeconds += seconds;

        if (isBrowserApp) {
            browserAppSeconds += seconds;
        } else {
            nonBrowserAppSeconds += seconds;
        }

        apps.push({
            name: appName,
            displayName: getAppDisplayName(appName),
            seconds: seconds,
            formatted: formatDuration(seconds),
            category: category,
            isBrowser: isBrowserApp,
        });

        // Category aggregation
        if (!categoryTotals[category]) {
            categoryTotals[category] = 0;
        }
        categoryTotals[category] += seconds;
    }

    // Sort apps by usage
    apps.sort((a, b) => b.seconds - a.seconds);

    // Calculate percentages
    apps.forEach(app => {
        app.percentage = totalSeconds > 0 ? Math.round((app.seconds / totalSeconds) * 100) : 0;
    });

    // Format categories
    const categories = {};
    for (const [cat, seconds] of Object.entries(categoryTotals)) {
        categories[cat] = {
            seconds,
            formatted: formatDuration(seconds),
            percentage: totalSeconds > 0 ? Math.round((seconds / totalSeconds) * 100) : 0,
        };
    }

    // Website data is a BREAKDOWN of browser time, not additional
    // Include it for the Browser tab but don't add to total
    const websites = websiteData.websites || [];
    const websiteBreakdownSeconds = websiteData.totalSeconds || 0;

    return {
        // Primary totals - SINGLE SOURCE OF TRUTH
        totalSeconds,
        formattedTotal: formatDuration(totalSeconds),

        // Breakdown for context
        browserAppSeconds,
        nonBrowserAppSeconds,
        websiteBreakdownSeconds,

        // App list
        apps,
        appCount: apps.length,

        // Category breakdown
        categories,

        // Website breakdown (subset of browserAppSeconds)
        // Note: This may not equal browserAppSeconds exactly due to:
        // - New tabs, settings pages, blank pages (tracked as browser but no website parsed)
        // - Tracking precision differences
        websites,
        websiteCount: websites.length,

        // Metadata
        date: today,
        lastUpdated: new Date().toISOString(),
    };
}

/**
 * Get unified weekly stats
 */
function getUnifiedWeeklyStats() {
    const days = [];
    let totalSeconds = 0;
    const appTotals = {};
    const categoryTotals = {};
    const skippedKeys = ['unlockCount', 'sessions', 'aggregates'];

    console.log('[WeeklyStats] Fetching weekly data...');

    // Get stats for the last 7 days
    for (let i = 6; i >= 0; i--) {
        const date = getDateDaysAgo(i);
        const dayName = new Date(date).toLocaleDateString('en-US', { weekday: 'short' });
        const summary = getDailySummary(date);
        const dataset = getUsageData(summary);

        console.log(`[WeeklyStats] ${date} (${dayName}): summary keys =`, Object.keys(summary || {}), 'dataset keys =', Object.keys(dataset || {}));

        let dayTotal = 0;
        for (const [appName, data] of Object.entries(dataset)) {
            if (skippedKeys.includes(appName)) continue;
            if (!data || typeof data.totalSeconds !== 'number') continue;

            dayTotal += data.totalSeconds;

            // Aggregate for top app
            if (!appTotals[appName]) {
                appTotals[appName] = 0;
            }
            appTotals[appName] += data.totalSeconds;

            // Category aggregation
            const cat = data.category || 'Uncategorized';
            if (!categoryTotals[cat]) {
                categoryTotals[cat] = 0;
            }
            categoryTotals[cat] += data.totalSeconds;
        }

        totalSeconds += dayTotal;
        days.push({
            date,
            dayName,
            seconds: dayTotal,
            formatted: formatDuration(dayTotal),
        });
    }

    // Find top app
    let topApp = null;
    let maxSeconds = 0;
    for (const [appName, seconds] of Object.entries(appTotals)) {
        if (seconds > maxSeconds) {
            maxSeconds = seconds;
            topApp = {
                name: appName,
                displayName: getAppDisplayName(appName),
                seconds,
                formatted: formatDuration(seconds),
            };
        }
    }

    // Format categories for weekly
    const categories = Object.entries(categoryTotals)
        .map(([category, seconds]) => ({
            category,
            seconds,
            formatted: formatDuration(seconds),
            percentage: totalSeconds > 0 ? Math.round((seconds / totalSeconds) * 100) : 0,
        }))
        .sort((a, b) => b.seconds - a.seconds);

    const avgSeconds = Math.round(totalSeconds / 7);

    return {
        days,
        totalSeconds,
        formattedTotal: formatDuration(totalSeconds),
        avgSeconds,
        formattedAvg: formatDuration(avgSeconds),
        topApp,
        categories,
    };
}

/**
 * Get app usage for a specific period
 */
function getUnifiedAppUsage(options = {}) {
    const {
        sortBy = 'time',
        order = 'desc',
        limit = 50,
        search = '',
        period = 'today',
        includeBrowsers = true  // New option to filter browsers
    } = options;

    const appTotals = {};
    const daysUsed = {};
    const skippedKeys = ['unlockCount', 'sessions', 'aggregates'];

    // Determine how many days to look back
    let daysToLookBack = 1;
    if (period === 'week') daysToLookBack = 7;
    if (period === 'month') daysToLookBack = 30;
    if (period === 'all') daysToLookBack = 365;

    // Aggregate data
    for (let i = 0; i < daysToLookBack; i++) {
        const date = getDateDaysAgo(i);
        const summary = getDailySummary(date);
        const dataset = getUsageData(summary);

        for (const [appName, data] of Object.entries(dataset)) {
            if (skippedKeys.includes(appName)) continue;
            if (!data || typeof data.totalSeconds !== 'number') continue;

            // Filter out browsers if requested
            if (!includeBrowsers && isAppBrowser(appName)) continue;

            // Apply search filter
            if (search) {
                const displayName = getAppDisplayName(appName).toLowerCase();
                if (!appName.includes(search.toLowerCase()) && !displayName.includes(search.toLowerCase())) {
                    continue;
                }
            }

            if (!appTotals[appName]) {
                appTotals[appName] = {
                    seconds: 0,
                    category: data.category || 'Uncategorized',
                };
                daysUsed[appName] = new Set();
            }

            appTotals[appName].seconds += data.totalSeconds;
            daysUsed[appName].add(date);
        }
    }

    // Build result array
    let apps = Object.entries(appTotals).map(([appName, data]) => ({
        name: appName,
        displayName: getAppDisplayName(appName),
        seconds: data.seconds,
        formatted: formatDuration(data.seconds),
        category: data.category,
        isBrowser: isAppBrowser(appName),
        daysUsed: daysUsed[appName].size,
        avgPerDay: formatDuration(Math.round(data.seconds / Math.max(daysUsed[appName].size, 1))),
    }));

    // Sort
    if (sortBy === 'name') {
        apps.sort((a, b) => {
            const comparison = a.displayName.localeCompare(b.displayName);
            return order === 'asc' ? comparison : -comparison;
        });
    } else {
        apps.sort((a, b) => {
            return order === 'asc' ? a.seconds - b.seconds : b.seconds - a.seconds;
        });
    }

    // Limit
    return apps.slice(0, limit);
}

// Helper to get date N days ago
function getDateDaysAgo(days) {
    const date = new Date();
    date.setDate(date.getDate() - days);
    return date.toLocaleDateString('en-CA', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    });
}

/**
 * Get browser breakdown - websites grouped by their parent browser
 * This ensures the sum of all website time equals the total browser app time
 * 
 * The key insight: we have two data sources that should be consistent:
 * 1. App-level tracking: knows exactly how much time spent in Brave, Chrome, Edge
 * 2. Website-level tracking: knows which websites were visited from each browser
 * 
 * The browser breakdown restructures the data so websites are children of their browsers
 */
function getBrowserBreakdown() {
    const today = getToday();
    const summary = getDailySummary(today);
    const dataset = getUsageData(summary);
    const websiteData = getTodayWebsiteUsage();
    const skippedKeys = ['unlockCount', 'sessions', 'aggregates'];

    // Step 1: Calculate browser app times (the source of truth)
    const browserApps = {};
    let totalBrowserTime = 0;

    for (const [appName, data] of Object.entries(dataset)) {
        if (skippedKeys.includes(appName)) continue;
        if (!data || typeof data.totalSeconds !== 'number') continue;

        if (isAppBrowser(appName)) {
            const displayName = getAppDisplayName(appName);
            browserApps[appName] = {
                processName: appName,
                displayName: displayName,
                totalSeconds: data.totalSeconds,
                formatted: formatDuration(data.totalSeconds),
                websites: [],
                websiteSeconds: 0, // Will be filled from website data
                unaccountedSeconds: 0, // Browser time not attributed to any website
            };
            totalBrowserTime += data.totalSeconds;
        }
    }

    // Step 2: Distribute website time to their parent browsers
    const websites = websiteData.websites || [];
    let totalWebsiteSeconds = 0;

    for (const website of websites) {
        // Website has a 'browser' field like "Brave", "Chrome", "Edge"
        const browserKey = findBrowserKey(website.browser, browserApps);
        
        if (browserKey && browserApps[browserKey]) {
            browserApps[browserKey].websites.push({
                id: website.id,
                name: website.name,
                seconds: website.seconds,
                formatted: formatDuration(website.seconds),
                isNewTab: website.isNewTab || website.name === 'New Tab',
                isPrivate: website.isPrivate || false,
                visits: website.visits || 1,
            });
            browserApps[browserKey].websiteSeconds += website.seconds;
            totalWebsiteSeconds += website.seconds;
        }
    }

    // Step 3: Sort websites within each browser and calculate unaccounted time
    const browsers = [];
    for (const [key, browser] of Object.entries(browserApps)) {
        // Sort websites by usage
        browser.websites.sort((a, b) => b.seconds - a.seconds);
        
        // Calculate unaccounted time (browser tracking shows more than website tracking captured)
        // This can happen due to:
        // - Browser pages that don't get parsed (settings, downloads, etc)
        // - Timing precision differences
        browser.unaccountedSeconds = Math.max(0, browser.totalSeconds - browser.websiteSeconds);
        browser.unaccountedFormatted = formatDuration(browser.unaccountedSeconds);
        
        // Add "Other browser activity" if there's significant unaccounted time (> 30 seconds)
        if (browser.unaccountedSeconds > 30) {
            browser.websites.push({
                id: `${key}-other`,
                name: 'Other browser activity',
                seconds: browser.unaccountedSeconds,
                formatted: formatDuration(browser.unaccountedSeconds),
                isOther: true,
                isNewTab: false,
                isPrivate: false,
            });
            // Re-sort after adding
            browser.websites.sort((a, b) => b.seconds - a.seconds);
        }
        
        browsers.push(browser);
    }

    // Sort browsers by usage
    browsers.sort((a, b) => b.totalSeconds - a.totalSeconds);

    return {
        // Total browser time from app tracking (source of truth)
        totalBrowserTime,
        formattedTotal: formatDuration(totalBrowserTime),
        
        // Total website time we captured
        totalWebsiteTime: totalWebsiteSeconds,
        
        // Browsers with their websites nested inside
        browsers,
        browserCount: browsers.length,
        
        // Flat list of all websites (for backward compatibility)
        allWebsites: websites,
        websiteCount: websites.length,
        
        // Sync status - these should be close if tracking is working well
        // Perfect sync means totalBrowserTime ≈ totalWebsiteTime
        syncPercentage: totalBrowserTime > 0 
            ? Math.round((totalWebsiteSeconds / totalBrowserTime) * 100) 
            : 100,
        
        date: today,
        lastUpdated: new Date().toISOString(),
    };
}

/**
 * Helper to match website browser name to app process name
 * Website has browser like "Brave", but app tracking has "brave"
 */
function findBrowserKey(browserName, browserApps) {
    if (!browserName) return null;
    
    const lower = browserName.toLowerCase();
    
    // Browser name mappings (display name -> possible process names)
    const mappings = {
        'brave': ['brave'],
        'chrome': ['chrome', 'google chrome'],
        'edge': ['msedge', 'edge', 'microsoft edge'],
        'firefox': ['firefox'],
        'opera': ['opera'],
        'vivaldi': ['vivaldi'],
        'unknown': [] // Will use first available
    };
    
    for (const key of Object.keys(browserApps)) {
        const keyLower = key.toLowerCase();
        
        // Direct match
        if (keyLower === lower) return key;
        
        // Check mappings
        for (const [displayName, processNames] of Object.entries(mappings)) {
            if (lower.includes(displayName)) {
                for (const pn of processNames) {
                    if (keyLower.includes(pn)) return key;
                }
            }
        }
        
        // Partial match (e.g., "Edge" matches "msedge")
        if (keyLower.includes(lower) || lower.includes(keyLower)) return key;
    }
    
    return null;
}

module.exports = {
    getUnifiedTodayStats,
    getUnifiedWeeklyStats,
    getUnifiedAppUsage,
    getBrowserBreakdown,
    formatDuration,
    isAppBrowser,
};
