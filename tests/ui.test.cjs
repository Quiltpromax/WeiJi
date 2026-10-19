const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const path=require('node:path');
const fs=require('node:fs');
const http=require('node:http');
const root=process.env.WEIJI_TEST_ASSETS?path.resolve(process.env.WEIJI_TEST_ASSETS):path.resolve(__dirname,'../app/src/main/assets');
const out=path.resolve(__dirname,'../artifacts');
const mime={'.html':'text/html; charset=utf-8','.js':'application/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml'};
const server=http.createServer((req,res)=>{
  const pathname=new URL(req.url,'http://localhost').pathname;
  const target=path.resolve(root,'.'+(pathname==='/'?'/index.html':pathname));
  if(!target.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}
  fs.readFile(target,(error,data)=>{if(error){res.writeHead(404);res.end();return;}res.setHeader('Content-Type',mime[path.extname(target)]||'application/octet-stream');res.end(data);});
});
const check=async(condition,message)=>assert.ok(await condition,message);

(async()=>{
  await new Promise(resolve=>server.listen(8766,'127.0.0.1',resolve));
  const browser=await chromium.launch({channel:'msedge',headless:true,args:['--disable-gpu']});
  const context=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:2,locale:'zh-CN',timezoneId:'Asia/Shanghai',reducedMotion:'reduce'});
  const page=await context.newPage();const errors=[];
  await page.clock.install({time:new Date('2026-10-13T10:00:00+08:00')});
  page.on('pageerror',error=>errors.push(error.message));
  const url='http://127.0.0.1:8766/';
  fs.mkdirSync(out,{recursive:true});
  await page.goto(url+'?demo=1');
  await page.screenshot({path:path.join(out,'preview-home.png')});
  await page.locator('[data-page="stats"]').click();
  await page.screenshot({path:path.join(out,'preview-stats.png')});
  await page.locator('[data-page="records"]').click();
  await page.screenshot({path:path.join(out,'preview-records.png')});

  await page.goto(url);
  await check(page.locator('#main').getByText('从一条小记录开始').isVisible(),'Real app must start empty');
  await check(page.locator('#elapsed-card').innerText().then(t=>t.includes('还没有活动记录')),'Empty gap does not invent a duration');
  await page.locator('.add-button').click();
  assert.equal(await page.locator('[data-action="form-type"]').count(),0,'One form replaces mutually exclusive record types');
  await page.locator('[data-action="add-view"]').click();await page.locator('#form-title').fill('只有观看内容');
  await page.locator('#save-record').click();
  assert.equal(await page.locator('#form-duration').evaluate(el=>el.validity.valueMissing),true,'Activity duration remains required with viewing contents');
  assert.equal(await page.evaluate(()=>localStorage.getItem('weiji-state-v1')),null,'Invalid activity cannot save a standalone view');
  await page.locator('[data-action="remove-view"]').click();
  await page.locator('#form-date').fill('2026-10-12');await page.locator('#form-time').fill('08:30');
  await page.locator('#form-duration').fill('12.5');
  await page.locator('#form-note').fill('测试一次活动');
  await page.locator('#save-record').click();
  await check(page.locator('.metric-value').first().innerText().then(t=>t.includes('1')),'Activity count');
  await check(page.locator('.metric-value').nth(1).innerText().then(t=>t.includes('12.5')),'Duration');
  assert.equal(await page.locator('#elapsed-days').innerText(),'1');
  assert.match(await page.locator('.elapsed-remainder').innerText(),/1 小时 30 分钟/);
  await page.reload();
  await check(page.locator('.metric-value').first().innerText().then(t=>t.includes('1')),'Persistence after reload');
  await page.locator('.elapsed-last').click();await page.locator('#edit-record').click();
  await page.locator('[data-action="add-view"]').click();
  await page.locator('#form-title').fill('测试观看 <script>');
  assert.equal(await page.locator('#form-url').count(),0,'Video links stay removed');
  await page.locator('#new-tag').fill('剧情');await page.locator('[data-action="create-tag"]').click();
  await page.locator('#new-tag').fill('动画');await page.locator('[data-action="create-tag"]').click();
  const image=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=40;c.height=40;c.getContext('2d').fillRect(0,0,40,40);return c.toDataURL('image/png').split(',')[1];});
  await page.locator('#image-input').setInputFiles({name:'test.png',mimeType:'image/png',buffer:Buffer.from(image,'base64')});
  await page.waitForFunction(()=>document.querySelectorAll('.image-cell').length===1);
  await page.locator('#save-record').click();
  assert.equal(await page.locator('#elapsed-days').innerText(),'1','Adding viewing content keeps the activity interval');
  assert.equal(await page.locator('.record-card').count(),1,'Activity and viewing contents share one card');
  await check(page.locator('.metric-value').first().innerText().then(t=>t.includes('1')),'Post-save viewing addition does not create an extra activity');
  await page.locator('[data-page="stats"]').click();
  assert.equal(await page.locator('.stats-summary strong').first().innerText(),'1');
  assert.equal(await page.locator('.tag-row').count(),2);
  assert.match(await page.locator('.tag-bars').innerText(),/100%/);
  await page.locator('.tag-row').first().click();
  await check(page.locator('.record-title').first().innerText().then(t=>t==='个人活动 · 测试观看 <script>'),'Tag drill-down and escaped unified titles');
  await page.locator('.record-card').first().click();
  assert.equal(await page.locator('.detail-images img').count(),1);
  assert.equal(await page.locator('#open-video-link').count(),0);
  await page.locator('#edit-record').click();
  await page.locator('#form-title').fill('编辑后的观看');await page.locator('#form-duration').fill('20');
  await page.locator('#form-note').fill('一起编辑活动');await page.locator('#form-view-note').fill('一起编辑观看');
  await page.locator('[data-action="add-view"]').click();await page.locator('#form-title').fill('第二段观看内容');
  await page.locator('#save-record').click();
  let combined=await page.evaluate(()=>JSON.parse(localStorage.getItem('weiji-state-v1')));
  assert.equal(combined.activities.length,1);assert.equal(combined.activities[0].duration,20);assert.equal(combined.views.length,2);
  assert.ok(combined.views.every(v=>v.activityId===combined.activities[0].id));
  assert.equal(combined.activities[0].note,'一起编辑活动');assert.equal(combined.views[0].note,'一起编辑观看');
  await check(page.locator('.record-title').first().innerText().then(t=>t==='个人活动 · 编辑后的观看'),'Edit both parts of one record');
  await page.locator('.record-card').first().click();await page.locator('#edit-record').click();
  await page.locator('[data-action="select-view"][data-index="1"]').click();await page.locator('[data-action="remove-view"]').click();
  assert.equal(await page.locator('#form-title').inputValue(),'编辑后的观看','Removing one content preserves the other');
  await page.locator('#save-record').click();
  combined=await page.evaluate(()=>JSON.parse(localStorage.getItem('weiji-state-v1')));
  assert.equal(combined.activities.length,1);assert.equal(combined.activities[0].duration,20);assert.equal(combined.views.length,1);
  await page.locator('[data-action="clear-filter"]').click();
  await page.locator('[data-action="record-type"][data-value="all"]').click();

  await page.locator('[data-action="settings"]').click();
  await check(page.locator('.backup-explainer').innerText().then(t=>t.includes('.json')&&t.includes('截图')),'Backup format and included images explained');
  const downloadPromise=page.waitForEvent('download');await page.locator('[data-action="export"]').click();
  const download=await downloadPromise;const backupPath=path.join(out,'test-backup.json');await download.saveAs(backupPath);
  const backup=JSON.parse(fs.readFileSync(backupPath,'utf8'));
  assert.equal(backup.state.activities.length,1);assert.equal(backup.state.views.length,1);assert.match(backup.state.views[0].images[0],/^[a-f0-9]{32}\.jpg$/);
  assert.ok(backup.images[backup.state.views[0].images[0]],'Portable backup includes image bytes');
  assert.equal('url' in backup.state.views[0],false);assert.equal(backup.state.views[0].activityId,backup.state.activities[0].id);
  await page.locator('[data-action="close"]').click();
  await page.locator('.record-card').filter({hasText:'编辑后的观看'}).click();
  await page.locator('#delete-record').click();await page.locator('#confirm-yes').click();
  assert.equal(await page.locator('.record-card').count(),0,'Deleting the entire record removes both parts');
  assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('weiji-state-v1')).views.length),0);
  await page.locator('[data-action="settings"]').click();await page.locator('[data-action="import"]').click();await page.locator('#confirm-yes').click();
  await page.locator('#backup-input').setInputFiles(backupPath);
  await page.waitForFunction(()=>JSON.parse(localStorage.getItem('weiji-state-v1')).views.length===1);
  await check(page.evaluate(()=>JSON.parse(localStorage.getItem('weiji-state-v1')).views[0].images[0].startsWith('data:image/jpeg;base64,')),'Restore resolves backed-up image bytes');
  assert.equal(await page.locator('.record-card').count(),1,'Restore reconstructs one unified record');

  const beforeBrokenRestore=await page.evaluate(()=>localStorage.getItem('weiji-state-v1'));
  await page.locator('[data-action="settings"]').click();await page.locator('[data-action="import"]').click();await page.locator('#confirm-yes').click();
  await page.locator('#backup-input').setInputFiles({name:'broken-backup.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({...backup,images:{}}))});
  await page.waitForFunction(()=>document.querySelector('#toast').textContent.includes('缺少截图'));
  assert.equal(await page.evaluate(()=>localStorage.getItem('weiji-state-v1')),beforeBrokenRestore,'Invalid restore preserves all current data');

  await page.locator('[data-page="home"]').click();await page.locator('.add-button').click();
  await page.locator('#form-time').fill('09:45');await page.locator('#form-duration').fill('5');await page.locator('#save-record').click();
  assert.equal(await page.locator('#elapsed-days').innerText(),'0','A new activity resets the interval');
  await page.locator('.elapsed-last').click();await page.locator('#delete-record').click();await page.locator('#confirm-yes').click();
  assert.equal(await page.locator('#elapsed-days').innerText(),'1','Deleting the latest activity falls back to previous history');

  await page.locator('[data-action="settings"]').click();await page.locator('[data-action="pin-settings"]').click();
  await page.locator('#new-pin').fill('123456');await page.locator('#confirm-pin').fill('123456');await page.locator('#pin-form .primary-button').click();
  await page.reload();await page.locator('#unlock-pin').fill('0000');await page.locator('#unlock-form .primary-button').click();
  await check(page.locator('#unlock-error').innerText().then(t=>t.includes('不正确')),'Wrong PIN rejected');
  await page.locator('#unlock-pin').fill('123456');await page.locator('#unlock-form .primary-button').click();
  await check(page.locator('.app-header').isVisible(),'Correct PIN accepted');

  await page.locator('.add-button').click();await page.locator('[data-action="timer"]').click();
  await page.locator('[data-action="close"]').click();await check(page.locator('.timer-floating').isVisible(),'Timer survives modal close');
  await page.locator('.timer-floating').click();await page.locator('[data-action="timer"]').click();
  await check(page.locator('#form-duration').inputValue().then(t=>Number(t)>0),'Timer fills duration');
  await page.locator('[data-action="close"]').click();

  const narrow=await browser.newContext({viewport:{width:320,height:740},locale:'zh-CN'});const small=await narrow.newPage();
  await small.goto(url+'?demo=1');
  assert.equal(await small.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth),false,'No horizontal overflow at 320px');
  await small.locator('[data-page="stats"]').click();
  assert.equal(await small.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth),false,'Stats fit at 320px');
  await small.locator('.add-button').click();await small.locator('[data-action="add-view"]').click();
  assert.equal(await small.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth),false,'Unified form fits at 320px');
  await small.close();await narrow.close();
  // Migrate existing records without fabricating activity data or guessing same-day ownership.
  const migrationContext=await browser.newContext({viewport:{width:390,height:844},locale:'zh-CN',timezoneId:'Asia/Shanghai',reducedMotion:'reduce'});
  const legacy=await migrationContext.newPage();legacy.on('pageerror',error=>errors.push(error.message));
  await legacy.clock.install({time:new Date('2026-10-13T10:00:00+08:00')});
  const oldState={schema:1,tags:[{id:'t_old',name:'旧标签',color:1}],activities:[{id:'a_old',date:'2026-10-12',time:'08:30',duration:12.5,note:'原活动'}],views:[
    {id:'v_bound',activityId:'a_old',date:'2026-10-12',time:'08:00',title:'原绑定内容',tags:['t_old'],note:'原观看备注',images:[]},
    {id:'v_pending',date:'2026-10-12',time:'08:15',title:'旧独立观看',tags:['t_old'],note:'旧独立备注',images:['data:image/png;base64,'+image]},
    {id:'v_new',date:'2026-10-13',time:'09:00',title:'需新建活动的观看',tags:[],note:'',images:[]}
  ]};
  await legacy.addInitScript(seed=>{if(!localStorage.getItem('weiji-state-v1'))localStorage.setItem('weiji-state-v1',JSON.stringify(seed));},oldState);
  await legacy.goto(url);await legacy.locator('[data-page="records"]').click();
  assert.equal(await legacy.locator('.record-card').count(),3,'Bound old records share one card while standalone records remain visible');
  assert.match(await legacy.locator('.legacy-banner').innerText(),/2 条/);
  await legacy.locator('.record-card[data-id="v_pending"]').click();await legacy.locator('#edit-record').click();
  assert.equal(await legacy.locator('#form-duration').inputValue(),'','Old viewing record does not invent a duration');
  assert.equal(await legacy.locator('.image-cell').count(),1,'Old screenshot stays in the completion form');
  await legacy.locator('#legacy-target').selectOption('a_old');
  assert.equal(await legacy.locator('#form-duration').inputValue(),'12.5');
  assert.equal(await legacy.locator('#form-title').inputValue(),'旧独立观看');
  await legacy.locator('#save-record').click();
  let migrated=await legacy.evaluate(()=>JSON.parse(localStorage.getItem('weiji-state-v1')));
  assert.equal(migrated.schema,2);assert.equal(migrated.activities.length,1);assert.equal(migrated.views.length,3);
  assert.equal(migrated.views.find(v=>v.id==='v_pending').activityId,'a_old');
  assert.equal(migrated.views.find(v=>v.id==='v_pending').images[0],oldState.views[1].images[0]);
  assert.equal(migrated.views.find(v=>v.id==='v_bound').note,'原观看备注');
  await legacy.locator('.record-card[data-id="a_old"]').click();await legacy.locator('#edit-record').click();
  await legacy.locator('[data-action="select-view"][data-index="1"]').click();await legacy.locator('[data-action="remove-view"]').click();
  await legacy.locator('[data-action="close"]').click();
  assert.deepEqual(await legacy.evaluate(()=>JSON.parse(localStorage.getItem('weiji-state-v1'))),migrated,'Closing edits preserves both parts of the saved record');
  await legacy.locator('.record-card[data-id="v_new"]').click();await legacy.locator('#edit-record').click();
  await legacy.locator('#form-duration').fill('7');await legacy.locator('#save-record').click();
  migrated=await legacy.evaluate(()=>JSON.parse(localStorage.getItem('weiji-state-v1')));
  assert.equal(migrated.activities.length,2);assert.equal(migrated.views.filter(v=>!v.activityId).length,0);
  assert.equal(await legacy.locator('.legacy-banner').count(),0);
  await legacy.reload();await legacy.locator('[data-page="records"]').click();
  assert.equal(await legacy.locator('.record-card').count(),2,'Completed records remain unified after reload');
  await legacy.locator('.record-card[data-id="a_old"]').click();await legacy.locator('#delete-record').click();await legacy.locator('#confirm-yes').click();
  migrated=await legacy.evaluate(()=>JSON.parse(localStorage.getItem('weiji-state-v1')));
  assert.equal(migrated.activities.length,1);assert.equal(migrated.views.length,1);assert.equal(migrated.views[0].id,'v_new');
  await migrationContext.close();
  // Exercise the imported appearance and animation behavior separately from record checks.
  const appearanceContext=await browser.newContext({viewport:{width:390,height:844},locale:'zh-CN',colorScheme:'dark'});
  const appearance=await appearanceContext.newPage();appearance.on('pageerror',error=>errors.push(error.message));
  await appearance.goto(url+'?demo=1');
  assert.equal(await appearance.locator('html').getAttribute('data-theme'),'dark','System dark mode applies before rendering');
  assert.deepEqual(await appearance.locator('.bottom-nav button').evaluateAll(elements=>elements.map(el=>el.getAttribute('data-page')||el.getAttribute('data-action'))),['home','records','add','stats','settings']);
  await appearance.locator('.nav-settings').click();await appearance.locator('[data-action="appearance"]').click();
  await appearance.locator('[data-action="set-appearance"][data-value="light"]').click();
  assert.equal(await appearance.locator('html').getAttribute('data-theme'),'light','Explicit light overrides system dark');
  await appearance.reload();assert.equal(await appearance.locator('html').getAttribute('data-theme'),'light','Appearance preference survives reload');
  await appearance.locator('.nav-settings').click();await appearance.locator('[data-action="appearance"]').click();
  await appearance.locator('[data-action="set-appearance"][data-value="system"]').click();
  await appearance.locator('[data-action="close"]').click();await appearance.emulateMedia({colorScheme:'light'});
  await appearance.waitForFunction(()=>document.documentElement.dataset.theme==='light');
  await appearance.evaluate(()=>{
    for(const destination of ['records','stats','home','stats','records'])document.querySelector('[data-page="'+destination+'"]').click();
  });
  await appearance.waitForFunction(()=>document.querySelectorAll('.page-transition-layer').length===0);
  assert.equal(await appearance.locator('#main').count(),1,'Rapid navigation cancels obsolete animations and removes snapshots');
  assert.equal(await appearance.locator('.bottom-nav .nav-item.active').getAttribute('data-page'),'records');
  const headerTop=await appearance.locator('.app-header').evaluate(el=>el.getBoundingClientRect().top);
  await appearance.evaluate(()=>window.scrollTo(0,250));
  assert.equal(await appearance.locator('.app-header').evaluate(el=>el.getBoundingClientRect().top),headerTop,'Header stays fixed while scrolling');
  await appearance.emulateMedia({reducedMotion:'reduce'});await appearance.locator('[data-page="stats"]').click();
  assert.equal(await appearance.locator('.page-transition-layer').count(),0,'Reduced motion disables page transitions');
  await appearanceContext.close();
  // Exercise the Android adapter path, including cancellation and late picker callbacks.
  const android=await context.newPage();
  await android.addInitScript(()=>{
    let state={schema:1,tags:[],activities:[],views:[]};
    window.WeijiNative={
      getTheme:()=>window.testAppearanceMode||'system',isSystemDark:()=>true,
      setTheme:value=>{window.testAppearanceMode=value;},haptic:()=>{window.testHaptics=(window.testHaptics||0)+1;},
      getStatus:()=>JSON.stringify({hasPin:false,unlocked:true}),
      readState:()=>JSON.stringify({ok:true,state}),
      writeState:text=>{state=JSON.parse(text);return '{"ok":true}';},
      pickImages:()=>'{"ok":true}',cleanupImages:()=>{},
      exportBackup:()=>{window.testExportedState=JSON.parse(JSON.stringify(state));return '{"ok":true}';}
    };
  });
  await android.goto(url);
  assert.equal(await android.locator('html').getAttribute('data-theme'),'dark','Android theme bridge determines system appearance');
  await android.locator('.add-button').click();await android.locator('[data-action="add-view"]').click();
  await android.locator('[data-action="pick-images"]').click();
  await android.evaluate(()=>JournalApp.onImages({images:[]}));
  assert.equal(await android.locator('[data-action="pick-images"]').isDisabled(),false,'Picker cancellation re-enables button');
  await android.locator('[data-action="pick-images"]').click();await android.locator('[data-action="close"]').click();
  await android.locator('.add-button').click();await android.locator('[data-action="add-view"]').click();
  await android.evaluate(()=>JournalApp.onImages({images:['a'.repeat(32)+'.jpg']}));
  assert.equal(await android.locator('.image-cell').count(),0,'Late picker results do not attach to a different draft');
  await android.locator('#form-title').fill('安卓适配路径');await android.locator('#form-duration').fill('15');await android.locator('#save-record').click();
  const nativeState=await android.evaluate(()=>JSON.parse(WeijiNative.readState()).state);
  assert.equal(nativeState.views.length,1);assert.equal(nativeState.activities.length,1);assert.equal(nativeState.views[0].activityId,nativeState.activities[0].id);
  await android.locator('[data-action="settings"]').click();await android.locator('[data-action="export"]').click();
  const nativeExport=await android.evaluate(()=>window.testExportedState);
  assert.equal(nativeExport.views.length,1);assert.equal('url' in nativeExport.views[0],false);assert.equal(nativeExport.views[0].activityId,nativeExport.activities[0].id);
  assert.ok(await android.evaluate(()=>window.testHaptics)>0,'Trusted button taps reach the native haptic bridge');
  await android.locator('[data-action="close"]').click();await android.locator('.nav-settings').click();await android.locator('[data-action="appearance"]').click();
  await android.locator('[data-action="set-appearance"][data-value="light"]').click();
  assert.equal(await android.evaluate(()=>window.testAppearanceMode),'light','Appearance changes reach the native theme bridge');
  await android.close();
  assert.deepEqual(errors,[],'No uncaught browser errors');
  fs.writeFileSync(path.join(out,'verification.txt'),'PASS: 13 core statistics/time/validation and unified record tests.\nPASS: Browser UI: required activity and optional viewing, post-save viewing addition, unified editing/cards, multiple viewing contents, removing viewing without deleting activity, cascading deletion, binding-preserving backup restore, old-data completion, prominent elapsed days, tags/statistics, images, corrupt backup rejection, PIN lock, timer, 320px layout and Android adapter; appearance modes/persistence, fixed header, navigation order, rapid animation cancellation, reduced motion, native theme and haptic bridges.\nAPK: verified separately with apksigner and zipalign.\nNo physical Android device was attached during these checks.\n');
  fs.unlinkSync(backupPath);
  console.log('UI checks passed. Screenshots saved to artifacts/.');
  await browser.close();await new Promise(resolve=>server.close(resolve));
})().catch(error=>{console.error(error);server.close();process.exit(1);});
