
(() => {
  "use strict";

  const AudioSystem = {
    ctx: null,
    master: null,
    ambience: null,
    enabled: true,
    volume: 0.35,
    initialized: false,
    lastStep: 0,

    init() {
      if (this.initialized) {
        if (this.ctx && this.ctx.state === "suspended") {
          this.ctx.resume();
        }
        return;
      }

      const AudioContext =
        window.AudioContext || window.webkitAudioContext;

      if (!AudioContext) {
        console.warn("Web Audio не поддерживается браузером.");
        return;
      }

      this.ctx = new AudioContext();

      this.master = this.ctx.createGain();
      this.master.gain.value = this.volume;
      this.master.connect(this.ctx.destination);

      this.initialized = true;

      if (this.enabled) {
        this.startAmbience();
      }
    },

    setVolume(value) {
      this.volume = Math.max(0, Math.min(1, value));

      if (this.master && this.ctx) {
        this.master.gain.setTargetAtTime(
          this.volume,
          this.ctx.currentTime,
          0.05
        );
      }
    },

    toggle() {
      this.enabled = !this.enabled;

      if (!this.initialized) {
        this.init();
      }

      if (this.master && this.ctx) {
        this.master.gain.setTargetAtTime(
          this.enabled ? this.volume : 0,
          this.ctx.currentTime,
          0.08
        );
      }

      if (this.enabled) {
        this.startAmbience();
      } else {
        this.stopAmbience();
      }

      const button = document.getElementById("s9-audio-toggle");
      if (button) {
        button.textContent = this.enabled ? "ЗВУК: ВКЛ" : "ЗВУК: ВЫКЛ";
      }
    },

    tone(frequency, duration, type = "sine", volume = 0.3, endFreq = null) {
      if (!this.initialized || !this.enabled) return;

      const ctx = this.ctx;
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();

      oscillator.type = type;
      oscillator.frequency.setValueAtTime(
        frequency,
        ctx.currentTime
      );

      if (endFreq) {
        oscillator.frequency.exponentialRampToValueAtTime(
          Math.max(1, endFreq),
          ctx.currentTime + duration
        );
      }

      gain.gain.setValueAtTime(0.001, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(
        Math.max(0.001, volume),
        ctx.currentTime + 0.03
      );
      gain.gain.exponentialRampToValueAtTime(
        0.001,
        ctx.currentTime + duration
      );

      oscillator.connect(gain);
      gain.connect(this.master);

      oscillator.start();
      oscillator.stop(ctx.currentTime + duration + 0.05);
    },

    noise(duration, volume = 0.15, filterFrequency = 1000) {
      if (!this.initialized || !this.enabled) return;

      const ctx = this.ctx;
      const length = Math.floor(ctx.sampleRate * duration);
      const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
      const data = buffer.getChannelData(0);

      for (let i = 0; i < length; i++) {
        data[i] = Math.random() * 2 - 1;
      }

      const source = ctx.createBufferSource();
      const filter = ctx.createBiquadFilter();
      const gain = ctx.createGain();

      source.buffer = buffer;
      filter.type = "lowpass";
      filter.frequency.value = filterFrequency;

      gain.gain.setValueAtTime(volume, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(
        0.001,
        ctx.currentTime + duration
      );

      source.connect(filter);
      filter.connect(gain);
      gain.connect(this.master);

      source.start();
      source.stop(ctx.currentTime + duration);
    },

    startAmbience() {
      if (!this.initialized || !this.enabled || this.ambience) return;

      const ctx = this.ctx;
      const drone = ctx.createOscillator();
      const droneGain = ctx.createGain();

      drone.type = "sawtooth";
      drone.frequency.value = 42;
      droneGain.gain.value = 0.045;

      drone.connect(droneGain);
      droneGain.connect(this.master);
      drone.start();

      const hum = ctx.createOscillator();
      const humGain = ctx.createGain();

      hum.type = "sine";
      hum.frequency.value = 58;
      humGain.gain.value = 0.025;

      hum.connect(humGain);
      humGain.connect(this.master);
      hum.start();

      this.ambience = { drone, hum, droneGain, humGain };
    },

    stopAmbience() {
      if (!this.ambience || !this.ctx) return;

      const old = this.ambience;
      this.ambience = null;

      old.drone.stop(this.ctx.currentTime + 0.1);
      old.hum.stop(this.ctx.currentTime + 0.1);
    },

    step() {
      if (!this.initialized || !this.enabled) return;

      const now = Date.now();
      if (now - this.lastStep < 450) return;
      this.lastStep = now;

      this.noise(0.12, 0.18, 350);
      this.tone(75, 0.13, "triangle", 0.12, 45);
    },

    metalStep() {
      this.noise(0.16, 0.25, 1800);
      this.tone(180, 0.2, "triangle", 0.15, 70);
    },

    door() {
      this.noise(1.4, 0.3, 450);
      this.tone(90, 1.2, "sawtooth", 0.13, 35);
      setTimeout(() => this.noise(0.5, 0.12, 700), 250);
    },

    lock() {
      this.tone(900, 0.08, "square", 0.2, 450);
      setTimeout(() => this.tone(180, 0.3, "metal", 0.15, 70), 100);
      this.noise(0.15, 0.15, 1800);
    },

    radio() {
      this.noise(0.7, 0.25, 3500);
      this.tone(1200, 0.3, "sine", 0.1, 300);
    },

    switchSound() {
      this.tone(650, 0.06, "square", 0.12, 300);
      this.tone(110, 0.15, "sine", 0.1, 65);
    },

    heartbeat() {
      this.tone(65, 0.16, "sine", 0.3, 40);
      setTimeout(() => this.tone(55, 0.18, "sine", 0.25, 35), 220);
    },

    scare() {
      this.noise(1.1, 0.5, 5000);
      this.tone(180, 0.9, "sawtooth", 0.35, 25);
    },

    click() {
      this.tone(500, 0.04, "square", 0.08, 300);
    },

    playForChoice(text) {
      if (!this.initialized || !this.enabled) return;

      const value = String(text || "").toLowerCase();

      if (/двер|открыть|закрыть|войти|выйти/.test(value)) {
        this.door();
      } else if (/радио|связ|частот|сигнал/.test(value)) {
        this.radio();
      } else if (/фонар|свет|выключить|включить/.test(value)) {
        this.switchSound();
      } else if (/бежать|убежать|спрятаться|смотрител/.test(value)) {
        this.step();
      } else if (/удар|атак|сломать/.test(value)) {
        this.metalStep();
      } else {
        this.click();
      }
    },

    createPanel() {
      if (document.getElementById("s9-audio-panel")) return;

      const style = document.createElement("style");
      style.textContent = `
        #s9-audio-panel {
          position: fixed;
          z-index: 99999;
          right: 12px;
          bottom: 12px;
          display: flex;
          align-items: center;
          gap: 9px;
          padding: 9px 12px;
          background: rgba(8, 9, 11, .94);
          border: 1px solid #563535;
          border-radius: 7px;
          color: #d5caca;
          font: 11px monospace;
          box-shadow: 0 0 18px rgba(0,0,0,.55);
        }

        #s9-audio-toggle {
          background: #251516;
          border: 1px solid #754343;
          color: #e3baba;
          padding: 7px 9px;
          font: inherit;
          cursor: pointer;
          border-radius: 4px;
        }

        #s9-audio-panel input {
          width: 65px;
          accent-color: #9b4545;
          cursor: pointer;
        }

        #s9-audio-label {
          color: #a18c8c;
        }
      `;

      document.head.appendChild(style);

      const panel = document.createElement("div");
      panel.id = "s9-audio-panel";

      panel.innerHTML = `
        <button id="s9-audio-toggle" type="button">ЗВУК: ВКЛ</button>
        <span id="s9-audio-label">ГРОМКОСТЬ</span>
        <input id="s9-audio-volume"
          type="range" min="0" max="100" value="35">
      `;

      document.body.appendChild(panel);

      document.getElementById("s9-audio-toggle")
        .addEventListener("click", () => {
          this.init();
          this.toggle();
        });

      document.getElementById("s9-audio-volume")
        .addEventListener("input", event => {
          this.init();
          this.setVolume(Number(event.target.value) / 100);
        });
    },

    bindEvents() {
      document.addEventListener("pointerdown", () => {
        this.init();
      }, { once: true });

      document.addEventListener("click", event => {
        const choice = event.target.closest(
          ".choice, [data-choice], button"
        );

        if (!choice) return;
        if (choice.id === "s9-audio-toggle") return;

        this.init();
        this.playForChoice(choice.textContent);
      });

      const title = document.getElementById("sceneTitle");

      if (title) {
        const observer = new MutationObserver(() => {
          if (!this.initialized || !this.enabled) return;

          this.step();
        });

        observer.observe(title, {
          childList: true,
          characterData: true,
          subtree: true
        });
      }
    },

    start() {
      this.createPanel();
      this.bindEvents();
    }
  };

  window.SECTOR9Audio = AudioSystem;

  function boot() {
    AudioSystem.start();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
