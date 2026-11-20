const { test } = require('node:test');
const assert = require('node:assert/strict');
const { IDBFactory } = require('fake-indexeddb');
const { createStorage,cueKey } = require('../extension/storage.js');
const take = (id,videoId='video',key='sentence',createdAt=Number(id))=>({id,videoId,cueKey:key,createdAt,start:1,end:3,speed:1,blob:new Blob(['audio'])});

test('persists progress and all adjusted cues across a database reopen', async()=>{
  const factory=new IDBFactory(); const first=createStorage(factory);
  const session={videoId:'video',index:1,start:2.2,end:4.8,speed:'0.75',cues:[{key:'stable',start:2.2,end:4.8,text:'Hello'}]};
  await first.saveSession(session);(await first.ready).close();
  const second=createStorage(factory);
  assert.deepEqual(await second.getSession('video'),session);
  assert.equal(await second.getSession('other'),undefined);(await second.ready).close();
});
test('retains only newest three per sentence, without pruning other sentences/videos',async()=>{
  const storage=createStorage(new IDBFactory());
  await Promise.all(['1','2','3','4'].map(id=>storage.saveTake(take(id))));
  await storage.saveTake(take('5','video','other'));
  await storage.saveTake(take('6','another','sentence'));
  assert.deepEqual((await storage.listTakes('video')).map(t=>t.id),['5','4','3','2']);
  assert.deepEqual((await storage.listTakes('another')).map(t=>t.id),['6']);
  (await storage.ready).close();
});
test('delete and undo restore the original audio and metadata',async()=>{
  const storage=createStorage(new IDBFactory());const value=take('1');
  await storage.saveTake(value);await storage.deleteTake('1');
  assert.deepEqual(await storage.listTakes('video'),[]);
  await storage.saveTake(value);const [restored]=await storage.listTakes('video');
  assert.equal(await restored.blob.text(),'audio');assert.equal(restored.start,1);assert.equal(restored.speed,1);
  (await storage.ready).close();
});

test('configurable retention prunes only the saved segment and exempts imported recordings',async()=>{
  const storage=createStorage(new IDBFactory());
  for(let i=1;i<=6;i++)await storage.saveTake(take(String(i)),{maxTakes:0});
  await storage.saveTake({...take('7'),imported:true},{maxTakes:0});
  await storage.saveTake(take('8','video','other'),{maxTakes:1});
  assert.equal((await storage.listTakes('video')).length,8);
  await storage.saveTake(take('9'),{maxTakes:5});
  assert.deepEqual((await storage.listTakes('video')).map(t=>t.id),['9','8','7','6','5','4','3']);
  await storage.saveTake(take('10'),{maxTakes:1});
  assert.deepEqual((await storage.listTakes('video')).map(t=>t.id),['10','8','7']);
  (await storage.ready).close();
});

test('invalid version limits fall back to three while zero explicitly means unlimited',()=>{
  const {takeLimit}=require('../extension/storage.js');
  for(const value of [undefined,null,'',' ',true,-1,1.5,101,Infinity,'bad'])assert.equal(takeLimit(value),3);
  for(const value of [0,1,5,100])assert.equal(takeLimit(String(value)),value);
});
test('upgrades v1 latest take without losing its audio or leaving a duplicate',async()=>{
  const factory=new IDBFactory();
  const old=await new Promise((resolve,reject)=>{
    const request=factory.open('echo-dubbing-v1',1);
    request.onupgradeneeded=()=>request.result.createObjectStore('takes',{keyPath:'videoId'});
    request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
  });
  await new Promise((resolve,reject)=>{const tx=old.transaction('takes','readwrite');tx.objectStore('takes').put({videoId:'video',start:10,end:15,speed:.75,createdAt:123,blob:new Blob(['legacy'])});tx.oncomplete=resolve;tx.onerror=reject;});old.close();
  const storage=createStorage(factory);const values=await storage.listTakes('video');
  assert.equal(values.length,1);assert.equal(values[0].cueKey,cueKey(null,10,15));
  assert.equal(await values[0].blob.text(),'legacy');assert.equal(values[0].speed,.75);
  const db=await storage.ready;
  const count=await new Promise(resolve=>{db.transaction('takes').objectStore('takes').count().onsuccess=e=>resolve(e.target.result);});
  assert.equal(count,0);db.close();
});
test('stable sentence keys survive boundary changes and distinguish manual ranges',()=>{
  const cue={start:1,text:'Hello'};const key=cueKey(cue);
  assert.equal(cueKey({...cue,start:1.2,key}),key);
  assert.notEqual(cueKey(null,1,3),cueKey(null,2,3));
});

test('upgrades existing song takes without losing audio or sharing manual dubbing version limits',async()=>{
  const factory=new IDBFactory();
  const old=await new Promise((resolve,reject)=>{
    const request=factory.open('echo-dubbing-v1',3);
    request.onupgradeneeded=()=>request.result.createObjectStore('recordings',{keyPath:'id'});
    request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
  });
  const key=cueKey(null,1,3);
  await new Promise((resolve,reject)=>{
    const tx=old.transaction('recordings','readwrite');tx.objectStore('recordings').put({...take('1','video',key),kind:'song'});
    tx.oncomplete=resolve;tx.onerror=reject;
  });old.close();
  const storage=createStorage(factory);
  for(const id of ['2','3','4','5'])await storage.saveTake(take(id,'video',key));
  const values=await storage.listTakes('video');
  assert.equal(values.length,4);const song=values.find(t=>t.kind==='song');
  assert.equal(song.cueKey,`song:${key}`);assert.equal(await song.blob.text(),'audio');
  (await storage.ready).close();
});

