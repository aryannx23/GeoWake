/**
 * GeoWake — Online Cloud Database Engine (Supabase PostgreSQL Edition)
 * Connects GeoWake directly to Supabase Cloud Database over HTTPS REST API.
 * Automatically synchronizes user accounts, sessions, and trip history online.
 * Features automatic online/offline detection, background sync queue, and local-first reliability.
 */

class CloudDatabaseEngine {
    constructor() {
        this.CONFIG_STORAGE_KEY = 'geowake_cloud_db_config_v2';
        this.OFFLINE_QUEUE_KEY = 'geowake_offline_sync_queue_v2';

        // Default configured Supabase Cloud project credentials
        this.defaultConfig = {
            url: 'https://kppzrelvrfjcjuneuirt.supabase.co',
            anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtwcHpyZWx2cmZqY2p1bmV1aXJ0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkxOTQ0NTMsImV4cCI6MjEwNDc3MDQ1M30.oc-6wzGWsf3t03HBMHsAXfJpevN2a9LHvh1DhEIg8Eo'
        };

        const loaded = this.loadConfig();
        this.supabaseUrl = (loaded.url || this.defaultConfig.url).replace(/\/rest\/v1\/?$/, '').replace(/\/+$/, '');
        this.supabaseKey = loaded.anonKey || this.defaultConfig.anonKey;

        this.isOnline = navigator.onLine;
        this.isCloudReachable = false;
        this.syncListeners = [];
        this.offlineQueue = this.loadOfflineQueue();

        this.init();
    }

    init() {
        this.setupNetworkListeners();
        // Initial connection check
        setTimeout(() => {
            this.testConnection().then(ok => {
                this.isCloudReachable = ok;
                this.notifyStatus(ok ? 'online' : 'offline', ok ? 'Connected to Supabase Cloud' : 'Operating in Local Mode');
                if (ok) this.flushOfflineQueue();
            });
        }, 500);
    }

    loadConfig() {
        try {
            const raw = localStorage.getItem(this.CONFIG_STORAGE_KEY);
            return raw ? JSON.parse(raw) : this.defaultConfig;
        } catch (e) {
            return this.defaultConfig;
        }
    }

    saveConfig(url, anonKey) {
        try {
            const cleanUrl = (url || '').trim().replace(/\/rest\/v1\/?$/, '').replace(/\/+$/, '');
            const cleanKey = (anonKey || '').trim();
            this.supabaseUrl = cleanUrl;
            this.supabaseKey = cleanKey;
            localStorage.setItem(this.CONFIG_STORAGE_KEY, JSON.stringify({ url: cleanUrl, anonKey: cleanKey }));
            return this.testConnection();
        } catch (e) {
            return Promise.resolve(false);
        }
    }

    setupNetworkListeners() {
        window.addEventListener('online', () => {
            this.isOnline = true;
            this.testConnection().then(ok => {
                this.isCloudReachable = ok;
                this.notifyStatus(ok ? 'online' : 'offline', ok ? 'Internet restored. Supabase Cloud connected.' : 'Internet restored (Supabase offline).');
                if (ok) this.flushOfflineQueue();
            });
        });

        window.addEventListener('offline', () => {
            this.isOnline = false;
            this.isCloudReachable = false;
            this.notifyStatus('offline', 'Internet Disconnected. Offline cache active.');
        });
    }

    onStatusChange(callback) {
        if (typeof callback === 'function') {
            this.syncListeners.push(callback);
            callback(this.isCloudReachable ? 'online' : 'offline', this.isCloudReachable ? 'Supabase Online' : 'Local Mode');
        }
    }

    notifyStatus(status, message) {
        this.syncListeners.forEach(cb => {
            try { cb(status, message); } catch (e) {}
        });
        this.updateUiBadge(status);
    }

    updateUiBadge(status) {
        const isConnected = (status === 'online' && this.isCloudReachable);
        document.querySelectorAll('.cloud-db-status-badge').forEach(badge => {
            if (isConnected) {
                badge.innerHTML = '<i class="fas fa-cloud" style="color: var(--accent-emerald);"></i> <span>Cloud: Synced</span>';
                badge.className = 'badge badge-green cloud-db-status-badge';
                badge.title = 'Connected to Supabase PostgreSQL Cloud Database';
            } else {
                badge.innerHTML = '<i class="fas fa-database" style="color: var(--accent-cyan);"></i> <span>Local Cache</span>';
                badge.className = 'badge badge-cyan cloud-db-status-badge';
                badge.title = 'Saved in Local Storage (will sync to Cloud when online)';
            }
        });
    }

