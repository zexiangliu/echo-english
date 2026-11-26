// Practice domain rules. No DOM, media control, persistence or implicit edits.
(function(root) {
  const MAX_SECONDS = 600;
  const validScope = value => ['whole', 'clip', 'paragraph'].includes(value);

  function restoreScopes(session = {}) {
    return {
      speech: validScope(session.scopes?.speech) ? session.scopes.speech : validScope(session.speechScope) ? session.speechScope : 'clip',
      sing: validScope(session.scopes?.sing) ? session.scopes.sing : validScope(session.karaokeScope) ? session.karaokeScope : 'whole'
    };
  }

  // Kept byte-for-byte compatible with existing recording buckets and captions.
  function cueKey(cue, start, end) {
    return cue ? (cue.key || `cue:${Number(cue.start).toFixed(3)}:${cue.text}`) : `manual:${Number(start).toFixed(2)}:${Number(end).toFixed(2)}`;
  }

  // Caption display durations may overlap the following spoken line. Only
  // shorten the default selection; an explicitly adjusted range remains owned
  // by the learner. Equal-start captions do not create zero-length clips.
  function clipRange(cues,index,start,end) {
    const cue=cues[index];
    if(!cue || Math.abs(start-cue.start)>0.011 || Math.abs(end-cue.end)>0.011)return {start,end};
    const next=cues.slice(index+1).find(c=>c.start>cue.start);
    return {start,end:next?Math.min(end,next.start):end};
  }

  function paragraphRange(cues, first, last) {
    if (!Number.isInteger(first) || !Number.isInteger(last) || first < 0 || last >= cues.length || last <= first) throw Error('请选择至少两句连续字幕作为段落。');
    const start = cues[first].start, end = Math.max(...cues.slice(first, last + 1).map(cue => cue.end));
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start) throw Error('所选段落缺少有效时间轴，请重新读取或导入字幕。');
    return {start, end};
  }

  function resolve({activity = 'speech', scope = 'clip', start, end, speed, duration, cues = [], index = -1, first = 0, last = 1}) {
    if (!validScope(scope)) throw Error('请选择有效的练习范围。');
    if (!Number.isFinite(duration) || duration <= 0) throw Error('请等待视频加载，直播暂不支持。');
    if (!Number.isFinite(speed) || speed <= 0) throw Error('请选择有效的播放速度。');
    if (scope === 'whole') {
      if (duration > MAX_SECONDS) throw Error('视频超过 10 分钟，请选择「当前片段」或「段落（多句）」。');
      start = 0;
      end = duration;
    } else if (scope === 'paragraph') {
      ({start, end} = paragraphRange(cues, first, last));
    }
    if (![start, end].every(Number.isFinite) || start < 0 || end <= start || end > duration + 0.1) throw Error('请设置有效起止时间，终点需在视频时长内。');
    if (end - start > MAX_SECONDS) throw Error('每个练习片段最长 10 分钟，请缩短片段。');

    const selected = cues[index];
    // Timing adjustments remain versions of the selected sentence. Choosing
    // a custom range explicitly clears index in the coordinator.
    const cue = scope === 'clip' ? selected : null;
    const key = cueKey(cue, start, end);
    const label = scope === 'whole' ? (activity === 'sing' ? '整首演唱' : '整段配音')
      : scope === 'paragraph' ? `第 ${first + 1}–${last + 1} 句 · 段落`
      : cue ? `第 ${index + 1} 句` : '手动片段';
    return {range: {start, end, speed}, key: activity === 'sing' ? `song:${key}` : key, label};
  }

  function versions(takes,key){return takes.filter(t=>t.cueKey===key).sort((a,b)=>a.createdAt-b.createdAt || a.id.localeCompare(b.id));}

  const api = {MAX_SECONDS, restoreScopes, cueKey, clipRange, paragraphRange, resolve, versions};
  if (typeof module !== 'undefined') module.exports = api;
  else root.EchoSelection = api;
})(globalThis);
