import React, { useState, useEffect, useRef, useCallback, useMemo, lazy, Suspense } from 'react';
import Titlebar from './components/Titlebar';
import Sidebar from './components/Sidebar';
import ErrorBoundary from './components/ErrorBoundary';
import PersonalizationWizard from './screens/PersonalizationWizard';
import { SafeAPI } from './utils/safeApi';
import { safeGetItem, safeSetItem } from './utils/safeStorage';
import { runWhenBrowserIdle, cancelIdleTask } from './utils/idleScheduler';


// Lazy load screens with preloading capability
const Dashboard = lazy(() => import('./screens/Dashboard'));
const AppUsage = lazy(() => import('./screens/AppUsage'));
const BrowserUsage = lazy(() => import('./screens/BrowserUsage'));
const CategoriesPage = lazy(() => import('./screens/CategoriesPage'));
const AppLimits = lazy(() => import('./screens/AppLimits'));
const AppLock = lazy(() => import('./screens/AppLock'));
const Focus = lazy(() => import('./screens/Focus'));
const Timeline = lazy(() => import('./screens/Timeline'));
const ReportsPage = lazy(() => import('./screens/ReportsPage'));
const Settings = lazy(() => import('./screens/Settings'));
const Onboarding = lazy(() => import('./screens/Onboarding'));

// Attach preload methods
AppUsage.preload = () => import('./screens/AppUsage');
BrowserUsage.preload = () => import('./screens/BrowserUsage');
CategoriesPage.preload = () => import('./screens/CategoriesPage');
ReportsPage.preload = () => import('./screens/ReportsPage');
AppLimits.preload = () => import('./screens/AppLimits');

const screens = {
    dashboard: Dashboard,
    apps: AppUsage,
    browser: BrowserUsage,
    categories: CategoriesPage,
    limits: AppLimits,
    applock: AppLock,
    focus: Focus,
    timeline: Timeline,
    reports: ReportsPage,
    settings: Settings,
};

function normalizeStats(rawStats) {
    if (!rawStats) return { totalSeconds: 0, formattedTotal: '0m', apps: [], categories: {} };
    return {
        totalSeconds: rawStats.totalSeconds || 0,
        formattedTotal: rawStats.formattedTotal || '0m',
        apps: Array.isArray(rawStats.apps) ? rawStats.apps : [],
        categories: rawStats.categories && typeof rawStats.categories === 'object' ? rawStats.categories : {},
        weeklyUsage: rawStats.weeklyUsage || null,
        topApp: rawStats.topApp || null,
        mostUsedCategory: rawStats.mostUsedCategory || null,
    };
}

const ScreenFallback = () => (
    <div className="loading-state-animated" style={{ minHeight: '400px' }}>
        <div className="loading-spinner-smooth" />
    </div>
);

const NAV_ORDER = ['dashboard', 'apps', 'browser', 'categories', 'limits', 'applock', 'focus', 'timeline', 'reports', 'settings'];

