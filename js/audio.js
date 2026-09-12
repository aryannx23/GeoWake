/**
 * GeoWake - Web Audio API Sound Synthesizer & Haptics Engine
 * Provides rich alarm sounds purely via browser Web Audio API (zero external assets needed)
 */

class SoundEngine {
    constructor() {
        this.ctx = null;
        this.currentAlarmNode = null;
        this.isPlaying = false;
        this.volume = 0.9;
        this.activeIntervals = [];
        this.isUnlocked = false;
        this.keepaliveInterval = null;
        this.silentAudio = null;
    }

    init() {
        if (!this.ctx) {
            const AudioContext = window.AudioContext || window.webkitAudioContext;
            if (AudioContext) {
                this.ctx = new AudioContext();
            }
        }
        if (this.ctx && this.ctx.state === 'suspended') {
            this.ctx.resume().catch(() => {});
        }
    }

    unlockAudio() {
        this.init();
        if (this.ctx) {
            if (this.ctx.state === 'suspended') {
                this.ctx.resume().catch(() => {});
            }
            try {
                // Play 1 silent frame to unlock hardware audio output on mobile Safari & Chrome
                const buffer = this.ctx.createBuffer(1, 1, 22050);
                const source = this.ctx.createBufferSource();
                source.buffer = buffer;
                source.connect(this.ctx.destination);
                source.start(0);
                this.isUnlocked = true;
            } catch (e) {}
        }
    }

    /**
     * Mobile Background Audio & MediaSession Keepalive
     * Plays a continuous silent loop to keep mobile OS from killing GPS watchPosition & JS execution
     */
    startBackgroundAudio(tripData) {
        this.unlockAudio();

        if (!this.silentAudio) {
            try {
                // Standard 1-second silent WAV base64 loop
                this.silentAudio = new Audio('data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA');
                this.silentAudio.loop = true;
                this.silentAudio.volume = 0.01;
            } catch (e) {
                console.warn('Could not initialize silent audio element', e);
            }
        }

        if (this.silentAudio) {
            this.silentAudio.play().catch(() => {
                // Autoplay policy fallback: audio context will resume on user touch
            });
        }

        this.updateMediaSession(tripData);
        this.startAudioKeepalive();
    }

    updateMediaSession(tripData) {
        if (!('mediaSession' in navigator)) return;

        const destName = tripData?.destName || tripData?.destinationName || 'Destination';
        const distStr = tripData?.distanceText || (tripData?.distanceMeters ? `${tripData.distanceMeters}m` : 'Active Transit');
        const speedStr = tripData?.speedText || (tripData?.speedKmh ? `${tripData.speedKmh} km/h` : 'In Transit');

        try {
            navigator.mediaSession.metadata = new MediaMetadata({
                title: `GeoWake: ${distStr} to ${destName}`,
                artist: `Speed: ${speedStr} • Background GPS Active`,
                album: 'GeoWake Location Alarm',
                artwork: [
                    { src: 'assets/live-location-arrow.png', sizes: '192x192', type: 'image/png' },
                    { src: 'assets/live-location-arrow.png', sizes: '512x512', type: 'image/png' }
                ]
            });

            navigator.mediaSession.playbackState = 'playing';

            navigator.mediaSession.setActionHandler('stop', () => {
                if (window.app) window.app.stopTrip();
            });
            navigator.mediaSession.setActionHandler('pause', () => {
                if (window.app) window.app.stopTrip();
            });
            navigator.mediaSession.setActionHandler('play', () => {
                if (this.silentAudio) this.silentAudio.play().catch(() => {});
            });
        } catch (e) {}
    }

    stopBackgroundAudio() {
        this.stopAudioKeepalive();

        if (this.silentAudio) {
            try {
                this.silentAudio.pause();
                this.silentAudio.currentTime = 0;
            } catch (e) {}
        }

        if ('mediaSession' in navigator) {
            try {
                navigator.mediaSession.playbackState = 'none';
            } catch (e) {}
        }
    }

