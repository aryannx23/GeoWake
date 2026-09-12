/**
 * GeoWake — Simple Username & Password Authentication Manager
 * Handles user sessions, registration, login, logout, and SQLite / LocalStorage trip synchronization.
 * Includes automatic dual-mode operation:
 *  1. SQLite Server Mode (when running via python server.py on http://localhost:8000)
 *  2. Offline / LocalStorage Mode (when running via VS Code Live Server or static hosting)
 */

class AuthManager {
    constructor() {
        this.STORAGE_KEY = 'geowake_user_session_v2';
        this.SESSION_TOKEN_KEY = 'geowake_session_token_v1';
        this.REMEMBER_ME_KEY = 'geowake_remember_me_v1';
        this.LOCAL_ACCOUNTS_KEY = 'geowake_local_accounts_v1';
        this.currentUser = null;
        this.sessionToken = null;
        this.isRemembered = false;
        this.listeners = [];
        this.apiBase = null;
        this.serverOnline = false;
        this.init();
    }

    init() {
        this.loadSession();
        this.checkDatabaseHealth().then(() => {
            if (this.sessionToken) {
                this.verifySessionWithServer();
            }
        });
    }

    getApiBase() {
        if (this.apiBase !== null) return this.apiBase;
        // If loaded directly from python server.py (port 8000), relative is best
        if (window.location.port === '8000') {
            return '';
        }
        // If loaded from Live Server (e.g. port 5500) or file://, try localhost:8000
        return 'http://localhost:8000';
    }

    /**
     * Safely parse JSON from a fetch Response without throwing syntax errors on empty/HTML bodies
     */
    async safeParseJson(resp) {
        try {
            const text = await resp.text();
            return text ? JSON.parse(text) : {};
        } catch (e) {
            return {};
        }
    }

    /**
     * Browser SHA-256 password hashing for secure local-mode authentication
     */
    async sha256(message) {
        try {
            if (window.crypto && window.crypto.subtle) {
                const msgUint8 = new TextEncoder().encode(message);
                const hashBuffer = await window.crypto.subtle.digest('SHA-256', msgUint8);
                const hashArray = Array.from(new Uint8Array(hashBuffer));
                return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
            }
        } catch (e) {}

        // Simple fallback hash if crypto.subtle is unavailable
        let hash = 0;
        for (let i = 0; i < message.length; i++) {
            const chr = message.charCodeAt(i);
            hash = ((hash << 5) - hash) + chr;
            hash |= 0;
        }
        return 'h_' + Math.abs(hash);
    }

    /**
     * Load session from sessionStorage first (for session-only logins), then localStorage (for remember-me logins)
     */
    loadSession() {
        try {
            // 1. First check sessionStorage (active tab session when Remember Me was unchecked)
            let raw = sessionStorage.getItem(this.STORAGE_KEY);
            let token = sessionStorage.getItem(this.SESSION_TOKEN_KEY);
            let remembered = false;

            // 2. If not in sessionStorage, check localStorage (when Remember Me was checked)
            if (!raw) {
                raw = localStorage.getItem(this.STORAGE_KEY);
                token = localStorage.getItem(this.SESSION_TOKEN_KEY);
                remembered = (localStorage.getItem(this.REMEMBER_ME_KEY) === 'true');
            }

            if (raw) {
                this.currentUser = JSON.parse(raw);
                this.sessionToken = token || null;
                this.isRemembered = remembered;
            } else {
                this.currentUser = null;
                this.sessionToken = null;
                this.isRemembered = false;
            }
        } catch (e) {
            this.currentUser = null;
            this.sessionToken = null;
            this.isRemembered = false;
        }
        this.notifyListeners();
    }

