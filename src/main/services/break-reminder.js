const { Notification, app } = require('electron');
const path = require('path');
const { getSetting } = require('../database/db');
const { resolveNotificationIconPath } = require('../utils/icon-paths');

// Resolve notification icon robustly in dev + packaged contexts
const ICON_PATH = resolveNotificationIconPath();

let reminderInterval = null;
let lastReminderTime = null;
let notificationClickCallback = null; // set by startBreakReminders, called when user clicks a notification

// Break reminder messages with variety
const reminderMessages = [
    {
        title: '👀 Time for an Eye Break!',
        body: 'Look at something 20 feet away for 20 seconds. Your eyes will thank you!',
    },
    {
        title: '🧘 Take a Breather',
        body: 'Step away from the screen, stretch, and take 3 deep breaths.',
    },
    {
        title: '💪 Movement Break',
        body: 'Stand up and stretch! Roll your shoulders and neck gently.',
    },
    {
        title: '💧 Hydration Check',
        body: "Time to drink some water! Stay hydrated for better focus.",
    },
    {
        title: '🌿 Rest Your Mind',
        body: 'Close your eyes for 20 seconds. Give your brain a quick reset.',
    },
];

function getRandomMessage() {
    return reminderMessages[Math.floor(Math.random() * reminderMessages.length)];
}

function showBreakNotification(onClickCallback = null) {
    const message = getRandomMessage();

    const notification = new Notification({
        title: message.title,
        body: message.body,
        icon: ICON_PATH || undefined,
        silent: false,
        urgency: 'normal',
        timeoutType: 'default',
    });

    notification.on('click', () => {
        if (typeof onClickCallback === 'function') {
            onClickCallback();
        }
    });

    notification.show();
    lastReminderTime = Date.now();
    console.log('📢 Break reminder sent:', message.title);
}

function startBreakReminders(intervalMinutes = 30, onNotificationClick = null) {
    stopBreakReminders(); // Clear any existing

    notificationClickCallback = onNotificationClick;

    console.log(`⏰ Starting break reminders every ${intervalMinutes} minutes`);

    const intervalMs = intervalMinutes * 60 * 1000;

    reminderInterval = setInterval(() => {
        // Check if reminders are still enabled
        const enabled = getSetting('breakReminder');
        if (enabled === false) {
            console.log('Break reminders disabled, stopping...');
            stopBreakReminders();
            return;
        }

        showBreakNotification(notificationClickCallback);
    }, intervalMs);

    // Show first reminder after the interval (not immediately)
    lastReminderTime = Date.now();
}

function stopBreakReminders() {
    if (reminderInterval) {
        clearInterval(reminderInterval);
        reminderInterval = null;
        console.log('Break reminders stopped');
    }
}

function updateBreakInterval(minutes) {
    if (reminderInterval) {
        // Restart with new interval, preserving the existing click callback
        startBreakReminders(minutes, notificationClickCallback);
    }
}

function getNextReminderTime() {
    if (!reminderInterval || !lastReminderTime) {
        return null;
    }

    const interval = getSetting('breakInterval') || 30;
    return lastReminderTime + (interval * 60 * 1000);
}

// Send a test notification
function sendTestNotification(onClickCallback = null) {
    const notification = new Notification({
        title: '🔔 Test Notification',
        body: 'Break reminders are working! You\'ll get reminders at your set interval.',
        icon: ICON_PATH || undefined,
        silent: false,
    });
    notification.on('click', () => {
        if (typeof onClickCallback === 'function') {
            onClickCallback();
        }
    });
    notification.show();
}

module.exports = {
    startBreakReminders,
    stopBreakReminders,
    updateBreakInterval,
    getNextReminderTime,
    sendTestNotification,
};
