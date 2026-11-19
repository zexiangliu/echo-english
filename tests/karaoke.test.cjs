const {test}=require('node:test');
const assert=require('node:assert/strict');
const {request}=require('../extension/karaoke-relay.js');
const {key,blobFromBase64,createMonitor}=require('../extension/karaoke.js');
const sender={tab:{url:'https://www.youtube.com/watch?v=jNQXAC9IVRw'}};
const id='a'.repeat(32);

test('backing identity preserves legacy Demucs caches and separates future model outputs',()=>{
  const {DEFAULT_MODEL,modelOf,covers,canReplayBacking,backingForTake}=require('../extension/karaoke.js');
  const range={start:1,end:4},legacy={key:'old',videoId:'video',start:0,end:10};
  assert.equal(modelOf(legacy),DEFAULT_MODEL);
  assert.equal(key('video',range),'video:1.000:4.000');
  assert.notEqual(key('video',{...range,model:'future-model'}),key('video',range));
  assert.equal(covers(legacy,'video',range),true);
  assert.equal(covers({...legacy,model:'future-model'},'video',range),false);
  const movie={capture:'vocal',backingKey:'old',start:1,end:4};
  assert.equal(canReplayBacking(movie),true);
  assert.equal(canReplayBacking({...movie,withBacking:true}),false);
  assert.equal(canReplayBacking({capture:'vocal'}),false);
  assert.equal(backingForTake([legacy],movie,'video'),legacy);
  assert.equal(backingForTake([legacy],{...movie,backingModel:'future-model'},'video'),null);
});

test('service detection uses the fixed health endpoint without creating a job',async()=>{
  await request({action:'health'},sender,async(url,options)=>{
    assert.equal(url,'http://127.0.0.1:8765/health');assert.equal(options.method,'GET');assert.equal(options.body,undefined);
    return {ok:true,json:async()=>({service:'echo-karaoke',version:1})};
  });
  assert.match(require('../extension/karaoke.js').progressText({state:'separating',modelDownloading:true}),/正在下载分离模型/);
});

test('relay accepts a complete ten-minute song',async()=>{
  await request({action:'start',videoId:'jNQXAC9IVRw',start:0,end:600},sender,async(_,options)=>{
    assert.equal(JSON.parse(options.body).end,600);
    return {ok:true,json:async()=>({id,state:'queued'})};
  });
});

test('old service duration errors explain how to restart instead of repeating an obsolete limit',async()=>{
  await assert.rejects(request({action:'start',videoId:'jNQXAC9IVRw',start:0,end:600},sender,
    async()=>({ok:false,json:async()=>({error:'请选择有效的视频和 0–300 秒片段。'})})),/旧版.*Ctrl\+C.*start-karaoke/);
});

test('karaoke relay accepts only fixed loopback routes and current-video clips',async()=>{
  const calls=[];
  const fetcher=async(url,opts)=>{calls.push({url,opts});return {ok:true,json:async()=>({id,state:'queued'})};};
  await request({action:'start',videoId:'jNQXAC9IVRw',start:0,end:180},sender,fetcher);
  assert.equal(calls[0].url,'http://127.0.0.1:8765/jobs');
  assert.equal(calls[0].opts.headers['X-Echo-Client'],'echo-english');
  assert.deepEqual(JSON.parse(calls[0].opts.body),{videoId:'jNQXAC9IVRw',start:0,end:180});
  for(const message of [{action:'start',videoId:'aaaaaaaaaaa',start:0,end:1},{action:'start',videoId:'jNQXAC9IVRw',start:0,end:601},
    {action:'start',videoId:'jNQXAC9IVRw',start:NaN,end:1},{action:'status',jobId:'../../etc/passwd'},{action:'fetch',url:'https://evil.test'}])
    await assert.rejects(request(message,sender,fetcher));
  await assert.rejects(request({action:'status',jobId:id},{tab:{url:'https://www.youtube.com.evil.test/watch?v=jNQXAC9IVRw'}},fetcher));
  assert.equal(calls.length,1);
});

