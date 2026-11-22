const {test}=require('node:test');
const assert=require('node:assert/strict');
const {attach}=require('../extension/playback-controls.js');
function fixture(){
  const button=()=>({setAttribute(){}}),pauseButton=button(),speedControl=button(),speedInput=button(),errors=[],pauses=[];
  let speed='1';
  const controls=attach({pauseButton,speedControl,speedInput,clock:{setPaused:value=>pauses.push(value)},getSpeed:()=>speed,onSpeed:value=>{speed=String(value);},onError:error=>errors.push(error)});
  return {controls,pauseButton,speedControl,speedInput,errors,pauses};
}
test('a pending pause/resume cannot be toggled twice and speed changes preserve the pause state',async()=>{
  const f=fixture();let release,resumes=0,rate;
  f.controls.set(()=>new Promise(resolve=>{release=resolve;}),()=>resumes++,value=>{rate=value;});
  const pending=f.pauseButton.onclick();await f.pauseButton.onclick();
  assert.equal(f.pauseButton.disabled,true);assert.deepEqual(f.pauses,[true]);
  release();await pending;assert.equal(f.controls.paused,true);
  f.speedInput.value='0.75';f.speedInput.onchange();assert.equal(rate,.75);assert.equal(f.controls.paused,true);
  await f.pauseButton.onclick();assert.equal(resumes,1);assert.deepEqual(f.pauses,[true,false]);
});
test('late failures from replaced playback cannot stop a new playback or change its controls',async()=>{
  const f=fixture();let reject;
  f.controls.set(()=>{},()=>new Promise((resolve,fail)=>{reject=fail;}));
  await f.pauseButton.onclick();const pending=f.pauseButton.onclick();
  f.controls.clear();f.controls.set(()=>{},()=>{});
  reject(Error('old audio failed'));await pending;
  assert.equal(f.errors.length,0);assert.equal(f.controls.paused,false);assert.equal(f.pauseButton.disabled,false);
  assert.equal(f.pauseButton.textContent,'Ⅱ 暂停');assert.equal(f.speedControl.hidden,true);
});
test('active playback failures are reported while clearing hides both controls',async()=>{
  const f=fixture(),error=Error('device disconnected');
  f.controls.set(()=>{throw error;},()=>{});
  await f.pauseButton.onclick();assert.deepEqual(f.errors,[error]);
  f.controls.clear();assert.equal(f.pauseButton.hidden,true);assert.equal(f.speedControl.hidden,true);
});


test('original volume stays synchronized with native media and detaches on playback replacement',()=>{
  const element=()=>({setAttribute(){}}),volumeControl=element(),volumeInput=element(),volumeValue=element(),events=new Map();
  const media={volume:.6,muted:false,addEventListener(name,fn){events.set(name,fn);},removeEventListener(name,fn){if(events.get(name)===fn)events.delete(name);}};
  const controls=attach({pauseButton:element(),speedControl:element(),speedInput:element(),volumeControl,volumeInput,volumeValue,clock:{},getSpeed:()=>1});
  assert.equal(volumeControl.hidden,true);
  controls.set(()=>{},()=>{},null,media);assert.equal(volumeControl.hidden,false);assert.equal(volumeValue.textContent,'60%');
  volumeInput.value='.25';volumeInput.oninput();assert.equal(media.volume,.25);assert.equal(volumeValue.textContent,'25%');
  media.muted=true;events.get('volumechange')();assert.equal(volumeInput.value,'0');
  volumeInput.value='.5';volumeInput.oninput();assert.equal(media.muted,false);assert.equal(media.volume,.5);
  controls.set(()=>{},()=>{});assert.equal(volumeControl.hidden,true);assert.equal(events.size,0);
  volumeInput.value='.9';volumeInput.oninput();assert.equal(media.volume,.5);
  controls.set(()=>{},()=>{},null,media);controls.clear();assert.equal(events.size,0);assert.equal(volumeControl.hidden,true);
});


test('all offered practice speeds apply during playback and unsupported speeds are ignored',()=>{
  const f=fixture();let rate=1;
  f.controls.set(()=>{},()=>{},value=>{rate=value;});
  for(const speed of require('../extension/practice.js').SPEEDS){
    f.speedInput.value=String(speed);f.speedInput.onchange();assert.equal(rate,speed);
  }
  f.speedInput.value='0.1';f.speedInput.onchange();assert.equal(rate,1.5);assert.equal(f.speedInput.value,'1.5');
});


test('a lyric jump waits for a pending pause and resumes once without losing the UI state',async()=>{
  const f=fixture();let release,resumes=0;
  f.controls.set(()=>new Promise(resolve=>{release=resolve;}),()=>resumes++);
  const pausing=f.pauseButton.onclick(),resuming=f.controls.resume();
  assert.equal(resumes,0);release();await Promise.all([pausing,resuming]);
  assert.equal(resumes,1);assert.equal(f.controls.paused,false);assert.equal(f.pauseButton.textContent,'Ⅱ 暂停');
});

test('a pending resume request cannot resume a replacement player',async()=>{
  const f=fixture();let release,resumes=0;
  f.controls.set(()=>new Promise(resolve=>{release=resolve;}),()=>resumes++);
  const pausing=f.pauseButton.onclick(),resuming=f.controls.resume();
  f.controls.clear();f.controls.set(()=>{},()=>resumes++);
  release();await Promise.all([pausing,resuming]);assert.equal(resumes,0);assert.equal(f.controls.paused,false);
});

test('a replacement media owner can start paused without invoking playback first',async()=>{
  const f=fixture();let resumed=0;
  f.controls.set(()=>{},()=>resumed++,null,null,true);
  assert.equal(f.controls.paused,true);assert.equal(f.pauseButton.textContent,'▶ 继续');assert.equal(resumed,0);assert.equal(f.pauses.at(-1),true);
  await f.pauseButton.onclick();assert.equal(resumed,1);assert.equal(f.controls.paused,false);
});
