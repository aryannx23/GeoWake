/**
 * GeoWake — Cyber Security Theme Manager
 * Controls Cyber Dark (Stealth HUD) and Cyber Light (Tactical Lab) themes.
 * Persists user preference and dynamically synchronizes Leaflet map tiles.
 */

class ThemeManager {
    constructor() {
        this.STORAGE_KEY = 'geowake_theme_v1';
        this.currentTheme = this.loadSavedTheme();
        this.init();
    }

    init() {
        this.applyTheme(this.currentTheme, false);
        this.bindEvents();
    }

    loadSavedTheme() {
        try {
            const saved = localStorage.getItem(this.STORAGE_KEY);
            if (saved === 'light' || saved === 'dark') {
                return saved;
            }
        } catch (e) {}
        // Default to transit orange light theme
        return 'light';
    }

    toggleTheme() {
        const nextTheme = this.currentTheme === 'dark' ? 'light' : 'dark';
        this.applyTheme(nextTheme, true);
    }

    applyTheme(theme, save = true) {
        this.currentTheme = theme;
        document.documentElement.setAttribute('data-theme', theme);
        
        // Update browser chrome theme-color
        const metaTheme = document.querySelector('meta[name="theme-color"]');
        if (metaTheme) {
            metaTheme.setAttribute('content', theme === 'dark' ? '#050811' : '#F1F5F9');
        }

        if (save) {
            try {
                localStorage.setItem(this.STORAGE_KEY, theme);
            } catch (e) {}
        }

        // Update Theme Toggle Buttons UI
        this.updateButtonsUi(theme);

        // Update Map tiles if map initialized
        if (window.geoMap && typeof window.geoMap.setTheme === 'function') {
            window.geoMap.setTheme(theme);
        }
    }

    updateButtonsUi(theme) {
        const isDark = theme === 'dark';
        
        document.querySelectorAll('.btn-theme-toggle').forEach(btn => {
            const iconDark = btn.querySelector('.theme-icon-dark');
            const iconLight = btn.querySelector('.theme-icon-light');
            const label = btn.querySelector('.theme-text');

            if (iconDark && iconLight) {
                if (isDark) {
                    iconDark.classList.remove('hidden');
                    iconLight.classList.add('hidden');
                } else {
                    iconDark.classList.add('hidden');
                    iconLight.classList.remove('hidden');
                }
            }

            if (label) {
                label.innerText = isDark ? 'DARK' : 'LIGHT';
            }
        });
    }

    bindEvents() {
        document.addEventListener('click', (e) => {
            const btn = e.target.closest('.btn-theme-toggle');
            if (btn) {
                e.preventDefault();
                this.toggleTheme();
            }
        });
    }
}

// Global Theme Manager instance
window.themeManager = new ThemeManager();
