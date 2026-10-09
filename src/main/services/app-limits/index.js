/**
 * App Limits 3.0 - Main Entry Point
 * 
 * Re-exports all modules for easy importing.
 */

const limitsStore = require('./limits-store');
const limitsEngine = require('./limits-engine');
const windowController = require('./window-controller');
const overlayManager = require('./overlay-manager');

module.exports = {
    store: limitsStore,
    engine: limitsEngine,
    windows: windowController,
    overlay: overlayManager,

    // Convenience init that sets up everything
    init(mainWindow) {
        limitsStore.init();
        overlayManager.init(mainWindow);
        limitsEngine.init(overlayManager);
        console.log('🚀 App Limits 3.0 fully initialized');
    },

    // Start enforcement
    start() {
        limitsEngine.start();
    },

    // Stop enforcement
    stop() {
        limitsEngine.stop();
    }
};
