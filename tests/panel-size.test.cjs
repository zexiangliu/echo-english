const {test}=require('node:test');
const assert=require('node:assert/strict');
const {bounds,clampSize,attach}=require('../extension/panel-size.js');

test('size limits leave space around the panel even in a small viewport',()=>{
  const limit=bounds(280,260);
  assert.equal(limit.top,8);
  assert.deepEqual(clampSize({width:900,height:1000},limit),{width:248,height:236});
  assert.deepEqual(clampSize({width:10,height:10},bounds(1200,900)),{width:320,height:300});
});

test('left-corner drag persists size, viewport changes clamp without forgetting preferences, Home resets',()=>{
  const values=new Map(),listeners=new Map();
  const env={innerWidth:1200,innerHeight:900,localStorage:{getItem:key=>values.get(key),setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)},addEventListener:(name,fn)=>listeners.set(name,fn)};
  const panel={style:{},getBoundingClientRect(){return {width:parseFloat(this.style.width)||384,height:parseFloat(this.style.height)||500};}},host={style:{}},handle={setPointerCapture(){}};
  attach({panel,host,handle,env});
  const event={button:0,pointerId:1,clientX:300,clientY:500,preventDefault(){},stopPropagation(){}};
  handle.onpointerdown(event);handle.onpointermove({...event,clientX:100,clientY:600});handle.onpointerup(event);
  assert.equal(panel.style.width,'584px');assert.equal(panel.style.height,'600px');
  assert.deepEqual(JSON.parse([...values.values()][0]),{width:584,height:600});
  const restored={style:{}};attach({panel:restored,host,handle:{},env});assert.equal(restored.style.width,'584px');
  env.innerWidth=400;env.innerHeight=400;listeners.get('resize')();
  assert.equal(restored.style.width,'368px');assert.equal(restored.style.height,'324px');
  env.innerWidth=1200;env.innerHeight=900;listeners.get('resize')();assert.equal(restored.style.height,'600px');
  handle.onkeydown({...event,key:'Home'});assert.equal(values.size,0);assert.equal(panel.style.width,'');
});

test('blocked preference storage does not prevent resizing with the keyboard',()=>{
  const panel={style:{},getBoundingClientRect:()=>({width:384,height:500})},handle={};
  const env={innerWidth:1200,innerHeight:900,get localStorage(){throw Error('blocked');},addEventListener(){}};
  attach({panel,host:{style:{}},handle,env});
  handle.onkeydown({key:'ArrowLeft',shiftKey:true,preventDefault(){},stopPropagation(){}});
  assert.equal(panel.style.width,'424px');
});

test('title drag and keyboard move persist, stay on screen, and reset independently of size',()=>{
  const values=new Map(),listeners=new Map(),host={style:{}},handle={setPointerCapture(){}},moveHandle={setPointerCapture(){}};
  const env={innerWidth:1200,innerHeight:900,localStorage:{getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)},addEventListener:(name,fn)=>listeners.set(name,fn)};
  const panel={style:{},getBoundingClientRect(){return {left:parseFloat(host.style.left)||796,top:parseFloat(host.style.top)||80,width:parseFloat(this.style.width)||384,height:parseFloat(this.style.height)||500};}};
  const api=attach({panel,host,handle,moveHandle,env}),event={button:0,pointerId:5,clientX:800,clientY:100,preventDefault(){},stopPropagation(){}};
  moveHandle.onpointerdown(event);moveHandle.onpointermove({...event,clientX:200,clientY:200});moveHandle.onpointerup(event);
  assert.equal(host.style.left,'196px');assert.equal(host.style.top,'180px');assert.equal(host.style.right,'auto');
  assert.deepEqual(JSON.parse(values.get('echo-panel-position-v1')),{left:196,top:180});
  moveHandle.onkeydown({...event,key:'ArrowLeft',shiftKey:true});assert.equal(host.style.left,'156px');
  env.innerWidth=400;env.innerHeight=400;listeners.get('resize')();assert.equal(host.style.left,'8px');assert.equal(host.style.top,'8px');
  env.innerWidth=1200;env.innerHeight=900;listeners.get('resize')();assert.equal(host.style.left,'156px');
  api.resetPosition();assert.equal(host.style.left,'auto');assert.equal(host.style.right,'20px');assert(!values.has('echo-panel-position-v1'));
});

test('layout density follows panel height even inside a tall browser window',()=>{
  let height=600;const attrs=new Map();
  const panel={style:{},getBoundingClientRect:()=>({width:550,height}),setAttribute:(k,v)=>attrs.set(k,v)};
  const api=attach({panel,host:{style:{}},handle:{},env:{innerWidth:1280,innerHeight:1000,addEventListener(){}}});
  assert.equal(attrs.get('data-short-height'),'true');assert.equal(attrs.get('data-compact-height'),'false');
  height=440;api.refresh();assert.equal(attrs.get('data-short-height'),'true');assert.equal(attrs.get('data-compact-height'),'true');
  height=720;api.refresh();assert.equal(attrs.get('data-short-height'),'false');assert.equal(attrs.get('data-compact-height'),'false');
});
