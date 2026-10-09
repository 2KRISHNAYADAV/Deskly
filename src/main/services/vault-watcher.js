/**
 * Vault Watcher Service
 * 
 * Real-time monitoring of the vault folder to detect:
 * 1. Vault folder deletion → triggers onboarding
 * 2. Critical file deletion/corruption → triggers repair UI
 * 
 * Uses fs.watch for efficient file system monitoring.
 */

const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');

class VaultWatcher extends EventEmitter {
    constructor(vaultManager) {
        super();
        this.vaultManager = vaultManager;
        this.watcher = null;
        this.desklyWatcher = null;
        this.isWatching = false;
        this.debounceTimer = null;
        this.lastHealthCheck = null;

        // Debounce settings
        this.DEBOUNCE_MS = 500; // Wait 500ms after last change before checking
        this.HEALTH_CHECK_COOLDOWN = 2000; // Don't recheck more than every 2s
    }

    /**
     * Start watching the vault folder
     */
    start() {
        const vaultPath = this.vaultManager.getVaultPath();

        if (!vaultPath) {
            console.log('[VaultWatcher] No vault path configured, not starting');
            return false;
        }

        if (this.isWatching) {
            console.log('[VaultWatcher] Already watching');
            return true;
        }

        try {
            // Check if vault exists before watching
            if (!fs.existsSync(vaultPath)) {
                console.log('[VaultWatcher] Vault folder does not exist');
                this.emit('vault:deleted', { path: vaultPath });
                return false;
            }

            // Watch the vault root folder
            this.watcher = fs.watch(vaultPath, { persistent: false }, (eventType, filename) => {
                this.handleVaultChange(eventType, filename, vaultPath);
            });

            this.watcher.on('error', (error) => {
                this.handleWatcherError(error, vaultPath);
            });

            // Also watch the .deskly folder specifically (critical config files)
            const dwbPath = path.join(vaultPath, '.deskly');
            if (fs.existsSync(dwbPath)) {
                this.desklyWatcher = fs.watch(dwbPath, { persistent: false }, (eventType, filename) => {
                    this.handleDwbChange(eventType, filename, dwbPath);
                });

                this.desklyWatcher.on('error', (error) => {
                    console.warn('[VaultWatcher] .deskly watcher error:', error.message);
                });
            }

            this.isWatching = true;
            console.log(`[VaultWatcher] 👁️ Started watching: ${vaultPath}`);
            return true;

        } catch (err) {
            console.error('[VaultWatcher] Failed to start:', err);
            return false;
        }
    }

