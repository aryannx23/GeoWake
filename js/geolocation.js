/**
 * GeoWake - Multi-Tier Live Geolocation & GPS Tracking Engine
 * Tier 1: High-Accuracy Hardware GPS (W3C watchPosition)
 * Tier 2: Standard Network/Wi-Fi Positioning (Fallback)
 * Tier 3: IP Geolocation API (Guaranteed fallback for desktop/browser restrictions)
 */

class LiveLocationTracker {
    constructor() {
        this.watchId = null;
        this.isTracking = false;
        this.lastPosition = null;
        this.lastTimestamp = null;
        this.onLocationUpdateCallback = null;
        this.onErrorCallback = null;
        this.onStatusChangeCallback = null;
        this.status = 'IDLE'; // IDLE | REQUESTING | TRACKING | ERROR | DENIED | NOT_SUPPORTED
        this.errorMessage = null;

        // Current real coordinates
        this.currentLat = null;
        this.currentLon = null;
        this.currentAccuracy = 15;
        this.currentSpeedKmh = 0;
        this.currentBearing = 0;
        this.sourceType = 'GPS'; // 'GPS' | 'NETWORK' | 'IP'
    }

    isSupported() {
        return 'geolocation' in navigator;
    }

    /**
     * Get single position snapshot (Locate Me) with multi-tier automatic fallback
     */
    async getCurrentPosition() {
        this.updateStatus('REQUESTING', 'Acquiring device GPS position...');

        // Tier 1: Try High Accuracy GPS (6 second timeout)
        try {
            const sample = await this._queryNavigatorGeo({ enableHighAccuracy: true, timeout: 6000, maximumAge: 0 });
            this.sourceType = 'GPS';
            this.updateStatus('TRACKING', `🛰️ Live GPS Locked (±${sample.accuracy}m)`);
            return sample;
        } catch (e1) {
            console.warn('High accuracy GPS query failed/timed out, attempting standard accuracy fallback...', e1);
        }

        // Tier 2: Try Standard Network/Wi-Fi Positioning (7 second timeout)
        try {
            const sample = await this._queryNavigatorGeo({ enableHighAccuracy: false, timeout: 7000, maximumAge: 60000 });
            this.sourceType = 'NETWORK';
            this.updateStatus('TRACKING', `📶 Network Location Locked (±${sample.accuracy}m)`);
            return sample;
        } catch (e2) {
            console.warn('Standard geolocation failed/timed out, attempting IP Geolocation fallback...', e2);
        }

        // Tier 3: IP Geolocation Fallback (Ensures desktop/laptop users always get their city coordinates)
        try {
            const sample = await this._queryIpLocation();
            if (sample) {
                this.sourceType = 'IP';
                this.updateStatus('TRACKING', `🌐 City Location Fixed via IP (${sample.city || 'Area'})`);
                return sample;
            }
        } catch (e3) {
            console.warn('IP Geolocation fallback failed', e3);
        }

        // Fallback default coordinates (Bengaluru Center) if all else fails offline
        const fallbackSample = {
            lat: 12.9716,
            lon: 77.5946,
            accuracy: 50,
            speedKmh: 0,
            bearing: 0,
            isLive: true,
            isFallback: true,
            timestamp: Date.now(),
            note: '📍 Using City Center Coordinates'
        };
        this.updateStatus('TRACKING', '📍 Default City Center Pin');
        return fallbackSample;
    }

    _queryNavigatorGeo(options) {
        return new Promise((resolve, reject) => {
            if (!this.isSupported()) {
                return reject(new Error('Geolocation not supported'));
            }
            navigator.geolocation.getCurrentPosition(
                (pos) => resolve(this._processCoords(pos)),
                (err) => reject(err),
                options
            );
        });
    }

    async _queryIpLocation() {
        // Free reliable IP geolocation services
        const endpoints = [
            'https://ipapi.co/json/',
            'https://api.bigdatacloud.net/data/reverse-geocode-client'
        ];

        for (const url of endpoints) {
            try {
                const resp = await fetch(url, { cache: 'no-cache' });
                if (resp.ok) {
                    const data = await resp.json();
                    const lat = parseFloat(data.latitude || data.lat);
                    const lon = parseFloat(data.longitude || data.lon || data.lng);
                    if (!isNaN(lat) && !isNaN(lon)) {
                        this.currentLat = lat;
                        this.currentLon = lon;
                        this.currentAccuracy = 1500;
                        this.lastPosition = { lat, lon };
                        this.lastTimestamp = Date.now();
                        return {
                            lat,
                            lon,
                            city: data.city || data.locality || 'Current City',
                            accuracy: 1500,
                            speedKmh: 0,
                            bearing: 0,
                            isLive: true,
                            isIpFallback: true,
                            timestamp: Date.now(),
                            note: `🌐 Network Location: ${data.city || 'Local Area'}, ${data.country_name || data.countryName || ''}`
                        };
                    }
                }
            } catch (e) {
                continue;
            }
        }
        return null;
    }

