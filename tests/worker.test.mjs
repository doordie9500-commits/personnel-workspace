import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import worker,{validate,passwordHash} from '../cloudflare/worker.js';
import {createScheduledBackup,decryptScheduledBackup} from '../cloudflare/scheduled-backup.js';
import {DEFAULT_PREFERENCES,validatePreferences} from '../web/preferences.js';

test('Warehouse API persists snapshots, rejects overlaps, archives and stale/viewer writes',async()=>{
 const DB=d1(),env={DB,ADMIN_PASSWORD:'SecureTestPassword123!'};
 try{
  const owner=(await call(env,'login',{body:{login:'admin',password:env.ADMIN_PASSWORD}})).data.token;
  const state={title:'Зміни',groups:['Група 1'],roles:[],events:[],people:[{id:'p',name:'Тест Працівник',group:'Група 1'}],warehouses:[{id:'w',name:'Склад 1',archived:false}],shifts:[{id:'s',warehouse_id:'w',group:'Група 1',start:'2026-10-21T05:00:00.000Z',end:'2026-10-21T17:00:00.000Z',status:'Заплановано',members:[{id:'p',name:'spoof'}],responsible_id:'p',created_by:'spoof'}]};
  let saved=await call(env,'state',{token:owner,body:{state,revision:0}});assert.equal(saved.status,200);assert.equal(saved.data.state.shifts[0].members[0].name,'Тест Працівник');assert.notEqual(saved.data.state.shifts[0].created_by,'spoof');
  const overlap=structuredClone(saved.data.state);overlap.shifts.push({...overlap.shifts[0],id:'two'});assert.equal((await call(env,'state',{token:owner,body:{state:overlap,revision:1}})).status,400);
  const archived=structuredClone(saved.data.state);archived.warehouses[0].archived=true;assert.equal((await call(env,'state',{token:owner,body:{state:archived,revision:1}})).status,400);
  assert.equal((await call(env,'state',{token:owner,body:{state:saved.data.state,revision:0}})).status,409);
  await call(env,'register',{token:owner,body:{login:'readonly',password:'ReadonlyPassword123!',role:'viewer'}});const viewer=(await call(env,'login',{body:{login:'readonly',password:'ReadonlyPassword123!'}})).data.token;assert.equal((await call(env,'state',{token:viewer,body:{state:saved.data.state,revision:1}})).status,403);
  const finished=structuredClone(saved.data.state);finished.shifts[0].status='Завершили зміну';finished.shifts[0].actual_end='2026-10-21T18:00:00.000Z';saved=await call(env,'state',{token:owner,body:{state:finished,revision:1}});assert.equal(saved.status,200);
  const removed=structuredClone(saved.data.state);removed.people=[];removed.groups=[];assert.equal((await call(env,'state',{token:owner,body:{state:removed,revision:2}})).status,403);
  const person=saved.data.state.people[0];assert.equal((await call(env,'delete-person',{token:owner,body:{id:person.id,confirmation:person.name,revision:2}})).status,403);
  const archivedPerson=structuredClone(saved.data.state);archivedPerson.people[0].archived=true;archivedPerson.group_colors={'Група 1':'#4b7fc4'};saved=await call(env,'state',{token:owner,body:{state:archivedPerson,revision:2}});assert.equal(saved.status,200);assert.deepEqual(saved.data.state.group_colors,archivedPerson.group_colors);
  assert.equal((await call(env,'delete-person',{token:owner,body:{id:person.id,confirmation:'помилка',revision:3}})).status,403);
  saved=await call(env,'delete-person',{token:owner,body:{id:person.id,confirmation:person.name,revision:3}});assert.equal(saved.status,200);assert.equal(saved.data.state.people.length,0);assert.equal(saved.data.state.shifts[0].members[0].name,'Тест Працівник');

  const backup=(await call(env,'full-backup',{token:owner})).data;assert.equal(JSON.parse(backup.tables.workspace[0].data).shifts.length,1);
  const audit=(await call(env,'audit',{token:owner})).data;assert.ok(audit.some(r=>r.details.some(d=>d.table==='shifts'&&d.actor_id)));
 }finally{DB.close();}
});

