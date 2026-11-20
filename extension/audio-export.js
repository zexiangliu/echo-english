(function(root){
  const effects = typeof module !== 'undefined' ? require('./vocal-effects.js') : root.EchoVocalEffects;
  const pitch = typeof module !== 'undefined' ? require('./backing-pitch.js') : root.EchoBackingPitch;
  // Local assembly edits are separate from a recording's reusable effects.
  function segmentAdjustment(value={}){
    const bounded=(key,fallback,min,max)=>Number.isFinite(value?.[key])?Math.max(min,Math.min(max,value[key])):fallback;
    return {delayMs:Math.round(bounded('delayMs',0,-2000,2000)),volume:bounded('volume',1,0,2),fadeInSeconds:bounded('fadeInSeconds',0,0,3),fadeOutSeconds:bounded('fadeOutSeconds',0,0,3)};
  }
  function adjusted(value){const a=segmentAdjustment(value);return !!(a.delayMs || a.volume!==1 || a.fadeInSeconds || a.fadeOutSeconds);}
  function filename({title,videoId,start,end,kind='recording',assembled=false,partial=false,activity='sing',extension='webm'}){
    const clean=value=>String(value || '').normalize('NFC').replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').replace(/^[. ]+|[. ]+$/g,'');
    let name=clean(title) || clean(`YouTube-${videoId || '录音'}`);
    // Bound UTF-8 bytes as well as characters for macOS/Linux file systems.
    let bytes=0,short='';const encoder=new TextEncoder();
    for(const character of name){const size=encoder.encode(character).length;if(bytes+size>160)break;short+=character;bytes+=size;}
    name=short.trim().replace(/[. ]+$/g,'');
    const time=value=>{const tenths=Math.round(Math.max(0,value)*10),minutes=Math.floor(tenths/600),seconds=((tenths%600)/10).toFixed(1).padStart(4,'0');return `${String(minutes).padStart(2,'0')}m${seconds}s`;};
    const range=Number.isFinite(start) && Number.isFinite(end)?`_${time(start)}-${time(end)}`:'';
    const type=({subtitles:'字幕',vocals:'人声',mixed:'人声+伴奏',background:'人声+背景音',dubbing:'配音',recording:'录音'})[kind] || '录音';
    return `${name}${range}${assembled?(partial?'_片段合成':activity==='speech'?'_整段合成':'_整首合成'):''}_${type}.${['wav','srt','vtt'].includes(extension)?extension:'webm'}`;
  }
  function plan(takes,duration){
    if(!Number.isFinite(duration) || duration<=0 || duration>600)throw Error('合成范围需在 10 分钟内。');
    const latest=new Map();
    for(const take of takes.filter(t=>t.capture==='vocal' && !t.withBacking)){
      const key=take.cueKey || `${take.start}:${take.end}`,previous=latest.get(key);
      if(!previous || take.createdAt>previous.createdAt || take.createdAt===previous.createdAt && take.id.localeCompare(previous.id)>0)latest.set(key,take);
    }
    const voices=[...latest.values()];
    if(!voices.length)throw Error('还没有可合成的独立人声。旧版混合录音无法单独提取人声，请重新录音。');
    const ranges=voices.map(t=>({take:t,start:Math.max(0,t.start),end:Math.min(duration,t.end,Number.isFinite(t.capturedEnd)?t.capturedEnd:t.end)})).filter(t=>t.end>t.start);
    const points=[...new Set([0,duration,...ranges.flatMap(t=>[t.start,t.end]).filter(t=>t>=0 && t<=duration)])].sort((a,b)=>a-b);
    const segments=[],gaps=[];
    for(let i=0;i<points.length-1;i++){
      const start=points[i],end=points[i+1];
      const chosen=ranges.filter(t=>t.start<=start && t.end>=end).sort((a,b)=>b.take.createdAt-a.take.createdAt || b.take.id.localeCompare(a.take.id))[0];
      const target=chosen?segments:gaps,last=target.at(-1);
      if(last && last.end===start && (!chosen || last.take.id===chosen.take.id))last.end=end;
      else target.push({start,end,...(chosen?{take:chosen.take}:{})});
    }
    if(segments.some(s=>s.take.speed!==1))throw Error('合成下载暂支持 1× 独立人声；其他速度仍可下载原始人声。');
    return {segments,gaps,duration};
  }
  function selectionPlan(takes,duration,selection){
    if(!Number.isFinite(duration) || duration<=0 || duration>600)throw Error('合成范围需在 10 分钟内。');
    if(!Array.isArray(selection))throw Error('拼接选择无效。');
    const available=new Map(takes.filter(t=>t.capture==='vocal' && !t.withBacking).map(t=>[t.id,t]));
    const segments=[],gaps=[];let end=0;
    for(const part of [...selection].sort((a,b)=>a.start-b.start)){
      if(!Number.isFinite(part.start) || !Number.isFinite(part.end) || part.start<0 || part.end>duration+0.0001 || part.end<=part.start)throw Error('拼接片段超出导出范围。');
      if(part.takeId===null)continue;
      const take=available.get(part.takeId);
      if(!take)throw Error('所选录音已不存在，请重新选择。');
      if(take.speed!==1)throw Error('合成下载暂支持 1× 录音。');
      const capturedEnd=Math.min(take.end,Number.isFinite(take.capturedEnd)?take.capturedEnd:take.end);
      if(part.start<Math.max(0,take.start)-0.0001 || part.end>capturedEnd+0.0001)throw Error('所选录音未覆盖该片段。');
      if(part.start<end-0.0001)throw Error('拼接片段不能重叠，请为每个时段选择一个版本。');
      if(part.start>end)gaps.push({start:end,end:part.start});
      const last=segments.at(-1);
      const local=adjusted(part.adjustment)?{adjustment:segmentAdjustment(part.adjustment),adjustmentStart:part.adjustmentStart ?? part.start,adjustmentEnd:part.adjustmentEnd ?? part.end}:null;
      if(local && (!Number.isFinite(local.adjustmentStart) || !Number.isFinite(local.adjustmentEnd) || local.adjustmentStart>part.start || local.adjustmentEnd<part.end || local.adjustmentEnd<=local.adjustmentStart))throw Error('段落微调范围无效。');
      if(!local && last && !last.adjustment && last.take.id===take.id && Math.abs(last.end-part.start)<0.0001)last.end=part.end;
      else segments.push({start:part.start,end:part.end,take,...local});
      end=part.end;
    }
    if(end<duration)gaps.push({start:end,end:duration});
    return {segments,gaps,duration};
  }
  function selectedPitch(segments){
    const keys=[...new Set(segments.map(segment=>pitch.normalize(segment.take.backingPitch)))];
    if(keys.length>1)throw Error(`所选录音调性不一致（${keys.map(pitch.label).join('、')}），请选择相同调性的版本后再合成；人声不会自动变调。`);
    return keys[0] ?? 0;
  }
  async function render({takes,duration,origin=0,selection=null,reverb={},backing=null,volume=1,vocalVolume=1,sampleRate=44100,active=()=>true},env=root){
    const shifted=takes.map(t=>({...t,start:t.start-origin,end:t.end-origin,...(Number.isFinite(t.capturedEnd)?{capturedEnd:t.capturedEnd-origin}:{})}));
    const timeline=selection===null?plan(shifted,duration):selectionPlan(shifted,duration,selection.map(s=>({...s,start:s.start-origin,end:s.end-origin,...(s.adjustment?{adjustmentStart:(s.adjustmentStart ?? s.start)-origin,adjustmentEnd:(s.adjustmentEnd ?? s.end)-origin}:{})})));
    if(backing && (backing.start>origin+0.001 || backing.end<origin+duration-0.001))throw Error('需要覆盖整个下载范围的伴奏，请先生成整首伴奏。');
    if(!timeline.segments.length)throw Error('此范围内没有已录人声。');
    const semitones=selectedPitch(timeline.segments);
    const last=timeline.segments.at(-1);
    // A take's fade belongs to its vocal stem. Only a fade at the actual export
    // endpoint may also fade the backing; an unrecorded outro must remain audible.
    const takeEnd=Math.min(last.take.end,last.take.capturedEnd ?? last.take.end);
    const finalFade=Math.abs(last.end-duration)<0.0001 && Math.abs(takeEnd-duration)<0.0001?effects.normalize(last.take.effects).fadeOutSeconds:0;
    const length=Math.ceil(duration*sampleRate),reverbSettings={...effects.normalize(reverb),delayMs:0};
    const context=new env.AudioContext({sampleRate});
    let vocalBuffer=null,channels;
    const check=()=>{if(!active())throw Error('已取消合成。');};
    const pause=()=>new Promise(resolve=>env.setTimeout(resolve,0));
    async function add(buffer,start,end,offset,gain,fadeEnd=0,fadeSeconds=0,local=null){
      const from=Math.round(start*sampleRate),to=Math.min(length,Math.round(end*sampleRate));
      const fadeIn=local?Math.min(local.end-local.start,local.fadeInSeconds):0,fadeOut=local?Math.min(local.end-local.start,local.fadeOutSeconds):0;
      for(let block=from;block<to;block+=262144){
        check();const stop=Math.min(to,block+262144);
        for(let c=0;c<2;c++){
          const data=buffer.getChannelData(Math.min(c,buffer.numberOfChannels-1));
          for(let i=block;i<stop;i++){
            const position=(offset+(i-from)/sampleRate)*buffer.sampleRate,index=Math.floor(position),fraction=position-index;
            const time=i/sampleRate;
            let envelope=fadeSeconds>0?effects.fadeGain(time,fadeEnd,fadeSeconds):1;
            if(local){
              if(fadeIn>0)envelope*=Math.max(0,Math.min(1,(time-local.start)/fadeIn));
              if(fadeOut>0)envelope*=Math.max(0,Math.min(1,(local.end-time)/fadeOut));
            }
            if(index>=0 && index<data.length)channels[c][i]+=((data[index] || 0)*(1-fraction)+(data[Math.min(index+1,data.length-1)] || 0)*fraction)*gain*envelope;
          }
        }
        await pause();
      }
    }
    try{
      // Assemble directly into the offline input to avoid copying a full 10-minute stem.
      vocalBuffer=effects.enabled(reverbSettings)?context.createBuffer(2,length,sampleRate):null;
      channels=vocalBuffer?[vocalBuffer.getChannelData(0),vocalBuffer.getChannelData(1)]:[new Float32Array(length),new Float32Array(length)];
      for(const take of new Map(timeline.segments.map(s=>[s.take.id,s.take])).values()){
        check();const decoded=await context.decodeAudioData(await take.blob.arrayBuffer());check();
        const settings=effects.normalize(take.effects),fadeEnd=Math.min(take.end,take.capturedEnd ?? take.end);
        const fadeSeconds=finalFade>0 && take.id===last.take.id?0:settings.fadeOutSeconds;
        for(const segment of timeline.segments.filter(s=>s.take.id===take.id)){
          const local=segmentAdjustment(segment.adjustment);
          await add(decoded,segment.start,segment.end,segment.start-take.start+(take.vocalOffset || 0)-(settings.delayMs+local.delayMs)/1000,Math.max(0,Math.min(2,vocalVolume))*local.volume,fadeEnd,fadeSeconds,segment.adjustment?{...local,start:segment.adjustmentStart,end:segment.adjustmentEnd}:null);
        }
      }
      if (vocalBuffer) {
        check();const processed=await effects.process(vocalBuffer,reverbSettings,env);check();
        channels=[processed.getChannelData(0),processed.getChannelData(1)];
      }
      if(backing){
        check();const original=await context.decodeAudioData(await backing.blob.arrayBuffer());check();
        const decoded=await pitch.shiftBuffer(original,semitones,{active},env);check();
        await add(decoded,0,duration,origin-backing.start,Math.max(0,Math.min(2,volume)));
      }
      check();
      if(finalFade>0)for(let i=0;i<length;i++){
        const gain=effects.fadeGain(i/sampleRate,duration,finalFade);
        channels[0][i]*=gain;channels[1][i]*=gain;
      }
      let peak=1;for(let i=0;i<length;i++)peak=Math.max(peak,Math.abs(channels[0][i]),Math.abs(channels[1][i]));
      const bytes=new ArrayBuffer(44+length*4),view=new DataView(bytes);
      const text=(at,value)=>{for(let i=0;i<value.length;i++)view.setUint8(at+i,value.charCodeAt(i));};
      text(0,'RIFF');view.setUint32(4,36+length*4,true);text(8,'WAVE');text(12,'fmt ');view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,2,true);view.setUint32(24,sampleRate,true);view.setUint32(28,sampleRate*4,true);view.setUint16(32,4,true);view.setUint16(34,16,true);text(36,'data');view.setUint32(40,length*4,true);
      for(let block=0;block<length;block+=262144){
        check();for(let i=block;i<Math.min(length,block+262144);i++)for(let c=0;c<2;c++){const n=channels[c][i]/peak;view.setInt16(44+(i*2+c)*2,Math.round(n*(n<0?32768:32767)),true);}
        await pause();
      }
      return {blob:new Blob([bytes],{type:'audio/wav'}),gaps:timeline.gaps};
    }finally{await context.close().catch(()=>{});}
  }
  const api={segmentAdjustment,adjusted,filename,plan,selectionPlan,selectedPitch,render};if(typeof module!=='undefined')module.exports=api;else root.EchoAudioExport=api;
})(globalThis);
