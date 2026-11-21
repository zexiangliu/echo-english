(function(root){
  const key='echo-panel-size-v1',positionKey='echo-panel-position-v1';
  function bounds(width,height){
    const top=Math.min(80,Math.max(8,height-340));
    return {top,maxWidth:Math.max(1,width-32),maxHeight:Math.max(1,height-top-16)};
  }
  function clampSize(size,limit){
    return {width:Math.round(Math.max(Math.min(320,limit.maxWidth),Math.min(limit.maxWidth,size.width))),
      height:Math.round(Math.max(Math.min(300,limit.maxHeight),Math.min(limit.maxHeight,size.height)))};
  }
  function attach({panel,host,handle,moveHandle,env=root}){
    let preferred=null,drag=null,position=null,moving=null;
    const limit=()=>bounds(Number.isFinite(env.innerWidth)?env.innerWidth:1024,Number.isFinite(env.innerHeight)?env.innerHeight:768);
    function refresh(){
      const value=limit();host.style.top=`${value.top}px`;
      panel.style.maxWidth=`${value.maxWidth}px`;panel.style.maxHeight=`${value.maxHeight}px`;
      if(preferred){const size=clampSize(preferred,value);panel.style.width=`${size.width}px`;panel.style.height=`${size.height}px`;}
      if(position){
        const rect=panel.getBoundingClientRect?.() || {width:parseFloat(panel.style.width)||384,height:parseFloat(panel.style.height)||300};
        const width=Number.isFinite(env.innerWidth)?env.innerWidth:1024,height=Number.isFinite(env.innerHeight)?env.innerHeight:768;
        host.style.left=`${Math.round(Math.max(8,Math.min(position.left,width-rect.width-8)))}px`;
        host.style.top=`${Math.round(Math.max(8,Math.min(position.top,height-rect.height-8)))}px`;host.style.right='auto';
      }else{host.style.left='auto';host.style.right='20px';}
      panel.setAttribute?.('data-compact-height',String((panel.getBoundingClientRect?.().height || value.maxHeight)<520));
    }
    function save(){try{if(preferred)env.localStorage.setItem(key,JSON.stringify(preferred));else env.localStorage.removeItem(key);}catch{}}
    function reset(){preferred=null;panel.style.width='';panel.style.height='';refresh();save();}
    function change(size){preferred=clampSize(size,limit());refresh();}
    try{
      const value=JSON.parse(env.localStorage.getItem(key));
      if(value && Number.isFinite(value.width) && value.width>0 && Number.isFinite(value.height) && value.height>0)preferred=value;
    }catch{}
    try{const value=JSON.parse(env.localStorage.getItem(positionKey));if(value && Number.isFinite(value.left) && Number.isFinite(value.top))position=value;}catch{}
    refresh();
    function savePosition(){try{if(position)env.localStorage.setItem(positionKey,JSON.stringify(position));else env.localStorage.removeItem(positionKey);}catch{}}
    function resetPosition(){position=null;refresh();savePosition();}
    if(moveHandle){
      moveHandle.onpointerdown=event=>{
        if(event.button!==0)return;
        event.preventDefault();event.stopPropagation();
        const rect=panel.getBoundingClientRect();moving={pointerId:event.pointerId,x:event.clientX,y:event.clientY,left:rect.left,top:rect.top};
        moveHandle.setPointerCapture(event.pointerId);
      };
      moveHandle.onpointermove=event=>{if(!moving || moving.pointerId!==event.pointerId)return;position={left:moving.left+event.clientX-moving.x,top:moving.top+event.clientY-moving.y};refresh();};
      const endMove=event=>{if(!moving || moving.pointerId!==event.pointerId)return;moving=null;position={left:parseFloat(host.style.left),top:parseFloat(host.style.top)};savePosition();};
      moveHandle.onpointerup=moveHandle.onpointercancel=moveHandle.onlostpointercapture=endMove;
      moveHandle.ondblclick=resetPosition;
      moveHandle.onkeydown=event=>{
        if(event.key==='Home'){event.preventDefault();resetPosition();return;}
        if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key))return;
        event.preventDefault();event.stopPropagation();
        const rect=panel.getBoundingClientRect(),step=event.shiftKey?40:20;
        position={left:rect.left+(event.key==='ArrowLeft'?-step:event.key==='ArrowRight'?step:0),top:rect.top+(event.key==='ArrowUp'?-step:event.key==='ArrowDown'?step:0)};
        refresh();position={left:parseFloat(host.style.left),top:parseFloat(host.style.top)};savePosition();
      };
    }
    handle.onpointerdown=event=>{
      if(event.button!==0)return;
      event.preventDefault();event.stopPropagation();
      const rect=panel.getBoundingClientRect();
      drag={pointerId:event.pointerId,x:event.clientX,y:event.clientY,width:rect.width,height:rect.height,left:rect.left};
      handle.setPointerCapture(event.pointerId);
    };
    handle.onpointermove=event=>{
      if(!drag || event.pointerId!==drag.pointerId)return;
      const width=clampSize({width:drag.width+drag.x-event.clientX,height:drag.height},limit()).width;
      if(position)position.left=drag.left+drag.width-width;
      change({width,height:drag.height+event.clientY-drag.y});
    };
    function end(event){if(!drag || event.pointerId!==drag.pointerId)return;drag=null;save();if(position)savePosition();}
    handle.onpointerup=handle.onpointercancel=handle.onlostpointercapture=end;
    handle.ondblclick=reset;
    handle.onkeydown=event=>{
      if(event.key==='Home'){event.preventDefault();reset();return;}
      if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key))return;
      event.preventDefault();event.stopPropagation();
      const rect=panel.getBoundingClientRect(),step=event.shiftKey?40:20;
      const size=clampSize({width:rect.width+(event.key==='ArrowLeft'?step:event.key==='ArrowRight'?-step:0),
        height:rect.height+(event.key==='ArrowDown'?step:event.key==='ArrowUp'?-step:0)},limit());
      if(position)position.left=rect.left+rect.width-size.width;
      change(size);save();if(position)savePosition();
    };
    env.addEventListener('resize',refresh);
    if(env.ResizeObserver)new env.ResizeObserver(refresh).observe(panel);
    return {reset,resetPosition,refresh};
  }
  const api={bounds,clampSize,attach};
  if(typeof module!=='undefined')module.exports=api;else root.EchoPanelSize=api;
})(globalThis);