test('External backups send only ciphertext and reject public repositories; R2 archives decrypt',async()=>{
 const DB=d1(),objects=new Map(),env={DB,BACKUP_KEY:btoa('a'.repeat(32)),BACKUP_BUCKET:{async put(key,data){objects.set(key,data);},async get(key){return objects.has(key)?{async text(){return objects.get(key);}}:null;}}};
 const originalFetch=globalThis.fetch;
 try{
  const result=await createScheduledBackup(env);assert.equal(result.external.r2,true);const [key,value]=[...objects.entries()][0];assert.ok(!value.includes('password'));const packet=await decryptScheduledBackup({id:result.id,data:JSON.stringify({format:'personnel-r2-reference-v1',key})},env.BACKUP_KEY,env.BACKUP_BUCKET);assert.equal(packet.engine,'cloudflare-d1');
  env.BACKUP_GITHUB_REPO='test/private';env.BACKUP_GITHUB_TOKEN='test-only';let writes=0;
  globalThis.fetch=async(url,options)=>{if(options.method==='PUT'){writes++;const body=JSON.parse(options.body),archive=JSON.parse(Buffer.from(body.content,'base64').toString());assert.ok(archive.data.ciphertext);assert.equal(archive.data.format,'personnel-scheduled-v1');return new Response('{}',{status:201});}return new Response(JSON.stringify({private:true}));};
  assert.equal((await createScheduledBackup(env)).external.github,true);assert.equal(writes,1);
  globalThis.fetch=async()=>new Response(JSON.stringify({private:false}));await assert.rejects(()=>createScheduledBackup(env),/приватний/);
 }finally{globalThis.fetch=originalFetch;DB.close();}
});

test('Personal preferences are isolated; viewer cannot change accounts or download full archives',async()=>{
  const DB=d1(),env={DB,ADMIN_PASSWORD:'SecureTestPassword123!'};
  try{
    const owner=(await call(env,'login',{body:{login:'admin',password:env.ADMIN_PASSWORD}})).data.token;
    await call(env,'register',{token:owner,body:{login:'reader',password:'ReaderPassword123!',role:'viewer'}});
    let reader=(await call(env,'login',{body:{login:'reader',password:'ReaderPassword123!'}})).data.token;
    const p=await call(env,'profile',{token:reader,body:{theme:'dark',display_name:'Тест'}});assert.equal(p.status,200);assert.equal(p.data.preferences.theme,'dark');assert.equal(p.data.session.active,true);
    assert.equal((await call(env,'profile',{token:owner})).data.preferences.theme,'system');
    assert.equal((await call(env,'profile',{token:reader,body:{theme:'wrong'}})).status,400);
    assert.equal((await call(env,'daily-backups',{token:reader})).status,403);
    const accounts=(await call(env,'users',{token:owner})).data,target=accounts.find(a=>a.login==='reader');
    assert.equal((await call(env,'user-role',{token:reader,body:{id:target.id,role:'editor'}})).status,403);
    assert.equal((await call(env,'user-role',{token:owner,body:{id:target.id,role:'owner'}})).status,403);
    assert.equal((await call(env,'user-role',{token:owner,body:{id:target.id,role:'editor'}})).status,200);
    assert.equal((await call(env,'profile',{token:reader})).status,401);
    assert.equal((await call(env,'full-backup',{token:owner})).data.tables.preferences.length,1);
    assert.throws(()=>validatePreferences({notifications:'false'}));assert.equal(validatePreferences({theme:'light'}).language,DEFAULT_PREFERENCES.language);
  }finally{DB.close();}
});

test('Daily full backups encrypt accounts, verify integrity, retain 30 and reject wrong key',async()=>{
  const DB=d1(),env={DB,BACKUP_KEY:btoa('a'.repeat(32))};
  try{
    for(let i=0;i<31;i++)await createScheduledBackup(env);
    const rows=(await DB.prepare('SELECT * FROM scheduled_backups').all()).results;assert.equal(rows.length,30);
    const packet=await decryptScheduledBackup(rows[0],env.BACKUP_KEY);assert.equal(packet.format,'personnel-full-v1');assert.ok(packet.tables.preferences);
    assert.ok(!rows[0].data.includes('workspace'));await assert.rejects(()=>decryptScheduledBackup(rows[0],btoa('b'.repeat(32))));
    await assert.rejects(()=>decryptScheduledBackup({...rows[0],id:'tampered-id'},env.BACKUP_KEY));
  }finally{DB.close();}
});

