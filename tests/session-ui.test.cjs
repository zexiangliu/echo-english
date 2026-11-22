const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const {IDBFactory}=require('fake-indexeddb');
const {createStorage,cueKey}=require('../extension/storage.js');

// Lightweight content-script DOM harness: run actual UI handlers against a real
// IndexedDB implementation, without requesting microphone or YouTube access.
async function waitUntil(predicate, message='condition did not become ready') {
  const deadline=Date.now()+1000;
  while(!predicate()) {if(Date.now()>deadline)throw Error(message);await new Promise(resolve=>setTimeout(resolve,1));}
}
async function mount(storage, overrides = {}) {
  const nodes=new Map(),created=[],downloads=[];
  class Element {
    constructor(){this.children=[];this.hidden=false;this.value='';this.style={};this.attrs={};this.dataset={};this.classList={toggle:()=>{}};created.push(this);}
    set innerHTML(html){this.html=html;for(const match of html.matchAll(/\bid="([^"]+)"/g))nodes.set(match[1],new Element());
      nodes.get('followCaptions').checked=true;
      for(const [id,value] of Object.entries({start:'0',end:'5',speed:'1',loopCount:'3',prepSeconds:'3',backingVolume:'1',practiceScope:'clip',assemblyType:'vocal',activityMode:'speech',contentLanguage:'auto',captionLayout:'original'}))nodes.get(id).value=value;}
    get innerHTML(){return this.html;}
    addEventListener(type,fn){(this.listeners ||= new Map()).set(type,fn);}
    removeEventListener(type,fn){if(this.listeners?.get(type)===fn)this.listeners.delete(type);}
    dispatchEvent(event){this['on'+event.type]?.(event);this.listeners?.get(event.type)?.(event);}
    setAttribute(k,v){this.attrs[k]=v;} getAttribute(k){return this.attrs[k];} removeAttribute(k){delete this.attrs[k];if(k==='value')this.value=0;}
    append(...children){this.children.push(...children);} replaceChildren(...children){this.children=children;}
    attachShadow(){return root;} focus(){} getContext(){return {clearRect(){},fillRect(){},beginPath(){},moveTo(){},lineTo(){},stroke(){}};}
    click(){if(this.download)downloads.push(this);return this.onclick?.();}
    remove(){}
  }
  const root=new Element();root.getElementById=id=>nodes.get(id);
  root.addEventListener=(name,fn)=>{root['on'+name]=fn;};
  root.querySelector=()=>({scrollTop:0});root.querySelectorAll=selector=>created.filter(n=>n.className===selector.slice(1));
  const events=new Map();
  const doc={getElementById:()=>null,documentElement:new Element(),createElement:()=>new Element(),createTextNode:text=>({textContent:text}),addEventListener(name,fn){events.set(name,fn);},querySelector:selector=>selector==='video.html5-main-video'?(overrides.video || {duration:60}):null};
  doc.title=overrides.title || '';
  const context={document:doc,location:{href:'https://www.youtube.com/watch?v=video',pathname:'/watch'},indexedDB:{},URL,Blob,console,setTimeout,clearTimeout,cancelAnimationFrame(){},requestAnimationFrame(){},crypto:globalThis.crypto,
    window:{addEventListener(){},speechSynthesis:{cancel(){}}},chrome:{runtime:{onMessage:{addListener(){}}}},
    EchoSubtitleEditor:require('../extension/subtitle-editor.js'),EchoSubtitleEditorView:require('../extension/subtitle-editor-view.js'),EchoSettingsDialog:require('../extension/settings-dialog.js'),EchoPracticeTools:require('../extension/practice-tools.js'),EchoCaptionTracks:require('../extension/caption-tracks.js'),EchoPanelView:require('../extension/panel-view.js'),EchoTransport:require('../extension/transport.js'),EchoPlayback:require('../extension/playback.js'),EchoPlaybackControls:require('../extension/playback-controls.js'),EchoReferencePlayback:require('../extension/reference-playback.js'),
    EchoOriginalAudio:require('../extension/original-audio.js'),EchoBackingPitch:require('../extension/backing-pitch.js'),EchoVocalEffects:require('../extension/vocal-effects.js'),EchoAudioExport:require('../extension/audio-export.js'),EchoAssembly:require('../extension/assembly.js'),EchoPanelSize:require('../extension/panel-size.js'),EchoLanguages:require('../extension/languages.js'),EchoKaraoke:require('../extension/karaoke.js'),EchoStorage:{...require('../extension/storage.js'),createStorage:()=>storage},EchoSelection:require('../extension/selection.js'),EchoPractice:require('../extension/practice.js'),EchoDictionary:require('../extension/dictionary.js'),EchoSubtitles:require('../extension/subtitles.js'),EchoLibrary:require('../extension/library.js'),EchoModels:require('../extension/models.js'),EchoLiveMeter:require('../extension/live-meter.js'),EchoRecording:require('../extension/recording.js'),EchoMicrophone:require('../extension/microphone.js'),EchoAudioAnalysis:require('../extension/audio-analysis.js')};
  Object.assign(context,overrides.globals || {});
  if(!overrides.globals?.EchoVocalEffects?.createPlayer)context.EchoVocalEffects={...context.EchoVocalEffects,async createPlayer(take){return new context.Audio(take.url);}};
  // Existing UI fixtures provide a caption transport; integration fixtures can
  // pass the real page-context client to verify fetch rather than messaging.
  if(!overrides.globals?.EchoCaptionTracks?.createClient)context.EchoCaptionTracks={...context.EchoCaptionTracks,createClient:()=>({request:message=>context.chrome.runtime.sendMessage?.({...message,type:'echo-captions'})})};
  for (const name of ['EchoTransport','EchoPlayback']) {
    const api=context[name];
    context[name]={...api,create:options=>api.create({...options,env:context})};
  }
  const karaoke=context.EchoKaraoke;
  context.EchoKaraoke={...karaoke,followRecording:options=>karaoke.followRecording(options,context)};
  if(context.chrome.runtime.sendMessage){
    const send=context.chrome.runtime.sendMessage;
    context.chrome.runtime.sendMessage=message=>message.action==='health'?Promise.resolve(overrides.health ? overrides.health() : {service:'echo-karaoke',version:1,maxSeconds:600}):message.action==='cached'?Promise.resolve(overrides.cachedBackings || {backings:[]}):send(message);
  }
  vm.runInNewContext(fs.readFileSync('extension/content.js','utf8'),context);
  for(let i=0;i<20 && nodes.get('read').disabled;i++)await new Promise(r=>setTimeout(r,2));
  return {nodes,root,events,downloads,document:doc};
}
test('raw recording downloads use the video title and refresh it when YouTube loads it late',async()=>{
  const storage=createStorage(new IDBFactory());
  await storage.saveTake({id:'voice',videoId:'video',cueKey:'manual:5:10',start:5,end:10,speed:1,createdAt:1,blob:new Blob(['voice'])});
  const {nodes,document}=await mount(storage,{title:'原视频标题 - YouTube'});
  nodes.get('tab-recordings').onclick();
  const link=nodes.get('download'),url=link.href;
  assert.equal(link.download,'原视频标题_00m05.0s-00m10.0s_配音.webm');
  document.title='正式标题: 中文字幕 - YouTube';link.onclick();
  assert.equal(link.download,'正式标题 中文字幕_00m05.0s-00m10.0s_配音.webm');
  assert.equal(link.href,url);
  (await storage.ready).close();
});

test('movie background is opt-in, keeps separate activity preferences and restores across refresh',async()=>{
  const storage=createStorage(new IDBFactory());let checks=0;
  const health=()=>{checks++;return {service:'echo-karaoke',maxSeconds:600};};
  const globals={chrome:{runtime:{onMessage:{addListener(){}},async sendMessage(){return {};}}}};
  const {nodes}=await mount(storage,{health,globals});
  assert.equal(nodes.get('recordingPlayback').value,'silent');assert.equal(checks,0);

  assert.match(nodes.get('recordingBackingOption').textContent,/背景音/);
  nodes.get('recordingPlayback').value='backing';nodes.get('recordingPlayback').onchange();

  assert.match(nodes.get('backingSummary').textContent,/未准备|可选/);
  assert.equal(nodes.get('prepareBacking').textContent,'提取片段背景音');
  nodes.get('activityMode').value='sing';nodes.get('activityMode').onchange();
  assert.equal(nodes.get('recordingPlayback').value,'backing');
  nodes.get('recordingPlayback').value='silent';nodes.get('recordingPlayback').onchange();
  nodes.get('activityMode').value='speech';nodes.get('activityMode').onchange();
  assert.equal(nodes.get('recordingPlayback').value,'backing');
  await waitUntil(()=>checks>0);
  await new Promise(resolve=>setTimeout(resolve,5));
  const session=await storage.getSession('video');
  assert.deepEqual(session.backingPreferences,{speech:true,sing:false});
  const restored=await mount(storage,{health,globals});
  assert.equal(restored.nodes.get('recordingPlayback').value,'backing');
  restored.nodes.get('recordingPlayback').value='silent';restored.nodes.get('recordingPlayback').onchange();

  (await storage.ready).close();
});

test('turning movie background off discards an in-flight cache restore',async()=>{
  const storage=createStorage(new IDBFactory());let release;
  const {nodes}=await mount(storage,{cachedBackings:{backings:[{id:'a'.repeat(32),videoId:'video',start:0,end:60}]},
    globals:{chrome:{runtime:{onMessage:{addListener(){}},sendMessage(message){
      if(message.action==='audio')return new Promise(resolve=>{release=resolve;});
      throw Error('No generation expected');
    }}}}});
  nodes.get('recordingPlayback').value='backing';nodes.get('recordingPlayback').onchange();
  await waitUntil(()=>release);
  nodes.get('recordingPlayback').value='silent';nodes.get('recordingPlayback').onchange();
  release({audio:Buffer.from('background').toString('base64'),mime:'audio/mpeg'});
  await new Promise(resolve=>setTimeout(resolve,5));
  assert.equal((await storage.listBackings('video')).length,0);
  assert.equal(nodes.get('record').disabled,false);
  (await storage.ready).close();
});

for(const activity of ['sing','speech'])for(const cached of [false,true])test(`${activity} records dry vocals against original audio ${cached?'with':'without'} cached accompaniment`,async()=>{
  const storage=createStorage(new IDBFactory()),video=leadInVideo(),exports=[];let started=false,plays=0;
  video.volume=.65;
  const nativePlay=video.play;
  video.play=async function(){
    if(started){assert.equal(this.muted,false);assert.equal(this.volume,.65);plays++;}
    await nativePlay.call(this);if(started)this.currentTime=11;
  };
  await storage.saveSession({videoId:'video',activity,scopes:{sing:'clip',speech:'clip'},start:10,end:11,index:-1,cues:[],speed:'1',leadInMode:cached?'seconds':'none',leadInSeconds:3});
  if(cached)await storage.saveBacking({key:'separated',videoId:'video',start:0,end:60,createdAt:1,blob:new Blob(['separated music'])});
  const mic={getTracks:()=>[{stop(){}}]};
  class MediaRecorder{
    static isTypeSupported(){return true;}
    constructor(stream){assert.equal(stream,mic);this.state='inactive';this.mimeType='audio/webm';}
    start(){started=true;this.state='recording';}
    stop(){this.state='inactive';this.ondataavailable({data:new Blob(['dry vocal only'])});queueMicrotask(()=>this.onstop());}
  }
  const globals={MediaRecorder,navigator:{mediaDevices:{getUserMedia:async()=>mic}},
    EchoKaraoke:{...require('../extension/karaoke.js'),async createMonitor(){assert.fail('original reference must not play the separated backing');}},
    EchoAudioExport:{...require('../extension/audio-export.js'),async render(options){exports.push(options);return {blob:new Blob(['mixed']),gaps:[]};}},
    requestAnimationFrame:fn=>setTimeout(fn,1),cancelAnimationFrame:clearTimeout,setTimeout:(fn,ms)=>setTimeout(fn,ms===30000?0:ms)};
  const {nodes}=await mount(storage,{video,globals});
  nodes.get('recordingPlayback').value='original';nodes.get('recordingPlayback').onchange();
  assert.match(nodes.get('recordingPlaybackHint').textContent,/无需先生成伴奏/);
  await nodes.get('record').onclick();assert.equal(plays,1);
  const [take]=await storage.listTakes('video');
  assert.equal(take.capture,'vocal');assert.equal(take.withBacking,undefined);assert.equal(await take.blob.text(),'dry vocal only');
  assert.equal(take.backingKey,cached?'separated':undefined);
  assert.equal(take.referenceSource,'original');assert.equal(require('../extension/karaoke.js').canReplayBacking(take),true);
  if(!cached)await storage.saveBacking({key:'separated',videoId:'video',start:0,end:60,createdAt:2,blob:new Blob(['later separated music'])});
  assert.equal(require('../extension/karaoke.js').backingForTake(await storage.listBackings('video'),take,'video').key,'separated');
  const session=await storage.getSession('video');assert.equal(session.recordingPlaybackPreferences[activity],'original');
  const restored=await mount(storage,{video,globals});assert.equal(restored.nodes.get('recordingPlayback').value,'original');
  await restored.nodes.get('takeMixDownload').onclick();
  assert.equal(exports[0].backing.key,'separated');assert.equal(await exports[0].takes[0].blob.text(),'dry vocal only');
  if(activity==='sing'){
    restored.nodes.get('assemblyType').value='mixed';
    await restored.nodes.get('assembleSong').onclick();await restored.nodes.get('assemblyDownload').onclick();
    assert.equal(exports[1].backing.key,'separated');assert.equal(await exports[1].takes[0].blob.text(),'dry vocal only');
    restored.nodes.get('closeAssembly').onclick();
  }
  (await storage.ready).close();
});

test('movie dubbing monitors cached background but records dry speech and uses shared mixed export',async()=>{
  const storage=createStorage(new IDBFactory()),listeners=new Map();let time=0,monitors=0,exported,monitorOptions;
  await storage.saveBacking({key:'background',videoId:'video',start:0,end:60,createdAt:1,blob:new Blob(['music'])});
  const mic={getTracks:()=>[{stop(){}}]};
  const video={duration:60,muted:false,playbackRate:1,pause(){},get currentTime(){return time;},set currentTime(v){time=v;},
    addEventListener(name,fn){listeners.set(name,fn);},removeEventListener(name){listeners.delete(name);},async play(){time=5;}};
  class MediaRecorder{
    static isTypeSupported(){return true;}
    constructor(source){assert.equal(source,mic);this.state='inactive';this.mimeType='audio/webm';}
    start(){this.state='recording';}stop(){this.state='inactive';this.ondataavailable({data:new Blob(['dry movie voice'])});queueMicrotask(()=>this.onstop());}
  }
  const {nodes,downloads}=await mount(storage,{title:'电影片段 - YouTube',video,globals:{MediaRecorder,
    navigator:{mediaDevices:{getUserMedia:async({audio})=>{assert.equal(audio.echoCancellation,true);assert.equal(audio.autoGainControl,true);return mic;}}},
    EchoKaraoke:{...require('../extension/karaoke.js'),async createMonitor(options){monitors++;monitorOptions=options;return {sync:async()=>{},pause(){},dispose(){},setVolume(){}};}},
    EchoAudioExport:{...require('../extension/audio-export.js'),async render(options){exported=options;return {blob:new Blob(['mixed']),gaps:[]};}},
    requestAnimationFrame:fn=>setTimeout(fn,0),cancelAnimationFrame:clearTimeout,setTimeout:(fn,ms)=>setTimeout(fn,ms===30000?0:ms)}});
  nodes.get('recordingPlayback').value='backing';nodes.get('recordingPlayback').onchange();
  nodes.get('backingPitch').value='3';nodes.get('backingPitch').oninput();
  await nodes.get('record').onclick();
  await waitUntil(()=>nodes.get('record').disabled===false);
  const [take]=await storage.listTakes('video');
  assert.equal(await take.blob.text(),'dry movie voice');assert.equal(monitors,1);assert.equal(monitorOptions.pitchSemitones,3);assert.equal(take.backingPitch,3);
  assert.equal(take.kind,undefined);assert.equal(take.backingKey,'background');
  assert.equal(take.backingModel,'demucs-htdemucs');assert.equal(take.withBacking,undefined);
  assert.equal(nodes.get('takeMixDownload').hidden,false);assert.match(nodes.get('takeMixDownload').textContent,/背景音/);
  nodes.get('replayVocalVolume').value='1.4';nodes.get('replayBackingVolume').value='0.3';
  nodes.get('backingPitchReset').onclick();
  await nodes.get('takeMixDownload').onclick();
  assert.equal(exported.takes[0].id,take.id);assert.equal(exported.takes[0].backingPitch,3);assert.equal(exported.backing.key,'background');
  assert.equal(exported.vocalVolume,1.4);assert.equal(exported.volume,0.3);
  assert.match(downloads[0].download,/电影片段.*人声\+背景音.wav$/);
  assert.equal(nodes.get('songAssembly').hidden,false);assert.equal(nodes.get('assembleSong').textContent,'合成配音');
  nodes.get('recordingPlayback').value='silent';nodes.get('recordingPlayback').onchange();
  nodes.get('reuseSongRange').onclick();
  assert.equal(nodes.get('recordingPlayback').value,'silent');
  (await storage.ready).close();
});

test('empty pages hide irrelevant recording controls and keep the practice dock on the practice tab',async()=>{
  const storage=createStorage(new IDBFactory());
  const {nodes}=await mount(storage);
  assert.equal(nodes.get('practiceDock').hidden,false);
  assert.equal(nodes.get('captionSetup').hidden,false);
  assert.equal(nodes.get('captionOptions').hidden,true);assert.equal(nodes.get('clipCue').disabled,true);
  assert.notEqual(nodes.get('settingsDialog').open,true);
  nodes.get('tab-recordings').onclick();
  assert.equal(nodes.get('practiceDock').hidden,true);
  assert.equal(nodes.get('recordingEmpty').hidden,false);
  assert.equal(nodes.get('historyBrowser').hidden,true);
  assert.equal(nodes.get('recordingDetails').hidden,true);
  assert.equal(nodes.get('playAll').hidden,true);
  nodes.get('backToPractice').onclick();assert.equal(nodes.get('practiceDock').hidden,false);
  nodes.get('openLanguageSettings').onclick();assert.equal(nodes.get('page-practice').hidden,false);assert.equal(nodes.get('settingsDialog').open,true);assert.equal(nodes.get('settings-captions').hidden,false);
  (await storage.ready).close();
});

test('recording details can return a spoken take to practice with its recorded range and speed',async()=>{
  const storage=createStorage(new IDBFactory());
  await storage.saveTake({id:'spoken',videoId:'video',cueKey:'manual:10:15',start:10,end:15,speed:0.75,createdAt:1,blob:new Blob(['voice'])});
  const {nodes}=await mount(storage);
  nodes.get('tab-recordings').onclick();assert.equal(nodes.get('reuseSongRange').hidden,false);
  nodes.get('reuseSongRange').onclick();
  assert.equal(nodes.get('page-practice').hidden,false);assert.equal(nodes.get('practiceDock').hidden,false);
  assert.equal(nodes.get('start').value,10);assert.equal(nodes.get('end').value,15);
  assert.equal(nodes.get('speed').value,'0.75');assert.equal(nodes.get('activityMode').value,'speech');
  (await storage.ready).close();
});

test('unsupported song assembly explains the reason before the user clicks',async()=>{
  const storage=createStorage(new IDBFactory());
  await storage.saveTake({id:'slow',videoId:'video',kind:'song',capture:'vocal',cueKey:'song:manual',start:0,end:5,speed:0.75,createdAt:1,blob:new Blob(['voice'])});
  const {nodes}=await mount(storage);
  assert.equal(nodes.get('songAssembly').hidden,false);
  assert.equal(nodes.get('assembleSong').disabled,true);
  assert.match(nodes.get('assembleSong').title,/1×/);
  (await storage.ready).close();
});

test('Escape stops playback, restores idle actions and clears the playing status',async()=>{
  const storage=createStorage(new IDBFactory());
  const video={duration:60,currentTime:0,muted:false,playbackRate:1,pause(){},async play(){},addEventListener(){},removeEventListener(){}};
  const {nodes,root}=await mount(storage,{video});
  let stopFocused=false;
  root.activeElement=nodes.get('original');nodes.get('stop').id='stop';
  nodes.get('stop').focus=()=>{stopFocused=true;root.activeElement=nodes.get('stop');};
  const playing=nodes.get('original').onclick();
  for(let i=0;i<10 && !nodes.get('transportProgress').oninput;i++)await Promise.resolve();
  assert.equal(nodes.get('practiceDock').hidden,true);
  assert.equal(stopFocused,true);
  root.onkeydown({key:'Escape',preventDefault(){},stopPropagation(){}});
  await playing;
  assert.equal(nodes.get('practiceDock').hidden,false);
  assert.equal(nodes.get('transport').hidden,true);assert.equal(nodes.get('status').textContent,'已停止。');
  (await storage.ready).close();
});

test('singing detects offline service and retry collapses setup help after connection',async()=>{
  const storage=createStorage(new IDBFactory());let online=false,checks=0,starts=0;
  const {nodes}=await mount(storage,{health:()=>{checks++;return online?{service:'echo-karaoke',maxSeconds:600,device:'cuda',deviceName:'Test GPU'}:{error:'offline'};},globals:{chrome:{runtime:{onMessage:{addListener(){}},async sendMessage(){starts++;return {};}}}}});
  assert.equal(checks,0);
  nodes.get('activityMode').value='sing';nodes.get('activityMode').onchange();
  await nodes.get('checkKaraoke').onclick();
  assert.match(nodes.get('karaokeService').textContent,/未连接/);assert.equal(nodes.get('karaokeHelp').open,true);
  assert.equal(starts,0);assert.equal(nodes.get('record').disabled,false);
  online=true;await nodes.get('checkKaraoke').onclick();
  assert.match(nodes.get('karaokeService').textContent,/已连接/);assert.equal(nodes.get('karaokeHelp').open,false);assert.equal(starts,0);
  assert.match(nodes.get('karaokeService').textContent,/GPU 加速/);assert.equal(nodes.get('karaokeService').title,'Test GPU');
  online=false;await nodes.get('checkKaraoke').onclick();assert.equal(nodes.get('karaokeService').title,'');
  (await storage.ready).close();
});
test('Apple MPS uses the existing GPU service indicator',async()=>{
  const storage=createStorage(new IDBFactory());
  const {nodes}=await mount(storage,{health:()=>({service:'echo-karaoke',maxSeconds:600,device:'mps',deviceName:'Apple GPU（MPS）'}),globals:{chrome:{runtime:{onMessage:{addListener(){}},async sendMessage(){return {};}}}}});
  nodes.get('activityMode').value='sing';nodes.get('activityMode').onchange();
  await nodes.get('checkKaraoke').onclick();
  assert.match(nodes.get('karaokeService').textContent,/GPU 加速/);
  assert.equal(nodes.get('karaokeService').title,'Apple GPU（MPS）');
  assert.equal(nodes.get('karaokeHelp').open,false);
  (await storage.ready).close();
});
test('offline generation shows setup next to the button even while cache lookup is pending',async()=>{
  const storage=createStorage(new IDBFactory());let starts=0;
  const {nodes}=await mount(storage,{health:()=>({error:'offline'}),cachedBackings:new Promise(()=>{}),globals:{chrome:{runtime:{onMessage:{addListener(){}},async sendMessage(){starts++;return {};}}}}});
  nodes.get('activityMode').value='sing';nodes.get('activityMode').onchange();
  await nodes.get('checkKaraoke').onclick();
  assert.equal(nodes.get('prepareBacking').disabled,false);
  await nodes.get('prepareBacking').onclick();
  assert.equal(starts,0);assert.equal(nodes.get('karaokeNotice').hidden,false);
  assert.match(nodes.get('karaokeNotice').textContent,/bash start-karaoke.sh/);
  assert.equal(nodes.get('karaokeHelp').open,true);
  nodes.get('speed').onchange();assert.equal(nodes.get('karaokeNotice').hidden,false);
  (await storage.ready).close();
});
test('content script restores selected sentence, boundaries, settings and matching take',async()=>{
  const storage=createStorage(new IDBFactory());
  const first={start:0,end:2,text:'First sentence'},second={start:2.2,end:5.4,text:'Second sentence',key:cueKey({start:2,text:'Second sentence'})};
  await storage.saveSession({videoId:'video',index:1,start:2.2,end:5.4,speed:'0.75',showChinese:true,hideText:false,replayVocalVolume:1.4,replayBackingVolume:0.35,replayWithBacking:false,cues:[first,second]});
  await storage.saveTake({id:'one',videoId:'video',cueKey:second.key,start:2,end:5,speed:1,createdAt:1,blob:new Blob(['audio']),label:'第 2 句'});
  const {nodes}=await mount(storage);
  assert.equal(nodes.get('replayVocalVolume').value,1.4);assert.equal(nodes.get('replayBackingVolume').value,0.35);assert.equal(nodes.get('replayWithBacking').checked,false);
  nodes.get('replayVocalVolume').value='1.6';await nodes.get('replayVocalVolume').onchange();
  assert.equal(nodes.get('position').textContent,'2 / 2');assert.equal(nodes.get('start').value,2.2);
  assert.equal(nodes.get('speed').value,'0.75');assert.equal(nodes.get('showChinese').checked,true);
  assert.equal(nodes.get('recordingContent').hidden,false);assert.match(nodes.get('historyInfo').textContent,/2.0–5.0/);
  await nodes.get('startLater').onclick();
  const saved=await storage.getSession('video');assert.equal(saved.start,2.4);assert.equal(saved.cues[1].key,second.key);
  assert.equal(saved.cues[1].start,2.2);assert.equal(saved.replayVocalVolume,1.6);assert.equal(saved.replayBackingVolume,0.35);assert.equal(saved.replayWithBacking,false);
  // Changing boundaries keeps the same sentence's recording available.
  assert.equal(nodes.get('replay').disabled,false);
  (await storage.ready).close();
});

test('plain recording pauses for buffering and saves to its original video after navigation',async()=>{
  const storage=createStorage(new IDBFactory()),listeners=new Map(),frames=new Map();let instance,stopped=0,frameId=0;
  const location={href:'https://www.youtube.com/watch?v=video',pathname:'/watch'};
  const video={duration:60,currentTime:0,muted:false,playbackRate:1,pause(){},async play(){},
    addEventListener(name,fn){listeners.set(name,fn);},removeEventListener(name){listeners.delete(name);}};
  class Recorder{
    static isTypeSupported(){return true;}
    constructor(){instance=this;this.state='inactive';this.mimeType='audio/webm';}
    start(){this.state='recording';}
    pause(){this.state='paused';}
    resume(){this.state='recording';}
    stop(){this.state='inactive';this.ondataavailable({data:new Blob(['recorded'])});setTimeout(()=>this.onstop(),0);}
  }
  const {nodes,events}=await mount(storage,{video,globals:{location,requestAnimationFrame(fn){frames.set(++frameId,fn);return frameId;},cancelAnimationFrame(id){frames.delete(id);},MediaRecorder:Recorder,navigator:{mediaDevices:{async getUserMedia(){return {getTracks:()=>[{stop(){stopped++;}}]};}}}}});
  const recording=nodes.get('record').onclick();
  for(let i=0;i<10 && instance?.state!=='recording';i++)await new Promise(r=>setTimeout(r,1));
  assert.equal(instance.state,'recording');
  assert.equal(nodes.get('activityMode').hidden,true);assert.equal(nodes.get('practiceDock').hidden,true);
  assert.equal(nodes.get('practiceDock').hidden,true);
  assert.equal(nodes.get('stop').textContent,'■ 结束录音');
  assert.equal(nodes.get('transport').hidden,false);
  assert.equal(nodes.get('transportTime').textContent,'0:00 / 0:05');assert.equal(nodes.get('liveMeter').hidden,false);
  assert.equal(nodes.get('transportProgress').disabled,true);
  assert.equal(nodes.get('transportProgress').oninput,null);
  video.currentTime=2;frames.values().next().value();
  assert.equal(nodes.get('transportProgress').value,0.4);
  assert.equal(nodes.get('transportTime').textContent,'0:02 / 0:05');
  listeners.get('waiting')();assert.equal(instance.state,'paused');
  listeners.get('playing')();await Promise.resolve();assert.equal(instance.state,'recording');
  nodes.get('hideText').checked=true;nodes.get('hideText').onchange();
  nodes.get('showChinese').checked=true;nodes.get('followCaptions').checked=false;
  location.href='https://www.youtube.com/watch?v=other';events.get('yt-navigate-finish')();
  await recording;
  assert.equal((await storage.listTakes('video')).length,1);assert.equal((await storage.listTakes('other')).length,0);
  assert.equal(stopped,1);assert.equal(nodes.get('recordingContent').hidden,true);assert.equal(nodes.get('liveMeter').hidden,true);
  assert.equal(nodes.get('transport').hidden,true);
  assert.equal(nodes.get('hideText').checked,false);assert.equal(nodes.get('showChinese').checked,false);
  assert.equal(nodes.get('followCaptions').checked,true);
  assert.equal(nodes.get('list').style.display,'');
  (await storage.ready).close();
});

test('an imported file cannot overwrite a new video after navigation',async()=>{
  const storage=createStorage(new IDBFactory());let complete;
  const location={href:'https://www.youtube.com/watch?v=video',pathname:'/watch'};
  const {nodes,events}=await mount(storage,{globals:{location}});
  nodes.get('file').files=[{size:20,text:()=>new Promise(resolve=>{complete=resolve;})}];
  const importing=nodes.get('file').onchange();assert.equal(nodes.get('record').disabled,true);
  location.href='https://www.youtube.com/watch?v=other';events.get('yt-navigate-finish')();
  complete('00:00 --> 00:01\nOld video');await importing;
  assert.equal(nodes.get('position').textContent,'手动片段');
  (await storage.ready).close();
});

test('waveform decoding starts only after opening recording details',async()=>{
  const storage=createStorage(new IDBFactory());let decodes=0;
  await storage.saveTake({id:'one',videoId:'video',cueKey:'manual:0.00:5.00',start:0,end:5,speed:1,createdAt:1,blob:new Blob(['audio'])});
  class AudioContext{constructor(){decodes++;throw Error('no decoder in fixture');}}
  const {nodes}=await mount(storage,{globals:{AudioContext}});
  assert.equal(decodes,0);nodes.get('openRecordingAdjust').onclick();nodes.get('recordingDetails').open=true;nodes.get('recordingDetails').ontoggle();
  assert.equal(decodes,1);assert.match(nodes.get('analysisText').textContent,/仍可回放或下载/);
  (await storage.ready).close();
});

test('legacy service warns about restart before submitting a long song',async()=>{
  const storage=createStorage(new IDBFactory());let starts=0;
  const {nodes}=await mount(storage,{video:{duration:500},health:()=>({service:'echo-karaoke',version:1}),globals:{chrome:{runtime:{onMessage:{addListener(){}},async sendMessage(){starts++;return {};}}}}});
  nodes.get('activityMode').value='sing';nodes.get('activityMode').onchange();await nodes.get('checkKaraoke').onclick();
  assert.match(nodes.get('karaokeService').textContent,/旧版/);await nodes.get('prepareBacking').onclick();
  assert.equal(starts,0);assert.match(nodes.get('karaokeNotice').textContent,/Ctrl\+C/);
  (await storage.ready).close();
});

test('song mode exposes main recording and guides missing accompaniment without requesting a microphone',async()=>{
  const storage=createStorage(new IDBFactory());let micRequests=0;
  const {nodes}=await mount(storage,{globals:{navigator:{mediaDevices:{async getUserMedia(){micRequests++;throw Error('unexpected');}}}}});
  assert.equal(nodes.get('scopeControls').hidden,false);assert.equal(nodes.get('practiceDock').hidden,false);
  nodes.get('activityMode').value='sing';nodes.get('activityMode').onchange();
  assert.equal(nodes.get('scopeControls').hidden,false);assert.equal(nodes.get('practiceDock').hidden,false);
  assert.notEqual(nodes.get('settingsDialog').open,true);assert.equal(nodes.get('practiceToolsSummary').hidden,false);
  assert.equal(nodes.get('record').disabled,false);
  await nodes.get('record').onclick();assert.equal(micRequests,0);assert.equal(nodes.get('settingsDialog').open,true);assert.equal(nodes.get('settings-backing').hidden,false);
  nodes.get('activityMode').value='speech';nodes.get('activityMode').onchange();
  assert.equal(nodes.get('scopeControls').hidden,false);
  assert.equal(nodes.get('practiceDock').hidden,false);assert.equal(nodes.get('practiceToolsSummary').hidden,false);
  (await storage.ready).close();
});

test('volume remains adjustable during accompaniment preview and saves the chosen gain',async()=>{
  const storage=createStorage(new IDBFactory());let gain=1,sound;
  await storage.saveBacking({key:'music',videoId:'video',start:0,end:60,createdAt:1,blob:new Blob(['audio'])});
  const listeners=new Map();let time=0;
  const video={duration:60,get currentTime(){return time;},set currentTime(value){time=value;queueMicrotask(()=>listeners.get('seeked')?.());},muted:false,playbackRate:1,pause(){},async play(){},addEventListener(name,fn){listeners.set(name,fn);},removeEventListener(name,fn){if(listeners.get(name)===fn)listeners.delete(name);}};
  class Audio{constructor(){sound=this;this.paused=true;}pause(){this.paused=true;}async play(){this.paused=false;}}
  const {nodes}=await mount(storage,{video,globals:{Audio,EchoKaraoke:{...require('../extension/karaoke.js'),async createBackingOutput(){return {setVolume(value){gain=value;},dispose(){}};}}}});
  nodes.get('activityMode').value='sing';nodes.get('activityMode').onchange();
  nodes.get('backingSettings').onclick();assert.equal(nodes.get('settingsDialog').open,true);
  nodes.get('generationScope').value='custom';nodes.get('generationStart').value='10';nodes.get('generationEnd').value='50';nodes.get('generationScope').onchange();
  const playing=nodes.get('previewBacking').onclick();
  for(let i=0;i<30 && !nodes.get('transportProgress').oninput;i++)await new Promise(r=>setTimeout(r,1));
  assert.equal(video.currentTime,10);assert.equal(sound.currentTime,10);
  assert.equal(nodes.get('playbackSpeedControl').hidden,false);
  nodes.get('playbackSpeed').value='1.25';nodes.get('playbackSpeed').onchange();
  assert.equal(video.playbackRate,1.25);assert.equal(sound.playbackRate,1.25);
  await nodes.get('pausePlayback').onclick();assert.equal(sound.paused,true);
  listeners.get('playing')();assert.equal(sound.paused,true);
  await nodes.get('pausePlayback').onclick();assert.equal(sound.paused,false);
  assert.equal(nodes.get('settings-backing').hidden,false);
  assert.equal(nodes.get('backingVolume').disabled,false);
  nodes.get('backingVolume').value='1.5';nodes.get('backingVolume').oninput();
  assert.equal(gain,1.5);assert.equal(nodes.get('backingVolumeValue').textContent,'150%');
  for(let i=0;i<20 && !nodes.get('transportProgress').oninput;i++)await Promise.resolve();
  nodes.get('transportProgress').value='0.5';await nodes.get('transportProgress').oninput();
  assert.equal(video.currentTime,30);assert.equal(sound.currentTime,30);
  nodes.get('backingVolume').onchange();assert.equal(nodes.get('settingsStop').hidden,false);nodes.get('settingsStop').onclick();await playing;assert.equal(nodes.get('settingsDialog').open,true);
  const session=await storage.getSession('video');assert.equal(session.backingVolume,1.5);
  (await storage.ready).close();
});

test('original playback slider seeks within the selected range at reduced speed',async()=>{
  const storage=createStorage(new IDBFactory());
  const video={duration:60,currentTime:0,muted:false,playbackRate:1,paused:true,pause(){this.paused=true;},async play(){this.paused=false;},addEventListener(){},removeEventListener(){}};
  const {nodes}=await mount(storage,{video});
  nodes.get('speed').value='0.5';
  const playing=nodes.get('original').onclick();
  for(let i=0;i<10 && !nodes.get('transportProgress').oninput;i++)await Promise.resolve();
  const slider=nodes.get('transportProgress');
  assert.equal(slider.disabled,false);assert.equal(nodes.get('transportTime').textContent,'0:00 / 0:10');
  assert.equal(nodes.get('playbackSpeedControl').hidden,false);
  nodes.get('playbackSpeed').value='0.75';nodes.get('playbackSpeed').onchange();
  assert.equal(video.playbackRate,0.75);assert.equal(nodes.get('speed').value,'0.75');
  nodes.get('playbackSpeed').value='1';nodes.get('playbackSpeed').onchange();
  await nodes.get('pausePlayback').onclick();assert.equal(video.paused,true);
  nodes.get('playbackSpeed').value='1.25';nodes.get('playbackSpeed').onchange();
  assert.equal(video.paused,true);assert.equal(video.playbackRate,1.25);
  nodes.get('playbackSpeed').value='1';nodes.get('playbackSpeed').onchange();
  slider.value='0.75';await slider.oninput();assert.equal(video.currentTime,3.75);
  assert.equal(video.paused,true);
  await nodes.get('pausePlayback').onclick();assert.equal(video.paused,false);assert.equal(video.currentTime,3.75);
  slider.value='0.25';await slider.oninput();assert.equal(video.currentTime,1.25);
  await nodes.get('pausePlayback').onclick();assert.equal(video.paused,true);
  nodes.get('stop').onclick();await playing;assert.equal(slider.oninput,null);
  assert.equal(nodes.get('pausePlayback').hidden,true);
  assert.equal(nodes.get('playbackSpeedControl').hidden,true);
  (await storage.ready).close();
});

