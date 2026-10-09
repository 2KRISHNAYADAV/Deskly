const { getWebsiteUsage, updateWebsiteUsage } = require('../database/db');

// Comprehensive browser list - includes mainstream, privacy-focused, and niche browsers
// Process names are lowercase for matching
// NOTE: Do NOT add 'electron', 'webview', 'cef' - these match our own app and other Electron apps!
const BROWSERS = [
    // Chromium-based mainstream
    'chrome', 'chromium', 'msedge', 'edge', 'brave', 'opera', 'vivaldi',
    // Firefox-based
    'firefox', 'waterfox', 'librewolf', 'floorp', 'zen', 'palemoon', 'basilisk', 'seamonkey',
    // Privacy-focused
    'tor', 'mullvad', 'ungoogled-chromium',
    // AI/New generation browsers
    'comet', 'arc', 'sigmaos', 'sidekick',
    // Regional/Other Chromium
    'yandex', 'naver', 'whale', 'samsung', 'ucbrowser', 'maxthon', 'coccoc', 'qutebrowser',
    // Lightweight/Minimal
    'falkon', 'midori', 'epiphany', 'gnome-web', 'konqueror', 'otter-browser', 'nyxt',
    // Gaming browsers (actual browsers, not launchers)
    'overwolf',
    // Legacy (still in use)
    'iexplore', 'safari',
    // Other notable browsers
    'slimbrowser', 'avant', 'lunascape', 'surf', 'dillo', 'netsurf', 'links', 'lynx', 'w3m',
    'polypane', 'responsively', 'blisk', 'ghost', 'puffin', 'cent', 'thorium', 'mercury',
    'aloha', 'kiwi', 'bromite', 'mull', 'fennec', 'iceraven'
];