test('relay reports offline and worker failures and transfers audio bytes without corruption',async()=>{
  await assert.rejects(request({action:'status',jobId:id},sender,async()=>{throw Error('offline');}),/本机伴奏服务/);
  await assert.rejects(request({action:'status',jobId:id},sender,async()=>({ok:false,json:async()=>({error:'已有任务'})})),/已有任务/);
  const data=new Uint8Array([0,127,255,42]);
  const result=await request({action:'audio',jobId:id},sender,async()=>({ok:true,headers:new Map(),arrayBuffer:async()=>data.buffer}));
  assert.deepEqual(new Uint8Array(await blobFromBase64(result).arrayBuffer()),data);
  assert.notEqual(key('video',{start:0,end:1}),key('video',{start:0,end:1.2}));
});

test('monitor routes only accompaniment to speakers and does not create a recording stream',async()=>{
  const edges=[],events=[];
  const node=name=>({connect(other){edges.push([name,other.name]);},name});
  let gain=0, music;
  class Context {
    destination=node('speakers');
    createMediaStreamDestination(){assert.fail('monitor must not produce a mixed recording');}
    createMediaElementSource(){return node('music');}
    createMediaStreamSource(){assert.fail('microphone must remain independent');}
    createGain(){return {...node('gain'+(++gain)),gain:{value:1}};}
    async resume(){events.push('resume');}async close(){events.push('close');}
  }
  class Audio {
    constructor(){music=this;}load(){this.playbackRate=1;queueMicrotask(()=>this.oncanplay?.());}
    async play(){events.push('play');}pause(){events.push('pause');}removeAttribute(){}
  }
  const env={AudioContext:Context,Audio,URL:{createObjectURL:()=> 'blob:music',revokeObjectURL:()=>events.push('revoke')},setTimeout,clearTimeout};
  const video={currentTime:12};
  const mix=await createMonitor({blob:new Blob(),video,start:10,speed:0.75},env);
  assert.equal(mix.stream,undefined);
  assert.deepEqual(edges,[['music','gain1'],['gain1','speakers']]);
  await mix.sync();assert.equal(music.currentTime,2);assert.equal(music.playbackRate,0.75);assert.equal(music.preservesPitch,true);
  video.currentTime=99;await mix.sync(10);assert.equal(music.currentTime,0);
  await mix.resume();assert.equal(music.currentTime,0);assert.equal(mix.position(),10);
  mix.pause();mix.dispose();mix.dispose();
  assert.equal(events.filter(e=>e==='close').length,1);assert.equal(events.filter(e=>e==='revoke').length,1);
});

test('whole-song backing covers shorter phrases but never another video or an uncovered range',()=>{
  const {covers}=require('../extension/karaoke.js');
  const backing={videoId:'song',start:0,end:180};
  assert.equal(covers(backing,'song',{start:30,end:40}),true);
  assert.equal(covers(backing,'song',{start:0,end:180}),true);
  assert.equal(covers(backing,'other',{start:30,end:40}),false);
  assert.equal(covers(backing,'song',{start:170,end:190}),false);
  assert.equal(covers({...backing,start:20},'song',{start:10,end:30}),false);
});

test('lead-in fade follows media time at practice speed and restores the original volume on cancellation',()=>{
  const {createLeadInOutput}=require('../extension/karaoke.js'),frames=new Map();let id=0;
  const env={requestAnimationFrame(fn){frames.set(++id,fn);return id;},cancelAnimationFrame(id){frames.delete(id);}};
  const video={currentTime:9,volume:.7};
  const output=createLeadInOutput(video,{volume:.7,end:10,speed:.5,fadeOut:true},env);
  const tick=()=>{const [key,fn]=frames.entries().next().value;frames.delete(key);fn();};
  assert.equal(video.volume,.7);
  video.currentTime=9.985;tick();assert.ok(Math.abs(video.volume-.35)<.001);
  video.currentTime=10;tick();assert.equal(video.volume,0);
  const stale=frames.values().next().value;output.dispose();assert.equal(video.volume,.7);assert.equal(frames.size,0);
  stale();assert.equal(video.volume,.7);
});

