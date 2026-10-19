const {test}=require('node:test');
const assert=require('node:assert/strict');
const J=require('../app/src/main/assets/core.js');

const tags=[{id:'tag_a',name:'剧情',color:0},{id:'tag_b',name:'动画',color:1}];
const view=(id,date,ids=[],images=[])=>({id,date,time:'21:00',title:'片段',note:'',tags:ids,images,activityId:null,legacy:true});
const activity=(id,date,duration)=>({id,date,time:'22:00',note:'',duration});

test('Monday-Sunday boundaries handle Sunday, month and year transitions',()=>{
  assert.deepEqual(J.weekRange(0,'2026-10-13'),{start:'2026-10-12',end:'2026-10-18'});
  assert.deepEqual(J.weekRange(0,'2026-10-18'),{start:'2026-10-12',end:'2026-10-18'});
  assert.deepEqual(J.weekRange(0,'2026-01-01'),{start:'2025-12-29',end:'2026-01-04'});
  assert.equal(J.addDays('2024-02-28',1),'2024-02-29');
  assert.equal(J.validDate('2026-02-29'),false);
  assert.equal(J.validDate('2026-13-01'),false);
});
test('multi-tag statistics use viewing records including untagged records as denominator',()=>{
  const state={...J.blank(),tags,views:[view('v1','2026-10-13',['tag_a','tag_b']),view('v2','2026-10-13',['tag_a']),view('v3','2026-10-13',[]),view('v4','2026-10-11',['tag_b'])]};
  const s=J.stats(state,J.weekRange(0,'2026-10-13'));
  assert.equal(s.total,3);assert.equal(s.untagged,1);
  assert.deepEqual(s.rows.map(r=>[r.id,r.count,r.percent]),[['tag_a',2,67],['tag_b',1,33]]);
  const two=J.stats({...state,views:state.views.slice(0,1)},J.weekRange(0,'2026-10-13'));
  assert.equal(two.rows.reduce((n,r)=>n+r.percent,0),200);
});
test('multiple photos do not change tag counts and duplicate tag IDs are deduplicated',()=>{
  const state=J.validateState({...J.blank(),tags,views:[view('v1','2026-10-13',['tag_a','tag_a'],['a'.repeat(32)+'.jpg','b'.repeat(32)+'.jpg'])]});
  assert.deepEqual(state.views[0].tags,['tag_a']);
  assert.equal(J.stats(state,{start:'2026-10-13',end:'2026-10-13'}).rows[0].count,1);
});
test('weekly activity duration stays separate from video totals',()=>{
  const state={...J.blank(),activities:[activity('a1','2026-10-12',10),activity('a2','2026-10-13',20),activity('a3','2026-10-11',90)],views:[view('v1','2026-10-13'),view('v2','2026-10-13')]};
  const s=J.weeklySummary(state,J.weekRange(0,'2026-10-13'),'2026-10-13');
  assert.equal(s.count,2);assert.equal(s.minutes,30);assert.equal(s.average,15);assert.equal(s.views,2);
  assert.equal(s.days[1].count,1);assert.equal(s.days[1].views,2);
});
test('month trend filters partial weeks and counts all selected records once',()=>{
  const state={...J.blank(),tags,views:[view('v1','2026-10-01',['tag_a']),view('v2','2026-10-13',['tag_a']),view('v3','2026-10-31',['tag_b']),view('v4','2026-09-30',['tag_a']),view('v5','2026-11-01',['tag_a'])]};
  const range=J.getRange('month',state,'2026-10-13');
  assert.deepEqual(range,{start:'2026-10-01',end:'2026-10-31'});
  const all=J.trend(state,range,'');assert.equal(all.weekly,true);
  assert.equal(all.buckets.reduce((n,b)=>n+b.count,0),3);
  assert.equal(J.trend(state,range,'tag_a').buckets.reduce((n,b)=>n+b.count,0),2);
});
test('delete activity removes its viewing contents while preserving other history; tag deletion preserves both',()=>{
  const state=J.validateState({...J.blank(),tags,activities:[activity('a1','2026-10-13',10),activity('a2','2026-10-14',15)],views:[{...view('v1','2026-10-13',['tag_a','tag_b']),activityId:'a1'},{...view('v2','2026-10-14'),activityId:'a2'},view('v3','2026-10-12')]});
  const a=J.deleteRecord(state,'activity','a1');assert.equal(a.activities.length,1);assert.deepEqual(a.views.map(v=>v.id),['v2','v3']);
  const b=J.deleteTag(state,'tag_a');assert.equal(b.views.length,3);assert.deepEqual(b.views[0].tags,['tag_b']);assert.equal(b.tags.length,1);assert.equal(b.views[0].activityId,'a1');
});
test('invalid backups fail validation rather than silently deleting entries',()=>{
  const state={...J.blank(),tags,views:[view('v1','2026-10-13',['tag_a'])]};
  assert.throws(()=>J.validateState({...state,schema:3}));
  assert.throws(()=>J.validateState({...state,tags:[tags[0],{...tags[1],name:'剧情'}]}));
  assert.throws(()=>J.validateState({...state,views:[view('v1','2026-10-13',['missing'])]}));
  assert.throws(()=>J.validateState({...state,views:[view('v1','2026-10-13',[],['../../secret.jpg'])]}));
  assert.throws(()=>J.validateState({...state,activities:[activity('a1','2026-10-13',-5)]}));
  assert.throws(()=>J.validateState({...state,activities:[activity('a1','2026-10-13',NaN)]}));
  assert.throws(()=>J.validateState({...state,views:[view('v1','2026-10-13'),view('v1','2026-10-13')]}));
});
test('elapsed days use the latest activity time, independent of viewing records or selected week',()=>{
  const state={...J.blank(),activities:[{...activity('a_recent','2026-10-12',10),time:'08:30'},activity('a_old','2026-10-05',20)],views:[view('v1','2026-10-13')]};
  const gap=J.sinceLastActivity(state,new Date(2026,9,13,10,0));
  assert.equal(gap.record.id,'a_recent');assert.equal(gap.days,1);assert.equal(gap.hours,1);assert.equal(gap.minutes,30);
  const deleted=J.deleteRecord(state,'activity','a_recent');
  assert.equal(J.sinceLastActivity(deleted,new Date(2026,9,13,10,0)).record.id,'a_old');
});
test('elapsed time handles empty history, midnight, full 24-hour days and future records',()=>{
  assert.equal(J.sinceLastActivity(J.blank()).status,'empty');
  const state={...J.blank(),activities:[{...activity('a1','2026-10-13',5),time:'23:59'}]};
  const midnight=J.sinceLastActivity(state,new Date(2026,9,14,0,1));
  assert.equal(midnight.days,0);assert.equal(midnight.minutes,2);
  const day=J.sinceLastActivity(state,new Date(2026,9,14,23,59));
  assert.equal(day.days,1);assert.equal(day.hours,0);assert.equal(day.minutes,0);
  assert.equal(J.sinceLastActivity(state,new Date(2026,9,13,12,0)).status,'future');
});
test('old backups retain valid bindings, times, notes and images without guessing missing bindings',()=>{
  const state={...J.blank(),schema:1,tags,activities:[activity('a1','2026-10-13',10)],views:[{...view('v1','2026-10-13',['tag_a'],['a'.repeat(32)+'.jpg']),url:'https://example.com/video',activityId:'a1'},view('v2','2026-10-13'),{...view('v3','2026-10-13'),activityId:'missing'}]};
  const migrated=J.validateState(state);
  assert.deepEqual(migrated.activities,state.activities);assert.deepEqual(migrated.tags,state.tags);
  assert.equal(migrated.views[0].title,'片段');assert.deepEqual(migrated.views[0].images,state.views[0].images);
  assert.equal('url' in migrated.views[0],false);assert.equal(migrated.views[0].activityId,'a1');assert.equal(migrated.views[0].time,'21:00');
  assert.equal(migrated.views[1].legacy,true);assert.equal(migrated.views[2].activityId,null);
  assert.equal(migrated.activities.length,1);assert.equal(migrated.views.length,3);
  assert.deepEqual(J.validateState(migrated),migrated,'Migration is stable after reload');
});
test('a required activity can be saved alone, then viewing contents added, edited and removed without extra activities',()=>{
  const draft={date:'2026-10-13',time:'22:00',duration:12.5,note:'活动备注',views:[]};
  assert.throws(()=>J.saveSession(J.blank(),{...draft,duration:''}));
  let state=J.saveSession({...J.blank(),tags},draft),id=state.activities[0].id;
  assert.equal(state.views.length,0);
  state=J.saveSession(state,{...draft,id,views:[{...view(null,draft.date,['tag_a','tag_b'],['a'.repeat(32)+'.jpg']),note:'观看备注'}]});
  assert.equal(state.activities.length,1);assert.equal(state.views[0].activityId,id);
  assert.equal(J.allRecords(state).length,1);assert.equal(J.allRecords(state)[0].views.length,1);
  const videoId=state.views[0].id;
  state=J.saveSession(state,{...draft,id,duration:20,views:[{...state.views[0],title:'修改后的内容'},{...view(null,draft.date),title:'另一段'}]});
  assert.equal(state.activities[0].duration,20);assert.equal(state.views[0].id,videoId);assert.equal(state.views.length,2);
  assert.equal(J.weeklySummary(state,J.weekRange(0,draft.date)).count,1);assert.equal(J.stats(state,J.weekRange(0,draft.date)).total,2);
  state=J.saveSession(state,{...draft,id,duration:20,views:[]});
  assert.equal(state.activities.length,1);assert.equal(state.views.length,0);assert.equal(state.activities[0].duration,20);
});
test('only legacy viewing records may lack activity; dangling or stolen bindings are rejected',()=>{
  const v=view('v1','2026-10-13');
  assert.throws(()=>J.validateState({...J.blank(),views:[{...v,legacy:false}]}));
  assert.throws(()=>J.validateState({...J.blank(),views:[{...v,activityId:'missing'}]}));
  const state=J.validateState({...J.blank(),activities:[activity('a1',v.date,10),activity('a2',v.date,20)],views:[{...v,activityId:'a1'}]});
  assert.throws(()=>J.saveSession(state,{...state.activities[1],views:[state.views[0]]}));
  assert.deepEqual(J.validateState(JSON.parse(JSON.stringify(state))),state,'Backup round trip preserves ownership');
});
test('completing an old viewing record can attach to an existing activity without changing other viewing contents',()=>{
  const image='a'.repeat(32)+'.jpg',state=J.validateState({...J.blank(),schema:1,activities:[activity('a1','2026-10-13',15)],views:[{...view('v1','2026-10-13'),activityId:'a1'},view('v2','2026-10-12',[],[image])]});
  const next=J.saveSession(state,{...state.activities[0],legacyId:'v2',views:state.views});
  assert.equal(next.activities.length,1);assert.equal(next.views.length,2);assert.ok(next.views.every(v=>v.activityId==='a1'));
  assert.equal(next.views[1].images[0],image);assert.equal(next.views[1].date,'2026-10-12');
  assert.equal(J.allRecords(next).length,1);
  assert.throws(()=>J.saveSession(state,{...state.activities[0],legacyId:'v2',views:[state.views[0]]}));
});