// Known websites - CHECK THESE FIRST, they take priority
// Each entry has: name (display), domain (for favicon), short (2-letter fallback), patterns (matching)
const KNOWN_WEBSITES = {
    // Video & Streaming
    'youtube': { name: 'youtube.com', domain: 'youtube.com', short: 'YT', patterns: ['youtube', '- youtube'] },
    'netflix': { name: 'netflix.com', domain: 'netflix.com', short: 'NF', patterns: ['netflix'] },
    'twitch': { name: 'twitch.tv', domain: 'twitch.tv', short: 'TW', patterns: ['twitch'] },
    'primevideo': { name: 'primevideo.com', domain: 'primevideo.com', short: 'PV', patterns: ['prime video', 'primevideo', 'amazon prime'] },
    'disneyplus': { name: 'disneyplus.com', domain: 'disneyplus.com', short: 'D+', patterns: ['disney+', 'disneyplus'] },
    'hotstar': { name: 'hotstar.com', domain: 'hotstar.com', short: 'HS', patterns: ['hotstar'] },
    'hulu': { name: 'hulu.com', domain: 'hulu.com', short: 'HU', patterns: ['hulu'] },
    'hbomax': { name: 'max.com', domain: 'max.com', short: 'MX', patterns: ['hbo max', 'max.com'] },
    'vimeo': { name: 'vimeo.com', domain: 'vimeo.com', short: 'VM', patterns: ['vimeo'] },
    
    // Social Media
    'twitter': { name: 'x.com', domain: 'x.com', short: 'X', patterns: ['twitter', 'x.com', 'x.com/'] },
    'facebook': { name: 'facebook.com', domain: 'facebook.com', short: 'FB', patterns: ['facebook'] },
    'instagram': { name: 'instagram.com', domain: 'instagram.com', short: 'IG', patterns: ['instagram'] },
    'reddit': { name: 'reddit.com', domain: 'reddit.com', short: 'RD', patterns: ['reddit'] },
    'linkedin': { name: 'linkedin.com', domain: 'linkedin.com', short: 'LI', patterns: ['linkedin'] },
    'pinterest': { name: 'pinterest.com', domain: 'pinterest.com', short: 'PI', patterns: ['pinterest'] },
    'tiktok': { name: 'tiktok.com', domain: 'tiktok.com', short: 'TT', patterns: ['tiktok'] },
    'snapchat': { name: 'snapchat.com', domain: 'snapchat.com', short: 'SC', patterns: ['snapchat'] },
    'threads': { name: 'threads.net', domain: 'threads.net', short: 'TH', patterns: ['threads.net', '- threads'] },
    
    // Messaging
    'discord': { name: 'discord.com', domain: 'discord.com', short: 'DC', patterns: ['discord'] },
    'whatsapp': { name: 'whatsapp.com', domain: 'whatsapp.com', short: 'WA', patterns: ['whatsapp'] },
    'whatsapp-web': { name: 'web.whatsapp.com', domain: 'whatsapp.com', short: 'WA', patterns: ['web.whatsapp'] },
    'telegram': { name: 'telegram.org', domain: 'telegram.org', short: 'TG', patterns: ['telegram'] },
    'slack': { name: 'slack.com', domain: 'slack.com', short: 'SL', patterns: ['slack'] },
    'teams': { name: 'teams.microsoft.com', domain: 'microsoft.com', short: 'TM', patterns: ['microsoft teams', 'teams.microsoft'] },
    'zoom': { name: 'zoom.us', domain: 'zoom.us', short: 'ZM', patterns: ['zoom'] },
    
    // Music
    'spotify': { name: 'spotify.com', domain: 'spotify.com', short: 'SP', patterns: ['spotify'] },
    'soundcloud': { name: 'soundcloud.com', domain: 'soundcloud.com', short: 'SC', patterns: ['soundcloud'] },
    'applemusic': { name: 'music.apple.com', domain: 'apple.com', short: 'AM', patterns: ['apple music', 'music.apple'] },
    'youtubemusic': { name: 'music.youtube.com', domain: 'youtube.com', short: 'YM', patterns: ['youtube music', 'music.youtube'] },
    
    // Dev & Coding
    'github': { name: 'github.com', domain: 'github.com', short: 'GH', patterns: ['github'] },
    'gitlab': { name: 'gitlab.com', domain: 'gitlab.com', short: 'GL', patterns: ['gitlab'] },
    'stackoverflow': { name: 'stackoverflow.com', domain: 'stackoverflow.com', short: 'SO', patterns: ['stack overflow', 'stackoverflow'] },
    'npm': { name: 'npmjs.com', domain: 'npmjs.com', short: 'NP', patterns: ['npmjs', '- npm'] },
    'codepen': { name: 'codepen.io', domain: 'codepen.io', short: 'CP', patterns: ['codepen'] },
    'codesandbox': { name: 'codesandbox.io', domain: 'codesandbox.io', short: 'CS', patterns: ['codesandbox'] },
    'replit': { name: 'replit.com', domain: 'replit.com', short: 'RP', patterns: ['replit'] },
    'vercel': { name: 'vercel.com', domain: 'vercel.com', short: 'VC', patterns: ['vercel'] },
    'netlify': { name: 'netlify.com', domain: 'netlify.com', short: 'NL', patterns: ['netlify'] },
    'leetcode': { name: 'leetcode.com', domain: 'leetcode.com', short: 'LC', patterns: ['leetcode'] },
    'hackerrank': { name: 'hackerrank.com', domain: 'hackerrank.com', short: 'HR', patterns: ['hackerrank'] },
    'codeforces': { name: 'codeforces.com', domain: 'codeforces.com', short: 'CF', patterns: ['codeforces'] },
    'geeksforgeeks': { name: 'geeksforgeeks.org', domain: 'geeksforgeeks.org', short: 'GF', patterns: ['geeksforgeeks', 'gfg'] },
    'mdn': { name: 'developer.mozilla.org', domain: 'mozilla.org', short: 'MD', patterns: ['mdn web docs', 'developer.mozilla'] },
    'devdocs': { name: 'devdocs.io', domain: 'devdocs.io', short: 'DD', patterns: ['devdocs'] },
    
    // Google Suite
    'google-docs': { name: 'docs.google.com', domain: 'google.com', short: 'GD', patterns: ['google docs', 'docs.google'] },
    'google-sheets': { name: 'sheets.google.com', domain: 'google.com', short: 'GS', patterns: ['google sheets', 'sheets.google'] },
    'google-drive': { name: 'drive.google.com', domain: 'google.com', short: 'DR', patterns: ['google drive', 'drive.google'] },
    'google-slides': { name: 'slides.google.com', domain: 'google.com', short: 'SL', patterns: ['google slides', 'slides.google'] },
    'google-meet': { name: 'meet.google.com', domain: 'google.com', short: 'MT', patterns: ['google meet', 'meet.google'] },
    'google-calendar': { name: 'calendar.google.com', domain: 'google.com', short: 'GC', patterns: ['google calendar', 'calendar.google'] },
    'gmail': { name: 'gmail.com', domain: 'gmail.com', short: 'GM', patterns: ['gmail', 'mail.google'] },
    'google': { name: 'google.com', domain: 'google.com', short: 'G', patterns: ['- google search', 'google.com/search', 'google search'] },
    
    // Other Search
    'bing': { name: 'bing.com', domain: 'bing.com', short: 'BI', patterns: ['- bing', '| bing'] },
    'duckduckgo': { name: 'duckduckgo.com', domain: 'duckduckgo.com', short: 'DD', patterns: ['duckduckgo'] },
    
    // Productivity
    'notion': { name: 'notion.so', domain: 'notion.so', short: 'NO', patterns: ['notion'] },
    'trello': { name: 'trello.com', domain: 'trello.com', short: 'TR', patterns: ['trello'] },
    'asana': { name: 'asana.com', domain: 'asana.com', short: 'AS', patterns: ['asana'] },
    'jira': { name: 'atlassian.net', domain: 'atlassian.net', short: 'JR', patterns: ['jira'] },
    'confluence': { name: 'confluence.com', domain: 'atlassian.net', short: 'CF', patterns: ['confluence'] },
    'linear': { name: 'linear.app', domain: 'linear.app', short: 'LN', patterns: ['linear'] },
    'figma': { name: 'figma.com', domain: 'figma.com', short: 'FG', patterns: ['figma'] },
    'canva': { name: 'canva.com', domain: 'canva.com', short: 'CA', patterns: ['canva'] },
    'miro': { name: 'miro.com', domain: 'miro.com', short: 'MR', patterns: ['miro'] },
    
    // AI Tools
    'chatgpt': { name: 'chat.openai.com', domain: 'openai.com', short: 'AI', patterns: ['chatgpt', 'chat.openai', '- openai'] },
    'claude': { name: 'claude.ai', domain: 'claude.ai', short: 'CL', patterns: ['claude.ai', '- claude'] },
    'gemini': { name: 'gemini.google.com', domain: 'google.com', short: 'GE', patterns: ['gemini.google', '- gemini'] },
    'copilot': { name: 'copilot.microsoft.com', domain: 'microsoft.com', short: 'CP', patterns: ['copilot.microsoft', 'microsoft copilot'] },
    'perplexity': { name: 'perplexity.ai', domain: 'perplexity.ai', short: 'PX', patterns: ['perplexity'] },
    'meta-ai': { name: 'meta.ai', domain: 'meta.ai', short: 'MA', patterns: ['meta.ai', '- meta ai'] },
    'midjourney': { name: 'midjourney.com', domain: 'midjourney.com', short: 'MJ', patterns: ['midjourney'] },
    
    // Email
    'outlook': { name: 'outlook.com', domain: 'outlook.com', short: 'OL', patterns: ['outlook', 'outlook.live'] },
    'yahoo': { name: 'yahoo.com', domain: 'yahoo.com', short: 'YH', patterns: ['yahoo'] },
    'protonmail': { name: 'proton.me', domain: 'proton.me', short: 'PM', patterns: ['protonmail', 'proton.me'] },
    
    // Shopping
    'amazon': { name: 'amazon.com', domain: 'amazon.com', short: 'AZ', patterns: ['amazon'] },
    'flipkart': { name: 'flipkart.com', domain: 'flipkart.com', short: 'FK', patterns: ['flipkart'] },
    'ebay': { name: 'ebay.com', domain: 'ebay.com', short: 'EB', patterns: ['ebay'] },
    'etsy': { name: 'etsy.com', domain: 'etsy.com', short: 'ET', patterns: ['etsy'] },
    'aliexpress': { name: 'aliexpress.com', domain: 'aliexpress.com', short: 'AE', patterns: ['aliexpress'] },
    
    // Knowledge & Reading
    'wikipedia': { name: 'wikipedia.org', domain: 'wikipedia.org', short: 'WK', patterns: ['wikipedia'] },
    'quora': { name: 'quora.com', domain: 'quora.com', short: 'QA', patterns: ['quora'] },
    'medium': { name: 'medium.com', domain: 'medium.com', short: 'MD', patterns: ['medium'] },
    'substack': { name: 'substack.com', domain: 'substack.com', short: 'SS', patterns: ['substack'] },
    'devto': { name: 'dev.to', domain: 'dev.to', short: 'DT', patterns: ['dev.to', 'dev community'] },
    'hackernews': { name: 'news.ycombinator.com', domain: 'ycombinator.com', short: 'HN', patterns: ['hacker news', 'ycombinator'] },
    
    // Cloud & Storage
    'dropbox': { name: 'dropbox.com', domain: 'dropbox.com', short: 'DB', patterns: ['dropbox'] },
    'onedrive': { name: 'onedrive.live.com', domain: 'microsoft.com', short: 'OD', patterns: ['onedrive'] },
    'icloud': { name: 'icloud.com', domain: 'icloud.com', short: 'IC', patterns: ['icloud'] },
    
    // Finance
    'paypal': { name: 'paypal.com', domain: 'paypal.com', short: 'PP', patterns: ['paypal'] },
    'stripe': { name: 'stripe.com', domain: 'stripe.com', short: 'ST', patterns: ['stripe'] },
};


