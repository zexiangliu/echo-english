// Microphone processing and optional low-latency headphone monitoring.
(function(root){
  const effects = typeof module !== 'undefined' ? require('./vocal-effects.js') : root.EchoVocalEffects;
  function clampDb(value){return Number.isFinite(value)?Math.max(0,Math.min(24,value)):0;}
  function clampMonitorVolume(value){return Number.isFinite(value)?Math.max(0,Math.min(1,value)):0.35;}
  async function createInput(microphone,db=0,env=root,{sidetone=false,sidetoneVolume=0.35,sidetoneMode='minimum',sidetoneReverb={}}={}){
    db=clampDb(db);
    if(db===0 && !sidetone)return {stream:microphone,db,dispose(){}};
    let context,source,gain,destination,monitorGain,reverb,disposed=false,monitoring=false;
    let volume=clampMonitorVolume(sidetoneVolume);
    function updateMonitor(){if(monitorGain && !disposed)monitorGain.gain.value=monitoring?volume:0;}
    function dispose(){
      if(disposed)return;disposed=true;
      try{reverb?.dispose();source?.disconnect();gain?.disconnect();monitorGain?.disconnect();}catch{}
      destination?.stream.getTracks().forEach(track=>track.stop());
      if(context)void context.close().catch(()=>{});
    }
    try{
      context=new env.AudioContext({latencyHint:sidetone && sidetoneMode==='minimum'?0:'interactive'});
      source=context.createMediaStreamSource(microphone);
      if(db>0){
        gain=context.createGain();gain.gain.value=10**(db/20);
        destination=context.createMediaStreamDestination();
        source.connect(gain);gain.connect(destination);
      }
      if(sidetone){
        monitorGain=context.createGain();monitorGain.gain.value=0;
        reverb=effects.createReverb(context,gain || source,monitorGain,sidetoneReverb);monitorGain.connect(context.destination);
      }
      await context.resume();
      if(context.state==='suspended')throw Error('Audio context suspended');
      return {stream:destination?.stream || microphone,db,dispose,
        monitoringInfo(){return sidetone?monitoringInfo(context,microphone,sidetoneMode):null;},
        setMonitorReverb(value){if(!disposed)reverb?.set(value);},
        setMonitoring(enabled){monitoring=!!enabled;updateMonitor();},
        setMonitorVolume(value){volume=clampMonitorVolume(value);updateMonitor();}};
    }catch(error){
      dispose();throw Error(sidetone?(sidetoneMode==='minimum'?'无法启用更低延迟耳返，请切回标准模式后重试。':'无法启用耳返，请关闭耳返后重试。'):'无法启用手动录音增益，请将增益设为 0 dB 后重试。',{cause:error});
    }
  }
  function monitoringInfo(context,stream,mode='standard'){
    const valid=value=>typeof value==='number' && Number.isFinite(value) && value>=0?value:null;
    const read=key=>{try{return valid(context?.[key]);}catch{return null;}};
    let latency=null;
    try{latency=valid((stream?.getAudioTracks?.()[0] || stream?.getTracks?.()[0])?.getSettings?.()?.latency);}catch{}
    return {mode:mode==='minimum'?'minimum':'standard',inputLatency:latency,baseLatency:read('baseLatency'),outputLatency:read('outputLatency')};
  }
  function describeMonitoring(info){
    if(!info)return '';
    const ms=value=>typeof value==='number' && Number.isFinite(value) && value>=0?`${(value*1000).toFixed(1)} ms`:'未报告';
    return `浏览器估计：输入 ${ms(info.inputLatency)} · 图缓冲 ${ms(info.baseLatency)} · 输出 ${ms(info.outputLatency)}（非完整耳返延迟）`;
  }
  async function requestStream(mediaDevices,constraints){
    try{return await mediaDevices.getUserMedia({audio:constraints,video:false});}
    catch(error){
      if(constraints.deviceId && ['NotFoundError','OverconstrainedError'].includes(error.name))throw Error('所选麦克风不可用，请在「录音设置」中重新检测并选择输入设备。',{cause:error});
      const messages={
        NotAllowedError:'无法使用麦克风：权限未开启。请在浏览器地址栏的网站设置中允许麦克风，并检查系统麦克风权限，然后重试。',
        SecurityError:'无法使用麦克风：浏览器或系统限制了访问。请检查网站与系统的麦克风权限，然后重试。',
        NotFoundError:'未检测到麦克风。请连接或启用输入设备，再到「录音设置」重新检测并选择。',
        NotReadableError:'无法读取麦克风。请检查设备连接，关闭可能占用麦克风的应用，然后重试。'
      };
      if(messages[error.name])throw Error(messages[error.name],{cause:error});
      throw error;
    }
  }
  async function listInputs(mediaDevices){
    const devices=await mediaDevices.enumerateDevices();
    const seen=new Set(['default']);
    return devices.filter(device=>{
      if(device.kind!=='audioinput' || !device.deviceId || seen.has(device.deviceId))return false;
      seen.add(device.deviceId);return true;
    }).map((device,index)=>({id:device.deviceId,label:device.label || `麦克风 ${index+1}（授权后显示名称）`,named:!!device.label}));
  }
  function isLossless(mimeType) { return /codecs\s*=\s*["']?pcm\b/i.test(mimeType || ''); }
  function supportsLossless(Recorder=root.MediaRecorder){
    return !!Recorder?.isTypeSupported?.('audio/webm;codecs=pcm');
  }
  function recordingOptions(quality,Recorder=root.MediaRecorder){
    if(!Recorder)throw Error('浏览器不支持录音，请使用新版 Chrome。');
    if(quality==='lossless'){
      if(!supportsLossless(Recorder))throw Error('当前浏览器不支持无损 PCM 录音，请选择高品质压缩。');
      return {mimeType:'audio/webm;codecs=pcm'};
    }
    const mimeType=['audio/webm;codecs=opus','audio/webm'].find(type=>Recorder.isTypeSupported?.(type));
    return {...(mimeType?{mimeType}:{}),audioBitsPerSecond:256000};
  }
  function captureSettings(stream){
    try{
      const track=stream?.getAudioTracks?.()[0] || stream?.getTracks?.()[0];
      const settings=track?.getSettings?.() || {},result={};
      for(const key of ['sampleRate','channelCount','echoCancellation','noiseSuppression','autoGainControl']){
        if(typeof settings[key]==='boolean' || typeof settings[key]==='number' && Number.isFinite(settings[key]))result[key]=settings[key];
      }
      return result;
    }catch{return {};}
  }
  function describeRecording(info){
    if(!info)return '旧录音未保存采集参数，无法确认当时的码率和麦克风处理设置。';
    const pcm=isLossless(info.mimeType);
    const parts=[pcm?'无损 PCM · WebM':`压缩录音 · ${info.mimeType || '格式未知'}`];
    // MediaRecorder reports an Opus encoding target, not the measured file bitrate.
    // Its PCM audioBitsPerSecond can be a meaningless default: never show it as PCM's rate.
    if(!pcm && info.audioBitsPerSecond>0)parts.push(`编码目标 ${Math.round(info.audioBitsPerSecond/1000)} kbps`);
    const mic=info.microphone || {},encoded=info.encodingInput || {};
    const format=settings=>[settings.sampleRate?`${settings.sampleRate/1000} kHz`:'',settings.channelCount?`${settings.channelCount} 声道`:''].filter(Boolean).join(' · ');
    if(format(mic))parts.push(`麦克风：${format(mic)}`);
    if(format(encoded))parts.push(`编码输入：${format(encoded)}`);
    const processing=[['echoCancellation','回声消除'],['noiseSuppression','降噪'],['autoGainControl','自动增益']].map(([key,label])=>`${label}${typeof mic[key]==='boolean'?(mic[key]?'开':'关'):'未知'}`);
    parts.push(processing.join(' · '));
    if(info.monitoring)parts.push(`耳返：${info.monitoring.mode==='minimum'?'更低延迟':'标准'} · ${describeMonitoring(info.monitoring)}`);
    return parts.join('\n');
  }
  const api={monitoringInfo,describeMonitoring,clampMonitorVolume,requestStream,listInputs,clampDb,createInput,isLossless,supportsLossless,recordingOptions,captureSettings,describeRecording};
  if(typeof module!=='undefined')module.exports=api;else root.EchoMicrophone=api;
})(globalThis);