test('monitor prepositions before playback and fades only the first handoff without changing the vocal stream',async()=>{
  const gains=[],events=[],seeks=[];let music;
  class Context{
    destination={};currentTime=12;
    createMediaElementSource(){return {connect(){}};}
    createMediaStreamDestination(){assert.fail('no mixed recording');}
    createGain(){const node={connect(){},gain:{value:1,setValueAtTime(value,time){events.push(['set',value,time]);},linearRampToValueAtTime(value,time){events.push(['ramp',value,time]);}}};gains.push(node);return node;}
    async resume(){}async close(){}
  }
  class Audio{
    constructor(){music=this;this.time=0;}
    get currentTime(){return this.time;}set currentTime(value){this.time=value;seeks.push(value);}
    load(){queueMicrotask(()=>this.oncanplay?.());}async play(){events.push('play');}pause(){}removeAttribute(){}
  }
  const env={AudioContext:Context,Audio,URL:{createObjectURL:()=> 'blob:music',revokeObjectURL(){}},setTimeout,clearTimeout};
  const monitor=await createMonitor({blob:new Blob(),video:{currentTime:20},start:10,speed:1,initialPosition:20,fadeInSeconds:.04,volume:1.4},env);
  assert.deepEqual(seeks,[10]);assert.equal(gains[0].gain.value,1.4);assert.equal(gains[1].gain.value,0);
  assert.equal(events.length,0);
  await monitor.sync(20);assert.deepEqual(seeks,[10]);
  assert.deepEqual(events,['play',['set',0,12],['ramp',1,12.04]]);
  monitor.setVolume(.6);assert.equal(gains[0].gain.value,.6);
  monitor.pause();await monitor.sync(21);assert.equal(music.currentTime,11);
  assert.equal(events.filter(event=>Array.isArray(event) && event[0]==='ramp').length,1);
  monitor.dispose();
});

test('accompaniment preview supports live gain above HTML audio volume without changing the element volume',async()=>{
  let gain,closed=0;const music={volume:1};
  const source={connect(){}};
  class AudioContext{
    destination={};createMediaElementSource(value){assert.equal(value,music);return source;}
    createGain(){return gain={gain:{value:1},connect(){}};}
    async resume(){}async close(){closed++;}
  }
  const output=await require('../extension/karaoke.js').createAudioOutput(music,1.5,{AudioContext});
  assert.equal(gain.gain.value,1.5);output.setVolume(2);assert.equal(gain.gain.value,2);
  output.setVolume(0);assert.equal(gain.gain.value,0);output.setVolume(99);assert.equal(gain.gain.value,2);
  assert.equal(music.volume,1);output.dispose();output.dispose();assert.equal(closed,1);
});

test('progress labels separate stage progress from total time and avoid invented percentages',()=>{
  const {progressText}=require('../extension/karaoke.js');
  assert.equal(progressText({state:'separating',progress:40,elapsedSeconds:16,remainingSeconds:23}),
    '去掉原唱 40% · 已用 0分16秒 · 本阶段预计剩余 0分23秒');
  assert.doesNotMatch(progressText({state:'downloading',progress:null,elapsedSeconds:62}),/%/);
  assert.match(progressText({state:'separating',progress:null}),/加载模型/);
  assert.match(progressText({state:'encoding',elapsedSeconds:80}),/压缩并保存/);
  assert.match(progressText({state:'separating',device:'cuda'}),/GPU 加速/);
  assert.match(progressText({state:'separating',device:'mps'},'speech'),/去除原对白.*GPU 加速/);
  assert.match(progressText({state:'separating',device:'cpu',deviceNote:'GPU 处理失败，已自动改用 CPU。'}),/自动改用 CPU/);
});

