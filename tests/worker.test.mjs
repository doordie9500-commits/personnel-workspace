import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import worker,{validate,passwordHash} from '../cloudflare/worker.js';

function d1(){const db=new DatabaseSync(':memory:');db.exec(readFileSync(new URL('../cloudflare/schema.sql',import.meta.url),'utf8'));function prepared(sql,args=[]){return {bind(...values){return prepared(sql,values);},async first(){return db.prepare(sql).get(...args)||null;},async all(){return {results:db.prepare(sql).all(...args)};},async run(){if(/^SELECT/i.test(sql.trim()))return {results:db.prepare(sql).all(...args),meta:{changes:0}};const info=db.prepare(sql).run(...args);return {meta:{changes:Number(info.changes)}};}};}return {prepare:sql=>prepared(sql),async batch(statements){db.exec('BEGIN IMMEDIATE');try{const result=[];for(const s of statements)result.push(await s.run());db.exec('COMMIT');return result;}catch(e){db.exec('ROLLBACK');throw e;}},close:()=>db.close()};}
function state(){return {title:'Тест',people:[{id:'p1',name:'Тестова людина',callsign:'Тест',rank:'',role:'',unit:'',phone:'',group:'',notes:'',service_since:'2020-01-01',archived:false}],events:[],groups:[],roles:[]};}
async function call(env,path,{body,token,origin}={}){const response=await worker.fetch(new Request('https://api.example/api/'+path,{method:body===undefined?'GET':'POST',headers:{...(body===undefined?{}:{'Content-Type':'application/json'}),...(token?{Authorization:'Bearer '+token}:{}),...(origin?{Origin:origin}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})}),env);return {status:response.status,data:await response.json()};}

test('Worker validates dates, duplicate identities and admin-only event types',()=>{
  assert.equal(validate(state()).people.length,1);
  for(const p of [state().people[0],{...state().people[0],id:'p2',name:' Інша людина '}]){const s=state();s.people.push(p);assert.throws(()=>validate(s));}
  const s=state();s.events=[{id:'e1',person_id:'p1',kind:'На позиції',start:'2026-10-21',end:'2026-10-22'}];assert.throws(()=>validate(s));s.events[0].kind='ВЛК';s.events[0].start='2026-02-30';assert.throws(()=>validate(s));
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
