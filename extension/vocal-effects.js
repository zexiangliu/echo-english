(function(root) {
  const presets = {ktv: {seconds: 1.2, preDelay: 0.018}, theatre: {seconds: 2.6, preDelay: 0.035}};

  function normalize(value = {}) {
    const number = (input, fallback) => Number.isFinite(Number(input)) ? Number(input) : fallback;
    return {
      delayMs: Math.round(Math.max(-2000, Math.min(2000, number(value?.delayMs, 0)))),
      reverb: Object.hasOwn(presets, value?.reverb) ? value.reverb : 'off',
      amount: Math.max(0, Math.min(2, number(value?.amount, 0.25))),
      ...(number(value?.fadeOutSeconds,0)>0?{fadeOutSeconds:Math.min(5,number(value.fadeOutSeconds,0))}:{})
    };
  }

  function enabled(value) {
    const effects = normalize(value);
    return effects.delayMs !== 0 || effects.fadeOutSeconds > 0 || (effects.reverb !== 'off' && effects.amount > 0);
  }

  function fadeGain(position, duration, seconds) {
    if (!(seconds > 0)) return 1;
    return Math.max(0, Math.min(1, (duration - position) / Math.min(seconds, duration)));
  }

  function durationOf(buffer, take) {
    const end = Math.min(take.end, take.capturedEnd ?? take.end);
    const recorded = (end - take.start) / (take.speed || 1) + (take.vocalOffset || 0);
    return Number.isFinite(recorded) && recorded > 0 ? Math.min(buffer.duration, recorded) : buffer.duration;
  }

  const impulseCache = new WeakMap();
  // A seeded stereo impulse keeps repeated previews and exports identical.
  function impulse(context, preset) {
    const cached = impulseCache.get(context);
    if (cached?.[preset]) return cached[preset];
    const {seconds, preDelay} = presets[preset];
    const length = Math.ceil(seconds * context.sampleRate);
    const buffer = context.createBuffer(2, length, context.sampleRate);
    for (let channel = 0; channel < 2; channel++) {
      const data = buffer.getChannelData(channel);
      let seed = 731 + channel * 151;
      for (let i = Math.round(preDelay * context.sampleRate); i < length; i++) {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        data[i] = (seed / 2147483648 - 1) * Math.exp(-7 * i / length);
      }
    }
    impulseCache.set(context,{...cached,[preset]:buffer});
    return buffer;
  }

  // Shared by playback, offline export and headphone monitoring. The dry
  // connection stays direct; convolution is allocated only when requested.
  function createReverb(context, input, output, value = {}) {
    let current = normalize(value), convolver = null, wet = null;
    input.connect(output);
    function clear() {
      if (convolver) {input.disconnect(convolver); convolver.disconnect(); wet?.disconnect();}
      convolver = wet = null;
    }
    function set(value, reset = false) {
      const next = normalize(value);
      if (reset || next.reverb !== current.reverb || !convolver && next.reverb !== 'off' && next.amount > 0) {
        let replacement = null, replacementWet = null;
        if (next.reverb !== 'off' && next.amount > 0) {
          replacement = context.createConvolver();
          try {
            replacement.buffer = impulse(context, next.reverb);
            replacementWet = context.createGain();replacementWet.gain.value = next.amount;
          } catch (error) {replacement.disconnect();replacementWet?.disconnect();throw error;}
        }
        clear();convolver = replacement;wet = replacementWet;
        if (convolver) {input.connect(convolver);convolver.connect(wet);wet.connect(output);}
      }
      if (wet) {
        const amount = next.reverb === 'off' ? 0 : next.amount;
        if (wet.gain.setTargetAtTime) {wet.gain.cancelScheduledValues(context.currentTime);wet.gain.setTargetAtTime(amount,context.currentTime,0.01);}
        else wet.gain.value = amount;
      }
      current = next;
    }
    try {set(current, true);} catch (error) {clear();input.disconnect(output);throw error;}
    return {set, reset: () => set(current, true), dispose() {clear();input.disconnect(output);}};
  }

  async function process(buffer, value, env = root, endTime = buffer.duration) {
    const effects = normalize(value);
    if (!enabled(effects)) return buffer;
    const context = new env.OfflineAudioContext(2, buffer.length, buffer.sampleRate);
    const source = context.createBufferSource();
    source.buffer = buffer;
    createReverb(context, source, context.destination, effects);
    const offset = Math.max(0, -effects.delayMs / 1000);
    if (offset < buffer.duration) source.start(Math.max(0, effects.delayMs / 1000), offset);
    const rendered = await context.startRendering();
    if (effects.fadeOutSeconds > 0) for (let c = 0; c < rendered.numberOfChannels; c++) {
      const data = rendered.getChannelData(c);
      for (let i = 0; i < data.length; i++) data[i] *= fadeGain(i / rendered.sampleRate, endTime, effects.fadeOutSeconds);
    }
    // Keep the vocal/backing ratio unchanged. Normalize only the final file,
    // after all stems have been mixed, never individual takes.
    return rendered;
  }

  // The same encoder serves short synchronous exports and cancellable long jobs.
  function* wavSteps(buffer) {
    const channels=buffer.numberOfChannels,bytes=new ArrayBuffer(44+buffer.length*channels*2),view=new DataView(bytes);
    const text=(offset,value)=>{for(let i=0;i<value.length;i++)view.setUint8(offset+i,value.charCodeAt(i));};
    text(0,'RIFF');view.setUint32(4,bytes.byteLength-8,true);text(8,'WAVE');text(12,'fmt ');view.setUint32(16,16,true);
    view.setUint16(20,1,true);view.setUint16(22,channels,true);view.setUint32(24,buffer.sampleRate,true);
    view.setUint32(28,buffer.sampleRate*channels*2,true);view.setUint16(32,channels*2,true);view.setUint16(34,16,true);
    text(36,'data');view.setUint32(40,bytes.byteLength-44,true);
    const data=Array.from({length:channels},(_,c)=>buffer.getChannelData(c)),blockSize=65536;
    let peak=1;
    for(let start=0;start<buffer.length;start+=blockSize){
      const end=Math.min(buffer.length,start+blockSize);
      for(const channel of data)for(let i=start;i<end;i++)peak=Math.max(peak,Math.abs(channel[i]));
      yield;
    }
    for(let start=0;start<buffer.length;start+=blockSize){
      const end=Math.min(buffer.length,start+blockSize);
      for(let i=start;i<end;i++)for(let c=0;c<channels;c++){
        const sample=data[c][i]/peak;
        view.setInt16(44+(i*channels+c)*2,Math.round(sample*(sample<0?32768:32767)),true);
      }
      yield;
    }
    return new Blob([bytes],{type:'audio/wav'});
  }
  function wav(buffer){
    const steps=wavSteps(buffer);let next;
    do{next=steps.next();}while(!next.done);
    return next.value;
  }
  function createScheduler(env=root){
    // MessageChannel keeps cancellation responsive in background tabs too.
    const channel=env.MessageChannel?new env.MessageChannel():null;let finishYield;
    if(channel)channel.port1.onmessage=()=>{const resolve=finishYield;finishYield=null;resolve();};
    return {pause:()=>new Promise(resolve=>{
      if(channel){finishYield=resolve;channel.port2.postMessage(0);}
      else env.setTimeout(resolve,0);
    }),dispose(){channel?.port1.close();channel?.port2.close();}};
  }
  async function wavAsync(buffer,{active=()=>true}={},env=root){
    const scheduler=createScheduler(env),steps=wavSteps(buffer);
    try{
      for(;;){
        if(!active())throw Error('已取消音频编码。');
        const next=steps.next();if(next.done)return next.value;
        await scheduler.pause();
      }
    }finally{steps.return();scheduler.dispose();}
  }

  async function renderTake(take, env = root) {
    const context = new env.AudioContext();
    try {
      const decoded = await context.decodeAudioData(await take.blob.arrayBuffer());
      return await process(decoded, take.effects, env, durationOf(decoded,take));
    } finally {await context.close();}
  }

  // One decoded vocal buffer and a stable clock allow edits during playback.
  // Alignment reschedules only the vocal source; video/accompaniment keep their position.
  async function createPlayer(take, volume = 1, env = root) {
    const context = new env.AudioContext();
    let buffer;
    try {buffer = await context.decodeAudioData(await take.blob.arrayBuffer());}
    catch (error) {await context.close(); throw error;}
    const duration = durationOf(buffer,take);
    let effects = normalize(take.effects), position = 0, startedAt = 0;
    let playing = false, disposed = false, source = null, sourceGain = null, timer = 0, playbackRevision = 0;
    const listeners = new Map();
    const output = context.createGain(), vocalBus = context.createGain(), fade = context.createGain();
    output.connect(fade);fade.connect(context.destination);
    let reverb;
    try {reverb = createReverb(context, vocalBus, output, effects);}
    catch (error) {vocalBus.disconnect();output.disconnect();await context.close();throw error;}
    const clock = () => playing ? Math.min(duration, position + context.currentTime - startedAt) : position;
    const emit = name => {player['on' + name]?.(); for (const listener of listeners.get(name) || []) listener();};
    const smooth = (param, value) => {
      param.cancelScheduledValues(context.currentTime);
      param.setTargetAtTime(value, context.currentTime, 0.01);
    };
    function setVolume(value) {
      smooth(output.gain, Number.isFinite(Number(value)) ? Math.max(0, Math.min(2, Number(value))) : 1);
    }
    function stopSource(hard = false) {
      env.clearTimeout(timer);
      timer = 0;
      if (source) {
        const old = source, gain = sourceGain;
        if (hard) gain.disconnect();
        gain.gain.cancelScheduledValues(context.currentTime);
        gain.gain.setTargetAtTime(0, context.currentTime, 0.003);
        old.onended = () => {old.disconnect(); gain.disconnect();};
        old.stop(context.currentTime + 0.02);
        source = sourceGain = null;
      }
    }
    function scheduleFade() {
      const at = clock(), seconds = effects.fadeOutSeconds;
      fade.gain.cancelScheduledValues(context.currentTime);
      fade.gain.setValueAtTime(fadeGain(at, duration, seconds), context.currentTime);
      if (seconds > 0 && playing) {
        const begin = Math.max(at, duration - seconds);
        if (begin > at) fade.gain.setValueAtTime(1, context.currentTime + begin - at);
        fade.gain.linearRampToValueAtTime(0, context.currentTime + duration - at);
      }
    }
    function schedule(reset = false) {
      stopSource(reset);
      if (reset) reverb.reset();
      if (!playing || disposed) return;
      scheduleFade();
      const at = clock(), delay = effects.delayMs / 1000;
      const offset = Math.max(0, at - delay);
      if (offset < duration) {
        source = context.createBufferSource();
        source.buffer = buffer;
        sourceGain = context.createGain();
        sourceGain.gain.setValueAtTime(0, context.currentTime);
        sourceGain.gain.linearRampToValueAtTime(1, context.currentTime + 0.01);
        source.connect(sourceGain);
        sourceGain.connect(vocalBus);
        source.start(context.currentTime + Math.max(0, delay - at), offset);
      }
      timer = env.setTimeout(() => {
        if (!playing || disposed) return;
        // AudioContext time stops while the device is suspended.
        if (clock() < duration - 0.01) {schedule(); return;}
        position = duration; playing = false;
        stopSource();
        void context.suspend();
        emit('ended');
      }, Math.max(0, duration - at) * 1000);
    }
    const player = {
      get currentTime() {return clock();},
      set currentTime(value) {
        position = Math.max(0, Math.min(duration, Number(value) || 0));
        startedAt = context.currentTime;
        schedule(true);
      },
      get duration() {return duration;},
      get fadeGain() {return fadeGain(clock(),duration,effects.fadeOutSeconds);},
      get paused() {return !playing;},
      get ended() {return !playing && position >= duration;},
      set volume(value) {setVolume(value);},
      set src(value) {if (!value) player.dispose();},
      async play() {
        if (disposed || playing) return;
        const revision = ++playbackRevision;
        await context.resume();
        if (disposed || revision !== playbackRevision || playing) return;
        if (position >= duration) position = 0;
        startedAt = context.currentTime; playing = true;
        schedule(); emit('playing');
      },
      pause() {
        playbackRevision++;
        if (!playing) return;
        position = clock(); playing = false;
        stopSource(); void context.suspend();
      },
      setEffects(value) {
        const next = normalize(value), moved = next.delayMs !== effects.delayMs;
        effects = next;
        reverb.set(effects);scheduleFade();
        if (moved) schedule(true);
      },
      setVolume,
      addEventListener(name, listener) {
        if (!listeners.has(name)) listeners.set(name, new Set());
        listeners.get(name).add(listener);
      },
      removeEventListener(name, listener) {listeners.get(name)?.delete(listener);},
      dispose() {
        if (disposed) return;
        player.pause(); disposed = true;
        reverb.dispose(); vocalBus.disconnect(); output.disconnect(); fade.disconnect();
        void context.close().catch(() => {});
      }
    };
    setVolume(volume);
    await context.suspend();
    return player;
  }

  const api = {fadeGain, durationOf, normalize, enabled, impulse, createReverb, process, wav, wavAsync, createScheduler, renderTake, createPlayer};
  if (typeof module !== 'undefined') module.exports = api;
  else root.EchoVocalEffects = api;
})(globalThis);