    getHeaders() {
        return {
            'apikey': this.supabaseKey,
            'Authorization': `Bearer ${this.supabaseKey}`,
            'Content-Type': 'application/json',
            'Prefer': 'resolution=merge-duplicates,return=representation'
        };
    }

    async testConnection() {
        if (!navigator.onLine || !this.supabaseUrl || !this.supabaseKey) {
            return false;
        }
        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 4000);
            const resp = await fetch(`${this.supabaseUrl}/rest/v1/trips?select=id&limit=1`, {
                headers: {
                    'apikey': this.supabaseKey,
                    'Authorization': `Bearer ${this.supabaseKey}`
                },
                signal: controller.signal
            });
            clearTimeout(timeout);
            // 200/206 = table exists and query succeeded
            // 404 with PGRST205 = Supabase connected, but tables need to be created via schema.sql
            if (resp.ok || resp.status === 404) {
                this.isCloudReachable = resp.ok;
                return resp.ok;
            }
            return false;
        } catch (e) {
            return false;
        }
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
                if (item.type === 'save_trip') {
                    await this.saveTripOnline(item.data, false);
                } else if (item.type === 'save_user') {
                    await this.saveUserOnline(item.data, false);
                }
            } catch (e) {
                this.offlineQueue.push(item);
            }
        }
        this.saveOfflineQueue();
    }

    /**
     * Save user record to Supabase
     */
    async saveUserOnline(user, queueOnFail = true) {
        const payload = {
            id: user.id,
            username: user.username,
            email: user.email || `${user.username}@geowake.app`,
            name: user.name || user.username,
            password_hash: user.passwordHash || user.password_hash || '',
            password_salt: user.passwordSalt || user.password_salt || '',
            role: user.role || 'user',
            last_login: new Date().toISOString()
        };

        if (this.isOnline && this.supabaseUrl && this.supabaseKey) {
            try {
                const resp = await fetch(`${this.supabaseUrl}/rest/v1/users`, {
                    method: 'POST',
                    headers: this.getHeaders(),
                    body: JSON.stringify(payload)
                });
                if (resp.ok) {
                    this.isCloudReachable = true;
                    this.notifyStatus('online', 'User profile synced to Supabase Cloud');
                    return { success: true, online: true };
                }
            } catch (err) {
                console.warn('[SUPABASE] Cloud sync notice for user:', err.message);
            }
        }

        if (queueOnFail) {
            this.queueOfflineAction('save_user', payload);
        }
        return { success: true, online: false };
    }

    async parseJsonSafe(resp) {
        try {
            const text = await resp.text();
            if (!text || !text.trim()) return null;
            return JSON.parse(text);
        } catch (e) {
            return null;
        }
    }

    /**
     * Fetch user record by username from Supabase
     */
    async fetchUserByUsername(username) {
        if (!this.isOnline || !this.supabaseUrl || !this.supabaseKey) return null;
        try {
            const resp = await fetch(`${this.supabaseUrl}/rest/v1/users?username=ilike.${encodeURIComponent(username)}&limit=1`, {
                headers: {
                    'apikey': this.supabaseKey,
                    'Authorization': `Bearer ${this.supabaseKey}`
                }
            });
            if (resp.ok) {
                const data = await this.parseJsonSafe(resp);
                if (Array.isArray(data) && data.length > 0) {
                    return data[0];
                }
            }
        } catch (e) {}
        return null;
    }

    /**
     * Save trip to Supabase Cloud Database & Local Server
     */
    async saveTripOnline(trip, queueOnFail = true) {
        if (!trip || trip.userId === 'guest' || window.authManager?.isGuest?.()) {
            return { success: true, guest: true };
        }

        const payload = {
            id: trip.id || ('trip-' + Date.now()),
            user_id: trip.userId || trip.user_id || 'local-user',
            destination_name: trip.destinationName || trip.destination_name || trip.dest || 'Destination',
            destination_full_name: trip.destinationFullName || trip.destination_full_name || '',
            dest_lat: trip.destLat ?? trip.dest_lat ?? null,
            dest_lon: trip.destLon ?? trip.dest_lon ?? null,
            origin_name: trip.originName || trip.origin_name || '',
            origin_lat: trip.originLat ?? trip.origin_lat ?? null,
            origin_lon: trip.originLon ?? trip.origin_lon ?? null,
            alert_radius: trip.alertRadius ?? trip.alert_radius ?? 500,
            alarm_sound: trip.alarmSound || trip.alarm_sound || 'loud',
            route_distance: trip.routeDistance ?? trip.route_distance ?? 0,
            travel_duration: trip.travelDuration || trip.travel_duration || '',
            status: trip.status || 'Completed',
            created_at: trip.created_at || new Date().toISOString()
        };

        // 1. Send directly to Supabase PostgreSQL
        if (this.isOnline && this.supabaseUrl && this.supabaseKey) {
            try {
                const resp = await fetch(`${this.supabaseUrl}/rest/v1/trips`, {
                    method: 'POST',
                    headers: this.getHeaders(),
                    body: JSON.stringify(payload)
                });
                if (resp.ok) {
                    this.isCloudReachable = true;
                    this.notifyStatus('online', 'Trip saved to Supabase Cloud');
                    return { success: true, online: true };
                }
            } catch (err) {
                console.warn('[SUPABASE] Cloud sync notice for trip:', err.message);
            }
        }

        if (queueOnFail) {
            this.queueOfflineAction('save_trip', payload);
        }
        return { success: true, online: false };
    }

    /**
     * Fetch user's trips from Supabase Cloud Database
     */
    async fetchUserTripsOnline(userId) {
        if (!userId) return [];

        // 1. Fetch from Supabase Cloud
        if (this.isOnline && this.supabaseUrl && this.supabaseKey) {
            try {
                const resp = await fetch(
                    `${this.supabaseUrl}/rest/v1/trips?user_id=eq.${encodeURIComponent(userId)}&order=created_at.desc&limit=30`,
                    {
                        headers: {
                            'apikey': this.supabaseKey,
                            'Authorization': `Bearer ${this.supabaseKey}`
                        }
                    }
                );
                if (resp.ok) {
                    const rows = await this.parseJsonSafe(resp);
                    if (Array.isArray(rows)) {
                        this.isCloudReachable = true;
                        this.updateUiBadge('online');
                        return rows.map(t => ({
                            id: t.id,
                            dest: t.destination_name || 'Destination',
                            destFull: t.destination_full_name || '',
                            date: new Date(t.created_at || Date.now()).toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' }),
                            radius: `${Math.round(t.alert_radius || 500)} m`,
                            status: t.status || 'Completed',
                            sound: t.alarm_sound || 'loud',
                            destLat: t.dest_lat,
                            destLon: t.dest_lon,
                            originName: t.origin_name || '',
                            routeDist: t.route_distance || 0,
                            duration: t.travel_duration || ''
                        }));
                    }
                }
            } catch (err) {
                console.warn('[SUPABASE] Fetch error:', err.message);
            }
        }

        // 2. Fallback: try local server.py only if on localhost
        const isLocalhost = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
        if (isLocalhost) {
            try {
                const apiBase = window.authManager?.getApiBase ? window.authManager.getApiBase() : '';
                if (apiBase) {
                    const resp = await fetch(`${apiBase}/api/user/trips?userId=${encodeURIComponent(userId)}`);
                    if (resp.ok && resp.status !== 405) {
                        const data = await this.parseJsonSafe(resp);
                        if (data && data.trips && Array.isArray(data.trips)) {
                            return data.trips.map(t => ({
                                id: t.id,
                                dest: t.destination_name,
                                date: new Date(t.created_at || Date.now()).toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' }),
                                radius: `${Math.round(t.alert_radius || 500)} m`,
                                status: t.status || 'Completed',
                                sound: t.alarm_sound || 'loud',
                                destLat: t.dest_lat,
                                destLon: t.dest_lon
                            }));
                        }
                    }
                }
            } catch (e) {}
        }

        return [];
    }
}

// Global online cloud database engine instance
window.cloudDatabase = new CloudDatabaseEngine();