test('recording mix controls appear for saved playback but not original listening or its comparison phase',async()=>{
  const storage=createStorage(new IDBFactory());
  await storage.saveTake({id:'voice',videoId:'video',cueKey:'manual:0:5',start:0,end:5,speed:1,createdAt:1,blob:new Blob(['voice'])});
  const video={duration:60,currentTime:0,paused:true,pause(){this.paused=true;},async play(){this.paused=false;},addEventListener(){},removeEventListener(){}};
  class Audio{constructor(){this.currentTime=0;this.duration=5;}pause(){}async play(){}}
  const {nodes}=await mount(storage,{video,globals:{Audio}});
  nodes.get('tab-recordings').onclick();
  assert.equal(nodes.get('mixControls').hidden,false);
  for(const action of ['original','reviewReplay']){
    if(action==='reviewReplay'){nodes.get('reviewReplayMode').value='sequential';nodes.get('reviewReplayMode').onchange();}
    const playing=nodes.get(action).onclick();await waitUntil(()=>!!nodes.get('transportProgress').oninput);
    assert.equal(nodes.get('mixControls').hidden,true);
    nodes.get('stop').onclick();await playing;
    assert.equal(nodes.get('mixControls').hidden,false);
  }
  nodes.get('practiceReplayMode').value='recording';nodes.get('practiceReplayMode').onchange();
  const replaying=nodes.get('replay').onclick();await waitUntil(()=>!!nodes.get('transportProgress').oninput);
  assert.equal(nodes.get('mixControls').hidden,false);
  nodes.get('stop').onclick();await replaying;
  (await storage.ready).close();
});

test('dependent practice settings appear only for the selected language, scope and monitoring state',async()=>{
  const storage=createStorage(new IDBFactory()),{nodes}=await mount(storage);
  for(const scope of ['whole','paragraph','clip']){
    nodes.get('practiceScope').value=scope;nodes.get('practiceScope').onchange();
    assert.equal(nodes.get('autoNextOption').hidden,scope!=='clip');
  }
  nodes.get('captionLayout').value='en-zh';nodes.get('captionLayout').onchange();
  for(const language of ['en','zh','ja','ko','en']){
    nodes.get('contentLanguage').value=language;nodes.get('contentLanguage').onchange();
    assert.equal(nodes.get('captionLayoutOption').hidden,language!=='en');
    assert.equal(nodes.get('captionLayout').value,'en-zh');
  }
  for(const enabled of [false,true,false]){
    nodes.get('sidetoneEnabled').checked=enabled;nodes.get('sidetoneEnabled').onchange();
    assert.equal(nodes.get('monitorReverbOptions').hidden,!enabled);
    assert.equal(nodes.get('liveVocalSettings').hidden,true);
  }
  (await storage.ready).close();
});

test('song replay starts at audio opening and shows progress from the audio clock',async()=>{
  const storage=createStorage(new IDBFactory()),listeners=new Map(),calls=[],audioSeeks=[],frames=new Map();let sound,frameId=0;
  await storage.saveTake({id:'song',kind:'song',videoId:'video',cueKey:'song:manual',start:0,end:10,speed:1,createdAt:1,blob:new Blob(['song'])});
  const video={duration:60,currentTime:0,muted:false,playbackRate:1,pause(){},
    addEventListener(name,fn){listeners.set(name,fn);},removeEventListener(name){listeners.delete(name);},
    async play(){if(!calls.includes('video'))this.currentTime=3;calls.push('video');listeners.get('playing')?.();}};
  class Audio{
    constructor(){sound=this;this.elapsed=0;this.paused=true;}
    get currentTime(){return this.elapsed;}set currentTime(value){audioSeeks.push(value);this.elapsed=value;}
    pause(){this.paused=true;}async play(){this.paused=false;calls.push('audio');}
  }
  const {nodes}=await mount(storage,{video,globals:{Audio,requestAnimationFrame(fn){frames.set(++frameId,fn);return frameId;},cancelAnimationFrame(id){frames.delete(id);}}});
  nodes.get('activityMode').value='sing';nodes.get('activityMode').onchange();
  const replaying=nodes.get('replay').onclick();
  for(let i=0;i<10 && !calls.includes('video');i++)await Promise.resolve();
  await new Promise(resolve=>setTimeout(resolve,0));assert.deepEqual(calls.slice(0,2),['audio','video']);assert.deepEqual(audioSeeks,[]);
  assert.equal(video.currentTime,0);
  const pause=nodes.get('pausePlayback');assert.equal(pause.hidden,false);
  assert.equal(nodes.get('playbackSpeedControl').hidden,true);
  await pause.onclick();assert.equal(sound.paused,true);assert.equal(pause.textContent,'▶ 继续');
  const pausedPlays=calls.length;
  listeners.get('waiting')();listeners.get('playing')();assert.equal(calls.length,pausedPlays);
  nodes.get('transportProgress').value='0.25';await nodes.get('transportProgress').oninput();
  assert.equal(sound.paused,true);assert.equal(calls.length,pausedPlays);
  await pause.onclick();assert.equal(sound.paused,false);assert.equal(pause.textContent,'Ⅱ 暂停');
  sound.elapsed=0;audioSeeks.length=0;
  assert.equal(nodes.get('transport').hidden,false);
  assert.equal(nodes.get('transportTime').textContent,'0:00 / 0:10');
  sound.duration=2;sound.elapsed=0.5;frames.values().next().value();
  assert.equal(nodes.get('transportProgress').value,0.25);
  assert.equal(nodes.get('transportTime').textContent,'0:00 / 0:02');
  sound.elapsed=0.6;listeners.get('waiting')();video.currentTime=4;listeners.get('playing')();
  assert.equal(video.currentTime,0.6);assert.deepEqual(audioSeeks,[]);
  const slider=nodes.get('transportProgress');assert.equal(slider.disabled,false);
  sound.duration=8;slider.value='0.75';await slider.oninput();
  assert.equal(sound.currentTime,6);assert.equal(video.currentTime,6);
  slider.value='0.125';await slider.oninput();
  assert.equal(sound.currentTime,1);assert.equal(video.currentTime,1);
  sound.onended();await replaying;assert.equal(nodes.get('transport').hidden,true);
  assert.equal(pause.hidden,true);
  assert.equal(slider.disabled,true);assert.equal(slider.oninput,null);(await storage.ready).close();
});

for(const recordingKind of ['song','movie'])test(`${recordingKind} replay shares background seeking, volume, toggles and cleanup`,async()=>{
  const storage=createStorage(new IDBFactory()),frames=new Map(),listeners=new Map();
  let next=0,sound,position=0,disposed=0,pauses=0,vocalGain=1,musicGain=1;
  await storage.saveTake({id:'vocal',videoId:'video',cueKey:'song:manual',kind:recordingKind==='song'?'song':undefined,backingKey:'music',capture:'vocal',vocalOffset:0.2,start:0,end:10,speed:1,createdAt:1,blob:new Blob(['voice'])});
  await storage.saveBacking({key:'music',videoId:'video',start:0,end:60,createdAt:1,blob:new Blob(['backing'])});
  const video={duration:60,currentTime:0,muted:false,playbackRate:1,pause(){},async play(){listeners.get('playing')?.();},
    addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:name=>listeners.delete(name)};
  class Audio{
    constructor(){sound=this;this.currentTime=0;this.duration=10.2;this.paused=true;}
    async play(){this.paused=false;}pause(){this.paused=true;}
  }
  const monitor={position:()=>position,async sync(value){position=value;},pause(){pauses++;},dispose(){disposed++;},setVolume(value){musicGain=value;}};
  const {nodes}=await mount(storage,{video,globals:{Audio,
    EchoKaraoke:{...require('../extension/karaoke.js'),async createMonitor(){return monitor;},async createAudioOutput(){return {setVolume(value){vocalGain=value;},dispose(){}};}},
    requestAnimationFrame(fn){frames.set(++next,fn);return next;},cancelAnimationFrame:id=>frames.delete(id)}});
  if(recordingKind==='song'){nodes.get('activityMode').value='sing';nodes.get('activityMode').onchange();}
  else nodes.get('tab-recordings').onclick();
  const replaying=recordingKind==='song'?nodes.get('replay').onclick():nodes.get('reviewReplay').onclick();
  for(let i=0;i<30 && !nodes.get('transportProgress').oninput;i++)await Promise.resolve();
  assert.equal(nodes.get('replayMusicOption').hidden,false);assert.equal(nodes.get('replayWithBacking').disabled,false);
  nodes.get('replayVocalVolume').value='1.5';nodes.get('replayVocalVolume').oninput();
  nodes.get('replayBackingVolume').value='0.4';nodes.get('replayBackingVolume').oninput();
  assert.equal(vocalGain,1.5);assert.equal(musicGain,0.4);assert.equal(sound.currentTime,0);
  nodes.get('backingVolume').value='2';nodes.get('backingVolume').oninput();assert.equal(musicGain,0.4);
  nodes.get('resetReplayMix').onclick();assert.equal(vocalGain,1);assert.equal(musicGain,1);
  sound.currentTime=1.2;const [frame,tick]=frames.entries().next().value;frames.delete(frame);tick();await Promise.resolve();
  assert.equal(position,1);
  nodes.get('transportProgress').value='0.5';await nodes.get('transportProgress').oninput();
  assert(Math.abs(position-4.9)<0.001);assert(Math.abs(video.currentTime-4.9)<0.001);
  listeners.get('waiting')();assert.equal(sound.paused,true);assert(pauses>0);
  listeners.get('playing')();await Promise.resolve();await Promise.resolve();assert.equal(sound.paused,false);
  nodes.get('replayWithBacking').checked=false;nodes.get('replayWithBacking').onchange();
  const paused=pauses;assert(paused>0);
  nodes.get('replayWithBacking').checked=true;nodes.get('replayWithBacking').onchange();await Promise.resolve();
  nodes.get('stop').onclick();await replaying;
  assert.equal(disposed,1);assert.equal(nodes.get('mixControls').open,false);assert.equal(frames.size,0);
  (await storage.ready).close();
});

test('missing backing does not block dry singing replay and explains the fallback',async()=>{
  const storage=createStorage(new IDBFactory());let sound;
  await storage.saveTake({id:'vocal',videoId:'video',cueKey:'song:manual',kind:'song',capture:'vocal',start:0,end:5,speed:1,createdAt:1,blob:new Blob(['voice'])});
  const video={duration:60,currentTime:0,muted:false,playbackRate:1,pause(){},async play(){},addEventListener(){},removeEventListener(){}};
  class Audio{constructor(){sound=this;this.currentTime=0;}async play(){}pause(){}}
  const {nodes}=await mount(storage,{video,globals:{Audio}});
  nodes.get('activityMode').value='sing';nodes.get('activityMode').onchange();
  const replaying=nodes.get('replay').onclick();
  for(let i=0;i<20 && !nodes.get('transportProgress').oninput;i++)await Promise.resolve();
  assert.equal(nodes.get('replayWithBacking').disabled,true);assert.match(nodes.get('status').textContent,/未找到对应伴奏/);
  sound.onended();await replaying;(await storage.ready).close();
});

test('dry vocal downloads can be mixed per take or assembled as a full song without starting recording',async()=>{
  const storage=createStorage(new IDBFactory()),exports=[];
  await storage.saveTake({id:'vocal',kind:'song',capture:'vocal',videoId:'video',cueKey:'song:manual',start:5,end:10,speed:1,createdAt:1,blob:new Blob(['voice'])});
  await storage.saveBacking({key:'backing',videoId:'video',start:0,end:20,createdAt:1,blob:new Blob(['music'])});
  const {nodes,downloads}=await mount(storage,{title:'我的歌曲 / 现场版 - YouTube',video:{duration:20},globals:{setTimeout:(fn,ms)=>setTimeout(fn,ms===30000?0:ms),
    EchoAudioExport:{...require('../extension/audio-export.js'),async render(options){exports.push(options);return {blob:new Blob(['wave']),gaps:[]};}}}});
  nodes.get('activityMode').value='sing';nodes.get('activityMode').onchange();
  nodes.get('openSongRecording').onclick();assert.equal(nodes.get('recordingDetails').open,false);
  assert.equal(nodes.get('page-recordings').hidden,false);assert.equal(nodes.get('download').style.display,'block');
  nodes.get('replayVocalVolume').value='1.5';nodes.get('replayBackingVolume').value='0.4';
  assert.equal(nodes.get('takeMixDownload').hidden,false);await nodes.get('takeMixDownload').onclick();
  assert.equal(exports[0].vocalVolume,1.5);assert.equal(exports[0].volume,0.4);
  assert.equal(exports[0].origin,5);assert.equal(exports[0].duration,5);assert.equal(exports[0].backing.key,'backing');
  nodes.get('assemblyType').value='vocal';await nodes.get('assembleSong').onclick();assert.equal(exports.length,1);await nodes.get('assemblyDownload').onclick();
  assert.equal(exports[1].origin,0);assert.equal(exports[1].duration,20);assert.equal(exports[1].backing,null);
  nodes.get('assemblyType').value='mixed';nodes.get('assemblyType').onchange();await nodes.get('assemblyDownload').onclick();
  assert.equal(exports[2].backing.key,'backing');assert.equal(downloads.length,3);nodes.get('closeAssembly').onclick();
  assert.equal(downloads[0].download,'我的歌曲 现场版_00m05.0s-00m10.0s_人声+伴奏.wav');
  assert.equal(downloads[1].download,'我的歌曲 现场版_00m00.0s-00m20.0s_整首合成_人声.wav');
  assert.equal(downloads[2].download,'我的歌曲 现场版_00m00.0s-00m20.0s_整首合成_人声+伴奏.wav');
  (await storage.ready).close();
});

test('legacy mixed songs remain downloadable but never offer extraction of a nonexistent vocal track',async()=>{
  const storage=createStorage(new IDBFactory());
  await storage.saveTake({id:'legacy',kind:'song',withBacking:true,videoId:'video',cueKey:'song:manual',start:0,end:10,speed:1,createdAt:1,blob:new Blob(['mixed'])});
  const {nodes}=await mount(storage);
  nodes.get('openSongRecording').onclick();
  assert.match(nodes.get('download').textContent,/旧版混合/);assert.equal(nodes.get('replayBackingRow').hidden,true);
  assert.match(nodes.get('replayVocalLabel').textContent,/总音量/);
  assert.equal(nodes.get('takeMixDownload').hidden,true);
  await nodes.get('assembleSong').onclick();assert.match(nodes.get('status').textContent,/旧版混合/);
  (await storage.ready).close();
});

test('selecting a lyric uses the main clip recording controls without a duplicate recording section',async()=>{
  const storage=createStorage(new IDBFactory());
  await storage.saveSession({videoId:'video',index:0,start:0,end:2,speed:'1',cues:[{start:0,end:2,text:'First line'},{start:2,end:4,text:'Second line'}]});
  const {nodes}=await mount(storage);assert.equal(nodes.get('captionSetup').hidden,true);
  nodes.get('activityMode').value='sing';nodes.get('activityMode').onchange();
  nodes.get('transcriptSearch').value='second';nodes.get('transcriptSearch').oninput();
  assert.equal(nodes.get('list').children.length,1);nodes.get('list').children[0].onclick();
  assert.equal(nodes.get('start').value,'2.00');
  assert.equal(nodes.get('position').textContent,'2 / 2');
  assert.equal(nodes.get('practiceDock').hidden,false);assert.equal(nodes.get('practiceScope').value,'clip');
  assert.equal(nodes.get('scopeControls').hidden,false);assert.notEqual(nodes.get('settingsDialog').open,true);
  assert.match(nodes.get('clipSummary').textContent,/2.0–4.0/);
  assert.match(nodes.get('record').textContent,/开始片段录唱/);
  assert.equal(nodes.get('clipCue').value,'1');
  nodes.get('clipCue').value='0';nodes.get('clipCue').onchange();assert.equal(nodes.get('start').value,'0.00');assert.equal(nodes.get('end').value,'2.00');
  await nodes.get('startLater').onclick();assert.equal(nodes.get('clipCue').value,'0','timing adjustments retain the selected sentence');
  nodes.get('clipCue').value='1';nodes.get('clipCue').onchange();assert.equal(nodes.get('start').value,'2.00');
  nodes.get('prev').onclick();assert.equal(nodes.get('start').value,'0.00');
  assert.equal(nodes.get('practiceScope').value,'clip');
  nodes.get('transcriptSearch').value='no match';nodes.get('transcriptSearch').oninput();
  assert.equal(nodes.get('transcriptNoMatches').hidden,false);assert.equal(nodes.get('list').children.length,0);
  (await storage.ready).close();
});
test('recording history deletion and undo operate without adding practice-page controls',async()=>{
  const storage=createStorage(new IDBFactory());const cue={start:0,end:2,text:'Hello'};
  await storage.saveSession({videoId:'video',index:0,start:0,end:2,speed:'1',cues:[cue]});
  await storage.saveTake({id:'one',videoId:'video',cueKey:cueKey(cue),start:0,end:2,speed:1,createdAt:1,blob:new Blob(['audio']),label:'第 1 句'});
  const {nodes}=await mount(storage);
  await nodes.get('deleteTake').onclick();assert.equal((await storage.listTakes('video')).length,0);
  assert.equal(nodes.get('recordingContent').hidden,true);assert.equal(nodes.get('undoDelete').hidden,false);
  await nodes.get('undoDelete').onclick();assert.equal((await storage.listTakes('video')).length,1);
  assert.equal(nodes.get('recordingContent').hidden,false);assert.equal(nodes.get('undoDelete').hidden,true);
  (await storage.ready).close();
});

test('play all replays latest recordings in timeline order even without a current-sentence take',async()=>{
  const storage=createStorage(new IDBFactory());
  await storage.saveSession({videoId:'video',index:0,start:20,end:21,speed:'1',cues:[{start:20,end:21,text:'Unrecorded'}]});
  for(const take of [{id:'old',cueKey:'a',start:0,end:1,createdAt:1},{id:'second',cueKey:'b',start:10,end:11,createdAt:2},{id:'new',cueKey:'a',start:1,end:2,createdAt:3}])await storage.saveTake({...take,videoId:'video',speed:1,label:take.id,blob:new Blob([take.id])});
  let time=0;const listeners=new Map(),positions=[];
  const video={duration:60,muted:false,playbackRate:1,ended:false,pause(){},get currentTime(){return time;},set currentTime(value){time=value;queueMicrotask(()=>{for(const fn of listeners.get('seeked')||[])fn();});},addEventListener(name,fn){if(!listeners.has(name))listeners.set(name,new Set());listeners.get(name).add(fn);},removeEventListener(name,fn){listeners.get(name)?.delete(fn);},async play(){positions.push(time);time+=1;}};
  class Audio {constructor(url){this.src=url;}pause(){}async play(){setTimeout(()=>this.onended?.(),1);}}
  const {nodes}=await mount(storage,{video,globals:{Audio,requestAnimationFrame:fn=>setTimeout(fn,0),cancelAnimationFrame:clearTimeout}});
  assert.equal(nodes.get('replay').disabled,true);assert.equal(nodes.get('playAll').disabled,false);
  await nodes.get('playAll').onclick();
  assert.deepEqual(positions,[1,10]);assert.equal(video.muted,false);assert.equal(nodes.get('playAll').disabled,false);
  assert.match(nodes.get('status').textContent,/已播完 2/);
  (await storage.ready).close();
});

test('recording timeline selects without autoplay, exposes versions and uses the fixed playback dock',async()=>{
  const storage=createStorage(new IDBFactory());const cue={start:0,end:1,text:'Hello world'};
  await storage.saveSession({videoId:'video',index:0,start:0,end:1,speed:'1',cues:[cue]});
  for(const [id,createdAt] of [['old',1],['new',2]])await storage.saveTake({id,createdAt,videoId:'video',cueKey:cueKey(cue),start:0,end:1,speed:1,label:'第 1 句',blob:new Blob([id])});
  const listeners=new Map();let time=0,played=0;
  const video={duration:60,muted:false,playbackRate:1,ended:false,pause(){},get currentTime(){return time;},set currentTime(value){time=value;queueMicrotask(()=>{for(const fn of listeners.get('seeked')||[])fn();});},addEventListener(name,fn){if(!listeners.has(name))listeners.set(name,new Set());listeners.get(name).add(fn);},removeEventListener(name,fn){listeners.get(name)?.delete(fn);},async play(){played++;time+=1;}};
  class Audio {constructor(url){this.src=url;}pause(){}async play(){setTimeout(()=>this.onended?.(),1);}}
  const {nodes,root}=await mount(storage,{video,globals:{Audio,requestAnimationFrame:fn=>setTimeout(fn,0),cancelAnimationFrame:clearTimeout}});
  assert.equal(nodes.get('historyList').children.length,1);
  assert.equal(nodes.get('versionChoices').children.length,2);
  assert.equal(nodes.get('versionChoices').children[1].getAttribute('aria-pressed'),'true');
  assert.equal(nodes.get('recordingDock').hidden,true);nodes.get('tab-recordings').onclick();assert.equal(nodes.get('recordingDock').hidden,false);
  assert.ok(nodes.get('recordingPlaybackSlot').children.includes(nodes.get('playbackControls')));
  assert.equal(nodes.get('transport').hidden,false);
  assert.equal(nodes.get('transportProgress').disabled,true);
  assert.equal(nodes.get('transportTime').textContent,'点击回放开始');
  await nodes.get('historyList').children[0].children[0].onclick();assert.equal(played,0);
  await nodes.get('versionChoices').children[0].onclick();assert.equal(played,0);
  await nodes.get('reviewReplay').onclick();assert.equal(played,1);
  assert.equal(nodes.get('versionChoices').children[0].getAttribute('aria-pressed'),'true');
  nodes.get('recordingSearch').value='missing';nodes.get('recordingSearch').oninput();
  assert.equal(nodes.get('historyList').children[0].textContent,'没有匹配的录音，试试其他关键词。');
  nodes.get('recordingSearch').value='hello';nodes.get('recordingSearch').oninput();
  assert.equal(nodes.get('historyList').children.length,1);
  (await storage.ready).close();
});

 test('selecting a recording then deleting with the shared icon leaves the other recording intact and supports undo',async()=>{
  const storage=createStorage(new IDBFactory());const cue={start:0,end:1,text:'First'};
  await storage.saveSession({videoId:'video',index:0,start:0,end:1,speed:'1',cues:[cue]});
  for(const [id,key,start] of [['selected',cueKey(cue),0],['other','other',5]])
    await storage.saveTake({id,videoId:'video',cueKey:key,start,end:start+1,speed:1,createdAt:1,blob:new Blob([id]),label:id});
  let played=0;
  const {nodes}=await mount(storage,{video:{duration:60,play(){played++;}}});
  const row=nodes.get('historyList').children[1];
  assert.equal(row.children.length,1);
  await row.children[0].onclick();
  await nodes.get('deleteTake').onclick();
  assert.deepEqual((await storage.listTakes('video')).map(t=>t.id),['selected']);
  assert.match(nodes.get('historyInfo').textContent,/selected/);
  assert.equal(played,0);assert.equal(nodes.get('undoDelete').hidden,false);
  await nodes.get('undoDelete').onclick();
  assert.equal((await storage.listTakes('video')).length,2);assert.equal(played,0);
  (await storage.ready).close();
});

 test('subtitle preparation has one transcript entry and returns to practice after import',async()=>{
  const storage=createStorage(new IDBFactory());
  const {nodes}=await mount(storage,{globals:{EchoTranscript:{read:async()=>[{start:2,end:4,text:'Read from video'}]}}});
  assert.equal(nodes.get('page-practice').hidden,false);
  nodes.get('openCaptionSetup').onclick();assert.equal(nodes.get('page-transcript').hidden,false);
  nodes.get('file').files=[{size:60,text:async()=> '1\n00:00:00,000 --> 00:00:01,000\nImported line\n'}];
  let opened=0;nodes.get('file').onclick=()=>{opened++;};
  nodes.get('import').onclick();assert.equal(opened,1);
  await nodes.get('file').onchange();
  assert.equal(nodes.get('page-practice').hidden,false);
  assert.equal(nodes.get('page-transcript').hidden,true);
  assert.equal(nodes.get('position').textContent,'1 / 1');
  assert.match(nodes.get('status').textContent,/已导入 1/);
  await nodes.get('read').onclick();
  assert.equal(nodes.get('page-practice').hidden,false);
  assert.equal(nodes.get('start').value,'2.00');
  assert.match(nodes.get('status').textContent,/已读取 1/);
  (await storage.ready).close();
});

for(const activity of ['sing','speech'])test(`${activity} background must be regenerated when boundaries exceed its range`,async()=>{
  const storage=createStorage(new IDBFactory()), calls=[];
  const {nodes}=await mount(storage,{video:{duration:60,pause(){}},globals:{chrome:{runtime:{onMessage:{addListener(){}},async sendMessage(message){
    calls.push(message);
    return message.action==='audio'?{audio:'UklGRg==',mime:'audio/wav'}:{id:'a'.repeat(32),state:'ready'};
  }}}}});
  assert.equal(nodes.get('previewBacking').disabled,true);
  nodes.get('activityMode').value=activity;nodes.get('activityMode').onchange();
  if(activity==='speech'){nodes.get('recordingPlayback').value='backing';nodes.get('recordingPlayback').onchange();}
  nodes.get('practiceScope').value='clip';nodes.get('practiceScope').onchange();
  await nodes.get('prepareBacking').onclick();
  assert.equal(nodes.get('recordingPlayback').value,'backing');assert.equal(nodes.get('previewBacking').disabled,false);
  assert.deepEqual(calls.map(c=>c.action),['start','audio']);
  assert.equal(calls[0].start,0);assert.equal(calls[0].end,5);
  nodes.get('end').value=6;nodes.get('end').onchange();
  assert.equal(nodes.get('previewBacking').disabled,true);
  await nodes.get('record').onclick();
  assert.match(nodes.get('status').textContent,activity==='sing'?/当前练习范围准备伴奏/:/当前练习范围准备背景音/);
  (await storage.ready).close();
});

for(const activity of ['sing','speech'])test(`${activity} cancellation rejects late separation jobs`,async()=>{
  const storage=createStorage(new IDBFactory()),calls=[];let resolve;
  const {nodes}=await mount(storage,{video:{duration:60,pause(){}},globals:{chrome:{runtime:{onMessage:{addListener(){}},async sendMessage(message){
    calls.push(message.action);
    if(message.action==='start')return await new Promise(r=>{resolve=r;});
    return {};
  }}}}});
  nodes.get('activityMode').value=activity;nodes.get('activityMode').onchange();
  if(activity==='speech'){nodes.get('recordingPlayback').value='backing';nodes.get('recordingPlayback').onchange();}
  const preparing=nodes.get('prepareBacking').onclick();
  assert.equal(nodes.get('record').disabled,true);
  nodes.get('stop').onclick();resolve({id:'b'.repeat(32),state:'ready'});await preparing;
  assert.deepEqual(calls,['start','cancel']);
  assert.equal(nodes.get('previewBacking').disabled,true);assert.equal(nodes.get('record').disabled,false);
  (await storage.ready).close();
});

test('karaoke service failure leaves ordinary recording controls available',async()=>{
  const storage=createStorage(new IDBFactory());
  const {nodes}=await mount(storage,{video:{duration:60,pause(){}},globals:{chrome:{runtime:{onMessage:{addListener(){}},async sendMessage(){return {error:'本机服务未启动'};}}}}});
  nodes.get('activityMode').value='sing';nodes.get('activityMode').onchange();
  await nodes.get('prepareBacking').onclick();
  assert.match(nodes.get('status').textContent,/未能生成伴奏/);
  assert.match(nodes.get('karaokeNotice').textContent,/本机服务未启动/);
  nodes.get('speed').onchange();
  assert.match(nodes.get('karaokeNotice').textContent,/本机服务未启动/);
  assert.equal(nodes.get('karaokeProgress').hidden,true);
  assert.equal(nodes.get('record').disabled,false);assert.equal(nodes.get('previewBacking').disabled,true);
  (await storage.ready).close();
});

test('whole-song recording uses the full duration and offers replay, retry and download without changing the selected sentence',async()=>{
  const storage=createStorage(new IDBFactory());
  await storage.saveSession({videoId:'video',index:0,start:0,end:1,speed:'1',cues:[{start:0,end:1,text:'Sing'}]});
  const listeners=new Map(),mixedStream={},events=[];let time=0;
  const video={duration:180,muted:false,playbackRate:1,pause(){},get currentTime(){return time;},set currentTime(v){time=v;},
    addEventListener(name,fn){if(!listeners.has(name))listeners.set(name,new Set());listeners.get(name).add(fn);},
    removeEventListener(name,fn){listeners.get(name)?.delete(fn);},async play(){events.push('video-play');time=180;}};
  const mic={getTracks:()=>[{stop(){events.push('mic-stop');}}]};
  class MediaRecorder {
    static isTypeSupported(){return true;}
    constructor(stream){assert.equal(stream,mic);this.state='inactive';this.mimeType='audio/webm';}
    start(){this.state='recording';events.push('recorder-start');}
    stop(){this.state='inactive';this.ondataavailable({data:new Blob(['mixed-audio'])});queueMicrotask(()=>this.onstop());}
  }
  const mix={stream:mixedStream,async sync(position){assert.equal(position,0);events.push('sync');},pause(){events.push('pause');},dispose(){events.push('dispose');}};
  const {nodes}=await mount(storage,{video,globals:{MediaRecorder,navigator:{mediaDevices:{getUserMedia:async constraints=>{
      assert.equal(constraints.video,false);
      assert.deepEqual({...constraints.audio},{echoCancellation:false,noiseSuppression:false,autoGainControl:false});
      return mic;
    }}},
    EchoKaraoke:{...require('../extension/karaoke.js'),createMonitor:async options=>{assert.equal(options.video,video);return mix;}},
    requestAnimationFrame:fn=>setTimeout(fn,0),cancelAnimationFrame:clearTimeout,
    chrome:{runtime:{onMessage:{addListener(){}},async sendMessage(message){return message.action==='audio'?{audio:'UklGRg==',mime:'audio/wav'}:{id:'c'.repeat(32),state:'ready'};}}}}});
  nodes.get('activityMode').value='sing';nodes.get('activityMode').onchange();
  await nodes.get('prepareBacking').onclick();
  await nodes.get('record').onclick();
  for(let i=0;i<20 && !(await storage.listTakes('video')).length;i++)await new Promise(r=>setTimeout(r,2));
  const takes=await storage.listTakes('video');assert.equal(takes.length,1);
  assert.match(takes[0].cueKey,/^song:/);
  assert.equal(takes[0].kind,'song');assert.equal(takes[0].start,0);assert.equal(takes[0].end,180);
  assert.equal(nodes.get('end').value,1);assert.equal(nodes.get('songResult').hidden,false);
  assert.equal(nodes.get('record').textContent,'● 再录一次');assert.match(nodes.get('download').href,/^blob:/);
  nodes.get('practiceScope').value='clip';nodes.get('practiceScope').onchange();
  assert.equal(nodes.get('record').textContent,'● 开始片段录唱');
  nodes.get('tab-recordings').onclick();
  assert.equal(nodes.get('reuseSongRange').hidden,false);nodes.get('reuseSongRange').onclick();
  assert.equal(nodes.get('start').value,0);assert.equal(nodes.get('end').value,180);
  assert.equal(nodes.get('record').textContent,'● 再录一次');
  assert.equal(takes[0].withBacking,undefined);assert.equal(takes[0].capture,'vocal');assert.equal(await takes[0].blob.text(),'mixed-audio');
  assert.deepEqual(events.filter(value=>['recorder-start','sync','video-play'].includes(value)),['recorder-start','sync','video-play']);
  assert(events.includes('dispose'));assert(events.includes('mic-stop'));assert.equal(video.muted,false);
  assert.match(nodes.get('historyInfo').textContent,/独立人声/);
  assert.equal(nodes.get('record').disabled,false);
  (await storage.ready).close();
});

test('default generation covers the whole song and reuses it for different sentences without moving practice boundaries',async()=>{
  const storage=createStorage(new IDBFactory()),calls=[];const cue={start:10,end:12,text:'Keep this sentence'};
  await storage.saveSession({videoId:'video',index:0,start:10,end:12,speed:'1',cues:[cue]});
  const {nodes}=await mount(storage,{video:{duration:180,pause(){}},globals:{chrome:{runtime:{onMessage:{addListener(){}},async sendMessage(message){
    calls.push(message);return message.action==='audio'?{audio:'UklGRg==',mime:'audio/wav'}:{id:'d'.repeat(32),state:'ready'};
  }}}}});
  assert.equal(nodes.get('practiceScope').value,'clip');assert.equal(nodes.get('record').disabled,false);
  nodes.get('activityMode').value='sing';nodes.get('activityMode').onchange();
  assert.equal(nodes.get('practiceScope').value,'whole');
  await nodes.get('prepareBacking').onclick();
  assert.equal(calls[0].start,0);assert.equal(calls[0].end,180);
  assert.equal(nodes.get('start').value,10);assert.equal(nodes.get('end').value,12);
  assert.equal(nodes.get('record').disabled,false);
  nodes.get('start').value=30;nodes.get('end').value=40;nodes.get('end').onchange();
  nodes.get('practiceScope').value='clip';nodes.get('practiceScope').onchange();
  assert.equal(nodes.get('record').disabled,false);assert.equal(nodes.get('previewBacking').disabled,false);
  assert.equal(nodes.get('prepareBacking').disabled,true);assert.equal(calls.length,2);
  (await storage.ready).close();
});

test('long videos require choosing a clip rather than silently truncating a song',async()=>{
  const storage=createStorage(new IDBFactory());let requests=0;
  const {nodes}=await mount(storage,{video:{duration:601,pause(){}},globals:{chrome:{runtime:{onMessage:{addListener(){}},async sendMessage(){requests++;}}}}});
  nodes.get('activityMode').value='sing';nodes.get('activityMode').onchange();
  await nodes.get('prepareBacking').onclick();
  assert.equal(requests,0);assert.match(nodes.get('status').textContent,/超过 10 分钟/);
  assert.equal(nodes.get('record').disabled,false);
  (await storage.ready).close();
});

test('ordinary dubbing records the microphone directly with the accompaniment service offline, including after leaving singing mode',async()=>{
  const storage=createStorage(new IDBFactory());const cue={start:0,end:1,text:'Spoken sentence'};
  await storage.saveSession({videoId:'video',index:0,start:0,end:1,speed:'1',cues:[cue]});
  const mic={getTracks:()=>[{stop(){}}]},listeners=new Map();let time=0,requests=0,mixes=0;
  const video={duration:600,muted:false,playbackRate:1,pause(){},get currentTime(){return time;},set currentTime(v){time=v;},
    addEventListener(name,fn){if(!listeners.has(name))listeners.set(name,new Set());listeners.get(name).add(fn);},
    removeEventListener(name,fn){listeners.get(name)?.delete(fn);},async play(){time=1;}};
  class MediaRecorder {
    static isTypeSupported(){return true;}
    constructor(source){assert.equal(source,mic);this.state='inactive';this.mimeType='audio/webm';}
    start(){this.state='recording';}
    stop(){this.state='inactive';this.ondataavailable({data:new Blob(['voice-only'])});queueMicrotask(()=>this.onstop());}
  }
  const {nodes}=await mount(storage,{video,globals:{MediaRecorder,navigator:{mediaDevices:{getUserMedia:async constraints=>{
      assert.equal(constraints.video,false);
      assert.deepEqual({...constraints.audio},{echoCancellation:true,autoGainControl:true});
      return mic;
    }}},
    EchoKaraoke:{...require('../extension/karaoke.js'),createMonitor:async()=>{mixes++;throw Error('Must not monitor ordinary dubbing');}},
    requestAnimationFrame:fn=>setTimeout(fn,0),cancelAnimationFrame:clearTimeout,
    chrome:{runtime:{onMessage:{addListener(){}},async sendMessage(){requests++;throw Error('offline');}}}}});
  assert.equal(nodes.get('activityMode').value,'speech');
  assert.equal(requests,0); // No service contact until an explicit preparation request.
  nodes.get('activityMode').value='sing';nodes.get('activityMode').onchange();
  nodes.get('recordingPlayback').value='backing';
  nodes.get('activityMode').value='speech';nodes.get('activityMode').onchange();
  assert.equal(nodes.get('recordingPlayback').value,'silent');
  // Leaving singing does not opt ordinary dubbing into background monitoring.
  await nodes.get('record').onclick();
  for(let i=0;i<20 && !(await storage.listTakes('video')).length;i++)await new Promise(r=>setTimeout(r,2));
  const [take]=await storage.listTakes('video');
  assert.equal(await take.blob.text(),'voice-only');assert.equal(take.withBacking,undefined);assert.equal(take.kind,undefined);
  assert.equal(take.cueKey,cueKey(cue));assert.equal(take.start,0);assert.equal(take.end,1);
  assert.equal(requests,0);assert.equal(mixes,0);assert.equal(video.muted,false);
  assert.equal(nodes.get('record').disabled,false);
  (await storage.ready).close();
});

test('the main singing button records a selected clip without backing and disables speech processing',async()=>{
  const storage=createStorage(new IDBFactory());
  const cue={start:0,end:1,text:'Sustained note'};
  await storage.saveSession({videoId:'video',index:0,start:0,end:1,speed:'1',cues:[cue]});
  const mic={getTracks:()=>[{stop(){}}]};
  const video={duration:60,currentTime:0,muted:false,playbackRate:1,pause(){},async play(){this.currentTime=1;},addEventListener(){},removeEventListener(){}};
  let requested;
  class MediaRecorder {
    static isTypeSupported(){return true;}
    constructor(source){assert.equal(source,mic);this.state='inactive';this.mimeType='audio/webm';}
    start(){this.state='recording';}
    stop(){this.state='inactive';this.ondataavailable({data:new Blob(['vocal'])});queueMicrotask(()=>this.onstop());}
  }
  const {nodes}=await mount(storage,{video,globals:{MediaRecorder,
    navigator:{mediaDevices:{async getUserMedia(constraints){requested=constraints;return mic;}}},
    requestAnimationFrame:fn=>setTimeout(fn,0),cancelAnimationFrame:clearTimeout}});
  nodes.get('activityMode').value='sing';nodes.get('activityMode').onchange();
  nodes.get('recordingPlayback').value='silent';
  nodes.get('recordingPlayback').onchange();
  nodes.get('practiceScope').value='clip';nodes.get('practiceScope').onchange();
  assert.match(nodes.get('songReadiness').textContent,/清唱/);
  await nodes.get('record').onclick();
  assert.deepEqual({...requested.audio},{echoCancellation:false,noiseSuppression:false,autoGainControl:false});
  assert.equal(requested.video,false);
  const takes=await storage.listTakes('video');assert.equal(takes.length,1);
  assert.equal(takes[0].kind,'song');assert.equal(takes[0].start,0);assert.equal(takes[0].end,1);
  assert.equal(nodes.get('recordingPlayback').value,'silent');
  (await storage.ready).close();
});

