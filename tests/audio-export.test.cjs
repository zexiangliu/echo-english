const {test}=require('node:test');
const assert=require('node:assert/strict');
const {filename,plan,render}=require('../extension/audio-export.js');
const voice=(id,start,end,createdAt=1,extra={})=>({id,start,end,createdAt,cueKey:id,kind:'song',capture:'vocal',speed:1,blob:new Blob([id]),...extra});

test('download names preserve multilingual titles and identify range and audio type',()=>{
  assert.equal(filename({title:'晴天 / ライブ: 노래?',start:50,end:65.2,kind:'vocals'}),'晴天 ライブ 노래_00m50.0s-01m05.2s_人声.webm');
  assert.equal(filename({title:'Song',start:0,end:180,kind:'mixed',assembled:true,extension:'wav'}),'Song_00m00.0s-03m00.0s_整首合成_人声+伴奏.wav');
  assert.match(filename({videoId:'abc123',start:0,end:5,kind:'dubbing'}),/^YouTube-abc123_.*_配音.webm$/);
});

test('download names avoid invalid Windows characters and excessive UTF-8 filename lengths',()=>{
  const name=filename({title:' .<>:"/\\|?*\x00\n歌曲😀'.repeat(100),start:0,end:600,kind:'mixed',assembled:true,extension:'wav'});
  assert.doesNotMatch(name,/[<>:"/\\|?*\x00-\x1f]/);
  assert.ok(Buffer.byteLength(name,'utf8')<255);
  assert.doesNotMatch(name,/\uFFFD/);
  assert.match(filename({title:'...',videoId:'abc'}),/^YouTube-abc_/);
});

test('assembly keeps gaps and lets the newest recording replace overlapping ranges',()=>{
  const result=plan([voice('a',0,3),voice('b',2,4,2),voice('c',6,8)],10);
  assert.deepEqual(result.segments.map(s=>[s.start,s.end,s.take.id]),[[0,2,'a'],[2,4,'b'],[6,8,'c']]);
  assert.deepEqual(result.gaps, [{start:4,end:6},{start:8,end:10}]);
});

test('the shared export planner accepts dry dubbing without pretending it is a song',()=>{
  const spoken=voice('spoken',0,2,1,{kind:undefined,backingKey:'background'});
  const result=plan([spoken],2);
  assert.equal(result.segments[0].take.id,'spoken');
  assert.equal(filename({title:'电影',start:0,end:2,kind:'background',extension:'wav'}),'电影_00m00.0s-00m02.0s_人声+背景音.wav');
});
test('latest version wins, partial recordings leave silence, legacy mixed audio is never treated as vocals',()=>{
  const latest=voice('new',1,4,2,{cueKey:'line',capturedEnd:2});
  const result=plan([voice('old',1,4,1,{cueKey:'line',speed:0.75}),latest],5);
  assert.deepEqual(result.segments.map(s=>[s.start,s.end,s.take.id]),[[1,2,'new']]);
  assert.throws(()=>plan([voice('legacy',0,5,1,{withBacking:true})],5),/旧版/);
  assert.throws(()=>plan([voice('slow',0,5,1,{speed:0.75})],5),/1×/);
});

test('WAV rendering positions vocals, mixes backing once and preserves the original source buffers',async()=>{
  const decoded=new Map();let closed=0;
  for(const [id,n,length] of [['a',0.25,8],['b',0.5,8],['c',0.75,4],['backing',0.1,16]]){
    const samples=new Float32Array(length).fill(n);decoded.set(id,{sampleRate:4,numberOfChannels:1,getChannelData:()=>samples});
  }
  class AudioContext{async decodeAudioData(bytes){return decoded.get(new TextDecoder().decode(bytes));}async close(){closed++;}}
  const env={AudioContext,setTimeout:fn=>queueMicrotask(fn)};
  const result=await render({takes:[voice('a',0,2),voice('b',1,3,2),voice('c',3,4)],duration:4,sampleRate:4,
    backing:{start:0,end:4,blob:new Blob(['backing'])}},env);
  const bytes=await result.blob.arrayBuffer(),view=new DataView(bytes);
  assert.equal(new TextDecoder().decode(bytes.slice(0,4)),'RIFF');assert.equal(view.getUint32(24,true),4);
  assert.equal(view.getUint32(40,true),64);assert.equal(bytes.byteLength,108);
  for(const [frame,n] of [[0,0.35],[4,0.6],[12,0.85]])assert(Math.abs(view.getInt16(44+frame*4,true)/32767-n)<0.001);
  assert.equal(decoded.get('a').getChannelData()[0],0.25);assert.equal(closed,1);
  await assert.rejects(render({takes:[voice('a',0,2)],duration:2,sampleRate:4,active:()=>false},env),/取消/);
  assert.equal(closed,2);
});

test('mixed clip export uses the correct offset in a full-song accompaniment',async()=>{
  const backingData=Float32Array.from([0.1,0.2,0.3,0.4]);
  class AudioContext{
    async decodeAudioData(bytes){const backing=new TextDecoder().decode(bytes)==='backing';return {sampleRate:1,numberOfChannels:1,getChannelData:()=>backing?backingData:Float32Array.from([0,0,0.1,0.1])};}
    async close(){}
  }
  const result=await render({takes:[voice('voice',2,4,1,{vocalOffset:2})],duration:2,origin:2,sampleRate:1,backing:{start:0,end:4,blob:new Blob(['backing'])}}, {AudioContext,setTimeout:fn=>queueMicrotask(fn)});
  const view=new DataView(await result.blob.arrayBuffer());assert(Math.abs(view.getInt16(44,true)/32767-0.4)<0.001);
});


test('export applies independent vocal and backing gains including mute',async()=>{
  class AudioContext{
    async decodeAudioData(bytes){const backing=new TextDecoder().decode(bytes)==='backing';return {sampleRate:1,numberOfChannels:1,getChannelData:()=>Float32Array.from([backing?0.1:0.2])};}
    async close(){}
  }
  for(const [vocalVolume,volume,expected] of [[1.5,0.5,0.35],[0,0.5,0.05],[1.5,0,0.3]]){
    const result=await render({takes:[voice('voice',0,1)],duration:1,sampleRate:1,vocalVolume,volume,backing:{start:0,end:1,blob:new Blob(['backing'])}}, {AudioContext,setTimeout:fn=>queueMicrotask(fn)});
    const view=new DataView(await result.blob.arrayBuffer());assert(Math.abs(view.getInt16(44,true)/32767-expected)<0.001);
  }
});

test('a new sentence replaces only its overlap within an older paragraph and keeps timeline gaps',()=>{
  const result=plan([voice('paragraph',10,30,1),voice('sentence',18,22,2),voice('next-paragraph',35,45,3)],50);
  assert.deepEqual(result.segments.map(s=>[s.start,s.end,s.take.id]),[[10,18,'paragraph'],[18,22,'sentence'],[22,30,'paragraph'],[35,45,'next-paragraph']]);
  assert.deepEqual(result.gaps,[{start:0,end:10},{start:30,end:35},{start:45,end:50}]);
});

test('manual assembly uses the selected older version and keeps excluded time silent',async()=>{
  const old=voice('old',0,4,1,{cueKey:'same',vocalOffset:0.5}),newer=voice('new',0,4,2,{cueKey:'same'});
  class AudioContext{
    async decodeAudioData(bytes){const id=new TextDecoder().decode(bytes);return {sampleRate:2,numberOfChannels:1,getChannelData:()=>id==='old'?Float32Array.from([.1,.2,.3,.4,.5,.6,.7,.8,.9]):new Float32Array(8).fill(.8)};}
    async close(){}
  }
  const result=await render({takes:[old,newer],duration:1,origin:1,sampleRate:2,selection:[{start:1,end:2,takeId:'old'}]}, {AudioContext,setTimeout:fn=>queueMicrotask(fn)});
  const view=new DataView(await result.blob.arrayBuffer());assert(Math.abs(view.getInt16(44,true)/32767-.4)<.001);assert(Math.abs(view.getInt16(48,true)/32767-.5)<.001);
  const {selectionPlan}=require('../extension/audio-export.js');
  const plan=selectionPlan([old,newer],4,[{start:0,end:1,takeId:'old'},{start:1,end:3,takeId:null},{start:3,end:4,takeId:'new'}]);
  assert.deepEqual(plan.gaps,[{start:1,end:3}]);assert.deepEqual(plan.segments.map(s=>s.take.id),['old','new']);
  assert.throws(()=>selectionPlan([old],4,[{start:0,end:2,takeId:'old'},{start:1,end:3,takeId:'old'}]),/不能重叠/);
  assert.throws(()=>selectionPlan([old],5,[{start:0,end:5,takeId:'old'}]),/未覆盖/);
  assert.throws(()=>selectionPlan([old],4,[{start:0,end:1,takeId:'missing'}]),/不存在/);
});

test('subtitle export filenames use the shared safe video title with explicit SRT and VTT extensions',()=>{
  const {filename}=require('../extension/audio-export.js');
  for(const extension of ['srt','vtt'])assert.equal(filename({title:'My / Song',kind:'subtitles',extension}),`My Song_字幕.${extension}`);
});

test('per-take alignment shifts samples directly without allocating offline contexts or inheriting old per-take reverb',async()=>{
  const data=Float32Array.from([.1,.2,.3,.4]);
  class AudioContext{async decodeAudioData(){return {sampleRate:4,numberOfChannels:1,getChannelData:()=>data};}async close(){}}
  for(const [delayMs,expected] of [[250,[0,.1,.2,.3]],[-250,[.2,.3,.4,0]]]){
    const result=await render({takes:[voice('a',0,1,1,{effects:{delayMs,reverb:'theatre',amount:2}})],duration:1,sampleRate:4},{AudioContext,setTimeout:queueMicrotask});
    const view=new DataView(await result.blob.arrayBuffer());
    for(let i=0;i<4;i++)assert(Math.abs(view.getInt16(44+i*4,true)/32767-expected[i])<.0001);
  }
});

test('shared reverb processes the assembled vocal once before accompaniment is mixed',async()=>{
  let renders=0,processed;
  const buffer=(channels,length,sampleRate)=>{const data=Array.from({length:channels},()=>new Float32Array(length));return {numberOfChannels:channels,length,sampleRate,duration:length/sampleRate,getChannelData:c=>data[c]};};
  class AudioContext{
    createBuffer(...args){return buffer(...args);}
    async decodeAudioData(bytes){const result=buffer(1,1,1);result.getChannelData(0)[0]=new TextDecoder().decode(bytes)==='a'?.1:new TextDecoder().decode(bytes)==='b'?.2:.05;return result;}
    async close(){}
  }
  class OfflineAudioContext{
    constructor(channels,length,rate){this.sampleRate=rate;this.destination={};this.output=buffer(channels,length,rate);}
    createBuffer(...args){return buffer(...args);}
    createBufferSource(){const source={connect(){},start(){processed=source.buffer;}};return source;}
    createConvolver(){return {connect(){}};}createGain(){return {gain:{},connect(){}};}
    async startRendering(){renders++;for(let c=0;c<2;c++)this.output.getChannelData(c).set(processed.getChannelData(c).map(n=>n*2));return this.output;}
  }
  const result=await render({takes:[voice('a',0,1),voice('b',1,2)],duration:2,sampleRate:1,reverb:{reverb:'ktv',amount:1},backing:{start:0,end:2,blob:new Blob(['music'])}}, {AudioContext,OfflineAudioContext,setTimeout:queueMicrotask});
  assert.equal(renders,1);assert.deepEqual(Array.from(processed.getChannelData(0)).map(n=>n.toFixed(2)),['0.10','0.20']);
  const view=new DataView(await result.blob.arrayBuffer());assert(Math.abs(view.getInt16(44,true)/32767-.25)<.0001);assert(Math.abs(view.getInt16(48,true)/32767-.4)<.0001);
});

test('early-stop export fades vocals and backing together at the captured endpoint',async()=>{
  const make=()=>({length:8,duration:4,sampleRate:2,numberOfChannels:1,getChannelData:()=>new Float32Array(8).fill(0.2)});
  class AudioContext{async decodeAudioData(){return make();}async close(){}}
  class OfflineAudioContext{
    constructor(){this.sampleRate=2;this.destination={};}
    createBufferSource(){return {connect(){},start(){}};}
    async startRendering(){const data=new Float32Array(8).fill(0.2);return {...make(),getChannelData:()=>data};}
  }
  const result=await render({takes:[voice('a',0,8,1,{capturedEnd:4,effects:{fadeOutSeconds:2}})],duration:4,sampleRate:2,backing:{start:0,end:8,blob:new Blob(['backing'])}}, {AudioContext,OfflineAudioContext,setTimeout:fn=>queueMicrotask(fn)});
  const view=new DataView(await result.blob.arrayBuffer());
  for(const [frame,expected] of [[0,0.4],[4,0.4],[6,0.2],[7,0.1]])assert.ok(Math.abs(view.getInt16(44+frame*4,true)/32767-expected)<0.001);
});

test('a per-take fade leaves the unrecorded outro and later takes audible',async()=>{
  class AudioContext{
    async decodeAudioData(){return {length:12,duration:6,sampleRate:2,numberOfChannels:1,getChannelData:()=>new Float32Array(12).fill(.2)};}
    async close(){}
  }
  const takes=[voice('a',0,4,1,{capturedEnd:2,effects:{fadeOutSeconds:1}}),voice('b',2,4,2,{effects:{fadeOutSeconds:1}})];
  const result=await render({takes,duration:6,sampleRate:2,backing:{start:0,end:6,blob:new Blob(['backing'])}}, {AudioContext,setTimeout:queueMicrotask});
  const view=new DataView(await result.blob.arrayBuffer());
  for(const [frame,expected] of [[0,.4],[3,.3],[4,.4],[7,.3],[8,.2],[11,.2]])assert.ok(Math.abs(view.getInt16(44+frame*4,true)/32767-expected)<.001,`frame ${frame}`);
});

test('automatic export planning never extends a recording beyond its selected endpoint',()=>{
  const result=plan([voice('a',0,2,1,{capturedEnd:5})],6);
  assert.equal(result.segments[0].end,2);assert.deepEqual(result.gaps,[{start:2,end:6}]);
});


test('cropping before a take fade does not introduce a fade into the export or its backing',async()=>{
  class AudioContext{
    async decodeAudioData(){return {length:16,duration:8,sampleRate:2,numberOfChannels:1,getChannelData:()=>new Float32Array(16).fill(.2)};}
    async close(){}
  }
  const result=await render({takes:[voice('a',0,8,1,{effects:{fadeOutSeconds:2}})],origin:2,duration:2,sampleRate:2,selection:[{start:2,end:4,takeId:'a'}],backing:{start:0,end:8,blob:new Blob(['backing'])}}, {AudioContext,setTimeout:queueMicrotask});
  const view=new DataView(await result.blob.arrayBuffer());
  for(let i=0;i<4;i++)assert.ok(Math.abs(view.getInt16(44+i*4,true)/32767-.4)<.001,`frame ${i}`);
});


test('local assembly alignment adds to version delay; volume and fades affect only their interval, backing stays intact',async()=>{
  const data=Float32Array.from([.1,.2,.3,.4,.5,.6,.7,.8]);
  class AudioContext{async decodeAudioData(bytes){return {sampleRate:4,numberOfChannels:1,getChannelData:()=>new TextDecoder().decode(bytes)==='backing'?new Float32Array(8).fill(.05):data};}async close(){}}
  const take=voice('a',0,2,1,{effects:{delayMs:250}});
  const result=await render({takes:[take],duration:2,sampleRate:4,backing:{start:0,end:2,blob:new Blob(['backing'])},selection:[
    {start:0,end:1,takeId:'a',adjustment:{delayMs:-250,volume:.5,fadeInSeconds:.5,fadeOutSeconds:.5}},
    {start:1,end:2,takeId:'a'}
  ]},{AudioContext,setTimeout:queueMicrotask});
  const view=new DataView(await result.blob.arrayBuffer()),expected=[.05,.1,.2,.15,.45,.55,.65,.75];
  for(let i=0;i<expected.length;i++)assert(Math.abs(view.getInt16(44+i*4,true)/32767-expected[i])<.0001,`sample ${i}`);
  assert.deepEqual(take.effects,{delayMs:250});assert.deepEqual([...data],[...Float32Array.from([.1,.2,.3,.4,.5,.6,.7,.8])]);
});

test('cropped and context previews retain local fade anchors and decode each original take only once',async()=>{
  let decoded=0;
  class AudioContext{async decodeAudioData(){decoded++;return {sampleRate:4,numberOfChannels:1,getChannelData:()=>new Float32Array(16).fill(.4)};}async close(){}}
  const take=voice('a',0,4),adjustment={volume:.5,fadeInSeconds:2};
  const selection=[{start:1,end:2,takeId:'a',adjustment,adjustmentStart:0,adjustmentEnd:4},{start:2,end:3,takeId:'a',adjustment,adjustmentStart:0,adjustmentEnd:4}];
  const result=await render({takes:[take],duration:2,origin:1,sampleRate:4,selection},{AudioContext,setTimeout:queueMicrotask});
  assert.equal(decoded,1);
  const view=new DataView(await result.blob.arrayBuffer());
  assert(Math.abs(view.getInt16(44,true)/32767-.1)<.0001);
  assert(Math.abs(view.getInt16(44+4*4,true)/32767-.2)<.0001);
  const {selectionPlan,segmentAdjustment}=require('../extension/audio-export.js');
  assert.equal(selectionPlan([take],4,selection).segments.length,2);
  assert.throws(()=>selectionPlan([take],4,[{...selection[0],adjustmentStart:2}]),/微调范围/);
  assert.deepEqual(segmentAdjustment({delayMs:Infinity,volume:99,fadeInSeconds:-1,fadeOutSeconds:NaN}),{delayMs:0,volume:2,fadeInSeconds:0,fadeOutSeconds:0});
});