// Browser names to filter out from website detection (display names)
const BROWSER_NAMES = [
    // Mainstream
    'brave', 'chrome', 'google chrome', 'edge', 'microsoft edge', 'firefox', 'mozilla firefox',
    'opera', 'opera gx', 'vivaldi', 'chromium', 'safari', 'apple safari',
    // Privacy/Alternative
    'tor browser', 'waterfox', 'librewolf', 'floorp', 'zen browser', 'pale moon', 'basilisk', 'seamonkey',
    'mullvad browser', 'ungoogled chromium',
    // AI/Modern
    'comet', 'comet browser', 'arc', 'arc browser', 'sigmaos', 'sidekick',
    // Regional
    'yandex browser', 'naver whale', 'whale', 'samsung internet', 'uc browser', 'maxthon', 'coc coc',
    // Minimal
    'min', 'min browser', 'falkon', 'midori', 'epiphany', 'gnome web', 'konqueror', 'otter browser', 'qutebrowser',
    // Other
    'cent browser', 'thorium', 'mercury', 'ghost browser', 'polypane', 'responsively', 'blisk'
];

// Comprehensive browser display name lookup (process name → human-readable label)
const BROWSER_DISPLAY_NAMES = {
    'msedge': 'Edge',           'edge': 'Edge',
    'chrome': 'Chrome',         'chromium': 'Chromium',
    'brave': 'Brave',           'firefox': 'Firefox',
    'opera': 'Opera',           'operagx': 'Opera GX',
    'vivaldi': 'Vivaldi',       'safari': 'Safari',
    'waterfox': 'Waterfox',     'librewolf': 'LibreWolf',
    'floorp': 'Floorp',         'zen': 'Zen Browser',
    'palemoon': 'Pale Moon',    'basilisk': 'Basilisk',
    'seamonkey': 'SeaMonkey',   'tor': 'Tor Browser',
    'mullvad': 'Mullvad Browser', 'arc': 'Arc',
    'comet': 'Comet',           'sigmaos': 'SigmaOS',
    'sidekick': 'Sidekick',     'yandex': 'Yandex',
    'whale': 'Naver Whale',     'ucbrowser': 'UC Browser',
    'maxthon': 'Maxthon',       'qutebrowser': 'quteBrowser',
    'falkon': 'Falkon',         'midori': 'Midori',
    'iexplore': 'Internet Explorer',
    'ungoogled-chromium': 'Ungoogled Chromium',
};