test('generation displays live separation progress, encoding state and completion without inventing overall percentages',async()=>{
  const storage=createStorage(new IDBFactory());let nodes,polls=0;
  const mounted=await mount(storage,{video:{duration:60,pause(){}},globals:{
    setTimeout:(fn,ms)=>setTimeout(fn,ms===1500?0:ms),
    chrome:{runtime:{onMessage:{addListener(){}},async sendMessage(message){
      if(message.action==='start')return {id:'e'.repeat(32),state:'separating',progress:40,elapsedSeconds:16,remainingSeconds:23};
      if(message.action==='status'){
        if(polls++===0){
          assert.equal(nodes.get('karaokeProgress').hidden,false);assert.equal(nodes.get('karaokeProgress').value,40);assert.equal(nodes.get('generationProgress').value,40);assert.match(nodes.get('generationStage').textContent,/40%/);
          assert.match(nodes.get('karaokeInfo').textContent,/40%.*已用.*预计剩余/);
          assert.doesNotMatch(nodes.get('status').textContent,/%|已用|预计剩余/);
          return {id:'e'.repeat(32),state:'encoding',progress:null,elapsedSeconds:30};
        }
        assert.match(nodes.get('karaokeInfo').textContent,/压缩并保存/);
        assert.doesNotMatch(nodes.get('karaokeInfo').textContent,/%/);
        return {id:'e'.repeat(32),state:'ready',progress:100,elapsedSeconds:31};
      }
      assert.equal(nodes.get('karaokeProgress').value,100);
      return {audio:'UklGRg==',mime:'audio/wav'};
    }}}}});
  nodes=mounted.nodes;nodes.get('activityMode').value='sing';nodes.get('activityMode').onchange();
  await nodes.get('prepareBacking').onclick();
  assert.equal(polls,2);assert.equal(nodes.get('karaokeProgress').hidden,true);
  assert.equal(nodes.get('record').disabled,false);
  (await storage.ready).close();
});

test('captions follow playback with faded context while preserving recording boundaries and selected sentence',async()=>{
  const storage=createStorage(new IDBFactory()),listeners=new Map();let time=0;
  const cues=[{start:2,end:4,text:'First line 第一句'},{start:4,end:6,text:'Second line 第二句'},{start:9,end:10,text:'Third line 第三句'}];
  await storage.saveSession({videoId:'video',index:0,start:2,end:4,speed:'1',showChinese:true,cues});
  const video={duration:180,paused:true,get currentTime(){return time;},
    addEventListener(name,fn){listeners.set(name,fn);},removeEventListener(name){listeners.delete(name);}};
  const {nodes}=await mount(storage,{video});
  const text=()=>nodes.get('caption').children.map(n=>n.textContent).join('');
  assert.equal(text(),'First line');assert.equal(nodes.get('captionNext').textContent,'Second line');
  assert.equal(nodes.get('captionPrevious').hidden,true);
  video.paused=false;time=4.5;listeners.get('timeupdate')({type:'timeupdate'});
  assert.equal(text(),'Second line');assert.equal(nodes.get('captionPrevious').textContent,'First line');
  assert.equal(nodes.get('captionNext').textContent,'Third line');assert.equal(nodes.get('translation').textContent,'第二句');
  assert.equal(nodes.get('start').value,2);assert.equal(nodes.get('end').value,4);
  time=7;listeners.get('timeupdate')({type:'timeupdate'});
  assert.equal(text(),'Third line');assert.match(nodes.get('captionPhase').textContent,/即将开始 · 2 秒/);
  assert.equal(nodes.get('captionNext').hidden,true);
  video.paused=true;time=3;listeners.get('seeked')({type:'seeked'});assert.equal(text(),'First line');
  nodes.get('hideText').checked=true;nodes.get('hideText').onchange();
  assert.equal(nodes.get('captionPrevious').hidden,true);assert.equal(nodes.get('captionNext').hidden,true);
  assert.equal(nodes.get('translation').hidden,true);assert.equal(nodes.get('rawCaption').textContent,'');
  nodes.get('hideText').checked=false;nodes.get('hideText').onchange();
  nodes.get('followCaptions').checked=false;nodes.get('followCaptions').onchange();
  time=9.5;video.paused=false;listeners.get('timeupdate')({type:'timeupdate'});assert.equal(text(),'First line');
  const saved=await storage.getSession('video');assert.equal(saved.index,0);assert.equal(saved.start,2);assert.equal(saved.end,4);
  assert.equal(saved.followCaptions,false);
  (await storage.ready).close();
});

test('explicit sentence navigation keeps shortcuts, dropdown and followed lyrics synchronized',async()=>{
  const storage=createStorage(new IDBFactory()),listeners=new Map();let time=21,paused=false,seeks=0;
  const cues=Array.from({length:6},(_,i)=>({start:i*4,end:i*4+4,text:`Line number ${i+1}`}));
  await storage.saveSession({videoId:'video',index:2,start:8,end:12,speed:'1',followCaptions:true,cues});
  const emit=type=>listeners.get(type)?.({type});
  const video={duration:24,get paused(){return paused;},pause(){paused=true;emit('pause');},
    get currentTime(){return time;},set currentTime(value){time=value;seeks++;queueMicrotask(()=>emit('seeked'));},
    addEventListener(name,fn){listeners.set(name,fn);},removeEventListener(name){listeners.delete(name);}};
  const {nodes,document,events}=await mount(storage,{video});
  const text=()=>nodes.get('caption').children.map(n=>n.textContent).join('');
  assert.equal(seeks,0);assert.equal(text(),'Line number 6');
  document.documentElement.children[0].style.display='block';
  const press=code=>events.get('keydown')({altKey:true,shiftKey:true,code,preventDefault(){},stopPropagation(){}});
  const check=i=>{
    assert.equal(paused,true);assert.equal(time,cues[i].start);
    assert.equal(nodes.get('clipCue').value,String(i));assert.equal(nodes.get('position').textContent,`${i+1} / 6`);
    assert.equal(Number(nodes.get('start').value),cues[i].start);assert.equal(Number(nodes.get('end').value),cues[i].end);
    assert.equal(text(),cues[i].text);
  };
  press('ArrowRight');check(3);
  // Rapid navigation must also survive the queued native seek notifications.
  press('ArrowLeft');press('ArrowLeft');await Promise.resolve();check(1);
  paused=false;time=21;emit('timeupdate');assert.equal(text(),'Line number 6');
  nodes.get('clipCue').value='0';nodes.get('clipCue').onchange();await Promise.resolve();check(0);
  paused=false;time=21;emit('timeupdate');
  nodes.get('list').children[4].click();await Promise.resolve();check(4);
  // Playback still follows the video without moving the chosen practice range.
  paused=false;time=21;emit('timeupdate');assert.equal(text(),'Line number 6');
  assert.equal(nodes.get('clipCue').value,'4');assert.equal(Number(nodes.get('start').value),16);
  (await storage.ready).close();
});

for(const reference of ['backing','original'])test(`generated accompaniment restores without contacting the service and preserves ${reference} reference`,async()=>{
  const factory=new IDBFactory(),first=createStorage(factory);
  const mounted=await mount(first,{video:{duration:60,pause(){}},globals:{chrome:{runtime:{onMessage:{addListener(){}},async sendMessage(message){
    return message.action==='audio'?{audio:'UklGRg==',mime:'audio/wav'}:{id:'f'.repeat(32),state:'ready'};
  }}}}});
  mounted.nodes.get('activityMode').value='sing';mounted.nodes.get('activityMode').onchange();
  mounted.nodes.get('recordingPlayback').value=reference;mounted.nodes.get('recordingPlayback').onchange();
  await mounted.nodes.get('prepareBacking').onclick();
  assert.equal(mounted.nodes.get('recordingPlayback').value,reference);
  assert.equal((await first.listBackings('video')).length,1);(await first.ready).close();
  const reopened=createStorage(factory);let requests=0;
  const {nodes}=await mount(reopened,{video:{duration:60},globals:{chrome:{runtime:{onMessage:{addListener(){}},async sendMessage(){requests++;throw Error('offline');}}}}});
  assert.equal(nodes.get('activityMode').value,'sing');
  assert.equal(nodes.get('recordingPlayback').value,reference);
  assert.equal(nodes.get('previewBacking').disabled,false);assert.equal(nodes.get('record').disabled,false);
  assert.equal(nodes.get('prepareBacking').disabled,true);assert.equal(requests,0);
  (await reopened.ready).close();
});

test('older server-cached accompaniment is recovered without starting separation and then saved locally',async()=>{
  const storage=createStorage(new IDBFactory()),calls=[];
  const {nodes}=await mount(storage,{video:{duration:60},cachedBackings:{backings:[{id:'a'.repeat(32),videoId:'video',start:0,end:60,state:'ready'}]},
    globals:{chrome:{runtime:{onMessage:{addListener(){}},async sendMessage(message){calls.push(message.action);return {audio:'UklGRg==',mime:'audio/wav'};}}}}});
  nodes.get('activityMode').value='sing';nodes.get('activityMode').onchange();
  for(let i=0;i<20 && nodes.get('previewBacking').disabled;i++)await new Promise(r=>setTimeout(r,2));
  assert.deepEqual(calls,['audio']);assert.equal(nodes.get('record').disabled,false);
  assert.equal((await storage.listBackings('video')).length,1);
  (await storage.ready).close();
});

for(const [language,text,nextText] of [['zh','明月几时有，我想与你一起唱','不知天上宫阙'],['ja','東京で君の名前を呼ぶよ','明日も会いたい'],['ko','오늘 밤 너와 함께 노래해','우리 다시 만나요']]){
  test(`multilingual ${language} lyrics survive restoration, singing mode and caption following`,async()=>{
    const storage=createStorage(new IDBFactory());const listeners=new Map();let time=0;
    const cues=[{start:0,end:2,text},{start:2,end:4,text:nextText}];
    await storage.saveSession({videoId:'video',index:0,start:0,end:2,speed:'1',contentLanguage:language,captionLayout:'original',cues});
    const video={duration:4,paused:true,get currentTime(){return time;},addEventListener(name,fn){listeners.set(name,fn);},removeEventListener(name){listeners.delete(name);}};
    const {nodes}=await mount(storage,{video});
    const shown=()=>nodes.get('caption').children.map(n=>n.textContent).join('');
    assert.equal(shown(),text);assert.equal(nodes.get('captionNext').textContent,nextText);
    assert.match(nodes.get('list').children[0].textContent,new RegExp(text));
    assert.equal(nodes.get('referenceToggle').hidden,true);assert.equal(nodes.get('translation').hidden,true);
    nodes.get('activityMode').value='sing';nodes.get('activityMode').onchange();assert.equal(shown(),text);
    time=2.5;video.paused=false;listeners.get('timeupdate')({type:'timeupdate'});assert.equal(shown(),nextText);
    nodes.get('contentLanguage').value='auto';nodes.get('contentLanguage').onchange();
    const saved=await storage.getSession('video');assert.equal(saved.contentLanguage,'auto');assert.equal(saved.captionLayout,'original');
    (await storage.ready).close();
  });
}
test('old Chinese sessions keep complete lyrics rather than enabling legacy English splitting',async()=>{
  const storage=createStorage(new IDBFactory());const text='月亮代表我的心';
  await storage.saveSession({videoId:'video',index:0,start:0,end:2,speed:'1',showChinese:true,cues:[{start:0,end:2,text}]});
  const {nodes}=await mount(storage);assert.equal(nodes.get('captionLayout').value,'original');
  assert.equal(nodes.get('caption').children.map(n=>n.textContent).join(''),text);
  (await storage.ready).close();
});

test('whole-song validation remains beside the generation button without sending a request',async()=>{
  const storage=createStorage(new IDBFactory());let requests=0;
  const {nodes}=await mount(storage,{video:{duration:601,pause(){}},globals:{chrome:{runtime:{onMessage:{addListener(){}},async sendMessage(){requests++;return {};}}}}});
  nodes.get('activityMode').value='sing';nodes.get('activityMode').onchange();
  await nodes.get('prepareBacking').onclick();
  assert.equal(requests,0);assert.match(nodes.get('karaokeInfo').textContent,/超过 10 分钟/);assert.match(nodes.get('status').textContent,/超过 10 分钟/);
  assert.equal(nodes.get('prepareBacking').disabled,true);
  (await storage.ready).close();
});


test('caption source selection loads the exact track, persists it and keeps recordings',async()=>{
  const storage=createStorage(new IDBFactory()),requests=[];
  await storage.saveTake({id:'saved',videoId:'video',cueKey:'old',start:0,end:2,speed:1,createdAt:1,blob:new Blob(['voice'])});
  const tracks=[{id:'.zh-Hans',name:'中文（简体）',language:'zh-Hans'},{id:'.en',name:'English',language:'en'}];
  const {nodes}=await mount(storage,{globals:{chrome:{runtime:{onMessage:{addListener(){}},async sendMessage(message){requests.push(message);return message.action==='list'?{tracks}:{cues:[{start:43,end:49,text:'测试中文字幕'}]};}}}}});
  nodes.get('tab-transcript').onclick();
  await nodes.get('refreshCaptionTracks').onclick();assert.equal(nodes.get('captionSource').children.length,3);
  nodes.get('captionSource').value='.zh-Hans';nodes.get('captionSource').onchange();
  for(let i=0;i<20 && !requests.some(r=>r.action==='read');i++)await new Promise(r=>setTimeout(r,2));
  await new Promise(r=>setTimeout(r,5));
  assert.equal(requests.find(r=>r.action==='read').trackId,'.zh-Hans');
  assert.match(nodes.get('captionSourceInfo').textContent,/中文/);assert.equal(nodes.get('position').textContent,'1 / 1');
  assert.equal((await storage.listTakes('video')).length,1);
  const saved=await storage.getSession('video');assert.equal(nodes.get('page-transcript').hidden,false);assert.equal(saved.captionSource,'.zh-Hans');assert.equal(saved.cues[0].text,'测试中文字幕');
  const restored=await mount(storage);assert.equal(restored.nodes.get('captionSource').value,'.zh-Hans');
  (await storage.ready).close();
});
test('caption failures preserve existing cues and never silently fall back to English',async()=>{
  const storage=createStorage(new IDBFactory());let fallback=0;
  await storage.saveSession({videoId:'video',index:0,start:0,end:2,speed:'1',captionSource:'.zh-Hant',captionSourceName:'中文繁体',cues:[{start:0,end:2,text:'保留原歌词'}]});
  const {nodes}=await mount(storage,{globals:{EchoTranscript:{async read(){fallback++;}},chrome:{runtime:{onMessage:{addListener(){}},async sendMessage(){return {error:'字幕请求失败'};}}}}});
  await nodes.get('read').onclick();assert.equal(fallback,0);assert.match(nodes.get('status').textContent,/字幕请求失败/);
  assert.equal(nodes.get('position').textContent,'1 / 1');
  assert.equal((await storage.getSession('video')).cues[0].text,'保留原歌词');
  (await storage.ready).close();
});
test('automatic caption reading follows the player selected track instead of the English transcript',async()=>{
  const storage=createStorage(new IDBFactory());let readId;
  const {nodes}=await mount(storage,{globals:{EchoCaptionTracks:{async currentTrack(){return {language:'zh-Hant',generated:false};}},chrome:{runtime:{onMessage:{addListener(){}},async sendMessage(m){if(m.action==='list')return {tracks:[{id:'.en',language:'en',name:'English'},{id:'.zh-Hant',language:'zh-Hant',name:'中文繁体',generated:false}]};readId=m.trackId;return {cues:[{start:0,end:2,text:'測試字幕'}]};}}}}});
  await nodes.get('read').onclick();assert.equal(readId,'.zh-Hant');assert.match(nodes.get('status').textContent,/中文.*繁体/);
  (await storage.ready).close();
});

test('stopping a pending caption request prevents late subtitle replacement',async()=>{
  const storage=createStorage(new IDBFactory());let release;
  await storage.saveSession({videoId:'video',index:0,start:0,end:2,speed:'1',captionSource:'.en',cues:[{start:0,end:2,text:'Original saved caption'}]});
  const {nodes}=await mount(storage,{globals:{chrome:{runtime:{onMessage:{addListener(){}},async sendMessage(m){if(m.action==='list')return {tracks:[{id:'.en',name:'English',language:'en'}]};return new Promise(resolve=>release=resolve);}}}}});
  const reading=nodes.get('read').onclick();for(let i=0;i<20 && !release;i++)await Promise.resolve();
  assert.equal(typeof release,'function');nodes.get('stop').onclick();release({cues:[{start:5,end:6,text:'Late result'}]});await reading;
  assert.equal((await storage.getSession('video')).cues[0].text,'Original saved caption');assert.equal(nodes.get('read').disabled,false);
  (await storage.ready).close();
});

test('caption UI uses the page-context client without sending a background request',async()=>{
  const storage=createStorage(new IDBFactory()),calls=[];let background=0;
  const videoId='abcdefghijk',location={href:'https://www.youtube.com/watch?v='+videoId,pathname:'/watch'};
  const pageContext={location,URL,AbortSignal,setTimeout,clearTimeout,fetch:async(url,options)=>{
    calls.push({url,options});
    const data=url.includes('/player')?{videoDetails:{videoId},captions:{playerCaptionsTracklistRenderer:{captionTracks:[{vssId:'.zh-Hans',languageCode:'zh-Hans',baseUrl:'https://www.youtube.com/api/timedtext?v='+videoId+'&lang=zh-Hans'}]}}}:{events:[{tStartMs:0,dDurationMs:2000,segs:[{utf8:'页面内字幕'}]}]};
    return {ok:true,async text(){return JSON.stringify(data);}};
  }};
  vm.runInNewContext(fs.readFileSync('extension/caption-tracks.js','utf8'),pageContext);
  const {nodes}=await mount(storage,{globals:{location,EchoCaptionTracks:pageContext.EchoCaptionTracks,chrome:{runtime:{onMessage:{addListener(){}},sendMessage(){background++;throw Error('Unexpected background request');}}}}});
  await nodes.get('refreshCaptionTracks').onclick();assert.equal(background,0);assert.equal(calls.length,1);
  nodes.get('captionSource').value='.zh-Hans';nodes.get('captionSource').onchange();
  for(let i=0;i<20 && calls.length<2;i++)await new Promise(r=>setTimeout(r,2));
  await new Promise(r=>setTimeout(r,5));
  assert.equal(calls.length,2);assert.equal(background,0);assert.equal(calls[0].options.credentials,'omit');
  assert.equal((await storage.getSession(videoId)).cues[0].text,'页面内字幕');
  (await storage.ready).close();
});


test('practice library is separate, can resume a video, and requires confirmation before cache cleanup',async()=>{
  const storage=createStorage(new IDBFactory()),id='abcdefghijk';
  await storage.saveSession({videoId:id,title:'我的练习歌曲',start:12,updatedAt:100});
  await storage.saveTake({id:'keep',videoId:id,cueKey:'one',createdAt:100,start:0,end:2,speed:1,blob:new Blob(['voice'])});
  await storage.saveBacking({key:'clear',videoId:id,start:0,end:20,createdAt:100,blob:new Blob(['music'])});
  const {nodes,root}=await mount(storage);await nodes.get('openLibrary').onclick();
  assert.equal(nodes.get('libraryDialog').open,true);assert.equal(nodes.get('page-practice').hidden,false);
  const first=nodes.get('libraryList').children.find(card=>card.children[0].textContent==='我的练习歌曲');
  assert(first);assert.match(first.children.at(-1).children[0].href,/watch\?v=abcdefghijk&t=12s/);
  nodes.get('libraryCacheTab').onclick();nodes.get('clearAllBackings').onclick();
  assert.equal((await storage.listBackings(id)).length,1);assert.equal(nodes.get('libraryConfirm').hidden,false);
  root.onkeydown({key:'Escape',preventDefault(){},stopPropagation(){}});assert.equal(nodes.get('libraryConfirm').hidden,true);assert.equal(nodes.get('libraryDialog').open,true);
  nodes.get('clearAllBackings').onclick();await nodes.get('libraryConfirmYes').onclick();
  assert.equal((await storage.listBackings(id)).length,0);assert.equal((await storage.listTakes(id)).length,1);assert.equal((await storage.getSession(id)).title,'我的练习歌曲');
  root.onkeydown({key:'Escape',preventDefault(){},stopPropagation(){}});assert.equal(nodes.get('libraryDialog').open,false);
  (await storage.ready).close();
});

test('echo cancellation is remembered per activity and applied to microphone requests',async()=>{
  const storage=createStorage(new IDBFactory()),preferences=new Map(),requests=[];
  const localStorage={getItem:key=>preferences.get(key) || null,setItem:(key,value)=>preferences.set(key,value)};
  const globals={MediaRecorder:class {static isTypeSupported(){return true;}},window:{localStorage,addEventListener(){},speechSynthesis:{cancel(){}}},
    navigator:{mediaDevices:{async getUserMedia(options){requests.push(options);throw Error('Microphone unavailable in fixture');}}}};
  const {nodes}=await mount(storage,{globals});
  const checkbox=nodes.get('echoCancellation');
  assert.equal(checkbox.checked,true);
  checkbox.checked=false;checkbox.onchange();
  await nodes.get('record').onclick();
  assert.deepEqual({...requests.at(-1).audio},{echoCancellation:false,autoGainControl:true});
  nodes.get('activityMode').value='sing';nodes.get('activityMode').onchange();
  assert.equal(checkbox.checked,false);
  checkbox.checked=true;checkbox.onchange();
  nodes.get('recordingPlayback').value='silent';nodes.get('recordingPlayback').onchange();
  await nodes.get('record').onclick();
  assert.deepEqual({...requests.at(-1).audio},{echoCancellation:true,noiseSuppression:false,autoGainControl:false});
  nodes.get('activityMode').value='speech';nodes.get('activityMode').onchange();
  assert.equal(checkbox.checked,false);
  const refreshed=await mount(storage,{globals});
  refreshed.nodes.get('activityMode').value='speech';refreshed.nodes.get('activityMode').onchange();
  assert.equal(refreshed.nodes.get('echoCancellation').checked,false);
  refreshed.nodes.get('activityMode').value='sing';refreshed.nodes.get('activityMode').onchange();
  assert.equal(refreshed.nodes.get('echoCancellation').checked,true);
  (await storage.ready).close();
});

test('automatic and manual gain are independent per activity, preserve legacy echo preferences and reach recording',async()=>{
  const storage=createStorage(new IDBFactory()),preferences=new Map([['echo-microphone-v1',JSON.stringify({speech:false,sing:true})]]),requests=[];
  const localStorage={getItem:key=>preferences.get(key) || null,setItem:(key,value)=>preferences.set(key,value)};
  const globals={MediaRecorder:class {static isTypeSupported(){return true;}},window:{localStorage,addEventListener(){},speechSynthesis:{cancel(){}}},
    navigator:{mediaDevices:{async getUserMedia(options){requests.push(options);throw Error('Fixture microphone');}}}};
  const {nodes}=await mount(storage,{globals});
  assert.equal(nodes.get('echoCancellation').checked,false);
  assert.equal(nodes.get('autoGainControl').checked,true);assert.equal(nodes.get('manualGainRow').hidden,true);
  nodes.get('autoGainControl').checked=false;nodes.get('autoGainControl').onchange();
  assert.equal(nodes.get('manualGainRow').hidden,false);
  nodes.get('manualGainDb').value='6';nodes.get('manualGainDb').oninput();nodes.get('manualGainDb').onchange();
  await nodes.get('record').onclick();
  assert.deepEqual({...requests.at(-1).audio},{echoCancellation:false,autoGainControl:false});
  nodes.get('activityMode').value='sing';nodes.get('activityMode').onchange();
  assert.equal(nodes.get('echoCancellation').checked,true);
  assert.equal(nodes.get('autoGainControl').checked,false);assert.equal(nodes.get('manualGainDb').value,0);
  nodes.get('manualGainDb').value='16';nodes.get('manualGainDb').oninput();nodes.get('manualGainDb').onchange();
  nodes.get('autoGainControl').checked=true;nodes.get('autoGainControl').onchange();
  assert.equal(nodes.get('manualGainRow').hidden,true);
  nodes.get('recordingPlayback').value='silent';nodes.get('recordingPlayback').onchange();
  await nodes.get('record').onclick();
  assert.deepEqual({...requests.at(-1).audio},{echoCancellation:true,noiseSuppression:false,autoGainControl:true});
  const refreshed=(await mount(storage,{globals})).nodes;
  refreshed.get('activityMode').value='speech';refreshed.get('activityMode').onchange();
  assert.equal(refreshed.get('autoGainControl').checked,false);assert.equal(refreshed.get('manualGainDb').value,6);
  refreshed.get('activityMode').value='sing';refreshed.get('activityMode').onchange();
  assert.equal(refreshed.get('autoGainControl').checked,true);assert.equal(refreshed.get('manualGainDb').value,16);
  (await storage.ready).close();
});

test('manual input gain reaches the saved vocal recording and meter, then releases its graph',async()=>{
  const storage=createStorage(new IDBFactory());
  const video={duration:60,currentTime:0,muted:false,playbackRate:1,pause(){},async play(){this.currentTime=1;},addEventListener(){},removeEventListener(){}};
  const mic={getTracks:()=>[{stop(){}}]},processed={},meterStreams=[];let disposed=0;
  class MediaRecorder{
    static isTypeSupported(){return true;}
    constructor(source){assert.equal(source,processed);this.state='inactive';this.mimeType='audio/webm';}
    start(){this.state='recording';}
    stop(){this.state='inactive';this.ondataavailable({data:new Blob(['amplified-vocal'])});queueMicrotask(()=>this.onstop());}
  }
  const {nodes}=await mount(storage,{video,globals:{MediaRecorder,
    navigator:{mediaDevices:{async getUserMedia(){return mic;}}},
    EchoMicrophone:{...require('../extension/microphone.js'),async createInput(source,db){assert.equal(source,mic);assert.equal(db,16);return {stream:processed,db,dispose(){disposed++;}};}},
    EchoLiveMeter:{start({stream}){meterStreams.push(stream);return {dispose(){}};}},
    requestAnimationFrame:fn=>setTimeout(fn,0),cancelAnimationFrame:clearTimeout}});
  nodes.get('activityMode').value='sing';nodes.get('activityMode').onchange();
  nodes.get('recordingPlayback').value='silent';nodes.get('recordingPlayback').onchange();
  nodes.get('practiceScope').value='clip';nodes.get('practiceScope').onchange();
  nodes.get('start').value='0';nodes.get('end').value='1';
  nodes.get('manualGainDb').value='16';nodes.get('manualGainDb').oninput();
  await nodes.get('record').onclick();
  const [take]=await storage.listTakes('video');
  assert.equal(take.inputGainDb,16);assert.equal(take.autoGainControl,false);
  assert.equal(await take.blob.text(),'amplified-vocal');assert.deepEqual(meterStreams,[processed]);assert.equal(disposed,1);
  (await storage.ready).close();
});

function leadInVideo({hold=false}={}){
  const events=new Map(),plays=[],seeks=[];let time=0;
  return {duration:60,muted:true,playbackRate:1.25,plays,seeks,pause(){},advance(value){time=value;for(const fn of [...events.get('timeupdate') || []])fn();},
    get currentTime(){return time;},set currentTime(value){time=value;seeks.push(value);queueMicrotask(()=>{for(const fn of events.get('seeked') || [])fn();});},
    addEventListener(name,fn){if(!events.has(name))events.set(name,new Set());events.get(name).add(fn);},
    removeEventListener(name,fn){events.get(name)?.delete(fn);},
    async play(){plays.push({at:time,muted:this.muted});if(!hold)time=plays.length===1?10:11;}
  };
}
for(const withBacking of [false,true])for(const leadMode of ['seconds','previous'])test(`recording ${leadMode} lead-in ${withBacking?'with backing':'without backing'} plays context without recording it and preserves the saved range`,async()=>{
  const storage=createStorage(new IDBFactory()),video=leadInVideo(),starts=[];
  video.volume=.7;const rates=[],play=video.play;video.play=async function(){rates.push(this.playbackRate);return play.call(this);};
  await storage.saveSession({videoId:'video',activity:withBacking?'sing':'speech',scopes:{sing:'clip',speech:'clip'},useBacking:withBacking,backingPreferences:{sing:withBacking,speech:false},start:10,end:11,speed:'0.5',cues:[{start:5,end:8,text:'Previous'},{start:10,end:11,text:'Selected'}],leadInMode:leadMode,leadInSeconds:3});
  if(withBacking)await storage.saveBacking({key:'music',videoId:'video',start:0,end:60,createdAt:1,blob:new Blob(['music'])});
  const mic={getTracks:()=>[{stop(){}}]};
  class MediaRecorder{
    static isTypeSupported(){return true;}
    constructor(){this.state='inactive';this.mimeType='audio/webm';}
    start(){starts.push(video.currentTime);this.state='recording';}
    stop(){this.state='inactive';this.ondataavailable({data:new Blob(['only-target-vocal'])});queueMicrotask(()=>this.onstop());}
  }
  const {nodes}=await mount(storage,{video,globals:{MediaRecorder,navigator:{mediaDevices:{async getUserMedia(){return mic;}}},
    EchoKaraoke:{...require('../extension/karaoke.js'),async createMonitor(options){
      assert.equal(withBacking,true);assert.equal(video.plays.length,0);
      assert.equal(options.speed,1);assert.equal(options.initialPosition,10);assert.equal(options.fadeInSeconds,.04);
      return {async sync(position){assert.equal(position,10);assert.equal(starts.length,1);setTimeout(()=>video.advance(11),60);},pause(){},dispose(){},setVolume(){}};
    }},
    requestAnimationFrame:fn=>setTimeout(fn,1),cancelAnimationFrame:clearTimeout}});
  assert.equal(nodes.get('leadInSeconds').value,3);
  await nodes.get('record').onclick();
  assert.deepEqual(video.plays,withBacking?[{at:leadMode==='previous'?5:7,muted:false}]:[{at:leadMode==='previous'?5:7,muted:false},{at:10,muted:true}]);assert.deepEqual(starts,[10]);
  assert.deepEqual(video.seeks,[leadMode==='previous'?5:7]);
  const [take]=await storage.listTakes('video');assert.equal(take.start,10);assert.equal(take.end,11);assert.equal(take.speed,1);assert.deepEqual(rates,withBacking?[1]:[1,1]);assert.equal(nodes.get('speed').value,'0.5');
  assert.equal(await take.blob.text(),'only-target-vocal');assert.equal(video.muted,true);assert.equal(video.playbackRate,1.25);
  assert.equal(video.volume,.7);
  nodes.get('leadInSeconds').value='5';nodes.get('leadInSeconds').onchange();
  await new Promise(r=>setTimeout(r,5));assert.equal((await storage.getSession('video')).leadInSeconds,5);
  (await storage.ready).close();
});
test('backing handoff keeps the original and video running until delayed monitor playback is ready',async()=>{
  const storage=createStorage(new IDBFactory()),video=leadInVideo({hold:true});let releaseMonitor,pauses=0;
  video.volume=.7;video.pause=()=>{pauses++;};
  await storage.saveSession({videoId:'video',activity:'sing',scopes:{sing:'clip'},recordingPlaybackPreferences:{sing:'backing'},start:10,end:15,speed:'1',cues:[],leadInMode:'seconds',leadInSeconds:3,backingVolume:.4});
  await storage.saveBacking({key:'music',videoId:'video',start:0,end:60,createdAt:1,blob:new Blob(['music'])});
  class MediaRecorder{static isTypeSupported(){return true;}constructor(){this.state='inactive';this.mimeType='audio/webm';}
    start(){this.state='recording';}stop(){this.state='inactive';this.ondataavailable({data:new Blob(['voice'])});queueMicrotask(()=>this.onstop());}}
  const {nodes}=await mount(storage,{video,globals:{MediaRecorder,navigator:{mediaDevices:{getUserMedia:async()=>({getTracks:()=>[{stop(){}}]})}},
    EchoKaraoke:{...require('../extension/karaoke.js'),async createMonitor(){return {sync(position,options){assert.equal(position,10.016);assert.equal(options.followVideo,true);return new Promise(resolve=>{releaseMonitor=resolve;});},position:()=>10,pause(){},dispose(){},setVolume(){}};}},
    requestAnimationFrame:fn=>setTimeout(fn,1),cancelAnimationFrame:clearTimeout}});
  const pending=nodes.get('record').onclick();await waitUntil(()=>video.plays.length===1);
  const before=pauses;video.advance(10.016);await waitUntil(()=>!!releaseMonitor);
  assert.equal(pauses,before);assert.equal(video.muted,false);assert.equal(video.volume,.4);
  assert.deepEqual(video.seeks,[7]);assert.equal(video.plays.length,1);
  video.advance(10.25);releaseMonitor();await waitUntil(()=>video.muted);
  assert.equal(video.currentTime,10.25);assert.equal(pauses,before);assert.equal(video.plays.length,1);assert.equal(video.volume,.7);
  nodes.get('stop').onclick();await pending;(await storage.ready).close();
});

test('stopping during the lead-in cancels preparation, releases the mic and saves no empty take',async()=>{
  const storage=createStorage(new IDBFactory()),video=leadInVideo({hold:true});let stops=0,starts=0;video.volume=.7;
  await storage.saveSession({videoId:'video',start:10,end:11,speed:'1',cues:[],leadInSeconds:3,backingVolume:.4});
  class MediaRecorder{static isTypeSupported(){return true;}constructor(){this.state='inactive';}start(){starts++;}}
  const {nodes}=await mount(storage,{video,globals:{MediaRecorder,
    navigator:{mediaDevices:{async getUserMedia(){return {getTracks:()=>[{stop(){stops++;}}]};}}},
    requestAnimationFrame:fn=>setTimeout(fn,1),cancelAnimationFrame:clearTimeout}});
  const pending=nodes.get('record').onclick();
  for(let i=0;i<30 && !video.plays.length;i++)await new Promise(r=>setTimeout(r,2));
  assert.equal(video.plays.length,1);assert.match(nodes.get('status').textContent,/准备录音/);
  assert.equal(nodes.get('leadInSeconds').disabled,true);
  assert.equal(nodes.get('activityMode').hidden,true);assert.equal(nodes.get('clipBounds').hidden,true);
  assert.equal(nodes.get('practiceTools').hidden,true);assert.equal(nodes.get('practiceSettings').hidden,true);
  assert.equal(nodes.get('liveMeter').hidden,false);assert.equal(nodes.get('stop').textContent,'■ 取消准备');
  assert.equal(video.volume,.4);
  nodes.get('backingLiveVolume').value='.2';nodes.get('backingLiveVolume').oninput();assert.equal(video.volume,.2);
  assert.equal(starts,0); // Preparation shows the recording UI without recording context audio.
  nodes.get('stop').onclick();await pending;
  assert.equal(nodes.get('liveMeter').hidden,true);assert.equal(nodes.get('activityMode').hidden,false);
  assert.equal(starts,0);assert(stops>=1);assert.equal((await storage.listTakes('video')).length,0);
  assert.equal(video.volume,.7);
  assert.equal(video.muted,true);assert.equal(video.playbackRate,1.25);assert.equal(nodes.get('record').disabled,false);
  (await storage.ready).close();
});
test('listening includes the configured context while recorded comparison keeps the exact range',async()=>{
  const storage=createStorage(new IDBFactory()),video=leadInVideo();
  await storage.saveSession({videoId:'video',start:10,end:11,speed:'1',cues:[],leadInSeconds:3,selectedTakeId:'compare-lead'});
  await storage.saveTake({id:'compare-lead',videoId:'video',cueKey:'manual:10:11',start:10,end:11,speed:1,createdAt:1,blob:new Blob(['voice'])});
  class Audio{constructor(){this.currentTime=0;this.duration=1;}pause(){}async play(){this.currentTime=1;queueMicrotask(()=>this.onended?.());}}
  // End the source preview immediately; playback still uses its real end watcher.
  video.play=async function(){this.plays.push({at:this.currentTime,muted:this.muted});this.currentTime=11;};
  const {nodes,document,events}=await mount(storage,{video,globals:{Audio,requestAnimationFrame:fn=>setTimeout(fn,1),cancelAnimationFrame:clearTimeout}});
  await nodes.get('original').onclick();assert.equal(video.plays[0].at,7);
  assert.equal(nodes.get('start').value,10);assert.equal(nodes.get('end').value,11);
  document.documentElement.children[0].style.display='block';
  events.get('keydown')({altKey:true,shiftKey:true,code:'KeyC',preventDefault(){},stopPropagation(){}});
  await waitUntil(()=>nodes.get('reviewReplay').disabled===false);assert.equal(video.plays[1].at,10);
  (await storage.ready).close();
});

