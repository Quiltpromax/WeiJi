(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Journal = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const PALETTE = [
    {color:'#7c9b78',bg:'#ecf2e7'}, {color:'#9c88b2',bg:'#f0eaf5'},
    {color:'#bd9c6a',bg:'#f6f0e4'}, {color:'#7b9fa9',bg:'#eaf1f3'},
    {color:'#ba8e8e',bg:'#f6eceb'}, {color:'#809497',bg:'#eaf0ef'}
  ];
  const pad = n => String(n).padStart(2, '0');
  const localDate = (date = new Date()) => `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}`;
  const localTime = (date = new Date()) => `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  const parseDate = text => { const [y,m,d] = text.split('-').map(Number); return new Date(y,m-1,d,12); };
  const validDate = text => typeof text === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(text) && text >= '2000-01-01' && text <= '2100-12-31' && localDate(parseDate(text)) === text;
  const addDays = (text, days) => { const date = parseDate(text); date.setDate(date.getDate()+days); return localDate(date); };
  const weekStart = (text = localDate()) => { const d = parseDate(text).getDay(); return addDays(text,-((d+6)%7)); };
  const weekRange = (offset=0, today=localDate()) => {const start=addDays(weekStart(today),offset*7); return {start,end:addDays(start,6)};};
  const blank = () => ({schema:2,tags:[],activities:[],views:[]});
  const uid = prefix => `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,10)}`;
  const inRange = (record,range) => record.date >= range.start && record.date <= range.end;
  const sortRecords = (a,b) => `${b.date} ${b.time||'00:00'} ${b.id}`.localeCompare(`${a.date} ${a.time||'00:00'} ${a.id}`);
  const tagStyle = tag => PALETTE[Number(tag.color)||0] || PALETTE[0];
  const dateLabel = (date, today=localDate()) => date === today ? '今天' : date === addDays(today,-1) ? '昨天' : `${Number(date.slice(5,7))}月${Number(date.slice(8,10))}日`;
  const rangeLabel = range => `${range.start.slice(5).replace('-','.')} — ${range.end.slice(5).replace('-','.')}`;
  const viewsFor = (state,id) => state.views.filter(r=>r.activityId===id);
  const allRecords = state => [
    ...state.activities.map(r=>({...r,type:'activity',views:viewsFor(state,r.id)})),
    ...state.views.filter(r=>!r.activityId).map(r=>({...r,type:'legacy',views:[r]}))
  ].sort(sortRecords);
  function getRange(key,state,today=localDate(),custom) {
    if(key === 'today') return {start:today,end:today};
    if(key === 'week') return weekRange(0,today);
    if(key === 'month') return {start:today.slice(0,7)+'-01',end:localDate(new Date(parseDate(today).getFullYear(),parseDate(today).getMonth()+1,0,12))};
    if(key === 'custom' && custom && validDate(custom.start) && validDate(custom.end) && custom.start<=custom.end) return custom;
    const dates = [...state.activities,...state.views].map(r=>r.date);
    return {start:dates.length ? dates.reduce((a,b)=>a<b?a:b) : today,end:dates.length ? dates.reduce((a,b)=>a>b?a:b,today) : today};
  }
  function stats(state,range) {
    const records = state.views.filter(r=>inRange(r,range));
    const rows=state.tags.map(tag=>{
      const count=records.reduce((n,r)=>n+(r.tags.includes(tag.id)?1:0),0);
      return {...tag,count,percent:records.length ? Math.round(count/records.length*100):0};
    }).filter(t=>t.count>0).sort((a,b)=>b.count-a.count || a.name.localeCompare(b.name,'zh-CN'));
    return {total:records.length,tagged:records.filter(r=>r.tags.length>0).length,untagged:records.filter(r=>!r.tags.length).length,rows,records};
  }
  function weeklySummary(state,range,today=localDate()) {
    const activities=state.activities.filter(r=>inRange(r,range));
    const views=state.views.filter(r=>inRange(r,range));
    const minutes=Math.round(activities.reduce((n,r)=>n+r.duration,0)*10)/10;
    const days=Array.from({length:7},(_,i)=>{
      const date=addDays(range.start,i);
      return {date,today:date===today,count:activities.filter(r=>r.date===date).length,views:views.filter(r=>r.date===date).length};
    });
    return {count:activities.length,minutes,average:activities.length?Math.round(minutes/activities.length*10)/10:0,views:views.length,days};
  }
  function sinceLastActivity(state,now=new Date()) {
    if(!state.activities.length)return {status:'empty',record:null};
    const record=[...state.activities].sort(sortRecords)[0];
    const at=parseDate(record.date),[hour,minute]=record.time.split(':').map(Number);
    at.setHours(hour,minute,0,0);
    const difference=Number(now)-Number(at);
    if(difference<0)return {status:'future',record};
    const totalMinutes=Math.floor(difference/60000);
    return {status:'elapsed',record,totalMinutes,days:Math.floor(totalMinutes/1440),hours:Math.floor(totalMinutes%1440/60),minutes:totalMinutes%60};
  }
  function trend(state,range,tagId) {
    const countDays=Math.round((parseDate(range.end)-parseDate(range.start))/86400000)+1;
    const weekly=countDays>14;
    let start=weekly?weekStart(range.start):range.start;
    const step=weekly?7:1;
    const total=Math.floor((parseDate(range.end)-parseDate(start))/86400000/step)+1;
    if(total>52) start=addDays(start,(total-52)*step);
    const buckets=[];
    for(let d=start;d<=range.end;d=addDays(d,step)) {
      const end=addDays(d,step-1);
      const count=state.views.filter(r=>inRange(r,range)&&r.date>=d&&r.date<=end&&(!tagId||r.tags.includes(tagId))).length;
      buckets.push({date:d,end,count,label:d.slice(5).replace('-','/')});
    }
    return {weekly,truncated:total>52,buckets};
  }
  function validateState(value) {
    if(!value||![1,2].includes(value.schema)||!Array.isArray(value.tags)||!Array.isArray(value.activities)||!Array.isArray(value.views)) throw Error('这不是有效的微记数据。');
    if(value.tags.length>500||value.activities.length>100000||value.views.length>100000) throw Error('备份数据过大。');
    const idSet=new Set();
    const id = x => {if(typeof x!=='string'||!/^[a-zA-Z0-9_-]{1,80}$/.test(x)||idSet.has(x)) throw Error('记录标识无效或重复。'); idSet.add(x);return x;};
    const text=(x,max,required=false)=>{if(typeof x!=='string'||x.length>max||(required&&!x.trim())) throw Error('记录文字格式无效。');return x;};
    const tags=value.tags.map(t=>({id:id(t.id),name:text(t.name,24,true).trim(),color:Number.isInteger(t.color)&&t.color>=0&&t.color<PALETTE.length?t.color:0}));
    if(new Set(tags.map(t=>t.name.toLocaleLowerCase())).size!==tags.length) throw Error('标签名称重复。');
    const tagIds=new Set(tags.map(t=>t.id));
    const base=r=>{
      if(!validDate(r.date)||typeof r.time!=='string'||!/^([01]\d|2[0-3]):[0-5]\d$/.test(r.time)) throw Error('记录日期或时间无效。');
      return {id:id(r.id),date:r.date,time:r.time,note:text(r.note||'',4000)};
    };
    const activities=value.activities.map(r=>{
      const item=base(r);
      if(typeof r.duration!=='number'||!Number.isFinite(r.duration)||r.duration<0.1||r.duration>1440) throw Error('持续时长须在 0.1 到 1440 分钟之间。');
      return {...item,duration:Math.round(r.duration*10)/10};
    });
    const activityIds=new Set(activities.map(r=>r.id));
    const views=value.views.map(r=>{
      const item=base(r);
      if(!Array.isArray(r.tags)||r.tags.some(t=>!tagIds.has(t))) throw Error('记录包含不存在的标签。');
      if(!Array.isArray(r.images)||r.images.length>12||r.images.some(s=>typeof s!=='string'||!( /^[a-f0-9]{32}\.jpg$/.test(s)||/^data:image\/(jpeg|png|webp);base64,[a-zA-Z0-9+/=]+$/.test(s)||/^covers\/[123]\.svg$/.test(s)))) throw Error('图片格式无效。');
      const activityId=activityIds.has(r.activityId)?r.activityId:null;
      // Only old independent records can remain pending. New records require an activity.
      if(value.schema===2&&((r.activityId!=null&&!activityId)||(!activityId&&r.legacy!==true))) throw Error('观看信息必须属于一条活动记录。');
      return {...item,title:text(r.title||'',120),tags:[...new Set(r.tags)],images:[...r.images],activityId,...(!activityId?{legacy:true}:{})};
    });
    return {schema:2,tags,activities,views};
  }
  function deleteTag(state,tagId) {
    return {...state,tags:state.tags.filter(t=>t.id!==tagId),views:state.views.map(r=>({...r,tags:r.tags.filter(t=>t!==tagId)}))};
  }
  function deleteRecord(state,type,recordId) {
    if(type==='legacy')return {...state,views:state.views.filter(r=>r.id!==recordId||r.activityId)};
    return {...state,activities:state.activities.filter(r=>r.id!==recordId),views:state.views.filter(r=>r.activityId!==recordId)};
  }
  function saveSession(state,draft) {
    if(draft.id&&!state.activities.some(r=>r.id===draft.id))throw Error('这条活动已不存在，请重新打开记录。');
    const activity={id:draft.id||uid('activity'),date:draft.date,time:draft.time,duration:Number(draft.duration),note:draft.note||''};
    const owned=new Set(viewsFor(state,activity.id).map(r=>r.id));
    if(draft.legacyId){
      const legacy=state.views.find(r=>r.id===draft.legacyId&&!r.activityId);
      if(!legacy)throw Error('这条旧观看记录已不存在，请重新打开。');
      owned.add(legacy.id);
      if(!draft.views.some(r=>r.id===legacy.id))throw Error('请保留要补全的旧观看记录。');
    }
    const views=draft.views.map(r=>{
      if(r.id&&!owned.has(r.id))throw Error('观看信息不属于当前活动。');
      return {id:r.id||uid('video'),activityId:activity.id,date:r.date,time:r.time,title:r.title||'',note:r.note||'',tags:[...r.tags],images:[...r.images]};
    });
    return validateState({...state,activities:[...state.activities.filter(r=>r.id!==activity.id),activity],views:[...state.views.filter(r=>!owned.has(r.id)),...views]});
  }
  function demo(today=localDate()) {
    const start=weekStart(today),day=(parseDate(today).getDay()+6)%7;
    const s=blank();
    s.tags=[{id:'tag_plot',name:'剧情',color:0},{id:'tag_animation',name:'动画',color:1},{id:'tag_short',name:'短视频',color:2},{id:'tag_slow',name:'慢节奏',color:3}];
    const days=[addDays(start,-8),addDays(start,-2),addDays(start,-1),addDays(today,-1)];
    s.activities=days.map((date,i)=>({id:'activity_demo_'+i,date,time:['22:10','21:35','23:05','08:30'][i],duration:[18,24,16,22][i],note:i===3?'给自己留一点时间。':''}));
    s.views=[
      {id:'video_demo_1',date:today,time:'08:15',title:'今天喜欢的片段',tags:['tag_plot','tag_slow'],images:['covers/1.svg'],note:'记录喜欢的氛围和节奏。'},
      {id:'video_demo_2',date:today,time:'08:00',title:'收藏的一段动画',tags:['tag_animation','tag_short'],images:['covers/2.svg'],note:''},
      {id:'video_demo_3',date:start,time:'07:30',title:'随手观看记录',tags:['tag_plot'],images:['covers/3.svg'],note:''},
      {id:'video_demo_4',date:addDays(start,Math.min(1,day)),time:'07:00',title:'随手记下的片段',tags:['tag_short','tag_plot'],images:[],note:''},
      {id:'video_demo_5',date:addDays(start,-4),time:'20:00',title:'上周的记录',tags:['tag_slow','tag_plot'],images:[],note:''}
    ];
    for(let i=1;i<=6;i++)s.views.push({id:'video_demo_old_'+i,date:addDays(start,-i*7),time:'20:00',title:'历史示例 '+i,tags:i%2?['tag_plot']:['tag_animation'],images:[],note:''});
    // All demonstration viewing entries belong to real demonstration activities.
    s.views.forEach((v,i)=>{
      let a=s.activities.find(r=>r.date===v.date);
      if(!a){a={id:'activity_view_demo_'+i,date:v.date,time:v.time,duration:15+i%3*4,note:''};s.activities.push(a);}
      v.activityId=a.id;
    });
    return validateState(s);
  }
  return {PALETTE,pad,localDate,localTime,parseDate,validDate,addDays,weekStart,weekRange,blank,uid,inRange,sortRecords,tagStyle,dateLabel,rangeLabel,allRecords,viewsFor,getRange,stats,weeklySummary,sinceLastActivity,trend,validateState,deleteTag,deleteRecord,saveSession,demo};
});
