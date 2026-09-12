/**
 * GeoWake - Main Web Application Controller & State Manager
 * Handles UI interactions, live GPS tracking, draggable markers, auto-movement & alarms
 */

class GeoWakeApp {
    constructor() {
        this.state = 'IDLE'; // IDLE | ACTIVE | TRIGGERED | COMPLETED
        this.trackingMode = 'LIVE'; // LIVE | SIM
        this.liveUserPosition = null;

        this.currentTrip = {
            destinationName: null,
            destinationFullName: null,
            destLat: null,
            destLon: null,
            originName: 'Current Location',
            originLat: 23.3441,
            originLon: 85.3096,
            alertRadius: 500, // meters
            alarmSound: 'loud',
            vibration: true,
            batteryMode: 'adaptive',
            startedAt: null,
            completedAt: null
        };

        this.savedPlaces = [
            { id: '1', name: 'Ranchi Junction (RNC)', icon: 'fa-train', lat: 23.3518, lon: 85.3378, desc: 'Station Road, Gosaintola' },
            { id: '2', name: 'Hatia Railway Station', icon: 'fa-train-subway', lat: 23.3039, lon: 85.3149, desc: 'Hatia, Ranchi' },
            { id: '3', name: 'Birsa Munda Airport', icon: 'fa-plane-departure', lat: 23.3143, lon: 85.3216, desc: 'Hinoo, Airport Road' },
            { id: '4', name: 'BIT Mesra Campus', icon: 'fa-graduation-cap', lat: 23.4123, lon: 85.4399, desc: 'Birla Institute, Mesra' },
            { id: '5', name: 'JSCA Int. Stadium', icon: 'fa-trophy', lat: 23.3108, lon: 85.2755, desc: 'Sector 4, Dhurwa, Ranchi' },
            { id: '6', name: 'Lalpur Chowk', icon: 'fa-city', lat: 23.3698, lon: 85.3346, desc: 'Circular Road, Lalpur' }
        ];

        this.tripHistory = [
            {
                id: 'hist-1',
                dest: 'Ranchi Railway Station',
                date: 'Sep 03, 2026',
                radius: '500 m',
                status: 'Completed',
                sound: 'Loud Alarm'
            },
            {
                id: 'hist-2',
                dest: 'Birsa Munda Airport',
                date: 'Sep 01, 2026',
                radius: '300 m',
                status: 'Completed',
                sound: 'Train Chime'
            }
        ];

        this.logEntries = [];
        this.wakeLockSentinel = null;
    }

    async requestWakeLock() {
        if ('wakeLock' in navigator) {
            try {
                this.wakeLockSentinel = await navigator.wakeLock.request('screen');
                this.wakeLockSentinel.addEventListener('release', () => {
                    this.wakeLockSentinel = null;
                });
                this.log('🔆 Screen Wake-Lock active: Your phone will stay awake during transit.');
            } catch (err) {
                console.warn('Screen Wake Lock could not be acquired', err);
            }
        }
    }

    releaseWakeLock() {
        if (this.wakeLockSentinel) {
            try {
                this.wakeLockSentinel.release();
            } catch (e) {}
            this.wakeLockSentinel = null;
        }
    }

    init() {
        this.loadStorage();
        this.bindEvents();
        this.renderSavedPlaces();
        this.renderTripHistory();

        // Re-acquire Screen Wake Lock when returning to tab during active trip
        document.addEventListener('visibilitychange', async () => {
            if (document.visibilityState === 'visible' && this.state === 'ACTIVE') {
                await this.requestWakeLock();
            }
        });

        // Link Live GPS Tracker
        if (window.liveTracker) {
            window.liveTracker.onLocationUpdate((sample) => {
                this.handleLocationSample(sample);
            });

            window.liveTracker.onStatusChange((status, msg) => {
                this.handleTrackerStatusChange(status, msg);
            });

            window.liveTracker.onError((err) => {
                this.log(`⚠️ GPS note: ${err}`);
            });
        }

        // Link Trip Simulator
        if (window.tripSimulator) {
            if (this.currentTrip.destLat && this.currentTrip.destLon) {
                window.tripSimulator.setRoute(
                    { name: this.currentTrip.originName, lat: this.currentTrip.originLat, lon: this.currentTrip.originLon },
                    { name: this.currentTrip.destinationName, lat: this.currentTrip.destLat, lon: this.currentTrip.destLon }
                );
            }

            window.tripSimulator.onLocationUpdate((sample) => {
                this.handleLocationSample(sample);
            });

            window.tripSimulator.onTripCompleted(() => {
                this.log('🏁 Auto-movement reached destination terminal.');
            });
        }

        // Check initial URL hash and set active page view (Direct access with Auth Guard)
        const initialHash = window.location.hash.toLowerCase();
        if (initialHash === '#app' || initialHash === '#/app') {
            if (this.isUserAuthenticated()) {
                this.navigateToView('app', false);
            } else {
                this.navigateToView('landing', false);
                this.showAuthRequiredNotice('Please sign in or continue as Guest to access the GeoWake app.');
            }
        } else {
            this.navigateToView('landing', false);
        }

        // Automatic initial location detection (multi-tier)
        this.locateUser(false);

        // Listen to Auth state changes to update navbar UI
        if (window.authManager) {
            window.authManager.onAuthChange((user) => this.updateAuthUi(user));
        }

        this.log('GeoWake initialized. Two-Page Navigation, Live GPS & Leaflet Map ready.');
    }

    syncMapMarkers() {
        if (!window.mapManager || !window.mapManager.map) return;

        // Place initial Destination & User Marker
        if (this.currentTrip.destLat && this.currentTrip.destLon) {
            window.mapManager.setDestination(
                this.currentTrip.destLat,
                this.currentTrip.destLon,
                this.currentTrip.destinationName,
                this.currentTrip.alertRadius
            );
            const mapSearchInput = document.getElementById('map-dest-search-input');
            const clearMapSearchBtn = document.getElementById('btn-clear-map-search');
            if (mapSearchInput && !mapSearchInput.value && this.currentTrip.destinationName) {
                mapSearchInput.value = this.currentTrip.destinationName;
            }
            if (clearMapSearchBtn && this.currentTrip.destinationName) {
                clearMapSearchBtn.classList.remove('hidden');
            }
        }

        window.mapManager.updateUserLocation(
            this.currentTrip.originLat,
            this.currentTrip.originLon,
            15,
            0,
            this.trackingMode === 'LIVE'
        );

        // Map callbacks
        window.mapManager.onSelectDestination((dest) => {
            this.setDestination(dest.name, dest.fullName, dest.lat, dest.lon);
        });

        window.mapManager.onUserDrag((lat, lon, isFinal) => {
            this.handleUserLocationDrag(lat, lon, isFinal);
        });

        if (this.currentTrip.destLat && this.currentTrip.destLon) {
            this.updateSuitableRouteAndEta();
        }
    }

    async updateSuitableRouteAndEta() {
        const pathCard = document.getElementById('travel-path-summary-card');
        const mapBadge = document.getElementById('map-route-badge');

        if (!this.currentTrip.destLat || !this.currentTrip.destLon) {
            if (pathCard) pathCard.classList.add('hidden');
            if (mapBadge) mapBadge.classList.add('hidden');
            return;
        }

        if (pathCard) pathCard.classList.remove('hidden');
        if (mapBadge) mapBadge.classList.remove('hidden');

        const statusBadge = document.getElementById('path-routing-status');
        const distEl = document.getElementById('path-distance-val');
        const durationEl = document.getElementById('path-duration-val');
        const etaEl = document.getElementById('path-eta-val');
        const mapBadgeTime = document.getElementById('map-badge-time');
        const mapBadgeDist = document.getElementById('map-badge-dist');

        if (statusBadge) statusBadge.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Calculating route...';

        const originLat = this.currentTrip.originLat;
        const originLon = this.currentTrip.originLon;
        const destLat = this.currentTrip.destLat;
        const destLon = this.currentTrip.destLon;

        const routeData = await window.mapManager.fetchSuitableRoute(originLat, originLon, destLat, destLon);

        let routeDistanceMeters;
        let travelSeconds;

        if (routeData && routeData.distanceMeters) {
            routeDistanceMeters = routeData.distanceMeters;
            travelSeconds = routeData.durationSeconds;
            if (statusBadge) statusBadge.innerHTML = '<i class="fas fa-check"></i> Optimal Route';
        } else {
            routeDistanceMeters = window.telemetryEngine.calculateDistance(originLat, originLon, destLat, destLon);
            travelSeconds = (routeDistanceMeters / (50 * 1000)) * 3600;
            if (statusBadge) statusBadge.innerHTML = '<i class="fas fa-satellite"></i> Direct Path';
        }

        const totalMinutes = Math.max(1, Math.round(travelSeconds / 60));
        const formattedDuration = window.telemetryEngine._formatMinutes(totalMinutes);
        const formattedDistance = window.telemetryEngine.formatDistance(routeDistanceMeters);
        const expectedArrival = window.telemetryEngine.getExpectedArrivalTimestamp(totalMinutes);

        if (distEl) distEl.innerText = formattedDistance;
        if (durationEl) durationEl.innerText = formattedDuration;
        if (etaEl) etaEl.innerText = expectedArrival;

        if (mapBadgeTime) mapBadgeTime.innerText = formattedDuration;
        if (mapBadgeDist) mapBadgeDist.innerText = formattedDistance;

        // Update mobile floating quick card ETA
        const floatEta = document.getElementById('mobile-float-eta');
        if (floatEta) floatEta.innerText = `${formattedDistance} • ~${formattedDuration}`;

        // Update active trip card ETA
        const activeEtaEl = document.getElementById('active-eta-val');
        if (activeEtaEl) {
            activeEtaEl.innerText = `${formattedDuration} (${expectedArrival})`;
        }

        // Pass route to simulator for smooth curved auto-movement
        if (window.tripSimulator && window.mapManager.currentPathCoordinates) {
            window.tripSimulator.setDetailedPath(window.mapManager.currentPathCoordinates);
        }

        this.log(`🛣️ Suitable Path: ${formattedDistance} • Est. Travel Time: ${formattedDuration} (Arrival ~${expectedArrival})`);
    }

