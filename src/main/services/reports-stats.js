/**
 * Reports Stats Service
 * Provides stats aggregation for different time periods: week, month, year, all-time
 */

const { getDailySummary, getAppDisplayName } = require('../database/db');
const { getAppCategoryName, getCategories } = require('./user-categories');

// Format duration
function formatDuration(seconds) {
    if (!seconds || seconds <= 0) return '0m';
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
}

// Get date string for N days ago
function getDateDaysAgo(days) {
    const date = new Date();
    date.setDate(date.getDate() - days);
    return date.toLocaleDateString('en-CA');
}

// Get all dates in a range
function getDateRange(startDate, endDate) {
    const dates = [];
    const current = new Date(startDate);
    const end = new Date(endDate);
    
    while (current <= end) {
        dates.push(current.toLocaleDateString('en-CA'));
        current.setDate(current.getDate() + 1);
    }
    
    return dates;
}

// Get date ranges for different periods
function getPeriodDates(period) {
    const today = new Date();
    today.setHours(12, 0, 0, 0); // Normalize to noon to avoid timezone issues
    let startDate, endDate;
    
    switch (period) {
        case 'week':
            startDate = new Date(today);
            startDate.setDate(today.getDate() - 6);
            endDate = new Date(today);
            break;
            
        case 'month':
            startDate = new Date(today.getFullYear(), today.getMonth(), 1, 12, 0, 0, 0);
            endDate = new Date(today);
            break;
            
        case 'year':
            // Past 12 months (rolling year) - more useful than calendar year
            startDate = new Date(today);
            startDate.setFullYear(today.getFullYear() - 1);
            endDate = new Date(today);
            break;
            
        case 'all':
            // Go back 5 years for full history
            startDate = new Date(today);
            startDate.setFullYear(today.getFullYear() - 5);
            endDate = new Date(today);
            break;
            
        default:
            startDate = new Date(today);
            startDate.setDate(today.getDate() - 6);
            endDate = new Date(today);
    }
    
    return { startDate, endDate };
}

// Helper to get usage data from summary
function getUsageData(summary) {
    if (!summary) return {};
    return summary.aggregates || summary;
}

/**
 * Get comprehensive stats for a given period
 * @param {string} period - 'week', 'month', 'year', 'all'
 */
