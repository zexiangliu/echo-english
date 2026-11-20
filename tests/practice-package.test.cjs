const {test}=require('node:test');
const assert=require('node:assert/strict');
const {IDBFactory}=require('fake-indexeddb');
const {createStorage}=require('../extension/storage.js');
const pack=require('../extension/practice-package.js');
function snapshot(){return {
  sessions:[{recordingPlaybackPreferences:{speech:'silent',sing:'original'},vocalReverb:{reverb:'theatre',amount:.6},monitorReverb:true,videoId:'video',title:'中文 / 日本語 🎵',start:1,end:4,speed:'1',cues:[{key:'cue',start:1,end:4,text:'Hello 世界'}],assemblyChoices:[{start:1,end:4,choice:'take',enabled:true,adjustments:[{takeId:'take',delayMs:-20,volume:1.2,fadeInSeconds:.1,fadeOutSeconds:.2}]}],selectedTakeId:'take'}],
  recordings:[{referenceSource:'original',id:'take',videoId:'video',cueKey:'cue',start:1,end:4,speed:1,createdAt:1,effects:{delayMs:-120,reverb:'ktv',amount:0.4},blob:new Blob([new Uint8Array([0,255,17,18])],{type:'audio/webm'}),url:'blob:temporary'}],
  backings:[{key:'background',videoId:'video',start:0,end:30,createdAt:1,blob:new Blob(['音乐'],{type:'audio/flac'})}],
  favorites:[{videoId:'video',title:'收藏',createdAt:2}]
};}
test('practice pack preserves original audio bytes, Unicode, subtitles and assembly choices without temporary URLs',async()=>{
  const source=snapshot();source.recordings[0].starred=true;
  const file=pack.encode(source),restored=await pack.decode(file);
  assert.deepEqual(restored.sessions,source.sessions);assert.deepEqual(restored.favorites,source.favorites);
  for(const name of ['recordings','backings']){
    assert.deepEqual(await restored[name][0].blob.arrayBuffer(),await source[name][0].blob.arrayBuffer());
    assert.equal(restored[name][0].blob.type,source[name][0].blob.type);
  }
  assert.equal(restored.recordings[0].starred,true);
  assert.equal(restored.recordings[0].url,undefined);assert.equal(restored.recordings[0].referenceSource,'original');
  assert.deepEqual(restored.recordings[0].effects,source.recordings[0].effects);
});
test('truncated audio, appended garbage, unsupported versions, duplicate IDs and invalid captions are rejected',async()=>{
  const file=pack.encode(snapshot());
  await assert.rejects(pack.decode(file.slice(0,file.size-1)),/格式/);
  await assert.rejects(pack.decode(new Blob([file,'extra'])),/格式/);
  await assert.rejects(pack.decode(new Blob(['not a package'])),/格式/);
  const bytes=new Uint8Array(await file.arrayBuffer());bytes[0]=0;await assert.rejects(pack.decode(new Blob([bytes])),/格式/);
  const source=snapshot();source.recordings.push(source.recordings[0]);assert.throws(()=>pack.encode(source),/格式/);
  source.recordings.pop();source.sessions[0].cues[0].text={bad:true};assert.throws(()=>pack.encode(source),/格式/);
  const text=new TextEncoder().encode(JSON.stringify({format:'echo',version:2,data:{}})),size=new Uint8Array(4);new DataView(size.buffer).setUint32(0,text.length,true);
  await assert.rejects(pack.decode(new Blob(['ECHOPACK1\n',size,text])),/格式/);
});

test('legacy numeric-string recording speeds normalize for playback and assembly',async()=>{
  const source=snapshot();source.recordings[0].speed='1';
  const restored=await pack.decode(pack.encode(source));assert.equal(restored.recordings[0].speed,1);
  assert.doesNotThrow(()=>require('../extension/audio-export.js').plan([{...restored.recordings[0],capture:'vocal'}],4));
});

test('invalid capture timing and null package headers are rejected with a readable format error',async()=>{
  for(const values of [{vocalOffset:-1},{vocalOffset:NaN},{capturedEnd:5},{capturedEnd:0},{speed:true}]){
    const source=snapshot();Object.assign(source.recordings[0],values);
    assert.throws(()=>pack.encode(source),/格式/);
  }
  const size=new Uint8Array(4);new DataView(size.buffer).setUint32(0,4,true);
  await assert.rejects(pack.decode(new Blob(['ECHOPACK1\n',size,'null'])),/格式/);
});
test('migration merges atomically and repeatedly without replacing current progress or media; optional progress overwrite is explicit',async()=>{
  const source=createStorage(new IDBFactory()),dest=createStorage(new IDBFactory()),data=snapshot();
  await source.saveSession(data.sessions[0]);await source.saveTake(data.recordings[0]);await source.saveBacking(data.backings[0]);await source.setFavorite(data.favorites[0]);
  const decoded=await pack.decode(pack.encode(await source.snapshot()));
  await dest.saveSession({videoId:'video',title:'Current',start:10,end:20});
  assert.deepEqual(await dest.importSnapshot(decoded),{added:3,skipped:1});
  assert.equal((await dest.getSession('video')).title,'Current');
  assert.deepEqual(await dest.importSnapshot(decoded),{added:0,skipped:4});
  assert.equal((await dest.listTakes('video')).length,1);
  await dest.importSnapshot(decoded,true);assert.equal((await dest.getSession('video')).selectedTakeId,'take');
  // Imported versions and backgrounds survive normal rolling-cache eviction.
  for(let i=2;i<8;i++)await dest.saveTake({...data.recordings[0],id:String(i),createdAt:i});
  assert.equal((await dest.listTakes('video')).length,4);assert((await dest.listTakes('video')).some(t=>t.id==='take'));
  for(let i=2;i<12;i++)await dest.saveBacking({...data.backings[0],key:String(i),createdAt:i});
  assert.equal((await dest.listBackings('video')).length,9);assert((await dest.listBackings('video')).some(t=>t.key==='background'));
  const scoped=await dest.snapshot('missing');assert(Object.values(scoped).every(a=>a.length===0));
  const noBackground=await dest.snapshot('video',false);assert.equal(noBackground.backings.length,0);assert(noBackground.recordings.length);
  await dest.clearMedia('recordings','video');assert.equal((await dest.library())[0].favorite,true);
  (await source.ready).close();(await dest.ready).close();
});

test('a write failure rolls back the entire import, including session and favorite writes',async()=>{
  const storage=createStorage(new IDBFactory()),db=await storage.ready,original=db.transaction.bind(db);
  db.transaction=(...args)=>{
    const tx=original(...args),objectStore=tx.objectStore.bind(tx);
    tx.objectStore=name=>{const store=objectStore(name);if(name==='recordings')store.put=()=>{throw Error('simulated quota failure');};return store;};
    return tx;
  };
  await assert.rejects(storage.importSnapshot(snapshot()),/quota failure/);
  db.transaction=original;
  const data=await storage.snapshot();assert(Object.values(data).every(a=>a.length===0));db.close();
});

test('practice packages preserve accompaniment keys and reject invalid semitone metadata',async()=>{
  const source=snapshot();source.sessions[0].backingPitch=3;source.recordings[0].backingPitch=-2;
  const restored=await pack.decode(pack.encode(source));
  assert.equal(restored.sessions[0].backingPitch,3);assert.equal(restored.recordings[0].backingPitch,-2);
  for(const value of [7,-7,1.5,'3',null]){
    source.recordings[0].backingPitch=value;assert.throws(()=>pack.encode(source),/格式/);
  }
});
