/**
 * GeoWake - Universal GPS Auto-Movement & Simulation Engine
 * Smoothly moves location marker automatically along the direct route from current position to destination
 */

class TripSimulator {
    constructor() {
        this.isRunning = false;
        this.progress = 0; // 0.0 to 1.0
        this.speedMultiplier = 20; // Default 20x for quick testing
        this.timer = null;
        this.onLocationUpdateCallback = null;
        this.onTripCompletedCallback = null;

        // Current route points
        this.origin = {
            name: 'Current Origin',
            lat: 23.3441,
            lon: 85.3096
        };
        this.destination = null;

        this.currentLat = this.origin.lat;
        this.currentLon = this.origin.lon;
        this.currentAccuracy = 12;
        this.currentSpeedKmh = 85;
        this.signalLost = false;
    }

    setRoute(origin, destination, keepProgress = false) {
        if (origin && origin.lat !== undefined && origin.lon !== undefined) {
            this.origin = origin;
        }
        if (destination && destination.lat !== undefined && destination.lon !== undefined) {
            this.destination = destination;
        }

        if (!keepProgress) {
            this.progress = 0;
            this.currentLat = this.origin.lat;
            this.currentLon = this.origin.lon;
        } else {
            this.jumpToProgress(this.progress);
        }
    }

    setSpeedMultiplier(multiplier) {
        this.speedMultiplier = Math.max(1, multiplier);
    }

    start() {
        if (!this.destination) return;
        if (this.isRunning) return;
        this.isRunning = true;
        this.tick();
    }

    pause() {
        this.isRunning = false;
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }
    }

    toggle() {
        if (this.isRunning) {
            this.pause();
            return false;
        } else {
            this.start();
            return true;
        }
    }

    reset() {
        this.pause();
        this.progress = 0;
        this.currentLat = this.origin.lat;
        this.currentLon = this.origin.lon;
        this.currentAccuracy = 12;
        this.signalLost = false;
        this.emitUpdate();
    }

    setDetailedPath(pathCoords) {
        if (Array.isArray(pathCoords) && pathCoords.length >= 2) {
            this.detailedPath = pathCoords;
        } else {
            this.detailedPath = null;
        }
    }

    jumpToProgress(prog) {
        this.progress = Math.max(0, Math.min(1, prog));
        const t = this.progress;

        if (this.detailedPath && this.detailedPath.length >= 2) {
            const totalPoints = this.detailedPath.length - 1;
            const targetIdx = t * totalPoints;
            const lowerIdx = Math.floor(targetIdx);
            const upperIdx = Math.min(this.detailedPath.length - 1, lowerIdx + 1);
            const segmentT = targetIdx - lowerIdx;

            const p1 = this.detailedPath[lowerIdx];
            const p2 = this.detailedPath[upperIdx];

            this.currentLat = p1[0] + (p2[0] - p1[0]) * segmentT;
            this.currentLon = p1[1] + (p2[1] - p1[1]) * segmentT;
        } else {
            this.currentLat = this.origin.lat + (this.destination.lat - this.origin.lat) * t;
            this.currentLon = this.origin.lon + (this.destination.lon - this.origin.lon) * t;
        }

        this.emitUpdate();
    }

    jumpToDistance(targetDistanceMeters) {
        const totalDistance = window.telemetryEngine.calculateDistance(
            this.origin.lat, this.origin.lon,
            this.destination.lat, this.destination.lon
        );

        if (totalDistance <= 0) return;
        const targetProgress = Math.max(0, Math.min(1, 1 - (targetDistanceMeters / totalDistance)));
        this.jumpToProgress(targetProgress);
    }

    stepForward(meters = 500) {
        const totalDistance = window.telemetryEngine.calculateDistance(
            this.origin.lat, this.origin.lon,
            this.destination.lat, this.destination.lon
        );
        if (totalDistance <= 0) return;
        const deltaProg = meters / totalDistance;
        this.jumpToProgress(Math.min(1, this.progress + deltaProg));
    }

    injectGpsJump() {
        // Send a temporary fake reading ~250m from destination
        const fakeLat = this.destination.lat + 0.0018;
        const fakeLon = this.destination.lon + 0.0018;
        
        if (this.onLocationUpdateCallback) {
            this.onLocationUpdateCallback({
                lat: fakeLat,
                lon: fakeLon,
                accuracy: 10,
                speedKmh: 90,
                bearing: 260,
                timestamp: Date.now(),
                isGlitch: true,
                note: '🚨 INJECTED GPS JUMP: Sudden spike near destination'
            });
        }
    }

    injectInaccurateGps() {
        this.currentAccuracy = 150;
        this.emitUpdate('⚠️ DEGRADED ACCURACY (±150m): Signal obstructed');
        setTimeout(() => {
            this.currentAccuracy = 12;
            this.emitUpdate('🟢 ACCURACY RESTORED (±12m)');
        }, 5000);
    }

    injectSignalLoss() {
        this.signalLost = true;
        this.emitUpdate('⚠️ GPS SIGNAL LOST: Searching for satellites...');
        setTimeout(() => {
            this.signalLost = false;
            this.emitUpdate('🟢 GPS SIGNAL RESTORED');
        }, 6000);
    }

    tick() {
        if (!this.isRunning) return;

        if (!this.signalLost) {
            // Speed calculation: calculate progress step per tick
            // 0.0004 * multiplier per 350ms
            const step = (0.0004 * this.speedMultiplier);
            this.progress = Math.min(1, this.progress + step);

            // Interpolate position
            const t = this.progress;
            this.currentLat = this.origin.lat + (this.destination.lat - this.origin.lat) * t;
            this.currentLon = this.origin.lon + (this.destination.lon - this.origin.lon) * t;

            this.emitUpdate();

            if (this.progress >= 1) {
                this.isRunning = false;
                if (this.onTripCompletedCallback) {
                    this.onTripCompletedCallback();
                }
                return;
            }
        }

        this.timer = setTimeout(() => this.tick(), 350);
    }

    emitUpdate(overrideNote = null) {
        if (this.onLocationUpdateCallback) {
            const bearing = window.telemetryEngine.calculateBearing(
                this.currentLat, this.currentLon,
                this.destination.lat, this.destination.lon
            );

            const baseSpeed = Math.min(120, Math.max(25, 20 * this.speedMultiplier * 0.3));

            this.onLocationUpdateCallback({
                lat: this.currentLat,
                lon: this.currentLon,
                accuracy: this.currentAccuracy,
                speedKmh: Math.round(baseSpeed + (Math.random() * 4 - 2)),
                bearing: bearing,
                progress: this.progress,
                signalLost: this.signalLost,
                isAutoMoving: this.isRunning,
                timestamp: Date.now(),
                note: overrideNote
            });
        }
    }

    onLocationUpdate(cb) {
        this.onLocationUpdateCallback = cb;
    }

    onTripCompleted(cb) {
        this.onTripCompletedCallback = cb;
    }
}

window.tripSimulator = new TripSimulator();
