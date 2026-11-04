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
        if (this.ctx?.state === "suspended") {
          this.ctx.resume().catch(() => {});
        }
        return;
      }

      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) {
        console.warn("Web Audio не поддерживается браузером.");
        return;
      }

      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.enabled ? this.volume : 0;
      this.master.connect(this.ctx.destination);
      this.initialized = true;

      if (this.enabled) this.startAmbience();
    },

    setVolume(value) {
      this.volume = Math.max(0, Math.min(1, value));

      if (this.master && this.ctx) {
        this.master.gain.setTargetAtTime(
          this.enabled ? this.volume : 0,
          this.ctx.currentTime,
          0.05
        );
      }
    },

    toggle() {
      if (!this.initialized) this.init();
      this.enabled = !this.enabled;

      if (this.master && this.ctx) {
        this.master.gain.setTargetAtTime(
          this.enabled ? this.volume : 0,
          this.ctx.currentTime,
          0.08
        );
      }

      if (this.enabled) this.startAmbience();
      else this.stopAmbience();

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
      const now = ctx.currentTime;

      oscillator.type = type;
      oscillator.frequency.setValueAtTime(frequency, now);

      if (endFreq) {
        oscillator.frequency.exponentialRampToValueAtTime(
          Math.max(1, endFreq),
          now + duration
        );
      }

      gain.gain.setValueAtTime(0.001, now);
      gain.gain.exponentialRampToValueAtTime(
        Math.max(0.001, volume),
        now + Math.min(0.03, duration / 3)
      );
      gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

      oscillator.connect(gain);
      gain.connect(this.master);
      oscillator.start(now);
      oscillator.stop(now + duration + 0.05);
    },

    noise(duration, volume = 0.15, filterFrequency = 1000) {
      if (!this.initialized || !this.enabled) return;

      const ctx = this.ctx;
      const length = Math.max(1, Math.floor(ctx.sampleRate * duration));
      const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
      const data = buffer.getChannelData(0);

      for (let i = 0; i < length; i++) {
        data[i] = Math.random() * 2 - 1;
      }

      const source = ctx.createBufferSource();
      const filter = ctx.createBiquadFilter();
      const gain = ctx.createGain();
      const now = ctx.currentTime;

      source.buffer = buffer;
      filter.type = "lowpass";
      filter.frequency.value = filterFrequency;

      gain.gain.setValueAtTime(Math.max(0.001, volume), now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

      source.connect(filter);
      filter.connect(gain);
      gain.connect(this.master);

      source.start(now);
      source.stop(now + duration);
    },

    startAmbience() {
      if (!this.initialized || !this.enabled || this.ambience) return;

      const ctx = this.ctx;
      const length = ctx.sampleRate * 4;
      const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
      const data = buffer.getChannelData(0);

      for (let i = 0; i < length; i++) {
        data[i] = (Math.random() * 2 - 1) * 0.35;
      }

      const source = ctx.createBufferSource();
      const filter = ctx.createBiquadFilter();
      const gain = ctx.createGain();

      source.buffer = buffer;
      source.loop = true;
      filter.type = "lowpass";
      filter.frequency.value = 220;
      filter.Q.value = 0.45;
      gain.gain.value = 0.008;

      source.connect(filter);
      filter.connect(gain);
      gain.connect(this.master);
      source.start();

      this.ambience = { source, gain };
    },

    stopAmbience() {
      if (!this.ambience) return;

      const old = this.ambience;
      this.ambience = null;

      try {
        old.source.stop();
      } catch {}
    },

    step() {
      if (!this.initialized || !this.enabled) return;

      const now = Date.now();
      if (now - this.lastStep < 450) return;
      this.lastStep = now;

      this.noise(0.09, 0.08, 500);
      this.tone(90, 0.09, "triangle", 0.06, 55);
    },

    metalStep() {
      this.noise(0.12, 0.12, 1400);
      this.tone(210, 0.14, "triangle", 0.09, 90);
    },

    door() {
      this.noise(0.65, 0.16, 550);
      this.tone(100, 0.7, "sawtooth", 0.08, 38);
      setTimeout(() => this.noise(0.25, 0.07, 800), 180);
    },

    lock() {
      this.tone(850, 0.07, "square", 0.1, 420);
      setTimeout(() => {
        this.tone(160, 0.24, "triangle", 0.09, 65);
      }, 90);
      this.noise(0.1, 0.07, 1600);
    },

    radio() {
      this.noise(0.45, 0.13, 2800);
      this.tone(1100, 0.2, "sine", 0.06, 350);
    },

    switchSound() {
      this.tone(620, 0.05, "square", 0.07, 300);
      this.tone(120, 0.12, "sine", 0.06, 70);
    },

    heartbeat() {
      this.tone(65, 0.16, "sine", 0.15, 40);
      setTimeout(() => this.tone(55, 0.18, "sine", 0.12, 35), 220);
    },

    scare() {
      this.noise(0.8, 0.22, 4200);
      this.tone(170, 0.7, "sawtooth", 0.16, 28);
    },

    click() {
      this.tone(480, 0.04, "square", 0.05, 280);
    },

    playForChoice(text) {
      if (!this.initialized || !this.enabled) return;

      const value = String(text || "").toLowerCase();

      if (/радио|связ|частот|сигнал/.test(value)) {
        this.radio();
      } else if (/двер|открыть|закрыть|войти|выйти/.test(value)) {
        this.door();
      } else if (/фонар|свет|выключить|включить|панел/.test(value)) {
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
        <input id="s9-audio-volume" type="range" min="0" max="100" value="35">
      `;

      document.body.appendChild(panel);

      document.getElementById("s9-audio-toggle").addEventListener("click", () => {
        this.init();
        this.toggle();
      });

      document.getElementById("s9-audio-volume").addEventListener("input", event => {
        this.init();
        this.setVolume(Number(event.target.value) / 100);
      });
    },

    bindEvents() {
      document.addEventListener("pointerdown", () => this.init(), { once: true });

      document.addEventListener("click", event => {
        const choice = event.target.closest(".choice, [data-choice], button");
        if (!choice || choice.id === "s9-audio-toggle") return;

        this.init();
        this.playForChoice(choice.textContent);
      });

      const title = document.getElementById("sceneTitle");

      if (title) {
        const observer = new MutationObserver(() => {
          if (this.initialized && this.enabled) this.step();
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