function formatBrowserName(processName) {
    if (!processName) return 'Unknown';
    const lower = processName.toLowerCase();
    if (BROWSER_DISPLAY_NAMES[lower]) return BROWSER_DISPLAY_NAMES[lower];
    // Capitalize first letter as a reasonable fallback for any unlisted browser
    return lower.charAt(0).toUpperCase() + lower.slice(1);
}

// In-memory: tracks the last visited website per browser to detect tab switches.
// Intentionally NOT persisted — resets cleanly on every app launch so the first
// website opened after restart is always counted as a fresh visit.
const lastWebsitePerBrowser = new Map();

// Check if process is a browser
function isBrowser(processName) {
    if (!processName) return false;
    const name = processName.toLowerCase();
    return BROWSERS.some(browser => name.includes(browser));
}

// Parse website from browser title - DOMAINS FIRST!
// Goal: Extract actual domain names for ANY website, not just known ones
// Detect private/incognito windows
function isPrivateWindow(title) {
    if (!title) return false;
    const lower = title.toLowerCase();
    return (
        lower.includes('incognito') ||
        lower.includes('private window') ||
        lower.includes('inprivate') ||
        lower.includes('private browsing')
    );
}

// Parse website from browser title - DOMAINS FIRST!
// Goal: Extract actual domain names for ANY website, not just known ones
// IMPORTANT: We now track New Tab pages to ensure browser time stays in sync
function parseWebsiteFromTitle(title) {
    if (!title) return null;

    const titleLower = title.toLowerCase();
    const isPrivate = isPrivateWindow(title);

    // Skip completely empty or browser-only titles
    if (titleLower === '' || BROWSER_NAMES.some(b => titleLower === b)) {
        return null;
    }

    // Track "New Tab" as a special website so total browser time stays in sync
    if (titleLower.startsWith('new tab') || titleLower === 'new tab' || titleLower.includes('- new tab')) {
        return {
            id: 'new-tab',
            name: 'New Tab',
            domain: null,
            isNewTab: true,
            isPrivate: isPrivate
        };
    }

    // PRIORITY 1: Check known websites FIRST (most reliable)
    // e.g. "Funny Cat Video - YouTube" -> youtube.com
    for (const [id, info] of Object.entries(KNOWN_WEBSITES)) {
        for (const pattern of info.patterns) {
            if (titleLower.includes(pattern.toLowerCase())) {
                return {
                    id,
                    name: info.domain || info.name,
                    domain: info.domain,
                    isPrivate: isPrivate
                };
            }
        }
    }

    // PRIORITY 2: Look for a DOMAIN in the title
    // Extended TLD support — covers mainstream, country-code, and modern generic TLDs
    const domainRegex = /\b([a-z0-9][-a-z0-9]*\.(?:com|org|net|io|co|in|us|uk|gov|edu|info|biz|me|tv|site|xyz|app|dev|ai|so|gg|to|ly|sh|fm|is|cc|vc|ac|ws|club|online|tech|store|digital|agency|design|studio|pro|world|cloud|live|blog|news|space|zone|media|ca|de|fr|jp|au|br|cn|ru|it|nl|pl|es|se|no|dk|fi|be|ch|at|cz|sk|hu|ro|tr|mx|ar|cl|id|th|vn|sg|my|ph|ng|za|ke|eg|pe|ua|by|kz|uz))\b/i;
    const domainMatch = titleLower.match(domainRegex);
    if (domainMatch && domainMatch[1]) {
        const domain = domainMatch[1].toLowerCase();
        // Don't match version numbers like "1.0" or file extensions
        if (!domain.match(/^\d+\./) && domain.length > 3) {
            return {
                id: domain.replace(/\./g, '-'),
                name: domain,
                domain: domain,
                isPrivate: isPrivate
            };
        }
    }

    // PRIORITY 3: Smart Separator Logic for unknown sites
    // Split on ALL separator types at once so mixed titles like
    // "Article | Site - Chrome" are parsed correctly in a single pass.
    const SEP_REGEX = / [-|\u2014\u00b7:] /;
    if (SEP_REGEX.test(title)) {
        const parts = title.split(/ [-|\u2014\u00b7:] /).map(p => p.trim()).filter(Boolean);

        // Filter out parts that exactly match a browser name or contain only the browser name
        const cleanParts = parts.filter(p => !BROWSER_NAMES.some(b => p.toLowerCase() === b.toLowerCase()));

        if (cleanParts.length > 0) {
            // Site name is usually the LAST non-browser segment ("Page - SiteName - Edge")
            let bestPart = cleanParts[cleanParts.length - 1];

            // Prefer a segment that looks like a domain (contains a dot followed by letters)
            for (const p of cleanParts) {
                if (/[a-z0-9]\.[a-z]{2,}/i.test(p)) {
                    bestPart = p;
                    break;
                }
            }

            // If no domain-like segment, pick the shortest meaningful part
            // (brand names are usually shorter than page titles)
            if (!/[a-z0-9]\.[a-z]{2,}/i.test(bestPart)) {
                const SKIP_WORDS = new Set(['home', 'login', 'signin', 'welcome', 'index', 'page', 'untitled']);
                let minLen = bestPart.length;
                for (const p of cleanParts) {
                    if (p.length > 2 && p.length < minLen && !SKIP_WORDS.has(p.toLowerCase())) {
                        minLen = p.length;
                        bestPart = p;
                    }
                }
            }

            const cleanName = bestPart.length > 40 ? bestPart.substring(0, 40) + '...' : bestPart;
            return {
                id: bestPart.toLowerCase().replace(/[^a-z0-9.]/g, '-').substring(0, 30),
                name: cleanName,
                domain: /[a-z0-9]\.[a-z]{2,}/i.test(cleanName) ? cleanName.toLowerCase() : null,
                isPrivate: isPrivate
            };
        }
    }

    // PRIORITY 4: If still nothing, use the whole title (cleaned)
    const cleanTitle = title.replace(/\s*[-|]\s*(brave|chrome|edge|firefox|opera|vivaldi|microsoft edge|google chrome).*$/i, '').trim();
    if (cleanTitle.length > 2 && cleanTitle.toLowerCase() !== 'new tab') {
        return {
            id: cleanTitle.toLowerCase().replace(/[^a-z0-9.]/g, '-').substring(0, 30),
            name: cleanTitle.length > 40 ? cleanTitle.substring(0, 40) + '...' : cleanTitle,
            domain: null,
            isPrivate: isPrivate
        };
    }

    // PRIORITY 5: FALLBACK - We MUST always return something for browser time to sync
    // If we truly can't parse anything meaningful, use "Unknown Page"
    // This ensures every second in the browser is accounted for
    return {
        id: 'unknown-page',
        name: title ? (title.length > 30 ? title.substring(0, 30) + '...' : title) : 'Unknown Page',
        domain: null,
        isPrivate: isPrivate,
        isUnknown: true
    };
}

