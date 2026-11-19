const {test}=require('node:test');
const assert=require('node:assert/strict');
const original=require('../extension/original-audio.js');
function fixture(){
  original.clear();const calls=[],elements=[],events=new Map();let closed=0;
  const video={duration:60,currentTime:10,volume:.7,muted:false,playbackRate:1,paused:true,
    addEventListener(name,fn){if(!events.has(name))events.set(name,new Set());events.get(name).add(fn);},
    removeEventListener(name,fn){events.get(name)?.delete(fn);},
    emit(name){for(const fn of events.get(name)||[])fn();},
    async play(){this.paused=false;this.emit('playing');},pause(){this.paused=true;this.emit('pause');}};
  class Audio{constructor(){this.currentTime=0;this.paused=true;this.readyState=4;elements.push(this);}async play(){this.paused=false;}pause(){this.paused=true;}removeAttribute(){}load(){}}
  async function request(action,data){calls.push({action,...data});if(action==='health')return {originalAudio:true};if(action==='start')return {id:'a'.repeat(32),state:'ready'};if(action==='audio-chunk')return {audio:'eA==',mime:'audio/flac',offset:0,totalBytes:1};return {};}
  const env={Audio,URL:{createObjectURL:()=> 'blob:original',revokeObjectURL(){closed++;}},setTimeout:fn=>queueMicrotask(fn)};
  return {video,calls,elements,events,request,env,closed:()=>closed};
}
test('original audio requests a separate lossless source and reuses its range cache',async()=>{
  const f=fixture(),options={videoId:'abcdefghijk',start:10,end:20,duration:60,request:f.request,active:()=>true};
  await original.source(options,f.env);await original.source({...options,start:30,end:40},f.env);
  assert.deepEqual(f.calls.find(c=>c.action==='start'),{action:'start',videoId:'abcdefghijk',start:0,end:60,source:'original',quality:'lossless'});
  assert.equal(f.calls.filter(c=>c.action==='start').length,1);
});
test('prepared original transport keeps video, volume, speed and buffering synchronized and restores mute',async()=>{
  const f=fixture(),output=await original.create({video:f.video,videoId:'abcdefghijk',range:{start:10,end:20},semitones:0,request:f.request,active:()=>true},f.env),m=output.media,a=f.elements[0];
  await m.play();assert.equal(f.video.muted,true);assert.equal(a.paused,false);assert.equal(a.currentTime,10);
  m.playbackRate=.5;m.volume=.3;m.muted=false;assert.equal(a.playbackRate,.5);assert.equal(a.volume,.3);assert.equal(f.video.muted,true);assert.equal(m.muted,false);
  m.pause();assert.equal(a.paused,true);assert.equal(f.video.paused,true);
  m.currentTime=15;await m.play();assert.equal(a.currentTime,15);
  f.video.emit('waiting');assert.equal(a.paused,true);f.video.emit('playing');await Promise.resolve();await Promise.resolve();assert.equal(a.paused,false);
  f.video.pause();assert.equal(a.paused,true);
  output.dispose();output.dispose();assert.equal(f.closed(),1);assert.equal(f.video.muted,false);
  assert.ok([...f.events.values()].every(set=>set.size===0));
});
test('cancelling a pending original extraction cancels its own task and caches no result',async()=>{
  const f=fixture();let active=true;
  const request=async(action,data)=>action==='start'?{id:'b'.repeat(32),state:'downloading'}:f.request(action,data);
  await assert.rejects(original.source({videoId:'abcdefghijk',start:0,end:10,duration:60,request,active:()=>active},{setTimeout:fn=>{active=false;queueMicrotask(fn);}}),/取消/);
  assert.ok(f.calls.some(c=>c.action==='cancel' && c.jobId==='b'.repeat(32)));
});
test('older services receive an actionable update message before starting a task',async()=>{
  const f=fixture();await assert.rejects(original.source({videoId:'abcdefghijk',start:0,end:10,duration:60,request:async()=>({}),active:()=>true},f.env),/重新运行根目录启动脚本/);
});

test('cancelling native audio preload releases its URL before any video starts',async()=>{
  const f=fixture();let active=true;
  class LoadingAudio{
    constructor(){this.readyState=0;}
    load(){if(this.oncanplay)queueMicrotask(()=>{active=false;this.oncanplay?.();});}
    removeAttribute(){}
  }
  await assert.rejects(original.create({video:f.video,videoId:'abcdefghijk',range:{start:10,end:20},semitones:0,request:f.request,active:()=>active},{...f.env,Audio:LoadingAudio,setTimeout,clearTimeout}),/取消/);
  assert.equal(f.closed(),1);assert.equal(f.video.paused,true);assert.equal(f.events.size,0);
});

test('negative original pitch reaches the playback blob and native unmute cannot mix the original key back in',async()=>{
  const f=fixture(),rate=44100,length=rate*3;let playedBlob;
  const samples=Float32Array.from({length},(_,i)=>.3*Math.sin(2*Math.PI*440*i/rate));
  class AudioContext{async decodeAudioData(){return {length,duration:3,sampleRate:rate,numberOfChannels:1,getChannelData:()=>samples};}async close(){}}
  const output=await original.create({video:f.video,videoId:'abcdefghijk',range:{start:0,end:3},semitones:-3,request:f.request,active:()=>true},{...f.env,AudioContext,URL:{createObjectURL(blob){playedBlob=blob;return 'blob:lowered-original';},revokeObjectURL(){}}});
  const view=new DataView(await playedBlob.arrayBuffer());let crossings=0;
  for(let i=rate;i<2*rate;i++)if(view.getInt16(44+(i-1)*4,true)<=0 && view.getInt16(44+i*4,true)>0)crossings++;
  assert.ok(Math.abs(crossings-440*2**(-3/12))<2,`expected lowered original around 370 Hz, got ${crossings}`);
  await output.media.play();f.video.muted=false;f.video.emit('volumechange');
  assert.equal(f.video.muted,true);assert.equal(f.elements[0].paused,false);output.dispose();
});