test('replay accompaniment follows dry vocals through pre-roll, seeking, buffering and mute',async()=>{
  const {followRecording}=require('../extension/karaoke.js');
  const frames=new Map(),listeners=new Map(),positions=[];let next=0,position=0,pauses=0,disposed=0;
  const voice={currentTime:0,paused:false,ended:false,addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:name=>listeners.delete(name)};
  const monitor={position:()=>position,async sync(value){position=value;positions.push(value);},pause(){pauses++;},dispose(){disposed++;},setVolume(){}};
  const follower=followRecording({voice,monitor,take:{start:30,end:40,speed:0.75,vocalOffset:0.25},onError:error=>{throw error;}},
    {requestAnimationFrame(fn){frames.set(++next,fn);return next;},cancelAnimationFrame:id=>frames.delete(id)});
  await follower.sync();assert.deepEqual(positions,[]);
  voice.currentTime=1.25;await follower.sync();assert.equal(position,30.75);
  voice.currentTime=0.75;await follower.sync();assert.equal(position,30.375);
  assert.equal(voice.currentTime,0.75);
  listeners.get('waiting')();const count=positions.length;
  await follower.sync();assert.equal(positions.length,count);
  listeners.get('playing')();await Promise.resolve();assert.equal(positions.length,count+1);
  follower.setEnabled(false);voice.currentTime=3;await follower.sync();assert.equal(positions.length,count+1);
  follower.setEnabled(true);await Promise.resolve();assert.equal(position,32.0625);
  voice.paused=true;const tick=[...frames.values()][0];frames.clear();tick();assert(pauses>0);
  follower.dispose();follower.dispose();tick();await follower.sync();
  assert.equal(disposed,1);assert.equal(frames.size,0);assert.equal(listeners.size,0);
});

test('a late accompaniment failure after disposal cannot affect the next playback',async()=>{
  const {followRecording}=require('../extension/karaoke.js');let reject,errors=0;
  const follower=followRecording({voice:{currentTime:2,paused:false},take:{start:0,end:10,speed:1},
    monitor:{position:()=>0,sync:()=>new Promise((_,fail)=>{reject=fail;}),pause(){},dispose(){}},onError:()=>errors++},
    {requestAnimationFrame:()=>1,cancelAnimationFrame(){}});
  const pending=follower.sync();follower.dispose();reject(Error('stale'));await pending;
  assert.equal(errors,0);
});

test('a failed audio context resume clears monitor load handlers, timer, URL and context',async()=>{
  const timers=new Map();let music,closed=0,revoked=0;
  class AudioContext{destination={};createMediaElementSource(){return {connect(){}};}createGain(){return {connect(){},gain:{value:1}};}async resume(){throw Error('audio device unavailable');}async close(){closed++;}}
  class Audio{constructor(){music=this;}load(){}pause(){}removeAttribute(){}}
  await assert.rejects(createMonitor({blob:new Blob(),video:{currentTime:0},start:0,speed:1},{AudioContext,Audio,URL:{createObjectURL:()=> 'blob:failed',revokeObjectURL(){revoked++;}},setTimeout(fn){timers.set(1,fn);return 1;},clearTimeout(id){timers.delete(id);}}),/audio device/);
  assert.equal(timers.size,0);assert.equal(music.oncanplay,null);assert.equal(music.onerror,null);assert.equal(closed,1);assert.equal(revoked,1);
});

test('failed replay audio startup does not reroute the element away from HTML audio fallback',async()=>{
  let attached=0,closed=0;
  class AudioContext{async resume(){throw Error('device unavailable');}createMediaElementSource(){attached++;}async close(){closed++;}}
  await assert.rejects(require('../extension/karaoke.js').createAudioOutput({},1,{AudioContext}),/device unavailable/);
  assert.equal(attached,0);assert.equal(closed,1);
});

