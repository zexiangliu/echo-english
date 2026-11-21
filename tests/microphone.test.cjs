const {test}=require('node:test');
const assert=require('node:assert/strict');
const {clampDb,createInput}=require('../extension/microphone.js');
test('zero gain preserves the microphone stream and requires no audio context',async()=>{
  const mic={};const input=await createInput(mic,0,{});
  assert.equal(input.stream,mic);input.dispose();assert.equal(input.db,0);
  for(const [value,expected] of [[NaN,0],[Infinity,0],['12',0],[-4,0],[40,24],[6,6]])assert.equal(clampDb(value),expected);
});
function fixture(fail=false){
  const edges=[];let closed=0,stopped=0,gain;
  const processed={getTracks:()=>[{stop(){stopped++;}}]};
  const source={connect:to=>edges.push(['mic',to]),disconnect(){}};
  const destination={stream:processed};
  class AudioContext{
    state='running';
    createMediaStreamSource(mic){assert.equal(mic,'microphone');return source;}
    createGain(){return gain={gain:{value:1},connect:to=>edges.push(['gain',to]),disconnect(){}};}
    createMediaStreamDestination(){return destination;}
    async resume(){if(fail)throw Error('unavailable');}
    async close(){closed++;}
  }
  return {env:{AudioContext},edges,processed,destination,get gain(){return gain;},get closed(){return closed;},get stopped(){return stopped;}};
}
test('fixed dB gain feeds only the recording destination and cleans up once',async()=>{
  const f=fixture(),input=await createInput('microphone',16,f.env);
  assert.equal(input.stream,f.processed);assert.equal(input.db,16);
  assert(Math.abs(f.gain.gain.value-6.309573)<1e-6);
  assert.deepEqual(f.edges,[['mic',f.gain],['gain',f.destination]]);
  input.dispose();input.dispose();assert.equal(f.closed,1);assert.equal(f.stopped,1);
});
test('failed gain startup releases its graph and never silently records at the wrong volume',async()=>{
  const f=fixture(true);await assert.rejects(createInput('microphone',12,f.env),/0 dB/);
  assert.equal(f.closed,1);assert.equal(f.stopped,1);
});

test('recorder options request high bitrate Opus and require native PCM for lossless',()=>{
  const api=require('../extension/microphone.js');
  const Recorder={isTypeSupported:type=>['audio/webm;codecs=opus','audio/webm;codecs=pcm'].includes(type)};
  assert.deepEqual(api.recordingOptions('high',Recorder),{mimeType:'audio/webm;codecs=opus',audioBitsPerSecond:256000});
  assert.deepEqual(api.recordingOptions('lossless',Recorder),{mimeType:'audio/webm;codecs=pcm'});
  assert.throws(()=>api.recordingOptions('lossless',{isTypeSupported:()=>false}),/不支持无损/);
});
test('recording diagnostics use actual track settings without leaking device identifiers or bogus PCM bitrate',()=>{
  const api=require('../extension/microphone.js');
  const microphone=api.captureSettings({getAudioTracks:()=>[{getSettings:()=>({deviceId:'private',sampleRate:48000,channelCount:1,echoCancellation:false,noiseSuppression:false,autoGainControl:true})}]});
  assert.equal(microphone.deviceId,undefined);
  const description=api.describeRecording({mimeType:'audio/webm;codecs=pcm',audioBitsPerSecond:128000,microphone});
  assert.match(description,/无损 PCM/);assert.match(description,/48 kHz.*1 声道/);assert.match(description,/回声消除关.*降噪关.*自动增益开/);assert.doesNotMatch(description,/128 kbps/);
  assert.match(api.describeRecording({mimeType:'audio/webm;codecs=opus',audioBitsPerSecond:256000}),/256 kbps/);
  assert.match(api.describeRecording(),/旧录音/);assert.deepEqual(api.captureSettings({}),{});
});

test('input enumeration excludes outputs and duplicate/default identifiers; selected-device failure never falls back',async()=>{
  const api=require('../extension/microphone.js');
  const inputs=await api.listInputs({enumerateDevices:async()=>[
    {kind:'audioinput',deviceId:'default',label:'Default'},
    {kind:'audioinput',deviceId:'usb',label:'USB Mic'},
    {kind:'audioinput',deviceId:'usb',label:'Duplicate'},
    {kind:'audiooutput',deviceId:'speaker',label:'Speaker'},
    {kind:'audioinput',deviceId:'hidden',label:''}]});
  assert.deepEqual(inputs.map(d=>d.id),['usb','hidden']);assert.equal(inputs[1].named,false);
  let requests=0;
  await assert.rejects(api.requestStream({async getUserMedia(){requests++;throw Object.assign(Error('gone'),{name:'OverconstrainedError'});}},{deviceId:{exact:'usb'}}),/所选麦克风不可用/);
  assert.equal(requests,1);
});
for(const db of [0,6])for(const sidetoneMode of ['standard','minimum'])test(`sidetone ${sidetoneMode} at gain ${db} uses one graph and cannot enter the encoded branch`,async()=>{
  const edges=[],gains=[];let contextOptions,closed=0,destinations=0;
  const speakers={},mic={};const source={connect:target=>edges.push(['source',target]),disconnect(){}};
  const encoded={stream:{getTracks:()=>[{stop(){}}]}};
  class AudioContext{
    constructor(options){contextOptions=options;this.destination=speakers;this.state='running';}
    createMediaStreamSource(){return source;}
    createGain(){const node={gain:{value:1},connect:target=>edges.push([node,target]),disconnect(){}};gains.push(node);return node;}
    createMediaStreamDestination(){destinations++;return encoded;}
    async resume(){}async close(){closed++;}
  }
  const input=await createInput(mic,db,{AudioContext},{sidetone:true,sidetoneVolume:0.35,sidetoneMode});
  assert.equal(contextOptions.latencyHint,sidetoneMode==='minimum'?0:'interactive');assert.equal(destinations,db?1:0);
  assert.equal(input.stream,db?encoded.stream:mic);
  const monitor=gains.at(-1);assert.equal(monitor.gain.value,0);
  assert(edges.some(([from,to])=>from===monitor && to===speakers));
  assert(!edges.some(([from,to])=>from===monitor && to===encoded));
  input.setMonitoring(true);assert.equal(monitor.gain.value,0.35);
  input.setMonitorVolume(0.8);assert.equal(monitor.gain.value,0.8);
  if(db)assert(Math.abs(gains[0].gain.value-10**(db/20))<1e-6);
  input.setMonitoring(false);assert.equal(monitor.gain.value,0);
  input.dispose();input.dispose();assert.equal(closed,1);
});