function d1(){const db=new DatabaseSync(':memory:');db.exec(readFileSync(new URL('../cloudflare/schema.sql',import.meta.url),'utf8'));function prepared(sql,args=[]){return {bind(...values){return prepared(sql,values);},async first(){return db.prepare(sql).get(...args)||null;},async all(){return {results:db.prepare(sql).all(...args)};},async run(){if(/^SELECT/i.test(sql.trim()))return {results:db.prepare(sql).all(...args),meta:{changes:0}};const info=db.prepare(sql).run(...args);return {meta:{changes:Number(info.changes)}};}};}return {prepare:sql=>prepared(sql),async batch(statements){db.exec('BEGIN IMMEDIATE');try{const result=[];for(const s of statements)result.push(await s.run());db.exec('COMMIT');return result;}catch(e){db.exec('ROLLBACK');throw e;}},close:()=>db.close()};}
function state(){return {title:'Тест',people:[{id:'p1',name:'Тестова людина',callsign:'Тест',rank:'',role:'',unit:'',phone:'',group:'',notes:'',service_since:'2020-01-01',archived:false}],events:[],groups:[],roles:[]};}
async function call(env,path,{body,token,origin}={}){const response=await worker.fetch(new Request('https://api.example/api/'+path,{method:body===undefined?'GET':'POST',headers:{...(body===undefined?{}:{'Content-Type':'application/json'}),...(token?{Authorization:'Bearer '+token}:{}),...(origin?{Origin:origin}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})}),env);return {status:response.status,data:await response.json()};}

test('Worker validates dates, duplicate identities and admin-only event types',()=>{
  assert.equal(validate(state()).people.length,1);
  for(const p of [state().people[0],{...state().people[0],id:'p2',name:' Інша людина '}]){const s=state();s.people.push(p);assert.throws(()=>validate(s));}
  const s=state();s.events=[{id:'e1',person_id:'p1',kind:'Невідомий тип',start:'2026-10-21',end:'2026-10-22'}];assert.throws(()=>validate(s));s.events[0].kind='ВЛК';s.events[0].start='2026-02-30';assert.throws(()=>validate(s));
});
test('Worker end-to-end: first admin, revision conflict, journal, restore and invite rights',async()=>{
  const DB=d1(),env={DB,ADMIN_LOGIN:'admin',ADMIN_PASSWORD:'SecureTestPassword123!',ALLOWED_ORIGINS:'https://frontend.example'};
  try{
    assert.equal((await call(env,'state')).status,401);
    assert.equal((await call(env,'state',{origin:'https://evil.example'})).status,403);
    const login=await call(env,'login',{body:{login:'admin',password:env.ADMIN_PASSWORD}});assert.equal(login.status,200);const token=login.data.token;
    assert.equal((await call(env,'state',{token})).data.state.people.length,0);
    assert.equal((await call(env,'state',{token,body:{state:state(),revision:0,action:'Додано'}})).status,200);
    assert.equal((await call(env,'state',{token,body:{state:state(),revision:0}})).status,409);
    const logs=await call(env,'audit',{token});assert.equal(logs.data[0].details[0].after.name,'Тестова людина');
    const backups=await call(env,'backups',{token});assert.equal(backups.data.length,1);
    assert.equal((await call(env,'restore',{token,body:{id:backups.data[0].id,revision:1}})).data.state.people.length,0);
    const invite=await call(env,'invite',{token,body:{role:'viewer'}});
    const redeemed=await call(env,'redeem',{body:{invitation:invite.data.invitation,login:'viewer',password:'ViewerPassword123!'}});assert.equal(redeemed.status,200);const viewer=redeemed.data.token;
    assert.equal((await call(env,'state',{token:viewer,body:{state:state(),revision:2}})).status,403);
    assert.equal((await call(env,'backups',{token:viewer})).status,403);
    assert.equal((await call(env,'redeem',{body:{invitation:invite.data.invitation,login:'second',password:'ViewerPassword123!'}})).status,403);
    assert.equal((await call(env,'password',{token,body:{old:env.ADMIN_PASSWORD,password:'BrandNewPassword123!'}})).status,200);
    assert.equal((await call(env,'logout',{token,body:{}})).status,200);
    assert.equal((await call(env,'state',{token})).status,401);
  }finally{DB.close();}
});
test('Worker preserves planned dates while return frees subsequent days',()=>{
  const s=state();s.events=[{id:'a',person_id:'p1',kind:'ВЛК',start:'2020-01-01',end:'2020-01-20',returned_on:'2020-01-03',notes:''},{id:'b',person_id:'p1',kind:'Робота',start:'2020-01-03',end:'2020-01-05',notes:''}];assert.equal(validate(s).events[0].end,'2020-01-20');s.events[1].start='2020-01-02';assert.throws(()=>validate(s));
});
test('Worker salts passwords and never contains plaintext',async()=>{const first=await passwordHash('SecureTestPassword123!'),second=await passwordHash('SecureTestPassword123!');assert.notEqual(first,second);assert.ok(!first.includes('SecureTest'));assert.equal(await passwordHash('SecureTestPassword123!',first.split(':')[0]),first);});
test('Cloudflare complete backup includes accounts and atomically restores with session revocation',async()=>{
  const DB=d1(),env={DB,ADMIN_LOGIN:'admin',ADMIN_PASSWORD:'BackupAdminPassword123!',ALLOWED_ORIGINS:''};
  try{
    const owner=await call(env,'login',{body:{login:'admin',password:env.ADMIN_PASSWORD}}),token=owner.data.token;
    assert.equal((await call(env,'register',{token,body:{login:'manual','password':'ManualPassword123!','role':'editor'}})).status,200);
    const backup=(await call(env,'full-backup',{token})).data;assert.equal(backup.tables.users.length,2);assert.equal(backup.tables.workspace.length,1);
    const result=await call(env,'full-restore',{token,body:{backup,revision:0,confirm:'ВІДНОВИТИ БАЗУ'}});assert.equal(result.status,200,JSON.stringify(result));assert.ok(result.data.sign_in_again);
    assert.equal((await call(env,'state',{token})).status,401);
    assert.equal((await call(env,'login',{body:{login:'manual',password:'ManualPassword123!'}})).status,200);
  }finally{DB.close();}
});
test('General class grade integrity and administrative board validation',()=>{
  const data=state();data.people[0].category='Новобранець';data.classes=[{id:'c1',day:'2026-10-21',title:'Документообіг',teacher:'Тест',notes:''}];data.grades=[{id:'g1',class_id:'c1',person_id:'p1',score:75,notes:''}];data.admin_tasks=[{id:'t1',title:'Оновити документи',due:'2026-10-22',owner:'Адміністратор',status:'Заплановано',notes:''}];
  assert.equal(validate(data).grades[0].score,75);assert.equal(validate(data).people[0].category,'Новобранець');data.grades[0].class_id='missing';assert.throws(()=>validate(data));
});