test('paragraph mode restores, keeps multi-sentence bounds during browsing, records as one take and previews assembly',async()=>{
  const storage=createStorage(new IDBFactory());
  const cues=[0,1,2,3].map(i=>({start:i*3,end:i*3+2.8,text:`Line ${i+1}`}));
  await storage.saveSession({videoId:'video',activity:'sing',useBacking:false,cues,index:1,start:3,end:11.8,speed:'1',karaokeScope:'paragraph',paragraphFirst:1,paragraphLast:3});
  const video=leadInVideo();video.duration=30;video.play=async function(){this.currentTime=11.8;};
  class MediaRecorder{
    static isTypeSupported(){return true;}
    constructor(){this.state='inactive';this.mimeType='audio/webm';}
    start(){this.state='recording';}
    stop(){this.state='inactive';this.ondataavailable({data:new Blob(['whole-paragraph'])});queueMicrotask(()=>this.onstop());}
  }
  const {nodes}=await mount(storage,{video,globals:{MediaRecorder,
    navigator:{mediaDevices:{async getUserMedia(){return {getTracks:()=>[{stop(){}}]};}}},
    requestAnimationFrame:fn=>setTimeout(fn,1),cancelAnimationFrame:clearTimeout}});
  assert.equal(nodes.get('practiceScope').value,'paragraph');assert.equal(nodes.get('paragraphSelection').hidden,false);
  assert.equal(nodes.get('paragraphFirst').value,'1');assert.equal(nodes.get('paragraphLast').value,'3');
  assert.match(nodes.get('record').textContent,/开始段落录唱/);assert.match(nodes.get('clipSummary').textContent,/第 2–4 句/);
  assert.equal(nodes.get('start').disabled,true);assert.equal(nodes.get('autoNext').disabled,true);
  nodes.get('next').onclick();assert.equal(Number(nodes.get('start').value),3);assert.equal(Number(nodes.get('end').value),11.8);
  await nodes.get('record').onclick();
  const [take]=await storage.listTakes('video');assert.equal(take.start,3);assert.equal(take.end,11.8);assert.equal(take.kind,'song');
  assert.match(take.label,/第 2–4 句/);assert.equal(await take.blob.text(),'whole-paragraph');
  assert.match(nodes.get('assembleSong').title,/已选 8.8 \/ 30.0 秒/);
  await nodes.get('assembleSong').onclick();assert.equal(nodes.get('assemblyDialog').open,true);assert.match(nodes.get('assemblyEditorInfo').textContent,/8.8 \/ 30.0/);nodes.get('closeAssembly').onclick();
  nodes.get('paragraphFirst').value='0';nodes.get('paragraphFirst').onchange();
  nodes.get('paragraphLast').value='2';nodes.get('paragraphLast').onchange();
  await new Promise(r=>setTimeout(r,5));const session=await storage.getSession('video');assert.equal(session.paragraphFirst,0);assert.equal(session.paragraphLast,2);assert.equal(session.end,8.8);
  const restored=(await mount(storage)).nodes;assert.equal(restored.get('practiceScope').value,'paragraph');assert.equal(Number(restored.get('end').value),8.8);
  (await storage.ready).close();
});

test('shared main controls and automatic practice use the same whole-song range and remember preparation',async()=>{
  const storage=createStorage(new IDBFactory()),video=leadInVideo(),plays=[];
  video.duration=30;video.play=async function(){plays.push(this.currentTime);this.currentTime=30;};
  await storage.saveSession({videoId:'video',activity:'sing',useBacking:false,karaokeScope:'whole',cues:[{start:10,end:12,text:'A single line'}],index:0,start:10,end:12,speed:'1',prepSeconds:'0',loopCount:'5',autoNext:true});
  class MediaRecorder{
    static isTypeSupported(){return true;}
    constructor(){this.state='inactive';this.mimeType='audio/webm';}
    start(){this.state='recording';}
    stop(){this.state='inactive';this.ondataavailable({data:new Blob(['full-song'])});queueMicrotask(()=>this.onstop());}
  }
  class Audio{constructor(){this.currentTime=0;this.duration=30;}pause(){}async play(){this.currentTime=30;queueMicrotask(()=>this.onended?.());}}
  const {nodes}=await mount(storage,{video,globals:{MediaRecorder,Audio,
    navigator:{mediaDevices:{async getUserMedia(){return {getTracks:()=>[{stop(){}}]};}}},
    requestAnimationFrame:fn=>setTimeout(fn,1),cancelAnimationFrame:clearTimeout}});
  assert.equal(nodes.get('prepSeconds').value,'0');assert.equal(nodes.get('loopCount').value,'5');
  assert.equal(nodes.get('autoNext').disabled,true);assert.equal(nodes.get('clipBounds').hidden,true);
  assert.match(nodes.get('clipSummary').textContent,/整首.*0.0–30.0/);
  await nodes.get('autoPractice').onclick();
  const [take]=await storage.listTakes('video');assert.equal(take.start,0);assert.equal(take.end,30);assert.equal(take.kind,'song');
  assert.equal(plays[0],0);assert.equal(plays[1],0);assert.match(nodes.get('status').textContent,/自动跟读完成/);
  nodes.get('prepSeconds').value='2';nodes.get('prepSeconds').onchange();await new Promise(r=>setTimeout(r,5));
  assert.equal((await storage.getSession('video')).prepSeconds,'2');
  (await storage.ready).close();
});

test('assembly editor auditions an older version, excludes ranges, persists choices and downloads the same selection',async()=>{
  const storage=createStorage(new IDBFactory()),requests=[];
  for(const [id,time] of [['older',1],['newer',2]])await storage.saveTake({id,videoId:'video',kind:'song',capture:'vocal',cueKey:'same',label:id,start:0,end:10,speed:1,createdAt:time,blob:new Blob([id])});
  const overrides={video:{duration:20,pause(){}},globals:{setTimeout:(fn,ms)=>setTimeout(fn,ms===30000?0:ms),
    EchoAudioExport:{...require('../extension/audio-export.js'),async render(options){requests.push(options);return {blob:new Blob(['selected-preview']),gaps:[]};}}}};
  const {nodes,downloads}=await mount(storage,overrides);
  await nodes.get('assembleSong').onclick();assert.equal(nodes.get('assemblyDialog').open,true);assert.equal(requests.length,0);
  const row=nodes.get('assemblyEditorList').children[0],older=row.children[1].children[1],check=row.children[0].children[0].children[0];
  older.children[0].onclick();await older.children[1].onclick();
  assert.equal(requests[0].duration,10);assert.equal(requests[0].selection[0].takeId,'older');assert.equal(nodes.get('assemblyAudio').hidden,false);
  check.checked=false;check.onchange();assert.equal(nodes.get('assemblyDownload').disabled,true);assert.equal(nodes.get('assemblyAudio').hidden,true);
  check.checked=true;check.onchange();await nodes.get('assemblyPreview').onclick();await nodes.get('assemblyDownload').onclick();
  assert.deepEqual(requests[1].selection.map(s=>s.takeId),['older',null]);assert.equal(requests[1].duration,20);
  assert.deepEqual(requests[2].selection,requests[1].selection);assert.equal(downloads.length,1);
  nodes.get('closeAssembly').onclick();assert.equal(nodes.get('assemblyAudio').hidden,true);
  const restored=(await mount(storage,overrides)).nodes;await restored.get('assembleSong').onclick();
  assert.equal(restored.get('assemblyEditorList').children[0].children[1].children[1].children[0].getAttribute('aria-pressed'),'true');restored.get('closeAssembly').onclick();
  (await storage.ready).close();
});

for(const action of ['close','cancel'])test(`assembly ${action} fences a pending render so it cannot publish stale audio`,async()=>{
  const storage=createStorage(new IDBFactory());let resolve;
  await storage.saveTake({id:'voice',videoId:'video',kind:'song',capture:'vocal',cueKey:'voice',start:0,end:5,speed:1,createdAt:1,blob:new Blob(['voice'])});
  const {nodes,downloads}=await mount(storage,{video:{duration:10,pause(){}},globals:{
    EchoAudioExport:{...require('../extension/audio-export.js'),render:()=>new Promise(r=>{resolve=r;})}}});
  await nodes.get('assembleSong').onclick();const pending=nodes.get('assemblyPreview').onclick();
  assert.equal(nodes.get('assemblyDownload').disabled,true);
  nodes.get(action==='close'?'closeAssembly':'assemblyCancelRender').onclick();
  resolve({blob:new Blob(['late audio'])});await pending;
  assert.equal(nodes.get('assemblyAudio').hidden,true);assert.equal(downloads.length,0);
  if(action==='cancel'){assert.equal(nodes.get('assemblyDialog').open,true);assert.equal(nodes.get('assemblyDownload').disabled,false);nodes.get('closeAssembly').onclick();}
  else assert.equal(nodes.get('assemblyDialog').open,false);
  (await storage.ready).close();
});

test('fold preferences survive mode changes and remount without breaking settings summaries',async()=>{
  const storage=createStorage(new IDBFactory()),preferences=new Map();
  const localStorage={getItem:key=>preferences.get(key) || null,setItem:(key,value)=>preferences.set(key,value)};
  const globals={window:{localStorage,addEventListener(){},speechSynthesis:{cancel(){}}}};
  const {nodes}=await mount(storage,{globals});
  nodes.get('mixControls').open=true;nodes.get('mixControls').dispatchEvent({type:'toggle'});
  nodes.get('recordingDetails').open=false;nodes.get('recordingDetails').dispatchEvent({type:'toggle'});
  nodes.get('activityMode').value='sing';nodes.get('activityMode').onchange();
  assert.equal(nodes.get('mixControls').open,true);assert.equal(nodes.get('recordingDetails').open,false);
  nodes.get('leadInMode').value='seconds';nodes.get('leadInMode').onchange();
  nodes.get('leadInSeconds').value=5;nodes.get('leadInSeconds').onchange();
  assert.match(nodes.get('practiceToolsState').textContent,/前置 5 秒.*循环 3 次/);
  nodes.get('manualGainDb').value=6;nodes.get('manualGainDb').oninput();
  assert.match(nodes.get('speedSummary').textContent,/增益 \+6 dB/);
  const restored=await mount(storage,{globals});
  assert.equal(restored.nodes.get('mixControls').open,true);
  assert.equal(restored.nodes.get('recordingDetails').open,false);
  (await storage.ready).close();
});

for(const quality of ['high','lossless'])test(`recording quality ${quality} persists, reaches the encoder and saves actual capture details`,async()=>{
  const storage=createStorage(new IDBFactory()),video=leadInVideo(),preferences=new Map();let options;
  const track={getSettings:()=>({sampleRate:48000,channelCount:1,echoCancellation:false,noiseSuppression:false,autoGainControl:false}),stop(){}};
  class MediaRecorder{
    static isTypeSupported(){return true;}
    constructor(stream,opts){options=opts;this.state='inactive';this.mimeType=opts.mimeType;this.audioBitsPerSecond=opts.audioBitsPerSecond || 128000;}
    start(){this.state='recording';}
    stop(){this.state='inactive';this.ondataavailable({data:new Blob(['voice'])});queueMicrotask(()=>this.onstop());}
  }
  const globals={MediaRecorder,window:{localStorage:{getItem:key=>preferences.get(key) || null,setItem:(key,value)=>preferences.set(key,value)},addEventListener(){},speechSynthesis:{cancel(){}}},navigator:{mediaDevices:{async getUserMedia(){return {getTracks:()=>[track]};}}},requestAnimationFrame:fn=>setTimeout(fn,1),cancelAnimationFrame:clearTimeout};
  const {nodes}=await mount(storage,{video,globals});
  nodes.get('recordingQuality').value=quality;nodes.get('recordingQuality').onchange();
  assert.equal(JSON.parse(preferences.get('echo-microphone-v1')).recordingQuality,quality);
  await nodes.get('record').onclick();
  assert.equal(options.mimeType,`audio/webm;codecs=${quality==='lossless'?'pcm':'opus'}`);
  const [take]=await storage.listTakes('video');assert.equal(take.recordingInfo.microphone.sampleRate,48000);assert.equal(take.recordingInfo.quality,quality);
  assert.match(nodes.get('recordingTechnical').textContent,/48 kHz/);
  const restored=await mount(storage,{video,globals});assert.equal(restored.nodes.get('recordingQuality').value,quality);
  (await storage.ready).close();
});
test('practice settings persist the recording version limit and pass it to new captures',async()=>{
  const storage=createStorage(new IDBFactory()),preferences=new Map(),limits=[];
  const save=storage.saveTake.bind(storage);storage.saveTake=(value,options)=>{limits.push(options.maxTakes);return save(value,options);};
  class MediaRecorder{
    static isTypeSupported(){return true;}
    constructor(){this.state='inactive';this.mimeType='audio/webm';}
    start(){this.state='recording';}
    stop(){this.state='inactive';this.ondataavailable({data:new Blob(['voice'])});queueMicrotask(()=>this.onstop());}
  }
  const globals={MediaRecorder,window:{localStorage:{getItem:key=>preferences.get(key) ?? null,setItem:(key,value)=>preferences.set(key,value)},addEventListener(){},speechSynthesis:{cancel(){}}},
    navigator:{mediaDevices:{async getUserMedia(){return {getTracks:()=>[{stop(){}}]};}}},requestAnimationFrame:fn=>setTimeout(fn,1),cancelAnimationFrame:clearTimeout};
  const {nodes}=await mount(storage,{video:leadInVideo(),globals});
  assert.equal(nodes.get('takeLimit').value,'3');
  for(const limit of ['5','0']){
    nodes.get('takeLimit').value=limit;nodes.get('takeLimit').onchange();
    await nodes.get('record').onclick();
    assert.equal(limits.at(-1),Number(limit));
  }
  assert.match(nodes.get('takeRetentionInfo').textContent,/全部版本/);
  const before=(await storage.listTakes('video')).length;
  nodes.get('takeLimit').value='1';nodes.get('takeLimit').onchange();
  assert.equal((await storage.listTakes('video')).length,before);
  const restored=await mount(storage,{video:leadInVideo(),globals});assert.equal(restored.nodes.get('takeLimit').value,'1');
  assert.match(restored.nodes.get('takeRetentionInfo').textContent,/最近 1 个/);
  (await storage.ready).close();
});

test('unsupported lossless recording stops before requesting microphone permission',async()=>{
  const storage=createStorage(new IDBFactory());let requests=0;
  class MediaRecorder{static isTypeSupported(type){return !type.includes('pcm');}}
  const {nodes}=await mount(storage,{globals:{MediaRecorder,navigator:{mediaDevices:{async getUserMedia(){requests++;}}}}});
  nodes.get('recordingQuality').value='lossless';nodes.get('recordingQuality').onchange();
  assert.equal(nodes.get('losslessQuality').disabled,true);
  await nodes.get('record').onclick();assert.equal(requests,0);assert.match(nodes.get('status').textContent,/不支持无损/);
  (await storage.ready).close();
});

for(const [scope,start,end] of [['whole',0,12],['paragraph',4,10],['clip',4,6]])test(`speech ${scope} scope controls listening, recording, auto practice and restoration`,async()=>{
  const storage=createStorage(new IDBFactory()),video=leadInVideo();let advances=0;
  video.duration=12;video.play=async function(){this.plays.push({at:this.currentTime,muted:this.muted});this.currentTime=end;};
  const cues=[0,4,8].map((start,i)=>({start,end:start+2,text:'Line '+i}));
  await storage.saveSession({videoId:'video',activity:'speech',speechScope:scope,karaokeScope:'whole',start:4,end:6,index:1,cues,speed:'1',paragraphFirst:1,paragraphLast:2,prepSeconds:'0',autoNext:true});
  class MediaRecorder{static isTypeSupported(){return true;}constructor(){this.state='inactive';this.mimeType='audio/webm;codecs=opus';}start(){this.state='recording';}stop(){this.state='inactive';this.ondataavailable({data:new Blob(['speech-range'])});queueMicrotask(()=>this.onstop());}}
  const globals={MediaRecorder,navigator:{mediaDevices:{async getUserMedia(){return {getTracks:()=>[{stop(){}}]};}}},requestAnimationFrame:fn=>setTimeout(fn,1),cancelAnimationFrame:clearTimeout,
    EchoPractice:{...require('../extension/practice.js'),async runPractice({listen,record,advance}){await listen();await record();advances+=Number(advance());}}};
  const {nodes}=await mount(storage,{video,globals});
  assert.equal(nodes.get('scopeControls').hidden,false);assert.equal(nodes.get('practiceScope').disabled,false);
  assert.equal(nodes.get('practiceScope').value,scope);assert.equal(nodes.get('clipBounds').hidden,scope!=='clip');
  assert.equal(nodes.get('autoNext').disabled,scope!=='clip');
  await nodes.get('original').onclick();assert.equal(video.plays[0].at,start);
  await nodes.get('record').onclick();
  let [take]=await storage.listTakes('video');assert.equal(take.start,start);assert.equal(take.end,end);assert.equal(take.kind,undefined);
  assert.equal(take.cueKey,scope==='clip'?cueKey(cues[1]):cueKey(null,start,end));
  if(scope!=='clip'){
    await nodes.get('autoPractice').onclick();assert.equal(advances,0);
    [take]=await storage.listTakes('video');assert.equal(take.start,start);assert.equal(take.end,end);
  }
  nodes.get('activityMode').value='sing';nodes.get('activityMode').onchange();assert.equal(nodes.get('practiceScope').value,'whole');
  nodes.get('activityMode').value='speech';nodes.get('activityMode').onchange();assert.equal(nodes.get('practiceScope').value,scope);
  await new Promise(r=>setTimeout(r,5));
  const restored=await mount(storage,{video,globals});assert.equal(restored.nodes.get('practiceScope').value,scope);
  (await storage.ready).close();
});
test('legacy speech sessions keep clip mode and whole-video scope rejects videos over ten minutes',async()=>{
  const storage=createStorage(new IDBFactory());let requests=0;
  await storage.saveSession({videoId:'video',activity:'speech',karaokeScope:'whole',start:3,end:5,cues:[],index:-1});
  const {nodes}=await mount(storage,{video:{duration:601,pause(){}},globals:{navigator:{mediaDevices:{async getUserMedia(){requests++;}}}}});
  assert.equal(nodes.get('practiceScope').value,'clip');
  nodes.get('practiceScope').value='whole';nodes.get('practiceScope').onchange();await nodes.get('record').onclick();
  assert.equal(requests,0);assert.match(nodes.get('status').textContent,/10 分钟/);
  (await storage.ready).close();
});

test('reusing a saved recording switches paragraph practice to its exact clip bounds',async()=>{
  const storage=createStorage(new IDBFactory()),cues=[0,4,8].map((start,i)=>({start,end:start+2,text:'Line '+i}));
  await storage.saveSession({videoId:'video',activity:'speech',speechScope:'paragraph',start:0,end:10,cues,index:0,paragraphFirst:0,paragraphLast:2});
  await storage.saveTake({id:'saved-range',videoId:'video',cueKey:cueKey(null,4,6),start:4,end:6,speed:1,createdAt:1,blob:new Blob(['voice'])});
  const {nodes}=await mount(storage);nodes.get('tab-recordings').onclick();nodes.get('reuseSongRange').onclick();
  assert.equal(nodes.get('practiceScope').value,'clip');assert.equal(Number(nodes.get('start').value),4);assert.equal(Number(nodes.get('end').value),6);
  (await storage.ready).close();
});

test('ordinary and automatic singing use the same selected-sentence version bucket',async()=>{
  const storage=createStorage(new IDBFactory()),video=leadInVideo(),cue={start:0,end:1,text:'Same lyric'};
  video.play=async function(){this.currentTime=1;};
  await storage.saveSession({videoId:'video',activity:'sing',useBacking:false,karaokeScope:'clip',start:0,end:1,speed:'1',cues:[cue],index:0,prepSeconds:'0'});
  class MediaRecorder{static isTypeSupported(){return true;}constructor(stream,options){this.state='inactive';this.mimeType=options.mimeType;}start(){this.state='recording';}stop(){this.state='inactive';this.ondataavailable({data:new Blob(['voice'])});queueMicrotask(()=>this.onstop());}}
  const {nodes}=await mount(storage,{video,globals:{MediaRecorder,navigator:{mediaDevices:{async getUserMedia(){return {getTracks:()=>[{stop(){}}]};}}},requestAnimationFrame:fn=>setTimeout(fn,1),cancelAnimationFrame:clearTimeout,
    EchoPractice:{...require('../extension/practice.js'),async runPractice({record}){await record();}}}});
  await nodes.get('record').onclick();await nodes.get('autoPractice').onclick();
  const takes=await storage.listTakes('video');assert.equal(takes.length,2);assert.deepEqual([...new Set(takes.map(t=>t.cueKey))],[`song:${cueKey(cue)}`]);
  assert.equal(nodes.get('versionChoices').children.length,2);
  (await storage.ready).close();
});
test('a late recording stop after navigating away and back cannot replace the next capture UI',async()=>{
  const storage=createStorage(new IDBFactory()),video=leadInVideo({hold:true}),instances=[],stops=[];
  const location={href:'https://www.youtube.com/watch?v=video',pathname:'/watch'};
  class MediaRecorder{static isTypeSupported(){return true;}constructor(stream,options){this.state='inactive';this.mimeType=options.mimeType;instances.push(this);}start(){this.state='recording';}stop(){this.state='inactive';this.ondataavailable({data:new Blob(['voice-'+instances.indexOf(this)])});}}
  const {nodes,events}=await mount(storage,{video,globals:{location,MediaRecorder,navigator:{mediaDevices:{async getUserMedia(){const index=stops.length;stops.push(0);return {getTracks:()=>[{stop(){stops[index]++;}}]};}}},requestAnimationFrame:fn=>setTimeout(fn,1),cancelAnimationFrame:clearTimeout}});
  const first=nodes.get('record').onclick();await waitUntil(()=>instances[0]?.state==='recording');
  location.href='https://www.youtube.com/watch?v=other';events.get('yt-navigate-finish')();await waitUntil(()=>!nodes.get('read').disabled);
  location.href='https://www.youtube.com/watch?v=video';events.get('yt-navigate-finish')();await waitUntil(()=>!nodes.get('read').disabled);
  const second=nodes.get('record').onclick();await waitUntil(()=>instances[1]?.state==='recording');
  instances[0].onstop();await first;
  assert.equal(instances[1].state,'recording');assert.equal(stops[1],0);
  assert.equal(nodes.get('record').disabled,true);assert.equal(nodes.get('stop').textContent,'■ 结束录音');assert.equal(nodes.get('liveMeter').hidden,false);
  nodes.get('stop').onclick();instances[1].onstop();await second;
  assert.equal((await storage.listTakes('video')).length,2);assert.deepEqual(stops,[1,1]);
  (await storage.ready).close();
});

test('plain dubbing starts capture before video playback and records startup offset',async()=>{
  const storage=createStorage(new IDBFactory()),video=leadInVideo({hold:true});let instance,now=0;
  class MediaRecorder{static isTypeSupported(){return true;}constructor(stream,options){instance=this;this.state='inactive';this.mimeType=options.mimeType;}start(){this.state='recording';}stop(){this.state='inactive';this.ondataavailable({data:new Blob(['complete-opening'])});queueMicrotask(()=>this.onstop());}}
  video.play=async function(){assert.equal(instance.state,'recording');now=300;};
  const {nodes}=await mount(storage,{video,globals:{MediaRecorder,performance:{now:()=>now},navigator:{mediaDevices:{async getUserMedia(){return {getTracks:()=>[{stop(){}}]};}}},requestAnimationFrame:fn=>setTimeout(fn,1),cancelAnimationFrame:clearTimeout}});
  nodes.get('end').value=1;nodes.get('end').onchange();
  const pending=nodes.get('record').onclick();await waitUntil(()=>!nodes.get('transport').hidden);video.currentTime=1;await pending;
  const [take]=await storage.listTakes('video');assert.equal(take.vocalOffset,.3);assert.equal(take.start,0);assert.equal(take.end,1);
  (await storage.ready).close();
});

test('background model choice is remembered for speech while singing keeps Demucs and its own cache',async()=>{
  const storage=createStorage(new IDBFactory());
  await storage.saveSession({videoId:'video',activity:'speech',start:0,end:5,useBacking:true,backingPreferences:{speech:true,sing:true},modelPreferences:{speech:'bandit-v2-multi'},cues:[],index:-1});
  await storage.saveBacking({videoId:'video',key:'video:0.000:5.000',start:0,end:5,createdAt:1,blob:new Blob(['demucs'])});
  const {nodes}=await mount(storage);
  assert.equal(nodes.get('backingModel').value,'bandit-v2-multi');
  assert.equal(nodes.get('previewBacking').disabled,true);
  nodes.get('backingModel').value='demucs-htdemucs';nodes.get('backingModel').onchange();
  assert.equal(nodes.get('previewBacking').disabled,false);
  nodes.get('backingModel').value='bandit-v2-multi';nodes.get('backingModel').onchange();
  nodes.get('activityMode').value='sing';nodes.get('activityMode').onchange();
  assert.equal(nodes.get('backingModel').value,'demucs-htdemucs');assert.equal(nodes.get('banditModelOption').disabled,true);
  nodes.get('activityMode').value='speech';nodes.get('activityMode').onchange();
  assert.equal(nodes.get('backingModel').value,'bandit-v2-multi');
  await new Promise(r=>setTimeout(r,10));
  assert.equal((await storage.getSession('video')).modelPreferences.speech,'bandit-v2-multi');
  (await storage.ready).close();
});

test('model dialog installs on demand and asks before deleting only weights',async()=>{
  const storage=createStorage(new IDBFactory()),calls=[];
  const catalog={models:[{id:'bandit-v2-multi',name:'BandIt',purpose:'电影',ready:false,state:'missing',downloadBytes:446680129,weightBytes:0}],busy:false,dependencyBytes:0};
  const {nodes}=await mount(storage,{globals:{chrome:{runtime:{onMessage:{addListener(){}},async sendMessage(message){calls.push(message.action);return catalog;}}}}});
  await nodes.get('manageModels').onclick();assert.equal(nodes.get('modelDialog').open,true);
  const card=nodes.get('modelList').children[0];
  await card.children.at(-1).children[0].onclick();assert.ok(calls.includes('model-install'));
  catalog.models[0]={...catalog.models[0],ready:true,state:'ready',weightBytes:446680129};
  await nodes.get('refreshModels').onclick();
  nodes.get('modelList').children[0].children.at(-1).children[0].onclick();
  assert.equal(nodes.get('modelConfirm').hidden,false);assert.ok(!calls.includes('model-remove'));
  await nodes.get('modelConfirmYes').onclick();assert.ok(calls.includes('model-remove'));
  nodes.get('closeModels').onclick();assert.equal(nodes.get('modelDialog').open,false);
  (await storage.ready).close();
});

test('install-and-extract sends the selected model and saves a matching background cache',async()=>{
  const storage=createStorage(new IDBFactory()),calls=[];
  await storage.saveSession({videoId:'video',activity:'speech',start:0,end:5,useBacking:true,backingPreferences:{speech:true},modelPreferences:{speech:'bandit-v2-multi'},cues:[],index:-1});
  const catalog={models:[{id:'bandit-v2-multi',name:'BandIt',ready:false,state:'missing',downloadBytes:446680129,weightBytes:0}],busy:false,dependencyBytes:0};
  const {nodes}=await mount(storage,{video:{duration:60,pause(){}},health:()=>({service:'echo-karaoke',maxSeconds:600,modelManagement:true}),globals:{chrome:{runtime:{onMessage:{addListener(){}},async sendMessage(message){
    calls.push(message);
    if(message.action==='models')return catalog;
    if(message.action==='start')return {id:'a'.repeat(32),state:'ready',model:message.model};
    if(message.action==='audio')return {audio:'YXVkaW8=',mime:'audio/mpeg'};
    return {};
  }}}}});
  await nodes.get('checkKaraoke').onclick();
  assert.equal(nodes.get('prepareBacking').textContent,'安装并提取背景音');
  await nodes.get('prepareBacking').onclick();
  assert.equal(calls.find(call=>call.action==='start').model,'bandit-v2-multi');
  const [backing]=await storage.listBackings('video');
  assert.equal(backing.model,'bandit-v2-multi');assert.match(backing.key,/bandit-v2-multi$/);
  assert.equal(nodes.get('previewBacking').disabled,false);
  (await storage.ready).close();
});

test('Mac service display reflects CPU for BandIt and MPS for Demucs',async()=>{
  const storage=createStorage(new IDBFactory());
  await storage.saveSession({videoId:'video',activity:'speech',start:0,end:5,useBacking:true,modelPreferences:{speech:'bandit-v2-multi'},cues:[],index:-1});
  const {nodes}=await mount(storage,{health:()=>({service:'echo-karaoke',maxSeconds:600,device:'mps',deviceName:'Apple GPU'}),globals:{chrome:{runtime:{onMessage:{addListener(){}},async sendMessage(){return {};}}}}});
  await nodes.get('checkKaraoke').onclick();assert.match(nodes.get('karaokeService').textContent,/CPU（BandIt）/);
  nodes.get('backingModel').value='demucs-htdemucs';nodes.get('backingModel').onchange();
  assert.match(nodes.get('karaokeService').textContent,/GPU 加速/);
  (await storage.ready).close();
});

test('lossless selection uses chunked FLAC and remembers per-activity preferences',async()=>{
  const storage=createStorage(new IDBFactory()),calls=[];
  await storage.saveSession({videoId:'video',activity:'speech',start:0,end:5,useBacking:true,backingPreferences:{speech:true},cues:[],index:-1});
  const {nodes}=await mount(storage,{video:{duration:60,pause(){}},health:()=>({service:'echo-karaoke',maxSeconds:600,losslessBackings:true}),globals:{chrome:{runtime:{onMessage:{addListener(){}},async sendMessage(message){
    calls.push(message);
    if(message.action==='start')return {id:'a'.repeat(32),state:'ready',quality:message.quality};
    if(message.action==='audio-chunk')return {audio:'ZkxBQw==',offset:0,totalBytes:4,mime:'audio/flac'};
    return {};
  }}}}});
  nodes.get('backingQuality').value='lossless';nodes.get('backingQuality').onchange();
  await nodes.get('prepareBacking').onclick();
  assert.equal(calls.find(c=>c.action==='start').quality,'lossless');assert.ok(calls.some(c=>c.action==='audio-chunk'));assert.ok(!calls.some(c=>c.action==='audio'));
  const [backing]=await storage.listBackings('video');assert.equal(backing.quality,'lossless');assert.equal(backing.blob.type,'audio/flac');assert.match(backing.key,/:lossless$/);
  nodes.get('activityMode').value='sing';nodes.get('activityMode').onchange();assert.equal(nodes.get('backingQuality').value,'standard');
  nodes.get('activityMode').value='speech';nodes.get('activityMode').onchange();assert.equal(nodes.get('backingQuality').value,'lossless');
  await new Promise(r=>setTimeout(r,10));assert.equal((await storage.getSession('video')).qualityPreferences.speech,'lossless');
  (await storage.ready).close();
});

test('old service cannot silently return MP3 when lossless was selected',async()=>{
  const storage=createStorage(new IDBFactory());let starts=0;
  const {nodes}=await mount(storage,{video:{duration:60,pause(){}},globals:{chrome:{runtime:{onMessage:{addListener(){}},async sendMessage(message){if(message.action==='start')starts++;return {};}}}}});
  nodes.get('activityMode').value='sing';nodes.get('activityMode').onchange();
  nodes.get('backingQuality').value='lossless';nodes.get('backingQuality').onchange();
  await nodes.get('prepareBacking').onclick();assert.equal(starts,0);assert.match(nodes.get('karaokeNotice').textContent,/无损音质需要新版服务/);
  (await storage.ready).close();
});

test('input selection persists, applies to recording and auto-practice, and survives device removal without fallback',async()=>{
  const storage=createStorage(new IDBFactory()),preferences=new Map(),requests=[];let changed,stops=0;
  let devices=[{kind:'audioinput',deviceId:'usb',label:'USB microphone'}];
  const mediaDevices={enumerateDevices:async()=>devices,addEventListener(type,fn){if(type==='devicechange')changed=fn;},async getUserMedia(options){requests.push(options);if(options.audio.deviceId)throw Object.assign(Error('gone'),{name:'OverconstrainedError'});return {getTracks:()=>[{stop(){stops++;}}]};}};
  const globals={navigator:{mediaDevices},MediaRecorder:class{static isTypeSupported(){return true;}},window:{localStorage:{getItem:key=>preferences.get(key)||null,setItem:(key,value)=>preferences.set(key,value)},addEventListener(){},speechSynthesis:{cancel(){}}}};
  const {nodes}=await mount(storage,{globals});
  await waitUntil(()=>nodes.get('inputDevice').children.some(n=>n.value==='usb'));
  nodes.get('inputDevice').value='usb';nodes.get('inputDevice').onchange();
  await nodes.get('record').onclick();assert.equal(requests.at(-1).audio.deviceId.exact,'usb');assert.match(nodes.get('status').textContent,/所选麦克风不可用/);
  await nodes.get('autoPractice').onclick();assert.equal(requests.at(-1).audio.deviceId.exact,'usb');
  devices=[];changed();await waitUntil(()=>nodes.get('inputDevice').children.at(-1).textContent.includes('未连接'));
  assert.equal(nodes.get('inputDevice').value,'usb');
  await nodes.get('detectInputs').onclick();assert.equal(stops,1);assert.equal(requests.at(-1).audio.deviceId,undefined);
  const refreshed=await mount(storage,{globals});assert.equal(refreshed.nodes.get('inputDevice').value,'usb');
  nodes.get('inputDevice').value='';nodes.get('inputDevice').onchange();
  assert.equal(JSON.parse(preferences.get('echo-microphone-v1')).inputDeviceId,'');
  (await storage.ready).close();
});

test('sidetone is opt-in, persists volume and requests low latency only when enabled',async()=>{
  const storage=createStorage(new IDBFactory()),preferences=new Map(),requests=[];
  const globals={MediaRecorder:class{static isTypeSupported(){return true;}},navigator:{mediaDevices:{async getUserMedia(options){requests.push(options);throw Error('Fixture mic');}}},window:{localStorage:{getItem:key=>preferences.get(key)||null,setItem:(key,value)=>preferences.set(key,value)},addEventListener(){},speechSynthesis:{cancel(){}}}};
  const {nodes}=await mount(storage,{globals});assert.equal(nodes.get('sidetoneEnabled').checked,false);
  await nodes.get('record').onclick();assert.equal(requests.at(-1).audio.latency,undefined);
  nodes.get('sidetoneEnabled').checked=true;nodes.get('sidetoneEnabled').onchange();
  nodes.get('sidetoneMode').value='minimum';nodes.get('sidetoneMode').onchange();
  nodes.get('sidetoneVolume').value='0.6';nodes.get('sidetoneVolume').oninput();nodes.get('sidetoneVolume').onchange();
  await nodes.get('record').onclick();assert.equal(requests.at(-1).audio.latency.ideal,0);
  const refreshed=await mount(storage,{globals});assert.equal(refreshed.nodes.get('sidetoneEnabled').checked,true);assert.equal(refreshed.nodes.get('sidetoneVolume').value,0.6);assert.equal(refreshed.nodes.get('sidetoneMode').value,'minimum');
  (await storage.ready).close();
});

test('live latency diagnostics follow the active capture and persist in recording details',async()=>{
  const storage=createStorage(new IDBFactory()),video=leadInVideo({hold:true});let nodes;
  const info={mode:'minimum',inputLatency:null,baseLatency:0.0027,outputLatency:0.032};
  class MediaRecorder{
    static isTypeSupported(){return true;}
    constructor(){this.state='inactive';this.mimeType='audio/webm';}
    start(){this.state='recording';}
    stop(){this.state='inactive';this.ondataavailable({data:new Blob(['voice'])});queueMicrotask(()=>this.onstop());}
  }
  const mounted=await mount(storage,{video,globals:{MediaRecorder,navigator:{mediaDevices:{getUserMedia:async()=>({getTracks:()=>[{stop(){}}]})}},EchoMicrophone:{...require('../extension/microphone.js'),createInput:async(stream,db,env,options)=>{assert.equal(options.sidetoneMode,'minimum');return {stream,db:0,dispose(){},monitoringInfo:()=>info};}}}});
  nodes=mounted.nodes;nodes.get('sidetoneEnabled').checked=true;nodes.get('sidetoneEnabled').onchange();nodes.get('sidetoneMode').value='minimum';nodes.get('sidetoneMode').onchange();
  const recording=nodes.get('record').onclick();await waitUntil(()=>!nodes.get('sidetoneLatency').hidden);
  assert.equal(nodes.get('sidetoneMode').disabled,true);assert.match(nodes.get('sidetoneLatency').textContent,/输入 未报告.*图缓冲 2.7 ms.*输出 32.0 ms/);
  nodes.get('stop').onclick();await recording;
  assert.equal(nodes.get('sidetoneLatency').hidden,true);assert.match(nodes.get('recordingTechnical').textContent,/更低延迟/);
  const [take]=await storage.listTakes('video');assert.equal(take.recordingInfo.monitoring.baseLatency,0.0027);
  (await storage.ready).close();
});

test('sidetone defaults to minimum latency without enabling monitoring or replacing an existing mode preference',async()=>{
  for(const [saved,expected] of [[{},'minimum'],[{sidetoneMode:'standard'},'standard'],[{sidetoneMode:'minimum'},'minimum'],[{sidetoneMode:'invalid'},'minimum']]){
    const storage=createStorage(new IDBFactory()),preferences=new Map([['echo-microphone-v1',JSON.stringify(saved)]]);
    const globals={window:{localStorage:{getItem:key=>preferences.get(key)||null,setItem:(key,value)=>preferences.set(key,value)},addEventListener(){},speechSynthesis:{cancel(){}}}};
    const {nodes}=await mount(storage,{globals});
    assert.equal(nodes.get('sidetoneMode').value,expected);assert.equal(nodes.get('sidetoneEnabled').checked,false);
    nodes.get('sidetoneEnabled').checked=true;nodes.get('sidetoneEnabled').onchange();
    assert.equal(JSON.parse(preferences.get('echo-microphone-v1')).sidetoneMode,expected);
    const restored=await mount(storage,{globals});assert.equal(restored.nodes.get('sidetoneMode').value,expected);assert.equal(restored.nodes.get('sidetoneEnabled').checked,true);
    (await storage.ready).close();
  }
});

test('sidetone processing warning names only enabled processing and follows activity preferences',async()=>{
  const storage=createStorage(new IDBFactory()),{nodes}=await mount(storage);
  const warning=nodes.get('sidetoneProcessingWarning');assert.equal(warning.hidden,true);assert.equal(warning.textContent,'');
  nodes.get('sidetoneEnabled').checked=true;nodes.get('sidetoneEnabled').onchange();
  assert.equal(warning.hidden,false);assert.match(warning.textContent,/回声消除、自动增益/);
  nodes.get('echoCancellation').checked=false;nodes.get('echoCancellation').onchange();
  assert.match(warning.textContent,/自动增益/);assert.doesNotMatch(warning.textContent,/回声消除/);
  nodes.get('autoGainControl').checked=false;nodes.get('autoGainControl').onchange();assert.equal(warning.hidden,true);assert.equal(warning.textContent,'');
  nodes.get('echoCancellation').checked=true;nodes.get('echoCancellation').onchange();assert.match(warning.textContent,/回声消除/);assert.doesNotMatch(warning.textContent,/自动增益/);
  nodes.get('activityMode').value='sing';nodes.get('activityMode').onchange();assert.equal(warning.hidden,true);
  nodes.get('activityMode').value='speech';nodes.get('activityMode').onchange();assert.equal(warning.hidden,false);
  nodes.get('sidetoneEnabled').checked=false;nodes.get('sidetoneEnabled').onchange();assert.equal(warning.hidden,true);
  assert.equal(nodes.get('echoCancellation').checked,true); // Inform without changing the user's processing preference.
  (await storage.ready).close();
});

