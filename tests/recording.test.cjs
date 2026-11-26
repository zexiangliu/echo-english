const {test}=require('node:test');
const assert=require('node:assert/strict');
const {create}=require('../extension/recording.js');
const microphone=require('../extension/microphone.js');
function deferred(){let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve};}
function fixture(overrides={}){
  const count={mic:0,input:0,monitor:0,meter:0,permission:0,encoded:0},results=[],errors=[];let recorder;
  const mic={getTracks:()=>[{stop(){count.mic++;},getSettings:()=>({sampleRate:48000,channelCount:1})}]},processed={};
  const input={stream:processed,db:6,dispose(){count.input++;}},monitor={pause(){},setVolume(){},dispose(){count.monitor++;}},meter={dispose(){count.meter++;},setPaused(){}};
  class Recorder{
    static isTypeSupported(){return true;}
    constructor(stream,options){if(overrides.constructorError)throw Error('encoder failed');assert.equal(stream,processed);this.state='inactive';this.mimeType=overrides.mimeType || options.mimeType;this.audioBitsPerSecond=options.audioBitsPerSecond || 128000;recorder=this;}
    start(){this.state='recording';count.encoded++;}
    pause(){this.state='paused';}resume(){this.state='recording';}
    stop(){this.state='inactive';this.ondataavailable({data:new Blob(['dry-vocal'])});if(!overrides.delayedStop)queueMicrotask(()=>this.onstop());}
  }
  const options={constraints:{echoCancellation:false,autoGainControl:false},gainDb:6,quality:'high',active:()=>true,
    microphone:{...microphone,createInput:async()=>overrides.input?overrides.input.promise:input},
    env:{Blob,MediaRecorder:Recorder,navigator:{mediaDevices:{async getUserMedia(){count.permission++;return overrides.mic?overrides.mic.promise:mic;}}}},
    createMonitor:async()=>overrides.monitor?overrides.monitor.promise:monitor,createMeter:stream=>{assert.equal(stream,processed);return meter;},
    onComplete:result=>results.push(result),onError:error=>errors.push(error),...overrides.options};
  return {options,count,results,errors,mic,input,monitor,get recorder(){return recorder;}};
}
test('one capture owns dry input, buffering, metering and exactly one cleanup/save',async()=>{
  const f=fixture(),session=create(f.options);assert.equal(await session.prepare(),true);
  session.start();session.startMeter();session.startMeter();session.pause();assert.equal(session.state,'paused');session.resume();assert.equal(session.state,'recording');
  session.stop();session.stop();assert.equal(await session.completed,true);
  assert.deepEqual(f.count,{mic:1,input:1,monitor:1,meter:1,permission:1,encoded:1});
  assert.equal(f.results.length,1);assert.equal(await f.results[0].blob.text(),'dry-vocal');assert.equal(f.results[0].inputGainDb,6);
  assert.equal(f.results[0].recordingInfo.audioBitsPerSecond,256000);assert.equal(f.results[0].recordingInfo.microphone.sampleRate,48000);
  f.recorder.onerror();assert.equal(f.errors.length,0); // Late errors cannot stop the next operation.
});
for(const stage of ['mic','input','monitor'])test(`cancelling pending ${stage} acquisition releases its late result and never starts an encoder`,async()=>{
  const pending=deferred(),reached=deferred(),f=fixture({[stage]:pending});
  if(stage==='input')f.options.microphone.createInput=()=>{reached.resolve();return pending.promise;};
  if(stage==='monitor')f.options.createMonitor=()=>{reached.resolve();return pending.promise;};
  const session=create(f.options),preparing=session.prepare();
  if(stage!=='mic')await reached.promise;
  await session.stop();pending.resolve(f[stage]);assert.equal(await preparing,false);
  assert.equal(f.count.mic,1);assert.equal(f.count.encoded,0);assert.equal(f.results.length,1);assert.equal(f.results[0],null);
  if(stage!=='mic')assert.equal(f.count.input,1);if(stage==='monitor')assert.equal(f.count.monitor,1);
});
test('encoder setup failure closes the input and monitor rather than leaking microphone access',async()=>{
  const f=fixture({constructorError:true}),session=create(f.options);
  await assert.rejects(session.prepare(),/encoder failed/);assert.equal(await session.completed,false);
  assert.equal(f.count.mic,1);assert.equal(f.count.input,1);assert.equal(f.count.monitor,1);
});
test('lossless mode rejects silent codec substitution and saves no falsely labelled take',async()=>{
  const f=fixture({mimeType:'audio/webm;codecs=opus',options:{quality:'lossless'}}),session=create(f.options);
  await assert.rejects(session.prepare(),/未启用无损/);assert.equal(await session.completed,false);assert.equal(f.count.mic,1);assert.equal(f.results[0],null);
});
test('an old delayed stop only releases its own resources while the next capture continues',async()=>{
  const old=fixture({delayedStop:true}),next=fixture(),first=create(old.options),second=create(next.options);
  await first.prepare();first.start();first.startMeter();first.stop();await second.prepare();second.start();second.startMeter();
  old.recorder.onstop();await first.completed;
  assert.equal(second.state,'recording');assert.equal(next.count.mic,0);assert.equal(next.count.meter,0);
  second.stop();await second.completed;assert.equal(next.count.meter,1);
});