    startAudioKeepalive() {
        this.stopAudioKeepalive();
        this.keepaliveInterval = setInterval(() => {
            if (this.ctx && this.ctx.state === 'running' && !this.isPlaying) {
                try {
                    const osc = this.ctx.createOscillator();
                    const gain = this.ctx.createGain();
                    gain.gain.value = 0.0001;
                    osc.connect(gain);
                    gain.connect(this.ctx.destination);
                    osc.start();
                    osc.stop(this.ctx.currentTime + 0.1);
                } catch (e) {}
            }
        }, 15000);
    }

    stopAudioKeepalive() {
        if (this.keepaliveInterval) {
            clearInterval(this.keepaliveInterval);
            this.keepaliveInterval = null;
        }
    }

    setVolume(val) {
        this.volume = Math.max(0, Math.min(1, val));
    }

    stopAlarm() {
        this.stopAll();
        this.stopBackgroundAudio();
    }

    stopAll() {
        this.isPlaying = false;
        this.activeIntervals.forEach(id => clearInterval(id));
        this.activeIntervals = [];
        
        if (this.currentAlarmNode) {
            try {
                this.currentAlarmNode.stop();
                this.currentAlarmNode.disconnect();
            } catch (e) {}
            this.currentAlarmNode = null;
        }

        if ('vibrate' in navigator) {
            try {
                navigator.vibrate(0);
            } catch (e) {}
        }
    }

    // 1. Loud Alarm (Piercing double-beep pattern)
    playLoudAlarm(loop = true) {
        this.init();
        this.stopAll();
        this.isPlaying = true;

        const playBeepPair = () => {
            if (!this.isPlaying) return;
            const now = this.ctx.currentTime;
            
            // Beep 1
            const osc1 = this.ctx.createOscillator();
            const gain1 = this.ctx.createGain();
            osc1.type = 'sawtooth';
            osc1.frequency.setValueAtTime(880, now); // A5
            osc1.frequency.exponentialRampToValueAtTime(1760, now + 0.18);
            gain1.gain.setValueAtTime(this.volume * 0.8, now);
            gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
            osc1.connect(gain1);
            gain1.connect(this.ctx.destination);
            osc1.start(now);
            osc1.stop(now + 0.2);

            // Beep 2
            const osc2 = this.ctx.createOscillator();
            const gain2 = this.ctx.createGain();
            osc2.type = 'sawtooth';
            osc2.frequency.setValueAtTime(1100, now + 0.25);
            osc2.frequency.exponentialRampToValueAtTime(2200, now + 0.45);
            gain2.gain.setValueAtTime(this.volume * 0.8, now + 0.25);
            gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.47);
            osc2.connect(gain2);
            gain2.connect(this.ctx.destination);
            osc2.start(now + 0.25);
            osc2.stop(now + 0.48);

            // Haptics
            if ('vibrate' in navigator) {
                navigator.vibrate([200, 100, 200, 400]);
            }
        };