test('headphone recommendation saves only the current activity, retains manual gain and leaves sidetone enabled',async()=>{
  const storage=createStorage(new IDBFactory()),preferences=new Map([['echo-microphone-v1',JSON.stringify({speech:true,sing:true,autoGainControl:{speech:true,sing:true},manualGainDb:{speech:6,sing:12}})]]);
  const globals={window:{localStorage:{getItem:key=>preferences.get(key)||null,setItem:(key,value)=>preferences.set(key,value)},addEventListener(){},speechSynthesis:{cancel(){}}}};
  const {nodes}=await mount(storage,{globals});
  nodes.get('sidetoneEnabled').checked=true;nodes.get('sidetoneEnabled').onchange();assert.equal(nodes.get('sidetoneProcessingNotice').hidden,false);
  nodes.get('useHeadphoneSettings').onclick();
  assert.equal(nodes.get('echoCancellation').checked,false);assert.equal(nodes.get('autoGainControl').checked,false);
  assert.equal(nodes.get('sidetoneEnabled').checked,true);assert.equal(nodes.get('sidetoneProcessingNotice').hidden,true);assert.equal(nodes.get('manualGainDb').value,6);
  assert.match(nodes.get('status').textContent,/手动增益保持 \+6 dB/);
  nodes.get('activityMode').value='sing';nodes.get('activityMode').onchange();
  assert.equal(nodes.get('echoCancellation').checked,true);assert.equal(nodes.get('autoGainControl').checked,true);assert.equal(nodes.get('sidetoneProcessingNotice').hidden,false);
  const restored=await mount(storage,{globals});
  restored.nodes.get('activityMode').value='speech';restored.nodes.get('activityMode').onchange();
  assert.equal(restored.nodes.get('echoCancellation').checked,false);assert.equal(restored.nodes.get('autoGainControl').checked,false);
  assert.equal(restored.nodes.get('manualGainDb').value,6);assert.equal(restored.nodes.get('sidetoneEnabled').checked,true);
  (await storage.ready).close();
});

for(const activity of ['sing','speech'])test(`${activity} capture exposes live backing volume and keeps both controls, persisted preference and dry vocals consistent`,async()=>{
  const storage=createStorage(new IDBFactory()),video=leadInVideo({hold:true}),mic={getTracks:()=>[{stop(){}}]};let gain=1;
  await storage.saveBacking({key:'background',videoId:'video',start:0,end:60,createdAt:1,blob:new Blob(['music'])});
  class MediaRecorder{
    static isTypeSupported(){return true;}
    constructor(stream){assert.equal(stream,mic);this.state='inactive';this.mimeType='audio/webm';}
    start(){this.state='recording';}
    stop(){this.state='inactive';this.ondataavailable({data:new Blob(['dry vocal'])});queueMicrotask(()=>this.onstop());}
  }
  const {nodes}=await mount(storage,{video,globals:{MediaRecorder,navigator:{mediaDevices:{getUserMedia:async()=>mic}},EchoKaraoke:{...require('../extension/karaoke.js'),createMonitor:async()=>({sync:async()=>{},pause(){},dispose(){},setVolume(value){gain=value;}})}}});
  nodes.get('activityMode').value=activity;nodes.get('activityMode').onchange();
  if(activity==='speech'){nodes.get('recordingPlayback').value='backing';nodes.get('recordingPlayback').onchange();}
  const recording=nodes.get('record').onclick();await waitUntil(()=>!nodes.get('backingLiveControls').hidden);
  assert.equal(nodes.get('backingLiveVolume').disabled,false);
  assert.equal(nodes.get('backingLiveLabel').textContent,activity==='sing'?'伴奏':'背景音');
  nodes.get('backingLiveVolume').value='2';nodes.get('backingLiveVolume').oninput();assert.equal(gain,2);assert.equal(nodes.get('backingVolume').value,2);assert.equal(nodes.get('backingVolumeValue').textContent,'200%');
  nodes.get('backingVolume').value='0.5';nodes.get('backingVolume').oninput();assert.equal(nodes.get('backingLiveVolume').value,0.5);assert.equal(nodes.get('backingLiveValue').textContent,'50%');
  nodes.get('backingLiveVolume').value='0';nodes.get('backingLiveVolume').oninput();assert.equal(gain,0);nodes.get('backingLiveVolume').onchange();
  assert.equal(nodes.get('replayBackingVolume').value,1);
  nodes.get('stop').onclick();await recording;assert.equal(nodes.get('backingLiveControls').hidden,true);
  const [take]=await storage.listTakes('video');assert.equal(await take.blob.text(),'dry vocal');assert.equal(take.withBacking,undefined);
  const saved=await storage.getSession('video');assert.equal(saved.backingVolume,0);
  const restored=await mount(storage,{video});assert.equal(restored.nodes.get('backingLiveVolume').value,0);assert.equal(restored.nodes.get('backingVolumeValue').textContent,'0%');
  (await storage.ready).close();
});

test('setup wizard applies recommendations and favorites still live in the library',async()=>{
  const storage=createStorage(new IDBFactory());
  const {nodes}=await mount(storage,{title:'收藏测试 - YouTube'});
  nodes.get('openPreparation').onclick();assert.equal(nodes.get('toolsDialog').open,true);
  nodes.get('wizardActivity').value='sing';nodes.get('wizardActivity').onchange();nodes.get('wizardApply').onclick();assert.equal(nodes.get('toolsDialog').open,true);
  assert.equal(nodes.get('activityMode').value,'sing');assert.equal(nodes.get('practiceScope').value,'whole');
  assert.equal(nodes.get('recordingPlayback').value,'backing');assert.equal(nodes.get('echoCancellation').checked,false);assert.equal(nodes.get('autoGainControl').checked,false);
  nodes.get('wizardActivity').value='speech';nodes.get('wizardListening').value='speakers';nodes.get('wizardListening').onchange();nodes.get('wizardApply').onclick();nodes.get('closeTools').onclick();
  assert.equal(nodes.get('activityMode').value,'speech');assert.equal(nodes.get('practiceScope').value,'clip');assert.equal(nodes.get('recordingPlayback').value,'silent');
  assert.equal(nodes.get('echoCancellation').checked,true);assert.equal(nodes.get('autoGainControl').checked,true);assert.equal(nodes.get('sidetoneEnabled').checked,false);
  assert.equal(nodes.get('leadInMode').value,'none');
  await nodes.get('favoriteVideo').onclick();assert.equal(nodes.get('favoriteVideo').getAttribute('aria-pressed'),'true');
  await nodes.get('openLibrary').onclick();nodes.get('libraryFavoritesTab').onclick();
  assert.equal(nodes.get('libraryList').children.length,1);assert.equal(nodes.get('libraryList').children[0].children[0].textContent,'收藏测试');
  const actions=nodes.get('libraryList').children[0].children.at(-1);await actions.children.at(-1).onclick();
  assert.equal(nodes.get('libraryList').children.length,0);assert.equal(nodes.get('favoriteVideo').getAttribute('aria-pressed'),'false');
  (await storage.ready).close();
});
test('practice library previews a pack, waits for explicit import, merges data and exports per-video original audio',async()=>{
  const storage=createStorage(new IDBFactory()),pack=require('../extension/practice-package.js');
  const data={sessions:[{videoId:'another',title:'迁移的歌曲',start:0,end:5,speed:'1',cues:[{start:0,end:5,text:'导入歌词'}]}],recordings:[{id:'imported',videoId:'another',cueKey:'one',start:0,end:5,speed:1,createdAt:1,blob:new Blob(['original audio'])}],backings:[],favorites:[{videoId:'another',title:'迁移的歌曲',createdAt:1}]};
  const {nodes,downloads}=await mount(storage);await nodes.get('openLibrary').onclick();nodes.get('libraryBackupTab').onclick();
  assert.equal(nodes.get('packageTools').hidden,false);assert.equal(nodes.get('librarySearch').hidden,true);
  nodes.get('packageFile').files=[pack.encode(data)];await nodes.get('packageFile').onchange();
  assert.equal(nodes.get('packagePreview').hidden,false);assert.equal((await storage.listTakes('another')).length,0);
  assert.equal(nodes.get('packageContentList').children[0].textContent,'迁移的歌曲');
  assert.match(nodes.get('packageContentList').children[0].children[0].textContent,/1 条录音.*新视频进度/);
  await nodes.get('packageImport').onclick();assert.equal((await storage.listTakes('another')).length,1);assert.match(nodes.get('libraryMessage').textContent,/导入完成/);
  nodes.get('packageScope').value='another';await nodes.get('packageExport').onclick();
  const link=downloads.at(-1);assert.match(link.download,/Echo-another-.*\.echo/);
  const exported=await pack.decode(await (await fetch(link.href)).blob());
  assert.equal(exported.sessions.length,1);assert.equal(exported.sessions[0].title,'迁移的歌曲');assert.equal(await exported.recordings[0].blob.text(),'original audio');
  (await storage.ready).close();
});

test('document shortcuts only act when the panel is visible and no input or dialog owns focus',async()=>{
  const storage=createStorage(new IDBFactory()),{nodes,document,events}=await mount(storage);
  const host=document.documentElement.children[0],handler=events.get('keydown');let prevented=0,compared=0;
  nodes.get('replay').disabled=false;nodes.get('replay').onclick=()=>compared++;
  const key=extra=>({altKey:true,shiftKey:true,code:'KeyP',preventDefault(){prevented++;},stopPropagation(){},...extra});
  host.style.display='none';handler(key());assert.equal(compared,0);
  host.style.display='block';handler(key({target:{tagName:'INPUT'}}));assert.equal(prevented,0);
  nodes.get('openPreparation').onclick();handler(key());assert.equal(prevented,0);nodes.get('closeTools').onclick();
  handler(key());assert.equal(compared,1);assert.equal(prevented,1);
  handler(key({code:'KeyF'}));assert.equal(prevented,1);assert.equal(await storage.getFavorite('video'),undefined);
  nodes.get('replay').disabled=true;handler(key());assert.equal(compared,1);assert.equal(prevented,1);
  (await storage.ready).close();
});

test('typing in panel editors keeps keyboard events away from YouTube without blocking text input',async()=>{
  const storage=createStorage(new IDBFactory()),{root,nodes}=await mount(storage);
  for(const target of [{tagName:'TEXTAREA'},{tagName:'INPUT'},{tagName:'SELECT'},{isContentEditable:true},{closest:()=>({})}]){
    for(const type of ['keydown','keypress','keyup']){
      for(const key of [' ','k','ArrowLeft','Enter']){
        let stopped=0,prevented=0;
        // Match shadow-DOM retargeting: the page sees the host, not the input.
        root['on'+type]({key,target:{tagName:'DIV'},composedPath:()=>[target],stopPropagation(){stopped++;},preventDefault(){prevented++;}});
        assert.equal(stopped,1);assert.equal(prevented,0);
      }
    }
  }
  let stopped=0;
  root.onkeydown({key:' ',target:{tagName:'BUTTON'},stopPropagation(){stopped++;}});assert.equal(stopped,0);
  // Existing Escape-to-close behavior still takes priority inside an input.
  nodes.get('openPreparation').onclick();
  for(const composition of [{isComposing:true},{keyCode:229}]){
    let prevented=0;
    root.onkeydown({key:'Escape',target:{tagName:'TEXTAREA'},...composition,stopPropagation(){},preventDefault(){prevented++;}});
    assert.equal(prevented,0);assert.equal(nodes.get('toolsDialog').open,true);
  }
  root.onkeydown({key:'Escape',target:{tagName:'TEXTAREA'},stopPropagation(){},preventDefault(){}});
  assert.equal(nodes.get('toolsDialog').open,false);
  (await storage.ready).close();
});

test('current-clip original playback stops before an overlapping next cue and restores explicit manual bounds',async()=>{
  const storage=createStorage(new IDBFactory()),listeners=new Map();let time=0,paused=true;
  const video={duration:30,muted:false,playbackRate:1,get currentTime(){return time;},set currentTime(value){time=value;queueMicrotask(()=>emit('seeked'));},get paused(){return paused;},pause(){paused=true;},async play(){paused=false;},
    addEventListener(name,fn){if(!listeners.has(name))listeners.set(name,new Set());listeners.get(name).add(fn);},removeEventListener(name,fn){listeners.get(name)?.delete(fn);}};
  function emit(name){for(const listener of [...listeners.get(name) || []])listener({type:name});}
  const cues=[{start:1,end:8,text:'First line'},{start:4,end:8,text:'Next line'}];
  await storage.saveSession({videoId:'video',activity:'speech',scopes:{speech:'clip',sing:'whole'},start:1,end:8,index:0,speed:'1',leadInMode:'none',cues});
  const {nodes}=await mount(storage,{video});
  assert.equal(Number(nodes.get('end').value),4);assert.equal(nodes.get('clipCue').value,'0');
  const playing=nodes.get('original').onclick();await waitUntil(()=>!paused && listeners.get('timeupdate')?.size>1);
  time=3.9;emit('timeupdate');assert.equal(paused,false);
  time=4;emit('timeupdate');await playing;assert.equal(paused,true);
  assert.equal(Number(nodes.get('end').value),4);assert.equal(Number(nodes.get('start').value),1);
  nodes.get('clipCue').value='1';nodes.get('clipCue').onchange();assert.equal(Number(nodes.get('start').value),4);
  nodes.get('clipCue').value='0';nodes.get('clipCue').onchange();assert.equal(Number(nodes.get('end').value),4);
  // A deliberate extension is not silently shortened, including after reload.
  nodes.get('end').value='8';nodes.get('end').onchange();await new Promise(r=>setTimeout(r,5));
  assert.equal((await storage.getSession('video')).clipRangeAdjusted,true);
  const restored=await mount(storage,{video});assert.equal(Number(restored.nodes.get('end').value),8);
  (await storage.ready).close();
});

test('record shortcut starts and ends one capture, and recordings-page replay uses the selected-recording action',async()=>{
  const storage=createStorage(new IDBFactory()),video=leadInVideo({hold:true});let starts=0,stops=0;
  class MediaRecorder{
    static isTypeSupported(){return true;}
    constructor(){this.state='inactive';this.mimeType='audio/webm';}
    start(){this.state='recording';starts++;}
    stop(){this.state='inactive';this.ondataavailable({data:new Blob(['shortcut voice'])});queueMicrotask(()=>this.onstop());}
  }
  const {nodes,document,events}=await mount(storage,{video,globals:{MediaRecorder,
    navigator:{mediaDevices:{async getUserMedia(){return {getTracks:()=>[{stop(){stops++;}}]};}}},
    requestAnimationFrame:fn=>setTimeout(fn,1),cancelAnimationFrame:clearTimeout}});
  document.documentElement.children[0].style.display='block';
  const press=code=>events.get('keydown')({altKey:true,shiftKey:true,code,preventDefault(){},stopPropagation(){}});
  press('KeyR');await waitUntil(()=>starts===1 && video.plays.length===1);assert.equal(nodes.get('openPreparation').disabled,true);
  press('KeyR');await waitUntil(()=>nodes.get('record').disabled===false);assert.equal(nodes.get('openPreparation').disabled,false);
  const takes=await storage.listTakes('video');assert.equal(takes.length,1);assert.equal(await takes[0].blob.text(),'shortcut voice');assert.equal(stops,1);
  let practiceReplays=0,selectedReplays=0;
  nodes.get('replay').onclick=()=>practiceReplays++;nodes.get('reviewReplay').onclick=()=>selectedReplays++;
  press('KeyP');assert.equal(practiceReplays,1);
  nodes.get('tab-recordings').onclick();press('KeyP');assert.equal(selectedReplays,1);assert.equal(practiceReplays,1);
  (await storage.ready).close();
});

test('infrequent settings open in one modal, preserve the practice page and suppress practice shortcuts',async()=>{
  const storage=createStorage(new IDBFactory()),preferences=new Map();let recordings=0,focusReturns=0;
  const globals={window:{localStorage:{getItem:key=>preferences.get(key) || null,setItem:(key,value)=>preferences.set(key,value)},addEventListener(){},speechSynthesis:{cancel(){}}},chrome:{runtime:{onMessage:{addListener(){}},async sendMessage(){return {tracks:[]};}}}};
  const {nodes,root,document,events}=await mount(storage,{globals});document.documentElement.children[0].style.display='block';
  nodes.get('practiceSettings').focus=()=>focusReturns++;nodes.get('practiceSettings').onclick();
  assert.equal(nodes.get('settingsDialog').open,true);assert.equal(nodes.get('settings-microphone').hidden,false);assert.equal(nodes.get('page-practice').hidden,false);
  nodes.get('record').onclick=()=>recordings++;
  events.get('keydown')({altKey:true,shiftKey:true,code:'KeyR',preventDefault(){},stopPropagation(){}});assert.equal(recordings,0);
  nodes.get('autoGainControl').checked=false;nodes.get('autoGainControl').onchange();nodes.get('manualGainDb').value=6;nodes.get('manualGainDb').oninput();nodes.get('manualGainDb').onchange();
  nodes.get('settingsBackingTab').onclick();assert.equal(nodes.get('settings-backing').hidden,false);assert.equal(nodes.get('settings-microphone').hidden,true);
  root.onkeydown({key:'Escape',preventDefault(){},stopPropagation(){}});assert.equal(nodes.get('settingsDialog').open,false);assert.equal(focusReturns,1);
  nodes.get('openLanguageSettings').onclick();assert.equal(nodes.get('settings-captions').hidden,false);assert.equal(nodes.get('page-practice').hidden,false);
  await waitUntil(()=>nodes.get('read').disabled===false);nodes.get('closeSettings').onclick();
  nodes.get('openPreparation').onclick();nodes.get('micTestConfigure').onclick();assert.equal(nodes.get('toolsDialog').open,false);assert.equal(nodes.get('settingsDialog').open,true);assert.equal(nodes.get('settings-microphone').hidden,false);
  nodes.get('closeSettings').onclick();nodes.get('recordingPlayback').value='backing';nodes.get('recordingPlayback').onchange();nodes.get('backingSettings').onclick();assert.equal(nodes.get('settings-backing').hidden,false);
  nodes.get('close').onclick();assert.equal(nodes.get('settingsDialog').open,false);
  const restored=await mount(storage,{globals});assert.equal(restored.nodes.get('manualGainDb').value,6);assert.equal(restored.nodes.get('settingsDialog').open,undefined);
  (await storage.ready).close();
});

test('preparation and automatic-practice actions share a settings pane and return to the main controls on start',async()=>{
  const storage=createStorage(new IDBFactory()),video=leadInVideo({hold:true});let released=0;
  const {nodes}=await mount(storage,{video,globals:{navigator:{mediaDevices:{async getUserMedia(){return {getTracks:()=>[{stop(){released++;}}]};}}},requestAnimationFrame:fn=>setTimeout(fn,1),cancelAnimationFrame:clearTimeout}});
  for(const action of ['loop','autoPractice']){
    nodes.get('practiceTools').onclick();assert.equal(nodes.get('settingsDialog').open,true);assert.equal(nodes.get('settings-practice').hidden,false);
    nodes.get('leadInMode').value='none';nodes.get('leadInMode').onchange();nodes.get('loopCount').value='5';nodes.get('loopCount').onchange();
    const running=nodes.get(action).onclick();assert.equal(nodes.get('settingsDialog').open,false);
    await waitUntil(()=>!!nodes.get('transportProgress').oninput);assert.equal(nodes.get('stop').hidden,false);
    nodes.get('stop').onclick();await running;assert.equal(nodes.get('record').disabled,false);
  }
  assert.equal(released,1);assert.equal((await storage.getSession('video')).loopCount,'5');
  nodes.get('practiceTools').onclick();assert.equal(nodes.get('loopCount').value,'5');nodes.get('closeSettings').onclick();(await storage.ready).close();
});

test('fixed practice tools keep time adjustment and top-level preparation tools reachable without changing pages',async()=>{
  const storage=createStorage(new IDBFactory()),{nodes,root}=await mount(storage);
  assert.equal(nodes.get('practiceUtilities').hidden,false);assert.equal(nodes.get('playbackSpeedControl').hidden,true);
  nodes.get('adjustClipBounds').onclick();assert.equal(nodes.get('clipDialog').open,true);assert.ok(!nodes.get('settingsDialog').open);
  nodes.get('start').value='1';nodes.get('end').value='4';nodes.get('end').onchange();
  let returned=0;nodes.get('openPreparation').focus=()=>returned++;
  nodes.get('doneClipDialog').onclick();assert.equal(nodes.get('clipDialog').open,false);nodes.get('openPreparation').onclick();assert.equal(nodes.get('toolsDialog').open,true);
  root.onkeydown({key:'Escape',preventDefault(){},stopPropagation(){}});assert.equal(nodes.get('toolsDialog').open,false);assert.ok(!nodes.get('settingsDialog').open);assert.equal(returned,1);
  assert.equal(nodes.get('page-practice').hidden,false);assert.match(nodes.get('clipSummary').textContent,/1.0–4.0/);
  nodes.get('tab-recordings').onclick();assert.equal(nodes.get('practiceUtilities').hidden,true);
  nodes.get('tab-practice').onclick();assert.equal(nodes.get('practiceUtilities').hidden,false);
  await new Promise(r=>setTimeout(r,5));assert.equal((await storage.getSession('video')).end,4);(await storage.ready).close();
});


test('standalone clip editor restores focus, blocks practice shortcuts and closes with the panel',async()=>{
  const storage=createStorage(new IDBFactory()),{nodes,root,events}=await mount(storage);
  let returned=0,recorded=0;
  nodes.get('adjustClipBounds').focus=()=>returned++;
  nodes.get('record').onclick=()=>recorded++;
  nodes.get('adjustClipBounds').onclick();
  events.get('keydown')({key:'r',altKey:true,shiftKey:true,preventDefault(){},stopPropagation(){}});
  assert.equal(recorded,0);
  root.onkeydown({key:'Escape',preventDefault(){},stopPropagation(){}});
  assert.equal(nodes.get('clipDialog').open,false);assert.equal(returned,1);
  nodes.get('adjustClipBounds').onclick();
  nodes.get('endLater').onclick();
  assert.match(nodes.get('clipSummary').textContent,/5.2/);
  nodes.get('close').onclick();assert.equal(nodes.get('clipDialog').open,false);
  await new Promise(r=>setTimeout(r,5));assert.equal((await storage.getSession('video')).end,5.2);
  (await storage.ready).close();
});

test('roomy lyrics keep one previous cue, preview multiple upcoming cues and hide context in blind practice',async()=>{
  const storage=createStorage(new IDBFactory());
  const cues=Array.from({length:12},(_,i)=>({start:i*4,end:(i+1)*4,text:`Line ${i+1}`}));
  await storage.saveSession({videoId:'video',cues,index:5,start:20,end:24,speed:'1'});
  let resize;
  class ResizeObserver{constructor(callback){resize=callback;}observe(){}disconnect(){}}
  const {nodes}=await mount(storage,{globals:{ResizeObserver}});
  nodes.get('scopeControls').getBoundingClientRect=()=>({height:100});
  resize([{target:nodes.get('pages'),contentRect:{height:400}}]);
  assert.equal(nodes.has('captionEarlier'),false);
  assert.equal(nodes.get('captionPrevious').textContent,'Line 5');
  assert.equal(nodes.get('captionNext').textContent,'Line 7');
  assert.deepEqual(nodes.get('captionLater').children.map(n=>n.textContent),['Line 8','Line 9']);
  resize([{target:nodes.get('pages'),contentRect:{height:1200}}]);
  assert.equal(nodes.get('captionPrevious').textContent,'Line 5');assert.equal(nodes.get('captionLater').children.length,4);
  nodes.get('hideText').checked=true;nodes.get('hideText').onchange();
  for(const id of ['captionPrevious','captionNext','captionLater'])assert.equal(nodes.get(id).hidden,true);
  nodes.get('hideText').checked=false;nodes.get('hideText').onchange();
  resize([{target:nodes.get('pages'),contentRect:{height:250}}]);
  assert.equal(nodes.get('captionLater').hidden,true);
  assert.equal(nodes.get('captionNext').textContent,'Line 7');assert.equal(nodes.get('clipCue').value,'5');
  await new Promise(r=>setTimeout(r,5));(await storage.ready).close();
});

test('setup wizard preserves recordings and manual gain, changes only on apply and restores the previous settings on undo',async()=>{
  const storage=createStorage(new IDBFactory());
  await storage.saveSession({videoId:'video',cues:[{start:0,end:5,text:'First'},{start:5,end:10,text:'Second'}],index:1,start:5,end:10,speed:'1'});
  await storage.saveTake({id:'keep',videoId:'video',cueKey:'manual:5:10',start:5,end:10,speed:1,createdAt:1,blob:new Blob(['voice'])});
  const {nodes}=await mount(storage,{globals:{EchoMicrophone:{...require('../extension/microphone.js'),supportsLossless:()=>true}}});
  nodes.get('autoGainControl').checked=false;nodes.get('autoGainControl').onchange();
  nodes.get('manualGainDb').value=9;nodes.get('manualGainDb').oninput();
  nodes.get('sidetoneEnabled').checked=true;nodes.get('sidetoneEnabled').onchange();
  nodes.get('leadInMode').value='previous';nodes.get('leadInMode').onchange();
  nodes.get('openPreparation').onclick();
  nodes.get('wizardActivity').value='sing';nodes.get('wizardActivity').onchange();
  nodes.get('wizardQuality').value='lossless';nodes.get('wizardQuality').onchange();
  assert.equal(nodes.get('activityMode').value,'speech');assert.equal(nodes.get('recordingQuality').value,'high');
  nodes.get('wizardApply').onclick();
  assert.equal(nodes.get('activityMode').value,'sing');assert.equal(nodes.get('recordingQuality').value,'lossless');
  assert.equal(nodes.get('sidetoneEnabled').checked,false);assert.equal(nodes.get('wizardUndo').hidden,false);
  nodes.get('wizardUndo').onclick();
  assert.equal(nodes.get('activityMode').value,'speech');assert.equal(nodes.get('practiceScope').value,'clip');
  assert.equal(nodes.get('recordingQuality').value,'high');assert.equal(nodes.get('manualGainDb').value,9);
  assert.equal(nodes.get('sidetoneEnabled').checked,true);assert.equal(nodes.get('leadInMode').value,'previous');
  assert.equal(nodes.get('echoCancellation').checked,true);assert.equal(nodes.get('autoGainControl').checked,false);
  assert.equal(nodes.get('clipCue').value,'1');assert.equal((await storage.listTakes('video')).length,1);
  await new Promise(r=>setTimeout(r,5));assert.equal((await storage.getSession('video')).cues.length,2);(await storage.ready).close();
});

test('setup wizard preserves per-activity backing and scope choices and the current lead-in',async()=>{
  const storage=createStorage(new IDBFactory()),requests=[];
  await storage.saveSession({videoId:'video',cues:[{start:0,end:5,text:'First'}],index:0,start:2,end:4,clipRangeAdjusted:true,speed:'1',activity:'speech',
    scopes:{speech:'clip',sing:'clip'},backingPreferences:{speech:true,sing:false},useBacking:true,leadInMode:'seconds',leadInSeconds:7});
  const {nodes}=await mount(storage,{globals:{chrome:{runtime:{onMessage:{addListener(){}},async sendMessage(message){requests.push(message);return {};}}}}});
  nodes.get('openPreparation').onclick();assert.equal(nodes.has('wizardSpeechBacking'),false);assert.equal(nodes.has('wizardSongBacking'),false);
  nodes.get('wizardApply').onclick();assert.equal(nodes.get('recordingPlayback').value,'backing');
  assert.equal(nodes.get('practiceScope').value,'clip');assert.equal(Number(nodes.get('start').value),2);assert.equal(Number(nodes.get('end').value),4);
  assert.equal(nodes.get('leadInMode').value,'seconds');assert.equal(Number(nodes.get('leadInSeconds').value),7);
  assert.equal(nodes.get('wizardContinue').hidden,false);
  nodes.get('wizardActivity').value='sing';nodes.get('wizardActivity').onchange();nodes.get('wizardApply').onclick();
  assert.equal(nodes.get('recordingPlayback').value,'silent');assert.equal(nodes.get('practiceScope').value,'clip');
  assert.equal(Number(nodes.get('start').value),2);assert.equal(Number(nodes.get('end').value),4);
  assert.equal(Number(nodes.get('leadInSeconds').value),7);
  assert.equal(requests.some(r=>r.action && !['cached','models','health'].includes(r.action)),false);
  await new Promise(r=>setTimeout(r,5));(await storage.ready).close();
});

test('setup wizard checks lossless support and keeps undo scoped to the application screen',async()=>{
  const storage=createStorage(new IDBFactory());
  const {nodes}=await mount(storage,{globals:{EchoMicrophone:{...require('../extension/microphone.js'),supportsLossless:()=>false}}});
  nodes.get('openPreparation').onclick();assert.equal(nodes.get('wizardLossless').disabled,true);
  nodes.get('wizardApply').onclick();assert.equal(nodes.get('wizardUndo').hidden,false);
  assert.match(nodes.get('wizardContinue').textContent,/准备字幕/);
  nodes.get('closeTools').onclick();nodes.get('openPreparation').onclick();
  assert.equal(nodes.get('wizardUndo').hidden,true);assert.equal(nodes.get('wizardContinue').hidden,true);
  await new Promise(r=>setTimeout(r,5));(await storage.ready).close();
});

test('ready setup recommendations offer a return to practice while keeping audition inline',async()=>{
  const storage=createStorage(new IDBFactory());
  await storage.saveSession({videoId:'video',cues:[{start:0,end:5,text:'First'}],index:0,start:0,end:5,speed:'1'});
  const {nodes}=await mount(storage);
  nodes.get('openPreparation').onclick();nodes.get('wizardApply').onclick();
  assert.equal(nodes.get('wizardContinue').hidden,false);assert.equal(nodes.get('wizardUndo').hidden,false);
  assert.match(nodes.get('wizardMessage').textContent,/下方直接试音/);
  assert.equal(nodes.get('micTestStart').disabled,false);assert.equal(nodes.get('toolsDialog').open,true);
  assert.equal(nodes.get('wizardContinue').textContent,'返回练习');
  nodes.get('wizardContinue').onclick();
  assert.equal(nodes.get('toolsDialog').open,false);assert.equal(nodes.get('page-practice').hidden,false);
  await new Promise(r=>setTimeout(r,5));(await storage.ready).close();
});

test('main background entry generates each selected clip without requiring prior playback opt-in',async()=>{
  const storage=createStorage(new IDBFactory()),starts=[];
  await storage.saveSession({videoId:'video',cues:[{start:0,end:5,text:'First'},{start:5,end:10,text:'Second'}],index:0,start:0,end:5,speed:'1'});
  const {nodes}=await mount(storage,{video:{duration:60,pause(){}},globals:{chrome:{runtime:{onMessage:{addListener(){}},async sendMessage(message){
    if(message.action==='start'){starts.push(message);return {id:'a'.repeat(32),state:'ready',quality:'standard'};}
    if(message.action==='audio')return {audio:Buffer.from('background').toString('base64'),mime:'audio/mpeg'};
    return {};
  }}}}});
  assert.equal(nodes.get('recordingPlayback').value,'silent');
  assert.match(nodes.get('backingSummary').textContent,/未准备|可选/);
  nodes.get('backingSettings').onclick();assert.equal(nodes.get('settings-backing').hidden,false);
  assert.equal(nodes.get('prepareBacking').disabled,false);
  await nodes.get('prepareBacking').onclick();
  assert.equal(nodes.get('recordingPlayback').value,'backing');assert.match(nodes.get('backingSummary').textContent,/已就绪/);assert.equal(nodes.get('backingPreferencesTitle').textContent,'调整背景音');
  nodes.get('clipCue').value='1';nodes.get('clipCue').onchange();
  assert.match(nodes.get('backingSummary').textContent,/未准备|可选/);
  nodes.get('backingSettings').onclick();await nodes.get('prepareBacking').onclick();
  assert.deepEqual(starts.map(r=>[r.start,r.end]),[[0,5],[5,10]]);
  assert.match(nodes.get('backingSummary').textContent,/已就绪/);assert.equal(nodes.get('backingPreferencesTitle').textContent,'调整背景音');
  assert.equal((await storage.listBackings('video')).length,2);(await storage.ready).close();
});

test('unified backing entry exposes preparation and preserves scope across model settings',async()=>{
  const storage=createStorage(new IDBFactory()),starts=[];
  const {nodes}=await mount(storage,{video:{duration:120,pause(){}},globals:{chrome:{runtime:{onMessage:{addListener(){}},async sendMessage(message){
    if(message.action==='start'){starts.push(message);return {id:'b'.repeat(32),state:'ready',quality:'standard'};}
    return {audio:'UklGRg==',mime:'audio/wav'};
  }}}}});
  nodes.get('backingSettings').onclick();assert.equal(nodes.get('settings-backing').hidden,false);
  assert.equal(nodes.get('backingPreferencesTitle').textContent,'生成背景音');
  nodes.get('closeSettings').onclick();assert.doesNotMatch(nodes.get('backingPreferencesTitle').textContent,/→|->/);
  nodes.get('backingSettings').onclick();
  assert.equal(nodes.get('settings-backing').hidden,false);assert.equal(nodes.get('settings-backingOptions').hidden,true);assert.equal(nodes.get('settingsTabs').hidden,false);
  nodes.get('generationScope').value='whole';nodes.get('generationScope').onchange();
  nodes.get('generationSettings').onclick();assert.equal(nodes.get('settings-backingOptions').hidden,false);assert.equal(nodes.get('settings-backing').hidden,true);
  nodes.get('backToGeneration').onclick();assert.equal(nodes.get('generationScope').value,'whole');
  await nodes.get('prepareBacking').onclick();
  assert.deepEqual(starts.map(m=>[m.start,m.end]),[[0,120]]);
  assert.equal(nodes.get('start').value,'0');assert.equal(nodes.get('end').value,'5');assert.equal(nodes.get('practiceScope').value,'clip');
  nodes.get('generationScope').value='current';nodes.get('generationScope').onchange();
  assert.equal(nodes.get('prepareBacking').disabled,true);assert.equal(nodes.get('previewBacking').disabled,false);
  nodes.get('closeSettings').onclick();await new Promise(r=>setTimeout(r,5));(await storage.ready).close();
});

test('custom generation validates the independent interval and submits it without changing recording bounds',async()=>{
  const storage=createStorage(new IDBFactory()),starts=[];
  const {nodes}=await mount(storage,{video:{duration:900,pause(){}},globals:{chrome:{runtime:{onMessage:{addListener(){}},async sendMessage(message){
    if(message.action==='start'){starts.push(message);return {id:'c'.repeat(32),state:'ready',quality:'standard'};}
    return {audio:'UklGRg==',mime:'audio/wav'};
  }}}}});
  nodes.get('backingSettings').onclick();nodes.get('generationScope').value='whole';nodes.get('generationScope').onchange();
  assert.equal(nodes.get('prepareBacking').disabled,true);assert.match(nodes.get('generationRangeHint').textContent,/10 分钟/);
  nodes.get('generationScope').value='custom';nodes.get('generationScope').onchange();
  nodes.get('generationStart').value='30';nodes.get('generationEnd').value='20';nodes.get('generationEnd').oninput();
  assert.equal(nodes.get('prepareBacking').disabled,true);await nodes.get('prepareBacking').onclick();assert.equal(starts.length,0);
  nodes.get('generationEnd').value='90';nodes.get('generationEnd').onchange();
  assert.equal(nodes.get('prepareBacking').disabled,false);await nodes.get('prepareBacking').onclick();
  assert.deepEqual(starts.map(m=>[m.start,m.end]),[[30,90]]);assert.equal(nodes.get('end').value,'5');
  await new Promise(r=>setTimeout(r,5));(await storage.ready).close();
});

test('custom generation paragraph selects consecutive cues independently of recording and keeps the choice across settings',async()=>{
  const storage=createStorage(new IDBFactory()),starts=[];
  await storage.saveSession({videoId:'video',activity:'speech',scopes:{speech:'clip',sing:'whole'},start:0,end:5,index:0,cues:[0,5,10,15].map((start,i)=>({start,end:start+5,text:`Line ${i+1}`}))});
  const {nodes}=await mount(storage,{video:{duration:60,pause(){}},globals:{chrome:{runtime:{onMessage:{addListener(){}},async sendMessage(message){
    if(message.action==='start'){starts.push(message);return {id:'d'.repeat(32),state:'ready',quality:'standard'};}
    return {audio:'UklGRg==',mime:'audio/wav'};
  }}}}});
  nodes.get('backingSettings').onclick();assert.equal(nodes.get('generationParagraphOption').disabled,false);
  nodes.get('generationScope').value='paragraph';nodes.get('generationScope').onchange();
  nodes.get('generationFirst').value='1';nodes.get('generationFirst').onchange();
  assert.equal(nodes.get('generationLast').value,'2');
  nodes.get('generationLast').value='3';nodes.get('generationLast').onchange();
  assert.equal(nodes.get('generationParagraph').hidden,false);assert.equal(nodes.get('generationCustom').hidden,true);
  nodes.get('generationSettings').onclick();nodes.get('backToGeneration').onclick();
  assert.equal(nodes.get('generationScope').value,'paragraph');assert.equal(nodes.get('generationFirst').value,'1');assert.equal(nodes.get('generationLast').value,'3');
  await nodes.get('prepareBacking').onclick();assert.deepEqual(starts.map(m=>[m.start,m.end]),[[5,20]]);
  assert.equal(nodes.get('start').value,0);assert.equal(nodes.get('end').value,5);assert.equal(nodes.get('practiceScope').value,'clip');
  await new Promise(r=>setTimeout(r,5));(await storage.ready).close();
});

