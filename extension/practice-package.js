// Versioned binary container: bounded JSON metadata followed by unchanged audio
// blobs. Slicing files avoids base64 expansion and decoding audio during import.
(function(root){
  const MAGIC='ECHOPACK1\n',HEADER_LIMIT=16*1024*1024,RECORD_LIMIT=50000;
  const fields={
    sessions:'vocalReverb monitorReverb videoId title clipRangeAdjusted qualityPreferences modelPreferences scopes speechScope karaokeScope assemblyChoices assemblyChoicesByActivity loopCount prepSeconds autoNext leadInMode leadInSeconds activity paragraphFirst paragraphLast useBacking backingPreferences recordingPlaybackPreferences captionSource captionSourceName loadedCaptionSource replayVocalVolume replayBackingVolume replayWithBacking backingPitch backingVolume contentLanguage captionLayout cues index start end speed showChinese hideText followCaptions selectedTakeId updatedAt',
    recordings:'id videoId cueKey label start end speed createdAt starred capture kind referenceSource autoGainControl inputGainDb recordingInfo effects vocalOffset capturedEnd backingPitch backingKey backingModel backingQuality withBacking',
    backings:'key videoId model quality start end createdAt',
    favorites:'videoId title createdAt'
  };
  const fail=()=>{throw Error('练习包格式不完整或版本不受支持，请重新导出。');};
  function clean(name,value){
    const result={};for(const key of fields[name].split(' '))if(value[key]!==undefined)result[key]=value[key];
    // Older packages may contain a numeric string; domain playback/export rules
    // require a number, so normalize once at the import/export boundary.
    if(name==='recordings' && typeof value.speed==='string')result.speed=Number(value.speed);
    return result;
  }
  function validate(data){
    if(!data || typeof data!=='object')fail();
    let count=0;
    for(const name of Object.keys(fields)){
      if(!Array.isArray(data[name]) || (count+=data[name].length)>RECORD_LIMIT)fail();
      const keys=new Set();
      for(const value of data[name]){
        if(!value || typeof value!=='object' || typeof value.videoId!=='string' || !/^[\w-]{1,100}$/.test(value.videoId))fail();
        const id=name==='recordings'?value.id:name==='backings'?value.key:value.videoId;
        if(typeof id!=='string' || !id.length || id.length>1000 || keys.has(id))fail();keys.add(id);
        if(value.backingPitch!==undefined && (!Number.isInteger(value.backingPitch) || Math.abs(value.backingPitch)>6))fail();
        if(value.title!==undefined && (typeof value.title!=='string' || value.title.length>10000))fail();
        if(['recordings','backings'].includes(name)){
          if(!(value.blob instanceof Blob) || !value.blob.size || !Number.isFinite(value.start) || !Number.isFinite(value.end) || value.start<0 || value.end<=value.start || !Number.isFinite(value.createdAt))fail();
          if(name==='recordings'){
            if(typeof value.cueKey!=='string' || !['number','string'].includes(typeof value.speed) || !Number.isFinite(Number(value.speed)) || Number(value.speed)<=0)fail();
            if(value.vocalOffset!==undefined && (!Number.isFinite(value.vocalOffset) || value.vocalOffset<0))fail();
            if(value.capturedEnd!==undefined && (!Number.isFinite(value.capturedEnd) || value.capturedEnd<value.start || value.capturedEnd>value.end+0.001))fail();
          }
        }
        if(name==='sessions'){
          if(value.start!==undefined && (!Number.isFinite(value.start) || value.start<0))fail();
          if(value.end!==undefined && (!Number.isFinite(value.end) || value.end<=value.start))fail();
          if(value.cues!==undefined && (!Array.isArray(value.cues) || value.cues.length>20000 || value.cues.some(c=>!c || !Number.isFinite(c.start) || !Number.isFinite(c.end) || c.start<0 || c.end<c.start || typeof c.text!=='string')))fail();
        }
      }
    }
    return data;
  }
  function encode(snapshot){
    validate(snapshot);
    const data={},audio=[];let offset=0;
    for(const name of Object.keys(fields))data[name]=snapshot[name].map(value=>{
      const record=clean(name,value);
      if(value.blob){record.audio={offset,size:value.blob.size,type:value.blob.type};audio.push(value.blob);offset+=value.blob.size;}
      return record;
    });
    const json=new TextEncoder().encode(JSON.stringify({format:'echo',version:1,createdAt:Date.now(),data}));
    if(json.length>HEADER_LIMIT)throw Error('练习数据太多，请按视频分别导出。');
    const length=new Uint8Array(4);new DataView(length.buffer).setUint32(0,json.length,true);
    return new Blob([MAGIC,length,json,...audio],{type:'application/octet-stream'});
  }
  async function decode(file){
    if(!file || file.size<MAGIC.length+4 || await file.slice(0,MAGIC.length).text()!==MAGIC)fail();
    const length=new DataView(await file.slice(MAGIC.length,MAGIC.length+4).arrayBuffer()).getUint32(0,true),start=MAGIC.length+4+length;
    if(length>HEADER_LIMIT || start>file.size)fail();
    let header;try{header=JSON.parse(await file.slice(MAGIC.length+4,start).text());}catch{fail();}
    if(!header || typeof header!=='object' || header.format!=='echo' || header.version!==1 || !header.data)fail();
    const data={};let offset=0,count=0;
    for(const name of Object.keys(fields)){
      if(!Array.isArray(header.data[name]) || (count+=header.data[name].length)>RECORD_LIMIT)fail();
      data[name]=header.data[name].map(value=>{
        if(!value || typeof value!=='object')fail();
        const record=clean(name,value);
        if(['recordings','backings'].includes(name)){
          const a=value.audio;if(!a || a.offset!==offset || !Number.isSafeInteger(a.size) || a.size<=0 || typeof a.type!=='string' || a.type.length>200 || start+offset+a.size>file.size)fail();
          record.blob=file.slice(start+offset,start+offset+a.size,a.type);offset+=a.size;
        }
        return record;
      });
    }
    if(start+offset!==file.size)fail();
    return validate(data);
  }
  const api={encode,decode,validate};if(typeof module!=='undefined')module.exports=api;else root.EchoPracticePackage=api;
})(globalThis);
