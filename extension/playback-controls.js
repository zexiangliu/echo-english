// One owner for the shared pause, speed and original-volume controls. Late promises from a previous
// playback cannot change the buttons or report errors against a newer one.
(function(root){
  const practice=typeof module!=='undefined'?require('./practice.js'):root.EchoPractice;
  function attach({pauseButton,speedControl,speedInput,volumeControl,volumeInput,volumeValue,clock,getSpeed,onSpeed,onError}){
    let owner=null,paused=false,changing=false,changeTask=null;
    function renderVolume(){
      if(!volumeControl)return;
      const media=owner?.volumeMedia;
      volumeControl.hidden=!media;volumeInput.disabled=!media;
      const level=media?.muted?0:Number.isFinite(media?.volume)?media.volume:1;
      volumeInput.value=String(level);volumeValue.textContent=`${Math.round(level*100)}%`;
    }
    function render(){
      pauseButton.hidden=!owner;pauseButton.disabled=!owner || changing;
      pauseButton.textContent=paused?'▶ 继续':'Ⅱ 暂停';
      pauseButton.setAttribute('aria-label',paused?'继续播放':'暂停播放');
      speedControl.hidden=!owner?.setSpeed;speedInput.disabled=!owner?.setSpeed || changing;
      speedInput.value=String(getSpeed());renderVolume();
    }
    function detachVolume(){owner?.volumeMedia?.removeEventListener?.('volumechange',renderVolume);}
    function set(pause,resume,setSpeed=null,volumeMedia=null,initiallyPaused=false){
      detachVolume();if(paused)clock.setPaused(false);owner={pause,resume,setSpeed,volumeMedia};paused=initiallyPaused;changing=false;changeTask=null;
      if(paused)clock.setPaused(true);
      volumeMedia?.addEventListener?.('volumechange',renderVolume);render();
    }
    function clear(){detachVolume();if(paused)clock.setPaused(false);owner=null;paused=false;changing=false;changeTask=null;render();}
    if(volumeInput)volumeInput.oninput=()=>{
      const media=owner?.volumeMedia,value=Number(volumeInput.value);
      if(!media || !Number.isFinite(value))return;
      media.volume=Math.max(0,Math.min(1,value));media.muted=false;renderVolume();
    };
    pauseButton.onclick=async()=>{
      if(!owner || changing)return;
      const current=owner;
      changing=true;paused=!paused;clock.setPaused(paused);render();
      const action=paused?current.pause:current.resume;
      const task=(async()=>{await action();})();changeTask=task;
      try{await task;}
      catch(error){if(owner===current)onError(error);}
      finally{if(owner===current){changing=false;changeTask=null;render();}}
    };
    speedInput.onchange=()=>{
      if(!owner?.setSpeed || changing)return;
      const speed=Number(speedInput.value);
      if(!practice.SPEEDS.includes(speed)){render();return;}
      try{owner.setSpeed(speed);onSpeed(speed);render();}catch(error){onError(error);}
    };
    async function resume(){
      const current=owner;if(!current)return false;
      if(changing){
        await changeTask?.catch(()=>{});
        if(owner!==current || !paused)return true;
      }
      if(!paused)return false;
      await pauseButton.onclick();return true;
    }
    render();
    return {set,clear,render,resume,get paused(){return paused;}};
  }
  const api={attach};if(typeof module!=='undefined')module.exports=api;else root.EchoPlaybackControls=api;
})(globalThis);