test('model management relay allows only fixed models and endpoints',async()=>{
  const calls=[];
  const fetcher=async(url,options)=>{calls.push({url,options});return {ok:true,json:async()=>({models:[]})};};
  await request({action:'models'},sender,fetcher);
  await request({action:'model-install',model:'bandit-v2-multi'},sender,fetcher);
  await request({action:'model-cancel',model:'bandit-v2-multi'},sender,fetcher);
  await request({action:'model-remove',model:'demucs-htdemucs'},sender,fetcher);
  assert.deepEqual(calls.map(c=>c.url),['/models','/models/bandit-v2-multi/install','/models/bandit-v2-multi/cancel','/models/demucs-htdemucs/remove'].map(p=>'http://127.0.0.1:8765'+p));
  assert.equal(calls[1].options.method,'POST');
  await assert.rejects(request({action:'model-install',model:'../../arbitrary'},sender,fetcher),/不支持/);
  await request({action:'start',videoId:'jNQXAC9IVRw',start:0,end:5,model:'bandit-v2-multi'},sender,fetcher);
  assert.equal(JSON.parse(calls.at(-1).options.body).model,'bandit-v2-multi');
});

test('lossless identity is separate while recordings retain their original backing quality',()=>{
  const {qualityOf,key,covers,backingForTake}=require('../extension/karaoke.js');
  const standard={videoId:'video',start:0,end:5,key:'video:0.000:5.000'},lossless={...standard,quality:'lossless',key:'video:0.000:5.000:lossless'};
  assert.equal(qualityOf(standard),'standard');assert.notEqual(key('video',standard),key('video',lossless));
  assert.equal(covers(standard,'video',lossless),false);
  assert.equal(backingForTake([standard,lossless],{start:0,end:5,backingKey:lossless.key,backingQuality:'lossless'},'video'),lossless);
  assert.equal(backingForTake([lossless],{start:0,end:5},'video'),null);
});

test('lossless transfer assembles bounded chunks and rejects inconsistent or cancelled downloads',async()=>{
  const {fetchAudio}=require('../extension/karaoke.js');
  const size=1024*1024,total=size+17,offsets=[];
  const request=async(action,{offset})=>{assert.equal(action,'audio-chunk');offsets.push(offset);return {audio:Buffer.alloc(offset?17:size,offset?2:1).toString('base64'),offset,totalBytes:total,mime:'audio/flac'};};
  const result=await fetchAudio(request,{jobId:id});
  assert.deepEqual(offsets,[0,size]);assert.equal(result.blob.size,total);assert.equal(result.blob.type,'audio/flac');
  const bytes=new Uint8Array(await result.blob.arrayBuffer());assert.equal(bytes[size-1],1);assert.equal(bytes[size],2);
  await assert.rejects(fetchAudio(async()=>({audio:'YQ==',offset:5,totalBytes:1,mime:'audio/flac'}),{jobId:id}),/分块无效/);
  let active=true;
  await assert.rejects(fetchAudio(async()=>{active=false;return {};},{jobId:id,active:()=>active}),/已取消/);
});

test('audio chunk relay requests bounded HTTP ranges and validates server ranges',async()=>{
  const headers=new Map([['Content-Length','3'],['Content-Type','audio/flac'],['Content-Range','bytes 10-12/13']]);
  const fetcher=async(url,options)=>{assert.equal(url,`http://127.0.0.1:8765/jobs/${id}/audio`);assert.equal(options.headers.Range,'bytes=10-1048585');return {ok:true,status:206,headers,arrayBuffer:async()=>new Uint8Array([1,2,3]).buffer};};
  const result=await request({action:'audio-chunk',jobId:id,offset:10},sender,fetcher);
  assert.equal(result.offset,10);assert.equal(result.totalBytes,13);assert.equal(result.mime,'audio/flac');
  await assert.rejects(request({action:'audio-chunk',jobId:id,offset:-1},sender,fetcher),/无效/);
  headers.set('Content-Range','bytes 0-2/13');
  await assert.rejects(request({action:'audio-chunk',jobId:id,offset:10},sender,fetcher),/分块响应无效/);
});