test('generation without subtitles offers time ranges and explains why custom paragraphs are unavailable',async()=>{
  const storage=createStorage(new IDBFactory()),{nodes}=await mount(storage);
  nodes.get('backingSettings').onclick();assert.equal(nodes.get('generationParagraphOption').disabled,true);assert.equal(nodes.get('generationParagraphHint').hidden,false);
  assert.equal(nodes.get('generationScope').disabled,false);
  nodes.get('generationScope').value='paragraph';nodes.get('generationScope').onchange();assert.equal(nodes.get('prepareBacking').disabled,true);
  nodes.get('generationScope').value='custom';nodes.get('generationStart').value='10';nodes.get('generationEnd').value='20';nodes.get('generationScope').onchange();assert.equal(nodes.get('prepareBacking').disabled,false);
  (await storage.ready).close();
});

test('confirmed missing YouTube subtitles immediately explain unavailability without waiting for transcript polling',async()=>{
  const storage=createStorage(new IDBFactory());let polls=0,available=false;
  const {nodes}=await mount(storage,{globals:{EchoTranscript:{readRows:()=>[],async read(){polls++;}},chrome:{runtime:{onMessage:{addListener(){}},async sendMessage(message){
    if(message.action==='list')return {tracks:available?[{id:'.en',language:'en',name:'English'}]:[]};
    return {};
  }}}}});
  await nodes.get('read').onclick();assert.equal(polls,0);
  for(const id of ['status','practiceSetup','transcriptEmpty','captionSourceInfo'])assert.match(nodes.get(id).textContent,/自动载入字幕不可用/);
  assert.equal(nodes.get('read').disabled,false);assert.equal(nodes.get('import').disabled,false);assert.equal(nodes.get('read').textContent,'重新检测字幕');
  nodes.get('file').files=[{size:50,text:async()=> '1\n00:00:00,000 --> 00:00:02,000\nImported words\n'}];await nodes.get('file').onchange();
  assert.equal((await storage.getSession('video')).cues[0].text,'Imported words');assert.match(nodes.get('captionSourceInfo').textContent,/导入的字幕文件/);
  available=true;await nodes.get('refreshCaptionTracks').onclick();assert.doesNotMatch(nodes.get('captionSourceInfo').textContent || '',/自动载入字幕不可用/);assert.equal(nodes.get('read').textContent,'读取台词');
  (await storage.ready).close();
});

test('caption transport errors stay distinct from confirmed absence and retain the existing transcript fallback',async()=>{
  const storage=createStorage(new IDBFactory());let polls=0;
  const {nodes}=await mount(storage,{globals:{EchoTranscript:{async read(){polls++;return [{start:0,end:2,text:'Visible transcript'}];}},chrome:{runtime:{onMessage:{addListener(){}},async sendMessage(){return {error:'字幕语言列表连接失败'};}}}}});
  await nodes.get('refreshCaptionTracks').onclick();assert.match(nodes.get('status').textContent,/连接失败/);assert.doesNotMatch(nodes.get('captionSourceInfo').textContent || '',/自动载入字幕不可用/);
  await nodes.get('read').onclick();assert.equal(polls,1);assert.equal((await storage.getSession('video')).cues[0].text,'Visible transcript');
  (await storage.ready).close();
});

test('an existing visible transcript is usable even when the caption API lists no tracks',async()=>{
  const storage=createStorage(new IDBFactory());let polls=0;
  const {nodes}=await mount(storage,{globals:{EchoTranscript:{readRows:()=>[{start:0,end:2,text:'Visible words'}],async read(){polls++;return [{start:0,end:2,text:'Visible words'}];}},chrome:{runtime:{onMessage:{addListener(){}},async sendMessage(){return {tracks:[]};}}}}});
  await nodes.get('read').onclick();assert.equal(polls,1);assert.match(nodes.get('status').textContent,/已读取 1/);assert.doesNotMatch(nodes.get('captionSourceInfo').textContent || '',/自动载入字幕不可用/);
  (await storage.ready).close();
});

test('subtitle editor is initialized on demand, loads drafts and applies stable caption keys without changing recordings',async()=>{
  const storage=createStorage(new IDBFactory());let config,opened,closed=false,init=0;
  await storage.saveSession({videoId:'video',start:0,end:3,cues:[{start:0,end:3,text:'Original',key:'stable-cue'}],index:0});
  await storage.saveTake({id:'keep-recording',videoId:'video',start:0,end:3,speed:1,cueKey:'stable-cue',blob:new Blob(['voice'])});
  await storage.saveCaptionDraft({videoId:'video',draft:{cues:[{start:0,end:4,text:'Draft',key:'stable-cue'}]}});
  const {nodes,events}=await mount(storage,{video:{duration:60},globals:{EchoSubtitleEditorView:{attach(options){init++;config=options;return {open(value){opened=value;closed=false;},close(){closed=true;options.onClose();},isOpen(){return !!opened && !closed;}};}}}});
  assert.equal(init,0);await nodes.get('openSubtitleEditor').onclick();assert.equal(init,1);assert.equal(opened.draft.cues[0].text,'Draft');
  await config.onApply([{start:1,end:4,text:'Edited',key:'stable-cue'}]);
  const session=await storage.getSession('video');assert.equal(session.cues[0].key,'stable-cue');assert.equal(session.cues[0].start,1);assert.equal((await storage.listTakes('video'))[0].start,0);
  assert.equal(nodes.get('page-practice').hidden,false);assert.equal(nodes.get('page-transcript').hidden,true);
  assert.match(nodes.get('status').textContent,/已载入 1/);nodes.get('close').onclick();assert.equal(closed,true);
  (await storage.ready).close();
});

test('alignment is per version, reverb is per video, both restore and alignment resets independently',async()=>{
  const storage=createStorage(new IDBFactory());
  await storage.saveTake({id:'voice',videoId:'video',cueKey:'manual:0:5',start:0,end:5,speed:1,createdAt:1,capture:'vocal',blob:new Blob(['voice'])});
  let {nodes}=await mount(storage);
  nodes.get('tab-recordings').onclick();
  assert.equal(nodes.get('vocalEffects').hidden,false);
  nodes.get('vocalDelay').value='-120';await nodes.get('vocalDelay').onchange();
  nodes.get('vocalReverb').value='ktv';await nodes.get('vocalReverb').onchange();
  nodes.get('vocalReverbAmount').value='0.4';await nodes.get('vocalReverbAmount').onchange();
  assert.deepEqual((await storage.listTakes('video'))[0].effects,{delayMs:-120});
  ({nodes}=await mount(storage));nodes.get('tab-recordings').onclick();
  assert.equal(Number(nodes.get('vocalDelay').value),-120);assert.equal(nodes.get('vocalReverb').value,'ktv');
  await nodes.get('vocalEarlier').onclick();assert.equal(Number(nodes.get('vocalDelay').value),-130);
  await nodes.get('resetVocalEffects').onclick();
  assert.equal(nodes.get('vocalReverb').value,'ktv');
  assert.deepEqual((await storage.getSession('video')).vocalReverb,{delayMs:0,reverb:'ktv',amount:0.4});
  assert.deepEqual((await storage.listTakes('video'))[0].effects,{delayMs:0});
  await storage.deleteTake('voice');assert.equal(await storage.updateTakeEffects('voice',{delayMs:100}),null);
  assert.equal((await storage.listTakes('video')).length,0);
  (await storage.ready).close();
});

test('stopping during vocal processing prevents stale audio playback',async()=>{
  const storage=createStorage(new IDBFactory());let release,requested=false,created=0,disposed=0;
  const blob=new Blob(['voice']);
  await storage.saveTake({id:'voice',videoId:'video',cueKey:'manual:0:5',start:0,end:5,speed:1,createdAt:1,capture:'vocal',blob,effects:{delayMs:-100}});
  const video={duration:60,currentTime:0,muted:false,playbackRate:1,pause(){},async play(){}};
  const {nodes}=await mount(storage,{video,globals:{Audio:class{constructor(){created++;}},EchoVocalEffects:{...require('../extension/vocal-effects.js'),createPlayer(){requested=true;return new Promise(resolve=>{release=resolve;});}}}});
  nodes.get('tab-recordings').onclick();
  const playing=nodes.get('reviewReplay').onclick();
  await waitUntil(()=>requested);
  nodes.get('stop').onclick();release({dispose(){disposed++;}});await playing;
  assert.equal(created,0);assert.equal(disposed,1);assert.equal(nodes.get('panel').dataset.mode,'idle');assert.equal(video.muted,false);
  (await storage.ready).close();
});

test('editing alignment and reverb during replay updates the same player and saves without resetting progress',async()=>{
  const storage=createStorage(new IDBFactory());let player,players=0,plays=0;
  await storage.saveTake({id:'voice',videoId:'video',cueKey:'manual:0:5',start:0,end:5,speed:1,createdAt:1,capture:'vocal',blob:new Blob(['voice'])});
  const video={duration:60,currentTime:0,muted:false,playbackRate:1,pause(){},async play(){},addEventListener(){},removeEventListener(){}};
  const {nodes}=await mount(storage,{video,globals:{EchoVocalEffects:{...require('../extension/vocal-effects.js'),async createPlayer(){
    players++;player={currentTime:0,duration:5,paused:true,async play(){plays++;this.paused=false;},pause(){this.paused=true;},dispose(){},setEffects(effects){this.effects=effects;},setVolume(){}};
    return player;
  }}}});
  nodes.get('tab-recordings').onclick();
  const playing=nodes.get('reviewReplay').onclick();await waitUntil(()=>nodes.get('transportProgress').disabled===false);
  player.currentTime=2;video.currentTime=2;
  assert.equal(nodes.get('vocalDelay').disabled,false);
  nodes.get('vocalDelay').value='-120';nodes.get('vocalDelay').oninput();await nodes.get('vocalDelay').onchange();
  nodes.get('vocalReverb').value='ktv';await nodes.get('vocalReverb').onchange();
  nodes.get('vocalReverbAmount').value='0.5';nodes.get('vocalReverbAmount').oninput();await nodes.get('vocalReverbAmount').onchange();
  nodes.get('vocalFadeOut').value='1.5';nodes.get('vocalFadeOut').oninput();await nodes.get('vocalFadeOut').onchange();
  assert.equal(players,1);assert.equal(plays,1);assert.equal(player.currentTime,2);assert.equal(video.currentTime,2);
  assert.equal(nodes.get('panel').dataset.mode,'replay');
  assert.deepEqual(player.effects,{delayMs:-120,reverb:'ktv',amount:0.5,fadeOutSeconds:1.5});
  assert.deepEqual((await storage.listTakes('video'))[0].effects,{delayMs:-120,fadeOutSeconds:1.5});
  assert.deepEqual((await storage.getSession('video')).vocalReverb,{delayMs:0,reverb:'ktv',amount:0.5});
  nodes.get('stop').onclick();await playing;(await storage.ready).close();
});

test('refresh reconnects a pending backing task, restores progress, and loads its result without starting again',async()=>{
  const storage=createStorage(new IDBFactory()),id='a'.repeat(32),values=new Map();let polls=0,starts=0,advancePoll;
  values.set('echo-backing-job:video',JSON.stringify({id,videoId:'video',start:10,end:20,model:'demucs-htdemucs',quality:'standard'}));
  const job={id,videoId:'video',start:10,end:20};
  const {nodes}=await mount(storage,{video:{duration:60,pause(){}},globals:{
    setTimeout(fn,ms){
      if(ms===1500){advancePoll=fn;return 0;}
      return setTimeout(fn,ms);
    },
    window:{localStorage:{getItem:key=>values.get(key),setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)},addEventListener(){}},
    chrome:{runtime:{onMessage:{addListener(){}},async sendMessage(message){
      if(message.action==='start')starts++;
      if(message.action==='status')return {...job,state:++polls===1?'separating':'ready',progress:43};
      if(message.action==='audio')return {audio:'YXVkaW8=',mime:'audio/mpeg'};
      return {};
    }}}
  }});
  await waitUntil(()=>nodes.get('panel').dataset.mode==='separating');
  assert.equal(nodes.get('generationProgress').hidden,false);assert.equal(nodes.get('generationProgress').value,43);
  assert.equal(typeof advancePoll,'function');advancePoll();
  await waitUntil(()=>nodes.get('panel').dataset.mode==='idle' && values.get('echo-backing-job:video')===undefined);
  assert.equal(starts,0);const backings=await storage.listBackings('video');
  assert.equal(backings.length,1);assert.equal(backings[0].start,10);assert.equal(backings[0].end,20);
  (await storage.ready).close();
});

test('page unload detaches the pending backing poll without cancelling the server task',async()=>{
  const storage=createStorage(new IDBFactory()),id='b'.repeat(32),values=new Map(),events=new Map();let cancels=0;
  values.set('echo-backing-job:video',JSON.stringify({id,videoId:'video',start:0,end:5,quality:'standard'}));
  const {nodes}=await mount(storage,{video:{duration:60,pause(){}},globals:{
    setTimeout:(fn,ms)=>setTimeout(fn,ms===1500?30:ms),
    window:{localStorage:{getItem:key=>values.get(key),setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)},addEventListener:(name,fn)=>events.set(name,fn)},
    chrome:{runtime:{onMessage:{addListener(){}},async sendMessage(message){
      if(message.action==='cancel')cancels++;
      return {id,videoId:'video',start:0,end:5,state:'separating',progress:50};
    }}}
  }});
  await waitUntil(()=>nodes.get('panel').dataset.mode==='separating');
  events.get('pagehide')();await new Promise(resolve=>setTimeout(resolve,40));
  assert.equal(cancels,0);assert.ok(values.has('echo-backing-job:video'));
  (await storage.ready).close();
});

test('reverb migrates from the selected legacy version, stays shared across versions and resets for another video',async()=>{
  const storage=createStorage(new IDBFactory()),location={href:'https://www.youtube.com/watch?v=video',pathname:'/watch'};
  const video={duration:60,currentTime:0,muted:false,playbackRate:1,pause(){},async play(){},addEventListener(){},removeEventListener(){}};
  class Audio{constructor(){this.currentTime=0;this.duration=5;}async play(){}pause(){}}
  for(const [id,createdAt,delayMs,reverb] of [['older',1,-120,'ktv'],['newer',2,80,'theatre']])await storage.saveTake({id,createdAt,videoId:'video',cueKey:'manual:0:5',start:0,end:5,speed:1,capture:'vocal',blob:new Blob(['voice']),effects:{delayMs,reverb,amount:.4}});
  await storage.saveSession({videoId:'video',selectedTakeId:'older',start:0,end:5,index:-1,cues:[]});
  const {nodes,events}=await mount(storage,{video,globals:{location,Audio}});
  assert.equal(nodes.get('vocalReverb').value,'ktv');assert.equal(Number(nodes.get('vocalDelay').value),-120);
  const selected=nodes.get('versionChoices').children.find(button=>button.attrs['aria-pressed']==='false');
  await selected.onclick();assert.equal(Number(nodes.get('vocalDelay').value),80);
  assert.equal(nodes.get('vocalReverb').value,'ktv');assert.equal(nodes.get('panel').dataset.mode,'idle');
  await nodes.get('resetVocalEffects').onclick();assert.equal(nodes.get('vocalReverb').value,'ktv');
  assert.equal((await storage.listTakes('video')).find(t=>t.id==='older').effects.delayMs,-120);
  nodes.get('vocalReverb').value='theatre';await nodes.get('vocalReverb').onchange();
  location.href='https://www.youtube.com/watch?v=other';events.get('yt-navigate-finish')();await waitUntil(()=>!nodes.get('read').disabled);
  assert.equal(nodes.get('vocalReverb').value,'off');assert.equal(nodes.get('monitorReverb').checked,false);
  (await storage.ready).close();
});

test('recording can change headphone reverb live while the saved stream stays dry',async()=>{
  const storage=createStorage(new IDBFactory()),video=leadInVideo({hold:true}),mic={getTracks:()=>[{stop(){}}]};let configured,liveEffects;
  class MediaRecorder{
    static isTypeSupported(){return true;}
    constructor(stream){assert.equal(stream,mic);this.state='inactive';this.mimeType='audio/webm';}
    start(){this.state='recording';}stop(){this.state='inactive';this.ondataavailable({data:new Blob(['dry vocal'])});queueMicrotask(()=>this.onstop());}
  }
  const microphone={...require('../extension/microphone.js'),async createInput(stream,db,env,options){configured=options;return {stream,db,dispose(){},setMonitoring(){},setMonitorReverb(value){liveEffects=value;}};}};
  const {nodes}=await mount(storage,{video,globals:{MediaRecorder,EchoMicrophone:microphone,navigator:{mediaDevices:{getUserMedia:async()=>mic}}}});
  nodes.get('sidetoneEnabled').checked=true;nodes.get('sidetoneEnabled').onchange();
  const recording=nodes.get('record').onclick();await waitUntil(()=>configured && nodes.get('panel').dataset.mode==='recording');
  assert.equal(configured.sidetone,true);assert.equal(configured.sidetoneReverb.reverb,undefined);
  assert.equal(nodes.get('liveVocalSettings').hidden,false);
  nodes.get('liveVocalSettings').onclick();assert.equal(nodes.get('settings-microphone').hidden,false);
  assert.equal(nodes.get('monitorReverb').disabled,false);
  nodes.get('micVocalSettings').onclick();assert.equal(nodes.get('settings-sound').hidden,false);
  nodes.get('vocalReverb').value='ktv';await nodes.get('vocalReverb').onchange();
  nodes.get('settingsMicTab').onclick();assert.equal(nodes.get('settings-microphone').hidden,false);
  nodes.get('monitorReverb').checked=true;await nodes.get('monitorReverb').onchange();
  assert.equal(liveEffects.reverb,'ktv');assert.equal(liveEffects.delayMs,0);
  nodes.get('monitorReverb').checked=false;await nodes.get('monitorReverb').onchange();assert.equal(liveEffects.reverb,undefined);
  nodes.get('closeSettings').onclick();nodes.get('stop').onclick();await recording;
  assert.equal(await (await storage.listTakes('video'))[0].blob.text(),'dry vocal');
  const saved=await storage.getSession('video');assert.equal(saved.vocalReverb.reverb,'ktv');assert.equal(saved.monitorReverb,false);
  (await storage.ready).close();
});

test('recording dialogs separate downloads and adjustments, block practice shortcuts and preserve live preview',async()=>{
  const storage=createStorage(new IDBFactory());let player,players=0,volume=1;
  await storage.saveTake({id:'voice',videoId:'video',cueKey:'manual:0:5',start:0,end:5,speed:1,createdAt:1,capture:'vocal',blob:new Blob(['voice'])});
  const video={duration:60,currentTime:0,muted:false,playbackRate:1,pause(){},async play(){},addEventListener(){},removeEventListener(){}};
  const {nodes,document,events}=await mount(storage,{video,globals:{EchoVocalEffects:{...require('../extension/vocal-effects.js'),async createPlayer(){
    players++;return player={currentTime:0,duration:5,paused:true,async play(){this.paused=false;},pause(){this.paused=true;},dispose(){},setEffects(){},setVolume(value){volume=value;}};
  }}}});
  document.documentElement.children[0].style.display='block';nodes.get('tab-recordings').onclick();
  nodes.get('openRecordingDownload').onclick();assert.equal(nodes.get('recordingDialog').open,true);
  const sharedControls=nodes.get('playbackControls'),progress=nodes.get('transportProgress');
  assert.ok(nodes.get('dialogPlaybackSlot').children.includes(sharedControls));
  assert.equal(nodes.get('transport').hidden,false);assert.equal(progress.disabled,true);
  assert.equal(nodes.get('mixControls').hidden,false);
  assert.equal(nodes.get('recording-adjustments').hidden,true);assert.equal(nodes.get('recording-downloads').hidden,false);
  let shortcut=0;nodes.get('reviewReplay').onclick=()=>shortcut++;
  events.get('keydown')({altKey:true,shiftKey:true,code:'KeyC',preventDefault(){},stopPropagation(){}});assert.equal(shortcut,0);
  nodes.get('recordingAdjustTab').onclick();assert.equal(nodes.get('recording-adjustments').hidden,false);
  const preview=nodes.get('recordingDialogPreview').onclick();await waitUntil(()=>player?.paused===false);
  assert.equal(nodes.get('recordingDialog').open,true);assert.match(nodes.get('recordingDialogPreview').textContent,/停止/);
  await waitUntil(()=>!!progress.oninput);
  const seekHandler=progress.oninput;progress.value='0.6';await progress.oninput();assert.equal(player.currentTime,3);
  nodes.get('replayVocalVolume').value='1.25';nodes.get('replayVocalVolume').oninput();assert.equal(volume,1.25);
  nodes.get('closeRecordingDialog').onclick();
  assert.equal(nodes.get('recordingDialog').open,false);assert.equal(player.paused,false);
  assert.ok(nodes.get('recordingPlaybackSlot').children.includes(sharedControls));
  assert.equal(progress.oninput,seekHandler);assert.equal(nodes.get('replayVocalVolume').value,'1.25');
  assert.equal(nodes.get('reviewReplay').disabled,false);assert.match(nodes.get('reviewReplay').textContent,/回听录音/);
  nodes.get('openRecordingAdjust').onclick();assert.equal(nodes.get('recordingDialog').open,true);
  assert.ok(nodes.get('dialogPlaybackSlot').children.includes(sharedControls));assert.equal(progress.oninput,seekHandler);
  assert.equal(players,1);assert.equal(player.currentTime,3);

  const stopped=nodes.get('recordingDialogPreview').onclick();await stopped;await preview;
  assert.equal(nodes.get('panel').dataset.mode,'idle');assert.equal(nodes.get('recordingDialog').open,true);
  assert.equal(progress.disabled,true);assert.equal(nodes.get('transport').hidden,false);
  assert.equal(nodes.get('mixControls').hidden,false);
  nodes.get('takeReverbSettings').onclick();assert.equal(nodes.get('recordingDialog').open,false);assert.equal(nodes.get('settings-sound').hidden,false);
  nodes.get('closeSettings').onclick();nodes.get('openRecordingAdjust').onclick();
  nodes.get('closeRecordingDialog').onclick();assert.equal(nodes.get('recordingDialog').open,false);
  (await storage.ready).close();
});


test('original phase of comparison hides unrelated replay gains and restores them after stopping',async()=>{
  const storage=createStorage(new IDBFactory());
  await storage.saveTake({id:'voice',videoId:'video',cueKey:'manual:0:5',start:0,end:5,speed:1,createdAt:1,capture:'vocal',blob:new Blob(['voice'])});
  const {nodes}=await mount(storage,{video:leadInVideo({hold:true})});
  nodes.get('tab-recordings').onclick();
  nodes.get('reviewReplayMode').value='sequential';nodes.get('reviewReplayMode').onchange();
  const playing=nodes.get('reviewReplay').onclick();await waitUntil(()=>!!nodes.get('transportProgress').oninput);
  assert.equal(nodes.get('mixControls').hidden,true);
  assert.equal(nodes.get('replayVocalVolume').disabled,true);
  assert.equal(nodes.get('resetReplayMix').disabled,true);
  assert.match(nodes.get('mixHint').textContent,/只用于录音回听/);
  nodes.get('stop').onclick();await playing;
  assert.equal(nodes.get('mixControls').hidden,false);
  assert.equal(nodes.get('replayVocalVolume').disabled,false);
  (await storage.ready).close();
});

test('lead-in progress stays visible through a delayed seek and recording playback startup',async()=>{
  const storage=createStorage(new IDBFactory()),events=new Map();let position=0,holdSeek=false,releaseSeek,releasePlay,plays=0,starts=0;
  await storage.saveSession({videoId:'video',start:10,end:15,speed:'1',cues:[],leadInMode:'seconds',leadInSeconds:3});
  const emit=name=>{for(const fn of [...events.get(name)||[]])fn();};
  const video={duration:60,muted:false,playbackRate:1,pause(){},
    get currentTime(){return position;},set currentTime(value){position=value;if(holdSeek)releaseSeek=()=>{holdSeek=false;emit('seeked');};else queueMicrotask(()=>emit('seeked'));},
    addEventListener(name,fn){if(!events.has(name))events.set(name,new Set());events.get(name).add(fn);},removeEventListener(name,fn){events.get(name)?.delete(fn);},
    async play(){if(++plays===2)await new Promise(resolve=>{releasePlay=resolve;});}};
  class MediaRecorder{static isTypeSupported(){return true;}constructor(){this.state='inactive';this.mimeType='audio/webm';}
    start(){starts++;this.state='recording';}stop(){this.state='inactive';this.ondataavailable({data:new Blob(['voice'])});queueMicrotask(()=>this.onstop());}}
  const {nodes}=await mount(storage,{video,globals:{MediaRecorder,navigator:{mediaDevices:{getUserMedia:async()=>({getTracks:()=>[{stop(){}}]})}},requestAnimationFrame:fn=>setTimeout(fn,1),cancelAnimationFrame:clearTimeout}});
  const pending=nodes.get('record').onclick();await waitUntil(()=>nodes.get('transportLabel').textContent==='准备录音 · 前置原声');
  const visibility=[];let hidden=nodes.get('transport').hidden;
  Object.defineProperty(nodes.get('transport'),'hidden',{get:()=>hidden,set:value=>{hidden=value;visibility.push(value);}});
  // A genuinely overshot boundary must still seek back before capture.
  holdSeek=true;position=10.2;emit('timeupdate');await waitUntil(()=>!!releaseSeek);
  assert.equal(hidden,false);assert.equal(nodes.get('liveMeter').hidden,false);assert.equal(starts,0);
  releaseSeek();await waitUntil(()=>!!releasePlay);
  assert.equal(starts,1);assert.equal(nodes.get('panel').dataset.mode,'recording');
  assert.equal(nodes.get('transportLabel').textContent,'录音');assert.equal(hidden,false);
  assert.equal(nodes.get('transportProgress').disabled,true);assert.equal(nodes.get('liveMeter').hidden,false);
  assert.equal(visibility.includes(true),false);
  nodes.get('stop').onclick();releasePlay();await pending;assert.equal(hidden,true);
  (await storage.ready).close();
});


test('unified backing page explains first-use setup and reflects model readiness',async()=>{
  const storage=createStorage(new IDBFactory());let online=false;
  const catalog={models:[{id:'demucs-htdemucs',name:'Demucs',ready:false,state:'missing',downloadBytes:83886080,weightBytes:0}],busy:false,dependencyBytes:0};
  const {nodes}=await mount(storage,{health:()=>{if(!online)throw Error('offline');return {service:'echo-karaoke',maxSeconds:600,modelManagement:true};},globals:{chrome:{runtime:{onMessage:{addListener(){}},async sendMessage(message){return message.action==='models'?catalog:{};}}}}});
  assert.equal(nodes.has('openBacking'),false);
  nodes.get('backingSettings').onclick();
  await waitUntil(()=>nodes.get('karaokeService').textContent.includes('未连接'));
  assert.equal(nodes.get('settings-backing').hidden,false);
  assert.equal(nodes.get('karaokeHelp').open,true);
  assert.match(nodes.get('backingSetupStatus').textContent,/安装并启动本机服务/);
  online=true;await nodes.get('checkKaraoke').onclick();
  assert.match(nodes.get('backingSetupStatus').textContent,/管理与下载模型/);
  await nodes.get('manageModels').onclick();assert.equal(nodes.get('modelDialog').open,true);
  nodes.get('closeModels').onclick();
  catalog.models[0].ready=true;await nodes.get('checkKaraoke').onclick();
  assert.match(nodes.get('backingSetupStatus').textContent,/已就绪.*直接选择范围并生成/);
  nodes.get('closeSettings').onclick();(await storage.ready).close();
});


test('original preview exposes its volume beside progress without changing accompaniment gain',async()=>{
  const storage=createStorage(new IDBFactory()),video=leadInVideo({hold:true});video.volume=.65;
  const {nodes}=await mount(storage,{video,globals:{requestAnimationFrame:fn=>setTimeout(fn,1),cancelAnimationFrame:clearTimeout}});
  assert.equal(nodes.get('originalVolumeControl').hidden,true);
  const pending=nodes.get('original').onclick();await waitUntil(()=>nodes.get('originalVolumeControl').hidden===false);
  assert.equal(nodes.get('originalVolumeValue').textContent,'65%');
  nodes.get('playbackSpeed').value='0.5';nodes.get('playbackSpeed').onchange();assert.equal(video.playbackRate,.5);assert.equal(nodes.get('speed').value,'0.5');
  nodes.get('originalVolume').value='.3';nodes.get('originalVolume').oninput();assert.equal(video.volume,.3);
  assert.equal(nodes.get('backingVolume').value,'1');
  await nodes.get('pausePlayback').onclick();assert.equal(nodes.get('originalVolumeControl').hidden,false);
  nodes.get('stop').onclick();await pending;
  assert.equal(nodes.get('originalVolumeControl').hidden,true);assert.equal(video.volume,.3);
  (await storage.ready).close();
});


for(const speed of ['0.5','0.9','1.4'])test(`practice restores saved ${speed} speed`,async()=>{
  const storage=createStorage(new IDBFactory());
  await storage.saveSession({videoId:'video',start:0,end:5,speed,cues:[]});
  const {nodes}=await mount(storage);
  assert.equal(nodes.get('speed').value,speed);
  (await storage.ready).close();
});

test('original loop repeats the range without hiding progress and can be switched off while playing',async()=>{
  const storage=createStorage(new IDBFactory()),video=leadInVideo({hold:true});
  const {nodes}=await mount(storage,{video,globals:{requestAnimationFrame:fn=>setTimeout(fn,1),cancelAnimationFrame:clearTimeout}});
  const pending=nodes.get('original').onclick();await waitUntil(()=>video.plays.length===1 && !nodes.get('originalVolumeControl').hidden);
  assert.equal(nodes.get('originalLoopControl').hidden,false);nodes.get('originalLoop').checked=true;
  video.currentTime=5;await waitUntil(()=>video.plays.length===2);
  assert.equal(nodes.get('transport').hidden,false);assert.equal(video.plays[1].at,0);
  nodes.get('originalLoop').checked=false;video.currentTime=5;await pending;
  assert.equal(video.plays.length,2);assert.equal(nodes.get('originalLoopControl').hidden,true);
  (await storage.ready).close();
});

for(const stage of ['lead-in','recording'])test(`restart from ${stage} discards only the current attempt and runs preparation again`,async()=>{
  const storage=createStorage(new IDBFactory()),video=leadInVideo({hold:true});let requests=0,released=0;
  await storage.saveSession({videoId:'video',activity:'sing',scopes:{sing:'clip'},backingPreferences:{sing:false},start:10,end:20,speed:'0.5',cues:[],leadInMode:stage==='lead-in'?'seconds':'none',leadInSeconds:3});
  await storage.saveTake({id:'kept-version',videoId:'video',kind:'song',cueKey:'song:manual:10.00:20.00',start:10,end:20,speed:1,createdAt:1,blob:new Blob(['kept'])});
  class MediaRecorder{static isTypeSupported(){return true;}constructor(){this.state='inactive';this.mimeType='audio/webm';}
    start(){this.state='recording';}stop(){this.state='inactive';this.ondataavailable({data:new Blob(['new-voice'])});queueMicrotask(()=>this.onstop());}}
  const {nodes}=await mount(storage,{video,globals:{MediaRecorder,navigator:{mediaDevices:{async getUserMedia(){requests++;return {getTracks:()=>[{stop(){released++;}}]};}}},requestAnimationFrame:fn=>setTimeout(fn,1),cancelAnimationFrame:clearTimeout}});
  const first=nodes.get('record').onclick();await waitUntil(()=>nodes.get('panel').dataset.mode===stage && video.plays.length===1);
  assert.equal(nodes.get('restartRecording').hidden,false);
  const restarted=nodes.get('restartRecording').onclick();
  await waitUntil(()=>requests===2 && video.plays.length===2);
  assert.equal((await storage.listTakes('video')).length,1);assert.ok(released>=1);
  assert.equal(video.plays[1].at,stage==='lead-in'?7:10);assert.equal(video.playbackRate,1);
  if(stage==='lead-in'){video.currentTime=10;await waitUntil(()=>nodes.get('panel').dataset.mode==='recording' && video.plays.length===3);}
  nodes.get('stop').onclick();await Promise.all([first,restarted]);
  const takes=await storage.listTakes('video');assert.equal(takes.length,2);assert.ok(takes.some(take=>take.id==='kept-version'));
  assert.equal(nodes.get('restartRecording').hidden,true);(await storage.ready).close();
});

test('backing key controls save per-video semitones, bound changes and restore after reload',async()=>{
  const storage=createStorage(new IDBFactory());
  let {nodes}=await mount(storage);
  nodes.get('backingPitch').value='3';nodes.get('backingPitch').oninput();
  await waitUntil(()=>nodes.get('backingPitchValue').textContent==='+3 半音');
  await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal((await storage.getSession('video')).backingPitch,3);
  ({nodes}=await mount(storage));assert.equal(Number(nodes.get('backingPitch').value),3);
  nodes.get('backingPitchUp').onclick();assert.equal(Number(nodes.get('backingPitch').value),4);
  nodes.get('backingPitch').value='99';nodes.get('backingPitch').oninput();assert.equal(Number(nodes.get('backingPitch').value),6);
  assert.equal(nodes.get('backingPitchUp').disabled,true);
  nodes.get('backingPitchReset').onclick();assert.equal(nodes.get('backingPitchValue').textContent,'原调');
  await new Promise(resolve=>setTimeout(resolve,10));(await storage.ready).close();
});

test('custom assembly previews and downloads only its range using a covering partial backing',async()=>{
  const storage=createStorage(new IDBFactory()),requests=[];
  await storage.saveTake({id:'vocal',videoId:'video',kind:'song',capture:'vocal',cueKey:'same',label:'vocal',start:0,end:10,speed:1,createdAt:1,blob:new Blob(['voice'])});
  await storage.saveBacking({key:'partial-backing',videoId:'video',start:3,end:8,createdAt:1,blob:new Blob(['music'])});
  const {nodes,downloads}=await mount(storage,{video:{duration:20,pause(){}},globals:{setTimeout:(fn,ms)=>setTimeout(fn,ms===30000?0:ms),EchoAudioExport:{...require('../extension/audio-export.js'),async render(options){requests.push(options);return {blob:new Blob(['clip']),gaps:[]};}}}});
  nodes.get('assemblyType').value='mixed';await nodes.get('assembleSong').onclick();
  nodes.get('assemblyScope').value='custom';nodes.get('assemblyStart').value='3';nodes.get('assemblyEnd').value='8';nodes.get('assemblyScope').onchange();
  assert.equal(nodes.get('assemblyCustomRange').hidden,false);
  assert.match(nodes.get('assemblyEditorInfo').textContent,/5.0 \/ 5.0/);
  await nodes.get('assemblyPreview').onclick();await nodes.get('assemblyDownload').onclick();
  assert.equal(requests.length,2);
  for(const request of requests){assert.equal(request.origin,3);assert.equal(request.duration,5);assert.equal(request.backing.key,'partial-backing');assert.deepEqual(request.selection.map(part=>[part.start,part.end,part.takeId]),[[3,8,'vocal']]);}
  assert.match(downloads[0].download,/00m03.0s-00m08.0s_片段合成/);
  nodes.get('assemblyStart').value='9';nodes.get('assemblyStart').onchange();assert.equal(nodes.get('assemblyDownload').disabled,true);assert.match(nodes.get('assemblyRangeHint').textContent,/起止时间/);
  await nodes.get('assemblyDownload').onclick();assert.equal(requests.length,2);
  nodes.get('assemblyStart').value='3';nodes.get('assemblyStart').onchange();assert.equal(nodes.get('assemblyDownload').disabled,false);
  nodes.get('assemblyScope').value='whole';nodes.get('assemblyScope').onchange();assert.equal(nodes.get('assemblyCustomRange').hidden,true);assert.match(nodes.get('assemblyEditorInfo').textContent,/10.0 \/ 20.0/);
  nodes.get('closeAssembly').onclick();(await storage.ready).close();
});


test('clicking lyrics during whole original playback seeks and resumes without changing range, speed or volume',async()=>{
  const storage=createStorage(new IDBFactory()),video=leadInVideo({hold:true});video.volume=.4;
  const cues=[{start:0,end:5,text:'First line'},{start:10,end:15,text:'Second line'},{start:20,end:25,text:'Third line'}];
  await storage.saveSession({videoId:'video',activity:'sing',scopes:{sing:'whole'},start:0,end:30,index:0,speed:'0.5',cues,leadInMode:'none'});
  const {nodes}=await mount(storage,{video,globals:{requestAnimationFrame:fn=>setTimeout(fn,1),cancelAnimationFrame:clearTimeout}});
  const pending=nodes.get('original').onclick();await waitUntil(()=>!nodes.get('originalVolumeControl').hidden);
  nodes.get('originalLoop').checked=true;
  await nodes.get('pausePlayback').onclick();assert.equal(nodes.get('pausePlayback').textContent,'▶ 继续');
  await nodes.get('captionNext').onclick();assert.equal(video.currentTime,10);assert.equal(nodes.get('position').textContent,'2 / 3');
  assert.equal(nodes.get('pausePlayback').textContent,'Ⅱ 暂停');assert.equal(video.playbackRate,.5);assert.equal(video.volume,.4);
  assert.equal(nodes.get('practiceScope').value,'whole');assert.equal(nodes.get('originalLoop').checked,true);
  const row=nodes.get('list').children[2];assert.equal(row.disabled,false);await row.onclick();assert.equal(video.currentTime,20);assert.equal(nodes.get('position').textContent,'3 / 3');
  nodes.get('stop').onclick();await pending;(await storage.ready).close();
});