function getReportStats(period = 'week') {
    const { startDate, endDate } = getPeriodDates(period);
    const skippedKeys = ['unlockCount', 'sessions', 'aggregates'];
    
    console.log(`[ReportStats] Fetching ${period} data from ${startDate.toISOString().split('T')[0]} to ${endDate.toISOString().split('T')[0]}`);
    
    // Data structures
    const dailyTotals = [];
    const appTotals = {};
    const categoryTotals = {};
    const weekdayTotals = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
    const weekdayCounts = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
    
    let totalSeconds = 0;
    let daysWithData = 0;
    
    // Iterate through all dates in range
    const current = new Date(startDate);
    while (current <= endDate) {
        const dateStr = current.toLocaleDateString('en-CA');
        const dayOfWeek = current.getDay();
        const summary = getDailySummary(dateStr);
        const dataset = getUsageData(summary);
        
        let dayTotal = 0;
        
        for (const [appName, data] of Object.entries(dataset)) {
            if (skippedKeys.includes(appName)) continue;
            if (!data || typeof data.totalSeconds !== 'number') continue;
            
            const seconds = data.totalSeconds;
            dayTotal += seconds;
            
            // Get current category from user-categories service (not embedded historical data)
            const categoryName = getAppCategoryName(appName);
            
            // App totals
            if (!appTotals[appName]) {
                appTotals[appName] = {
                    seconds: 0,
                    category: categoryName,
                    daysUsed: 0
                };
            }
            appTotals[appName].seconds += seconds;
            appTotals[appName].daysUsed++;
            
            // Category totals - use the current category name (already resolved above)
            if (!categoryTotals[categoryName]) {
                categoryTotals[categoryName] = 0;
            }
            categoryTotals[categoryName] += seconds;
        }
        
        // Track daily data
        if (dayTotal > 0) {
            daysWithData++;
            weekdayTotals[dayOfWeek] += dayTotal;
            weekdayCounts[dayOfWeek]++;
        }
        
        totalSeconds += dayTotal;
        
        dailyTotals.push({
            date: dateStr,
            dayName: current.toLocaleDateString('en-US', { weekday: 'short' }),
            dayOfWeek,
            seconds: dayTotal,
            formatted: formatDuration(dayTotal)
        });
        
        current.setDate(current.getDate() + 1);
    }
    
    // Calculate averages by weekday
    const weekdayAvgs = {};
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    for (let i = 0; i < 7; i++) {
        weekdayAvgs[dayNames[i]] = weekdayCounts[i] > 0 
            ? Math.round(weekdayTotals[i] / weekdayCounts[i]) 
            : 0;
    }
    
    // Find top apps
    const topApps = Object.entries(appTotals)
        .map(([name, data]) => ({
            name,
            displayName: getAppDisplayName(name),
            seconds: data.seconds,
            formatted: formatDuration(data.seconds),
            category: data.category,
            daysUsed: data.daysUsed,
            percentage: totalSeconds > 0 ? Math.round((data.seconds / totalSeconds) * 100) : 0
        }))
        .sort((a, b) => b.seconds - a.seconds);
    
    // Format categories
    const categories = Object.entries(categoryTotals)
        .map(([category, seconds]) => ({
            category,
            seconds,
            formatted: formatDuration(seconds),
            percentage: totalSeconds > 0 ? Math.round((seconds / totalSeconds) * 100) : 0
        }))
        .sort((a, b) => b.seconds - a.seconds);
    
    // Calculate period stats
    const totalDays = dailyTotals.length;
    const avgPerDay = daysWithData > 0 ? Math.round(totalSeconds / daysWithData) : 0;
    
    // Find best and worst days
    const daysWithUsage = dailyTotals.filter(d => d.seconds > 0);
    const bestDay = daysWithUsage.length > 0 
        ? daysWithUsage.reduce((min, d) => d.seconds < min.seconds ? d : min)
        : null;
    const worstDay = daysWithUsage.length > 0 
        ? daysWithUsage.reduce((max, d) => d.seconds > max.seconds ? d : max)
        : null;
    
    // Group by week for trends (useful for month/year views)
    const weeklyTotals = [];
    if (period !== 'week') {
        let weekStart = new Date(startDate);
        weekStart.setDate(weekStart.getDate() - weekStart.getDay()); // Go to Sunday
        
        while (weekStart <= endDate) {
            const weekEnd = new Date(weekStart);
            weekEnd.setDate(weekStart.getDate() + 6);
            
            const weekDays = dailyTotals.filter(d => {
                const dDate = new Date(d.date);
                return dDate >= weekStart && dDate <= weekEnd;
            });
            
            const weekTotal = weekDays.reduce((sum, d) => sum + d.seconds, 0);
            
            if (weekTotal > 0) {
                weeklyTotals.push({
                    weekStart: weekStart.toLocaleDateString('en-CA'),
                    weekEnd: weekEnd.toLocaleDateString('en-CA'),
                    label: `${weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`,
                    seconds: weekTotal,
                    formatted: formatDuration(weekTotal),
                    days: weekDays.length
                });
            }
            
            weekStart.setDate(weekStart.getDate() + 7);
        }
    }
    
    // Group by month for year view
    const monthlyTotals = [];
    if (period === 'year' || period === 'all') {
        const monthMap = {};
        
        for (const day of dailyTotals) {
            const monthKey = day.date.substring(0, 7); // YYYY-MM
            if (!monthMap[monthKey]) {
                monthMap[monthKey] = { seconds: 0, days: 0 };
            }
            monthMap[monthKey].seconds += day.seconds;
            if (day.seconds > 0) monthMap[monthKey].days++;
        }
        
        for (const [monthKey, data] of Object.entries(monthMap).sort()) {
            const [year, month] = monthKey.split('-');
            const date = new Date(parseInt(year), parseInt(month) - 1, 1);
            
            monthlyTotals.push({
                month: monthKey,
                label: date.toLocaleDateString('en-US', { month: 'short', year: '2-digit' }),
                seconds: data.seconds,
                formatted: formatDuration(data.seconds),
                daysWithData: data.days,
                avgPerDay: data.days > 0 ? Math.round(data.seconds / data.days) : 0
            });
        }
    }
    
    return {
        period,
        dateRange: {
            start: startDate.toLocaleDateString('en-CA'),
            end: endDate.toLocaleDateString('en-CA'),
            startFormatted: startDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
            endFormatted: endDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
        },
        summary: {
            totalSeconds,
            totalFormatted: formatDuration(totalSeconds),
            totalDays,
            daysWithData,
            avgPerDay,
            avgPerDayFormatted: formatDuration(avgPerDay)
        },
        insights: {
            bestDay,
            worstDay,
            weekdayAvgs,
            mostProductiveDay: Object.entries(weekdayAvgs).reduce((min, [day, avg]) => 
                avg < min.avg && avg > 0 ? { day, avg } : min, { day: null, avg: Infinity }),
            leastProductiveDay: Object.entries(weekdayAvgs).reduce((max, [day, avg]) => 
                avg > max.avg ? { day, avg } : max, { day: null, avg: 0 })
        },
        dailyTotals: period === 'week' ? dailyTotals : dailyTotals.slice(-30), // Limit for large periods
        weeklyTotals,
        monthlyTotals,
        topApps: topApps.slice(0, 15),
        categories,
        topApp: topApps[0] || null
    };
}

module.exports = {
    getReportStats,
    getPeriodDates,
    formatDuration
};
