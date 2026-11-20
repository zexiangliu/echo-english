(function(root) {
  const MAX_TAKES = 3;
  function takeLimit(value){
    return (typeof value==='number' || typeof value==='string' && value.trim()!=='') && Number.isInteger(Number(value)) && Number(value)>=0 && Number(value)<=100?Number(value):MAX_TAKES;
  }
  const {cueKey} = typeof module !== 'undefined' ? require('./selection.js') : root.EchoSelection;
  function createStorage(factory = root.indexedDB, name = 'echo-dubbing-v1') {
    const ready = new Promise((resolve,reject) => {
      const request = factory.open(name,6);
      request.onupgradeneeded = () => {
        const db = request.result, tx = request.transaction;
        if (!db.objectStoreNames.contains('captionDrafts')) db.createObjectStore('captionDrafts',{keyPath:'videoId'});
        if (!db.objectStoreNames.contains('sessions')) db.createObjectStore('sessions',{keyPath:'videoId'});
        if (!db.objectStoreNames.contains('favorites')) db.createObjectStore('favorites',{keyPath:'videoId'});
        if (!db.objectStoreNames.contains('backings')) {
          const backings=db.createObjectStore('backings',{keyPath:'key'});
          backings.createIndex('videoId','videoId');
        }
        const recordings = db.objectStoreNames.contains('recordings') ? tx.objectStore('recordings') : db.createObjectStore('recordings',{keyPath:'id'});
        if (!recordings.indexNames.contains('videoId')) recordings.createIndex('videoId','videoId');
        if (!recordings.indexNames.contains('segment')) recordings.createIndex('segment',['videoId','cueKey']);
        // Older song takes shared the manual dubbing version bucket.
        recordings.openCursor().onsuccess=event=>{
          const cursor=event.target.result;if(!cursor)return;
          const value=cursor.value;
          if(value.kind==='song' && !value.cueKey?.startsWith('song:'))cursor.update({...value,cueKey:`song:${value.cueKey || cueKey(null,value.start,value.end)}`});
          cursor.continue();
        };
        if (db.objectStoreNames.contains('takes')) {
          // Move v1's most recent take rather than discarding it or retaining a
          // second copy of its audio in the legacy store.
          const old = tx.objectStore('takes');
          old.openCursor().onsuccess = event => {
            const cursor = event.target.result;
            if (!cursor) return;
            const value = cursor.value;
            recordings.put({...value,id:`legacy:${value.videoId}`,cueKey:cueKey(null,value.start,value.end),label:'旧版录音'});
            cursor.delete(); cursor.continue();
          };
        }
      };
      request.onsuccess = () => { const db=request.result; db.onversionchange=()=>db.close(); resolve(db); };
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(Error('本地数据库正在升级，请关闭其他 YouTube 标签页后刷新。'));
    });
    ready.catch(()=>{});
    async function transaction(stores, mode, work) {
      const db = await ready;
      return new Promise((resolve,reject) => {
        const tx=db.transaction(stores,mode); let result,failure;
        const abort=error=>{failure=error;tx.abort();};
        tx.oncomplete=()=>resolve(result);tx.onabort=()=>reject(failure || tx.error || Error('本地保存已取消。'));
        try { work(tx,value=>{result=value;},abort); } catch(e) { abort(e); }
      });
    }
    return {
      ready,
      saveCaptionDraft(value) { return transaction(['captionDrafts'],'readwrite',tx=>tx.objectStore('captionDrafts').put(value)); },
      getCaptionDraft(videoId) { return transaction(['captionDrafts'],'readonly',(tx,set)=>{tx.objectStore('captionDrafts').get(videoId).onsuccess=e=>set(e.target.result);}); },
      saveSession(value) { return transaction(['sessions'],'readwrite',tx=>tx.objectStore('sessions').put(value)); },
      getSession(videoId) { return transaction(['sessions'],'readonly',(tx,set)=>{tx.objectStore('sessions').get(videoId).onsuccess=e=>set(e.target.result);}); },
      listBackings(videoId) { return transaction(['backings'],'readonly',(tx,set)=>{tx.objectStore('backings').index('videoId').getAll(videoId).onsuccess=e=>set(e.target.result.sort((a,b)=>b.createdAt-a.createdAt));}); },
      saveBacking(value) { return transaction(['backings'],'readwrite',tx=>{
        const store=tx.objectStore('backings');store.put(value);
        store.getAll().onsuccess=e=>{for(const old of e.target.result.filter(v=>!v.imported).sort((a,b)=>b.createdAt-a.createdAt).slice(8))store.delete(old.key);};
      }); },
      listTakes(videoId) { return transaction(['recordings'],'readonly',(tx,set)=>{tx.objectStore('recordings').index('videoId').getAll(videoId).onsuccess=e=>set(e.target.result.sort((a,b)=>b.createdAt-a.createdAt || b.id.localeCompare(a.id)));}); },
      saveTake(value,{maxTakes=MAX_TAKES}={}) {
        const limit=takeLimit(maxTakes);
        return transaction(['recordings'],'readwrite',(tx,set)=>{
          const store=tx.objectStore('recordings'); store.put(value);
          store.index('segment').getAll([value.videoId,value.cueKey]).onsuccess=e=>{
            const takes=e.target.result.sort((a,b)=>b.createdAt-a.createdAt || b.id.localeCompare(a.id));
            const expired=limit===0?[]:takes.filter(t=>!t.imported && !t.starred).slice(limit);
            for (const old of expired) store.delete(old.id);
            set(takes.filter(t=>!expired.includes(t)));
          };
        });
      },
      updateTakeStarred(id, starred) {
        return transaction(['recordings'],'readwrite',(tx,set)=>{
          const store=tx.objectStore('recordings');
          store.get(id).onsuccess=event=>{
            const take=event.target.result;
            if(!take){set(null);return;}
            const updated={...take,starred:!!starred};store.put(updated);set(updated);
          };
        });
      },
      updateTakeEffects(id, effects) {
        return transaction(['recordings'],'readwrite',(tx,set)=>{
          const store=tx.objectStore('recordings');
          store.get(id).onsuccess=event=>{
            const take=event.target.result;
            if(!take || take.capture!=='vocal' || take.withBacking){set(null);return;}
            const updated={...take,effects};store.put(updated);set(updated);
          };
        });
      },
      deleteTake(id) { return transaction(['recordings'],'readwrite',tx=>tx.objectStore('recordings').delete(id)); },
      setFavorite(value) { return transaction(['favorites'],'readwrite',tx=>tx.objectStore('favorites').put(value)); },
      deleteFavorite(videoId) { return transaction(['favorites'],'readwrite',tx=>tx.objectStore('favorites').delete(videoId)); },
      getFavorite(videoId) { return transaction(['favorites'],'readonly',(tx,set)=>{tx.objectStore('favorites').get(videoId).onsuccess=e=>set(e.target.result);}); },
      snapshot(videoId=null,includeBackings=true) { return transaction(['sessions','recordings','backings','favorites'],'readonly',(tx,set)=>{
        const result={sessions:[],recordings:[],backings:[],favorites:[]};set(result);
        for(const name of Object.keys(result)){
          if(name==='backings' && !includeBackings)continue;
          const store=tx.objectStore(name);
          const request=videoId===null?store.getAll():['sessions','favorites'].includes(name)?store.get(videoId):store.index('videoId').getAll(videoId);
          request.onsuccess=e=>{const value=e.target.result;result[name]=Array.isArray(value)?value:value?[value]:[];};
        }
      }); },
      // Import is one atomic merge. Existing media is never overwritten and
      // imported audio is exempt from automatic rolling-cache eviction.
      importSnapshot(data,replaceProgress=false) { return transaction(['sessions','recordings','backings','favorites'],'readwrite',(tx,set,abort)=>{
        const counts={added:0,skipped:0};set(counts);
        for(const name of ['sessions','recordings','backings','favorites']){
          const store=tx.objectStore(name),key=name==='recordings'?'id':name==='backings'?'key':'videoId';
          for(const value of data[name])store.get(value[key]).onsuccess=e=>{
            try{
              if(e.target.result && !(name==='sessions' && replaceProgress)){counts.skipped++;return;}
              store.put(['recordings','backings'].includes(name)?{...value,imported:true}:value);counts.added++;
            }catch(error){abort(error);}
          };
        }
      }); },
      library() { return transaction(['sessions','recordings','backings','favorites'],'readonly',(tx,set)=>{
        const videos=new Map();let remaining=4;set([]);
        const item=id=>{if(!videos.has(id))videos.set(id,{videoId:id,title:'',updatedAt:0,recordings:0,recordingBytes:0,backings:0,backingBytes:0,start:0,activity:'speech'});return videos.get(id);};
        for(const name of ['sessions','recordings','backings','favorites']){
          tx.objectStore(name).openCursor().onsuccess=event=>{
            const cursor=event.target.result;
            if(!cursor){if(--remaining===0)set([...videos.values()].sort((a,b)=>b.updatedAt-a.updatedAt));return;}
            const value=cursor.value,row=item(value.videoId);
            if(name==='favorites'){row.favorite=true;if(!row.title)row.title=value.title || '';}
            else if(name==='sessions'){row.title=value.title || '';row.start=value.start || 0;row.activity=value.activity || 'speech';row.hasSession=true;}
            else if(name==='recordings'){row.recordings++;row.recordingBytes+=value.blob?.size || 0;}
            else {row.backings++;row.backingBytes+=value.blob?.size || 0;}
            row.updatedAt=Math.max(row.updatedAt,Number(value.updatedAt || value.createdAt)||0);
            cursor.continue();
          };
        }
      }); },
      clearMedia(kind,videoId=null) {
        if(!['recordings','backings'].includes(kind))return Promise.reject(Error('无效的清理类型。'));
        return transaction([kind],'readwrite',tx=>{
          const store=tx.objectStore(kind);
          if(videoId===null){store.clear();return;}
          store.index('videoId').getAllKeys(videoId).onsuccess=event=>{for(const key of event.target.result)store.delete(key);};
        });
      }
    };
  }
  const api={createStorage,cueKey,MAX_TAKES,takeLimit};
  if (typeof module !== 'undefined') module.exports=api; else root.EchoStorage=api;
})(globalThis);