test('Chat enforces membership, keeps authors, avoids duplicate sends, tracks unread and includes backup history',async()=>{
 const DB=d1(),env={DB,ADMIN_PASSWORD:'SecureTestPassword123!'};
 try{
  const owner=(await call(env,'login',{body:{login:'admin',password:env.ADMIN_PASSWORD}})).data.token;
  await call(env,'register',{token:owner,body:{login:'colleague',password:'ColleaguePassword123!',role:'editor'}});
  const colleague=(await call(env,'login',{body:{login:'colleague',password:'ColleaguePassword123!'}})).data.token;
  assert.equal((await call(env,'chat/status',{token:colleague})).data.allowed,false);
  assert.equal((await call(env,'chat/messages',{token:colleague})).status,403);
  const accounts=(await call(env,'users',{token:owner})).data,target=accounts.find(u=>u.login==='colleague');
  assert.equal((await call(env,'chat/members',{token:colleague,body:{id:target.id,allowed:true}})).status,403);
  assert.equal((await call(env,'chat/members',{token:owner,body:{id:target.id,allowed:true}})).status,200);
  const payload={body:'<script>alert(1)</script> Тест',client_id:'test-message-001',author_id:'fake'};
  const sent=await call(env,'chat/messages',{token:owner,body:payload});assert.equal(sent.status,200);assert.equal(sent.data.author_login,'admin');assert.notEqual(sent.data.author_id,'fake');
  assert.equal((await call(env,'chat/messages',{token:owner,body:payload})).data.id,sent.data.id);
  assert.equal((await call(env,'chat/messages',{token:owner,body:{body:' ',client_id:'test-message-002'}})).status,400);
  assert.equal((await call(env,'chat/status',{token:colleague})).data.unread,1);
  assert.equal((await call(env,'chat/read',{token:colleague,body:{last_id:sent.data.id+1}})).status,400);
  assert.equal((await call(env,'chat/read',{token:colleague,body:{last_id:sent.data.id}})).status,200);
  assert.equal((await call(env,'chat/status',{token:colleague})).data.unread,0);
  assert.equal((await call(env,'chat/messages?after='+sent.data.id,{token:owner})).data.messages.length,0);
  assert.equal((await call(env,'full-backup',{token:owner})).data.tables.chat_messages.length,1);
  await call(env,'chat/members',{token:owner,body:{id:target.id,allowed:false}});
  assert.equal((await call(env,'chat/messages',{token:colleague})).status,403);
 }finally{DB.close();}
});