        playBeepPair();
        if (loop) {
            const intId = setInterval(playBeepPair, 900);
            this.activeIntervals.push(intId);
        }
    }

    // 2. Digital Siren (High-low rising frequency)
    playDigitalSiren(loop = true) {
        this.init();
        this.stopAll();
        this.isPlaying = true;

        const playSirenCycle = () => {
            if (!this.isPlaying) return;
            const now = this.ctx.currentTime;
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(600, now);
            osc.frequency.linearRampToValueAtTime(1400, now + 0.4);
            osc.frequency.linearRampToValueAtTime(600, now + 0.8);

            gain.gain.setValueAtTime(this.volume * 0.7, now);
            gain.gain.setValueAtTime(this.volume * 0.7, now + 0.8);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.85);

            osc.connect(gain);
            gain.connect(this.ctx.destination);
            osc.start(now);
            osc.stop(now + 0.85);

            if ('vibrate' in navigator) {
                navigator.vibrate([400, 200, 400, 200]);
            }
        };

        playSirenCycle();
        if (loop) {
            const intId = setInterval(playSirenCycle, 1000);
            this.activeIntervals.push(intId);
        }
    }

    // 3. Train Station Chime (Harmonic 3-tone railway bell)
    playTrainChime(loop = true) {
        this.init();
        this.stopAll();
        this.isPlaying = true;

        const playChime = () => {
            if (!this.isPlaying) return;
            const notes = [523.25, 659.25, 783.99, 1046.50]; // C5, E5, G5, C6
            notes.forEach((freq, idx) => {
                const now = this.ctx.currentTime + (idx * 0.22);
                const osc = this.ctx.createOscillator();
                const gain = this.ctx.createGain();

                osc.type = 'sine';
                osc.frequency.setValueAtTime(freq, now);

                gain.gain.setValueAtTime(this.volume * 0.75, now);
                gain.gain.exponentialRampToValueAtTime(0.001, now + 0.8);

                osc.connect(gain);
                gain.connect(this.ctx.destination);
                osc.start(now);
                osc.stop(now + 0.85);
            });

            if ('vibrate' in navigator) {
                navigator.vibrate([250, 150, 250, 150, 350]);
            }
        };

        playChime();
        if (loop) {
            const intId = setInterval(playChime, 1800);
            this.activeIntervals.push(intId);
        }
    }

    // 4. Radar Pulse (Deep sonar sonar-pulse + high blip)
    playRadarPulse(loop = true) {
        this.init();
        this.stopAll();
        this.isPlaying = true;

        const playPulse = () => {
            if (!this.isPlaying) return;
            const now = this.ctx.currentTime;
            
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(1200, now);
            osc.frequency.exponentialRampToValueAtTime(300, now + 0.35);

            gain.gain.setValueAtTime(this.volume * 0.8, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.4);

            osc.connect(gain);
            gain.connect(this.ctx.destination);
            osc.start(now);
            osc.stop(now + 0.42);

            if ('vibrate' in navigator) {
                navigator.vibrate([150, 850]);
            }
        };

        playPulse();
        if (loop) {
            const intId = setInterval(playPulse, 1000);
            this.activeIntervals.push(intId);
        }
    }

    // 5. Gentle Melody (Soothing waking marimba)
    playGentleMelody(loop = true) {
        this.init();
        this.stopAll();
        this.isPlaying = true;

        const playMelody = () => {
            if (!this.isPlaying) return;
            const chords = [440, 554.37, 659.25, 880]; // A major
            chords.forEach((freq, idx) => {
                const now = this.ctx.currentTime + (idx * 0.28);
                const osc = this.ctx.createOscillator();
                const gain = this.ctx.createGain();

                osc.type = 'triangle';
                osc.frequency.setValueAtTime(freq, now);

                gain.gain.setValueAtTime(this.volume * 0.5, now);
                gain.gain.exponentialRampToValueAtTime(0.001, now + 0.9);

                osc.connect(gain);
                gain.connect(this.ctx.destination);
                osc.start(now);
                osc.stop(now + 0.95);
            });

            if ('vibrate' in navigator) {
                navigator.vibrate([100, 200, 100, 200]);
            }
        };

        playMelody();
        if (loop) {
            const intId = setInterval(playMelody, 2000);
            this.activeIntervals.push(intId);
        }
    }

    // 6. Heavy Klaxon (Dual-tone industrial blast + sub-kick, ultra-powerful wake-up)
    playHeavyKlaxon(loop = true) {
        this.init();
        this.stopAll();
        this.isPlaying = true;

        const playKlaxonBlast = () => {
            if (!this.isPlaying) return;
            const now = this.ctx.currentTime;

            // Two detuned sawtooth waves to produce massive acoustic beating
            const freqs = [420, 465, 840];
            freqs.forEach((f, idx) => {
                const osc = this.ctx.createOscillator();
                const gain = this.ctx.createGain();

                osc.type = 'sawtooth';
                osc.frequency.setValueAtTime(f, now);
                osc.frequency.exponentialRampToValueAtTime(f * 1.08, now + 0.35);

                const vol = idx === 2 ? this.volume * 0.4 : this.volume * 0.88;
                gain.gain.setValueAtTime(vol, now);
                gain.gain.setValueAtTime(vol, now + 0.3);
                gain.gain.exponentialRampToValueAtTime(0.001, now + 0.38);

                osc.connect(gain);
                gain.connect(this.ctx.destination);
                osc.start(now);
                osc.stop(now + 0.4);
            });

            // Low frequency sub-punch for physical presence
            const subOsc = this.ctx.createOscillator();
            const subGain = this.ctx.createGain();
            subOsc.type = 'triangle';
            subOsc.frequency.setValueAtTime(150, now);
            subOsc.frequency.exponentialRampToValueAtTime(60, now + 0.35);
            subGain.gain.setValueAtTime(this.volume * 0.7, now);
            subGain.gain.exponentialRampToValueAtTime(0.001, now + 0.38);
            subOsc.connect(subGain);
            subGain.connect(this.ctx.destination);
            subOsc.start(now);
            subOsc.stop(now + 0.4);

            // Second blast 450ms later (dual-tone fanfare)
            const t2 = now + 0.45;
            freqs.forEach((f, idx) => {
                const osc = this.ctx.createOscillator();
                const gain = this.ctx.createGain();

                osc.type = 'sawtooth';
                osc.frequency.setValueAtTime(f * 1.12, t2);
                osc.frequency.exponentialRampToValueAtTime(f * 1.2, t2 + 0.4);

                const vol = idx === 2 ? this.volume * 0.4 : this.volume * 0.88;
                gain.gain.setValueAtTime(vol, t2);
                gain.gain.setValueAtTime(vol, t2 + 0.35);
                gain.gain.exponentialRampToValueAtTime(0.001, t2 + 0.45);

                osc.connect(gain);
                gain.connect(this.ctx.destination);
                osc.start(t2);
                osc.stop(t2 + 0.46);
            });

            if ('vibrate' in navigator) {
                navigator.vibrate([350, 100, 350, 200]);
            }
        };

        playKlaxonBlast();
        if (loop) {
            const intId = setInterval(playKlaxonBlast, 1100);
            this.activeIntervals.push(intId);
        }
    }

    // 7. Air Raid Siren (Piercing 2.2kHz staccato pulses + alternating frequency modulation)
    playAirRaid(loop = true) {
        this.init();
        this.stopAll();
        this.isPlaying = true;

        const playRaidBurst = () => {
            if (!this.isPlaying) return;
            const now = this.ctx.currentTime;
            const pulses = [1400, 1800, 2200, 2600, 2200, 1800];

            pulses.forEach((freq, idx) => {
                const pTime = now + (idx * 0.09);
                const osc = this.ctx.createOscillator();
                const gain = this.ctx.createGain();

                osc.type = 'square';
                osc.frequency.setValueAtTime(freq, pTime);
                osc.frequency.exponentialRampToValueAtTime(freq * 1.15, pTime + 0.08);

                gain.gain.setValueAtTime(this.volume * 0.85, pTime);
                gain.gain.exponentialRampToValueAtTime(0.001, pTime + 0.085);

                osc.connect(gain);
                gain.connect(this.ctx.destination);
                osc.start(pTime);
                osc.stop(pTime + 0.09);
            });

            if ('vibrate' in navigator) {
                navigator.vibrate([100, 50, 100, 50, 100, 50, 100, 200]);
            }
        };

        playRaidBurst();
        if (loop) {
            const intId = setInterval(playRaidBurst, 850);
            this.activeIntervals.push(intId);
        }
    }

    // Play by sound ID
    playSound(soundId, loop = true) {
        switch (soundId) {
            case 'loud':
            case 'default':
                this.playLoudAlarm(loop);
                break;
            case 'klaxon':
            case 'horn':
                this.playHeavyKlaxon(loop);
                break;
            case 'airraid':
            case 'hyper':
                this.playAirRaid(loop);
                break;
            case 'siren':
                this.playDigitalSiren(loop);
                break;
            case 'chime':
            case 'train':
                this.playTrainChime(loop);
                break;
            case 'radar':
                this.playRadarPulse(loop);
                break;
            case 'gentle':
                this.playGentleMelody(loop);
                break;
            default:
                this.playLoudAlarm(loop);
        }
    }
}

window.soundEngine = new SoundEngine();

// Auto-unlock Web Audio on first mobile touch or click anywhere on screen
(function() {
    const unlockHandler = function() {
        if (window.soundEngine) {
            window.soundEngine.unlockAudio();
        }
        ['touchstart', 'touchend', 'pointerdown', 'click'].forEach(evt => {
            document.removeEventListener(evt, unlockHandler, true);
        });
    };
    ['touchstart', 'touchend', 'pointerdown', 'click'].forEach(evt => {
        document.addEventListener(evt, unlockHandler, { capture: true, passive: true });
    });
})();