test('clicking a different lyric in clip playback updates the end boundary instead of stopping at the old end',async()=>{
  const storage=createStorage(new IDBFactory()),video=leadInVideo({hold:true});
  await storage.saveSession({videoId:'video',start:0,end:5,index:0,speed:'1',cues:[{start:0,end:5,text:'First line'},{start:5,end:10,text:'Second line'}],leadInMode:'none'});
  const {nodes}=await mount(storage,{video,globals:{requestAnimationFrame:fn=>setTimeout(fn,1),cancelAnimationFrame:clearTimeout}});
  const pending=nodes.get('original').onclick();await waitUntil(()=>!nodes.get('originalVolumeControl').hidden);
  await nodes.get('list').children[1].onclick();assert.equal(video.currentTime,5);
  assert.equal(Number(nodes.get('start').value),5);assert.equal(Number(nodes.get('end').value),10);
  await new Promise(resolve=>setTimeout(resolve,5));assert.equal(nodes.get('panel').dataset.mode,'original');
  let stopped=0;const word=nodes.get('caption').children.find(node=>node.className==='word');assert.equal(word.disabled,false);
  video.currentTime=7;await word.onclick({stopPropagation(){stopped++;}});assert.equal(video.currentTime,5);assert.equal(stopped,1);
  video.currentTime=10;await pending;assert.equal(nodes.get('panel').dataset.mode,'idle');
  (await storage.ready).close();
});


test('stopping a lead-in restores volume immediately even while video.play is pending',async()=>{
  const storage=createStorage(new IDBFactory()),video=leadInVideo({hold:true});let release;
  video.volume=.7;const play=video.play;video.play=async function(){await play.call(this);await new Promise(resolve=>{release=resolve;});};
  await storage.saveSession({videoId:'video',start:10,end:15,speed:'1',cues:[],leadInMode:'seconds',leadInSeconds:3,backingVolume:.4});
  class MediaRecorder{static isTypeSupported(){return true;}constructor(){this.state='inactive';}}
  const {nodes}=await mount(storage,{video,globals:{MediaRecorder,navigator:{mediaDevices:{getUserMedia:async()=>({getTracks:()=>[{stop(){}}]})}},requestAnimationFrame:fn=>setTimeout(fn,1),cancelAnimationFrame:clearTimeout}});
  const pending=nodes.get('record').onclick();await waitUntil(()=>!!release);
  assert.equal(video.volume,.4);nodes.get('stop').onclick();assert.equal(video.volume,.7);
  video.volume=.9;release();await pending;assert.equal(video.volume,.9);
  (await storage.ready).close();
});


for(const source of ['backing','original'])for(const seconds of [0,3,10])test(`skip intro and interlude with ${source} prepares ${seconds} seconds before lyrics and saves aligned vocal pieces`,async()=>{
  const storage=createStorage(new IDBFactory()),video=leadInVideo({hold:true});let requests=0,captures=0;
  const cues=[{start:0,end:5,text:'[Music]'},{start:5,end:8,text:'First lyric'},{start:8,end:12,text:'间奏'},{start:12,end:16,text:'Second lyric'}];
  await storage.saveSession({videoId:'video',activity:'sing',backingPitch:3,scopes:{sing:'whole'},recordingPlaybackPreferences:{speech:'silent',sing:source},start:0,end:60,speed:'0.5',cues,leadInMode:'previous',leadInSeconds:seconds});
  await storage.saveBacking({key:'music',videoId:'video',start:0,end:60,createdAt:1,blob:new Blob(['music'])});
  class MediaRecorder{static isTypeSupported(){return true;}constructor(){this.state='inactive';this.mimeType='audio/webm';}start(){captures++;this.state='recording';}stop(){this.state='inactive';this.ondataavailable({data:new Blob(['dry-voice'])});queueMicrotask(()=>this.onstop());}}
  const {nodes}=await mount(storage,{video,globals:{EchoOriginalAudio:{clear(){},async create(options){assert.equal(options.semitones,3);return {media:video,dispose(){}};}},MediaRecorder,navigator:{mediaDevices:{async getUserMedia(){requests++;return {getTracks:()=>[{stop(){}}]};}}},EchoKaraoke:{...require('../extension/karaoke.js'),async createMonitor(options){assert.equal(options.pitchSemitones,3);return {sync:async()=>{},pause(){},dispose(){},setVolume(){}};}},requestAnimationFrame:fn=>setTimeout(fn,1),cancelAnimationFrame:clearTimeout}});
  const first=nodes.get('record').onclick();await waitUntil(()=>nodes.get('panel').dataset.mode==='recording' && video.plays.length===1);
  assert.equal(nodes.get('skipInstrumental').disabled,false);assert.match(nodes.get('skipInstrumental').textContent,/前奏/);
  const intro=nodes.get('skipInstrumental').onclick();await waitUntil(()=>requests===2 && video.plays.length===2);
  assert.equal(video.currentTime,Math.max(0,5-seconds));assert.equal((await storage.listTakes('video')).length,0);assert.equal(video.playbackRate,1);
  if(seconds){
    assert.equal(nodes.get('panel').dataset.mode,'lead-in');assert.equal(captures,1);
    video.advance(5);await waitUntil(()=>nodes.get('panel').dataset.mode==='recording' && captures===2);
  }
  await waitUntil(()=>captures===2 && video.plays.length===(seconds?3:2));
  video.advance(6);assert.equal(nodes.get('skipInstrumental').disabled,true);
  video.advance(9);assert.equal(nodes.get('skipInstrumental').disabled,false);assert.match(nodes.get('skipInstrumental').textContent,/间奏/);
  const beforeMiddle=video.plays.length;
  const middle=nodes.get('skipInstrumental').onclick();await waitUntil(()=>requests===3 && video.plays.length===beforeMiddle+1);
  assert.equal(video.currentTime,Math.max(0,12-seconds));
  if(seconds){
    assert.equal(nodes.get('panel').dataset.mode,'lead-in');assert.equal(captures,2);
    video.advance(12);await waitUntil(()=>nodes.get('panel').dataset.mode==='recording' && captures===3);
  }
  await waitUntil(()=>captures===3 && video.plays.length===beforeMiddle+(seconds?2:1));video.advance(15);nodes.get('stop').onclick();await Promise.all([first,intro,middle]);
  const takes=(await storage.listTakes('video')).sort((a,b)=>a.start-b.start);assert.equal(takes.length,2);
  assert.deepEqual(takes.map(t=>[t.start,t.end,t.capturedEnd,t.speed]),[[5,9,9,1],[12,60,15,1]]);
  assert.ok(takes.every(t=>t.backingPitch===3));assert.equal(takes[0].effects,undefined);assert.ok(takes.every(t=>t.backingKey==='music' && t.capture==='vocal'));
  const plan=require('../extension/audio-export.js').plan(takes,60);assert.deepEqual(plan.segments.map(s=>[s.start,s.end]),[[5,9],[12,15]]);
  assert.equal(nodes.get('skipInstrumental').hidden,true);(await storage.ready).close();
});

test('restarting a skipped lyric keeps its N-second preparation instead of the previous-cue setting',async()=>{
  const storage=createStorage(new IDBFactory()),video=leadInVideo({hold:true});let captures=0;
  await storage.saveSession({videoId:'video',activity:'sing',scopes:{sing:'whole'},recordingPlaybackPreferences:{sing:'silent'},cues:[{start:5,end:10,text:'First lyric'}],leadInMode:'previous',leadInSeconds:3});
  class MediaRecorder{static isTypeSupported(){return true;}constructor(){this.state='inactive';this.mimeType='audio/webm';}start(){captures++;this.state='recording';}stop(){this.state='inactive';this.ondataavailable({data:new Blob(['voice'])});queueMicrotask(()=>this.onstop());}}
  const {nodes}=await mount(storage,{video,globals:{MediaRecorder,navigator:{mediaDevices:{async getUserMedia(){return {getTracks:()=>[{stop(){}}]};}}},requestAnimationFrame:fn=>setTimeout(fn,1),cancelAnimationFrame:clearTimeout}});
  const recording=nodes.get('record').onclick();await waitUntil(()=>video.plays.length===1);
  const skipping=nodes.get('skipInstrumental').onclick();await waitUntil(()=>video.plays.length===2);
  assert.equal(video.currentTime,2);assert.equal(captures,1);
  const restarting=nodes.get('restartRecording').onclick();await waitUntil(()=>video.plays.length===3);
  assert.equal(video.currentTime,2);assert.equal(nodes.get('panel').dataset.mode,'lead-in');assert.equal(captures,1);
  video.advance(5);await waitUntil(()=>video.plays.length===4 && captures===2);
  video.advance(7);nodes.get('stop').onclick();await Promise.all([recording,skipping,restarting]);
  const takes=await storage.listTakes('video');assert.equal(takes.length,1);assert.equal(takes[0].start,5);assert.equal(takes[0].capturedEnd,7);
  (await storage.ready).close();
});

test('interlude skip stops on storage failure and leaves the unsaved vocal available for recovery',async()=>{
  const storage=createStorage(new IDBFactory()),video=leadInVideo({hold:true});let requests=0;
  await storage.saveSession({videoId:'video',activity:'sing',scopes:{sing:'whole'},recordingPlaybackPreferences:{sing:'silent'},speed:'1',cues:[{start:0,end:3,text:'First lyric'},{start:10,end:15,text:'Second lyric'}],leadInMode:'none'});
  storage.saveTake=async()=>{throw Error('disk full');};
  class MediaRecorder{static isTypeSupported(){return true;}constructor(){this.state='inactive';this.mimeType='audio/webm';}start(){this.state='recording';}stop(){this.state='inactive';this.ondataavailable({data:new Blob(['recover-this'])});queueMicrotask(()=>this.onstop());}}
  const {nodes}=await mount(storage,{video,globals:{MediaRecorder,navigator:{mediaDevices:{async getUserMedia(){requests++;return {getTracks:()=>[{stop(){}}]};}}},requestAnimationFrame:fn=>setTimeout(fn,1),cancelAnimationFrame:clearTimeout}});
  const pending=nodes.get('record').onclick();await waitUntil(()=>video.plays.length===1);video.advance(5);
  await nodes.get('skipInstrumental').onclick();await pending;
  assert.equal(requests,1);assert.equal(nodes.get('panel').dataset.mode,'idle');assert.match(nodes.get('status').textContent,/保存失败/);assert.equal(nodes.get('replay').disabled,false);
  (await storage.ready).close();
});

test('stopping while an interlude segment is saving prevents the continuation from starting',async()=>{
  const storage=createStorage(new IDBFactory()),video=leadInVideo({hold:true});let requests=0,release;
  await storage.saveSession({videoId:'video',activity:'sing',scopes:{sing:'whole'},recordingPlaybackPreferences:{sing:'silent'},speed:'1',cues:[{start:0,end:3,text:'First lyric'},{start:10,end:15,text:'Second lyric'}],leadInMode:'none'});
  const save=storage.saveTake;storage.saveTake=value=>new Promise(resolve=>{release=async()=>resolve(await save(value));});
  class MediaRecorder{static isTypeSupported(){return true;}constructor(){this.state='inactive';this.mimeType='audio/webm';}start(){this.state='recording';}stop(){this.state='inactive';this.ondataavailable({data:new Blob(['keep-first-part'])});queueMicrotask(()=>this.onstop());}}
  const {nodes}=await mount(storage,{video,globals:{MediaRecorder,navigator:{mediaDevices:{async getUserMedia(){requests++;return {getTracks:()=>[{stop(){}}]};}}},requestAnimationFrame:fn=>setTimeout(fn,1),cancelAnimationFrame:clearTimeout}});
  const recording=nodes.get('record').onclick();await waitUntil(()=>video.plays.length===1);video.advance(5);
  const skipping=nodes.get('skipInstrumental').onclick();await waitUntil(()=>!!release);
  nodes.get('stop').onclick();await release();await Promise.all([recording,skipping]);
  assert.equal(requests,1);assert.equal(video.plays.length,1);assert.equal(nodes.get('panel').dataset.mode,'idle');
  const [take]=await storage.listTakes('video');assert.equal(take.start,0);assert.equal(take.end,5);
  (await storage.ready).close();
});

test('assembly labels recorded keys, blocks mixed-key export and recovers after version or range selection',async()=>{
  const storage=createStorage(new IDBFactory());let renders=0;
  const base={videoId:'video',kind:'song',capture:'vocal',speed:1,blob:new Blob(['voice'])};
  for(const take of [{id:'first',cueKey:'first',start:0,end:5,createdAt:1,backingPitch:3},{id:'old',cueKey:'second',start:5,end:10,createdAt:1,backingPitch:3},{id:'new',cueKey:'second',start:5,end:10,createdAt:2,backingPitch:0}])await storage.saveTake({...base,...take});
  const {nodes}=await mount(storage,{video:{duration:10,pause(){}},globals:{EchoAudioExport:{...require('../extension/audio-export.js'),async render(){renders++;return {blob:new Blob(['mix']),gaps:[]};}}}});
  await nodes.get('assembleSong').onclick();
  assert.equal(nodes.get('assemblyPreview').disabled,true);assert.equal(nodes.get('assemblyDownload').disabled,true);
  assert.match(nodes.get('assemblyRangeHint').textContent,/调性不一致/);
  const second=nodes.get('assemblyEditorList').children[1],candidates=second.children[1].children;
  assert.ok(candidates.some(option=>/原调/.test(option.children[0].children[1].textContent)));assert.ok(candidates.some(option=>/\+3 半音/.test(option.children[0].children[1].textContent)));
  await nodes.get('assemblyPreview').onclick();assert.equal(renders,0);
  candidates[1].children[0].onclick();assert.equal(nodes.get('assemblyDownload').disabled,false);assert.match(nodes.get('assemblyEditorInfo').textContent,/\+3 半音/);
  await nodes.get('assemblyPreview').onclick();assert.equal(renders,1);
  candidates[0].children[0].onclick();assert.equal(nodes.get('assemblyPreview').disabled,true);
  nodes.get('assemblyScope').value='custom';nodes.get('assemblyStart').value='0';nodes.get('assemblyEnd').value='5';nodes.get('assemblyScope').onchange();
  assert.equal(nodes.get('assemblyPreview').disabled,false);await nodes.get('assemblyPreview').onclick();assert.equal(renders,2);
  nodes.get('closeAssembly').onclick();(await storage.ready).close();
});

test('pitched original listening keeps the selected speed, navigation and cleanup on the reference adapter',async()=>{
  const storage=createStorage(new IDBFactory()),video=leadInVideo({hold:true});video.volume=.6;let options,disposed=0;
  await storage.saveSession({videoId:'video',activity:'sing',scopes:{sing:'clip'},start:5,end:8,index:0,speed:'0.5',backingPitch:3,leadInMode:'none',cues:[{start:5,end:8,text:'First'},{start:10,end:13,text:'Next'}]});
  const {nodes}=await mount(storage,{video,globals:{EchoOriginalAudio:{clear(){},async create(value){options=value;return {media:video,range:{start:0,end:60},dispose(){disposed++;}};}},requestAnimationFrame:fn=>setTimeout(fn,1),cancelAnimationFrame:clearTimeout}});
  const pending=nodes.get('original').onclick();await waitUntil(()=>video.plays.length===1);
  assert.equal(options.semitones,3);assert.equal(video.playbackRate,.5);assert.match(nodes.get('status').textContent,/正在播放原声.*\+3 半音/);
  await nodes.get('captionNext').onclick();assert.equal(video.currentTime,10);assert.equal(nodes.get('clipCue').value,'1');
  nodes.get('stop').onclick();await pending;assert.equal(disposed,1);assert.equal(video.playbackRate,1.25);
  (await storage.ready).close();
});

test('stopping during prepared-original setup disposes the late output without starting playback',async()=>{
  const storage=createStorage(new IDBFactory()),video=leadInVideo({hold:true});let finish,disposed=0,pauses=0;
  video.muted=false;video.pause=()=>{pauses++;};
  await storage.saveSession({videoId:'video',activity:'sing',scopes:{sing:'whole'},backingPitch:2,leadInMode:'none'});
  const {nodes}=await mount(storage,{video,globals:{EchoOriginalAudio:{clear(){},create:()=>new Promise(resolve=>{finish=()=>resolve({media:video,range:{start:0,end:60},dispose(){disposed++;}});})}}});
  const pending=nodes.get('original').onclick();await waitUntil(()=>!!finish);assert.ok(pauses>0,'pause native YouTube audio before preparing the pitched track');assert.equal(video.muted,true);
  nodes.get('stop').onclick();finish();await pending;
  assert.equal(disposed,1);assert.equal(video.plays.length,0);assert.equal(video.muted,false);assert.equal(nodes.get('panel').dataset.mode,'idle');(await storage.ready).close();
});

test('jumping outside a prepared original clip in a long video prepares the next range without stale completion',async()=>{
  const storage=createStorage(new IDBFactory()),video=leadInVideo({hold:true});video.duration=1200;let prepared=0,disposed=0;
  await storage.saveSession({videoId:'video',activity:'sing',scopes:{sing:'clip'},start:5,end:8,index:0,speed:'0.5',backingPitch:3,leadInMode:'none',cues:[{start:5,end:8,text:'First'},{start:10,end:13,text:'Next'}]});
  const {nodes}=await mount(storage,{video,globals:{EchoOriginalAudio:{clear(){},async create(value){prepared++;return {media:video,range:{...value.range},dispose(){disposed++;}};}},requestAnimationFrame:fn=>setTimeout(fn,1),cancelAnimationFrame:clearTimeout}});
  const pending=nodes.get('original').onclick();await waitUntil(()=>video.plays.length===1);
  const jumping=nodes.get('captionNext').onclick();await waitUntil(()=>video.plays.length===2);
  assert.equal(prepared,2);assert.equal(disposed,1);assert.equal(video.currentTime,10);assert.equal(video.playbackRate,.5);assert.equal(nodes.get('panel').dataset.mode,'original');
  nodes.get('stop').onclick();await Promise.all([pending,jumping]);assert.equal(disposed,2);assert.equal(nodes.get('panel').dataset.mode,'idle');(await storage.ready).close();
});

test('original comparison follows the selected recording key rather than the later practice setting',async()=>{
  const storage=createStorage(new IDBFactory()),video=leadInVideo({hold:true});let key;
  await storage.saveSession({videoId:'video',activity:'sing',backingPitch:0,leadInMode:'none'});
  await storage.saveTake({id:'voice',videoId:'video',cueKey:'line',kind:'song',capture:'vocal',start:5,end:8,speed:1,createdAt:1,backingPitch:3,blob:new Blob(['voice'])});
  const {nodes}=await mount(storage,{video,globals:{EchoOriginalAudio:{clear(){},async create(value){key=value.semitones;return {media:video,range:{start:0,end:60},dispose(){}};}},requestAnimationFrame:fn=>setTimeout(fn,1),cancelAnimationFrame:clearTimeout}});
  nodes.get('tab-recordings').onclick();await nodes.get('historyList').children[0].children[0].onclick();
  nodes.get('reviewReplayMode').value='sequential';nodes.get('reviewReplayMode').onchange();
  const comparing=nodes.get('reviewReplay').onclick();await waitUntil(()=>video.plays.length===1);assert.equal(key,3);
  nodes.get('stop').onclick();await comparing;(await storage.ready).close();
});

test('vertical assembly lists every overlap candidate, auditions without selecting and exports the chosen interval cuts',async()=>{
  const storage=createStorage(new IDBFactory()),requests=[];
  const base={videoId:'video',kind:'song',capture:'vocal',speed:1,blob:new Blob(['voice'])};
  await storage.saveTake({...base,id:'A',cueKey:'A',label:'A',start:0,end:10,createdAt:1});
  await storage.saveTake({...base,id:'B',cueKey:'B',label:'B',start:8,end:15,createdAt:2});
  const {nodes}=await mount(storage,{video:{duration:15,pause(){}},globals:{setTimeout:(fn,ms)=>setTimeout(fn,ms===30000?0:ms),EchoAudioExport:{...require('../extension/audio-export.js'),async render(options){requests.push(options);return {blob:new Blob(['cut']),gaps:[]};}}}});
  await nodes.get('assembleSong').onclick();
  const rows=nodes.get('assemblyEditorList').children;
  assert.equal(rows.length,3);assert.deepEqual(rows.map(row=>row.children[0].children[0].children[1].textContent),['0:00.0–0:08.0','0:08.0–0:10.0','0:10.0–0:15.0']);
  assert.deepEqual(rows.map(row=>row.children[1].children.length),[1,2,1]);
  const [b,a]=rows[1].children[1].children;
  assert.equal(b.children[0].getAttribute('aria-pressed'),'true');assert.equal(a.children[0].getAttribute('aria-pressed'),'false');
  await a.children[1].onclick();
  assert.equal(requests[0].origin,8);assert.equal(requests[0].duration,2);assert.deepEqual(requests[0].selection,[{start:8,end:10,takeId:'A'}]);
  assert.equal(b.children[0].getAttribute('aria-pressed'),'true');assert.match(nodes.get('assemblyEditorMessage').textContent,/点击.*选用/);
  a.children[0].onclick();assert.equal(a.children[0].getAttribute('aria-pressed'),'true');assert.equal(b.children[0].getAttribute('aria-pressed'),'false');
  await nodes.get('assemblyPreview').onclick();await nodes.get('assemblyDownload').onclick();
  assert.deepEqual(requests[1].selection,[{start:0,end:8,takeId:'A'},{start:8,end:10,takeId:'A'},{start:10,end:15,takeId:'B'}]);
  assert.deepEqual(requests[2].selection,requests[1].selection);
  const check=rows[1].children[0].children[0].children[0];check.checked=false;check.onchange();
  await b.children[1].onclick();assert.deepEqual(requests.at(-1).selection,[{start:8,end:10,takeId:'B'}]);assert.equal(check.checked,false);
  b.children[0].onclick();assert.equal(check.checked,true);
  nodes.get('closeAssembly').onclick();(await storage.ready).close();
});


test('recording versions can be starred without switching versions, and assembly shows the saved star',async()=>{
  const storage=createStorage(new IDBFactory());
  for(const [id,createdAt] of [['older',1],['newer',2]])await storage.saveTake({id,videoId:'video',cueKey:'song:range',label:id,start:0,end:10,speed:1,createdAt,kind:'song',capture:'vocal',blob:new Blob(['voice'])});
  const {nodes}=await mount(storage);
  nodes.get('tab-recordings').onclick();
  const versions=nodes.get('versionChoices');
  await versions.children[0].onclick();
  await nodes.get('starTake').onclick();
  assert.equal(nodes.get('starTake').attrs['aria-pressed'],'true');
  assert.match(versions.children[0].textContent,/★/);
  assert.equal(versions.children[0].attrs['aria-pressed'],'true');
  assert.equal((await storage.listTakes('video')).find(t=>t.id==='older').starred,true);
  await nodes.get('assembleSong').onclick();
  const candidates=nodes.get('assemblyEditorList').children[0].children[1];
  assert.match(candidates.children[1].children[0].children[0].textContent,/★ older/);
  assert.equal(candidates.children[0].children[0].attrs['aria-pressed'],'true');
  await candidates.children[1].children[2].onclick();
  assert.equal(candidates.children[1].children[2].attrs['aria-pressed'],'false');
  assert.equal((await storage.listTakes('video')).find(t=>t.id==='older').starred,false);
  assert.equal(candidates.children[0].children[0].attrs['aria-pressed'],'true');
  nodes.get('closeAssembly').onclick();
  assert.equal(nodes.get('starTake').attrs['aria-pressed'],'false');
  (await storage.ready).close();
});

test('assembly adjustments are scoped to interval and candidate, persisted, and shared by preview and export',async()=>{
  const storage=createStorage(new IDBFactory()),requests=[];
  const base={videoId:'video',kind:'song',capture:'vocal',speed:1,blob:new Blob(['voice'])};
  await storage.saveTake({...base,id:'A',cueKey:'A',label:'A',start:0,end:10,createdAt:1,effects:{delayMs:40}});
  await storage.saveTake({...base,id:'B',cueKey:'B',label:'B',start:8,end:15,createdAt:2});
  const {nodes}=await mount(storage,{video:{duration:15,pause(){}},globals:{setTimeout:(fn,ms)=>setTimeout(fn,ms===30000?0:ms),EchoAudioExport:{...require('../extension/audio-export.js'),async render(options){requests.push(options);return {blob:new Blob(['cut']),gaps:[]};}}}});
  await nodes.get('assembleSong').onclick();
  let rows=nodes.get('assemblyEditorList').children;
  const overlap=rows[1],candidates=overlap.children[1].children;
  overlap.children[0].children[2].onclick();
  assert.equal(nodes.get('assemblyAdjustDialog').open,true);
  assert.equal(nodes.get('assemblyLocalDelay').value,0);
  nodes.get('assemblyLocalDelay').value='-30';nodes.get('assemblyLocalDelay').onchange();
  nodes.get('assemblyLocalVolumeSlider').value='119';nodes.get('assemblyLocalVolumeSlider').oninput();
  assert.equal(nodes.get('assemblyLocalVolume').value,'119');nodes.get('assemblyLocalVolumeSlider').onchange();
  nodes.get('assemblyLocalLouder').onclick();assert.equal(nodes.get('assemblyLocalVolume').value,120);
  nodes.get('assemblyLocalQuieter').onclick();assert.equal(nodes.get('assemblyLocalVolumeSlider').value,119);
  nodes.get('assemblyLocalVolume').value='120';nodes.get('assemblyLocalVolume').onchange();
  assert.equal(nodes.get('assemblyLocalVolumeSlider').value,120);
  nodes.get('assemblyLocalFadeIn').value='0.1';nodes.get('assemblyLocalFadeIn').onchange();
  assert.match(overlap.children[2].children[0].textContent,/提前 30 ms.*120%.*淡入/);
  await nodes.get('assemblyLocalPreview').onclick();
  assert.equal(requests.at(-1).origin,8);assert.equal(requests.at(-1).duration,2);
  assert.equal(requests.at(-1).selection[0].adjustment.delayMs,-30);
  assert.equal(requests.at(-1).selection[0].adjustment.volume,1.2);
  await nodes.get('assemblyLocalContext').onclick();
  assert.equal(requests.at(-1).origin,6);assert.equal(requests.at(-1).duration,6);
  assert.deepEqual(requests.at(-1).selection.map(s=>[s.start,s.end,s.takeId]),[[6,8,'A'],[8,10,'B'],[10,12,'B']]);
  assert.equal(requests.at(-1).selection[0].adjustment,undefined);
  assert.equal(requests.at(-1).selection[2].adjustment,undefined);
  nodes.get('closeAssemblyAdjust').onclick();assert.equal(nodes.get('assemblyAdjustDialog').open,false);
  candidates[1].children[0].onclick();overlap.children[0].children[2].onclick();
  assert.equal(nodes.get('assemblyLocalDelay').value,0);assert.match(nodes.get('assemblyLocalInherited').textContent,/版本对齐 40 ms/);
  nodes.get('assemblyLocalLater').onclick();assert.equal(nodes.get('assemblyLocalDelay').value,10);
  nodes.get('closeAssemblyAdjust').onclick();candidates[0].children[0].onclick();overlap.children[0].children[2].onclick();
  assert.equal(nodes.get('assemblyLocalDelay').value,-30);assert.equal(nodes.get('assemblyLocalVolume').value,120);
  nodes.get('closeAssemblyAdjust').onclick();
  await nodes.get('assemblyPreview').onclick();const full=requests.at(-1);
  await nodes.get('assemblyDownload').onclick();assert.deepEqual(requests.at(-1).selection,full.selection);
  await waitUntil(()=>nodes.get('assemblyEditorMessage').textContent.includes('下载'));
  nodes.get('closeAssembly').onclick();await nodes.get('assembleSong').onclick();
  rows=nodes.get('assemblyEditorList').children;rows[1].children[0].children[2].onclick();assert.equal(nodes.get('assemblyLocalDelay').value,-30);
  nodes.get('assemblyLocalReset').onclick();assert.equal(nodes.get('assemblyLocalDelay').value,0);
  nodes.get('closeAssemblyAdjust').onclick();
  nodes.get('assemblyReset').onclick();
  rows[1].children[1].children[1].children[0].onclick();rows[1].children[0].children[2].onclick();
  assert.equal(nodes.get('assemblyLocalDelay').value,10,'restoring latest does not erase candidate-specific adjustments');
  nodes.get('closeAssembly').onclick();assert.equal(nodes.get('assemblyAdjustDialog').open,false);
  assert.deepEqual((await storage.listTakes('video')).find(t=>t.id==='A').effects,{delayMs:40});
  const session=await storage.getSession('video');assert.equal(session.assemblyChoices[1].adjustments[0].takeId,'A');
  (await storage.ready).close();
});


test('closing assembly adjustment during preparation cancels its result and keeps later preview usable',async()=>{
  const storage=createStorage(new IDBFactory());let pending;
  await storage.saveTake({id:'A',videoId:'video',kind:'song',capture:'vocal',cueKey:'A',label:'A',start:0,end:10,speed:1,createdAt:1,blob:new Blob(['voice'])});
  const {nodes}=await mount(storage,{video:{duration:10,pause(){}},globals:{EchoAudioExport:{...require('../extension/audio-export.js'),render:options=>new Promise(resolve=>{pending={options,resolve};})}}});
  await nodes.get('assembleSong').onclick();nodes.get('assemblyEditorList').children[0].children[0].children[2].onclick();
  const first=nodes.get('assemblyLocalPreview').onclick();assert.equal(nodes.get('assemblyLocalDelay').disabled,true);
  nodes.get('closeAssemblyAdjust').onclick();assert.equal(pending.options.active(),false);
  pending.resolve({blob:new Blob(['obsolete'])});await first;assert.equal(nodes.get('assemblyAudio').hidden,true);
  assert.equal(nodes.get('assemblyPreview').disabled,false);
  const second=nodes.get('assemblyPreview').onclick();pending.resolve({blob:new Blob(['current'])});await second;
  assert.equal(nodes.get('assemblyAudio').hidden,false);assert.match(nodes.get('assemblyAudioLabel').textContent,/整首拼接/);
  nodes.get('closeAssembly').onclick();(await storage.ready).close();
});


test('assembly overview navigates inside the list without changing selection or starting playback',async()=>{
  const storage=createStorage(new IDBFactory());let renders=0;
  await storage.saveTake({id:'A',videoId:'video',kind:'song',capture:'vocal',cueKey:'A',label:'A',start:2,end:10,speed:1,createdAt:1,blob:new Blob(['voice'])});
  const {nodes}=await mount(storage,{video:{duration:15,pause(){}},globals:{EchoAudioExport:{...require('../extension/audio-export.js'),async render(){renders++;}}}});
  await nodes.get('assembleSong').onclick();
  const list=nodes.get('assemblyEditorList'),rows=list.children,positions=[];
  list.scrollTo=options=>positions.push(options);
  rows.forEach((row,i)=>row.offsetTop=i*200+8);
  const overview=nodes.get('assemblyEditorTimeline');
  assert.equal(overview.children.length,3);
  assert.match(overview.children[1].attrs['aria-label'],/0:02.0–0:10.0.*A/);
  const before=rows.map(row=>row.children[0].children[0].children[0].checked);
  overview.children[1].onclick();assert.deepEqual(positions.at(-1),{top:200,behavior:'smooth'});
  overview.children[2].onclick();assert.deepEqual(positions.at(-1),{top:400,behavior:'smooth'});
  assert.deepEqual(rows.map(row=>row.children[0].children[0].children[0].checked),before);
  assert.equal(renders,0);assert.equal(nodes.get('assemblyAudio').hidden,true);
  nodes.get('assemblyScope').value='custom';nodes.get('assemblyStart').value='3';nodes.get('assemblyEnd').value='8';nodes.get('assemblyScope').onchange();
  assert.equal(overview.children.length,1);assert.match(overview.children[0].attrs['aria-label'],/0:03.0–0:08.0/);
  overview.children[0].onclick();assert.equal(positions.at(-1).top,200);
  nodes.get('closeAssembly').onclick();(await storage.ready).close();
});


test('shared delete icon follows the selected older version and protects stars with explicit confirmation',async()=>{
  const storage=createStorage(new IDBFactory());
  for(const [id,createdAt,starred] of [['older',1,false],['newer',2,true]])await storage.saveTake({id,videoId:'video',cueKey:'same',label:id,start:0,end:5,speed:1,createdAt,starred,blob:new Blob([id])});
  const {nodes}=await mount(storage);nodes.get('tab-recordings').onclick();
  await nodes.get('versionChoices').children[0].onclick();
  assert.equal(nodes.get('historyList').children[0].children.length,1);
  assert.match(nodes.get('deleteTake').title,/older/);
  await nodes.get('deleteTake').onclick();
  assert.deepEqual((await storage.listTakes('video')).map(t=>t.id),['newer']);
  await nodes.get('undoDelete').onclick();
  await nodes.get('versionChoices').children[1].onclick();
  await nodes.get('deleteTake').onclick();
  assert.equal(nodes.get('recordingDeleteDialog').open,true);assert.match(nodes.get('recordingDeleteInfo').textContent,/★ newer/);
  assert.equal((await storage.listTakes('video')).length,2);
  nodes.get('cancelRecordingDelete').onclick();assert.equal((await storage.listTakes('video')).length,2);
  await nodes.get('deleteTake').onclick();await nodes.get('confirmRecordingDelete').onclick();
  assert.deepEqual((await storage.listTakes('video')).map(t=>t.id),['older']);
  await nodes.get('undoDelete').onclick();
  assert.equal((await storage.listTakes('video')).find(t=>t.id==='newer').starred,true);
  (await storage.ready).close();
});

for(const shifted of [false,true])test(`simultaneous comparison ${shifted?'uses recorded key':'uses native original'} with independent volumes, voice clock and shared controls`,async()=>{
  const storage=createStorage(new IDBFactory()),video=leadInVideo({hold:true}),frames=new Map(),preferences=new Map();let sound,next=0,vocalGain=1,backings=0,key,disposed=0;
  video.muted=false;video.volume=.4;video.paused=true;
  const play=video.play;video.play=async()=>{video.paused=false;await play();};video.pause=()=>{video.paused=true;};
  await storage.saveTake({id:'vocal',videoId:'video',cueKey:'line',kind:'song',capture:'vocal',vocalOffset:.2,start:5,end:10,speed:1,createdAt:1,backingPitch:shifted?-2:0,effects:{delayMs:30},blob:new Blob(['voice'])});
  await storage.saveBacking({key:'music',videoId:'video',start:0,end:60,createdAt:1,blob:new Blob(['music'])});
  class Audio{constructor(){sound=this;this.currentTime=0;this.duration=5.2;this.paused=true;}async play(){this.paused=false;}pause(){this.paused=true;}}
  const {nodes}=await mount(storage,{video,globals:{Audio,
    window:{localStorage:{getItem:k=>preferences.get(k),setItem:(k,v)=>preferences.set(k,v)},addEventListener(){},speechSynthesis:{cancel(){}}},
    EchoOriginalAudio:{clear(){},async create(options){key=options.semitones;return {media:video,range:{start:0,end:60},dispose(){disposed++;}};}},
    EchoKaraoke:{...require('../extension/karaoke.js'),async createMonitor(){backings++;throw Error('must not mix extra backing');},async createAudioOutput(){return {setVolume(value){vocalGain=value;},dispose(){}};}},
    requestAnimationFrame(fn){frames.set(++next,fn);return next;},cancelAnimationFrame:id=>frames.delete(id)}});
  const menu=shifted?'reviewReplayMode':'practiceReplayMode',button=shifted?'reviewReplay':'replay';
  if(shifted)nodes.get('tab-recordings').onclick();else{nodes.get('activityMode').value='sing';nodes.get('activityMode').onchange();}
  assert.equal(nodes.get(menu).value,'recording');
  nodes.get(menu).value='simultaneous';nodes.get(menu).onchange();assert.equal(preferences.get('echo-replay-choice-v1'),'simultaneous');
  assert.equal(nodes.get('practiceReplayMode').value,nodes.get('reviewReplayMode').value);
  const comparing=nodes.get(button).onclick();await waitUntil(()=>sound && nodes.get('pausePlayback').hidden===false);
  assert.equal(video.muted,false);assert.equal(sound.paused,false);assert.equal(video.plays.length,0,'wait for recording capture padding');
  sound.currentTime=.4;
  const pending=[...frames.values()];frames.clear();for(const fn of pending)fn();await Promise.resolve();
  assert(Math.abs(video.currentTime-5.2)<.001);assert.equal(video.paused,false);
  assert.equal(nodes.get('originalVolumeControl').hidden,false);assert.equal(nodes.get('replayMusicOption').hidden,true);assert.equal(backings,0);
  assert.match(nodes.get('transportLabel').textContent,/原声＋录音/);
  assert.ok(nodes.get('replayOriginalSlot').children.includes(nodes.get('originalVolumeControl')));
  nodes.get('originalVolume').value='.25';nodes.get('originalVolume').oninput();assert.equal(video.volume,.25);
  assert.match(nodes.get('mixSummary').textContent,/原曲 25%/);
  nodes.get('replayVocalVolume').value='1.3';nodes.get('replayVocalVolume').oninput();assert.equal(vocalGain,1.3);
  nodes.get('resetReplayMix').onclick();assert.equal(video.volume,1);assert.equal(vocalGain,1);assert.match(nodes.get('mixSummary').textContent,/原曲 100%/);
  await nodes.get('pausePlayback').onclick();assert.equal(video.paused,true);assert.equal(sound.paused,true);
  nodes.get('transportProgress').value='.5';await nodes.get('transportProgress').oninput();assert.equal(sound.currentTime,2.6);assert(Math.abs(video.currentTime-7.4)<.001);
  await nodes.get('pausePlayback').onclick();assert.equal(video.paused,false);assert.equal(sound.paused,false);
  nodes.get('stop').onclick();await comparing;
  assert.equal(video.muted,false);assert.equal(video.playbackRate,1.25);assert.equal(nodes.get('originalVolumeControl').hidden,true);assert.equal(frames.size,0);
  assert.ok(nodes.get('originalVolumeHome').children.includes(nodes.get('originalVolumeControl')));
  assert.equal(key,shifted?-2:undefined);assert.equal(disposed,shifted?1:0);
  (await storage.ready).close();
});