// Store website usage with browser info
// KEY PRINCIPLE: Same website + different browser = SEPARATE entries
// This preserves context (YouTube on Chrome for education vs YouTube on Opera for entertainment)
function recordWebsiteUsage(website, seconds = 5, browserName = '') {
    if (!website) return;

    // Private / incognito windows: aggregate into an opaque "Private Browsing" bucket so
    // the browser-time → website-time sync invariant holds, but no specific site is stored.
    const trackable = website.isPrivate ? {
        id: 'private-browsing',
        name: 'Private Browsing',
        domain: null,
        isPrivate: true,
        isNewTab: false,
    } : website;

    // Use local date string (YYYY-MM-DD)
    const now = new Date();
    const today = now.toLocaleDateString('en-CA', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    });

    // Get from memory cache via db.js
    const websiteData = getWebsiteUsage();

    if (!websiteData[today]) {
        websiteData[today] = { websites: {}, totalSeconds: 0, byBrowser: {} };
    }

    const dayData = websiteData[today];

    // Format browser name using the comprehensive lookup table
    const formattedBrowser = formatBrowserName(browserName);

    // IMPORTANT: Create composite ID with browser - same site on different browsers are DIFFERENT contexts
    const uniqueId = `${trackable.id}::${formattedBrowser}`;

    // Track last website per browser to detect tab switches (in-memory only — resets on restart
    // so the first website after each launch always counts as a fresh visit).
    const lastWebsite = lastWebsitePerBrowser.get(formattedBrowser);
    const isNewVisit = lastWebsite !== uniqueId;
    lastWebsitePerBrowser.set(formattedBrowser, uniqueId);

    // Initialize browser totals if needed
    if (!dayData.byBrowser[formattedBrowser]) {
        dayData.byBrowser[formattedBrowser] = 0;
    }

    if (!dayData.websites[uniqueId]) {
        dayData.websites[uniqueId] = {
            name: trackable.name,
            domain: trackable.domain || trackable.name,
            browser: formattedBrowser,
            isPrivate: !!trackable.isPrivate,
            isNewTab: !!trackable.isNewTab,
            seconds: 0,
            visits: 0,
            lastVisit: null
        };
    }

    const siteData = dayData.websites[uniqueId];

    // Update totals - ALL time counts, including New Tab (to match browser app time)
    siteData.seconds += seconds;
    siteData.lastVisit = new Date().toISOString();
    dayData.totalSeconds += seconds;
    dayData.byBrowser[formattedBrowser] += seconds;

    // Increment visits only when switching TO this site (not every tick)
    if (isNewVisit) {
        siteData.visits += 1;
    }

    // Update memory cache (will be flushed by db.js)
    updateWebsiteUsage(websiteData);
}

