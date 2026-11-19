// Selection and preview for assembly. Original recordings are never modified.
(function(root){
  function buildRows(takes,duration,saved=[],api=root.EchoAudioExport){
    const voices=takes.filter(t=>t.kind==='song' && t.capture==='vocal' && !t.withBacking && t.speed===1);
    if(!voices.length)throw Error(takes.some(t=>t.kind==='song' && t.capture==='vocal' && !t.withBacking)?'请先录制 1× 独立人声，再选择片段合成。':'还没有可合成的独立人声。旧版混合录音无法单独提取人声，请重新录唱。');
    const automatic=api.plan(voices,duration);
    const ranges=voices.map(t=>({take:t,start:Math.max(0,t.start),end:Math.min(duration,t.end,Number.isFinite(t.capturedEnd)?t.capturedEnd:t.end)})).filter(r=>r.end>r.start);
    const points=[...new Set([0,duration,...ranges.flatMap(r=>[r.start,r.end])])].sort((a,b)=>a-b);
    const rows=[];
    for(let i=0;i<points.length-1;i++){
      const start=points[i],end=points[i+1];
      const candidates=ranges.filter(r=>r.start<=start && r.end>=end).map(r=>r.take).sort((a,b)=>b.createdAt-a.createdAt || b.id.localeCompare(a.id));
      const autoId=automatic.segments.find(s=>s.start<=start && s.end>=end)?.take.id || null;
      const previous=Array.isArray(saved)?saved.find(s=>s && Number.isFinite(s.start) && Number.isFinite(s.end) && s.start<=start && s.end>=end):null;
      const valid=previous && (previous.choice==='auto' && autoId || candidates.some(t=>t.id===previous.choice));
      rows.push({start,end,candidates,autoId,choice:valid?previous.choice:autoId?'auto':candidates[0]?.id || 'auto',enabled:previous?.enabled===false?false:valid?true:!!autoId});
    }
    return rows;
  }
  function selections(rows){return rows.map(r=>({start:r.start,end:r.end,takeId:r.enabled?(r.choice==='auto'?r.autoId:r.choice):null}));}
  function rangeSelection(rows,duration,start=0,end=duration){
    if(!Number.isFinite(start) || !Number.isFinite(end) || start<0 || end>duration || end<=start || end-start>600)throw Error('请输入有效的起止时间：终点需大于起点，不能超出视频，最长 10 分钟。');
    return selections(rows).filter(row=>row.end>start && row.start<end).map(row=>({...row,start:Math.max(start,row.start),end:Math.min(end,row.end)}));
  }
  function choices(rows){return rows.map(r=>({start:r.start,end:r.end,choice:r.choice,enabled:r.enabled}));}
  function preview(takes,duration,saved,api=root.EchoAudioExport){return api.selectionPlan(takes,duration,selections(buildRows(takes,duration,saved,api)));}
  function attach({view,doc=root.document,env=root,onRender,onDownload,onChange=()=>{},onClose=()=>{}}){
    const $=id=>view.getElementById(id),dialog=$('assemblyDialog'),urlApi=env.URL;
    let rows=[],takes=[],duration=0,busy=false,revision=0,url=null;
    const audio=$('assemblyAudio');
    function element(tag,text,cls){const node=doc.createElement(tag);if(text!==undefined)node.textContent=text;if(cls)node.className=cls;return node;}
    const pitchLabel=take=>env.EchoBackingPitch.label(take.backingPitch);
    const time=seconds=>`${Math.floor(seconds/60)}:${(seconds%60).toFixed(1).padStart(4,'0')}`;
    const title=row=>`${time(row.start)}–${time(row.end)}`;
    function isOpen(){return !!dialog.open;}
    function clearAudio(){audio.pause?.();audio.removeAttribute('src');audio.load?.();audio.hidden=true;$('assemblyAudioLabel').textContent='';if(url)urlApi.revokeObjectURL(url);url=null;}
    function exportRange(){
      const custom=$('assemblyScope').value==='custom';
      const start=custom && $('assemblyStart').value!==''?Number($('assemblyStart').value):custom?NaN:0;
      const end=custom && $('assemblyEnd').value!==''?Number($('assemblyEnd').value):custom?NaN:duration;
      const selected=rangeSelection(rows,duration,start,end);
      return {start,end,selected};
    }
    function update(){
      let range,key,error='';try{
        range=exportRange();
        const plan=env.EchoAudioExport.selectionPlan(takes,duration,range.selected);
        key=env.EchoAudioExport.selectedPitch(plan.segments);
      }catch(failure){error=failure.message;}
      const covered=(range?.selected || []).filter(s=>s.takeId).reduce((sum,s)=>sum+s.end-s.start,0);
      $('assemblyCustomRange').hidden=$('assemblyScope').value!=='custom';
      $('assemblyRangeHint').textContent=error || (range?`导出 ${time(range.start)}–${time(range.end)} · ${(range.end-range.start).toFixed(1)} 秒`:'');
      $('assemblyEditorInfo').textContent=`人声覆盖 ${covered.toFixed(1)} / ${(range?range.end-range.start:0).toFixed(1)} 秒 · 未选位置保留空白${key===undefined?'':` · ${env.EchoBackingPitch.label(key)}`}`;
      $('assemblyPreview').textContent=$('assemblyScope').value==='custom'?'▷ 试听选定范围':'▷ 试听整首';
      $('assemblyEditorTimeline').replaceChildren();
      for(const row of rows){
        const inside=range && row.end>range.start && row.start<range.end;
        row.card.hidden=!inside;
        if(inside)row.time.textContent=title({start:Math.max(row.start,range.start),end:Math.min(row.end,range.end)});
        const id=row.enabled?(row.choice==='auto'?row.autoId:row.choice):null;
        row.check.checked=!!id;row.check.disabled=busy || !row.candidates.length;
        row.select.value=row.choice;row.select.disabled=busy || !row.enabled || !row.candidates.length;
        row.play.disabled=busy || !id;
        const source=row.candidates.find(t=>t.id===id);
        row.source.textContent=source?`${source.label || '人声录音'} · ${pitchLabel(source)} · ${new Date(source.createdAt).toLocaleString('zh-CN')}`:row.candidates.length?'不导出此段人声':'尚未录制';
        if(!inside)continue;
        const bar=element('span','');bar.style.flex=String(Math.min(row.end,range.end)-Math.max(row.start,range.start));bar.className=id?'selected':'';bar.title=`${title(row)} · ${source?.label || '空白'}`;$('assemblyEditorTimeline').append(bar);
      }
      for(const id of ['assemblyType','assemblyReset','assemblyScope','assemblyStart','assemblyEnd'])$(id).disabled=busy;
      for(const id of ['assemblyPreview','assemblyDownload'])$(id).disabled=busy || covered<=0 || !!error;
      $('assemblyCancelRender').hidden=!busy;
      dialog.setAttribute('aria-busy',String(busy));
    }
    function changed(){revision++;clearAudio();$('assemblyEditorMessage').textContent='选择已更新，请重新试听。';onChange(choices(rows));update();}
    function draw(){
      $('assemblyEditorList').replaceChildren();
      for(const row of rows){
        const card=element('article',undefined,'assembly-row'),head=element('div',undefined,'assembly-row-head');
        row.card=card;const label=element('label',undefined,'check');row.check=element('input');row.check.type='checkbox';row.check.setAttribute('aria-label',`导出 ${title(row)} 的人声`);
        row.time=element('span',title(row));label.append(row.check,row.time);row.play=element('button','▷ 试听','compact');head.append(label,row.play);
        row.select=element('select');row.select.setAttribute('aria-label',`${title(row)} 的录音版本`);
        const auto=element('option','自动 · 最新版本');auto.value='auto';auto.disabled=!row.autoId;row.select.append(auto);
        for(const take of row.candidates){const option=element('option',`${take.label || '录音'} · ${pitchLabel(take)} · ${new Date(take.createdAt).toLocaleTimeString('zh-CN')} · ${take.id===row.autoId?'最新':'其他版本'}`);option.value=take.id;row.select.append(option);}
        row.source=element('small');card.append(head,row.select,row.source);$('assemblyEditorList').append(card);
        row.check.onchange=()=>{if(busy)return;row.enabled=row.check.checked;if(row.enabled && row.choice==='auto' && !row.autoId)row.choice=row.candidates[0]?.id || 'auto';changed();};
        row.select.onchange=()=>{if(busy)return;row.choice=row.select.value;changed();};
        row.play.onclick=()=>render('preview',row);
      }
      update();
    }
    async function render(action,row=null){
      if(busy || !isOpen())return;
      let range;try{range=exportRange();}catch(error){$('assemblyEditorMessage').textContent=error.message;update();return;}
      const origin=row?Math.max(row.start,range.start):range.start,end=row?Math.min(row.end,range.end):range.end;
      if(end<=origin)return;
      const selected=rangeSelection(row?[row]:rows,duration,origin,end),length=end-origin;
      try{env.EchoAudioExport.selectedPitch(env.EchoAudioExport.selectionPlan(takes,duration,selected).segments);}
      catch(error){$('assemblyEditorMessage').textContent=error.message;return;}
      if(!selected.some(part=>part.takeId)){$('assemblyEditorMessage').textContent='此范围内没有选中的人声，请先选择录音片段。';return;}
      const token=++revision;busy=true;clearAudio();update();
      const label=origin===0 && end===duration?'整首拼接':`片段 ${time(origin)}–${time(end)}`;$('assemblyEditorMessage').textContent=`正在本机准备${label}…`;
      const active=()=>isOpen() && token===revision;
      try{
        const result=await onRender({selection:selected,origin,duration:length,withMusic:$('assemblyType').value==='mixed',active});
        if(!active())return;
        if(action==='download'){onDownload(result.blob,{origin,duration:length,partial:origin!==0 || end!==duration});$('assemblyEditorMessage').textContent='已按当前选择开始下载。';}
        else{
          url=urlApi.createObjectURL(result.blob);audio.src=url;audio.hidden=false;audio.load?.();$('assemblyAudioLabel').textContent=`试听：${label}`;
          $('assemblyEditorMessage').textContent='已生成试听音频，可在播放器中拖动进度。';
          try{await audio.play?.();}catch{if(active())$('assemblyEditorMessage').textContent='试听已准备好，请点击播放器开始播放。';}
        }
      }catch(error){if(active())$('assemblyEditorMessage').textContent=error.message || '拼接失败，请重试。';}
      finally{if(active()){busy=false;update();}}
    }
    function open(options){
      takes=options.takes;duration=options.duration;rows=buildRows(takes,duration,options.choices,env.EchoAudioExport);
      revision++;busy=false;clearAudio();$('assemblyScope').value='whole';$('assemblyStart').value='0';$('assemblyEnd').value=String(duration);$('assemblyStart').max=$('assemblyEnd').max=String(duration);$('assemblyType').value=options.withMusic?'mixed':'vocal';
      $('assemblyEditorMessage').textContent='勾选要导出的人声，试听后选择版本。重叠录音已按时间边界拆开，每个时段只使用一个版本。';
      const skipped=takes.filter(t=>t.kind==='song' && t.capture==='vocal' && !t.withBacking && t.speed!==1).length;
      if(skipped)$('assemblyEditorMessage').textContent+=` ${skipped} 条非 1× 录音未列入选择。`;
      draw();if(dialog.showModal)dialog.showModal();else dialog.open=true;$('assemblyEditorList').scrollTop=0;
    }
    function close(){
      if(!isOpen())return;revision++;busy=false;clearAudio();
      if(dialog.close)dialog.close();else dialog.open=false;
      onClose();$('assembleSong').focus();
    }
    $('closeAssembly').onclick=close;
    dialog.oncancel=event=>{event.preventDefault();close();};
    $('assemblyPreview').onclick=()=>render('preview');$('assemblyDownload').onclick=()=>render('download');
    $('assemblyType').onchange=changed;
    for(const id of ['assemblyScope','assemblyStart','assemblyEnd'])$(id).onchange=()=>{
      if(busy)return;revision++;clearAudio();$('assemblyEditorMessage').textContent='导出范围已更新，请重新试听。';update();
    };
    $('assemblyReset').onclick=()=>{if(busy)return;rows=buildRows(takes,duration,[],env.EchoAudioExport);clearAudio();revision++;draw();onChange(choices(rows));$('assemblyEditorMessage').textContent='已恢复自动选择最新版本。';};
    $('assemblyCancelRender').onclick=()=>{revision++;busy=false;clearAudio();update();$('assemblyEditorMessage').textContent='已取消生成，选择仍保留。';};
    return {open,close,isOpen};
  }
  const api={buildRows,selections,rangeSelection,choices,preview,attach};
  if(typeof module!=='undefined')module.exports=api;else root.EchoAssembly=api;
})(globalThis);
