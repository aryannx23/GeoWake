/**
 * GeoWake — Online Cloud Database Engine
 * Connects GeoWake to online cloud storage over HTTPS.
 * Automatically synchronizes Google accounts, trip history, and saved destinations online.
 * Features automatic online/offline detection and background sync.
 */

class CloudDatabaseEngine {
    constructor() {
        this.STORAGE_KEY_CONFIG = 'geowake_cloud_db_config_v1';
        this.OFFLINE_QUEUE_KEY = 'geowake_offline_sync_queue_v1';

        // Default public cloud sync relay for immediate online multi-device access
        // Users can also enter their personal Supabase or Firebase URL
        this.defaultCloudEndpoint = 'https://api.jsonbin.io/v3/b';
        this.cloudProvider = 'cloud_rest'; // 'cloud_rest' | 'supabase' | 'firebase' | 'local_server'
        
        this.isOnline = navigator.onLine;
        this.syncListeners = [];
        this.offlineQueue = this.loadOfflineQueue();

        this.init();
    }

    init() {
        this.setupNetworkListeners();
    }

    setupNetworkListeners() {
        window.addEventListener('online', () => {
            this.isOnline = true;
            this.notifyStatus('online', 'Connected to Internet. Syncing cloud database...');
            this.flushOfflineQueue();
        });

        window.addEventListener('offline', () => {
            this.isOnline = false;
            this.notifyStatus('offline', 'Internet Disconnected. Operating in Offline Mode.');
        });
    }

    onStatusChange(callback) {
        this.syncListeners.push(callback);
        callback(this.isOnline ? 'online' : 'offline');
    }

    notifyStatus(status, message) {
        this.syncListeners.forEach(cb => {
            try { cb(status, message); } catch (e) {}
        });
        this.updateUiBadge(status);
    }

    updateUiBadge(status) {
        document.querySelectorAll('.cloud-db-status-badge').forEach(badge => {
            if (status === 'online') {
                badge.innerHTML = '<i class="fas fa-cloud" style="color: var(--accent-emerald);"></i> <span>Cloud DB: Online</span>';
                badge.className = 'badge badge-green cloud-db-status-badge';
            } else {
                badge.innerHTML = '<i class="fas fa-database" style="color: var(--accent-cyan);"></i> <span>Offline Cache</span>';
                badge.className = 'badge badge-cyan cloud-db-status-badge';
            }
        });
    }

    loadOfflineQueue() {
        try {
            const raw = localStorage.getItem(this.OFFLINE_QUEUE_KEY);
            return raw ? JSON.parse(raw) : [];
        } catch (e) {
            return [];
        }
    }

    saveOfflineQueue() {
        try {
            localStorage.setItem(this.OFFLINE_QUEUE_KEY, JSON.stringify(this.offlineQueue));
        } catch (e) {}
    }

    /**
     * Save user profile to Cloud Database & Local Server
     */
    async saveUserOnline(user) {
        const payload = {
            id: user.id,
            googleId: user.googleId || user.sub,
            email: user.email,
            name: user.name,
            picture: user.avatar || user.picture,
            updatedAt: new Date().toISOString()
        };

        // 1. Try Online Cloud Storage Relay
        if (this.isOnline) {
            try {
                // Save user index in cloud bucket
                await this._sendToCloudStore(`user_${user.id}`, payload);
                this.notifyStatus('online', 'User profile synced to Cloud Database');
                return { success: true, online: true };
            } catch (err) {
                console.warn('Cloud store sync notice, queued for retry:', err.message);
                this.queueOfflineAction('save_user', payload);
            }
        } else {
            this.queueOfflineAction('save_user', payload);
        }

        return { success: true, online: false };
    }

    /**
     * Save trip to Cloud Database
     */
    async saveTripOnline(trip) {
        const payload = {
            ...trip,
            syncedAt: new Date().toISOString()
        };

        // 1. Try local server API
        try {
            const apiBase = window.authManager?.getApiBase ? window.authManager.getApiBase() : '';
            await fetch(`${apiBase}/api/user/trips`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
        } catch (e) {}

        // 2. Try Online Cloud Storage
        if (this.isOnline) {
            try {
                await this._sendToCloudStore(`trip_${trip.id || Date.now()}`, payload);
                this.notifyStatus('online', 'Trip saved to Cloud Database');
                return { success: true, online: true };
            } catch (err) {
                this.queueOfflineAction('save_trip', payload);
            }
        } else {
            this.queueOfflineAction('save_trip', payload);
        }

        return { success: true, online: false };
    }

    /**
     * Fetch user's trips from Cloud Database
     */
    async fetchUserTripsOnline(userId) {
        if (!userId) return [];

        // 1. Try local server first
        try {
            const apiBase = window.authManager?.getApiBase ? window.authManager.getApiBase() : '';
            const resp = await fetch(`${apiBase}/api/user/trips?userId=${encodeURIComponent(userId)}`);
            if (resp.ok && resp.status !== 405) {
                const text = await resp.text();
                const data = text ? JSON.parse(text) : {};
                if (data.trips && data.trips.length > 0) {
                    return data.trips.map(t => ({
                        id: t.id,
                        dest: t.destination_name || t.dest,
                        date: new Date(t.created_at || t.syncedAt || Date.now()).toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' }),
                        radius: `${Math.round(t.alert_radius || 500)} m`,
                        status: t.status || 'Completed',
                        sound: t.alarm_sound || 'loud',
                        destLat: t.dest_lat,
                        destLon: t.dest_lon
                    }));
                }
            }
        } catch (e) {}

        // 2. Fetch from cloud storage
        if (this.isOnline) {
            try {
                const cloudData = await this._fetchFromCloudStore(`trips_${userId}`);
                if (Array.isArray(cloudData)) {
                    return cloudData;
                }
            } catch (err) {}
        }

        return [];
    }

    queueOfflineAction(type, data) {
        this.offlineQueue.push({ type, data, timestamp: Date.now() });
        this.saveOfflineQueue();
    }

    async flushOfflineQueue() {
        if (!this.isOnline || this.offlineQueue.length === 0) return;

        const queue = [...this.offlineQueue];
        this.offlineQueue = [];
        this.saveOfflineQueue();

        for (const item of queue) {
            try {
                if (item.type === 'save_user') {
                    await this.saveUserOnline(item.data);
                } else if (item.type === 'save_trip') {
                    await this.saveTripOnline(item.data);
                }
            } catch (e) {
                // Re-queue if still failing
                this.offlineQueue.push(item);
            }
        }
        this.saveOfflineQueue();
    }

    /**
     * Cloud HTTPS Storage Relay
     */
    async _sendToCloudStore(key, data) {
        // Universal cloud storage using CORS-friendly HTTPS cloud store
        const cloudUrl = `https://kv.val.run/geowake_${encodeURIComponent(key)}`;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 4000);

        try {
            const resp = await fetch(cloudUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data),
                signal: controller.signal
            });
            clearTimeout(timeout);
            return resp.ok;
        } catch (err) {
            clearTimeout(timeout);
            throw err;
        }
    }

    async _fetchFromCloudStore(key) {
        const cloudUrl = `https://kv.val.run/geowake_${encodeURIComponent(key)}`;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 4000);

        try {
            const resp = await fetch(cloudUrl, { signal: controller.signal });
            clearTimeout(timeout);
            if (resp.ok) {
                return await resp.json();
            }
        } catch (err) {
            clearTimeout(timeout);
        }
        return null;
    }
}

// Global online cloud database engine instance
window.cloudDatabase = new CloudDatabaseEngine();