test('lossless cache lookup opts in without changing the legacy standard endpoint',async()=>{
  const urls=[];const fetcher=async url=>{urls.push(url);return {ok:true,json:async()=>({backings:[]})};};
  await request({action:'cached',videoId:'jNQXAC9IVRw'},sender,fetcher);
  await request({action:'cached',videoId:'jNQXAC9IVRw',quality:'lossless'},sender,fetcher);
  assert.deepEqual(urls,['http://127.0.0.1:8765/backings/jNQXAC9IVRw','http://127.0.0.1:8765/backings/jNQXAC9IVRw?quality=lossless']);
  await assert.rejects(request({action:'cached',videoId:'jNQXAC9IVRw',quality:'unknown'},sender,fetcher),/不支持/);
});

test('generation ranges are independent, bounded and reject invalid or overlong requests',()=>{
  const {generationRange}=require('../extension/karaoke.js'),current={start:20,end:35,speed:0.8};
  assert.deepEqual(generationRange({scope:'current',current,duration:300}),current);
  assert.deepEqual(generationRange({scope:'whole',current,duration:300}),{start:0,end:300,speed:1});
  assert.deepEqual(generationRange({scope:'custom',current,duration:900,start:100,end:700}),{start:100,end:700,speed:1});
  assert.deepEqual(current,{start:20,end:35,speed:0.8});
  for(const [start,end] of [[-1,5],[10,5],[0,NaN],[0,901],[0,601]])assert.throws(()=>generationRange({scope:'custom',duration:900,start,end}));
  assert.throws(()=>generationRange({scope:'whole',duration:601}),/10 分钟/);
  assert.throws(()=>generationRange({scope:'whole',duration:Infinity}),/有效/);
});

test('generation uses the custom paragraph instead of the current recording range and applies the shared limits',()=>{
  const {generationRange}=require('../extension/karaoke.js');
  assert.deepEqual(generationRange({scope:'paragraph',current:{start:0,end:5,speed:1},paragraph:{start:20,end:50,speed:1},duration:900}),{start:20,end:50,speed:1});
  assert.throws(()=>generationRange({scope:'paragraph',paragraph:{start:0,end:601,speed:1},duration:900}),/10 分钟/);
  assert.throws(()=>generationRange({scope:'paragraph',duration:900}),/有效/);
});


test('lead-in output follows live monitoring gain, clamps video volume and restores it',()=>{
  const {createLeadInOutput}=require('../extension/karaoke.js');
  const video={volume:.3,currentTime:2};
  const output=createLeadInOutput(video,{volume:.6,end:10});
  assert.equal(video.volume,.6);output.setVolume(.2);assert.equal(video.volume,.2);
  output.setVolume(2);assert.equal(video.volume,1);
  output.setVolume(0);assert.equal(video.volume,0);
  output.dispose();assert.equal(video.volume,.3);
  output.setVolume(.8);assert.equal(video.volume,.3);
});

test('relay forwards the original-source flag only for the current validated video',async()=>{
  await request({action:'start',videoId:'jNQXAC9IVRw',start:0,end:20,source:'original',quality:'lossless'},sender,async(_,options)=>{
    assert.equal(JSON.parse(options.body).source,'original');assert.equal(JSON.parse(options.body).quality,'lossless');
    return {ok:true,json:async()=>({id,state:'queued'})};
  });
  await assert.rejects(request({action:'start',videoId:'jNQXAC9IVRw',start:0,end:20,source:'url'},sender,()=>{throw Error('must not fetch');}),/音源类型/);
});