    switchMobileTab(tabName) {
        const layoutGrid = document.getElementById('app-layout-grid');
        const tabMap = document.getElementById('mobile-tab-map');
        const tabSetup = document.getElementById('mobile-tab-setup');

        if (layoutGrid) {
            layoutGrid.dataset.activeTab = tabName;
        }

        if (tabName === 'map') {
            if (tabMap) tabMap.classList.add('active');
            if (tabSetup) tabSetup.classList.remove('active');
            if (window.mapManager && window.mapManager.map) {
                setTimeout(() => {
                    window.mapManager.map.invalidateSize();
                }, 50);
                setTimeout(() => {
                    window.mapManager.map.invalidateSize();
                }, 250);
            }
        } else {
            if (tabSetup) tabSetup.classList.add('active');
            if (tabMap) tabMap.classList.remove('active');
            window.scrollTo({ top: 0, behavior: 'smooth' });
        }
    }

    isUserAuthenticated() {
        return Boolean(window.authManager && window.authManager.isLoggedIn());
    }

    showAuthRequiredNotice(message = 'Please sign in or continue as Guest to access the GeoWake app.') {
        const authModal = document.getElementById('simple-auth-modal');
        const authAlertBox = document.getElementById('auth-alert-box');
        if (authModal) {
            authModal.classList.remove('hidden');
            if (authAlertBox) {
                authAlertBox.className = 'auth-status info';
                authAlertBox.innerHTML = `<i class="fas fa-lock"></i> ${message}`;
                authAlertBox.classList.remove('hidden');
            }
        }
    }

    navigateToView(viewName, updateHash = true) {
        const viewLanding = document.getElementById('view-landing');
        const viewApp = document.getElementById('view-app');

        if (viewName === 'app') {
            // Strict Auth Guard: Do not allow unauthenticated users into app view
            if (!this.isUserAuthenticated()) {
                if (viewApp) viewApp.classList.add('hidden');
                if (viewLanding) viewLanding.classList.remove('hidden');
                if (updateHash) history.replaceState(null, '', '#home');
                this.showAuthRequiredNotice('Please sign in or continue as Guest to access the GeoWake app.');
                return;
            }

            if (viewLanding) viewLanding.classList.add('hidden');
            if (viewApp) viewApp.classList.remove('hidden');
            if (updateHash) history.pushState(null, '', '#app');

            window.scrollTo({ top: 0, behavior: 'instant' });

            // Initialize or invalidate map when app container is visible
            if (!window.mapManager.map) {
                window.mapManager.init('interactive-map', this.currentTrip.originLat, this.currentTrip.originLon);
                this.syncMapMarkers();
            } else {
                setTimeout(() => {
                    window.mapManager.map.invalidateSize(true);
                    window.mapManager.fitBoundsToTrip();
                }, 50);
                setTimeout(() => {
                    window.mapManager.map.invalidateSize(true);
                }, 250);
            }

            // Carry over pending search query from landing if user searched before logging in
            if (this.pendingSearchQuery && this.pendingSearchQuery.length >= 2) {
                const query = this.pendingSearchQuery;
                this.pendingSearchQuery = null;
                const searchInput = document.getElementById('dest-search-input');
                if (searchInput) {
                    searchInput.value = query;
                    searchInput.focus();
                    setTimeout(async () => {
                        const places = await window.mapManager.searchPlace(query);
                        this.renderSearchResults(places);
                    }, 250);
                }
            }

            this.log('🚀 Jumped to GeoWake Live Application.');
        } else {
            if (viewApp) viewApp.classList.add('hidden');
            if (viewLanding) viewLanding.classList.remove('hidden');
            if (updateHash) history.pushState(null, '', '#home');

            window.scrollTo({ top: 0, behavior: 'smooth' });
        }
    }

    loadStorage() {
        try {
            const saved = localStorage.getItem('geowake_saved_places_ranchi_v1');
            if (saved) this.savedPlaces = JSON.parse(saved);

            const hist = localStorage.getItem('geowake_history_ranchi_v1') || localStorage.getItem('geowake_trip_history');
            if (hist) this.tripHistory = JSON.parse(hist);
        } catch (e) {
            console.error('Storage load failed', e);
        }
    }

    saveStorage() {
        try {
            localStorage.setItem('geowake_saved_places_ranchi_v1', JSON.stringify(this.savedPlaces));
            localStorage.setItem('geowake_history_ranchi_v1', JSON.stringify(this.tripHistory));
        } catch (e) {}
    }

