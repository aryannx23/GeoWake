/**
 * GeoWake - Service Worker for Background Execution & Persistent Notifications
 * Handles ongoing, non-removable live trip notifications, alarm triggers, and notification actions.
 */

const CACHE_NAME = 'geowake-cache-v3.2';
const NOTIFICATION_TAG = 'geowake-live-trip';

// Install event - activate immediately
self.addEventListener('install', (event) => {
    self.skipWaiting();
});

// Activate event - claim clients immediately
self.addEventListener('activate', (event) => {
    event.waitUntil(self.clients.claim());
});

// Message listener from main thread
self.addEventListener('message', (event) => {
    if (!event.data) return;

    const { type, payload } = event.data;

    switch (type) {
        case 'SHOW_TRIP_NOTIFICATION':
            event.waitUntil(showTripNotification(payload));
            break;

        case 'TRIGGER_ALARM_NOTIFICATION':
            event.waitUntil(showAlarmNotification(payload));
            break;

        case 'CLEAR_TRIP_NOTIFICATION':
            event.waitUntil(clearTripNotifications());
            break;

        default:
            break;
    }
});

/**
 * Display or update persistent, non-removable trip notification
 */
async function showTripNotification(data) {
    if (!self.registration || !self.registration.showNotification) return;

    const {
        destName = 'Destination',
        distanceText = 'In Transit',
        speedText = '0 km/h',
        etaText = '--',
        statusText = 'Monitoring Location in Background',
        isApproaching = false
    } = data || {};

    const title = isApproaching 
        ? `🚨 Approaching: ${destName} (${distanceText})`
        : `📍 GeoWake: ${distanceText} to ${destName}`;

    const body = `Speed: ${speedText} • ETA: ${etaText}\n${statusText}`;

    const options = {
        body: body,
        icon: 'assets/live-location-arrow.png',
        badge: 'assets/live-location-arrow.png',
        tag: NOTIFICATION_TAG,
        ongoing: true, // Non-removable persistent notification on Android
        requireInteraction: true, // Persistent on desktop/supported platforms
        silent: true, // Silent in-place updates while moving
        renotify: false,
        vibrate: isApproaching ? [300, 150, 300] : undefined,
        data: {
            url: '/',
            tripActive: true,
            timestamp: Date.now()
        },
        actions: [
            {
                action: 'open_app',
                title: '📍 View Trip'
            },
            {
                action: 'stop_trip',
                title: '🛑 Stop Trip'
            }
        ]
    };

    try {
        await self.registration.showNotification(title, options);
    } catch (err) {
        console.warn('[SW] showTripNotification failed:', err);
    }
}

/**
 * Display high-priority emergency arrival notification
 */
async function showAlarmNotification(data) {
    if (!self.registration || !self.registration.showNotification) return;

    const {
        destName = 'Destination',
        radiusMeters = 500
    } = data || {};

    const title = `🚨 WAKE UP! Arrived at ${destName}!`;
    const body = `Target perimeter (${radiusMeters >= 1000 ? (radiusMeters/1000).toFixed(1)+' km' : radiusMeters+'m'}) reached! Tap now to stop alarm.`;

    const options = {
        body: body,
        icon: 'assets/live-location-arrow.png',
        badge: 'assets/live-location-arrow.png',
        tag: NOTIFICATION_TAG,
        ongoing: true,
        requireInteraction: true,
        silent: false,
        renotify: true, // Alert user with sound/vibration
        vibrate: [500, 200, 500, 200, 800, 200, 500],
        data: {
            url: '/',
            tripArrived: true,
            timestamp: Date.now()
        },
        actions: [
            {
                action: 'stop_trip',
                title: '🛑 STOP ALARM'
            },
            {
                action: 'open_app',
                title: '📍 Open App'
            }
        ]
    };

    try {
        await self.registration.showNotification(title, options);
    } catch (err) {
        console.warn('[SW] showAlarmNotification failed:', err);
    }
}

/**
 * Clear all active trip notifications
 */
async function clearTripNotifications() {
    if (!self.registration || !self.registration.getNotifications) return;

    try {
        const notifications = await self.registration.getNotifications({ tag: NOTIFICATION_TAG });
        notifications.forEach((notification) => notification.close());
    } catch (err) {
        console.warn('[SW] clearTripNotifications failed:', err);
    }
}

// Notification interaction handler
self.addEventListener('notificationclick', (event) => {
    const notification = event.notification;
    const action = event.action;

    if (action === 'stop_trip') {
        notification.close();
        // Broadcast stop trip event to all open GeoWake client tabs
        event.waitUntil(
            self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
                clientList.forEach((client) => {
                    client.postMessage({ type: 'STOP_TRIP_ACTION' });
                });
                if (clientList.length > 0) {
                    clientList[0].focus();
                }
            })
        );
        return;
    }

    // Default or 'open_app' action: Focus existing window or open a new one
    notification.close();
    event.waitUntil(
        self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
            for (const client of clientList) {
                if ('focus' in client) {
                    return client.focus();
                }
            }
            if (self.clients.openWindow) {
                return self.clients.openWindow('/');
            }
        })
    );
});
