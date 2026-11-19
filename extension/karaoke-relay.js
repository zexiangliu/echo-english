(function(root) {
  const base = 'http://127.0.0.1:8765';
  async function request(message, sender, fetcher = fetch) {
    const url = new URL(sender.tab?.url || 'https://invalid.local/');
    if(url.origin !== 'https://www.youtube.com')throw Error('请在 YouTube 视频页使用伴奏功能。');
    const action = message.action;
    if(!['health','start','cached','status','audio','audio-chunk','cancel','models','model-install','model-cancel','model-remove'].includes(action))throw Error('无效的伴奏操作。');
    if(['start','cached'].includes(action) && message.quality!==undefined && !['standard','lossless'].includes(message.quality))throw Error('不支持的音质选项。');
    let path = '/jobs', body;
    if(action === 'start' || action === 'cached') {
      if(url.pathname !== '/watch')throw Error('请在 YouTube 视频页使用伴奏功能。');
      if(message.videoId !== url.searchParams.get('v') || !/^[\w-]{11}$/.test(message.videoId))throw Error('视频已切换，请重新生成伴奏。');
      if(action==='cached')path='/backings/'+message.videoId+(message.quality==='lossless'?'?quality=lossless':'');
      else {
      const {start,end}=message;
      if(message.source!==undefined && !['original','backing'].includes(message.source))throw Error('不支持的音源类型。');
      if(!Number.isFinite(start) || !Number.isFinite(end) || start<0 || end<=start || end-start>600)throw Error('请选择不超过 10 分钟的片段。');
      if(message.model!==undefined && !['demucs-htdemucs','bandit-v2-multi'].includes(message.model))throw Error('不支持的分离模型。');
      body=JSON.stringify({videoId:message.videoId,start,end,...(message.source==='original'?{source:'original'}:{}),...(message.quality==='lossless'?{quality:'lossless'}:{}),...(message.model && message.model!=='demucs-htdemucs'?{model:message.model}:{})});
      }
    } else if(action==='health')path='/health';
    else if(action==='models')path='/models';
    else if(action.startsWith('model-')){
      if(!['demucs-htdemucs','bandit-v2-multi'].includes(message.model))throw Error('不支持的分离模型。');
      path='/models/'+message.model+'/'+action.slice(6);body='{}';
    }
    else {
      if(!/^[a-f0-9]{32}$/.test(message.jobId))throw Error('无效的伴奏任务。');
      path += '/'+message.jobId+(['audio','audio-chunk'].includes(action)?'/audio':action==='cancel'?'/cancel':'');
      if(action==='cancel')body='{}';
    }
    const chunked=action==='audio-chunk';
    if(chunked && (!Number.isSafeInteger(message.offset) || message.offset<0 || message.offset>=192*1024*1024))throw Error('无效的音频分块。');
    let response;
    try {
      response=await fetcher(base+path,{method:body?'POST':'GET',body,
        headers:{'X-Echo-Client':'echo-english',...(chunked?{Range:`bytes=${message.offset}-${message.offset+1024*1024-1}`} :{}),...(body?{'Content-Type':'application/json'}:{})},
        credentials:'omit',redirect:'error',signal:AbortSignal.timeout(['audio','audio-chunk'].includes(action)?30000:10000)});
    }catch{throw Error('无法连接本机伴奏服务，伴奏尚未开始生成。请在项目根目录运行 bash start-karaoke.sh（Windows 使用 start-karaoke.ps1，详见伴奏安装说明），保持终端开启，再点击“重新检测”。安装扩展不会自动安装本机服务。');}
    if(!response.ok){if(action==='models' && response.status===404)throw Error('当前服务不支持模型管理。请在终端停止旧服务，重新运行根目录启动脚本，再刷新状态。');const data=await response.json();throw Error(/0–300 秒/.test(data.error || '')?'当前运行的是旧版伴奏服务。请在服务终端按 Ctrl+C，再运行 ./start-karaoke.sh（Windows 使用 start-karaoke.ps1），然后重新检测。':data.error || '伴奏服务请求失败。');}
    if(!['audio','audio-chunk'].includes(action))return await response.json();
    const limit=(chunked?1:24)*1024*1024;
    if(Number(response.headers.get('Content-Length'))>limit)throw Error('伴奏文件过大，请缩短片段。');
    const bytes=new Uint8Array(await response.arrayBuffer());
    if(bytes.length>limit)throw Error('伴奏文件过大，请缩短片段。');
    let binary='';
    for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
    const result={audio:btoa(binary),mime:response.headers.get('Content-Type') || 'audio/mpeg'};
    if(chunked){
      const range=/^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers.get('Content-Range') || '');
      if(response.status!==206 || !range || Number(range[1])!==message.offset || Number(range[2])-Number(range[1])+1!==bytes.length || Number(range[3])>192*1024*1024)throw Error('音频分块响应无效，请更新并重启本机服务。');
      Object.assign(result,{offset:message.offset,totalBytes:Number(range[3])});
    }
    return result;
  }
  const api={request};
  if(typeof module!=='undefined')module.exports=api;else root.EchoKaraokeRelay=api;
})(globalThis);
