/**
 * Health Check - Quick status check for the app
 * 
 * Usage: npm run health
 */

const fs = require('fs');
const path = require('path');

const VAULT_PATH = 'C:\\Hitesh_Codebase\\DW VAULT\\Deskly';

function getToday() {
    return new Date().toISOString().split('T')[0];
}

function formatTime(seconds) {
    if (!seconds) return '0m';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function healthCheck() {
    console.log('\n🏥 Deskly - HEALTH CHECK\n');
    console.log('─'.repeat(50));
    
    const today = getToday();
    const month = today.substring(0, 7);
    
    // Check vault
    const vaultExists = fs.existsSync(VAULT_PATH);
    console.log(`📁 Vault: ${vaultExists ? '✅ Found' : '❌ Missing'}`);
    
    if (!vaultExists) {
        console.log('\n❌ Vault not found. Run the app first to create it.\n');
        return;
    }
    
    // Check today's data
    const appDataPath = path.join(VAULT_PATH, 'data', `${month}.json`);
    const websiteDataPath = path.join(VAULT_PATH, 'data', 'websites', `${month}.json`);
    
    let todaySeconds = 0;
    let todayApps = 0;
    let todayWebsites = 0;
    let browserSync = true;
    
    if (fs.existsSync(appDataPath)) {
        try {
            const appData = JSON.parse(fs.readFileSync(appDataPath, 'utf8'));
            const todayData = appData[today];
            
            if (todayData?.aggregates) {
                for (const [app, data] of Object.entries(todayData.aggregates)) {
                    todaySeconds += data.totalSeconds || 0;
                    todayApps++;
                }
            }
        } catch (e) {}
    }
    
    if (fs.existsSync(websiteDataPath)) {
        try {
            const websiteData = JSON.parse(fs.readFileSync(websiteDataPath, 'utf8'));
            const todayData = websiteData[today];
            
            if (todayData?.websites) {
                todayWebsites = Object.keys(todayData.websites).length;
            }
        } catch (e) {}
    }
    
    console.log(`📅 Today: ${today}`);
    console.log(`⏱️  Screen Time: ${formatTime(todaySeconds)}`);
    console.log(`📱 Apps Used: ${todayApps}`);
    console.log(`🌐 Websites Visited: ${todayWebsites}`);
    
    // Quick sync check
    const appDataExists = fs.existsSync(appDataPath);
    const websiteDataExists = fs.existsSync(websiteDataPath);
    
    if (appDataExists && websiteDataExists) {
        try {
            const appData = JSON.parse(fs.readFileSync(appDataPath, 'utf8'));
            const websiteData = JSON.parse(fs.readFileSync(websiteDataPath, 'utf8'));
            
            const aggregates = appData[today]?.aggregates || {};
            const byBrowser = websiteData[today]?.byBrowser || {};
            
            // Check common browsers for time sync
            for (const browser of ['brave', 'chrome', 'firefox', 'edge', 'comet', 'arc', 'opera', 'vivaldi']) {
                const appTime = aggregates[browser]?.totalSeconds || 0;
                const webTime = byBrowser[browser.charAt(0).toUpperCase() + browser.slice(1)] || 0;
                
                if (appTime > 0 && Math.abs(appTime - webTime) > 5) {
                    browserSync = false;
                }
            }
        } catch (e) {}
    }
    
    console.log(`🔄 Browser Sync: ${browserSync ? '✅ OK' : '⚠️ Out of sync'}`);
    
    // Status
    console.log('\n' + '─'.repeat(50));
    
    if (todaySeconds > 0 && browserSync) {
        console.log('✅ Status: HEALTHY\n');
    } else if (todaySeconds === 0) {
        console.log('ℹ️  Status: No data yet today\n');
    } else {
        console.log('⚠️  Status: Check data consistency\n');
    }
}

healthCheck();

