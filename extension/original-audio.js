// Prepared original audio uses the existing pitch engine; the YouTube video
// remains the transport clock. Never attach a disposable audio graph to it.
(function(root){
  const pitch=typeof module!=='undefined'?require('./backing-pitch.js'):root.EchoBackingPitch;
  const karaoke=typeof module!=='undefined'?require('./karaoke.js'):root.EchoKaraoke;
  let cached=null;
  async function source({videoId,start,end,duration,request,active,status=()=>{}},env=root){
    if(!active())throw Error('已取消原声准备。');
    if(cached?.videoId===videoId && cached.start<=start && cached.end>=end)return cached;
    const range=duration<=600?{start:0,end:duration}:{start,end};
    const health=await request('health');if(!active())throw Error('已取消原声准备。');
    if(!health.originalAudio)throw Error('原声升降调需要更新本机服务：请停止旧服务，重新运行根目录启动脚本。');
    let job;
    try{
      status('正在准备同调原声，首次需提取音频；可点击停止取消…');
      job=await request('start',{videoId,...range,source:'original',quality:'lossless'});
      while(active() && !['ready','error','cancelled'].includes(job.state)){
        await new Promise(resolve=>env.setTimeout(resolve,300));
        if(!active())break;
        job=await request('status',{jobId:job.id});
      }
      if(!active())throw Error('已取消原声准备。');
      if(job.state!=='ready')throw Error(job.error || '原声准备已停止，请重试。');
      const result=await karaoke.fetchAudio(request,{jobId:job.id,active});
      if(!active())throw Error('已取消原声准备。');
      cached={videoId,...range,blob:result.blob};return cached;
    }finally{if(job && !active())void request('cancel',{jobId:job.id}).catch(()=>{});}
  }
  async function create({video,videoId,range,semitones,request,active,status,onError=()=>{}},env=root){
    const original=await source({videoId,...range,duration:video.duration,request,active,status},env);
    const blob=await pitch.shiftBlob(original.blob,semitones,{active},env);
    if(!active())throw Error('已取消原声升降调。');
    const url=env.URL.createObjectURL(blob),audio=new env.Audio(url);let disposed=false,playing=false,buffering=false,muted=false,revision=0,syncing=null;
    const oldMuted=video.muted;
    audio.preload='auto';audio.preservesPitch=true;audio.volume=video.volume ?? 1;
    let loadTimer;
    try{
      if(audio.readyState<3)await new Promise((resolve,reject)=>{
        loadTimer=env.setTimeout(()=>reject(Error('同调原声加载超时，请重试。')),10000);
        audio.oncanplay=resolve;audio.onerror=()=>reject(Error('同调原声无法解码，请重试。'));audio.load();
      });
      if(!active())throw Error('已取消原声准备。');
    }catch(error){audio.removeAttribute('src');audio.load();env.URL.revokeObjectURL(url);throw error;}
    finally{env.clearTimeout?.(loadTimer);audio.oncanplay=audio.onerror=null;}

    function position(){
      if(video.currentTime<original.start-.1 || video.currentTime>original.end+.1)throw Error('已超出准备的同调原声范围，请停止试听后从当前句重新播放。');
      const target=Math.max(0,video.currentTime-original.start);
      if(!Number.isFinite(audio.currentTime) || Math.abs(audio.currentTime-target)>.01)audio.currentTime=target;
      audio.playbackRate=video.playbackRate;}
    function sync(){
      if(syncing)return syncing;
      if(disposed || !active() || !playing || buffering || video.paused)return Promise.resolve();
      const token=revision;
      syncing=(async()=>{
        position();
        try{await audio.play();}
        catch(error){if(!disposed && active() && playing && !buffering && token===revision)throw error;}
        if(disposed || !active() || !playing || buffering || token!==revision)audio.pause();
      })().finally(()=>{
        syncing=null;
        if(!disposed && active() && playing && !buffering && !video.paused && token!==revision)void sync().catch(report);
      });return syncing;
    }
    const report=error=>{if(!disposed && active())onError(error);};
    const waiting=()=>{buffering=true;++revision;audio.pause();};
    const resumed=()=>{buffering=false;void sync().catch(report);};
    const seeked=()=>{if(playing)void sync().catch(report);};
    const tick=()=>{
      if(playing && !buffering && !video.paused && Math.abs(original.start+audio.currentTime-video.currentTime)>0.12)void sync().catch(report);
    };
    const volumeChanged=()=>{audio.volume=video.volume;if(playing && !video.muted)video.muted=true;};
    const rateChanged=()=>{audio.playbackRate=video.playbackRate;};
    const listeners={waiting,playing:resumed,pause:()=>{++revision;audio.pause();},seeked,timeupdate:tick,volumechange:volumeChanged,ratechange:rateChanged};
    for(const [name,fn] of Object.entries(listeners))video.addEventListener?.(name,fn);
    audio.onerror=()=>report(Error('同调原声无法播放，请重试。'));
    const media={
      get currentTime(){return video.currentTime;},set currentTime(value){++revision;audio.pause();video.currentTime=value;position();},
      get playbackRate(){return video.playbackRate;},set playbackRate(value){video.playbackRate=value;audio.playbackRate=value;},
      get volume(){return video.volume;},set volume(value){video.volume=value;audio.volume=value;},
      get muted(){return muted;},set muted(value){muted=value;audio.muted=value;video.muted=true;},
      get ended(){return video.ended;},get seeking(){return video.seeking;},get paused(){return video.paused;},
      addEventListener:(...args)=>video.addEventListener(...args),removeEventListener:(...args)=>video.removeEventListener(...args),
      async play(){
        if(disposed || !active())return;
        playing=true;buffering=false;video.muted=true;position();
        await audio.play();if(disposed || !active()){audio.pause();return;}
        try{await video.play();}catch(error){audio.pause();throw error;}
        if(disposed || !active()){audio.pause();return;}
        await sync();
      },
      pause(){playing=false;++revision;audio.pause();video.pause();}
    };
    return {media,semitones,videoId,range:{start:original.start,end:original.end},dispose(){
      if(disposed)return;disposed=true;playing=false;++revision;audio.pause();
      for(const [name,fn] of Object.entries(listeners))video.removeEventListener?.(name,fn);
      audio.removeAttribute('src');audio.load();env.URL.revokeObjectURL(url);video.muted=oldMuted;
    }};
  }
  const api={source,create,clear(){cached=null;}};
  if(typeof module!=='undefined')module.exports=api;else root.EchoOriginalAudio=api;
})(globalThis);
