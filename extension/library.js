// Independent practice-library dialog; no audio blobs are read into memory.
(function(root){
  function bytes(size){return size<1024?`${size} B`:size<1024*1024?`${(size/1024).toFixed(1)} KB`:`${(size/1024/1024).toFixed(1)} MB`;}
  function attach({view,storage,doc=root.document,env=root,onChange=async()=>{}}){
    const $=id=>view.getElementById(id),dialog=$('libraryDialog');
    let page='recent',items=[],pending=null,revision=0,busy=false,importData=null;
    const tabs={recent:'libraryRecentTab',favorites:'libraryFavoritesTab',backup:'libraryBackupTab',cache:'libraryCacheTab'};
    const pack=typeof module!=='undefined'?require('./practice-package.js'):root.EchoPracticePackage;
    const operationIds=['packageExport','packageChoose','packageImport','packageCancel','packageScope','packageBackings','packageReplace','closeLibrary',...Object.values(tabs)];
    function lock(value){busy=value;for(const id of operationIds)$(id).disabled=value;render();}
    function preview(data){
      importData=data;$('packagePreview').hidden=!data;$('packageReplace').checked=false;
      $('packageContents').open=false;$('packageContentList').replaceChildren();
      if(!data)return;
      $('packageInfo').textContent=`${data.sessions.length} 个视频进度 · ${data.recordings.length} 条录音 · ${data.backings.length} 条伴奏／背景音 · ${data.favorites.length} 个收藏`;
      const videos=new Map(),existing=new Set(items.filter(item=>item.hasSession).map(item=>item.videoId));
      for(const name of ['sessions','favorites','recordings','backings'])for(const value of data[name]){
        if(!videos.has(value.videoId))videos.set(value.videoId,{id:value.videoId,title:'',recordings:0,backings:0,progress:false});
        const item=videos.get(value.videoId);item.title ||= value.title || '';
        if(name==='sessions')item.progress=true;
        if(name==='recordings' || name==='backings')item[name]++;
      }
      const entries=[...videos.values()];
      for(const item of entries.slice(0,50)){
        const row=element('div',item.title || item.id,'package-content-item');
        row.append(element('small',`${item.id} · ${item.recordings} 条录音 · ${item.backings} 条伴奏／背景音${item.progress?existing.has(item.id)?' · 已有本机进度':' · 新视频进度':''}`));
        $('packageContentList').append(row);
      }
      if(entries.length>50)$('packageContentList').append(element('p',`仅显示前 50 个视频；另有 ${entries.length-50} 个视频。上方数量和导入包含全部内容。`,'hint'));
    }
    async function run(work){if(busy)return;lock(true);try{await work();}catch(error){$('libraryMessage').textContent=error.message || '操作失败，请重试。';}finally{lock(false);}}

    function element(tag,text,className){const el=doc.createElement(tag);el.textContent=text;if(className)el.className=className;return el;}
    function isOpen(){return !!dialog.open;}
    function confirm(kind,videoId,label,count){
      if(busy)return;pending={kind,videoId};$('libraryConfirm').hidden=false;
      $('libraryConfirmText').textContent=kind==='backings'?`清理${label}的 ${count} 条浏览器伴奏／背景音？人声录音和本机服务文件会保留。`:`删除${label}的 ${count} 条人声录音？此操作不可撤销，请先在录音页下载备份。`;
      $('libraryConfirmYes').focus();
    }
    function render(){
      const query=$('librarySearch').value.trim().toLowerCase();
      const list=$('libraryList');list.replaceChildren();
      $('libraryBody').setAttribute('aria-labelledby',tabs[page]);
      for(const [name,id] of Object.entries(tabs)){$(id).tabIndex=page===name?0:-1;$(id).setAttribute('aria-selected',String(page===name));}
      $('packageTools').hidden=page!=='backup';$('librarySearch').hidden=page==='backup';
      $('clearAllBackings').hidden=page!=='cache';
      $('clearAllBackings').disabled=busy || !items.some(i=>i.backings);
      const totals=items.reduce((s,i)=>({recordings:s.recordings+i.recordings,backings:s.backings+i.backings,recordingBytes:s.recordingBytes+i.recordingBytes,backingBytes:s.backingBytes+i.backingBytes}),{recordings:0,backings:0,recordingBytes:0,backingBytes:0});
      $('librarySummary').textContent=page==='recent'?`${items.filter(i=>i.hasSession || i.recordings).length} 个练习视频 · 点“继续练习”返回上次片段`:`浏览器伴奏／背景音 ${totals.backings} 条 · ${bytes(totals.backingBytes)} ｜ 录音 ${totals.recordings} 条 · ${bytes(totals.recordingBytes)}`;
      if(page==='favorites')$('librarySummary').textContent=`${items.filter(i=>i.favorite).length} 个收藏视频`;
      if(page==='backup')$('librarySummary').textContent='练习包保留原始音频，不重新压缩；本机服务的模型和文件不在包内。';
      const visible=page==='backup'?[]:items.filter(i=>(page==='cache'?(i.backings || i.recordings):page==='favorites'?i.favorite:(i.hasSession || i.recordings)) && `${i.title} ${i.videoId}`.toLowerCase().includes(query));
      $('libraryEmpty').hidden=page==='backup' || !!visible.length;
      $('libraryEmpty').textContent=query?'没有匹配的视频。':page==='favorites'?'还没有收藏。在练习页点击「☆ 收藏」保存视频。':page==='recent'?'还没有练习记录，打开视频开始练习即可。':'浏览器中没有缓存的伴奏、背景音或录音。';
      for(const item of visible){
        const card=element('article','','library-card'),title=item.title || `视频 ${item.videoId}`;
        card.append(element('strong',title),element('small',`${item.recordings} 条录音 · ${item.backings} 条伴奏／背景音${item.updatedAt?' · '+new Date(item.updatedAt).toLocaleDateString():''}`));
        const actions=element('div','','library-actions');
        const link=element('a',page==='recent'?'继续练习 →':'打开视频 →');
        if(/^[\w-]{11}$/.test(item.videoId)){link.href=`https://www.youtube.com/watch?v=${encodeURIComponent(item.videoId)}&t=${Math.floor(Math.max(0,item.start))}s`;actions.append(link);}
        if(page==='favorites'){const remove=element('button','取消收藏','text-button');remove.disabled=busy;remove.onclick=()=>run(async()=>{await storage.deleteFavorite(item.videoId);await onChange();await refresh();});actions.append(remove);}
        if(page==='recent'){const backup=element('button','备份此视频','text-button');backup.disabled=busy;backup.onclick=()=>{$('libraryBackupTab').click();$('packageScope').value=item.videoId;};actions.append(backup);}
        if(page==='cache'){
          card.append(element('small',`伴奏／背景音 ${bytes(item.backingBytes)} · 录音 ${bytes(item.recordingBytes)}`));
          if(item.backings){const clear=element('button','清理背景音');clear.disabled=busy;clear.onclick=()=>confirm('backings',item.videoId,`“${title}”`,item.backings);actions.append(clear);}
          if(item.recordings){const remove=element('button','删除录音','danger');remove.disabled=busy;remove.onclick=()=>confirm('recordings',item.videoId,`“${title}”`,item.recordings);actions.append(remove);}
        }
        card.append(actions);list.append(card);
      }
      $('libraryNote').hidden=page!=='cache';
    }
    async function refresh(){
      const token=++revision;$('libraryMessage').textContent='正在读取本机练习库…';
      try{const rows=await storage.library();if(token!==revision || !isOpen())return;items=rows;
        const selected=$('packageScope').value;$('packageScope').replaceChildren(...[['','全部练习'],...items.map(i=>[i.videoId,i.title || i.videoId])].map(([value,title])=>{const option=element('option',title);option.value=value;return option;}));$('packageScope').value=items.some(i=>i.videoId===selected)?selected:'';render();$('libraryMessage').textContent='';}
      catch(error){if(token===revision && isOpen())$('libraryMessage').textContent=error.message || '练习库读取失败。';}
    }
    async function open(){
      if(!isOpen()){if(dialog.showModal)dialog.showModal();else dialog.open=true;}
      page='recent';pending=null;preview(null);$('packageBackings').checked=true;$('libraryConfirm').hidden=true;$('librarySearch').value='';$('libraryBody').scrollTop=0;render();await refresh();
    }
    function close(force=false){
      if(busy && !force)return;
      revision++;pending=null;preview(null);
      if(dialog.close)dialog.close();else dialog.open=false;
      $('openLibrary').focus();
    }
    function escape(){if(pending && !busy){pending=null;$('libraryConfirm').hidden=true;$('libraryCacheTab').focus();}else close();}
    $('openLibrary').onclick=open;$('closeLibrary').onclick=()=>close();
    dialog.oncancel=event=>{event.preventDefault();escape();};
    for(const [name,id] of Object.entries(tabs)){
      $(id).onclick=()=>{if(busy)return;page=name;pending=null;$('libraryConfirm').hidden=true;$('libraryBody').scrollTop=0;render();};
      $(id).onkeydown=event=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(event.key)){event.preventDefault();const ids=Object.values(tabs),index=ids.indexOf(id),next=event.key==='Home'?0:event.key==='End'?ids.length-1:(index+(event.key==='ArrowLeft'?-1:1)+ids.length)%ids.length;$(ids[next]).click();$(ids[next]).focus();}};
    }
    $('packageExport').onclick=()=>run(async()=>{
      $('libraryMessage').textContent='正在打包…';
      const data=await storage.snapshot($('packageScope').value || null,$('packageBackings').checked);
      if(!Object.values(data).some(values=>values.length))throw Error('没有可导出的练习数据。');
      const blob=pack.encode(data),url=env.URL.createObjectURL(blob),link=element('a','');
      link.href=url;link.download=`Echo-${$('packageScope').value || '全部练习'}-${new Date().toISOString().slice(0,10)}.echo`;doc.documentElement.append(link);link.click();link.remove();env.setTimeout(()=>env.URL.revokeObjectURL(url),1000);
      $('libraryMessage').textContent=`已导出练习包 · ${bytes(blob.size)}。请确认下载完成。`;
    });
    $('packageChoose').onclick=()=>{$('packageFile').value='';$('packageFile').click();};
    $('packageFile').onchange=()=>run(async()=>{
      preview(null);const file=$('packageFile').files?.[0];if(!file)return;
      $('libraryMessage').textContent='正在检查练习包…';preview(await pack.decode(file));$('libraryMessage').textContent='请检查数量后点击「合并导入」。';
    });
    $('packageCancel').onclick=()=>{preview(null);$('libraryMessage').textContent='已取消导入。';};
    $('packageImport').onclick=()=>run(async()=>{
      if(!importData)return;$('libraryMessage').textContent='正在导入，请保持此标签页打开…';
      const result=await storage.importSnapshot(importData,$('packageReplace').checked);preview(null);await onChange(true);await refresh();$('libraryMessage').textContent=`导入完成：写入 ${result.added} 项，保留并跳过 ${result.skipped} 项已有数据。`;
    });
    $('librarySearch').oninput=render;
    $('clearAllBackings').onclick=()=>confirm('backings',null,'所有视频',items.reduce((n,i)=>n+i.backings,0));
    $('libraryConfirmNo').onclick=()=>{pending=null;$('libraryConfirm').hidden=true;$('libraryCacheTab').focus();};
    $('libraryConfirmYes').onclick=async()=>{
      if(!pending || busy)return;
      const operation=pending;busy=true;render();
      for(const id of ['libraryConfirmYes','libraryConfirmNo','closeLibrary',...Object.values(tabs)])$(id).disabled=true;
      try{await storage.clearMedia(operation.kind,operation.videoId);await onChange();pending=null;$('libraryConfirm').hidden=true;await refresh();$('libraryMessage').textContent='清理完成。';}
      catch(error){$('libraryMessage').textContent=error.message || '清理失败，请重试。';}
      finally{busy=false;for(const id of ['libraryConfirmYes','libraryConfirmNo','closeLibrary',...Object.values(tabs)])$(id).disabled=false;render();if(isOpen())$('libraryCacheTab').focus();}
    };
    return {open,close,escape,isOpen,refresh};
  }
  const api={attach,bytes};if(typeof module!=='undefined')module.exports=api;else root.EchoLibrary=api;
})(globalThis);
