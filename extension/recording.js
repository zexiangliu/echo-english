// Own one capture's microphone, gain graph, monitor, meter and encoder.
// UI state, video timing and persistence belong to the calling coordinator.
(function(root) {
  function create({constraints, gainDb, quality, sidetone=false, sidetoneVolume=0.35, sidetoneMode='minimum', sidetoneReverb={}, active, createMonitor, createMeter, onComplete, onError, microphone = root.EchoMicrophone, env = root}) {
    const options = microphone.recordingOptions(quality, env.MediaRecorder);
    let mic, micTrack, input, monitor, meter, recorder, info;
    let stopping = false, settled = false, released = false, discarded = false;
    const chunks = [];
    // MediaRecorder omits paused time from its file. Offset calculations must
    // use that same clock, rather than include video/decoder buffering.
    const now = () => env.performance?.now?.() ?? Date.now();
    let recordedMilliseconds = 0, runningSince = null;
    function freezeClock() {
      if (runningSince === null) return;
      recordedMilliseconds += Math.max(0, now() - runningSince);runningSince = null;
    }
    function elapsed() {
      return (recordedMilliseconds + (runningSince === null ? 0 : Math.max(0, now() - runningSince))) / 1000;
    }
    let resolve, reject;
    const completed = new Promise((done, fail) => { resolve = done; reject = fail; });
    // Cancellation or a setup error may finish before the caller awaits it.
    completed.catch(() => {});
    const available = () => !stopping && !settled && active();
    const stopTracks = stream => stream?.getTracks().forEach(track => track.stop());

    function inputEnded(){if(!available())return;onError(Error('麦克风已断开，录音已停止。'));void stop();}
    function pauseFeedback() {
      meter?.dispose(); meter = null;
      input?.setMonitoring?.(false);monitor?.pause();
    }
    function release() {
      if (released) return;
      released = true;
      meter?.dispose(); meter = null;
      monitor?.dispose();
      input?.dispose();
      micTrack?.removeEventListener?.('ended',inputEnded);stopTracks(mic);
    }
    function finish() {
      if (settled) return;
      settled = true;freezeClock();
      const blob = new env.Blob(chunks, {type: recorder?.mimeType || options.mimeType || ''});
      if(info && sidetone)info.monitoring=input?.monitoringInfo?.() || null;
      const result = !discarded && blob.size ? {blob, recordingInfo: info, inputGainDb: input.db} : null;
      release();
      Promise.resolve().then(() => onComplete(result)).then(() => resolve(!!result), reject);
    }
    async function prepare() {
      try {
        const acquired = await microphone.requestStream(env.navigator.mediaDevices,constraints);
        if (!available()) { stopTracks(acquired); stop(); return false; }
        mic = acquired;micTrack=mic.getAudioTracks?.()[0] || mic.getTracks()[0];
        micTrack?.addEventListener?.('ended',inputEnded);
        const processed = await microphone.createInput(mic, gainDb,env,{sidetone,sidetoneVolume,sidetoneMode,sidetoneReverb});
        if (!available()) { processed.dispose(); stop(); return false; }
        input = processed;
        const accompaniment = createMonitor ? await createMonitor() : null;
        if (!available()) { accompaniment?.dispose(); stop(); return false; }
        monitor = accompaniment;
        recorder = new env.MediaRecorder(input.stream, options);
        if (quality === 'lossless' && !microphone.isLossless(recorder.mimeType)) throw Error('浏览器未启用无损 PCM，已取消录音。请改选高品质压缩。');
        info = {quality, mimeType: recorder.mimeType || options.mimeType || '', audioBitsPerSecond: recorder.audioBitsPerSecond || null,
          microphone: microphone.captureSettings(mic), encodingInput: microphone.captureSettings(input.stream)};
        recorder.ondataavailable = event => { if (!settled && event.data.size) chunks.push(event.data); };
        recorder.onstop = finish;
        recorder.onerror = () => { if (settled || stopping) return; onError(Error('录音失败，请检查麦克风后重试。')); stop(); };
        return true;
      } catch (error) { finish(); throw error; }
    }
    function stop() {
      if (stopping || settled) return completed;
      stopping = true;freezeClock();input?.setMonitoring?.(false);
      if (recorder && recorder.state !== 'inactive') {
        try { recorder.stop(); } catch (error) { finish(); onError(error); }
      } else finish();
      return completed;
    }
    return {
      prepare, stop, completed, pauseFeedback, elapsed,
      discard(){discarded=true;return stop();},
      get state() { return recorder?.state || 'inactive'; },
      get monitor() { return monitor; },
      get sidetoneInfo(){return input?.monitoringInfo?.() || null;},
      start() { if (!available()) return false; recorder.start(250);runningSince=now();input?.setMonitoring?.(sidetone); return true; },
      startMeter() { if (available() && !meter) meter = createMeter(input.stream); },
      setSidetoneReverb(value){input?.setMonitorReverb?.(value);},
      setSidetoneVolume(value){input?.setMonitorVolume?.(value);},
      setVolume(value) { monitor?.setVolume?.(value); },
      pause() { monitor?.pause(); if (recorder?.state === 'recording') { recorder.pause();freezeClock();input?.setMonitoring?.(false); meter?.setPaused(true); } },
      resume() { if (available() && recorder?.state === 'paused') { recorder.resume();runningSince=now();input?.setMonitoring?.(sidetone); meter?.setPaused(false); } }
    };
  }
  const api = {create};
  if (typeof module !== 'undefined') module.exports = api;
  else root.EchoRecording = api;
})(globalThis);
