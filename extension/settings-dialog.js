// Low-frequency settings share one modal; the original controls retain their
// owners and persistence handlers in the session coordinator.
(function(root){
  function attach({view,onOpen=()=>{}}){
    const $=id=>view.getElementById(id),dialog=$('settingsDialog');
    const tabs={practice:'settingsPracticeTab',microphone:'settingsMicTab',captions:'settingsCaptionsTab',backing:'settingsBackingTab',sound:'settingsSoundTab'};
    let returnId='practiceSettings',current='microphone';
    function isOpen(){return !!dialog.open;}
    function select(section,focus=false){
      if(!tabs[section] && section!=='backingOptions')return;current=section;
      const options=section==='backingOptions',backing=section==='backing';
      $('settings-backingOptions').hidden=!options;$('settingsTabs').hidden=options;
      $('backingReturnPractice').hidden=!backing;
      $('settingsTitle').textContent=options?'模型与音质':backing?'伴奏／背景音':'设置';
      $('settingsFooterNote').textContent=backing?'已生成音频自动保存在本机，可供多个练习片段复用。':'设置自动保存。';
      for(const [name,id] of Object.entries(tabs)){
        $(id).setAttribute('aria-selected',String(name===section));$(id).tabIndex=name===section?0:-1;
        $('settings-'+name).hidden=name!==section;
      }
      $('settingsBody').scrollTop=0;$('settingsStatus').textContent='';
      if(focus)$(options?'backToGeneration':backing?'generationScope':tabs[section]).focus();onOpen(section);
    }
    function open(section='microphone',trigger='practiceSettings'){
      returnId=trigger;
      if(!isOpen()){if(dialog.showModal)dialog.showModal();else dialog.open=true;}
      select(section,true);
    }
    function close(){if(!isOpen())return;if(dialog.close)dialog.close();else dialog.open=false;$(returnId)?.focus();}
    $('closeSettings').onclick=close;dialog.oncancel=event=>{event.preventDefault();close();};
    for(const [section,id] of Object.entries(tabs)){
      $(id).onclick=()=>select(section);
      $(id).onkeydown=event=>{
        if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
        event.preventDefault();const names=Object.keys(tabs),index=names.indexOf(current);
        select(names[event.key==='Home'?0:event.key==='End'?names.length-1:(index+(event.key==='ArrowLeft'?-1:1)+names.length)%names.length],true);
      };
    }
    $('settings-backingOptions').hidden=true;
    for(const name of Object.keys(tabs))$('settings-'+name).hidden=name!==current;
    return {open,close,isOpen,section:()=>current};
  }
  const api={attach};if(typeof module!=='undefined')module.exports=api;else root.EchoSettingsDialog=api;
})(globalThis);