    /**
     * Start continuous live tracking
     */
    startTracking() {
        if (!this.isSupported()) {
            this.getCurrentPosition().then(sample => {
                if (this.onLocationUpdateCallback) this.onLocationUpdateCallback(sample);
            });
            return true;
        }

        if (this.isTracking && this.watchId !== null) {
            return true;
        }

        this.updateStatus('REQUESTING', 'Connecting to GPS satellites...');

        this.watchId = navigator.geolocation.watchPosition(
            (pos) => {
                this.isTracking = true;
                const sample = this._processCoords(pos);
                this.updateStatus('TRACKING', `🛰️ Live GPS Active (±${sample.accuracy}m)`);
                if (this.onLocationUpdateCallback) {
                    this.onLocationUpdateCallback(sample);
                }
            },
            (err) => {
                console.warn('watchPosition error or timeout, retaining position', err);
                if (err.code === 1) {
                    this.updateStatus('DENIED', 'Location permission denied');
                } else {
                    // Non-fatal, try fetching via standard/fallback
                    this.getCurrentPosition().then(sample => {
                        if (this.onLocationUpdateCallback) this.onLocationUpdateCallback(sample);
                    }).catch(() => {});
                }
            },
            {
                enableHighAccuracy: true,
                timeout: 10000,
                maximumAge: 5000
            }
        );

        return true;
    }

    /**
     * Stop continuous live tracking
     */
    stopTracking() {
        if (this.watchId !== null) {
            navigator.geolocation.clearWatch(this.watchId);
            this.watchId = null;
        }
        this.isTracking = false;
        this.updateStatus('IDLE', 'GPS Standby');
    }

    _processCoords(pos) {
        const { latitude, longitude, accuracy, speed, heading } = pos.coords;
        const now = pos.timestamp || Date.now();

        // Calculate speed if not supplied by device
        let speedKmh = 0;
        if (speed !== null && speed !== undefined && !isNaN(speed) && speed > 0) {
            speedKmh = Math.round(speed * 3.6);
        } else if (this.lastPosition && this.lastTimestamp) {
            const timeDeltaSec = (now - this.lastTimestamp) / 1000;
            if (timeDeltaSec > 0.5 && window.telemetryEngine) {
                const distMeters = window.telemetryEngine.calculateDistance(
                    this.lastPosition.lat, this.lastPosition.lon,
                    latitude, longitude
                );
                // Filter small jitter
                if (distMeters >= 3) {
                    const calcSpeed = (distMeters / timeDeltaSec) * 3.6;
                    if (calcSpeed < 320) {
                        speedKmh = Math.round(calcSpeed);
                    }
                }
            }
        }

        // Calculate bearing/heading
        let bearing = 0;
        if (heading !== null && heading !== undefined && !isNaN(heading)) {
            bearing = Math.round(heading);
        } else if (this.lastPosition && window.telemetryEngine) {
            bearing = window.telemetryEngine.calculateBearing(
                this.lastPosition.lat, this.lastPosition.lon,
                latitude, longitude
            );
        }

        this.currentLat = latitude;
        this.currentLon = longitude;
        this.currentAccuracy = Math.round(accuracy || 15);
        this.currentSpeedKmh = speedKmh;
        this.currentBearing = bearing;
        this.lastPosition = { lat: latitude, lon: longitude };
        this.lastTimestamp = now;

        return {
            lat: latitude,
            lon: longitude,
            accuracy: Math.round(accuracy || 15),
            speedKmh: speedKmh,
            bearing: bearing,
            isLive: true,
            timestamp: now,
            signalLost: false,
            note: `🛰️ Live Fix: (±${Math.round(accuracy || 15)}m), Speed: ${speedKmh} km/h`
        };
    }

    updateStatus(status, message) {
        this.status = status;
        this.errorMessage = (status === 'ERROR' || status === 'DENIED') ? message : null;
        if (this.onStatusChangeCallback) {
            this.onStatusChangeCallback(status, message);
        }
    }

    onLocationUpdate(cb) {
        this.onLocationUpdateCallback = cb;
    }

    onError(cb) {
        this.onErrorCallback = cb;
    }

    onStatusChange(cb) {
        this.onStatusChangeCallback = cb;
    }
}

window.liveTracker = new LiveLocationTracker();