test('latency diagnostics keep browser components separate and never turn absent estimates into zero',()=>{
  const {monitoringInfo,describeMonitoring,describeRecording}=require('../extension/microphone.js');
  const info=monitoringInfo({baseLatency:0,outputLatency:0.01},{getAudioTracks:()=>[{getSettings:()=>({latency:0.02,deviceId:'private'})}]},'minimum');
  assert.deepEqual(info,{mode:'minimum',inputLatency:0.02,baseLatency:0,outputLatency:0.01});
  const text=describeMonitoring(info);assert.match(text,/输入 20.0 ms/);assert.match(text,/图缓冲 0.0 ms/);assert.match(text,/输出 10.0 ms/);assert.match(text,/非完整耳返延迟/);
  assert.doesNotMatch(text,/30.0 ms/);
  assert.match(describeRecording({monitoring:info}),/更低延迟/);
  const unknown=monitoringInfo({baseLatency:NaN,get outputLatency(){throw Error('not supported');}},{});
  assert.deepEqual(unknown,{mode:'standard',inputLatency:null,baseLatency:null,outputLatency:null});
  assert.equal(describeMonitoring(null),'');assert.match(describeMonitoring(unknown),/输入 未报告/);
});

test('failed experimental sidetone startup requests an explicit return to standard and releases its context',async()=>{
  const f=fixture(true);
  await assert.rejects(createInput('microphone',0,f.env,{sidetone:true,sidetoneMode:'minimum'}),/切回标准模式/);
  assert.equal(f.closed,1);
});

test('experimental reverb is confined to the headphone branch and can change without reacquiring capture',async()=>{
  let context;const mic={},encodedStream={},speaker={},edges=new Map();
  function node(){const value={gain:{value:1},connect(to){if(!edges.has(value))edges.set(value,new Set());edges.get(value).add(to);},disconnect(to){if(to)edges.get(value)?.delete(to);else edges.delete(value);}};return value;}
  class AudioContext{
    constructor(){context=this;this.sampleRate=1000;this.destination=speaker;this.state='running';}
    createMediaStreamSource(){return this.source=node();}
    createMediaStreamDestination(){return this.encoded=Object.assign(node(),{stream:encodedStream});}
    createGain(){return node();}createConvolver(){return this.convolver=node();}
    createBuffer(channels,length){return {getChannelData:()=>new Float32Array(length)};}
    async resume(){}async close(){}
  }
  encodedStream.getTracks=()=>[];
  const input=await createInput(mic,6,{AudioContext},{sidetone:true,sidetoneReverb:{reverb:'ktv',amount:.4}});
  const reaches=(from,to,visited=new Set())=>{if(from===to)return true;if(visited.has(from))return false;visited.add(from);return [...edges.get(from) || []].some(next=>reaches(next,to,visited));};
  assert.equal(input.stream,encodedStream);assert(reaches(context.source,context.encoded));assert(reaches(context.convolver,speaker));assert(!reaches(context.convolver,context.encoded));
  const first=context.convolver;input.setMonitorReverb({reverb:'theatre',amount:.6});
  assert.notEqual(context.convolver,first);assert(!reaches(first,speaker));assert(!reaches(context.convolver,context.encoded));
  input.setMonitoring(true);input.setMonitoring(false);input.setMonitorReverb({});
  assert(!reaches(context.convolver,speaker));assert(reaches(context.source,context.encoded));input.dispose();
});

test('microphone access errors explain recovery and preserve their original cause',async()=>{
  const api=require('../extension/microphone.js');
  for(const [name,expected] of [['NotAllowedError',/网站设置.*系统/],['SecurityError',/权限/],['NotFoundError',/连接.*录音设置/],['NotReadableError',/占用/]]){
    const cause=Object.assign(Error('browser message'),{name});
    await assert.rejects(api.requestStream({async getUserMedia(){throw cause;}},{}),error=>expected.test(error.message) && error.cause===cause);
  }
  const unknown=Error('unexpected');
  await assert.rejects(api.requestStream({async getUserMedia(){throw unknown;}},{}),error=>error===unknown);
});