    /**
     * Stop watching
     */
    stop() {
        if (this.watcher) {
            this.watcher.close();
            this.watcher = null;
        }
        if (this.desklyWatcher) {
            this.desklyWatcher.close();
            this.desklyWatcher = null;
        }
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
            this.debounceTimer = null;
        }
        this.isWatching = false;
        console.log('[VaultWatcher] Stopped');
    }

    /**
     * Restart watching (e.g., after vault location change)
     */
    restart() {
        this.stop();
        return this.start();
    }

    /**
     * Handle changes in the vault root folder
     */
    handleVaultChange(eventType, filename, vaultPath) {
        // Check if vault folder still exists
        if (!fs.existsSync(vaultPath)) {
            console.log('[VaultWatcher] 🚨 Vault folder deleted!');
            this.stop();
            this.emit('vault:deleted', {
                path: vaultPath,
                timestamp: Date.now()
            });
            return;
        }

        // Ignore temporary/system files
        if (this.shouldIgnoreFile(filename)) {
            return;
        }

        // Debounce the health check
        this.scheduleHealthCheck(vaultPath);
    }

    /**
     * Handle changes in the .deskly folder (critical config files)
     */
    handleDwbChange(eventType, filename, dwbPath) {
        const vaultPath = path.dirname(dwbPath);

        // Check if vault still exists
        if (!fs.existsSync(vaultPath)) {
            console.log('[VaultWatcher] 🚨 Vault folder deleted!');
            this.stop();
            this.emit('vault:deleted', { path: vaultPath });
            return;
        }

        // Ignore temporary files
        if (this.shouldIgnoreFile(filename)) {
            return;
        }

        console.log(`[VaultWatcher] .deskly file changed: ${filename}`);

        // Critical files changed - check health with higher priority
        this.scheduleHealthCheck(vaultPath, true);
    }

    /**
     * Handle watcher errors (often means folder was deleted)
     */
    handleWatcherError(error, vaultPath) {
        console.warn('[VaultWatcher] Watch error:', error.message);

        // EPERM or ENOENT usually means the folder was deleted
        if (error.code === 'EPERM' || error.code === 'ENOENT') {
            if (!fs.existsSync(vaultPath)) {
                console.log('[VaultWatcher] 🚨 Vault folder was deleted (detected via error)');
                this.stop();
                this.emit('vault:deleted', {
                    path: vaultPath,
                    error: error.code
                });
            }
        }
    }

    /**
     * Schedule a health check (debounced)
     */
    scheduleHealthCheck(vaultPath, priority = false) {
        // Clear existing timer
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
        }

        // Apply cooldown (don't spam health checks)
        const now = Date.now();
        if (this.lastHealthCheck && (now - this.lastHealthCheck) < this.HEALTH_CHECK_COOLDOWN) {
            if (!priority) {
                return; // Skip non-priority checks during cooldown
            }
        }

        this.debounceTimer = setTimeout(() => {
            this.runHealthCheck(vaultPath);
        }, priority ? 100 : this.DEBOUNCE_MS);
    }

    /**
     * Run a vault health check and emit results
     */
    runHealthCheck(vaultPath) {
        this.lastHealthCheck = Date.now();

        try {
            // Check if vault folder exists first
            if (!fs.existsSync(vaultPath)) {
                this.emit('vault:deleted', { path: vaultPath });
                return;
            }

            // Run full integrity check
            const health = this.vaultManager.checkVaultIntegrity();

            if (!health.healthy) {
                console.log('[VaultWatcher] ⚠️ Vault health issue detected');
                this.emit('vault:health-changed', {
                    healthy: false,
                    ...health,
                    timestamp: Date.now()
                });
            }

        } catch (err) {
            console.error('[VaultWatcher] Health check failed:', err);
        }
    }

    /**
     * Check if a filename should be ignored
     */
    shouldIgnoreFile(filename) {
        if (!filename) return true;

        // Ignore temp files, backup files, system files
        const ignorePatterns = [
            /^\./, // Hidden files (except .deskly which we watch separately)
            /\.tmp$/i,
            /\.bak$/i,
            /\.corrupted\./i,
            /~$/,
            /^Thumbs\.db$/i,
            /^desktop\.ini$/i,
        ];

        return ignorePatterns.some(pattern => pattern.test(filename));
    }

    /**
     * Check if currently watching
     */
    isActive() {
        return this.isWatching;
    }
}

// Singleton instance
let watcherInstance = null;

/**
 * Get or create the vault watcher instance
 */
function getVaultWatcher(vaultManager) {
    if (!watcherInstance) {
        watcherInstance = new VaultWatcher(vaultManager);
    }
    return watcherInstance;
}

/**
 * Start the vault watcher
 */
function startVaultWatcher(vaultManager) {
    const watcher = getVaultWatcher(vaultManager);
    return watcher.start();
}

/**
 * Stop the vault watcher
 */
function stopVaultWatcher() {
    if (watcherInstance) {
        watcherInstance.stop();
    }
}

/**
 * Register callback for vault deletion
 */
function onVaultDeleted(callback) {
    if (watcherInstance) {
        watcherInstance.on('vault:deleted', callback);
    }
}

/**
 * Register callback for health changes
 */
function onVaultHealthChanged(callback) {
    if (watcherInstance) {
        watcherInstance.on('vault:health-changed', callback);
    }
}

module.exports = {
    VaultWatcher,
    getVaultWatcher,
    startVaultWatcher,
    stopVaultWatcher,
    onVaultDeleted,
    onVaultHealthChanged
};

