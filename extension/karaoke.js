(function(root) {
  const pitch=typeof module!=='undefined'?require('./backing-pitch.js'):root.EchoBackingPitch;
  const DEFAULT_MODEL='demucs-htdemucs';
  function modelOf(value){return value?.model || DEFAULT_MODEL;}
  function qualityOf(value){return value?.quality || 'standard';}
  // Generation has its own range; changing it never changes the recording selection.
  function generationRange({scope='current',current,paragraph,duration,start,end}) {
    const range=scope==='whole'?{start:0,end:duration,speed:1}:scope==='custom'?{start,end,speed:1}:scope==='paragraph'?paragraph:current;
    if(!range || !Number.isFinite(range.start) || !Number.isFinite(range.end) || range.start<0 || range.end<=range.start)
      throw Error('请选择有效的音频时间区间，终点须晚于起点。');
    if(!Number.isFinite(duration) || duration<=0)throw Error('请等待视频时长加载后再生成。');
    if(range.end>duration+0.001)throw Error('生成范围不能超过视频时长。');
    if(range.end-range.start>600)throw Error('每次最多生成 10 分钟，请选择当前练习范围或较短的自定义区间。');
    return {...range};
  }
  function key(videoId, range) {const base=`${videoId}:${Number(range.start).toFixed(3)}:${Number(range.end).toFixed(3)}`;const modelKey=modelOf(range)===DEFAULT_MODEL?base:`${base}:${modelOf(range)}`;return qualityOf(range)==='standard'?modelKey:`${modelKey}:lossless`;}
  function covers(backing, videoId, range) {return !!backing && backing.videoId===videoId && modelOf(backing)===modelOf(range) && qualityOf(backing)===qualityOf(range) && range.start>=backing.start-0.001 && range.end<=backing.end+0.001;}
  function canReplayBacking(take){return !!take && take.capture==='vocal' && !take.withBacking && (take.kind==='song' || !!take.backingKey || take.referenceSource==='original');}
  function backingForTake(backings,take,videoId){
    const range={start:take.start,end:take.capturedEnd ?? take.end,model:take.backingModel || DEFAULT_MODEL,quality:take.backingQuality || 'standard'};
    return backings.find(b=>b.key===take.backingKey && covers(b,videoId,range)) || backings.find(b=>covers(b,videoId,range)) || null;
  }
  function progressText(job,activity='sing') {
    const clock=seconds=>{const n=Math.max(0,Math.round(seconds));return `${Math.floor(n/60)}分${String(n%60).padStart(2,'0')}秒`;};
    const name=activity==='speech'?'背景音':'伴奏';
    const stages={installing:'安装 BandIt 额外依赖', 'model-downloading':'下载分离模型',verifying:'校验模型与依赖',queued:'等待处理',downloading:'提取视频音频',converting:'整理音频片段',separating:activity==='speech'?'去除原对白':'去掉原唱',encoding:`${qualityOf(job)==='lossless'?'无损编码并保存':'压缩并保存'}${name}`,ready:`${name}已生成，正在加载`};
    let text=stages[job.state] || `准备${name}`;
    if(job.state==='model-downloading' && Number.isFinite(job.progress))text+=` ${job.progress}%`;
    if(job.state==='separating')text=job.modelDownloading?'首次准备 · 正在下载分离模型，请保持本机服务运行':text+(Number.isFinite(job.progress)?` ${job.progress}%`:' · 正在加载模型或准备分离');
    if(Number.isFinite(job.elapsedSeconds))text+=` · 已用 ${clock(job.elapsedSeconds)}`;
    if(job.state==='separating' && Number.isFinite(job.remainingSeconds))text+=` · 本阶段预计剩余 ${clock(job.remainingSeconds)}`;
    if(job.state==='separating' && job.device)text+=job.deviceNote?` · ${job.deviceNote}`:['cuda','mps'].includes(job.device)?' · GPU 加速':' · CPU';
    return text;
  }
  function blobFromBase64(value) {
    if(value.blob)return value.blob;
    const bytes=Uint8Array.from(atob(value.audio),c=>c.charCodeAt(0));
    return new Blob([bytes],{type:value.mime});
  }
  async function fetchAudio(request,{jobId,active=()=>true}) {
    const parts=[];let offset=0,total=null,mime=null;
    while(active()){
      const part=await request('audio-chunk',{jobId,offset});
      if(!active())break;
      const bytes=Uint8Array.from(atob(part.audio),c=>c.charCodeAt(0));
      if(part.offset!==offset || !Number.isSafeInteger(part.totalBytes) || part.totalBytes<=0 || part.totalBytes>192*1024*1024 ||
        !bytes.length || bytes.length>1024*1024 || offset+bytes.length>part.totalBytes ||
        (total!==null && total!==part.totalBytes) || (mime!==null && mime!==part.mime))throw Error('无损音频分块无效，请重新加载。');
      total=part.totalBytes;mime=part.mime;parts.push(new Blob([bytes]));offset+=bytes.length;
      if(offset===total)return {blob:new Blob(parts,{type:mime}),mime};
    }
    throw Error('音频加载已取消。');
  }
  // Accompaniment is monitored only; the recorder receives the microphone directly.
  function setGain(gain, volume) {gain.gain.value=Number.isFinite(volume)?Math.max(0,Math.min(2,volume)):1;}
  async function createAudioOutput(music, volume=1, env=root) {
    const context=new env.AudioContext();
    try{
      await context.resume();
      if(context.state==='suspended')throw Error('Audio context suspended');
      // Keep HTML-audio fallback usable if the device cannot start: creating
      // a media-element source reroutes the element away from its normal output.
      const gain=context.createGain();gain.connect(context.destination);setGain(gain,volume);
      const source=context.createMediaElementSource(music);source.connect(gain);
      let disposed=false;
      return {setVolume:value=>setGain(gain,value),dispose:()=>{if(disposed)return;disposed=true;void context.close().catch(()=>{});}};
    }catch(error){await context.close().catch(()=>{});throw error;}
  }
  // A short envelope changes monitoring only; microphone capture stays dry.
  function createLeadInOutput(video,{volume=1,end,speed=1,fadeOut=false},env=root) {
    const originalVolume=video.volume;
    let level=1,frame=0,disposed=false,fadeEnd=fadeOut?end:null,fadeSeconds=0.06;
    function apply(){
      const remaining=(fadeEnd-video.currentTime)/speed;
      video.volume=level*(fadeEnd!==null?Math.max(0,Math.min(1,remaining/fadeSeconds)):1);
    }
    function setVolume(value){
      if(disposed)return;
      // HTML video volume is limited to 100%; do not reroute YouTube's media
      // element into a disposable AudioContext, which would silence it later.
      level=Number.isFinite(value)?Math.max(0,Math.min(1,value)):1;apply();
    }
    function tick(){if(disposed)return;apply();frame=env.requestAnimationFrame(tick);}
    setVolume(volume);if(fadeOut)frame=env.requestAnimationFrame(tick);
    return {setVolume,fadeOut(seconds=0.04){
      if(disposed)return;fadeSeconds=Math.max(0.01,seconds);fadeEnd=video.currentTime+fadeSeconds*speed;
      if(!frame)frame=env.requestAnimationFrame(tick);
    },dispose(){
      if(disposed)return;disposed=true;if(frame)env.cancelAnimationFrame(frame);
      if(Number.isFinite(originalVolume))video.volume=originalVolume;
    }};
  }
  async function createMonitor({blob,video,start,speed,volume=1,initialPosition,fadeInSeconds=0,pitchSemitones=0,active=()=>true}, env=root) {
    blob=await pitch.shiftBlob(blob,pitchSemitones,{active},env);
    if(!active())throw Error('伴奏播放已取消。');
    const context=new env.AudioContext();
    let url,music,loadTimer=0,disposed=false;
    const clearLoading=()=>{env.clearTimeout(loadTimer);loadTimer=0;if(music)music.oncanplay=music.onerror=null;};
    const cleanup=()=>{
      if(disposed)return;disposed=true;clearLoading();
      if(music){music.pause();music.removeAttribute('src');music.load();}
      if(url)env.URL.revokeObjectURL(url);void context.close().catch(()=>{});
    };
    try {
      url=env.URL.createObjectURL(blob);music=new env.Audio(url);
      music.preload='auto';music.preservesPitch=true;
      const backing=context.createMediaElementSource(music), gain=context.createGain();setGain(gain,volume);
      backing.connect(gain);
      const fade=fadeInSeconds>0?context.createGain():null;
      if(fade){fade.gain.value=0;gain.connect(fade);fade.connect(context.destination);}else gain.connect(context.destination);
      let fading=!!fade;
      const ready=new Promise((resolve,reject)=>{
        loadTimer=env.setTimeout(()=>{clearLoading();reject(Error('伴奏加载超时，请重新生成。'));},10000);
        music.oncanplay=()=>{clearLoading();resolve();};
        music.onerror=()=>{clearLoading();reject(Error('伴奏无法解码，请重新生成。'));};
      });
      music.load();await Promise.all([ready,context.resume()]);
      // load() resets playbackRate to defaultPlaybackRate in real browsers.
      music.playbackRate=speed;
      if(Number.isFinite(initialPosition))music.currentTime=Math.max(0,initialPosition-start);
      return {setVolume:value=>setGain(gain,value),
        async sync(position=video.currentTime,{followVideo=false}={}){
          if(disposed)return;
          const target=Math.max(0,position-start);
          if(!Number.isFinite(music.currentTime) || Math.abs(music.currentTime-target)>0.01)music.currentTime=target;
          await music.play();
          if(disposed)return;
          // play() can wait for device/decoder startup. Keep a running video
          // as the clock rather than replaying that startup delay behind it.
          if(followVideo && Math.abs(start+music.currentTime-video.currentTime)>0.03)music.currentTime=Math.max(0,video.currentTime-start);
          if(fading){
            fading=false;const now=context.currentTime;
            fade.gain.setValueAtTime(0,now);fade.gain.linearRampToValueAtTime(1,now+Math.min(0.15,fadeInSeconds));
          }
        },
        async resume(){if(!disposed)await music.play();},
        position:()=>start+music.currentTime,
        pause(){music.pause();},dispose:cleanup};
    }catch(error){cleanup();throw error;}
  }
  // Keep accompaniment on the recording's clock, never the video's clock.
  // Raw vocals include microphone pre-roll; backing starts after vocalOffset.
  function followRecording({monitor,voice,take,enabled=true,volume=1,fade=()=>1,onError}, env=root) {
    let disposed=false,playing=false,pending=false,buffering=false,frame=0,revision=0;
    function pause() {
      ++revision;pending=false;playing=false;monitor.pause();
    }
    async function sync(force=false) {
      if(disposed)return;
      monitor.setVolume?.(volume*fade());
      const elapsed=(voice.currentTime || 0)-(take.vocalOffset || 0);
      const position=take.start+elapsed*take.speed;
      if(!enabled || voice.paused || voice.ended || buffering || elapsed<0 || position>=take.end) {
        if(playing || pending)pause();
        return;
      }
      if(!force && pending)return;
      if(!force && playing && Math.abs(monitor.position()-position)<0.12)return;
      const current=++revision;pending=true;playing=true;
      try {await monitor.sync(position);}
      catch(error) {
        if(!disposed && current===revision){enabled=false;pause();onError?.(error);}
      } finally {if(current===revision)pending=false;}
    }
    function tick() {
      if(disposed)return;
      void sync();frame=env.requestAnimationFrame(tick);
    }
    const waiting=()=>{buffering=true;pause();};
    const resumed=()=>{buffering=false;void sync(true);};
    voice.addEventListener?.('waiting',waiting);
    voice.addEventListener?.('playing',resumed);
    frame=env.requestAnimationFrame(tick);
    return {
      sync:()=>sync(true),pause,
      setEnabled(value){enabled=!!value;if(enabled)void sync(true);else pause();},
      setVolume(value){volume=value;monitor.setVolume(value*fade());},
      dispose(){
        if(disposed)return;disposed=true;env.cancelAnimationFrame(frame);pause();
        voice.removeEventListener?.('waiting',waiting);voice.removeEventListener?.('playing',resumed);
        monitor.dispose();
      }
    };
  }
  const api={generationRange,DEFAULT_MODEL,modelOf,qualityOf,fetchAudio,key,covers,canReplayBacking,backingForTake,progressText,blobFromBase64,createLeadInOutput,createMonitor,createAudioOutput,createBackingOutput:createAudioOutput,followRecording};
  if(typeof module!=='undefined')module.exports=api;else root.EchoKaraoke=api;
})(globalThis);
