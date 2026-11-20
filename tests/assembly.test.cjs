const {test}=require('node:test');
const assert=require('node:assert/strict');
const {buildRows,selections,preview}=require('../extension/assembly.js');
const api=require('../extension/audio-export.js');
const voice=(id,start,end,createdAt,extra={})=>({id,start,end,createdAt,cueKey:id,kind:'song',capture:'vocal',speed:1,...extra});
test('editor splits overlaps, offers every available version, and preserves explicit choices',()=>{
  const takes=[voice('old',0,10,1,{cueKey:'same'}),voice('new',0,10,2,{cueKey:'same'}),voice('middle',3,6,3)];
  const rows=buildRows(takes,12,[],api);
  assert.deepEqual(rows.map(r=>[r.start,r.end,r.autoId]),[[0,3,'new'],[3,6,'middle'],[6,10,'new'],[10,12,null]]);
  assert.deepEqual(rows[1].candidates.map(t=>t.id),['middle','new','old']);
  const saved=[{start:0,end:10,choice:'old',enabled:true},{start:10,end:12,choice:'auto',enabled:false}];
  assert.deepEqual(selections(buildRows(takes,12,saved,api)).map(s=>s.takeId),['old','old','old',null]);
  assert.deepEqual(preview(takes,12,saved,api).segments.map(s=>[s.start,s.end,s.take.id]),[[0,10,'old']]);
  assert.deepEqual(selections(buildRows(takes.filter(t=>t.id!=='old'),12,saved,api)).map(s=>s.takeId),['new','middle','new',null]);
});
test('disabled choices stay excluded across newly added boundaries, and slow takes cannot enter export',()=>{
  const takes=[voice('all',0,10,1),voice('part',3,6,2),voice('slow',0,10,3,{speed:.75})];
  const rows=buildRows(takes,10,[{start:0,end:10,choice:'auto',enabled:false}],api);
  assert(selections(rows).every(s=>s.takeId===null));
  assert(rows.every(r=>r.candidates.every(t=>t.id!=='slow')));
  assert.throws(()=>buildRows([takes[2]],10,[],api),/1×/);
});


test('custom export clips selected versions at both boundaries without changing saved choices',()=>{
  const {rangeSelection,choices}=require('../extension/assembly.js');
  const takes=[voice('a',0,10,1),voice('b',5,15,2)];
  const rows=buildRows(takes,20,[],api),before=choices(rows);
  const selected=rangeSelection(rows,20,3,12);
  assert.deepEqual(selected,[{start:3,end:5,takeId:'a'},{start:5,end:10,takeId:'b'},{start:10,end:12,takeId:'b'}]);
  assert.deepEqual(choices(rows),before);
  const shifted=takes.map(t=>({...t,start:t.start-3,end:t.end-3}));
  const plan=api.selectionPlan(shifted,9,selected.map(part=>({...part,start:part.start-3,end:part.end-3})));
  assert.equal(plan.duration,9);assert.equal(plan.segments[0].start,0);assert.equal(plan.segments.at(-1).end,9);
  for(const [start,end] of [[-1,5],[4,4],[5,4],[0,21],[NaN,10]])assert.throws(()=>rangeSelection(rows,20,start,end),/起止时间/);
});


test('local edits persist per interval and per candidate without modifying original version effects',()=>{
  const {choices,rangeSelection}=require('../extension/assembly.js');
  const takes=[voice('a',0,10,1,{effects:{delayMs:80}}),voice('b',4,6,2)];
  const rows=buildRows(takes,10,[],api);
  rows[1].choice='a';rows[1].adjustments=[{takeId:'a',delayMs:-20,volume:1.2,fadeInSeconds:.1,fadeOutSeconds:.2},{takeId:'b',delayMs:30,volume:.8,fadeInSeconds:0,fadeOutSeconds:0}];
  const saved=choices(rows),restored=buildRows(takes,10,JSON.parse(JSON.stringify(saved)),api);
  assert.deepEqual(choices(restored),saved);
  assert.equal(selections(restored)[1].adjustment.delayMs,-20);
  restored[1].choice='b';assert.equal(selections(restored)[1].adjustment.delayMs,30);
  restored[1].choice='a';
  const clipped=rangeSelection(restored,10,5,5.5)[0];
  assert.equal(clipped.adjustmentStart,4);assert.equal(clipped.adjustmentEnd,6);
  assert.equal(clipped.start,5);assert.equal(clipped.end,5.5);
  assert.equal(takes[0].effects.delayMs,80);assert.equal(takes[0].adjustment,undefined);
  assert.equal(selections(restored)[0].adjustment,undefined);
  const deleted=buildRows(takes.filter(t=>t.id!=='b'),10,saved,api);
  assert(deleted.every(row=>row.adjustments.every(a=>a.takeId!=='b')));
});
