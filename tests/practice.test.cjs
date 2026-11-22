const { test } = require('node:test');
const assert = require('node:assert/strict');
const { splitCaption, nudge, runLoop, runPractice } = require('../extension/practice.js');
test('separates interleaved bilingual transcript while preserving original', () => {
  const original = 'There is talk that your daughter 有傳言說你的女兒 is in line to be your successor. 是接班人的下一個人選。 Is that true? 這是真的嗎？';
  const result = splitCaption(original);
  assert.equal(result.english,'There is talk that your daughter is in line to be your successor. Is that true?');
  assert.equal(result.chinese,'有傳言說你的女兒 是接班人的下一個人選。 這是真的嗎？');
  assert.equal(result.original,original);
  assert.equal(splitCaption("I'm here.\nYou're welcome!").english,"I'm here. You're welcome!");
  assert.equal(splitCaption('只有中文。').english,'');
});
test('boundary nudges clamp at video edges and preserve minimum range', () => {
  assert.deepEqual(nudge(.1,1,'start',-.2,10),{start:0,end:1});
  assert.deepEqual(nudge(0,1,'start',2,10),{start:.9,end:1});
  assert.deepEqual(nudge(9,9.9,'end',.2,10),{start:9,end:10});
  assert.deepEqual(nudge(0,1,'end',-2,10),{start:0,end:.1});
  assert.throws(()=>nudge(3,2,'end',.2,10));
});
test('loop plays requested count with gaps only between repetitions', async () => {
  const calls=[];
  await runLoop({count:3,active:()=>true,listen:async n=>calls.push(n),gap:async()=>calls.push('gap')});
  assert.deepEqual(calls,[1,'gap',2,'gap',3]);
});
test('continuous loop stops after cancellation during gap', async () => {
  let active=true; const calls=[];
  await runLoop({count:0,active:()=>active,listen:async n=>calls.push(n),gap:async()=>{active=false;}});
  assert.deepEqual(calls,[1]);
});
test('practice orders listening, preparation, recording and replay across sentences', async () => {
  const calls=[]; let sentence=0;
  await runPractice({active:()=>true,listen:async()=>calls.push('listen'),prepare:async()=>calls.push('prepare'),record:async()=>{calls.push('record');return true;},replay:async()=>calls.push('replay'),advance:()=>++sentence<2});
  assert.deepEqual(calls,['listen','prepare','record','replay','listen','prepare','record','replay']);
});
test('cancelling preparation never starts a microphone recording', async () => {
  let active=true;
  await runPractice({active:()=>active,listen:async()=>{},prepare:async()=>{active=false;},record:async()=>assert.fail('record after cancel'),replay:async()=>assert.fail('replay after cancel'),advance:()=>assert.fail('advance after cancel')});
});
test('recording failure never replays a previous take', async () => {
  await runPractice({active:()=>true,listen:async()=>{},prepare:async()=>{},record:async()=>false,replay:async()=>assert.fail('stale recording'),advance:()=>assert.fail('advance after failure')});
});

test('continuous dub playback chooses latest take per sentence and sorts by video time',()=>{
  const {recordingQueue}=require('../extension/practice.js');
  const takes=[{id:'b',cueKey:'second',start:10,end:12,createdAt:2},{id:'old',cueKey:'first',start:0,end:2,createdAt:1},{id:'new',cueKey:'first',start:.2,end:2.2,createdAt:3},{id:'bad',cueKey:'bad',start:20,end:10,createdAt:4}];
  assert.deepEqual(recordingQueue(takes).map(t=>t.id),['new','b']);
});
test('continuous dub playback stops without starting the next segment',async()=>{
  const {playQueue}=require('../extension/practice.js');let active=true;const played=[];
  await playQueue({queue:['first','second'],active:()=>active,play:async value=>{played.push(value);active=false;}});
  assert.deepEqual(played,['first']);
});

test('playback watchdog allows whole songs and slower playback without a fixed two-minute cutoff',()=>{
  const {playbackTimeout}=require('../extension/practice.js');
  assert.equal(playbackTimeout({start:0,end:180,speed:1}),195000);
  assert.equal(playbackTimeout({start:30,end:330,speed:0.75}),415000);
});

