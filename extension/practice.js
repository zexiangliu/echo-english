(function(root) {
  const SPEEDS=Object.freeze([0.5,0.6,0.7,0.75,0.8,0.9,1,1.1,1.2,1.25,1.3,1.4,1.5]);
  function recordingRange(take){
    const end=Number.isFinite(take.capturedEnd)?Math.min(take.end,take.capturedEnd):take.end;
    return {start:take.start,end,speed:take.speed};
  }
  function isLyricCue(cue){
    if(!Number.isFinite(cue?.start) || !Number.isFinite(cue?.end) || cue.end<=cue.start)return false;
    const text=String(cue.text || '').trim().replace(/^[\[（(【]+|[\]）)】]+$/g,'').trim();
    return !!text && !/^[\s♪♫♬♩🎵🎶.·…_–—-]+$/u.test(text) && !/^(music|instrumental|intro|interlude|outro|silence|applause|音乐|音樂|纯音乐|純音樂|伴奏|前奏|间奏|間奏|尾奏|音楽|演奏|간주|전주|후주)$/i.test(text);
  }
  function lyricSkip(cues,time,range){
    let next=null,keep=false,active=false;
    for(const cue of cues){
      if(!isLyricCue(cue) || cue.end<=range.start || cue.start>=range.end)continue;
      if(cue.start<time && cue.end>range.start)keep=true;
      if(cue.start<=time+.05 && cue.end>time+.05)active=true;
      if(cue.start>time+.05 && (!next || cue.start<next.start))next=cue;
    }
    return {target:active?null:next,keep,reason:active?'当前仍在歌词区间，间奏时可跳转。':next?'按字幕跳到下一句；已录人声按原时间轴分段保存。':'当前练习范围内没有后续歌词；需要准确的时间轴字幕。'};
  }
  function splitCaption(text) {
    // Keep the original available: script-based separation is a display aid,
    // not translation or linguistic sentence alignment.
    const chinese = [];
    const english = String(text || '').replace(/\p{Script=Han}[^A-Za-z]*/gu, chunk => { chinese.push(chunk.trim()); return ' '; }).replace(/\s+/g,' ').trim();
    return { english, chinese:chinese.join(' '), original:String(text || '') };
  }
  // Captions follow media time independently of the selected recording range.
  function captionFrame(cues, time) {
    if(!cues.length || !Number.isFinite(time))return {index:-1,phase:'empty'};
    let low=0,high=cues.length;
    while(low<high){const mid=(low+high)>>>1;if(cues[mid].start<=time)low=mid+1;else high=mid;}
    const previous=low-1;
    if(previous>=0 && time<cues[previous].end)return {index:previous,phase:'active'};
    if(low<cues.length)return {index:low,phase:'upcoming'};
    return {index:cues.length-1,phase:'ended'};
  }
  function nudge(start, end, edge, delta, duration) {
    if (![start,end,delta,duration].every(Number.isFinite) || start < 0 || end <= start || end > duration) throw Error('请先设置有效片段，再微调边界。');
    if (edge === 'start') start = Math.max(0, Math.min(end - .1, start + delta));
    else if (edge === 'end') end = Math.min(duration, Math.max(start + .1, end + delta));
    else throw Error('未知边界。');
    return { start:Math.round(start*100)/100, end:Math.round(end*100)/100 };
  }
  async function runLoop({ count, active, listen, gap }) {
    for (let round = 0; active() && (count === 0 || round < count); round++) {
      await listen(round + 1);
      if (!active()) return;
      if (count === 0 || round + 1 < count) await gap();
    }
  }
  async function runPractice({ active, listen, prepare, record, replay, advance }) {
    while (active()) {
      await listen(); if (!active()) return;
      await prepare(); if (!active()) return;
      const recorded = await record(); if (!active() || !recorded) return;
      await replay(); if (!active()) return;
      if (!advance()) return;
    }
  }
  function leadInSeconds(value){const n=Number(value);return Number.isFinite(n)?Math.max(0,Math.min(30,Math.round(n))):0;}
  function leadInStart(start,seconds,{mode='seconds',cues=[]}={}){
    if(mode==='none')return start;
    if(mode==='previous'){
      const ordered=cues.filter(c=>Number.isFinite(c.start) && Number.isFinite(c.end) && c.end>c.start).sort((a,b)=>a.start-b.start);
      const current=ordered.findIndex(c=>c.end>start+0.001);
      const previous=current<0?ordered.at(-1):ordered[current-1];
      return previous && previous.start<start?Math.max(0,previous.start):start;
    }
    return Math.max(0,start-leadInSeconds(seconds));
  }
  const {paragraphRange} = typeof module !== 'undefined' ? require('./selection.js') : root.EchoSelection;
  function playbackTimeout(range) {return Math.ceil((range.end-range.start)/range.speed*1000)+15000;}
  function recordingQueue(takes) {
    const latest=new Map();
    for(const take of takes) {
      if(!Number.isFinite(take.start) || !Number.isFinite(take.end) || take.end<=take.start)continue;
      const key=take.cueKey || `manual:${take.start}:${take.end}`;
      const previous=latest.get(key);
      if(!previous || take.createdAt>previous.createdAt || (take.createdAt===previous.createdAt && take.id.localeCompare(previous.id)>0))latest.set(key,take);
    }
    return [...latest.values()].sort((a,b)=>a.start-b.start || a.end-b.end || a.id.localeCompare(b.id));
  }
  async function playQueue({queue,active,play}) {
    for(let i=0;i<queue.length && active();i++)await play(queue[i],i,queue.length);
  }
  const api = {SPEEDS,recordingRange,isLyricCue,lyricSkip,paragraphRange,leadInSeconds,leadInStart,splitCaption,captionFrame,nudge,runLoop,runPractice,recordingQueue,playQueue,playbackTimeout};
  if (typeof module !== 'undefined') module.exports = api; else root.EchoPractice = api;
})(globalThis);