    /**
     * Verify active session token against SQLite database on server startup
     */
    async verifySessionWithServer() {
        if (!this.sessionToken) return;
        const base = this.getApiBase();
        try {
            const resp = await fetch(`${base}/api/auth/verify-session`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sessionToken: this.sessionToken })
            });

            if (resp.ok && resp.status !== 405) {
                const data = await this.safeParseJson(resp);
                if (data.valid && data.user) {
                    this.currentUser = data.user;
                    this.isRemembered = !!data.rememberMe;
                    this.notifyListeners();
                    if (data.user.id) {
                        this.fetchUserTripsFromDb(data.user.id);
                    }
                } else if (data.valid === false) {
                    console.log('ℹ️ GeoWake Notice: Session token is invalid or expired in database.');
                    this.saveSession(null);
                }
            }
        } catch (e) {
            // Offline fallback: keep cached session
        }
    }

    /**
     * Persist user session based on Remember Me preference:
     * - Remember Me ENABLED  => localStorage (persists across browser & app close)
     * - Remember Me DISABLED => sessionStorage (wiped as soon as browser/app is closed)
     */
    saveSession(user, sessionToken = null, rememberMe = true) {
        this.currentUser = user;
        this.sessionToken = sessionToken || (user ? this.sessionToken : null);
        this.isRemembered = !!rememberMe;

        try {
            if (user) {
                if (rememberMe) {
                    // Remember Me is ENABLED: Save to localStorage for persistent login
                    localStorage.setItem(this.STORAGE_KEY, JSON.stringify(user));
                    if (this.sessionToken) {
                        localStorage.setItem(this.SESSION_TOKEN_KEY, this.sessionToken);
                    }
                    localStorage.setItem(this.REMEMBER_ME_KEY, 'true');

                    // Clear any temporary sessionStorage
                    sessionStorage.removeItem(this.STORAGE_KEY);
                    sessionStorage.removeItem(this.SESSION_TOKEN_KEY);
                    sessionStorage.removeItem(this.REMEMBER_ME_KEY);
                } else {
                    // Remember Me is DISABLED: Save to sessionStorage ONLY
                    // Closing the browser tab/app will automatically discard sessionStorage
                    sessionStorage.setItem(this.STORAGE_KEY, JSON.stringify(user));
                    if (this.sessionToken) {
                        sessionStorage.setItem(this.SESSION_TOKEN_KEY, this.sessionToken);
                    }
                    sessionStorage.setItem(this.REMEMBER_ME_KEY, 'false');

                    // Wipe localStorage so subsequent opens require logging in again
                    localStorage.removeItem(this.STORAGE_KEY);
                    localStorage.removeItem(this.SESSION_TOKEN_KEY);
                    localStorage.removeItem(this.REMEMBER_ME_KEY);
                }
            } else {
                // User signed out: clear both storage locations
                localStorage.removeItem(this.STORAGE_KEY);
                localStorage.removeItem(this.SESSION_TOKEN_KEY);
                localStorage.removeItem(this.REMEMBER_ME_KEY);

                sessionStorage.removeItem(this.STORAGE_KEY);
                sessionStorage.removeItem(this.SESSION_TOKEN_KEY);
                sessionStorage.removeItem(this.REMEMBER_ME_KEY);

                this.sessionToken = null;
                this.isRemembered = false;
            }
        } catch (e) {
            console.warn('Could not persist session', e);
        }
        this.notifyListeners();
    }

    getLocalAccounts() {
        try {
            const raw = localStorage.getItem(this.LOCAL_ACCOUNTS_KEY);
            return raw ? JSON.parse(raw) : [];
        } catch (e) {
            return [];
        }
    }

    saveLocalAccounts(accounts) {
        try {
            localStorage.setItem(this.LOCAL_ACCOUNTS_KEY, JSON.stringify(accounts));
        } catch (e) {
            console.warn('Could not save local accounts', e);
        }
    }

    async checkDatabaseHealth() {
        const candidates = window.location.port === '8000'
            ? ['', 'http://localhost:8000']
            : ['http://localhost:8000', ''];

        for (const base of candidates) {
            try {
                const resp = await fetch(`${base}/api/stats`, { method: 'GET' });
                if (resp.ok && resp.status !== 405) {
                    const stats = await this.safeParseJson(resp);
                    if (stats.database) {
                        this.apiBase = base;
                        this.serverOnline = true;
                        console.log(`✅ GeoWake SQLite Database connected via ${base || 'current server'}:`, stats);
                        return true;
                    }
                }
            } catch (e) {
                // Ignore and test fallback
            }
        }

        this.serverOnline = false;
        console.log('ℹ️ GeoWake Notice: server.py not detected. Local storage account mode is active.');
        return false;
    }

    onAuthChange(callback) {
        if (typeof callback === 'function') {
            this.listeners.push(callback);
            try { callback(this.currentUser); } catch (e) {}
        }
    }

    notifyListeners() {
        this.listeners.forEach(cb => {
            try { cb(this.currentUser); } catch (e) {}
        });
    }

    /**
     * User Login with Username & Password and Remember Me preference
     */
    async login(username, password, rememberMe = true) {
        const cleanUser = (username || '').trim();
        if (!cleanUser || !password) {
            throw new Error('Please enter both username and password.');
        }

        const isLocalhost = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');

        // 1. Try Python SQLite server ONLY if on localhost
        if (isLocalhost) {
            try {
                const base = this.apiBase || (window.location.port === '8000' ? '' : 'http://localhost:8000');
                const resp = await fetch(`${base}/api/auth/login`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        username: cleanUser,
                        password: password,
                        rememberMe: !!rememberMe
                    })
                });

                if (resp.ok) {
                    const data = await this.safeParseJson(resp);
                    if (data && data.success) {
                        this.apiBase = base;
                        this.serverOnline = true;
                        this.saveSession(data.user, data.sessionToken, data.rememberMe !== undefined ? data.rememberMe : rememberMe);
                        if (data.user && data.user.id) {
                            this.fetchUserTripsFromDb(data.user.id);
                        }
                        return data.user;
                    }
                } else if (resp.status === 400 || resp.status === 401 || resp.status === 409) {
                    const data = await this.safeParseJson(resp);
                    throw new Error(data.error || 'Invalid username or password.');
                }
            } catch (err) {
                if (err.message && err.message.includes('password')) {
                    throw err;
                }
            }
        }

        // 2. Try Supabase Cloud Database (for Vercel, mobile, or cloud sync)
        if (window.cloudDatabase && window.cloudDatabase.isOnline) {
            try {
                const cloudUser = await window.cloudDatabase.fetchUserByUsername(cleanUser);
                if (cloudUser) {
                    const pwdHash = await this.sha256(password + '_geowake_salt');
                    if (cloudUser.password_hash === pwdHash || cloudUser.password_hash === password) {
                        const sessionUser = {
                            id: cloudUser.id,
                            username: cloudUser.username,
                            name: cloudUser.name || cloudUser.username,
                            email: cloudUser.email,
                            mode: 'cloud'
                        };
                        this.saveSession(sessionUser, 'token-cloud-' + Date.now(), rememberMe);
                        this.fetchUserTripsFromDb(cloudUser.id);
                        return sessionUser;
                    } else {
                        throw new Error('Incorrect password. Please try again.');
                    }
                }
            } catch (cloudErr) {
                if (cloudErr.message && cloudErr.message.includes('password')) {
                    throw cloudErr;
                }
            }
        }

        // 3. Fallback: Authenticate against Local Storage accounts (offline mode on this device)
        const localAccounts = this.getLocalAccounts();
        const pwdHash = await this.sha256(password + '_geowake_salt');

        const match = localAccounts.find(u =>
            u.username.toLowerCase() === cleanUser.toLowerCase() &&
            u.passwordHash === pwdHash
        );

        if (match) {
            const sessionUser = {
                id: match.id,
                username: match.username,
                name: match.name,
                mode: 'local'
            };
            this.saveSession(sessionUser, 'token-local-' + Date.now(), rememberMe);
            return sessionUser;
        }

        const userExists = localAccounts.some(u => u.username.toLowerCase() === cleanUser.toLowerCase());
        if (userExists) {
            throw new Error('Incorrect password. Please try again.');
        }

        if (!isLocalhost && window.cloudDatabase) {
            throw new Error('Account not found in cloud database. If you created this account on your computer, please run schema.sql in Supabase SQL editor to enable cloud sync.');
        }

        throw new Error('Account not found. Please click "Create Account" first, or run "python server.py" for database sync.');
    }

    /**
     * User Registration with Username & Password and Remember Me preference
     */
    async register(username, password, name = '', rememberMe = true) {
        const cleanUser = (username || '').trim();
        const cleanName = (name || '').trim();

        if (!cleanUser || cleanUser.length < 3) {
            throw new Error('Username must be at least 3 characters long.');
        }
        if (!/^[a-zA-Z0-9_-]+$/.test(cleanUser)) {
            throw new Error('Username can only contain letters, numbers, hyphens, and underscores.');
        }
        if (!password || password.length < 4) {
            throw new Error('Password must be at least 4 characters long.');
        }
        if (!/[A-Z]/.test(password)) {
            throw new Error('Password must contain at least one uppercase letter (A-Z).');
        }
        if (!/[0-9]/.test(password)) {
            throw new Error('Password must contain at least one number (0-9).');
        }
        if (!/[^a-zA-Z0-9]/.test(password)) {
            throw new Error('Password must contain at least one special character (e.g. !@#$%^&*).');
        }

        const isLocalhost = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');

        // 1. Try Python SQLite server ONLY if on localhost
        if (isLocalhost) {
            try {
                const base = this.apiBase || (window.location.port === '8000' ? '' : 'http://localhost:8000');
                const resp = await fetch(`${base}/api/auth/register`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        username: cleanUser,
                        password: password,
                        name: cleanName || cleanUser,
                        rememberMe: !!rememberMe
                    })
                });

                if (resp.ok) {
                    const data = await this.safeParseJson(resp);
                    if (data && data.success) {
                        this.apiBase = base;
                        this.serverOnline = true;
                        this.saveSession(data.user, data.sessionToken, data.rememberMe !== undefined ? data.rememberMe : rememberMe);
                        return data.user;
                    }
                } else {
                    const data = await this.safeParseJson(resp);
                    if (data && data.error) {
                        throw new Error(data.error);
                    }
                }
            } catch (err) {
                if (err.message && !err.message.includes('Failed to fetch') && !err.message.includes('NetworkError')) {
                    throw err;
                }
            }
        }

        // 2. Try Supabase Cloud Database (e.g. when hosted on Vercel or mobile)
        if (window.cloudDatabase && window.cloudDatabase.isOnline) {
            try {
                const existingCloud = await window.cloudDatabase.fetchUserByUsername(cleanUser);
                if (existingCloud) {
                    throw new Error('Username is already taken. Please choose another or click Sign In.');
                }
                const pwdHash = await this.sha256(password + '_geowake_salt');
                const userId = 'usr-cloud-' + Date.now();
                const newCloudUser = {
                    id: userId,
                    username: cleanUser,
                    name: cleanName || cleanUser,
                    email: `${cleanUser.toLowerCase()}@geowake.app`,
                    password_hash: pwdHash,
                    role: 'user'
                };
                await window.cloudDatabase.saveUserOnline(newCloudUser);

                // Cache in local accounts for offline resilience
                const localAccounts = this.getLocalAccounts();
                localAccounts.push({
                    id: userId,
                    username: cleanUser,
                    name: cleanName || cleanUser,
                    passwordHash: pwdHash,
                    createdAt: new Date().toISOString(),
                    mode: 'cloud'
                });
                this.saveLocalAccounts(localAccounts);

                const sessionUser = {
                    id: userId,
                    username: cleanUser,
                    name: cleanName || cleanUser,
                    mode: 'cloud'
                };
                this.saveSession(sessionUser, 'token-cloud-' + Date.now(), rememberMe);
                return sessionUser;
            } catch (cloudErr) {
                if (cloudErr.message && (cloudErr.message.includes('already taken') || cloudErr.message.includes('Password'))) {
                    throw cloudErr;
                }
            }
        }

        // 3. Fallback: Register into Local Storage (when server.py and cloud are offline)
        const localAccounts = this.getLocalAccounts();
        const existing = localAccounts.find(u => u.username.toLowerCase() === cleanUser.toLowerCase());
        if (existing) {
            throw new Error('Username is already taken. Please choose another.');
        }

        const pwdHash = await this.sha256(password + '_geowake_salt');
        const newUser = {
            id: 'usr-local-' + Date.now(),
            username: cleanUser,
            name: cleanName || cleanUser,
            passwordHash: pwdHash,
            createdAt: new Date().toISOString(),
            mode: 'local'
        };

        localAccounts.push(newUser);
        this.saveLocalAccounts(localAccounts);

        const sessionUser = {
            id: newUser.id,
            username: newUser.username,
            name: newUser.name,
            mode: 'local'
        };

        this.saveSession(sessionUser, 'token-local-' + Date.now(), rememberMe);
        return sessionUser;
    }

    /**
     * User Logout - Revoke database session and clear local & session storages
     */
    async logout() {
        const tokenToRevoke = this.sessionToken;
        const currentUserId = this.currentUser ? this.currentUser.id : null;

        // Revoke session token from SQLite database
        if (tokenToRevoke || currentUserId) {
            const base = this.getApiBase();
            try {
                fetch(`${base}/api/auth/logout`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ sessionToken: tokenToRevoke, userId: currentUserId })
                }).catch(() => {});
            } catch (e) {
                // Ignore offline errors
            }
        }

        this.saveSession(null);
        if (window.app) {
            window.app.loadStorage();
            window.app.renderTripHistory();
        }
    }

    isLoggedIn() {
        return !!this.currentUser;
    }

    isGuest() {
        return Boolean(this.currentUser && this.currentUser.isGuest);
    }

    /**
     * Guest Login - Transient in-memory session.
     * Login data, credentials, and trip history are never saved.
     */
    loginAsGuest() {
        const guestUser = {
            id: 'guest',
            username: 'Guest',
            name: 'Guest Traveler',
            isGuest: true,
            mode: 'guest'
        };

        // Do NOT store in localStorage, sessionStorage, or SQLite database
        this.currentUser = guestUser;
        this.sessionToken = null;
        this.isRemembered = false;

        // Clear any old stored sessions so guest is strictly ephemeral
        try {
            localStorage.removeItem(this.STORAGE_KEY);
            localStorage.removeItem(this.SESSION_TOKEN_KEY);
            localStorage.removeItem(this.REMEMBER_ME_KEY);
            sessionStorage.removeItem(this.STORAGE_KEY);
            sessionStorage.removeItem(this.SESSION_TOKEN_KEY);
            sessionStorage.removeItem(this.REMEMBER_ME_KEY);
        } catch (e) {}

        this.notifyListeners();
        return guestUser;
    }

    /**
     * Save Trip record to SQLite & Online Cloud Database
     */
    async saveTripToDatabase(tripData) {
        // Privacy rule: Guest trips are never saved to database or cloud
        if (this.isGuest()) {
            return;
        }

        const payload = {
            id: 'trip-' + Date.now(),
            userId: this.currentUser ? this.currentUser.id : 'local-user',
            destinationName: tripData.destinationName,
            destinationFullName: tripData.destinationFullName,
            destLat: tripData.destLat,
            destLon: tripData.destLon,
            originName: tripData.originName,
            originLat: tripData.originLat,
            originLon: tripData.originLon,
            alertRadius: tripData.alertRadius,
            alarmSound: tripData.alarmSound,
            routeDistance: tripData.routeDistance || 0,
            travelDuration: tripData.travelDuration || '',
            status: 'Completed'
        };

        // 1. Sync to Online Cloud Database if available
        if (window.cloudDatabase) {
            window.cloudDatabase.saveTripOnline(payload).catch(() => {});
        }

        // 2. Sync to local SQLite server if available
        const base = this.getApiBase();
        try {
            await fetch(`${base}/api/user/trips`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
        } catch (e) {
            // Offline fallback
        }
    }

    /**
     * Fetch User Trips from SQLite
     */
    async fetchUserTripsFromDb(userId = null) {
        if (this.isGuest()) return;
        const targetUserId = userId || (this.currentUser ? this.currentUser.id : null);
        const base = this.getApiBase();
        const url = targetUserId ? `${base}/api/user/trips?userId=${encodeURIComponent(targetUserId)}` : `${base}/api/user/trips`;

        try {
            const resp = await fetch(url);
            if (resp.ok && resp.status !== 405) {
                const data = await this.safeParseJson(resp);
                if (data.trips && window.app) {
                    const formatted = data.trips.map(t => ({
                        id: t.id,
                        dest: t.destination_name,
                        date: new Date(t.created_at).toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' }),
                        radius: `${Math.round(t.alert_radius || 500)} m`,
                        status: t.status || 'Completed',
                        sound: t.alarm_sound || 'loud',
                        destLat: t.dest_lat,
                        destLon: t.dest_lon
                    }));
                    if (formatted.length > 0) {
                        window.app.tripHistory = formatted;
                        window.app.renderTripHistory();
                    }
                }
            }
        } catch (e) {
            // Server offline, try cloud
        }

        // 2. Fallback or augment with Supabase Cloud trips
        if (window.cloudDatabase && targetUserId) {
            try {
                const cloudTrips = await window.cloudDatabase.fetchUserTripsOnline(targetUserId);
                if (Array.isArray(cloudTrips) && cloudTrips.length > 0 && window.app) {
                    // Merge cloud trips with existing
                    const existingIds = new Set((window.app.tripHistory || []).map(t => t.id));
                    const newTrips = cloudTrips.filter(t => !existingIds.has(t.id));
                    if (newTrips.length > 0 || !window.app.tripHistory || window.app.tripHistory.length === 0) {
                        window.app.tripHistory = cloudTrips;
                        window.app.renderTripHistory();
                    }
                }
            } catch (ce) {}
        }
    }
}

// Global Auth & Trip persistence instance
window.authManager = new AuthManager();