// Get today's website usage
function getTodayWebsiteUsage() {
    // Use local date string (YYYY-MM-DD)
    const now = new Date();
    const today = now.toLocaleDateString('en-CA', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    });
    const websiteData = getWebsiteUsage();

    if (!websiteData[today]) {
        return { websites: [], totalSeconds: 0, byBrowser: {} };
    }

    const dayData = websiteData[today];
    
    // Filter out internal tracking keys (like _last::Chrome)
    const websites = Object.entries(dayData.websites)
        .filter(([id]) => !id.startsWith('_'))
        .map(([id, data]) => ({
            id,
            // Extract the site name (before ::Browser)
            siteId: id.split('::')[0],
            name: data.name || id.split('::')[0],
            domain: data.domain || data.name || id.split('::')[0],
            browser: data.browser || id.split('::')[1] || 'Unknown',
            isNewTab: !!data.isNewTab,
            isPrivate: !!data.isPrivate,
            isUnknown: !!data.isUnknown,
            seconds: data.seconds || 0,
            visits: data.visits || 0,
            lastVisit: data.lastVisit
        }))
        .sort((a, b) => b.seconds - a.seconds);

    return {
        websites,
        totalSeconds: dayData.totalSeconds || 0,
        byBrowser: dayData.byBrowser || {}
    };
}

