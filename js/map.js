/**
 * GeoWake - Advanced Leaflet.js Map Implementation & Geocoding Service
 * Features: Free Multi-tile layers (Streets, Satellite), Draggable Markers, Dynamic Geofencing, 
 * Animated Route Polylines, Smooth FlyTo Camera Controls, Metric Scales & Reverse Geocoding.
 */

class MapManager {
    constructor() {
        this.map = null;
        this.currentTileLayer = null;
        this.tileLayerName = 'satellite'; // 'satellite' | 'streets'
        this.tileLayers = {};

        this.userMarker = null;
        this.destMarker = null;
        this.geofenceCircle = null;
        this.routeLine = null;
        this.accuracyCircle = null;
        this.followUser = false; // Auto-pan camera when user location moves

        this.onDestinationSelectedCallback = null;
        this.onUserLocationDragCallback = null;
    }

    /**
     * Initialize Leaflet Map Instance
     */
    init(containerId = 'interactive-map', initialLat = 23.3518, initialLon = 85.3378) {
        if (this.map) return;

        // Create Leaflet map with all zoom interactions fully enabled
        this.map = L.map(containerId, {
            center: [initialLat, initialLon],
            zoom: 13,
            minZoom: 3,
            maxZoom: 19,
            zoomControl: false,
            attributionControl: true,
            scrollWheelZoom: true,
            doubleClickZoom: true,
            touchZoom: true,
            boxZoom: true,
            keyboard: true
        });

        // 1. Define Free Leaflet Tile Layers (No API Key Required)
        // High-resolution Esri World Imagery + reference places and boundaries overlay
        this.tileLayers = {
            satellite: L.layerGroup([
                L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
                    maxZoom: 19,
                    attribution: '&copy; <a href="https://www.esri.com/">Esri</a> &mdash; Satellite Imagery'
                }),
                L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', {
                    maxZoom: 19,
                    attribution: ''
                })
            ]),
            streets: L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                maxZoom: 19,
                attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            })
        };

        // Always default to Satellite layer
        this.tileLayerName = 'satellite';
        this.currentTileLayer = this.tileLayers.satellite;
        this.currentTileLayer.addTo(this.map);

        // 2. Add Standard Leaflet Zoom Control to bottom-right
        L.control.zoom({ position: 'bottomright' }).addTo(this.map);

        // 3. Add Metric Scale Control to bottom-left
        L.control.scale({
            position: 'bottomleft',
            metric: true,
            imperial: false
        }).addTo(this.map);

        // 4. Map Click Handler (Selects Destination)
        this.map.on('click', (e) => {
            const { lat, lng } = e.latlng;
            this.reverseGeocode(lat, lng);
        });

        // Ensure Leaflet renders tiles accurately when container resizes
        setTimeout(() => {
            if (this.map) this.map.invalidateSize();
        }, 250);
    }

    /**
     * Synchronize Map Theme Styles (Route Polyline glow, etc.)
     */
    setTheme(themeName) {
        if (!this.map) return;

        // Re-render route polyline with theme-specific glow if active
        if (this.routePolyline) {
            const pathColor = themeName === 'light' ? '#0284C7' : '#00F0FF';
            this.routePolyline.setStyle({ color: pathColor });
        }
    }

    /**
     * Switch Tile Layer (Streets / Satellite)
     */
    setTileLayer(layerName) {
        if (!this.map || !this.tileLayers[layerName]) return;
        if (this.currentTileLayer) {
            this.map.removeLayer(this.currentTileLayer);
        }
        this.tileLayerName = layerName;
        this.currentTileLayer = this.tileLayers[layerName];
        this.currentTileLayer.addTo(this.map);
    }

    toggleTileLayer() {
        const order = ['satellite', 'streets'];
        const nextIdx = (order.indexOf(this.tileLayerName) + 1) % order.length;
        this.setTileLayer(order[nextIdx]);
        return order[nextIdx];
    }

    /**
     * Set or Update Destination Pin on Leaflet Map
     */
    setDestination(lat, lon, name = 'Selected Destination', radiusMeters = 500) {
        if (!this.map) return;

        const destIcon = L.divIcon({
            className: 'custom-dest-pin',
            html: `
                <div class="pin-pulse"></div>
                <div class="pin-marker" title="Destination: ${name}"><i class="fas fa-location-dot"></i></div>
            `,
            iconSize: [42, 42],
            iconAnchor: [21, 42],
            popupAnchor: [0, -38]
        });

        const popupContent = `
            <div class="leaflet-custom-popup">
                <div class="popup-title">🎯 ${name}</div>
                <div class="popup-subtitle">Alert Radius: <strong>${radiusMeters >= 1000 ? (radiusMeters/1000).toFixed(1)+' km' : radiusMeters+'m'}</strong></div>
                <div class="popup-hint">Drag pin to reposition on map</div>
                <div class="popup-actions-row" style="margin-top: 8px;">
                    <button class="popup-action-btn danger" onclick="window.app.removeDestination()" title="Remove this marked destination">
                        <i class="fas fa-trash-can"></i> Remove Destination
                    </button>
                </div>
            </div>
        `;

        if (this.destMarker) {
            this.destMarker.setLatLng([lat, lon]);
            this.destMarker.bindPopup(popupContent);
        } else {
            this.destMarker = L.marker([lat, lon], {
                icon: destIcon,
                draggable: true
            }).addTo(this.map);

            this.destMarker.bindPopup(popupContent);

            this.destMarker.on('drag', (e) => {
                const { lat: dLat, lng: dLng } = e.latlng;
                if (this.geofenceCircle) this.geofenceCircle.setLatLng([dLat, dLng]);
                this._updateRouteLine();
            });

            this.destMarker.on('dragend', (e) => {
                const { lat: dLat, lng: dLng } = e.latlng;
                if (this.geofenceCircle) this.geofenceCircle.setLatLng([dLat, dLng]);
                this._updateRouteLine();
                this.reverseGeocode(dLat, dLng);
            });
        }

        // Draw Geofence Radius Circle
        this.updateGeofenceRadius(lat, lon, radiusMeters);
        this._updateRouteLine();
    }

    /**
     * Update Geofence Alert Radius Circle
     */
    updateGeofenceRadius(lat, lon, radiusMeters) {
        if (!this.map) return;

        if (this.geofenceCircle) {
            this.geofenceCircle.setLatLng([lat, lon]);
            this.geofenceCircle.setRadius(radiusMeters);
        } else {
            this.geofenceCircle = L.circle([lat, lon], {
                radius: radiusMeters,
                color: '#FF6B35',
                fillColor: '#FF6B35',
                fillOpacity: 0.15,
                weight: 2,
                dashArray: '6, 6'
            }).addTo(this.map);
        }
    }

    /**
     * Clear Destination Pin, Geofence Circle & Route Line
     */
    clearDestination() {
        if (!this.map) return;
        if (this.destMarker) {
            this.map.removeLayer(this.destMarker);
            this.destMarker = null;
        }
        if (this.geofenceCircle) {
            this.map.removeLayer(this.geofenceCircle);
            this.geofenceCircle = null;
        }
        if (this.routeLine) {
            this.map.removeLayer(this.routeLine);
            this.routeLine = null;
        }
    }

    /**
     * Update User Location Marker (Live GPS or Simulated)
     */
    updateUserLocation(lat, lon, accuracy = 15, bearing = 0, isLive = true) {
        if (!this.map) return;

        const arrowSvg = `
            <svg class="live-nav-arrow-svg" viewBox="0 0 100 100" width="100%" height="100%" aria-hidden="true" style="display:none;">
                <g>
                    <polygon points="50,4 4,96 50,58" fill="#2ECC71" />
                    <polygon points="50,4 50,58 96,96" fill="#0F7644" />
                    <polygon points="4,96 50,78 50,58" fill="#1EAD5D" />
                    <polygon points="50,58 50,78 96,96" fill="#0A522E" />
                    <line x1="50" y1="4" x2="50" y2="58" stroke="rgba(255, 255, 255, 0.35)" stroke-width="0.8" />
                </g>
            </svg>
        `;

        const iconHtml = isLive ? `
            <div class="live-user-pulse"></div>
            <div class="live-user-dot live-nav-arrow-container" style="transform: rotate(${bearing}deg)" title="Live Location">
                <img src="assets/live-location-arrow.png" class="live-nav-arrow-img" alt="Live Location" onerror="this.style.display='none'; if(this.nextElementSibling) this.nextElementSibling.style.display='block';">
                ${arrowSvg}
            </div>
        ` : `
            <div class="user-pulse"></div>
            <div class="user-dot user-nav-arrow-container" style="transform: rotate(${bearing}deg)" title="Simulated Location">
                <img src="assets/live-location-arrow.png" class="live-nav-arrow-img" alt="Simulated Location" onerror="this.style.display='none'; if(this.nextElementSibling) this.nextElementSibling.style.display='block';">
                ${arrowSvg}
            </div>
        `;

        const userIcon = L.divIcon({
            className: isLive ? 'custom-live-marker' : 'custom-user-marker',
            html: iconHtml,
            iconSize: [42, 42],
            iconAnchor: [21, 21]
        });

        const userPopupContent = `
            <div class="leaflet-custom-popup">
                <div class="popup-title">${isLive ? '🛰️ My Live Location' : '🚆 Simulated Location'}</div>
                <div class="popup-subtitle">${lat.toFixed(5)}, ${lon.toFixed(5)}</div>
                <div class="popup-hint">Drag arrow anywhere on map to test distance and alarm trigger</div>
                <div class="popup-actions-row" style="margin-top: 8px;">
                    <button class="popup-action-btn" onclick="window.app.locateUser(true)" title="Reset to device GPS coordinates">
                        <i class="fas fa-crosshairs"></i> Reset to Live GPS
                    </button>
                </div>
            </div>
        `;

        if (this.userMarker) {
            this.userMarker.setLatLng([lat, lon]);
            this.userMarker.setIcon(userIcon);
            this.userMarker.bindPopup(userPopupContent);
        } else {
            this.userMarker = L.marker([lat, lon], {
                icon: userIcon,
                draggable: true
            }).addTo(this.map);

            this.userMarker.bindPopup(userPopupContent);

            this.userMarker.bindTooltip("📍 Drag me anywhere to test location updates!", {
                direction: 'top',
                offset: [0, -18],
                className: 'marker-drag-tooltip'
            });

            this.userMarker.on('drag', (e) => {
                const { lat: uLat, lng: uLng } = e.latlng;
                if (this.accuracyCircle) this.accuracyCircle.setLatLng([uLat, uLng]);
                this._updateRouteLine();
                if (this.onUserLocationDragCallback) {
                    this.onUserLocationDragCallback(uLat, uLng, false);
                }
            });

            this.userMarker.on('dragend', (e) => {
                const { lat: uLat, lng: uLng } = e.latlng;
                if (this.accuracyCircle) this.accuracyCircle.setLatLng([uLat, uLng]);
                this._updateRouteLine();
                if (this.onUserLocationDragCallback) {
                    this.onUserLocationDragCallback(uLat, uLng, true);
                }
            });
        }

        // Accuracy Halo
        const haloColor = isLive ? '#00F0FF' : '#10B981';
        if (this.accuracyCircle) {
            this.accuracyCircle.setLatLng([lat, lon]);
            this.accuracyCircle.setRadius(Math.max(5, accuracy));
            this.accuracyCircle.setStyle({ color: haloColor, fillColor: haloColor });
        } else {
            this.accuracyCircle = L.circle([lat, lon], {
                radius: Math.max(5, accuracy),
                color: haloColor,
                fillColor: haloColor,
                fillOpacity: 0.12,
                weight: 1.5
            }).addTo(this.map);
        }

        this._updateRouteLine();

        // Smooth Auto-Pan if followUser camera is active
        if (this.followUser) {
            this.map.panTo([lat, lon], { animate: true, duration: 0.4 });
        }
    }

    /**
     * Draw or Update Route Polyline between User and Destination
     */
    _updateRouteLine() {
        if (!this.map || !this.userMarker || !this.destMarker) {
            if (this.routeLine) {
                this.map.removeLayer(this.routeLine);
                this.routeLine = null;
            }
            return;
        }
        const userLatLng = this.userMarker.getLatLng();
        const destLatLng = this.destMarker.getLatLng();

        // Fetch and draw real road/transit route asynchronously
        this.fetchSuitableRoute(userLatLng.lat, userLatLng.lng, destLatLng.lat, destLatLng.lng);
    }

    /**
     * Fetch Suitable Transit / Driving Route Geometry & Travel Time via OSRM
     */
    async fetchSuitableRoute(originLat, originLon, destLat, destLon) {
        if (!this.map) return null;

        try {
            const url = `https://router.project-osrm.org/route/v1/driving/${originLon},${originLat};${destLon},${destLat}?overview=full&geometries=geojson`;
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 4000);

            const res = await fetch(url, { signal: controller.signal });
            clearTimeout(timeoutId);

            if (res.ok) {
                const data = await res.json();
                if (data.code === 'Ok' && data.routes && data.routes.length > 0) {
                    const route = data.routes[0];
                    const coords = route.geometry.coordinates; // [lon, lat]
                    const pathLatLngs = coords.map(c => [c[1], c[0]]);

                    this.currentPathCoordinates = pathLatLngs;
                    this.currentRouteData = {
                        distanceMeters: route.distance,
                        durationSeconds: route.duration,
                        pathCoords: pathLatLngs
                    };

                    this._drawPathPolyline(pathLatLngs);
                    return this.currentRouteData;
                }
            }
        } catch (err) {
            // Non-fatal, fallback to straight line
        }

        // Fallback: direct line
        const fallbackCoords = [
            [originLat, originLon],
            [destLat, destLon]
        ];
        this.currentPathCoordinates = fallbackCoords;
        const straightDist = window.telemetryEngine.calculateDistance(originLat, originLon, destLat, destLon);
        this.currentRouteData = {
            distanceMeters: straightDist,
            durationSeconds: (straightDist / (50 * 1000)) * 3600,
            pathCoords: fallbackCoords
        };

        this._drawPathPolyline(fallbackCoords, true);
        return this.currentRouteData;
    }

    _drawPathPolyline(pathCoords, isDashed = false) {
        if (!this.map) return;

        const routeColor = '#FF6B35';
        if (this.routeLine) {
            this.routeLine.setLatLngs(pathCoords);
            this.routeLine.setStyle({
                color: routeColor,
                weight: 5,
                opacity: 0.95,
                dashArray: isDashed ? '8, 8' : null
            });
        } else {
            this.routeLine = L.polyline(pathCoords, {
                color: routeColor,
                weight: 5,
                opacity: 0.95,
                lineCap: 'round',
                lineJoin: 'round',
                dashArray: isDashed ? '8, 8' : null
            }).addTo(this.map);
        }
    }

    /**
     * Camera Pan & Zoom Helpers
     */
    zoomIn() {
        if (!this.map) return;
        this.map.zoomIn();
    }

    zoomOut() {
        if (!this.map) return;
        this.map.zoomOut();
    }

    setZoom(level) {
        if (!this.map) return;
        this.map.setZoom(level);
    }

    toggleFollowUser() {
        this.followUser = !this.followUser;
        if (this.followUser && this.userMarker) {
            this.centerOnUser(15);
        }
        return this.followUser;
    }

    centerOnUser(zoom = 15) {
        if (!this.map || !this.userMarker) return;
        const latLng = this.userMarker.getLatLng();
        this.map.flyTo(latLng, zoom, { duration: 1 });
    }

    centerOnDestination(zoom = 15) {
        if (!this.map || !this.destMarker) return;
        const latLng = this.destMarker.getLatLng();
        this.map.flyTo(latLng, zoom, { duration: 1 });
    }

    fitBoundsToTrip() {
        if (!this.map) return;
        const group = [];
        if (this.userMarker) group.push(this.userMarker.getLatLng());
        if (this.destMarker) group.push(this.destMarker.getLatLng());

        if (group.length > 0) {
            const bounds = L.latLngBounds(group);
            this.map.fitBounds(bounds, { padding: [60, 60], maxZoom: 15 });
        }
    }

    /**
     * OpenStreetMap Nominatim Geocoding
     */
    async searchPlace(query) {
        if (!query || query.trim().length < 2) return [];
        try {
            const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=6&addressdetails=1`;
            const resp = await fetch(url, { headers: { 'Accept-Language': 'en' } });
            if (!resp.ok) return [];
            const data = await resp.json();
            return data.map(item => ({
                name: item.display_name.split(',')[0],
                fullName: item.display_name,
                lat: parseFloat(item.lat),
                lon: parseFloat(item.lon),
                type: item.type || item.class
            }));
        } catch (e) {
            console.warn('Geocoding search failed, falling back', e);
            return [];
        }
    }

    async reverseGeocode(lat, lon) {
        try {
            const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}`;
            const resp = await fetch(url);
            const data = await resp.json();
            const placeName = data.display_name ? data.display_name.split(',')[0] : `Pin (${lat.toFixed(4)}, ${lon.toFixed(4)})`;
            
            if (this.onDestinationSelectedCallback) {
                this.onDestinationSelectedCallback({
                    name: placeName,
                    fullName: data.display_name || placeName,
                    lat: lat,
                    lon: lon
                });
            }
        } catch (e) {
            if (this.onDestinationSelectedCallback) {
                this.onDestinationSelectedCallback({
                    name: `Pin (${lat.toFixed(4)}, ${lon.toFixed(4)})`,
                    fullName: `Latitude: ${lat.toFixed(6)}, Longitude: ${lon.toFixed(6)}`,
                    lat: lat,
                    lon: lon
                });
            }
        }
    }

    onSelectDestination(cb) {
        this.onDestinationSelectedCallback = cb;
    }

    onUserDrag(cb) {
        this.onUserLocationDragCallback = cb;
    }
}

window.mapManager = new MapManager();