test('sidetone stays silent during preparation and mutes immediately on pause, stop and feedback teardown',async()=>{
  const f=fixture({delayedStop:true}),states=[];let setup;
  f.options.sidetone=true;f.options.sidetoneVolume=0.4;
  f.options.microphone.createInput=async(mic,db,env,options)=>{setup=options;return f.input;};
  f.input.setMonitoring=value=>states.push(value);
  const session=create(f.options);await session.prepare();assert.deepEqual(states,[]);
  assert.deepEqual(setup,{sidetone:true,sidetoneVolume:0.4,sidetoneMode:'minimum',sidetoneReverb:{}});
  let effect;f.input.setMonitorReverb=value=>{effect=value;};
  session.setSidetoneReverb({reverb:'ktv',amount:.5});assert.deepEqual(effect,{reverb:'ktv',amount:.5});
  session.start();session.pause();session.resume();session.pauseFeedback();session.stop();
  assert.deepEqual(states,[true,false,true,false,false]);
  assert.equal(f.count.input,0); // Encoder is still flushing; headphones are already muted.
  f.recorder.onstop();await session.completed;assert.equal(f.count.input,1);
});

test('disconnecting the selected microphone stops capture and preserves captured audio',async()=>{
  let ended,removed=0;const f=fixture();
  const track={addEventListener(type,fn){if(type==='ended')ended=fn;},removeEventListener(type,fn){assert.equal(fn,ended);removed++;},stop(){f.count.mic++;}};
  f.options.env.navigator.mediaDevices.getUserMedia=async()=>({getTracks:()=>[track]});
  const session=create(f.options);await session.prepare();session.start();ended();
  await session.completed;assert.equal(f.errors.length,1);assert.match(f.errors[0].message,/麦克风已断开/);assert.equal(f.results.length,1);assert.equal(removed,1);
});

test('requested monitoring mode and latest diagnostics belong to the saved recording',async()=>{
  const f=fixture(),info={mode:'minimum',inputLatency:0.01,baseLatency:0.003,outputLatency:0.02};let requested;
  f.options.sidetone=true;f.options.sidetoneMode='minimum';
  f.input.monitoringInfo=()=>({...info});
  f.options.microphone.createInput=async(mic,db,env,options)=>{requested=options;return f.input;};
  const session=create(f.options);await session.prepare();assert.equal(requested.sidetoneMode,'minimum');assert.deepEqual(session.sidetoneInfo,info);
  session.start();info.outputLatency=0.03;await session.stop();
  assert.equal(f.results[0].recordingInfo.monitoring.outputLatency,0.03);
});

test('discard releases capture resources without returning buffered or final encoder data',async()=>{
  const f=fixture(),session=create(f.options);await session.prepare();session.start();session.startMeter();
  f.recorder.ondataavailable({data:new Blob(['earlier-data'])});
  assert.equal(await session.discard(),false);assert.deepEqual(f.results,[null]);
  assert.equal(f.count.mic,1);assert.equal(f.count.monitor,1);assert.equal(f.count.input,1);
});


test('capture elapsed time excludes repeated pauses, setup and encoder flushing',async()=>{
  let now=0;
  const f=fixture({delayedStop:true});f.options.env.performance={now:()=>now};
  const session=create(f.options);await session.prepare();now=1000;assert.equal(session.elapsed(),0);
  session.start();now=1250;assert.equal(session.elapsed(),.25);
  session.pause();session.pause();now=6250;assert.equal(session.elapsed(),.25);
  session.resume();session.resume();now=7000;assert.equal(session.elapsed(),1);
  session.pause();now=9000;session.resume();now=9500;session.stop();
  now=10000;assert.equal(session.elapsed(),1.5);
  f.recorder.onstop();await session.completed;assert.equal(session.elapsed(),1.5);
});