// Get top websites
function getTopWebsites(limit = 10) {
    const { websites } = getTodayWebsiteUsage();
    return websites.slice(0, limit);
}

// Get browser usage stats
function getBrowserStats() {
    // Use local date string
    const now = new Date();
    const today = now.toLocaleDateString('en-CA', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    });
    const websiteData = getWebsiteUsage();
    const dayData = websiteData[today] || { websites: {}, totalSeconds: 0 };

    const topSite = getTopWebsites(1)[0];

    return {
        totalBrowserTime: dayData.totalSeconds,
        uniqueSites: Object.keys(dayData.websites).length,
        topSite: topSite?.name || 'None'
    };
}

// Get weekly website usage
function getWeeklyWebsiteUsage() {
    const websiteData = getWebsiteUsage();
    const weekData = [];

    for (let i = 6; i >= 0; i--) {
        const date = new Date();
        date.setDate(date.getDate() - i);
        // Use local date string
        const dateStr = date.toLocaleDateString('en-CA', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
        });
        const dayData = websiteData[dateStr] || { totalSeconds: 0 };

        weekData.push({
            date: dateStr,
            day: date.toLocaleDateString('en', { weekday: 'short' }),
            totalSeconds: dayData.totalSeconds
        });
    }

    return weekData;
}

// Not using categories
function getWebsitesByCategory() {
    return [];
}

module.exports = {
    BROWSERS,
    KNOWN_WEBSITES,
    isBrowser,
    parseWebsiteFromTitle,
    recordWebsiteUsage,
    getTodayWebsiteUsage,
    getWebsitesByCategory,
    getTopWebsites,
    getBrowserStats,
    getWeeklyWebsiteUsage,
};