test('accompaniment audio survives database reopen and keeps a bounded cache independently of recordings',async()=>{
  const factory=new IDBFactory(),first=createStorage(factory);
  await first.saveTake(take('1'));
  for(let i=0;i<9;i++)await first.saveBacking({key:`video:${i}`,videoId:'video',start:i,end:i+1,createdAt:i,blob:new Blob([`backing-${i}`])});
  (await first.ready).close();
  const reopened=createStorage(factory),values=await reopened.listBackings('video');
  assert.equal(values.length,8);assert.equal(values[0].key,'video:8');
  assert.equal(await values[0].blob.text(),'backing-8');assert(!values.some(v=>v.key==='video:0'));
  assert.equal((await reopened.listTakes('video')).length,1);
  (await reopened.ready).close();
});

test('library groups metadata and byte counts across videos without returning audio blobs',async()=>{
  const storage=createStorage(new IDBFactory());
  await storage.saveSession({videoId:'one',title:'第一首歌曲',updatedAt:10,start:20,activity:'sing'});
  await storage.saveTake(take('20','one'));await storage.saveTake(take('30','two'));
  await storage.saveBacking({key:'backing',videoId:'one',createdAt:25,blob:new Blob(['music'])});
  const rows=await storage.library();assert.deepEqual(rows.map(r=>r.videoId),['two','one']);
  const one=rows[1];assert.equal(one.title,'第一首歌曲');assert.equal(one.recordingBytes,5);assert.equal(one.backingBytes,5);assert.equal(one.start,20);assert.equal(one.activity,'sing');assert.equal(one.hasSession,true);
  assert(!JSON.stringify(rows).includes('blob'));(await storage.ready).close();
});
test('clearing accompaniment never deletes recordings or progress; recordings can be cleared per video',async()=>{
  const storage=createStorage(new IDBFactory());
  await storage.saveSession({videoId:'one',title:'Keep progress'});
  await storage.saveTake(take('1','one'));await storage.saveTake(take('2','two'));
  for(const videoId of ['one','two'])await storage.saveBacking({key:videoId,videoId,createdAt:1,blob:new Blob(['music'])});
  await storage.clearMedia('backings','one');assert.equal((await storage.listBackings('one')).length,0);assert.equal((await storage.listBackings('two')).length,1);assert.equal((await storage.listTakes('one')).length,1);
  await storage.clearMedia('recordings','one');assert.equal((await storage.listTakes('one')).length,0);assert.equal((await storage.listTakes('two')).length,1);assert.equal((await storage.getSession('one')).title,'Keep progress');
  await storage.clearMedia('backings');assert.equal((await storage.listBackings('two')).length,0);
  await assert.rejects(storage.clearMedia('sessions'),/无效/);(await storage.ready).close();
});

test('subtitle editor drafts persist independently from progress saves and never rewrite recording data',async()=>{
  const factory=new IDBFactory(),storage=createStorage(factory);
  await storage.saveTake(take('1'));await storage.saveSession({videoId:'video',start:1,end:3,cues:[{start:1,end:3,text:'Original'}]});
  const draft={videoId:'video',draft:{cues:[{start:2,end:4,text:'Edited draft'}],original:[{start:1,end:3,text:'Original'}]}};
  await storage.saveCaptionDraft(draft);await storage.saveSession({videoId:'video',start:2,end:4,cues:[]});
  assert.deepEqual(await storage.getCaptionDraft('video'),draft);assert.equal((await storage.listTakes('video'))[0].start,1);assert.equal(await storage.getCaptionDraft('another'),undefined);
  (await storage.ready).close();const restored=createStorage(factory);assert.deepEqual(await restored.getCaptionDraft('video'),draft);(await restored.ready).close();
});


test('snapshot scopes every store to one video and can omit accompaniment records',async()=>{
  const storage=createStorage(new IDBFactory());
  for(const videoId of ['one','two']){
    await storage.saveSession({videoId,title:videoId});await storage.setFavorite({videoId});
    await storage.saveTake(take(videoId,videoId));await storage.saveBacking({key:videoId,videoId,createdAt:1,blob:new Blob(['music'])});
  }
  const scoped=await storage.snapshot('one');for(const rows of Object.values(scoped)){assert.equal(rows.length,1);assert.equal(rows[0].videoId,'one');}
  const without=await storage.snapshot('two',false);assert.equal(without.backings.length,0);assert.equal(without.recordings.length,1);
  const all=await storage.snapshot(null,false);assert.equal(all.sessions.length,2);assert.equal(all.backings.length,0);
  const absent=await storage.snapshot('absent');assert.ok(Object.values(absent).every(rows=>rows.length===0));
  (await storage.ready).close();
});


test('starred takes survive rolling retention, can be unstarred, and keep their audio and effects',async()=>{
  const factory=new IDBFactory(),storage=createStorage(factory);
  await storage.saveTake({...take('1'),effects:{delayMs:20}});
  const starred=await storage.updateTakeStarred('1',true);
  assert.equal(starred.starred,true);
  assert.deepEqual(starred.effects,{delayMs:20});
  assert.equal(await starred.blob.text(),'audio');
  for(const id of ['2','3','4'])await storage.saveTake(take(id),{maxTakes:1});
  assert.deepEqual((await storage.listTakes('video')).map(t=>t.id),['4','1']);
  (await storage.ready).close();
  const reopened=createStorage(factory);
  assert.equal((await reopened.listTakes('video')).find(t=>t.id==='1').starred,true);
  await reopened.updateTakeStarred('1',false);
  assert.equal((await reopened.listTakes('video')).length,2);
  await reopened.saveTake(take('5'),{maxTakes:1});
  assert.deepEqual((await reopened.listTakes('video')).map(t=>t.id),['5']);
  assert.equal(await reopened.updateTakeStarred('missing',true),null);
  (await reopened.ready).close();
});
