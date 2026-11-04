/* SECTOR-9: ЭХО — непрерывная музыка + отдельные SFX */
(() => {
  "use strict";
  const $ = id => document.getElementById(id);
  const KEYS = {music:"s9_music_volume", sfx:"s9_sfx_volume", enabled:"s9_audio_enabled"};
  let enabled = localStorage.getItem(KEYS.enabled) !== "0";
  let musicVolume = Number(localStorage.getItem(KEYS.music) ?? 0.42);
  let sfxVolume = Number(localStorage.getItem(KEYS.sfx) ?? 0.65);
  let ctx=null, sfxBus=null, audio=null, unlocked=false, ambience=null, ambienceNodes=[];
  const TRACK = "/krik-v-pustote-2-b72ee5.mp3";

  function initAudio(){
    if(!ctx){const AC=window.AudioContext||window.webkitAudioContext;if(!AC)return;ctx=new AC();sfxBus=ctx.createGain();sfxBus.gain.value=enabled?sfxVolume:0;sfxBus.connect(ctx.destination);}
    if(ctx.state==="suspended")ctx.resume().catch(()=>{});
  }
  function ensureMusic(){
    if(!audio){audio=new Audio(TRACK);audio.loop=true;audio.preload="auto";audio.volume=enabled?musicVolume:0;audio.addEventListener("error",()=>console.warn("SECTOR-9 music file not found:",TRACK));}
  }
  async function unlockAndPlay(){
    if(unlocked&&audio&&!audio.paused)return;
    unlocked=true;initAudio();ensureMusic();
    if(!enabled)return;
    try{await audio.play();}catch(e){console.warn("Music playback awaits user interaction",e);}
    startAmbience();
  }
  function setEnabled(value){enabled=!!value;localStorage.setItem(KEYS.enabled,enabled?"1":"0");if(audio){audio.volume=enabled?musicVolume:0;if(enabled&&unlocked)audio.play().catch(()=>{});if(!enabled)audio.pause();}if(sfxBus&&ctx)sfxBus.gain.setTargetAtTime(enabled?sfxVolume:0,ctx.currentTime,.04);if(enabled&&unlocked)startAmbience();else stopAmbience();refreshControls();}
  function setMusicVolume(v){musicVolume=Math.max(0,Math.min(1,Number(v)));localStorage.setItem(KEYS.music,String(musicVolume));if(audio)audio.volume=enabled?musicVolume:0;}
  function setSfxVolume(v){sfxVolume=Math.max(0,Math.min(1,Number(v)));localStorage.setItem(KEYS.sfx,String(sfxVolume));if(sfxBus&&ctx)sfxBus.gain.setTargetAtTime(enabled?sfxVolume:0,ctx.currentTime,.04);}
  function tone(f,dur,type="sine",level=.06,end=null,delay=0){if(!enabled||!sfxVolume)return;initAudio();if(!ctx)return;const o=ctx.createOscillator(),g=ctx.createGain(),t=ctx.currentTime+delay;o.type=type;o.frequency.setValueAtTime(f,t);if(end)o.frequency.exponentialRampToValueAtTime(Math.max(1,end),t+dur);g.gain.setValueAtTime(.0001,t);g.gain.exponentialRampToValueAtTime(level,t+.02);g.gain.exponentialRampToValueAtTime(.0001,t+dur);o.connect(g);g.connect(sfxBus);o.start(t);o.stop(t+dur+.03);}
  function noise(dur=.2,level=.04,cutoff=900){if(!enabled||!sfxVolume)return;initAudio();if(!ctx)return;const n=Math.floor(ctx.sampleRate*dur),b=ctx.createBuffer(1,n,ctx.sampleRate),a=b.getChannelData(0);for(let i=0;i<n;i++)a[i]=Math.random()*2-1;const src=ctx.createBufferSource(),f=ctx.createBiquadFilter(),g=ctx.createGain();src.buffer=b;f.type="lowpass";f.frequency.value=cutoff;g.gain.setValueAtTime(level,ctx.currentTime);g.gain.exponentialRampToValueAtTime(.0001,ctx.currentTime+dur);src.connect(f);f.connect(g);g.connect(sfxBus);src.start();src.stop(ctx.currentTime+dur);}
  function startAmbience(){if(!enabled||ambience||!ctx)return;const bus=ctx.createGain();bus.gain.value=.0001;bus.gain.linearRampToValueAtTime(.055,ctx.currentTime+2);bus.connect(sfxBus);const low=ctx.createOscillator(),hum=ctx.createOscillator(),lfo=ctx.createOscillator(),w=ctx.createGain(),filter=ctx.createBiquadFilter();low.type="sawtooth";low.frequency.value=46;hum.type="sine";hum.frequency.value=57;lfo.frequency.value=.12;w.gain.value=3;lfo.connect(w);w.connect(low.frequency);filter.type="lowpass";filter.frequency.value=135;low.connect(filter);hum.connect(filter);filter.connect(bus);low.start();hum.start();lfo.start();ambience=bus;ambienceNodes=[low,hum,lfo];}
  function stopAmbience(){if(!ambience||!ctx)return;const old=ambience;old.gain.setTargetAtTime(.0001,ctx.currentTime,.12);setTimeout(()=>{ambienceNodes.forEach(n=>{try{n.stop()}catch{}});ambienceNodes=[];if(ambience===old)ambience=null;},700);}
  const sounds={step(){noise(.11,.06,420);tone(78,.09,"triangle",.02,48,.015);},metal(){tone(155,.15,"triangle",.06,68);noise(.12,.03,1500);},door(){noise(.7,.1,430);tone(92,.65,"sawtooth",.035,34,.04);},lock(){tone(760,.06,"square",.035,430);tone(300,.12,"triangle",.03,160,.08);},radio(){noise(.5,.07,2600);tone(510,.24,"sawtooth",.02,200,.12);},switch(){tone(880,.035,"square",.035,690);tone(125,.18,"sine",.04,54,.06);},scare(){tone(58,.8,"sawtooth",.12,22);noise(.48,.09,1700);},heartbeat(){tone(67,.15,"sine",.08,40);tone(54,.13,"sine",.065,34,.21);},click(){tone(620,.04,"square",.02,410);}};
  function play(name){if(sounds[name])sounds[name]();}
  function classify(text){const t=(text||"").toLowerCase();if(/смотрител|напад|погон|силуэт|за спиной/.test(t))return"scare";if(/радио|рация|связ|диктофон|помех/.test(t))return"radio";if(/двер|створк|открыть проход/.test(t))return"door";if(/замок|ключ|пропуск|доступ|считывател/.test(t))return"lock";if(/рубильник|выключател|панел/.test(t))return"switch";if(/металл|решетк|лестниц/.test(t))return"metal";return"step";}
  function buildControls(){if($("s9-audio-panel"))return;const style=document.createElement("style");style.textContent=`#s9-audio-panel{position:fixed;z-index:10000;right:10px;bottom:10px;display:grid;grid-template-columns:auto 1fr;gap:7px 10px;align-items:center;padding:10px 12px;background:#090b0ef5;border:1px solid #51464a;border-radius:10px;color:#ddd;font:10px monospace;box-shadow:0 6px 24px #0009;max-width:260px}#s9-audio-panel button{grid-column:1/-1;background:#191a1e;color:#ddd;border:1px solid #65565a;border-radius:6px;padding:7px;font:inherit}#s9-audio-panel label{display:contents}#s9-audio-panel input{width:100px;accent-color:#a65c58}#s9-audio-panel .audio-name{white-space:nowrap}@media(max-width:420px){#s9-audio-panel{right:7px;bottom:7px;transform:scale(.9);transform-origin:bottom right;}}`;document.head.append(style);const panel=document.createElement("div");panel.id="s9-audio-panel";panel.innerHTML='<button id="s9-audio-toggle" type="button">ЗВУК: ВКЛ</button><span class="audio-name">МУЗЫКА</span><input id="s9-music-volume" aria-label="Громкость музыки" type="range" min="0" max="100"><span class="audio-name">ЭФФЕКТЫ</span><input id="s9-sfx-volume" aria-label="Громкость эффектов" type="range" min="0" max="100">';document.body.append(panel);$("s9-audio-toggle").addEventListener("click",()=>{if(!unlocked&&enabled)unlockAndPlay();setEnabled(!enabled);});$("s9-music-volume").addEventListener("input",e=>setMusicVolume(e.target.value/100));$("s9-sfx-volume").addEventListener("input",e=>setSfxVolume(e.target.value/100));refreshControls();}
  function refreshControls(){const b=$("s9-audio-toggle");if(b){b.textContent=enabled?"ЗВУК: ВКЛ":"ЗВУК: ВЫКЛ";b.classList.toggle("on",enabled);}if($("s9-music-volume"))$("s9-music-volume").value=String(Math.round(musicVolume*100));if($("s9-sfx-volume"))$("s9-sfx-volume").value=String(Math.round(sfxVolume*100));}
  function boot(){buildControls();document.addEventListener("pointerdown",e=>{const b=e.target.closest("button");if(!b)return;if(b.id!=="s9-audio-toggle")unlockAndPlay();if(b.classList.contains("choice"))play(classify(b.innerText));else if(b.id!=="s9-audio-toggle")play("click");},true);document.addEventListener("visibilitychange",()=>{if(!audio)return;if(document.hidden){audio.pause();stopAmbience();}else if(enabled&&unlocked){audio.play().catch(()=>{});initAudio();startAmbience();}});const title=$("sceneTitle");if(title&&window.MutationObserver){let last=title.textContent;new MutationObserver(()=>{const now=title.textContent;if(now&&now!==last){last=now;if(enabled)play("step");}}).observe(title,{childList:true,subtree:true,characterData:true});}}
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",boot,{once:true});else boot();
  window.SECTOR9_AUDIO={play,startAmbience,stopAmbience,setEnabled,setMusicVolume,setSfxVolume};
})();