function App() {
    const [currentScreen, setCurrentScreen] = useState('dashboard');
    const [prevScreen,    setPrevScreen]    = useState(null);
    const mainContentRef = useRef(null);
    const [theme, setTheme] = useState('dark');
    const [isTracking, setIsTracking] = useState(true);
    const [showOnboarding, setShowOnboarding] = useState(null);
    const [showWizard,    setShowWizard]    = useState(false);
    const [wizardUser,    setWizardUser]    = useState(null);
    const [wizardTopApps, setWizardTopApps] = useState([]);
    const [vaultError, setVaultError] = useState(null);
    const [isRepairing, setIsRepairing] = useState(false);
    const [stats, setStats] = useState({
        totalSeconds: 0,
        formattedTotal: '0m',
        apps: [],
        categories: {},
    });
    const [loading, setLoading] = useState(false);
    const [bridgeMissing, setBridgeMissing] = useState(false);

    const loadStatsTimerRef = useRef(null);
    const loadStatsInFlight = useRef(false);
    const navigationSourceRef = useRef('app_state');

    const loadStats = useCallback(() => {
        clearTimeout(loadStatsTimerRef.current);
        loadStatsTimerRef.current = setTimeout(async () => {
            if (loadStatsInFlight.current) return;
            loadStatsInFlight.current = true;
            try {
                const todayStats = await Promise.race([
                    SafeAPI.getTodayStats(),
                    new Promise((_, reject) => setTimeout(() => reject(new Error('stats timeout')), 10000)),
                ]);
                setStats(normalizeStats(todayStats));
                setLoading(false);
            } catch (e) {
                console.warn('loadStats failed or timed out:', e?.message || e);
            } finally {
                loadStatsInFlight.current = false;
            }
        }, 120);
    }, []);

    const handleRepairVault = useCallback(async () => {
        if (!window.electronAPI?.repairVault) return;

        setIsRepairing(true);
        try {
            const result = await window.electronAPI.repairVault();
            if (result.success) {
                setVaultError(null);
                window.location.reload();
            } else {
                setVaultError(prev => ({
                    ...prev,
                    repairFailed: true,
                    repairError: 'Repair did not complete successfully.'
                }));
            }
        } catch (err) {
            setVaultError(prev => ({
                ...prev,
                repairFailed: true,
                repairError: 'Repair did not complete successfully.'
            }));
        } finally {
            setIsRepairing(false);
        }
    }, []);

    const loadTheme = useCallback(async () => {
        const savedTheme = await SafeAPI.getSetting('theme');
        if (savedTheme) {
            setTheme(savedTheme);
            document.documentElement.setAttribute('data-theme', savedTheme);
        }
    }, []);

    useEffect(() => {
        const initTimer = setTimeout(async () => {
            try {
                const lastScreen = safeGetItem('lastScreen');
                if (lastScreen && screens[lastScreen]) {
                    setCurrentScreen(lastScreen);
                }

                if (window.electronAPI && window.electronAPI.isFirstRun) {
                    const [isFirst, health] = await Promise.all([
                        window.electronAPI.isFirstRun(),
                        window.electronAPI.checkVaultHealth
                            ? window.electronAPI.checkVaultHealth()
                            : Promise.resolve({ healthy: true }),
                    ]);

                    setShowOnboarding(isFirst);

                    if (isFirst) {
                        setLoading(false);
                        return;
                    }

                    if (!health.healthy) {
                        if (!health.vaultExists) {
                            setShowOnboarding(true);
                            setLoading(false);
                            return;
                        } else if (health.criticalIssues?.length > 0) {
                            setVaultError({
                                type: 'critical',
                                message: 'Critical vault files are missing or corrupted',
                                issues: health.criticalIssues,
                                repairable: health.repairable
                            });
                        }
                    }
                } else {
                    setBridgeMissing(true);
                    setShowOnboarding(false);
                }
            } catch (err) {
                setShowOnboarding(false);
            }

            loadTheme();
            loadStats();
            showPersonalizationWizard();
        }, 30);

        const handleFocus = () => { loadStats(); };
        const handleVisibilityChange = () => {
            if (document.visibilityState === 'visible') loadStats();
        };
        window.addEventListener('focus', handleFocus);
        document.addEventListener('visibilitychange', handleVisibilityChange);

        const interval = setInterval(loadStats, 60000);

        let removeIpcListener = () => { };
        if (window.electronAPI?.onRefreshStats) {
            removeIpcListener = window.electronAPI.onRefreshStats(() => {
                loadStats();
            });
        }

        let removeStatsListener = () => { };
        if (window.electronAPI?.onStatsUpdate) {
            removeStatsListener = window.electronAPI.onStatsUpdate((liveStats) => {
                if (liveStats) {
                    setStats(normalizeStats(liveStats));
                }
            });
        }

        let removeVaultDeletedListener = () => { };
        if (window.electronAPI && window.electronAPI.onVaultDeleted) {
            removeVaultDeletedListener = window.electronAPI.onVaultDeleted(() => {
                setVaultError(null);
                setShowOnboarding(true);
            });
        }

        let removeVaultHealthListener = () => { };
        if (window.electronAPI && window.electronAPI.onVaultHealthChanged) {
            removeVaultHealthListener = window.electronAPI.onVaultHealthChanged((health) => {
                if (!health.healthy) {
                    if (health.criticalIssues?.length > 0) {
                        setVaultError({
                            type: 'critical',
                            message: 'Critical vault files are missing or corrupted',
                            issues: health.criticalIssues,
                            repairable: health.repairable,
                            timestamp: health.timestamp
                        });
                    } else if (health.issues?.length > 0) {
                        if (window.electronAPI.repairVault) {
                            window.electronAPI.repairVault().then(result => {
                                if (!result.success) {
                                    setVaultError({
                                        type: 'warning',
                                        message: 'Some vault files could not be repaired',
                                        issues: result.failed || health.issues,
                                        repairable: true
                                    });
                                }
                            });
                        }
                    }
                }
            });
        }

        return () => {
            clearTimeout(initTimer);
            clearTimeout(loadStatsTimerRef.current);
            clearInterval(interval);
            window.removeEventListener('focus', handleFocus);
            document.removeEventListener('visibilitychange', handleVisibilityChange);
            removeIpcListener();
            removeStatsListener();
            removeVaultDeletedListener();
            removeVaultHealthListener();
        };
    }, [loadTheme, loadStats]);

    useEffect(() => {
        if (showOnboarding !== false) return;

        const idleTasks = [
            runWhenBrowserIdle(() => {
                AppUsage.preload?.();
                BrowserUsage.preload?.();
            }),
            runWhenBrowserIdle(() => {
                CategoriesPage.preload?.();
                ReportsPage.preload?.();
            }),
            runWhenBrowserIdle(() => {
                AppLimits.preload?.();
            }),
            runWhenBrowserIdle(() => {
                SafeAPI.getWeeklyStats();
                SafeAPI.getBrowserBreakdown();
            }, 2200),
        ];

        return () => {
            idleTasks.forEach((taskId) => cancelIdleTask(taskId));
        };
    }, [showOnboarding]);

    const handleNavigation = useCallback((screen) => {
        navigationSourceRef.current = 'sidebar_navigation';
        setPrevScreen(currentScreen);
        setCurrentScreen(screen);
        safeSetItem('lastScreen', screen);
    }, [currentScreen]);

    const toggleTheme = useCallback(async () => {
        const newTheme = theme === 'dark' ? 'light' : 'dark';
        setTheme(newTheme);
        document.documentElement.setAttribute('data-theme', newTheme);
        await SafeAPI.setSetting('theme', newTheme);
    }, [theme]);

    const CurrentScreen = useMemo(
        () => screens[currentScreen] || Dashboard,
        [currentScreen]
    );

    const firstScreenRef = useRef(true);
    useEffect(() => {
        if (firstScreenRef.current) { firstScreenRef.current = false; return; }
        const id = requestAnimationFrame(() => {
            mainContentRef.current?.focus({ preventScroll: true });
        });
        return () => cancelAnimationFrame(id);
    }, [currentScreen]);

    const slideClass = (() => {
        if (!prevScreen || prevScreen === currentScreen) return 'nav-appear';
        const pi = NAV_ORDER.indexOf(prevScreen);
        const ci = NAV_ORDER.indexOf(currentScreen);
        if (pi === -1 || ci === -1) return 'nav-appear';
        return ci > pi ? 'nav-forward' : 'nav-backward';
    })();

    const showPersonalizationWizard = useCallback(async () => {
        if (safeGetItem('deskly_wizardDone')) return;
        const apps = await SafeAPI.getAppUsage({ limit: 12 }).catch(() => []);
        setWizardUser(null);
        setWizardTopApps(Array.isArray(apps) ? apps : []);
        setShowWizard(true);
    }, []);

    const handleOnboardingComplete = async () => {
        setShowOnboarding(false);
        setVaultError(null);
        loadTheme();
        loadStats();
        showPersonalizationWizard();
    };

    if (bridgeMissing) {
        return (
            <div style={{
                position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column',
                alignItems: 'center', justifyContent: 'center', gap: '14px', padding: '32px',
                textAlign: 'center', background: 'var(--surface, #0b0b0f)', color: 'var(--on-surface, #e5e7eb)',
            }}>
                <span className="material-symbols-rounded" style={{ fontSize: 44, opacity: 0.8 }} aria-hidden="true">power_off</span>
                <h2 style={{ margin: 0, fontSize: 18 }}>Deskly Academic Edition</h2>
                <p style={{ margin: 0, maxWidth: 420, fontSize: 14, opacity: 0.75 }}>
                    The app couldn't connect to its desktop bridge. Please restart Deskly.
                </p>
                <button className="btn btn-primary" onClick={() => window.location.reload()}>Reload</button>
            </div>
        );
    }

    if (vaultError) {
        return (
            <>
                <Titlebar />
                <div className="vault-error-screen" style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    height: '100vh',
                    padding: '2rem',
                    textAlign: 'center',
                    background: 'var(--surface)'
                }}>
                    <div style={{ fontSize: '4rem', marginBottom: '1rem' }}><span className="material-symbols-rounded" style={{ fontSize: '4rem', color: 'var(--warning)' }} aria-hidden="true">warning</span></div>
                    <h1 className="page-title" style={{ marginBottom: '0.5rem' }}>
                        Vault Issue Detected
                    </h1>
                    <p className="page-subtitle" style={{ maxWidth: '500px', marginBottom: '1.5rem' }}>
                        We found a storage issue and paused loading to protect your data.
                    </p>

                    {vaultError.issues && (
                        <div style={{
                            background: 'var(--surface-container)',
                            border: '1px solid var(--outline-variant)',
                            borderRadius: 'var(--shape-corner-medium)',
                            padding: '1rem',
                            marginBottom: '1.5rem',
                            maxWidth: '500px',
                            textAlign: 'left'
                        }}>
                            <p style={{ color: 'var(--on-surface-variant)', fontSize: 'var(--body-small)', marginBottom: '0.5rem' }}>
                                Affected items: {vaultError.issues.length}
                            </p>
                            <p style={{ color: 'var(--on-surface-muted)', fontSize: 'var(--label-small)' }}>
                                Use Repair Vault to restore healthy files automatically.
                            </p>
                        </div>
                    )}

                    {vaultError.repairFailed && (
                        <p style={{ color: 'var(--error)', marginBottom: '1rem', fontSize: 'var(--body-small)' }}>
                            Repair did not complete successfully.
                        </p>
                    )}

                    <div style={{ display: 'flex', gap: 'var(--spacing-md)', flexWrap: 'wrap', justifyContent: 'center' }}>
                        {!vaultError.repairFailed && (
                            <button
                                onClick={handleRepairVault}
                                disabled={isRepairing}
                                className="refined-btn primary"
                                style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--spacing-sm)', padding: '10px 20px', opacity: isRepairing ? 0.7 : 1, cursor: isRepairing ? 'wait' : 'pointer' }}
                            >
                                <span className="material-symbols-rounded" style={{ fontSize: 18 }} aria-hidden="true">build</span>
                                {isRepairing ? 'Repairing...' : 'Repair Vault'}
                            </button>
                        )}
                        <button
                            onClick={async () => {
                                if (window.electronAPI?.nukeVault) {
                                    await window.electronAPI.nukeVault();
                                }
                                setVaultError(null);
                                setShowOnboarding(true);
                            }}
                            className={vaultError.repairFailed ? 'refined-btn primary' : 'refined-btn'}
                            style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--spacing-sm)', padding: '10px 20px' }}
                        >
                            <span className="material-symbols-rounded" style={{ fontSize: 18 }} aria-hidden="true">restart_alt</span>
                            Start Fresh
                        </button>
                    </div>

                    <p style={{ color: 'var(--on-surface-variant)', fontSize: 'var(--label-medium)', marginTop: '2rem', maxWidth: '400px', opacity: 0.7 }}>
                        {vaultError.repairFailed
                            ? 'Your vault is corrupted beyond repair. Click "Start Fresh" to create a new vault. Your old data will be lost.'
                            : 'Your data is stored in a local folder. If you accidentally deleted or modified files, we can try to repair them.'
                        }
                    </p>
                </div>
            </>
        );
    }

    if (showOnboarding === true) {
        return (
            <>
                <Titlebar />
                <Suspense fallback={null}>
                    <Onboarding onComplete={handleOnboardingComplete} />
                </Suspense>
            </>
        );
    }

    if (showOnboarding === null) {
        return (
            <>
                <Titlebar />
                <div className="loading-screen">
                    <div className="loading-spinner-smooth" />
                </div>
            </>
        );
    }

    return (
        <>
            <Titlebar />
            <div className="app-container">
                <ErrorBoundary>
                    <Sidebar
                        currentScreen={currentScreen}
                        onNavigate={handleNavigation}
                    />
                </ErrorBoundary>
                <main className="main-content" ref={mainContentRef} tabIndex={-1} aria-label="Main content">
                    <ErrorBoundary name="screen" resetKeys={[currentScreen]}>
                        {loading ? (
                            <div className="loading-state-animated" style={{ minHeight: '100%' }}>
                                <div className="loading-spinner-smooth" />
                                <p className="loading-text-animated">Loading...</p>
                            </div>
                        ) : (
                            <Suspense fallback={<ScreenFallback />}>
                                <div key={currentScreen} className={`page-transition-wrapper ${slideClass}`}>
                                    <CurrentScreen
                                        stats={stats}
                                        theme={theme}
                                        onThemeToggle={toggleTheme}
                                        onRefresh={loadStats}
                                        onNavigate={handleNavigation}
                                    />
                                </div>
                            </Suspense>
                        )}
                    </ErrorBoundary>
                </main>
            </div>

            {showWizard && (
                <PersonalizationWizard
                    userName={wizardUser}
                    topApps={wizardTopApps}
                    onComplete={() => {
                        safeSetItem('deskly_wizardDone', '1');
                        setShowWizard(false);
                    }}
                />
            )}
        </>
    );
}

export default App;
