(function(root){
  const engine=typeof module!=='undefined'?require('./vendor/soundtouch.js'):root.EchoSoundTouch;
  const audio=typeof module!=='undefined'?require('./vocal-effects.js'):root.EchoVocalEffects;
  const cache=new WeakMap();
  function normalize(value){
    const number=Number(value);
    return Number.isFinite(number)?Math.max(-6,Math.min(6,Math.round(number))):0;
  }
  const label=value=>{const key=normalize(value);return key===0?'原调':`${key>0?'+':''}${key} 半音`;};
  async function shiftBuffer(buffer,value,{active=()=>true}={},env=root){
    const semitones=normalize(value);
    if(!active())throw Error('已取消伴奏升降调。');
    if(!semitones)return buffer;
    const sound=new engine.SoundTouch();
    sound.stretch.setParameters(buffer.sampleRate,0,0,0);
    sound.pitchSemitones=semitones;
    const left=buffer.getChannelData(0),right=buffer.getChannelData(Math.min(1,buffer.numberOfChannels-1));
    // Flush the overlap/seek windows with silence instead of losing the final samples.
    const paddedLength=buffer.length+Math.ceil(buffer.sampleRate*0.5)+32768;
    const source={extract(target,count,position){
      const available=Math.max(0,Math.min(count,paddedLength-position));
      for(let i=0;i<available;i++){
        target[i*2]=left[position+i] || 0;
        target[i*2+1]=right[position+i] || 0;
      }
      return available;
    }};
    const filter=new engine.SimpleFilter(source,sound);
    const channels=[new Float32Array(buffer.length),new Float32Array(buffer.length)];
    const block=new Float32Array(8192);
    const scheduler=audio.createScheduler(env);let blocks=0;
    try{
      for(let position=0;position<buffer.length;){
        if(!active())throw Error('已取消伴奏升降调。');
        const count=Math.min(4096,buffer.length-position);
        const extracted=filter.extract(block,count);
        if(!extracted)break;
        for(let i=0;i<extracted;i++){
          channels[0][position+i]=block[i*2];channels[1][position+i]=block[i*2+1];
        }
        position+=extracted;
        if(++blocks%8===0)await scheduler.pause();
      }
      if(!active())throw Error('已取消伴奏升降调。');
      return {length:buffer.length,duration:buffer.length/buffer.sampleRate,sampleRate:buffer.sampleRate,numberOfChannels:2,getChannelData:channel=>channels[channel]};
    }finally{scheduler.dispose();sound.clear();}
  }
  async function shiftBlob(blob,value,{active=()=>true}={},env=root){
    const semitones=normalize(value);
    if(!active())throw Error('已取消伴奏升降调。');
    if(!semitones)return blob;
    const previous=cache.get(blob);
    if(previous?.semitones===semitones)return previous.blob;
    const context=new env.AudioContext();
    try{
      const decoded=await context.decodeAudioData(await blob.arrayBuffer());
      const shifted=await shiftBuffer(decoded,semitones,{active},env);
      if(!active())throw Error('已取消伴奏升降调。');
      const result=await audio.wavAsync(shifted,{active},env);
      cache.set(blob,{semitones,blob:result});
      return result;
    }finally{await context.close().catch(()=>{});}
  }
  const api={normalize,label,shiftBuffer,shiftBlob};
  if(typeof module!=='undefined')module.exports=api;else root.EchoBackingPitch=api;
})(globalThis);