test('Worker rejects new work versus absence conflicts without advancing revision',async()=>{const DB=d1(),env={DB,ADMIN_PASSWORD:'SecureTestPassword123!'};try{const owner=(await call(env,'login',{body:{login:'admin',password:env.ADMIN_PASSWORD}})).data.token,state={title:'Тест',people:[{id:'p',name:'Основний'}],groups:[],roles:[],events:[],warehouses:[{id:'w',name:'ВП1'}],shifts:[{id:'s',warehouse_id:'w',warehouse_name:'ВП1',group:'',status:'Заплановано',start:'2026-10-21T05:00:00.000Z',end:'2026-10-25T17:00:00.000Z',members:[{id:'p',name:'Основний'}],responsible_id:'',notes:''}]};const saved=await call(env,'state',{token:owner,body:{state,revision:0}});assert.equal(saved.status,200);const invalid=structuredClone(saved.data.state);invalid.events=[{id:'e',person_id:'p',kind:'Відпустка',start:'2026-10-23',end:'2026-10-24',notes:'',cancelled:false,returned_on:''}];const failed=await call(env,'state',{token:owner,body:{state:invalid,revision:1}});assert.equal(failed.status,400);assert.match(failed.data.error,/Основний.*Відпустка.*ВП1/);const read=await call(env,'state',{token:owner});assert.equal(read.data.revision,1);assert.equal(read.data.state.events.length,0);}finally{DB.close();}});


test('Share tokens allow only bounded read-only work projection and can be revoked or expire',async()=>{const DB=d1(),env={DB,ADMIN_PASSWORD:'SecureTestPassword123!'};try{
 const owner=(await call(env,'login',{body:{login:'admin',password:env.ADMIN_PASSWORD}})).data.token;
 const state={title:'PRIVATE',people:[{id:'p',name:'Перегляд',phone:'SECRET',group:'А'}],groups:['А'],roles:[],events:[],warehouses:[{id:'w',name:'ВП 1',address:'SECRET'}],shifts:[{id:'s',warehouse_id:'w',group:'А',start:'2026-10-21T05:00:00.000Z',end:'2026-11-05T17:00:00.000Z',status:'Заплановано',members:[{id:'p',name:'Перегляд'}],notes:'PRIVATE'}]};assert.equal((await call(env,'state',{token:owner,body:{state,revision:0}})).status,200);
 const created=await call(env,'schedule-links',{token:owner,body:{month:'2026-10',group:'А',days:7}});assert.equal(created.status,200);const token=created.data.token;assert.match(token,/^[a-f0-9]{64}$/);
 const publicCall=async(path,method='GET')=>worker.fetch(new Request('https://api.example/api/'+path,{method,headers:{Authorization:'Share '+token,...(method==='POST'?{'Content-Type':'application/json'}:{})},...(method==='POST'?{body:'{}'}:{})}),env);
 const read=await publicCall('shared-schedule');assert.equal(read.status,200);const text=await read.text();assert.ok(!text.includes('SECRET')&&!text.includes('PRIVATE'));assert.equal((await publicCall('state')).status,401);assert.equal((await publicCall('state','POST')).status,401);assert.equal((await publicCall('audit')).status,401);assert.equal((await publicCall('schedule-links')).status,401);assert.equal((await publicCall('shared-schedule','POST')).status,401);assert.equal((await call(env,'shared-schedule')).status,404);
 assert.ok(!JSON.stringify((await call(env,'schedule-links',{token:owner})).data).includes(token));await call(env,'register',{token:owner,body:{login:'viewshare',password:'ReadonlyPassword123!',role:'viewer'}});const viewer=(await call(env,'login',{body:{login:'viewshare',password:'ReadonlyPassword123!'}})).data.token;assert.equal((await call(env,'schedule-links',{token:viewer,body:{month:'2026-10'}})).status,403);
 await call(env,'schedule-links',{token:owner,body:{revoke:created.data.id}});assert.equal((await publicCall('shared-schedule')).status,404);await DB.prepare('UPDATE schedule_links SET revoked=0,expires=0 WHERE id=?').bind(created.data.id).run();assert.equal((await publicCall('shared-schedule')).status,404);
 }finally{DB.close();}});
