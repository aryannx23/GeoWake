/**
 * GeoWake - Geographic Math, Adaptive Polling & Anti-Jump Telemetry Engine
 * Implements Haversine distance, hysteresis, jump rejection & adaptive intervals
 */

class TelemetryEngine {
    constructor() {
        this.EARTH_RADIUS_METERS = 6371000;
        this.ACCURACY_THRESHOLD_METERS = 65; // Max acceptable GPS uncertainty
        this.CONSECUTIVE_REQUIRED = 2;       // Readings needed before alarm fires
        this.consecutiveHits = 0;
        this.lastValidLocation = null;
        this.jumpRejections = 0;
    }

    /**
     * Calculate geodesic distance between two points in meters using Haversine formula
     */
    calculateDistance(lat1, lon1, lat2, lon2) {
        const toRad = (x) => (x * Math.PI) / 180;
        const dLat = toRad(lat2 - lat1);
        const dLon = toRad(lon2 - lon1);
        const a =
            Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return Math.round(this.EARTH_RADIUS_METERS * c);
    }

    /**
     * Calculate initial compass bearing from start to destination in degrees (0-360)
     */
    calculateBearing(lat1, lon1, lat2, lon2) {
        const toRad = (x) => (x * Math.PI) / 180;
        const toDeg = (x) => (x * 180) / Math.PI;
        const y = Math.sin(toRad(lon2 - lon1)) * Math.cos(toRad(lat2));
        const x =
            Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
            Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(toRad(lon2 - lon1));
        const brng = (toDeg(Math.atan2(y, x)) + 360) % 360;
        return Math.round(brng);
    }

    /**
     * Adaptive Location Polling Frequency based on Distance
     * Distance > 10 km  --> 60s (low frequency / deep battery saving)
     * Distance 2-10 km  --> 25s (medium frequency)
     * Distance < 2 km   --> 5s  (high frequency for precision trigger)
     */
    getAdaptiveInterval(distanceMeters) {
        if (distanceMeters > 10000) {
            return { intervalSec: 60, mode: 'LOW_POWER', label: 'Battery Saver (60s)', tier: 1 };
        } else if (distanceMeters > 2000) {
            return { intervalSec: 25, mode: 'BALANCED', label: 'Balanced Mode (25s)', tier: 2 };
        } else {
            return { intervalSec: 5, mode: 'PRECISION', label: 'Precision Tracking (5s)', tier: 3 };
        }
    }

    /**
     * Anti-False-Trigger & GPS Jump Validation
     * Evaluates incoming GPS sample against accuracy bounds, impossible velocity jumps, and hysteresis
     */
    validateReading(sample, destLat, destLon, alertRadius) {
        const rawDistance = this.calculateDistance(sample.lat, sample.lon, destLat, destLon);

        // 1. Accuracy Check
        if (sample.accuracy > this.ACCURACY_THRESHOLD_METERS) {
            return {
                valid: false,
                reason: `Inaccurate GPS (±${sample.accuracy}m > ±${this.ACCURACY_THRESHOLD_METERS}m)`,
                distance: rawDistance,
                triggerAlarm: false,
                consecutiveHits: this.consecutiveHits
            };
        }

        // 2. Impossible Jump Check (e.g. jumping 3.5km in 1s without train speed)
        if (this.lastValidLocation) {
            const deltaDist = this.calculateDistance(
                this.lastValidLocation.lat,
                this.lastValidLocation.lon,
                sample.lat,
                sample.lon
            );
            const timeDiffSec = Math.max(1, (sample.timestamp - this.lastValidLocation.timestamp) / 1000);
            const apparentSpeedKmh = (deltaDist / timeDiffSec) * 3.6;

            // Flag if apparent speed exceeds 350 km/h (bullet train upper bounds)
            if (apparentSpeedKmh > 350 && deltaDist > 1000) {
                this.jumpRejections++;
                return {
                    valid: false,
                    reason: `GPS Jump Rejected (Apparent speed ${Math.round(apparentSpeedKmh)} km/h)`,
                    distance: rawDistance,
                    triggerAlarm: false,
                    consecutiveHits: this.consecutiveHits
                };
            }
        }

        this.lastValidLocation = sample;

        // 3. Radius & Hysteresis Evaluation
        const isInsideRadius = rawDistance <= alertRadius;

        if (isInsideRadius) {
            this.consecutiveHits++;
        } else {
            this.consecutiveHits = 0;
        }

        const shouldTrigger = this.consecutiveHits >= this.CONSECUTIVE_REQUIRED;

        return {
            valid: true,
            distance: rawDistance,
            isInsideRadius: isInsideRadius,
            consecutiveHits: this.consecutiveHits,
            requiredHits: this.CONSECUTIVE_REQUIRED,
            triggerAlarm: shouldTrigger,
            reason: shouldTrigger 
                ? 'Target Radius Reached & Verified' 
                : (isInsideRadius ? `Confirming (${this.consecutiveHits}/${this.CONSECUTIVE_REQUIRED} readings)` : 'In Transit')
        };
    }

    reset() {
        this.consecutiveHits = 0;
        this.lastValidLocation = null;
        this.jumpRejections = 0;
    }

    formatDistance(meters) {
        if (!meters || isNaN(meters)) return '--';
        if (meters >= 1000) {
            return (meters / 1000).toFixed(1) + ' km';
        }
        return Math.round(meters) + ' m';
    }

    formatEta(meters, speedKmh) {
        if (!meters || isNaN(meters)) return '--';
        
        // If moving at meaningful speed, calculate dynamically
        if (speedKmh && speedKmh >= 5) {
            const hours = meters / (speedKmh * 1000);
            const totalMinutes = Math.round(hours * 60);
            return this._formatMinutes(totalMinutes);
        }

        // When stationary or preparing, use realistic average transit speed (~50 km/h)
        const defaultSpeedKmh = 50;
        const totalMinutes = Math.max(1, Math.round((meters / (defaultSpeedKmh * 1000)) * 60));
        return this._formatMinutes(totalMinutes);
    }

    _formatMinutes(totalMinutes) {
        if (totalMinutes < 1) return '< 1 min';
        if (totalMinutes < 60) return `${totalMinutes} min`;
        const hrs = Math.floor(totalMinutes / 60);
        const mins = totalMinutes % 60;
        return mins > 0 ? `${hrs}h ${mins}m` : `${hrs}h`;
    }

    getExpectedArrivalTimestamp(totalMinutes) {
        if (!totalMinutes || isNaN(totalMinutes) || totalMinutes <= 0) return '--';
        const arrival = new Date(Date.now() + totalMinutes * 60 * 1000);
        return arrival.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
}

window.telemetryEngine = new TelemetryEngine();