    bindEvents() {
        // Page Navigation Event Handlers
        document.querySelectorAll('.btn-launch-app').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                const landingDestInput = document.getElementById('landing-dest-input');
                const query = landingDestInput ? landingDestInput.value.trim() : '';
                if (query) this.pendingSearchQuery = query;

                if (!this.isUserAuthenticated()) {
                    this.showAuthRequiredNotice('Please sign in or continue as Guest to start your alarm.');
                    return;
                }

                this.navigateToView('app');
                if (query && query.length >= 2) {
                    const searchInput = document.getElementById('dest-search-input');
                    if (searchInput) {
                        searchInput.value = query;
                        searchInput.focus();
                        setTimeout(async () => {
                            const places = await window.mapManager.searchPlace(query);
                            this.renderSearchResults(places);
                        }, 250);
                    }
                }
            });
        });

        const landingDestInputEl = document.getElementById('landing-dest-input');
        if (landingDestInputEl) {
            landingDestInputEl.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    const query = landingDestInputEl.value.trim();
                    if (query) this.pendingSearchQuery = query;

                    if (!this.isUserAuthenticated()) {
                        this.showAuthRequiredNotice('Please sign in or continue as Guest to start your alarm.');
                        return;
                    }

                    this.navigateToView('app');
                    if (query && query.length >= 2) {
                        const searchInput = document.getElementById('dest-search-input');
                        if (searchInput) {
                            searchInput.value = query;
                            searchInput.focus();
                            setTimeout(async () => {
                                const places = await window.mapManager.searchPlace(query);
                                this.renderSearchResults(places);
                            }, 250);
                        }
                    }
                }
            });
        }

        const btnBackHome = document.getElementById('btn-back-home');
        if (btnBackHome) {
            btnBackHome.addEventListener('click', (e) => {
                e.preventDefault();
                this.navigateToView('landing');
            });
        }

        window.addEventListener('hashchange', () => {
            const hash = window.location.hash.toLowerCase();
            if (hash === '#app' || hash === '#/app') {
                if (this.isUserAuthenticated()) {
                    this.navigateToView('app', false);
                } else {
                    this.navigateToView('landing', false);
                    this.showAuthRequiredNotice('Please sign in or continue as Guest to access the GeoWake app.');
                }
            } else if (hash === '#home' || hash === '#/home' || hash === '' || hash === '#') {
                this.navigateToView('landing', false);
            }
        });

        // History Modal Toggle
        const btnToggleHistory = document.getElementById('btn-toggle-history');
        const btnToggleHistoryLanding = document.getElementById('btn-toggle-history-landing');
        const historyModal = document.getElementById('history-modal');
        const btnCloseHistory = document.getElementById('btn-close-history');

        if (btnToggleHistory && historyModal) {
            btnToggleHistory.addEventListener('click', () => {
                this.renderTripHistory();
                historyModal.classList.remove('hidden');
            });
        }

        if (btnToggleHistoryLanding && historyModal) {
            btnToggleHistoryLanding.addEventListener('click', () => {
                this.renderTripHistory();
                historyModal.classList.remove('hidden');
            });
        }

        if (btnCloseHistory && historyModal) {
            btnCloseHistory.addEventListener('click', () => {
                historyModal.classList.add('hidden');
            });
        }

        if (historyModal) {
            historyModal.addEventListener('click', (e) => {
                if (e.target === historyModal) {
                    historyModal.classList.add('hidden');
                }
            });
        }

        // Mode Switcher Tabs
        const btnLiveMode = document.getElementById('mode-btn-live');
        const btnSimMode = document.getElementById('mode-btn-sim');

        if (btnLiveMode) {
            btnLiveMode.addEventListener('click', () => this.setTrackingMode('LIVE'));
        }
        if (btnSimMode) {
            btnSimMode.addEventListener('click', () => this.setTrackingMode('SIM'));
        }

        // Locate Me Button
        const locateBtn = document.getElementById('btn-locate-me');
        if (locateBtn) {
            locateBtn.addEventListener('click', () => this.locateUser(true));
        }

        // Auto-Move Play / Pause Button
        const autoMoveBtn = document.getElementById('btn-auto-move');
        if (autoMoveBtn) {
            autoMoveBtn.addEventListener('click', () => this.toggleAutoMove());
        }

        // Auto-Move Progress Slider
        const progressSlider = document.getElementById('auto-move-slider');
        if (progressSlider) {
            progressSlider.addEventListener('input', (e) => {
                const ratio = parseFloat(e.target.value) / 100;
                window.tripSimulator.jumpToProgress(ratio);
            });
        }

        // Step Forward Button (+500m)
        const stepBtn = document.getElementById('btn-step-forward');
        if (stepBtn) {
            stepBtn.addEventListener('click', () => {
                window.tripSimulator.stepForward(500);
                this.log('⚡ Stepped location 500m closer to destination.');
            });
        }

        // Jump to Inside Radius Button
        const jumpInsideBtn = document.getElementById('btn-jump-inside-radius');
        if (jumpInsideBtn) {
            jumpInsideBtn.addEventListener('click', () => {
                window.tripSimulator.jumpToDistance(Math.max(50, this.currentTrip.alertRadius * 0.7));
                this.log(`⚡ Jumped location inside ${this.currentTrip.alertRadius}m alert radius!`);
            });
        }

        // Floating Map Actions
        const btnMapZoomIn = document.getElementById('btn-map-zoom-in');
        if (btnMapZoomIn) {
            btnMapZoomIn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                if (window.mapManager) {
                    if (window.mapManager.map && window.mapManager.map.getZoom() >= 18) {
                        this.log('🔍 Maximum zoom reached (capped at 50m scale).');
                    } else {
                        window.mapManager.zoomIn();
                        this.log('🔍 Zoomed map in.');
                    }
                }
            });
        }

        const btnMapZoomOut = document.getElementById('btn-map-zoom-out');
        if (btnMapZoomOut) {
            btnMapZoomOut.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                if (window.mapManager) window.mapManager.zoomOut();
                this.log('🔍 Zoomed map out.');
            });
        }

        const btnMapRecenter = document.getElementById('btn-map-recenter');
        if (btnMapRecenter) {
            btnMapRecenter.addEventListener('click', () => {
                window.mapManager.centerOnUser(15);
                this.log('🎯 Centered map on current location marker.');
            });
        }

        const btnToggleFollow = document.getElementById('btn-toggle-follow');
        if (btnToggleFollow) {
            btnToggleFollow.addEventListener('click', () => {
                const isFollowing = window.mapManager.toggleFollowUser();
                btnToggleFollow.classList.toggle('active', isFollowing);
                this.log(isFollowing ? '📹 Auto-Pan Camera Enabled (Map follows location)' : '📹 Auto-Pan Camera Disabled');
            });
        }

        const btnMapLayer = document.getElementById('btn-map-layer');
        if (btnMapLayer) {
            btnMapLayer.addEventListener('click', () => {
                const nextLayer = window.mapManager.toggleTileLayer();
                this.log(`🗺️ Map style switched to: ${nextLayer.toUpperCase()}`);
            });
        }

        const btnMapClearDest = document.getElementById('btn-map-clear-dest');
        if (btnMapClearDest) {
            btnMapClearDest.addEventListener('click', () => {
                this.removeDestination();
            });
        }

        const btnMapFit = document.getElementById('btn-map-fit');
        if (btnMapFit) {
            btnMapFit.addEventListener('click', () => {
                window.mapManager.fitBoundsToTrip();
                this.log('🗺️ Fitted map view to full trip bounds.');
            });
        }

        // Initialize Floating Map Search Bar
        this.setupMapSearch();

        // Remove Destination Button
        const removeDestBtn = document.getElementById('btn-remove-dest');
        if (removeDestBtn) {
            removeDestBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.removeDestination();
            });
        }

        // Destination Search Input
        const searchInput = document.getElementById('dest-search-input');
        const searchResults = document.getElementById('search-results-dropdown');
        let debounceTimer;

        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                clearTimeout(debounceTimer);
                const query = e.target.value.trim();
                if (query.length < 2) {
                    if (searchResults) searchResults.classList.add('hidden');
                    return;
                }
                debounceTimer = setTimeout(async () => {
                    const places = await window.mapManager.searchPlace(query);
                    this.renderSearchResults(places);
                }, 400);
            });
        }

        // Radius Preset Buttons
        document.querySelectorAll('.radius-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.radius-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                const radius = parseInt(btn.dataset.radius);
                this.setAlertRadius(radius);
            });
        });

        // Radius Custom Slider
        const customSlider = document.getElementById('custom-radius-slider');
        const customDisplay = document.getElementById('custom-radius-val');
        if (customSlider) {
            customSlider.addEventListener('input', (e) => {
                const val = parseInt(e.target.value);
                if (customDisplay) customDisplay.innerText = val >= 1000 ? `${(val/1000).toFixed(1)} km` : `${val} m`;
                this.setAlertRadius(val);
            });
        }

        // Sound Selection Radio Cards / Pills
        document.querySelectorAll('.sound-option-card, .sound-pill-opt').forEach(card => {
            card.addEventListener('click', () => {
                document.querySelectorAll('.sound-option-card, .sound-pill-opt').forEach(c => c.classList.remove('selected'));
                card.classList.add('selected');
                const soundId = card.dataset.sound;
                this.currentTrip.alarmSound = soundId;

                // Play a brief sample tone
                if (window.soundEngine) {
                    window.soundEngine.playSound(soundId, false);
                }
            });
        });

        // Start Trip Button
        const startTripBtn = document.getElementById('btn-start-trip');
        if (startTripBtn) {
            startTripBtn.addEventListener('click', () => this.startTrip());
        }

        // Stop Trip Button
        const stopTripBtn = document.getElementById('btn-stop-trip');
        if (stopTripBtn) {
            stopTripBtn.addEventListener('click', () => this.stopTrip('Trip Cancelled by user'));
        }

        // Alarm Dismiss Button
        const dismissAlarmBtn = document.getElementById('btn-dismiss-alarm');
        if (dismissAlarmBtn) {
            dismissAlarmBtn.addEventListener('click', () => this.dismissAlarm());
        }

        // Alarm Snooze Button
        const snoozeAlarmBtn = document.getElementById('btn-snooze-alarm');
        if (snoozeAlarmBtn) {
            snoozeAlarmBtn.addEventListener('click', () => this.snoozeAlarm());
        }

        // Preset Journeys Selector
        const presetSelect = document.getElementById('journey-preset-select');
        if (presetSelect) {
            presetSelect.addEventListener('change', (e) => {
                this.loadJourneyPreset(e.target.value);
            });
        }

        // Simulator Speed Controls
        document.querySelectorAll('.sim-speed-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.sim-speed-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                const speed = parseFloat(btn.dataset.speed);
                window.tripSimulator.setSpeedMultiplier(speed);
                this.log(`⚡ Speed multiplier set to ${speed}x`);
            });
        });

        // Simulator Play/Pause
        const simPlayBtn = document.getElementById('btn-sim-play');
        if (simPlayBtn) {
            simPlayBtn.addEventListener('click', () => this.toggleAutoMove());
        }

        // Edge Case Trigger Buttons
        const btnGpsJump = document.getElementById('btn-inject-jump');
        if (btnGpsJump) {
            btnGpsJump.addEventListener('click', () => {
                window.tripSimulator.injectGpsJump();
                this.log('⚠️ Injected simulated GPS Jump (+300m sudden spike)');
            });
        }

        const btnDegradedGps = document.getElementById('btn-inject-degraded');
        if (btnDegradedGps) {
            btnDegradedGps.addEventListener('click', () => {
                window.tripSimulator.injectInaccurateGps();
                this.log('⚠️ Injected degraded GPS accuracy (±150m)');
            });
        }

        const btnTunnelLoss = document.getElementById('btn-inject-blackout');
        if (btnTunnelLoss) {
            btnTunnelLoss.addEventListener('click', () => {
                window.tripSimulator.injectSignalLoss();
                this.log('⚠️ Injected Tunnel Signal Blackout (Searching GPS...)');
            });
        }

        const btnJumpNear = document.getElementById('btn-jump-near');
        if (btnJumpNear) {
            btnJumpNear.addEventListener('click', () => {
                window.tripSimulator.jumpToDistance(1200);
                this.log('⚡ Jumped location to 1.2 km from destination');
            });
        }

        const btnTestTrigger = document.getElementById('btn-test-trigger');
        if (btnTestTrigger) {
            btnTestTrigger.addEventListener('click', () => {
                this.triggerAlarm('Manual Test Alarm Triggered');
            });
        }

        // ── SIMPLE USERNAME & PASSWORD AUTH EVENT HANDLERS ──
        const authModal = document.getElementById('simple-auth-modal');
        const btnCloseAuth = document.getElementById('btn-close-simple-auth');
        const tabBtnLogin = document.getElementById('tab-btn-login');
        const tabBtnRegister = document.getElementById('tab-btn-register');
        const formLogin = document.getElementById('form-auth-login');
        const formRegister = document.getElementById('form-auth-register');
        const authAlertBox = document.getElementById('auth-alert-box');

        const openAuthModal = () => {
            if (authModal) {
                authModal.classList.remove('hidden');
                if (authAlertBox) {
                    authAlertBox.classList.add('hidden');
                    authAlertBox.textContent = '';
                }
            }
        };

        // Helper to reset password field visibility to hidden
        const resetPasswordVisibility = (btnId, inputId) => {
            const btn = document.getElementById(btnId);
            const input = document.getElementById(inputId);
            if (input && input.type !== 'password') {
                input.type = 'password';
            }
            if (btn) {
                btn.innerHTML = '<i class="fas fa-eye"></i>';
                btn.title = 'Show password';
                btn.setAttribute('aria-label', 'Show password');
                btn.classList.remove('active');
            }
        };

        // Wire show/hide password buttons
        const setupPasswordToggle = (btnId, inputId) => {
            const btn = document.getElementById(btnId);
            const input = document.getElementById(inputId);
            if (!btn || !input) return;

            btn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const isPassword = input.type === 'password';
                if (isPassword) {
                    input.type = 'text';
                    btn.innerHTML = '<i class="fas fa-eye-slash"></i>';
                    btn.title = 'Hide password';
                    btn.setAttribute('aria-label', 'Hide password');
                    btn.classList.add('active');
                } else {
                    input.type = 'password';
                    btn.innerHTML = '<i class="fas fa-eye"></i>';
                    btn.title = 'Show password';
                    btn.setAttribute('aria-label', 'Show password');
                    btn.classList.remove('active');
                }
                input.focus();
            });
        };

        setupPasswordToggle('btn-toggle-login-password', 'login-password');
        setupPasswordToggle('btn-toggle-reg-password', 'reg-password');

        const closeAuthModal = () => {
            if (authModal) {
                authModal.classList.add('hidden');
                if (authAlertBox) authAlertBox.classList.add('hidden');
            }
            resetPasswordVisibility('btn-toggle-login-password', 'login-password');
            resetPasswordVisibility('btn-toggle-reg-password', 'reg-password');
        };

        document.querySelectorAll('.btn-auth-trigger').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                openAuthModal();
            });
        });

        if (btnCloseAuth) {
            btnCloseAuth.addEventListener('click', () => closeAuthModal());
        }

        if (authModal) {
            authModal.addEventListener('click', (e) => {
                if (e.target === authModal) closeAuthModal();
            });
        }

        if (tabBtnLogin && tabBtnRegister) {
            tabBtnLogin.addEventListener('click', () => {
                tabBtnLogin.classList.add('active');
                tabBtnRegister.classList.remove('active');
                if (formLogin) formLogin.classList.remove('hidden');
                if (formRegister) formRegister.classList.add('hidden');
                if (authAlertBox) authAlertBox.classList.add('hidden');
                resetPasswordVisibility('btn-toggle-reg-password', 'reg-password');
            });

            tabBtnRegister.addEventListener('click', () => {
                tabBtnRegister.classList.add('active');
                tabBtnLogin.classList.remove('active');
                if (formRegister) formRegister.classList.remove('hidden');
                if (formLogin) formLogin.classList.add('hidden');
                if (authAlertBox) authAlertBox.classList.add('hidden');
                resetPasswordVisibility('btn-toggle-login-password', 'login-password');
            });
        }

        // Remember Me checkbox toggle listener for status badge
        const rememberCheckbox = document.getElementById('login-remember-me');
        const rememberBadge = document.getElementById('remember-me-status-badge');
        if (rememberCheckbox && rememberBadge) {
            rememberCheckbox.addEventListener('change', () => {
                if (rememberCheckbox.checked) {
                    rememberBadge.className = 'remember-me-badge';
                    rememberBadge.innerHTML = '<i class="fas fa-shield-halved"></i> Stay Signed In';
                    rememberBadge.title = 'Enabled: Stay logged in across restarts.';
                } else {
                    rememberBadge.className = 'remember-me-badge session-only';
                    rememberBadge.innerHTML = '<i class="fas fa-clock"></i> Session Only';
                    rememberBadge.title = 'Disabled: You will have to log in every time you close the app.';
                }
            });
        }

        if (formLogin) {
            formLogin.addEventListener('submit', async (e) => {
                e.preventDefault();
                const username = document.getElementById('login-username')?.value.trim();
                const password = document.getElementById('login-password')?.value;
                const rememberMe = document.getElementById('login-remember-me')?.checked ?? true;
                const submitBtn = document.getElementById('btn-submit-login');

                try {
                    if (submitBtn) submitBtn.disabled = true;
                    if (authAlertBox) {
                        authAlertBox.className = 'auth-status info';
                        authAlertBox.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Signing in...';
                        authAlertBox.classList.remove('hidden');
                    }

                    const user = await window.authManager.login(username, password, rememberMe);
                    if (authAlertBox) {
                        authAlertBox.className = 'auth-status success';
                        authAlertBox.innerHTML = `<i class="fas fa-check-circle"></i> Welcome back, <strong>@${user.username}</strong>!`;
                    }
                    this.log(`✅ Signed in as @${user.username} (${rememberMe ? 'Persistent session' : 'Session-only'})`);
                    setTimeout(() => {
                        closeAuthModal();
                        formLogin.reset();
                    }, 500);
                } catch (err) {
                    if (authAlertBox) {
                        authAlertBox.className = 'auth-status error';
                        authAlertBox.innerHTML = `<i class="fas fa-circle-exclamation"></i> ${err.message}`;
                        authAlertBox.classList.remove('hidden');
                    }
                } finally {
                    if (submitBtn) submitBtn.disabled = false;
                }
            });
        }

        if (formRegister) {
            formRegister.addEventListener('submit', async (e) => {
                e.preventDefault();
                const username = document.getElementById('reg-username')?.value.trim();
                const password = document.getElementById('reg-password')?.value;
                const name = document.getElementById('reg-name')?.value.trim();
                const rememberMe = document.getElementById('reg-remember-me')?.checked ?? true;
                const submitBtn = document.getElementById('btn-submit-register');

                try {
                    if (submitBtn) submitBtn.disabled = true;
                    if (authAlertBox) {
                        authAlertBox.className = 'auth-status info';
                        authAlertBox.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Creating account...';
                        authAlertBox.classList.remove('hidden');
                    }

                    const user = await window.authManager.register(username, password, name, rememberMe);
                    if (authAlertBox) {
                        authAlertBox.className = 'auth-status success';
                        authAlertBox.innerHTML = `<i class="fas fa-check-circle"></i> Account created! Welcome, <strong>@${user.username}</strong>!`;
                    }
                    this.log(`🎉 Account registered for @${user.username}`);
                    setTimeout(() => {
                        closeAuthModal();
                        formRegister.reset();
                    }, 500);
                } catch (err) {
                    if (authAlertBox) {
                        authAlertBox.className = 'auth-status error';
                        authAlertBox.innerHTML = `<i class="fas fa-circle-exclamation"></i> ${err.message}`;
                        authAlertBox.classList.remove('hidden');
                    }
                } finally {
                    if (submitBtn) submitBtn.disabled = false;
                }
            });
        }

        // Guest Mode button handler
        const btnGuestLogin = document.getElementById('btn-guest-login');
        if (btnGuestLogin) {
            btnGuestLogin.addEventListener('click', (e) => {
                e.preventDefault();
                window.authManager.loginAsGuest();
                if (authAlertBox) {
                    authAlertBox.className = 'auth-status success';
                    authAlertBox.innerHTML = '<i class="fas fa-user-secret"></i> Logged in as Guest. Session is temporary.';
                    authAlertBox.classList.remove('hidden');
                }
                this.log('👤 Entered Guest Mode. Login data and trip history will not be saved.');
                setTimeout(() => {
                    closeAuthModal();
                    this.navigateToView('app');
                }, 300);
            });
        }

        // Sign Out buttons
        ['btn-sign-out-landing', 'btn-sign-out-app'].forEach(id => {
            const btn = document.getElementById(id);
            if (btn) {
                btn.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    window.authManager.logout();
                    this.navigateToView('landing');
                    this.log('🔒 Signed out.');
                });
            }
        });

        // Mobile View Segmented Tabs Switcher
        const tabMapBtn = document.getElementById('mobile-tab-map');
        const tabSetupBtn = document.getElementById('mobile-tab-setup');
        if (tabMapBtn) {
            tabMapBtn.addEventListener('click', () => this.switchMobileTab('map'));
        }
        if (tabSetupBtn) {
            tabSetupBtn.addEventListener('click', () => this.switchMobileTab('setup'));
        }

        // Mobile Floating Action Bar Buttons
        const btnMobileSettings = document.getElementById('btn-mobile-open-settings');
        if (btnMobileSettings) {
            btnMobileSettings.addEventListener('click', () => this.switchMobileTab('setup'));
        }

        const btnMobileStart = document.getElementById('btn-mobile-start-trip');
        if (btnMobileStart) {
            btnMobileStart.addEventListener('click', () => {
                if (this.state === 'ACTIVE') {
                    this.stopTrip('Trip Cancelled from Mobile Map');
                } else {
                    this.startTrip();
                }
            });
        }

        // Mobile Simulator Drawer Toggle
        const btnToggleSim = document.getElementById('btn-toggle-mobile-sim');
        if (btnToggleSim) {
            btnToggleSim.addEventListener('click', () => {
                const accordion = btnToggleSim.closest('.mobile-sim-accordion');
                if (accordion) accordion.classList.toggle('open');
            });
        }
    }

    updateAuthUi(user) {
        const btnOpenLanding = document.getElementById('btn-open-auth-landing');
        const userBadgeLanding = document.getElementById('user-badge-landing');
        const userInitialLanding = document.getElementById('user-initial-landing');
        const userNameLanding = document.getElementById('user-name-landing');

        const btnOpenApp = document.getElementById('btn-open-auth-app');
        const userBadgeApp = document.getElementById('user-badge-app');
        const userInitialApp = document.getElementById('user-initial-app');
        const userNameApp = document.getElementById('user-name-app');

        if (user) {
            const isGuest = !!user.isGuest;
            const initial = isGuest ? '<i class="fas fa-user-secret"></i>' : (user.name || user.username || 'U')[0].toUpperCase();
            const displayName = isGuest ? 'Guest' : (user.username || 'User');
            const logoutTitle = isGuest ? 'Exit Guest Mode' : 'Sign Out';

            [btnOpenLanding, btnOpenApp].forEach(btn => btn?.classList.add('hidden'));

            [userBadgeLanding, userBadgeApp].forEach(b => {
                if (!b) return;
                b.classList.remove('hidden');
                b.classList.toggle('guest-badge-pill', isGuest);
            });

            [userInitialLanding, userInitialApp].forEach(el => {
                if (el) el.innerHTML = initial;
            });

            [userNameLanding, userNameApp].forEach(el => {
                if (el) {
                    el.innerHTML = isGuest
                        ? `<span class="guest-name-label">Guest</span> <span class="guest-nav-tag">Private</span>`
                        : `@${displayName}`;
                }
            });

            ['btn-sign-out-landing', 'btn-sign-out-app'].forEach(btnId => {
                const b = document.getElementById(btnId);
                if (b) b.title = logoutTitle;
            });
        } else {
            [btnOpenLanding, btnOpenApp].forEach(btn => btn?.classList.remove('hidden'));
            [userBadgeLanding, userBadgeApp].forEach(b => {
                if (!b) return;
                b.classList.add('hidden');
                b.classList.remove('guest-badge-pill');
            });
        }
    }

    setTrackingMode(mode, logChange = true) {
        this.trackingMode = mode;

        const btnLive = document.getElementById('mode-btn-live');
        const btnSim = document.getElementById('mode-btn-sim');

        if (mode === 'LIVE') {
            if (btnLive) btnLive.classList.add('active');
            if (btnSim) btnSim.classList.remove('active');

            if (this.state === 'ACTIVE') {
                window.liveTracker.startTracking();
            }

            if (this.liveUserPosition) {
                window.mapManager.updateUserLocation(
                    this.liveUserPosition.lat,
                    this.liveUserPosition.lon,
                    this.liveUserPosition.accuracy,
                    this.liveUserPosition.bearing,
                    true
                );
            }

            if (logChange) this.log('🛰️ Mode Switched: Live GPS & Auto-Move Tracking Active.');
        } else {
            if (btnSim) btnSim.classList.add('active');
            if (btnLive) btnLive.classList.remove('active');

            if (logChange) this.log('🚆 Mode Switched: Route Journey Simulator.');
        }
    }

    async locateUser(userInitiated = true) {
        const locateBtn = document.getElementById('btn-locate-me');
        const labelEl = document.getElementById('live-gps-status-label');
        const detailsEl = document.getElementById('live-gps-details-text');

        if (locateBtn) {
            locateBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Locating...';
            locateBtn.disabled = true;
        }

        try {
            const sample = await window.liveTracker.getCurrentPosition();
            this.liveUserPosition = sample;

            // Update Origin in trip configuration
            this.currentTrip.originLat = sample.lat;
            this.currentTrip.originLon = sample.lon;
            this.currentTrip.originName = sample.city ? `${sample.city} (My Location)` : 'My Live Location';

            // Sync Simulator Route from this new origin to current destination
            window.tripSimulator.setRoute(
                { name: this.currentTrip.originName, lat: sample.lat, lon: sample.lon },
                { name: this.currentTrip.destinationName, lat: this.currentTrip.destLat, lon: this.currentTrip.destLon }
            );

            // Update Map Marker
            window.mapManager.updateUserLocation(sample.lat, sample.lon, sample.accuracy, sample.bearing, true);
            window.mapManager.centerOnUser(14);

            if (labelEl) labelEl.innerText = `🛰️ Location Fixed (±${sample.accuracy}m)`;
            if (detailsEl) {
                detailsEl.innerText = `Lat: ${sample.lat.toFixed(5)}, Lon: ${sample.lon.toFixed(5)} • Drag marker to test!`;
            }

            // Calculate distance to destination
            const dist = window.telemetryEngine.calculateDistance(
                sample.lat, sample.lon,
                this.currentTrip.destLat, this.currentTrip.destLon
            );

            // Start continuous live tracking
            window.liveTracker.startTracking();

            // Calculate suitable travel path & time
            this.updateSuitableRouteAndEta();
            window.mapManager.fitBoundsToTrip();

            this.log(`📍 Location Fixed: (${sample.lat.toFixed(5)}, ${sample.lon.toFixed(5)}) • ${window.telemetryEngine.formatDistance(dist)} to destination.`);
        } catch (err) {
            if (labelEl) labelEl.innerText = '📍 Location Fixed';
            if (detailsEl) detailsEl.innerText = 'Drag location marker or click map to move';
            if (userInitiated) {
                this.log(`⚠️ Geolocation note: ${err.message}`);
            }
        } finally {
            if (locateBtn) {
                locateBtn.innerHTML = '<i class="fas fa-crosshairs"></i> Locate Me';
                locateBtn.disabled = false;
            }
        }
    }

    handleUserLocationDrag(lat, lon, isFinal) {
        this.currentTrip.originLat = lat;
        this.currentTrip.originLon = lon;

        // Sync simulator route
        window.tripSimulator.currentLat = lat;
        window.tripSimulator.currentLon = lon;
        window.tripSimulator.origin.lat = lat;
        window.tripSimulator.origin.lon = lon;

        const sample = {
            lat: lat,
            lon: lon,
            accuracy: 10,
            speedKmh: 45,
            bearing: window.telemetryEngine.calculateBearing(lat, lon, this.currentTrip.destLat, this.currentTrip.destLon),
            isLive: true,
            timestamp: Date.now()
        };

        this.handleLocationSample(sample);

        if (isFinal) {
            this.updateSuitableRouteAndEta();
            const dist = window.telemetryEngine.calculateDistance(lat, lon, this.currentTrip.destLat, this.currentTrip.destLon);
            this.log(`📍 Location marker moved to (${lat.toFixed(4)}, ${lon.toFixed(4)}) • Distance: ${window.telemetryEngine.formatDistance(dist)}`);
        }
    }

    toggleAutoMove() {
        const isRunning = window.tripSimulator.toggle();
        const autoMoveBtn = document.getElementById('btn-auto-move');
        const simPlayBtn = document.getElementById('btn-sim-play');

        const btnText = isRunning ? '<i class="fas fa-pause"></i> Pause Auto-Move' : '<i class="fas fa-play"></i> Auto-Move Towards Dest';
        if (autoMoveBtn) autoMoveBtn.innerHTML = btnText;
        if (simPlayBtn) simPlayBtn.innerHTML = isRunning ? '<i class="fas fa-pause"></i> Pause' : '<i class="fas fa-play"></i> Sim';

        if (isRunning) {
            // Ensure route starts from current position to destination
            window.tripSimulator.setRoute(
                { name: this.currentTrip.originName, lat: this.currentTrip.originLat, lon: this.currentTrip.originLon },
                { name: this.currentTrip.destinationName, lat: this.currentTrip.destLat, lon: this.currentTrip.destLon },
                true
            );
            this.log('🚀 Auto-moving current location towards destination in real-time...');
        } else {
            this.log('⏸️ Auto-movement paused.');
        }
    }

    handleTrackerStatusChange(status, msg) {
        const labelEl = document.getElementById('live-gps-status-label');
        if (labelEl) labelEl.innerText = msg;
        const appStatus = document.getElementById('app-status-badge');
        if (appStatus && this.state !== 'ACTIVE') {
            appStatus.innerText = status === 'TRACKING' ? 'GPS Active' : 'Ready';
        }
    }

    renderSearchResults(places) {
        const dropdown = document.getElementById('search-results-dropdown');
        if (!dropdown) return;

        if (places.length === 0) {
            dropdown.innerHTML = `<div class="search-result-item no-results">No places found. Try a different query.</div>`;
            dropdown.classList.remove('hidden');
            return;
        }

        dropdown.innerHTML = places.map((place, idx) => `
            <div class="search-result-item" data-index="${idx}">
                <div class="result-title"><i class="fas fa-location-dot"></i> ${place.name}</div>
                <div class="result-subtitle">${place.fullName}</div>
            </div>
        `).join('');

        dropdown.classList.remove('hidden');

        dropdown.querySelectorAll('.search-result-item').forEach((item, idx) => {
            item.addEventListener('click', () => {
                const selected = places[idx];
                this.setDestination(selected.name, selected.fullName, selected.lat, selected.lon);
                dropdown.classList.add('hidden');
                const searchInput = document.getElementById('dest-search-input');
                if (searchInput) searchInput.value = selected.name;
            });
        });
    }

    setDestination(name, fullName, lat, lon) {
        this.currentTrip.destinationName = name;
        this.currentTrip.destinationFullName = fullName;
        this.currentTrip.destLat = lat;
        this.currentTrip.destLon = lon;

        // Update UI
        const nameEl = document.getElementById('current-dest-name');
        const coordsEl = document.getElementById('current-dest-coords');
        const floatNameEl = document.getElementById('mobile-float-dest-name');
        const mapSearchInput = document.getElementById('map-dest-search-input');
        const clearMapSearchBtn = document.getElementById('btn-clear-map-search');
        const panelSearchInput = document.getElementById('dest-search-input');

        if (nameEl) nameEl.innerText = name;
        if (coordsEl) coordsEl.innerText = `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
        if (floatNameEl) floatNameEl.innerText = name;
        if (mapSearchInput) mapSearchInput.value = name;
        if (clearMapSearchBtn) clearMapSearchBtn.classList.remove('hidden');
        if (panelSearchInput) panelSearchInput.value = name;

        // Toggle selected vs empty destination cards
        const selectedDestCard = document.getElementById('selected-dest-card');
        const noDestCard = document.getElementById('no-dest-card');
        if (selectedDestCard) selectedDestCard.classList.remove('hidden');
        if (noDestCard) noDestCard.classList.add('hidden');

        window.mapManager.setDestination(lat, lon, name, this.currentTrip.alertRadius);
        window.tripSimulator.setRoute(
            { name: this.currentTrip.originName, lat: this.currentTrip.originLat, lon: this.currentTrip.originLon },
            { name: name, lat: lat, lon: lon }
        );

        this.updateSuitableRouteAndEta();
        this.log(`🎯 Destination selected: ${name} (${lat.toFixed(4)}, ${lon.toFixed(4)})`);
    }

    removeDestination() {
        this.currentTrip.destinationName = null;
        this.currentTrip.destinationFullName = null;
        this.currentTrip.destLat = null;
        this.currentTrip.destLon = null;

        // Update UI
        const selectedDestCard = document.getElementById('selected-dest-card');
        const noDestCard = document.getElementById('no-dest-card');
        const searchInput = document.getElementById('dest-search-input');
        const mapSearchInput = document.getElementById('map-dest-search-input');
        const clearMapSearchBtn = document.getElementById('btn-clear-map-search');
        const mapSearchDropdown = document.getElementById('map-search-dropdown');
        const pathCard = document.getElementById('travel-path-summary-card');
        const mapBadge = document.getElementById('map-route-badge');
        const floatNameEl = document.getElementById('mobile-float-dest-name');
        const floatEta = document.getElementById('mobile-float-eta');

        if (selectedDestCard) selectedDestCard.classList.add('hidden');
        if (noDestCard) noDestCard.classList.remove('hidden');
        if (searchInput) searchInput.value = '';
        if (mapSearchInput) mapSearchInput.value = '';
        if (clearMapSearchBtn) clearMapSearchBtn.classList.add('hidden');
        if (mapSearchDropdown) mapSearchDropdown.classList.add('hidden');
        if (pathCard) pathCard.classList.add('hidden');
        if (mapBadge) mapBadge.classList.add('hidden');
        if (floatNameEl) floatNameEl.innerText = 'No destination chosen';
        if (floatEta) floatEta.innerText = 'Click map or search';

        // Clear from map & pause simulator
        window.mapManager.clearDestination();
        window.tripSimulator.pause();

        const autoMoveBtn = document.getElementById('btn-auto-move');
        if (autoMoveBtn) autoMoveBtn.innerHTML = '<i class="fas fa-play"></i> Auto-Move Towards Dest';

        // If trip is currently active, stop it
        if (this.state === 'ACTIVE') {
            this.stopTrip('Destination removed during active trip');
        }

        this.log('🗑️ Destination removed. Click anywhere on map or search to choose a stop.');
    }

    /**
     * Map Floating Search Bar Controller
     */
    setupMapSearch() {
        const searchWrap = document.getElementById('map-floating-search-wrap');
        const searchInput = document.getElementById('map-dest-search-input');
        const clearBtn = document.getElementById('btn-clear-map-search');
        const submitBtn = document.getElementById('btn-map-search-submit');
        const dropdown = document.getElementById('map-search-dropdown');

        if (!searchInput || !dropdown) return;

        // Stop clicks and scroll inside the search bar from propagating to Leaflet map canvas
        if (searchWrap && window.L && L.DomEvent) {
            L.DomEvent.disableClickPropagation(searchWrap);
            L.DomEvent.disableScrollPropagation(searchWrap);
        }

        let debounceTimer = null;
        let lastPlaces = [];

        const executeSearch = async () => {
            const query = searchInput.value.trim();
            if (query.length < 2) {
                dropdown.classList.add('hidden');
                return;
            }

            dropdown.innerHTML = `
                <div class="map-search-loading">
                    <i class="fas fa-spinner fa-spin" style="color: var(--accent-primary);"></i>
                    <span>Finding destination on map...</span>
                </div>
            `;
            dropdown.classList.remove('hidden');

            try {
                const places = await window.mapManager.searchPlace(query);
                lastPlaces = places;
                this.renderMapSearchResults(places);
            } catch (err) {
                dropdown.innerHTML = `
                    <div class="map-search-empty">
                        <i class="fas fa-circle-exclamation" style="color: var(--accent-danger);"></i>
                        <span>Search temporarily unavailable</span>
                    </div>
                `;
            }
        };

        searchInput.addEventListener('input', (e) => {
            const val = e.target.value;
            if (clearBtn) {
                if (val.length > 0) clearBtn.classList.remove('hidden');
                else clearBtn.classList.add('hidden');
            }

            clearTimeout(debounceTimer);
            if (val.trim().length < 2) {
                dropdown.classList.add('hidden');
                return;
            }
            debounceTimer = setTimeout(executeSearch, 350);
        });

        searchInput.addEventListener('keydown', async (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                clearTimeout(debounceTimer);
                if (lastPlaces.length > 0 && !dropdown.classList.contains('hidden')) {
                    this.selectMapSearchResult(lastPlaces[0]);
                } else {
                    await executeSearch();
                    if (lastPlaces.length > 0) {
                        this.selectMapSearchResult(lastPlaces[0]);
                    }
                }
            } else if (e.key === 'Escape') {
                dropdown.classList.add('hidden');
            }
        });

        if (submitBtn) {
            submitBtn.addEventListener('click', (e) => {
                e.preventDefault();
                executeSearch();
            });
        }

        if (clearBtn) {
            clearBtn.addEventListener('click', (e) => {
                e.preventDefault();
                searchInput.value = '';
                clearBtn.classList.add('hidden');
                dropdown.classList.add('hidden');
                searchInput.focus();
            });
        }

        // Close dropdown when clicking outside
        document.addEventListener('click', (e) => {
            if (searchWrap && !searchWrap.contains(e.target)) {
                dropdown.classList.add('hidden');
            }
        });
    }

    renderMapSearchResults(places) {
        const dropdown = document.getElementById('map-search-dropdown');
        if (!dropdown) return;

        if (!places || places.length === 0) {
            dropdown.innerHTML = `
                <div class="map-search-empty">
                    <i class="fas fa-map-pin" style="color: var(--text-muted);"></i>
                    <span>No destinations found. Try station name, city, or landmark.</span>
                </div>
            `;
            dropdown.classList.remove('hidden');
            return;
        }

        dropdown.innerHTML = places.map((place, idx) => `
            <div class="map-search-item" data-index="${idx}">
                <div class="map-search-item-icon">
                    <i class="fas fa-location-dot"></i>
                </div>
                <div class="map-search-item-info">
                    <div class="map-search-item-title">${place.name}</div>
                    <div class="map-search-item-sub">${place.fullName}</div>
                </div>
                <span class="map-search-item-badge">Set</span>
            </div>
        `).join('');

        dropdown.classList.remove('hidden');

        dropdown.querySelectorAll('.map-search-item').forEach((item, idx) => {
            item.addEventListener('click', (e) => {
                e.stopPropagation();
                const selected = places[idx];
                this.selectMapSearchResult(selected);
            });
        });
    }

    selectMapSearchResult(place) {
        if (!place) return;
        const dropdown = document.getElementById('map-search-dropdown');
        const mapSearchInput = document.getElementById('map-dest-search-input');
        const clearBtn = document.getElementById('btn-clear-map-search');
        const panelSearchInput = document.getElementById('dest-search-input');

        if (dropdown) dropdown.classList.add('hidden');
        if (mapSearchInput) mapSearchInput.value = place.name;
        if (clearBtn) clearBtn.classList.remove('hidden');
        if (panelSearchInput) panelSearchInput.value = place.name;

        // Set destination
        this.setDestination(place.name, place.fullName, place.lat, place.lon);

        // Smooth cinematic pan to destination on map
        if (window.mapManager) {
            window.mapManager.centerOnDestination(15);
        }
    }

    setAlertRadius(radiusMeters) {
        this.currentTrip.alertRadius = radiusMeters;
        const radiusDisplay = document.getElementById('active-radius-display');
        if (radiusDisplay) {
            radiusDisplay.innerText = radiusMeters >= 1000 ? `${(radiusMeters/1000).toFixed(1)} km` : `${radiusMeters} m`;
        }

        if (this.currentTrip.destLat && this.currentTrip.destLon) {
            window.mapManager.updateGeofenceRadius(this.currentTrip.destLat, this.currentTrip.destLon, radiusMeters);
        }
        this.log(`Alert radius configured to ${radiusMeters} meters.`);
    }

    loadJourneyPreset(presetKey) {
        const presets = {
            'ran-tat': {
                origin: { name: 'Tatanagar Junction', lat: 22.7699, lon: 86.2029 },
                dest: { name: 'Ranchi Railway Station (RNC)', fullName: 'Ranchi Junction Railway Station, Gosaintola, Ranchi, Jharkhand', lat: 23.3518, lon: 85.3378 }
            },
            'ran-pat': {
                origin: { name: 'Patna Junction', lat: 25.6027, lon: 85.1376 },
                dest: { name: 'Ranchi Railway Station (RNC)', fullName: 'Ranchi Junction Railway Station, Gosaintola, Ranchi, Jharkhand', lat: 23.3518, lon: 85.3378 }
            },
            'ran-dhn': {
                origin: { name: 'Dhanbad Junction', lat: 23.7957, lon: 86.4304 },
                dest: { name: 'Ranchi Railway Station (RNC)', fullName: 'Ranchi Junction Railway Station, Gosaintola, Ranchi, Jharkhand', lat: 23.3518, lon: 85.3378 }
            },
            'ran-kol': {
                origin: { name: 'Howrah Junction (Kolkata)', lat: 22.5830, lon: 88.3426 },
                dest: { name: 'Ranchi Railway Station (RNC)', fullName: 'Ranchi Junction Railway Station, Gosaintola, Ranchi, Jharkhand', lat: 23.3518, lon: 85.3378 }
            },
            'blr-chn': {
                origin: { name: 'Chennai Central Station', lat: 13.0827, lon: 80.2707 },
                dest: { name: 'KSR Bengaluru Railway Station', fullName: 'Bangalore City Railway Station, Karnataka, India', lat: 12.9776, lon: 77.5706 }
            }
        };

        const choice = presets[presetKey] || presets['ran-tat'];
        this.currentTrip.originName = choice.origin.name;
        this.currentTrip.originLat = choice.origin.lat;
        this.currentTrip.originLon = choice.origin.lon;

        this.setDestination(choice.dest.name, choice.dest.fullName, choice.dest.lat, choice.dest.lon);
        window.mapManager.updateUserLocation(choice.origin.lat, choice.origin.lon, 15, 0, false);
        window.tripSimulator.reset();
        window.mapManager.fitBoundsToTrip();
    }

    startTrip() {
        if (!this.currentTrip.destLat || !this.currentTrip.destLon) {
            this.log('⚠️ Please select a destination first before starting the trip.');
            const searchInput = document.getElementById('dest-search-input');
            if (searchInput) searchInput.focus();
            return;
        }

        this.state = 'ACTIVE';
        this.currentTrip.startedAt = new Date().toLocaleTimeString();
        window.telemetryEngine.reset();

        // Keep phone screen awake & ensure audio context is active during transit
        this.requestWakeLock();
        if (window.soundEngine) {
            window.soundEngine.unlockAudio();
            window.soundEngine.startAudioKeepalive();
        }

        // Switch to Active Trip View
        document.getElementById('setup-card-panel').classList.add('hidden');
        document.getElementById('active-trip-panel').classList.remove('hidden');

        // On mobile, auto-switch to live map tab so traveler sees tracking immediately
        this.switchMobileTab('map');
        const floatBtn = document.getElementById('btn-mobile-start-trip');
        const floatLabel = document.getElementById('mobile-float-btn-label');
        if (floatBtn) floatBtn.classList.add('is-active-trip');
        if (floatLabel) floatLabel.innerText = 'Stop Alarm';

        const activeModeBadge = document.getElementById('active-tracking-mode-badge');

        if (this.trackingMode === 'LIVE') {
            if (activeModeBadge) {
                activeModeBadge.innerHTML = '<i class="fas fa-satellite-dish"></i> REAL-TIME GPS HARDWARE TRACKING ACTIVE';
            }
            // In pure Live mode, pause simulator so ONLY real physical movement updates location
            window.tripSimulator.pause();
            window.liveTracker.startTracking();
            this.log(`🟢 Live GPS Active for "${this.currentTrip.destinationName}". Moves ONLY when your device physically moves.`);
        } else {
            if (activeModeBadge) {
                activeModeBadge.innerHTML = '<i class="fas fa-train"></i> ROUTE SIMULATION ACTIVE';
            }
            window.liveTracker.stopTracking();
            window.tripSimulator.start();
            this.log(`🟢 Journey Simulation Started for "${this.currentTrip.destinationName}".`);
        }
    }

    stopTrip(reason = 'Trip Stopped') {
        this.state = 'COMPLETED';
        this.releaseWakeLock();
        if (window.liveTracker) window.liveTracker.stopTracking();
        if (window.tripSimulator) window.tripSimulator.pause();
        if (window.soundEngine) {
            window.soundEngine.stopAll();
            window.soundEngine.stopAudioKeepalive();
        }

        document.getElementById('setup-card-panel').classList.remove('hidden');
        document.getElementById('active-trip-panel').classList.add('hidden');

        const floatBtn = document.getElementById('btn-mobile-start-trip');
        const floatLabel = document.getElementById('mobile-float-btn-label');
        if (floatBtn) floatBtn.classList.remove('is-active-trip');
        if (floatLabel) floatLabel.innerText = 'Start Alarm';

        const autoMoveBtn = document.getElementById('btn-auto-move');
        if (autoMoveBtn) autoMoveBtn.innerHTML = '<i class="fas fa-play"></i> Auto-Move Towards Dest';

        if (this.currentTrip.destinationName) {
            this.recordHistory(this.currentTrip.destinationName, `${this.currentTrip.alertRadius} m`, 'Completed');
        }
        this.log(`🛑 ${reason}. Service stopped.`);
    }

    handleLocationSample(sample) {
        const isLive = sample.isLive !== undefined ? sample.isLive : (this.trackingMode === 'LIVE');

        // Update Map Marker with live vs sim distinction
        window.mapManager.updateUserLocation(sample.lat, sample.lon, sample.accuracy, sample.bearing, isLive);

        // Update current origin coords in trip state
        this.currentTrip.originLat = sample.lat;
        this.currentTrip.originLon = sample.lon;

        // Update Live Status Quick Card in UI
        const statCoords = document.getElementById('live-stat-coords');
        const statSpeed = document.getElementById('live-stat-speed');
        const statAcc = document.getElementById('live-stat-accuracy');
        const motionBadge = document.getElementById('live-motion-badge');
        const labelEl = document.getElementById('live-gps-status-label');
        const detailsEl = document.getElementById('live-gps-details-text');

        if (statCoords) statCoords.innerText = `${sample.lat.toFixed(4)}, ${sample.lon.toFixed(4)}`;
        if (statAcc) statAcc.innerText = `±${sample.accuracy}m`;
        if (motionBadge) {
            if (sample.speedKmh > 2) {
                motionBadge.innerHTML = `<span style="color: var(--accent-emerald); font-weight: 600;"><i class="fas fa-person-walking"></i> Moving (<strong id="live-stat-speed">${sample.speedKmh} km/h</strong>)</span>`;
            } else {
                motionBadge.innerHTML = `<span style="color: var(--accent-cyan); font-weight: 600;"><i class="fas fa-location-pin"></i> Stationary (<strong id="live-stat-speed">0 km/h</strong>)</span>`;
            }
        }
        if (labelEl && this.trackingMode === 'LIVE') {
            labelEl.innerText = `🛰️ Hardware GPS Active (±${sample.accuracy}m)`;
        }
        if (detailsEl && this.trackingMode === 'LIVE') {
            detailsEl.innerText = `Live physical tracking: updates only when your device moves`;
        }

        if (sample.signalLost) {
            this.updateTelemetryUi(null, null, sample, 'GPS Signal Lost');
            return;
        }

        // If no destination is currently chosen, skip destination distance math
        if (!this.currentTrip.destLat || !this.currentTrip.destLon) {
            this.updateTelemetryUi(null, null, sample, 'No destination chosen');
            return;
        }

        // Validate reading via Telemetry Engine
        const result = window.telemetryEngine.validateReading(
            sample,
            this.currentTrip.destLat,
            this.currentTrip.destLon,
            this.currentTrip.alertRadius
        );

        const adaptive = window.telemetryEngine.getAdaptiveInterval(result.distance);

        // Update UI displays
        this.updateTelemetryUi(result, adaptive, sample, result.reason);

        // Update auto-move progress slider if sample has progress
        const slider = document.getElementById('auto-move-slider');
        if (slider && sample.progress !== undefined) {
            slider.value = Math.round(sample.progress * 100);
        }

        // Check for Alarm Trigger condition
        if (result.triggerAlarm && this.state === 'ACTIVE') {
            this.triggerAlarm(`Verified inside ${this.currentTrip.alertRadius}m radius`);
        }
    }

    updateTelemetryUi(result, adaptive, sample, statusNote) {
        // Active Trip Card Updates
        const distEl = document.getElementById('active-distance-val');
        const speedEl = document.getElementById('active-speed-val');
        const accuracyEl = document.getElementById('active-accuracy-val');
        const etaEl = document.getElementById('active-eta-val');
        const batteryTierEl = document.getElementById('active-battery-tier');
        const progressFill = document.getElementById('trip-progress-fill');

        if (result && distEl) {
            distEl.innerText = window.telemetryEngine.formatDistance(result.distance);
        }
        if (speedEl) speedEl.innerText = `${sample.speedKmh} km/h`;
        if (accuracyEl) {
            accuracyEl.innerText = `±${sample.accuracy} m`;
            accuracyEl.className = sample.accuracy <= 25 ? 'badge badge-green' : (sample.accuracy <= 70 ? 'badge badge-yellow' : 'badge badge-red');
        }
        if (result && etaEl) {
            etaEl.innerText = window.telemetryEngine.formatEta(result.distance, sample.speedKmh);
        }
        if (adaptive && batteryTierEl) {
            batteryTierEl.innerText = adaptive.label;
        }
        if (progressFill) {
            if (sample.progress !== undefined) {
                progressFill.style.width = `${Math.round(sample.progress * 100)}%`;
            } else if (result) {
                progressFill.style.width = `${Math.min(100, Math.max(5, Math.round((1 - (result.distance / 50000)) * 100)))}%`;
            }
        }

        // Update mobile floating quick card with live remaining stats
        const floatEtaEl = document.getElementById('mobile-float-eta');
        if (floatEtaEl && result && this.state === 'ACTIVE') {
            const formattedD = window.telemetryEngine.formatDistance(result.distance);
            floatEtaEl.innerText = `${formattedD} remaining • ${sample.speedKmh} km/h`;
        }

        // Telemetry Inspector Drawer Updates
        const dbgLat = document.getElementById('dbg-lat');
        const dbgLon = document.getElementById('dbg-lon');
        const dbgDist = document.getElementById('dbg-dist');
        const dbgAccuracy = document.getElementById('dbg-accuracy');
        const dbgHits = document.getElementById('dbg-consecutive-hits');
        const dbgRejections = document.getElementById('dbg-jump-rejections');
        const dbgStatus = document.getElementById('dbg-status-note');

        if (dbgLat) dbgLat.innerText = sample.lat.toFixed(6);
        if (dbgLon) dbgLon.innerText = sample.lon.toFixed(6);
        if (result && dbgDist) dbgDist.innerText = `${result.distance} m`;
        if (dbgAccuracy) dbgAccuracy.innerText = `±${sample.accuracy} m`;
        if (result && dbgHits) dbgHits.innerText = `${result.consecutiveHits} / ${result.requiredHits}`;
        if (dbgRejections) dbgRejections.innerText = window.telemetryEngine.jumpRejections;
        if (dbgStatus) dbgStatus.innerText = statusNote || 'Active';

        if (sample.note && sample.note.includes('🚨')) {
            this.log(sample.note);
        }
    }

    triggerAlarm(reason) {
        this.state = 'TRIGGERED';
        if (window.liveTracker) window.liveTracker.stopTracking();
        if (window.tripSimulator) window.tripSimulator.pause();

        // Update Alarm Overlay UI
        const overlay = document.getElementById('fullscreen-alarm-overlay');
        const destNameEl = document.getElementById('alarm-dest-name');
        const distEl = document.getElementById('alarm-dest-distance');

        if (destNameEl) destNameEl.innerText = this.currentTrip.destinationName;
        if (distEl) distEl.innerText = `Within ${this.currentTrip.alertRadius} meters`;

        if (overlay) overlay.classList.remove('hidden');

        // Play Selected Synthesized Sound
        window.soundEngine.playSound(this.currentTrip.alarmSound, true);

        this.log(`🚨🚨 ALARM TRIGGERED! (${reason}). High priority wake alarm ringing!`);
    }

    dismissAlarm() {
        window.soundEngine.stopAll();
        const overlay = document.getElementById('fullscreen-alarm-overlay');
        if (overlay) overlay.classList.add('hidden');

        this.stopTrip('Alarm Dismissed & Trip Completed');
    }

    snoozeAlarm() {
        window.soundEngine.stopAll();
        const overlay = document.getElementById('fullscreen-alarm-overlay');
        if (overlay) overlay.classList.add('hidden');

        this.log('⏰ Alarm snoozed for 2 minutes. Re-alerting soon...');
        setTimeout(() => {
            if (this.state !== 'COMPLETED') {
                this.triggerAlarm('Snooze interval elapsed');
            }
        }, 15000);
    }

    recordHistory(destination, radius, status) {
        // Privacy Rule: Never record trips for Guest sessions
        if (window.authManager && window.authManager.isGuest()) {
            this.log('🔒 Guest Mode: Trip completed. Trip history is not saved.');
            return;
        }

        const item = {
            id: 'hist-' + Date.now(),
            dest: destination,
            date: new Date().toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' }),
            radius: radius,
            status: status,
            sound: this.currentTrip.alarmSound,
            destLat: this.currentTrip.destLat,
            destLon: this.currentTrip.destLon
        };
        this.tripHistory.unshift(item);
        if (this.tripHistory.length > 15) this.tripHistory.pop();
        this.saveStorage();
        this.renderTripHistory();

        // Sync to SQLite Database
        if (window.authManager) {
            window.authManager.saveTripToDatabase({
                destinationName: destination,
                destinationFullName: this.currentTrip.destinationFullName,
                destLat: this.currentTrip.destLat,
                destLon: this.currentTrip.destLon,
                originName: this.currentTrip.originName,
                originLat: this.currentTrip.originLat,
                originLon: this.currentTrip.originLon,
                alertRadius: this.currentTrip.alertRadius,
                alarmSound: this.currentTrip.alarmSound
            });
        }
    }

    renderSavedPlaces() {
        const container = document.getElementById('saved-places-list');
        if (!container) return;

        container.innerHTML = this.savedPlaces.map(place => `
            <div class="saved-place-chip" data-id="${place.id}">
                <div class="icon-circle"><i class="fas ${place.icon}"></i></div>
                <div class="chip-text">
                    <div class="chip-name">${place.name}</div>
                    <div class="chip-desc">${place.desc}</div>
                </div>
            </div>
        `).join('');

        container.querySelectorAll('.saved-place-chip').forEach(chip => {
            chip.addEventListener('click', () => {
                const place = this.savedPlaces.find(p => p.id === chip.dataset.id);
                if (place) {
                    this.setDestination(place.name, place.desc, place.lat, place.lon);
                }
            });
        });
    }

    renderTripHistory() {
        const container = document.getElementById('trip-history-list');
        const guestBanner = document.getElementById('guest-history-banner');
        if (!container) return;

        if (window.authManager && window.authManager.isGuest()) {
            if (guestBanner) guestBanner.classList.remove('hidden');
            container.innerHTML = `
                <div class="guest-history-empty">
                    <i class="fas fa-shield-halved"></i>
                    <div style="font-weight: 700; color: #FFF; margin-bottom: 4px;">Trip History Disabled</div>
                    <div style="font-size: 0.78rem; color: var(--text-muted); line-height: 1.4;">
                        You are browsing in <strong>Guest Mode</strong>. Your destination logs and trip records are completely private and never saved to storage or database.
                    </div>
                </div>
            `;
            return;
        }

        if (guestBanner) guestBanner.classList.add('hidden');

        if (!this.tripHistory || this.tripHistory.length === 0) {
            container.innerHTML = `<div style="font-size: 0.8rem; color: var(--text-muted); text-align: center; padding: 20px 0;">No previous trips recorded yet.</div>`;
            return;
        }

        container.innerHTML = this.tripHistory.map((item, idx) => `
            <div class="history-item" data-index="${idx}">
                <div>
                    <div style="color: #FFF; font-weight: 700; font-size: 0.86rem;"><i class="fas fa-location-dot" style="color: var(--accent-cyan); margin-right: 4px;"></i> ${item.dest}</div>
                    <div style="font-size: 0.72rem; color: var(--text-muted); margin-top: 2px;">${item.date} • ${item.radius} alert • ${item.sound || 'Loud Alarm'}</div>
                </div>
                <span class="badge badge-green" style="font-size: 0.65rem;">${item.status}</span>
            </div>
        `).join('');

        container.querySelectorAll('.history-item').forEach((el, idx) => {
            el.addEventListener('click', () => {
                const item = this.tripHistory[idx];
                if (item) {
                    this.setDestination(item.dest, item.dest, item.destLat || 23.3518, item.destLon || 85.3378);
                }
                const historyModal = document.getElementById('history-modal');
                if (historyModal) historyModal.classList.add('hidden');
                this.log(`📜 Loaded destination from history: ${item.dest}`);
            });
        });
    }

    log(msg) {
        const time = new Date().toLocaleTimeString();
        const entry = `[${time}] ${msg}`;
        this.logEntries.unshift(entry);
        if (this.logEntries.length > 25) this.logEntries.pop();

        const logContainer = document.getElementById('telemetry-terminal-output');
        if (logContainer) {
            logContainer.innerHTML = this.logEntries.map(e => `<div class="log-line">${e}</div>`).join('');
        }
    }
}

// Global initialization
window.addEventListener('DOMContentLoaded', () => {
    window.app = new GeoWakeApp();
    window.app.init();
});