test('stopping simultaneous comparison during shifted-original preparation cannot start late audio',async()=>{
  const storage=createStorage(new IDBFactory()),video=leadInVideo({hold:true});let resolve,disposed=0,voices=0;
  await storage.saveTake({id:'voice',videoId:'video',cueKey:'line',capture:'vocal',start:5,end:10,speed:1,createdAt:1,backingPitch:2,blob:new Blob(['voice'])});
  const {nodes}=await mount(storage,{video,globals:{EchoOriginalAudio:{clear(){},create:()=>new Promise(done=>{resolve=()=>done({media:video,range:{start:0,end:60},dispose(){disposed++;}});})},EchoVocalEffects:{...require('../extension/vocal-effects.js'),async createPlayer(){voices++;throw Error('must not start');}}}});
  nodes.get('tab-recordings').onclick();nodes.get('reviewReplayMode').value='simultaneous';nodes.get('reviewReplayMode').onchange();const comparing=nodes.get('reviewReplay').onclick();await waitUntil(()=>!!resolve);
  nodes.get('stop').onclick();resolve();await comparing;assert.equal(disposed,1);assert.equal(voices,0);assert.equal(video.plays.length,0);
  (await storage.ready).close();
});


for(const activity of ['speech','sing'])test(`practice ${activity} replay menu shares the recording-page choice and runs sequential comparison`,async()=>{
  const storage=createStorage(new IDBFactory()),video=leadInVideo({hold:true});let sound;
  await storage.saveSession({videoId:'video',activity,start:5,end:10,selectedTakeId:'voice'});
  await storage.saveTake({id:'voice',videoId:'video',cueKey:activity==='sing'?'song:line':'line',kind:activity==='sing'?'song':undefined,capture:'vocal',start:5,end:10,speed:1,createdAt:1,blob:new Blob(['voice'])});
  class Audio{constructor(){sound=this;this.currentTime=0;this.duration=5;this.paused=true;}async play(){this.paused=false;}pause(){this.paused=true;}}
  const {nodes}=await mount(storage,{video,globals:{Audio}});
  assert.equal(nodes.get('replay').disabled,false);assert.equal(nodes.get('practiceReplayMode').value,'recording');
  nodes.get('practiceReplayMode').value='sequential';nodes.get('practiceReplayMode').onchange();
  assert.equal(nodes.get('reviewReplayMode').value,'sequential');assert.match(nodes.get('replay').textContent,/回听录音/);
  assert.match(nodes.get('replay').title,/原声 → 录音/);assert.equal(nodes.get('replay').title,nodes.get('reviewReplay').title);
  const comparing=nodes.get('replay').onclick();await waitUntil(()=>video.plays.length===1);assert.equal(sound,undefined);
  video.advance(10);await waitUntil(()=>sound?.paused===false);sound.onended();await comparing;
  assert.equal(nodes.get('page-practice').hidden,false);assert.equal(nodes.get('panel').dataset.mode,'idle');
  nodes.get('tab-recordings').onclick();nodes.get('reviewReplayMode').value='recording';nodes.get('reviewReplayMode').onchange();
  assert.equal(nodes.get('practiceReplayMode').value,'recording');assert.match(nodes.get('reviewReplay').textContent,/回听录音/);
  (await storage.ready).close();
});


test('preparation without captions leads to subtitle import and editing rather than language settings',async()=>{
  const storage=createStorage(new IDBFactory());const {nodes}=await mount(storage);
  nodes.get('openPreparation').onclick();nodes.get('wizardApply').onclick();nodes.get('wizardContinue').onclick();
  assert.equal(nodes.get('toolsDialog').open,false);assert.equal(nodes.get('page-transcript').hidden,false);
  assert.equal(nodes.get('page-practice').hidden,true);assert.notEqual(nodes.get('settingsDialog').open,true);
  await new Promise(r=>setTimeout(r,5));(await storage.ready).close();
});

test('backing generation has an explicit return to practice without starting a recording',async()=>{
  const storage=createStorage(new IDBFactory());let captures=0;
  const {nodes}=await mount(storage,{globals:{navigator:{mediaDevices:{async getUserMedia(){captures++;throw Error('unexpected capture');}}}}});
  nodes.get('backingSettings').onclick();assert.equal(nodes.get('backingReturnPractice').hidden,false);
  nodes.get('backingReturnPractice').onclick();assert.equal(nodes.get('settingsDialog').open,false);
  assert.equal(nodes.get('page-practice').hidden,false);assert.equal(captures,0);assert.equal(nodes.get('panel').dataset.mode,'idle');
  nodes.get('practiceSettings').onclick();assert.equal(nodes.get('backingReturnPractice').hidden,true);
  await new Promise(r=>setTimeout(r,5));(await storage.ready).close();
});

test('next paragraph preserves its size, ends with a single clip and retains previous recordings',async()=>{
  const storage=createStorage(new IDBFactory());let captures=0;
  const cues=Array.from({length:5},(_,i)=>({start:i*5,end:(i+1)*5,text:`Line ${i+1}`}));
  await storage.saveSession({videoId:'video',activity:'sing',scopes:{sing:'paragraph'},paragraphFirst:0,paragraphLast:1,cues,index:0,start:0,end:10,speed:'1'});
  await storage.saveTake({id:'keep',videoId:'video',cueKey:'old',start:0,end:10,speed:1,createdAt:1,capture:'vocal',blob:new Blob(['voice'])});
  const {nodes}=await mount(storage,{globals:{navigator:{mediaDevices:{async getUserMedia(){captures++;throw Error('unexpected capture');}}}}});
  nodes.get('nextParagraph').onclick();
  assert.equal(nodes.get('paragraphFirst').value,'2');assert.equal(nodes.get('paragraphLast').value,'3');
  assert.equal(Number(nodes.get('start').value),10);assert.equal(Number(nodes.get('end').value),20);
  assert.equal(nodes.get('practiceScope').value,'paragraph');assert.equal(nodes.get('panel').dataset.mode,'idle');
  nodes.get('nextParagraph').onclick();
  assert.equal(nodes.get('practiceScope').value,'clip');assert.equal(nodes.get('clipCue').value,'4');
  assert.equal(Number(nodes.get('start').value),20);assert.equal(Number(nodes.get('end').value),25);
  assert.equal(captures,0);assert.equal((await storage.listTakes('video')).length,1);
  await new Promise(r=>setTimeout(r,5));
  const session=await storage.getSession('video');assert.equal(session.scopes.sing,'clip');assert.equal(session.index,4);
  (await storage.ready).close();
});

test('next paragraph is unavailable at the last paragraph',async()=>{
  const storage=createStorage(new IDBFactory());
  await storage.saveSession({videoId:'video',activity:'speech',scopes:{speech:'paragraph'},paragraphFirst:0,paragraphLast:1,cues:[{start:0,end:5,text:'A'},{start:5,end:10,text:'B'}],index:0,start:0,end:10,speed:'1'});
  const {nodes}=await mount(storage);assert.equal(nodes.get('nextParagraph').disabled,true);
  nodes.get('nextParagraph').onclick();assert.equal(Number(nodes.get('start').value),0);assert.equal(Number(nodes.get('end').value),10);
  await new Promise(r=>setTimeout(r,5));(await storage.ready).close();
});

test('early-stop comparison and filenames use the captured range without shortening practice',async()=>{
  const storage=createStorage(new IDBFactory()),video=leadInVideo({hold:true});
  await storage.saveSession({videoId:'video',activity:'speech',scopes:{speech:'whole'},start:0,end:60,speed:'1'});
  await storage.saveTake({id:'partial',videoId:'video',cueKey:'whole',capture:'vocal',start:5,end:60,capturedEnd:8,speed:1,createdAt:1,blob:new Blob(['voice'])});
  const {nodes}=await mount(storage,{video});nodes.get('tab-recordings').onclick();
  assert.match(nodes.get('historyInfo').textContent,/5.0–8.0.*提前结束/);
  nodes.get('download').onclick();assert.match(nodes.get('download').download,/00m05.0s-00m08.0s/);
  nodes.get('reviewReplayMode').value='sequential';nodes.get('reviewReplayMode').onchange();
  const comparing=nodes.get('reviewReplay').onclick();await waitUntil(()=>video.plays.length>0);
  assert.match(nodes.get('transportTime').textContent,/0:03/);
  nodes.get('stop').onclick();await comparing;
  assert.equal(Number(nodes.get('start').value),0);assert.equal(Number(nodes.get('end').value),60);
  assert.equal((await storage.listTakes('video'))[0].end,60);
  (await storage.ready).close();
});

test('missing assembly accompaniment links to its export range and preserves recording choices',async()=>{
  const storage=createStorage(new IDBFactory());
  await storage.saveSession({videoId:'video',activity:'sing',scopes:{sing:'clip'},start:0,end:5,speed:'1'});
  await storage.saveTake({id:'voice',videoId:'video',kind:'song',capture:'vocal',cueKey:'one',start:0,end:10,speed:1,createdAt:1,blob:new Blob(['voice'])});
  const {nodes}=await mount(storage,{video:{duration:30,pause(){}}});
  await nodes.get('assembleSong').onclick();
  assert.equal(nodes.get('assemblyMissingMusic').hidden,true);
  nodes.get('assemblyType').value='mixed';nodes.get('assemblyType').onchange();
  assert.equal(nodes.get('assemblyMissingMusic').hidden,false);assert.equal(nodes.get('assemblyPreview').disabled,true);
  nodes.get('assemblyType').value='vocal';nodes.get('assemblyType').onchange();assert.equal(nodes.get('assemblyPreview').disabled,false);
  nodes.get('assemblyType').value='mixed';nodes.get('assemblyType').onchange();
  nodes.get('assemblyScope').value='custom';nodes.get('assemblyScope').onchange();
  nodes.get('assemblyStart').value='5';nodes.get('assemblyEnd').value='15';nodes.get('assemblyEnd').onchange();
  nodes.get('assemblyPrepareMusic').onclick();
  assert.equal(nodes.get('assemblyDialog').open,false);assert.equal(nodes.get('settingsDialog').open,true);
  assert.equal(nodes.get('settings-backing').hidden,false);assert.equal(nodes.get('generationScope').value,'custom');
  assert.equal(Number(nodes.get('generationStart').value),5);assert.equal(Number(nodes.get('generationEnd').value),15);
  assert.equal(Number(nodes.get('start').value),0);assert.equal(Number(nodes.get('end').value),5);
  assert.equal((await storage.listTakes('video')).length,1);
  await new Promise(r=>setTimeout(r,5));(await storage.ready).close();
});

test('dubbing assembly is available and keeps its choices separate from singing, including after reload',async()=>{
  const storage=createStorage(new IDBFactory());
  await storage.saveSession({videoId:'video',activity:'speech',start:0,end:5,speed:'1',selectedTakeId:'speech-old',assemblyChoices:[{start:0,end:10,choice:'song',enabled:false}]});
  for(const [id,kind,createdAt] of [['speech-old',undefined,1],['speech-new',undefined,2],['song','song',3]])
    await storage.saveTake({id,kind,videoId:'video',cueKey:id==='song'?'song-line':'speech-line',label:id,capture:'vocal',start:0,end:10,speed:1,createdAt,blob:new Blob([id])});
  let {nodes}=await mount(storage,{video:{duration:20,pause(){}}});
  nodes.get('tab-recordings').onclick();assert.equal(nodes.get('songAssembly').hidden,false);
  assert.equal(nodes.get('assembleSong').textContent,'合成配音');await nodes.get('assembleSong').onclick();
  assert.equal(nodes.get('assemblyMixedOption').textContent,'人声＋背景音');
  const options=nodes.get('assemblyEditorList').children[0].children[1].children;
  assert.equal(options.length,2);options[1].children[0].onclick();nodes.get('closeAssembly').onclick();
  await new Promise(r=>setTimeout(r,5));
  let session=await storage.getSession('video');assert.equal(session.assemblyChoicesByActivity.speech[0].choice,'speech-old');
  assert.equal(session.assemblyChoicesByActivity.sing[0].choice,'song');assert.equal(session.assemblyChoicesByActivity.sing[0].enabled,false);
  ({nodes}=await mount(storage,{video:{duration:20,pause(){}}}));nodes.get('tab-recordings').onclick();await nodes.get('assembleSong').onclick();
  assert.equal(nodes.get('assemblyEditorList').children[0].children[1].children[1].children[0].getAttribute('aria-pressed'),'true');
  nodes.get('closeAssembly').onclick();
  nodes.get('recordingSearch').value='song';nodes.get('recordingSearch').oninput();await nodes.get('historyList').children[0].children[0].onclick();
  assert.equal(nodes.get('assembleSong').textContent,'合成整首');await nodes.get('assembleSong').onclick();
  assert.equal(nodes.get('assemblyEditorList').children[0].children[0].children[0].children[0].checked,false);
  nodes.get('closeAssembly').onclick();
  await new Promise(r=>setTimeout(r,5));session=await storage.getSession('video');assert.equal(session.assemblyChoicesByActivity.speech[0].choice,'speech-old');
  (await storage.ready).close();
});

test('dubbing mixed export uses its background model and filename even when practice is in singing mode',async()=>{
  const storage=createStorage(new IDBFactory()),requests=[];
  await storage.saveSession({videoId:'video',activity:'sing',selectedTakeId:'dub',modelPreferences:{speech:'bandit-v2-multi',sing:'demucs-htdemucs'},start:0,end:5,speed:'1'});
  for(const [id,kind] of [['dub',undefined],['song','song']])await storage.saveTake({id,kind,videoId:'video',cueKey:id,capture:'vocal',start:0,end:10,speed:1,createdAt:id==='dub'?2:1,blob:new Blob(['voice'])});
  await storage.saveBacking({key:'speech-background',videoId:'video',model:'bandit-v2-multi',start:0,end:20,createdAt:1,blob:new Blob(['background'])});
  const {nodes,downloads}=await mount(storage,{video:{duration:20,pause(){}},globals:{setTimeout:(fn,ms)=>setTimeout(fn,ms===30000?0:ms),EchoAudioExport:{...require('../extension/audio-export.js'),async render(options){requests.push(options);return {blob:new Blob(['mixed']),gaps:[]};}}}});
  nodes.get('tab-recordings').onclick();await nodes.get('assembleSong').onclick();
  nodes.get('assemblyType').value='mixed';nodes.get('assemblyType').onchange();
  assert.equal(nodes.get('assemblyMissingMusic').hidden,true);await nodes.get('assemblyDownload').onclick();
  assert.deepEqual(requests[0].takes.map(t=>t.id),['dub']);assert.equal(requests[0].backing.key,'speech-background');
  assert.match(downloads.at(-1).download,/整段合成_人声\+背景音/);assert.equal(nodes.get('activityMode').value,'sing');
  nodes.get('closeAssembly').onclick();await new Promise(r=>setTimeout(r,5));(await storage.ready).close();
});

test('dubbing assembly recovery prepares its background model without changing the selected time range',async()=>{
  const storage=createStorage(new IDBFactory());
  await storage.saveSession({videoId:'video',activity:'sing',selectedTakeId:'dub',modelPreferences:{speech:'bandit-v2-multi'},start:1,end:5,speed:'1'});
  await storage.saveTake({id:'dub',videoId:'video',cueKey:'speech',capture:'vocal',start:0,end:10,speed:1,createdAt:1,blob:new Blob(['voice'])});
  const {nodes}=await mount(storage,{video:{duration:20,pause(){}}});nodes.get('tab-recordings').onclick();await nodes.get('assembleSong').onclick();
  nodes.get('assemblyType').value='mixed';nodes.get('assemblyType').onchange();nodes.get('assemblyPrepareMusic').onclick();
  assert.equal(nodes.get('activityMode').value,'speech');assert.equal(nodes.get('backingModel').value,'bandit-v2-multi');
  assert.equal(Number(nodes.get('generationStart').value),0);assert.equal(Number(nodes.get('generationEnd').value),20);
  assert.equal(Number(nodes.get('start').value),1);assert.equal(Number(nodes.get('end').value),5);
  await new Promise(r=>setTimeout(r,5));(await storage.ready).close();
});

test('recording volume panel closes with Done or Escape while retaining mix levels',async()=>{
  const storage=createStorage(new IDBFactory());
  await storage.saveTake({id:'voice',videoId:'video',cueKey:'one',capture:'vocal',start:0,end:5,speed:1,createdAt:1,blob:new Blob(['voice'])});
  const {nodes,root,document}=await mount(storage);nodes.get('tab-recordings').onclick();
  const host=document.documentElement.children[0],display=host.style.display;
  nodes.get('replayVocalVolume').value='1.3';nodes.get('replayVocalVolume').oninput();
  nodes.get('mixControls').open=true;nodes.get('closeReplayMix').onclick();assert.equal(nodes.get('mixControls').open,false);
  nodes.get('mixControls').open=true;root.onkeydown({key:'Escape',preventDefault(){},stopPropagation(){}});
  assert.equal(nodes.get('mixControls').open,false);assert.equal(Number(nodes.get('replayVocalVolume').value),1.3);
  assert.equal(host.style.display,display);assert.equal(nodes.get('panel').dataset.mode,'idle');
  await new Promise(r=>setTimeout(r,5));(await storage.ready).close();
});

test('single-segment recordings hide redundant search and continuous playback, while an active search remains clearable',async()=>{
  const storage=createStorage(new IDBFactory());
  await storage.saveTake({id:'one',videoId:'video',cueKey:'one',start:0,end:5,speed:1,createdAt:1,blob:new Blob(['voice'])});
  let {nodes}=await mount(storage);nodes.get('tab-recordings').onclick();assert.equal(nodes.get('recordingSearchTools').hidden,true);
  nodes.get('recordingSearch').value='missing';nodes.get('recordingSearch').oninput();assert.equal(nodes.get('recordingSearchTools').hidden,false);
  nodes.get('recordingSearch').value='';nodes.get('recordingSearch').oninput();assert.equal(nodes.get('recordingSearchTools').hidden,true);
  await storage.saveTake({id:'two',videoId:'video',cueKey:'two',start:5,end:10,speed:1,createdAt:2,blob:new Blob(['voice'])});
  ({nodes}=await mount(storage));nodes.get('tab-recordings').onclick();assert.equal(nodes.get('recordingSearchTools').hidden,false);
  (await storage.ready).close();
});

test('assembly returns to the same export range, content and list position independently for speech and singing',async()=>{
  const storage=createStorage(new IDBFactory());
  await storage.saveSession({videoId:'video',activity:'speech',selectedTakeId:'dub',start:0,end:5,speed:'1'});
  for(const [id,kind] of [['dub',undefined],['song','song']])await storage.saveTake({id,kind,videoId:'video',cueKey:id,label:id,capture:'vocal',start:0,end:20,speed:1,createdAt:id==='dub'?2:1,blob:new Blob(['voice'])});
  const video={duration:30,pause(){}},{nodes}=await mount(storage,{video});
  nodes.get('tab-recordings').onclick();await nodes.get('assembleSong').onclick();
  nodes.get('assemblyScope').value='custom';nodes.get('assemblyStart').value='5';nodes.get('assemblyEnd').value='15';nodes.get('assemblyEnd').onchange();
  nodes.get('assemblyType').value='mixed';nodes.get('assemblyType').onchange();nodes.get('assemblyEditorList').scrollTop=123;
  nodes.get('closeAssembly').onclick();await nodes.get('assembleSong').onclick();
  assert.equal(nodes.get('assemblyScope').value,'custom');assert.equal(Number(nodes.get('assemblyStart').value),5);assert.equal(Number(nodes.get('assemblyEnd').value),15);
  assert.equal(nodes.get('assemblyType').value,'mixed');assert.equal(nodes.get('assemblyEditorList').scrollTop,123);
  nodes.get('closeAssembly').onclick();nodes.get('recordingSearch').value='song';nodes.get('recordingSearch').oninput();await nodes.get('historyList').children[0].children[0].onclick();
  await nodes.get('assembleSong').onclick();assert.equal(nodes.get('assemblyScope').value,'whole');
  nodes.get('assemblyType').value='vocal';nodes.get('assemblyType').onchange();nodes.get('closeAssembly').onclick();
  nodes.get('recordingSearch').value='dub';nodes.get('recordingSearch').oninput();await nodes.get('historyList').children[0].children[0].onclick();
  await nodes.get('assembleSong').onclick();assert.equal(nodes.get('assemblyScope').value,'custom');assert.equal(nodes.get('assemblyType').value,'mixed');
  nodes.get('assemblyEnd').value='';nodes.get('assemblyEnd').onchange();nodes.get('closeAssembly').onclick();await nodes.get('assembleSong').onclick();
  assert.equal(nodes.get('assemblyEnd').value,'','unfinished range edits are retained for correction');assert.equal(nodes.get('assemblyPreview').disabled,true);
  nodes.get('assemblyEnd').value='15';nodes.get('assemblyEnd').onchange();nodes.get('closeAssembly').onclick();video.duration=10;await nodes.get('assembleSong').onclick();
  assert.equal(nodes.get('assemblyScope').value,'whole','a changed video duration cannot restore stale range bounds');
  nodes.get('closeAssembly').onclick();(await storage.ready).close();
});

test('assembly can use the auditioned candidate beside its player without interrupting audio, and exports that selection',async()=>{
  const storage=createStorage(new IDBFactory()),requests=[];
  for(const [id,createdAt] of [['older',1],['newer',2]])await storage.saveTake({id,videoId:'video',kind:'song',capture:'vocal',cueKey:'same',label:id,start:0,end:10,speed:1,createdAt,blob:new Blob([id])});
  const {nodes}=await mount(storage,{video:{duration:10,pause(){}},globals:{setTimeout:(fn,ms)=>setTimeout(fn,ms===30000?0:ms),EchoAudioExport:{...require('../extension/audio-export.js'),async render(options){requests.push(options);return {blob:new Blob(['preview']),gaps:[]};}}}});
  await nodes.get('assembleSong').onclick();assert.equal(nodes.get('assemblyUseAudition').hidden,true);
  const older=nodes.get('assemblyEditorList').children[0].children[1].children[1];await older.children[1].onclick();
  assert.equal(nodes.get('assemblyUseAudition').hidden,false);assert.equal(nodes.get('assemblyUseAudition').disabled,false);
  const audio=nodes.get('assemblyAudio'),src=audio.src;let pauses=0;audio.pause=()=>{pauses++;};
  nodes.get('assemblyUseAudition').onclick();assert.equal(audio.src,src);assert.equal(audio.hidden,false);assert.equal(pauses,0);
  assert.equal(older.children[0].getAttribute('aria-pressed'),'true');assert.equal(nodes.get('assemblyUseAudition').disabled,true);
  assert.match(nodes.get('assemblyEditorMessage').textContent,/已选用/);
  await nodes.get('assemblyDownload').onclick();assert.equal(requests.at(-1).selection[0].takeId,'older');assert.equal(nodes.get('assemblyUseAudition').hidden,true);
  nodes.get('closeAssembly').onclick();await nodes.get('assembleSong').onclick();assert.equal(nodes.get('assemblyUseAudition').hidden,true);
  nodes.get('closeAssembly').onclick();(await storage.ready).close();
});

test('assembly export workspace does not carry custom bounds to a different YouTube video',async()=>{
  const storage=createStorage(new IDBFactory()),location={href:'https://www.youtube.com/watch?v=video',pathname:'/watch'};
  for(const videoId of ['video','other'])await storage.saveTake({id:videoId,videoId,kind:'song',capture:'vocal',cueKey:'one',start:0,end:20,speed:1,createdAt:1,blob:new Blob(['voice'])});
  const {nodes,events}=await mount(storage,{video:{duration:30,pause(){}},globals:{location}});
  await nodes.get('assembleSong').onclick();nodes.get('assemblyScope').value='custom';nodes.get('assemblyStart').value='5';nodes.get('assemblyEnd').value='15';nodes.get('assemblyEnd').onchange();
  nodes.get('closeAssembly').onclick();location.href='https://www.youtube.com/watch?v=other';events.get('yt-navigate-finish')();await waitUntil(()=>!nodes.get('read').disabled);
  await nodes.get('assembleSong').onclick();assert.equal(nodes.get('assemblyScope').value,'whole');assert.equal(Number(nodes.get('assemblyStart').value),0);assert.equal(Number(nodes.get('assemblyEnd').value),30);
  nodes.get('closeAssembly').onclick();(await storage.ready).close();
});

for(const activity of ['speech','sing'])test(`returning a ${activity} sentence to practice preserves its identity, adjusted range and rerecording versions`,async()=>{
  const storage=createStorage(new IDBFactory()),video=leadInVideo(),cues=[{start:5,end:10,text:'First line'},{start:10,end:15,text:'Next line'}];
  video.paused=true;video.play=async function(){this.currentTime=9.8;};
  const key=(activity==='sing'?'song:':'')+cueKey(cues[0]);
  await storage.saveSession({videoId:'video',activity,selectedTakeId:'original',scopes:{speech:'clip',sing:'clip'},recordingPlaybackPreferences:{speech:'silent',sing:'silent'},cues,index:1,start:10,end:15,speed:'1',leadInMode:'none'});
  await storage.saveTake({id:'original',videoId:'video',kind:activity==='sing'?'song':undefined,capture:'vocal',cueKey:key,label:'第 1 句',start:5.2,end:9.8,capturedEnd:8,speed:1,createdAt:1,blob:new Blob(['voice'])});
  class MediaRecorder{static isTypeSupported(){return true;}constructor(stream,options){this.state='inactive';this.mimeType=options.mimeType;}start(){this.state='recording';}stop(){this.state='inactive';this.ondataavailable({data:new Blob(['retake'])});queueMicrotask(()=>this.onstop());}}
  const overrides={video,globals:{MediaRecorder,navigator:{mediaDevices:{async getUserMedia(){return {getTracks:()=>[{stop(){}}]};}}},requestAnimationFrame:fn=>setTimeout(fn,1),cancelAnimationFrame:clearTimeout}};
  let {nodes}=await mount(storage,overrides);nodes.get('tab-recordings').onclick();nodes.get('reuseSongRange').onclick();
  assert.equal(nodes.get('clipCue').value,'0');assert.equal(nodes.get('position').textContent,'1 / 2');assert.equal(nodes.get('next').disabled,false);
  assert.equal(Number(nodes.get('start').value),5.2);assert.equal(Number(nodes.get('end').value),9.8);assert.equal(video.currentTime,5.2);
  await new Promise(r=>setTimeout(r,5));assert.equal((await storage.getSession('video')).clipRangeAdjusted,true);
  ({nodes}=await mount(storage,overrides));assert.equal(nodes.get('clipCue').value,'0');assert.equal(Number(nodes.get('start').value),5.2);assert.equal(Number(nodes.get('end').value),9.8);
  await nodes.get('record').onclick();const takes=await storage.listTakes('video');assert.equal(takes.length,2);assert(takes.every(t=>t.cueKey===key));assert.equal(nodes.get('versionChoices').children.length,2);
  nodes.get('next').onclick();assert.equal(nodes.get('clipCue').value,'1');assert.equal(Number(nodes.get('start').value),10);
  (await storage.ready).close();
});

for(const comparison of ['recording','sequential','simultaneous'])test(`practice this range stops ${comparison} playback and moves to its start without deleting any version`,async()=>{
  const storage=createStorage(new IDBFactory()),video=leadInVideo({hold:true});let sound;
  await storage.saveTake({id:'voice',videoId:'video',cueKey:'manual:5.00:10.00',start:5,end:10,speed:1,createdAt:1,blob:new Blob(['voice'])});
  class Audio{constructor(){sound=this;this.currentTime=0;this.duration=5;this.paused=true;}async play(){this.paused=false;}pause(){this.paused=true;}}
  const {nodes}=await mount(storage,{video,globals:{Audio,EchoKaraoke:{...require('../extension/karaoke.js'),async createAudioOutput(){return {setVolume(){},dispose(){}};}}}});nodes.get('tab-recordings').onclick();
  nodes.get('reviewReplayMode').value=comparison;nodes.get('reviewReplayMode').onchange();
  const replay=nodes.get('reviewReplay').onclick();await waitUntil(()=>comparison==='sequential'?video.plays.length>0:sound?.paused===false);
  assert.equal(nodes.get('reuseSongRange').disabled,false);nodes.get('reuseSongRange').onclick();await replay;
  if(sound)assert.equal(sound.paused,true);assert.equal(nodes.get('page-practice').hidden,false);assert.equal(video.currentTime,5);assert.equal(nodes.get('record').disabled,false);
  assert.equal((await storage.listTakes('video')).length,1);(await storage.ready).close();
});

test('returning a recording whose subtitle was replaced retains a custom range instead of attaching to a different sentence',async()=>{
  const storage=createStorage(new IDBFactory());
  await storage.saveSession({videoId:'video',activity:'speech',cues:[{start:5,end:10,text:'Replacement words'}],index:0,start:5,end:10,speed:'1'});
  await storage.saveTake({id:'old',videoId:'video',cueKey:cueKey({start:5,end:10,text:'Original words'}),start:5.2,end:9.8,speed:1,createdAt:1,blob:new Blob(['old'])});
  const {nodes}=await mount(storage);nodes.get('tab-recordings').onclick();nodes.get('reuseSongRange').onclick();
  assert.equal(nodes.get('clipCue').value,'');assert.equal(nodes.get('position').textContent,'手动片段');assert.equal(Number(nodes.get('start').value),5.2);assert.equal(Number(nodes.get('end').value),9.8);
  assert.equal((await storage.listTakes('video'))[0].cueKey,cueKey({start:5,end:10,text:'Original words'}));(await storage.ready).close();
});


test('deleting a version stays in the recording segment even when practice is on another sentence',async()=>{
  const storage=createStorage(new IDBFactory()),cues=[{key:'first',start:0,end:5,text:'First'},{key:'second',start:10,end:15,text:'Second'}];
  await storage.saveSession({videoId:'video',index:0,start:0,end:5,cues,speed:'1'});
  const base={videoId:'video',speed:1,capture:'vocal',blob:new Blob(['voice'])};
  await storage.saveTake({...base,id:'first-take',cueKey:'first',label:'First',start:0,end:5,createdAt:1});
  for(const [id,createdAt] of [['second-old',2],['second-new',3]])await storage.saveTake({...base,id,cueKey:'second',label:'Second',start:10,end:15,createdAt});
  const {nodes}=await mount(storage);nodes.get('tab-recordings').onclick();
  await nodes.get('historyList').children[1].children[0].onclick();
  assert.match(nodes.get('deleteTake').title,/Second/);
  await nodes.get('deleteTake').onclick();
  assert.match(nodes.get('historyInfo').textContent,/Second/);
  assert.equal(nodes.get('historyList').children[1].children[0].attrs['aria-pressed'],'true');
  assert.equal((await storage.getSession('video')).selectedTakeId,'second-old');
  assert.equal(nodes.get('start').value,0,'practice selection is not changed by deleting a recording version');
  assert.equal(nodes.get('versionChoices').children.length,1);
  await nodes.get('undoDelete').onclick();assert.equal((await storage.getSession('video')).selectedTakeId,'second-new');
  await nodes.get('deleteTake').onclick();await nodes.get('deleteTake').onclick();
  assert.match(nodes.get('historyInfo').textContent,/First/);
  assert.equal((await storage.listTakes('video')).length,1);
  await nodes.get('undoDelete').onclick();assert.match(nodes.get('historyInfo').textContent,/Second/);
  (await storage.ready).close();
});


test('deleting a version selects its next displayed neighbor, with the previous version as the last-version fallback',async()=>{
  const storage=createStorage(new IDBFactory());
  const base={videoId:'video',cueKey:'same',label:'Segment',start:0,end:5,speed:1,blob:new Blob(['voice'])};
  // Equal timestamps also follow the same ID tie-breaker as the version buttons.
  for(const id of ['a','b','c','d'])await storage.saveTake({...base,id,createdAt:1},{maxTakes:0});
  const {nodes}=await mount(storage);nodes.get('tab-recordings').onclick();
  await nodes.get('versionChoices').children[1].onclick();await nodes.get('deleteTake').onclick();
  assert.equal((await storage.getSession('video')).selectedTakeId,'c');
  assert.equal(nodes.get('versionChoices').children[1].attrs['aria-pressed'],'true');
  await nodes.get('deleteTake').onclick();assert.equal((await storage.getSession('video')).selectedTakeId,'d');
  await nodes.get('deleteTake').onclick();assert.equal((await storage.getSession('video')).selectedTakeId,'a');
  await nodes.get('undoDelete').onclick();assert.equal((await storage.getSession('video')).selectedTakeId,'d');
  await nodes.get('versionChoices').children[0].onclick();await nodes.get('deleteTake').onclick();
  assert.equal((await storage.getSession('video')).selectedTakeId,'d');
  (await storage.ready).close();
});

for(const paused of [false,true])for(const short of ['none','metadata','file'])test(`switching versions ${paused?'while paused':'during playback'} ${short==='none'?'keeps song position':`restarts a shorter take (${short})`} without changing pause state or segment`,async()=>{
  const storage=createStorage(new IDBFactory()),video=leadInVideo({hold:true}),sounds=[];
  for(const [id,start,offset,createdAt] of [['older',4.5,.1,1],['newer',5,.3,2]])await storage.saveTake({id,videoId:'video',cueKey:'same',label:id,start,end:15,speed:1,vocalOffset:offset,...(short==='metadata' && id==='older'?{capturedEnd:6.5}:{}),capture:'vocal',createdAt,blob:new Blob([id])});
  class Audio{constructor(){this.currentTime=0;this.duration=short==='file' && sounds.length?2:12;this.paused=true;this.plays=0;sounds.push(this);}async play(){this.paused=false;this.plays++;}pause(){this.paused=true;}}
  const {nodes}=await mount(storage,{video,globals:{Audio}});nodes.get('tab-recordings').onclick();
  const first=nodes.get('reviewReplay').onclick();await waitUntil(()=>sounds[0]?.plays>0 && !nodes.get('pausePlayback').hidden);sounds[0].currentTime=3.3;
  if(paused)await nodes.get('pausePlayback').onclick();
  const switching=nodes.get('versionChoices').children[0].onclick();await waitUntil(()=>sounds.length===2 && !nodes.get('pausePlayback').hidden);
  assert.equal(sounds[0].paused,true);assert(Math.abs(sounds[1].currentTime-(short==='none'?3.6:0))<.001);assert.equal(sounds[1].paused,paused);assert.equal(sounds[1].plays,paused?0:1);
  assert.equal(nodes.get('pausePlayback').textContent,paused?'▶ 继续':'Ⅱ 暂停');assert.equal(nodes.get('versionChoices').children[0].attrs['aria-pressed'],'true');
  await nodes.get('starTake').onclick();assert.equal(sounds[1].paused,paused);assert.equal(sounds.length,2);assert.equal((await storage.listTakes('video')).find(t=>t.id==='older').starred,true);
  if(paused){await nodes.get('pausePlayback').onclick();assert.equal(sounds[1].plays,1);}
  nodes.get('stop').onclick();await Promise.all([first,switching]);(await storage.ready).close();
});

for(const activity of ['speech','sing'])test(`returning to the same ${activity} paragraph retains Next paragraph instead of creating a manual clip`,async()=>{
  const storage=createStorage(new IDBFactory()),cues=[0,5,10,15].map((start,i)=>({start,end:start+5,text:'Line '+i}));
  await storage.saveSession({videoId:'video',activity,scopes:{[activity]:'paragraph'},cues,index:0,start:0,end:10,speed:'1',paragraphFirst:0,paragraphLast:1});
  await storage.saveTake({id:'paragraph',videoId:'video',kind:activity==='sing'?'song':undefined,cueKey:(activity==='sing'?'song:':'')+cueKey(null,0,10),start:0,end:10,speed:1,capturedEnd:8,createdAt:1,blob:new Blob(['voice'])});
  const {nodes}=await mount(storage);nodes.get('tab-recordings').onclick();nodes.get('reuseSongRange').onclick();
  assert.equal(nodes.get('practiceScope').value,'paragraph');assert.equal(nodes.get('paragraphSelection').hidden,false);assert.equal(nodes.get('nextParagraph').disabled,false);
  nodes.get('nextParagraph').onclick();assert.equal(Number(nodes.get('paragraphFirst').value),2);assert.equal(Number(nodes.get('paragraphLast').value),3);assert.equal(Number(nodes.get('start').value),10);assert.equal(Number(nodes.get('end').value),20);
  (await storage.ready).close();
});


test('dictionary opens as a modal, blocks practice shortcuts and ignores results after closing',async()=>{
  const storage=createStorage(new IDBFactory());let resolveLookup,focuses=0;
  await storage.saveSession({videoId:'video',contentLanguage:'en',cues:[{start:0,end:5,text:'Hello world'}],index:0,start:0,end:5});
  const {nodes,root,events}=await mount(storage,{video:leadInVideo({hold:true}),globals:{chrome:{runtime:{onMessage:{addListener(){}},sendMessage(message){if(message.type==='echo-dictionary')return new Promise(resolve=>{resolveLookup=resolve;});return Promise.resolve({});}}}}});
  const word=root.querySelectorAll('.word').find(node=>node.textContent==='Hello');assert.ok(word);
  word.focus=()=>{focuses++;};word.onclick();await waitUntil(()=>!!resolveLookup);
  assert.equal(nodes.get('wordcard').open,true);assert.equal(nodes.get('wordTitle').textContent,'Hello');
  assert.equal(nodes.get('definitions').textContent,'正在查词…');
  let prevented=false;events.get('keydown')({key:'o',code:'KeyO',altKey:true,shiftKey:true,preventDefault(){prevented=true;},stopPropagation(){}});
  assert.equal(prevented,false);
  nodes.get('wordcard').oncancel({preventDefault(){}});
  assert.equal(nodes.get('wordcard').open,false);assert.equal(focuses,1);
  resolveLookup({entry:{phonetic:'/late/',meanings:[]}});await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(nodes.get('phonetic').textContent,'');
  word.onclick();await waitUntil(()=>nodes.get('wordcard').open);
  resolveLookup({entry:{phonetic:'/həˈləʊ/',meanings:[{partOfSpeech:'interjection',definition:'A greeting'}]}});
  await waitUntil(()=>nodes.get('phonetic').textContent==='/həˈləʊ/');
  assert.match(nodes.get('definitions').children[0].textContent,/A greeting/);
  nodes.get('closeWord').onclick();assert.equal(focuses,2);
  (await storage.ready).close();
});