test('caption frames handle upcoming lines, exact boundaries, gaps, seeks and the end of subtitles',()=>{
  const {captionFrame}=require('../extension/practice.js');
  const cues=[{start:2,end:4},{start:4,end:6},{start:9,end:10}];
  assert.deepEqual(captionFrame(cues,0),{index:0,phase:'upcoming'});
  assert.deepEqual(captionFrame(cues,2),{index:0,phase:'active'});
  assert.deepEqual(captionFrame(cues,4),{index:1,phase:'active'});
  assert.deepEqual(captionFrame(cues,7),{index:2,phase:'upcoming'});
  assert.deepEqual(captionFrame(cues,9.5),{index:2,phase:'active'});
  assert.deepEqual(captionFrame(cues,10),{index:2,phase:'ended'});
  assert.deepEqual(captionFrame(cues,3),{index:0,phase:'active'});
  assert.deepEqual(captionFrame([],3),{index:-1,phase:'empty'});
  assert.deepEqual(captionFrame(cues,NaN),{index:-1,phase:'empty'});
});

test('lead-in seconds are bounded and never seek before the video begins',()=>{
  const {leadInSeconds,leadInStart}=require('../extension/practice.js');
  for(const [value,expected] of [[undefined,0],['3',3],[-5,0],[Infinity,0],[100,30],[2.6,3]])assert.equal(leadInSeconds(value),expected);
  assert.equal(leadInStart(50,3),47);assert.equal(leadInStart(2,3),0);assert.equal(leadInStart(0,3),0);
});

test('previous sentence lead-in handles first sentences, gaps and manually adjusted ranges',()=>{
  const {leadInStart}=require('../extension/practice.js');
  const cues=[{start:5,end:8},{start:10,end:13},{start:15,end:18}];
  const previous={mode:'previous',cues};
  for(const [start,expected] of [[5,5],[10,5],[10.2,5],[14,10],[15,10],[19,15]])assert.equal(leadInStart(start,3,previous),expected);
  assert.equal(leadInStart(10,3,{mode:'previous'}),10);
  assert.equal(leadInStart(10,3,{mode:'none',cues}),10);
});

test('paragraph ranges include all selected sentences and their intervening gaps',()=>{
  const {paragraphRange}=require('../extension/practice.js');
  const cues=[{start:1,end:4},{start:5,end:12},{start:8,end:10},{start:15,end:17}];
  assert.deepEqual(paragraphRange(cues,1,2),{start:5,end:12});
  assert.deepEqual(paragraphRange(cues,0,3),{start:1,end:17});
  for(const bounds of [[0,0],[-1,2],[0,4],[1.5,2]])assert.throws(()=>paragraphRange(cues,...bounds),/至少两句/);
});


test('instrumental skipping ignores music captions, requires a gap and stays within the recording range',()=>{
  const {lyricSkip,isLyricCue}=require('../extension/practice.js');
  for(const text of ['[Music]','（间奏）','【前奏】','♪ ♫','간주','間奏'])assert.equal(isLyricCue({start:0,end:2,text}),false,text);
  assert.equal(isLyricCue({start:0,end:2,text:'Caught me in the middle'}),true);
  const cues=[{start:0,end:5,text:'[Music]'},{start:5,end:8,text:'First lyric'},{start:8,end:12,text:'间奏'},{start:12,end:16,text:'Second lyric'}];
  assert.equal(lyricSkip(cues,2,{start:0,end:20}).target.start,5);assert.equal(lyricSkip(cues,2,{start:0,end:20}).keep,false);
  assert.equal(lyricSkip(cues,6,{start:0,end:20}).target,null);
  const middle=lyricSkip(cues,9,{start:0,end:20});assert.equal(middle.target.start,12);assert.equal(middle.keep,true);
  assert.equal(lyricSkip(cues,9,{start:0,end:10}).target,null);
  assert.equal(lyricSkip([],0,{start:0,end:20}).target,null);
});

test('recorded range uses the captured end without changing the selected practice range',()=>{
  const {recordingRange}=require('../extension/practice.js');
  const take={start:5,end:60,capturedEnd:8,speed:1};
  assert.deepEqual(recordingRange(take),{start:5,end:8,speed:1});assert.equal(take.end,60);
  assert.equal(recordingRange({...take,capturedEnd:70}).end,60);
  assert.equal(recordingRange({start:5,end:60,speed:1}).end,60);
});

test('version comparison keeps the song position across different capture padding, bounds and recording speeds',()=>{
  const {versionReplayPosition}=require('../extension/practice.js');
  const from={start:5,end:15,speed:1,vocalOffset:.3},to={start:4.5,end:15,speed:.75,vocalOffset:.1};
  assert.deepEqual(versionReplayPosition(from,to,3.3),{video:8,audio:.1+3.5/.75,reset:false});
  assert.deepEqual(versionReplayPosition(from,{...to,capturedEnd:7},3.3),{video:4.5,audio:0,reset:true});
  assert.deepEqual(versionReplayPosition(from,{...to,start:9},3.3),{video:9,audio:0,reset:true});
  assert.deepEqual(versionReplayPosition(from,to,NaN),{video:4.5,audio:0,reset:true});
});
