// Free-tier API for GitHub Pages. No secrets or personnel records in this file.
const KINDS=['Робота','Відпустка','КЗВ','Лікарня','Лікарняний','ВЛК','Реабілітація'];
const enc=new TextEncoder(),uuid=()=>crypto.randomUUID(),ts=()=>Math.floor(Date.now()/1000),now=()=>new Date().toISOString();
const today=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Kyiv'}).format(new Date());
const daynum=d=>Date.parse(d+'T00:00:00Z')/86400000,daystr=n=>new Date(n*86400000).toISOString().slice(0,10);
class Problem extends Error{constructor(message,status=400){super(message);this.status=status;}}
function text(s,max=200,required=false){if(typeof s!=='string'||s.length>max||(required&&!s.trim()))throw new Problem('Перевірте обов’язкові поля та довжину тексту.');return s.trim();}
function day(s,optional=false){if(optional&&s==='')return '';if(typeof s!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(s)||!Number.isFinite(daynum(s))||daystr(daynum(s))!==s)throw new Problem('Некоректна дата. Потрібно РРРР-ММ-ДД.');return s;}
export function validate(raw){
  if(!raw||typeof raw!=='object'||['people','events','groups','roles'].some(k=>!Array.isArray(raw[k])))throw new Problem('Неправильний формат кадрової бази.');
  if(raw.people.length>3000||raw.events.length>12000)throw new Problem('Ліміт: 3000 людей і 12000 кадрових періодів.');
  const result={title:text(raw.title,100,true),people:[],events:[],groups:[],roles:[]};
  for(const key of ['groups','roles']){if(raw[key].length>300)throw new Problem('Забагато записів довідника.');const used=new Set();for(const s of raw[key]){const v=text(s,100,true),normalized=v.toLocaleLowerCase('uk');if(used.has(normalized))throw new Problem('Повторення назви в довіднику.');used.add(normalized);result[key].push(v);}}
  const ids=new Set(),names=new Set(),calls=new Set();
  for(const item of raw.people){if(!item||typeof item!=='object')throw new Problem('Некоректна картка.');const p={};for(const k of ['id','name','callsign','rank','role','unit','phone','group','notes'])p[k]=text(item[k]??'',k==='notes'?2000:200,['id','name'].includes(k));p.service_since=day(item.service_since??'',true);p.archived=item.archived??false;if(typeof p.archived!=='boolean')throw new Problem('Некоректна ознака архіву.');const n=p.name.replace(/\s+/g,' ').toLocaleLowerCase('uk'),c=p.callsign.toLocaleLowerCase('uk');if(ids.has(p.id)||names.has(n))throw new Problem('Людина вже існує: '+p.name);if(c&&calls.has(c))throw new Problem('Позивний уже використовується.');if(p.group&&!result.groups.includes(p.group))throw new Problem('Невідома група.');if(p.role&&!result.roles.includes(p.role))throw new Problem('Невідома посада.');ids.add(p.id);names.add(n);if(c)calls.add(c);result.people.push(p);}
  const eventIds=new Set(),periods=new Map();
  for(const item of raw.events){if(!item||typeof item!=='object')throw new Problem('Некоректна подія.');const e={};for(const k of ['id','person_id','kind','notes'])e[k]=text(item[k]??'',k==='notes'?2000:200,k!=='notes');e.start=day(item.start);e.end=day(item.end);e.returned_on=day(item.returned_on??'',true);e.cancelled=item.cancelled??false;if(typeof e.cancelled!=='boolean'||eventIds.has(e.id)||!ids.has(e.person_id)||!KINDS.includes(e.kind))throw new Problem('Перевірте людину та тип події.');if(e.end<e.start)throw new Problem('Кінець раніше початку.');if(e.returned_on&&(e.kind==='Робота'||e.returned_on<e.start||e.returned_on>today()))throw new Problem('Некоректна дата повернення з відсутності.');const end=e.returned_on&&e.returned_on<=e.end?daystr(daynum(e.returned_on)-1):e.end;if(!e.cancelled&&end>=e.start){const previous=periods.get(e.person_id)||[];if(previous.some(([a,b])=>a<=end&&e.start<=b))throw new Problem('Періоди цієї людини перетинаються.');previous.push([e.start,end]);periods.set(e.person_id,previous);}eventIds.add(e.id);result.events.push(e);}
  return result;
}
export function diff(before,after){const changes=[];for(const key of ['people','events']){const a=new Map(before[key].map(v=>[v.id,v])),b=new Map(after[key].map(v=>[v.id,v]));for(const id of new Set([...a.keys(),...b.keys()]))if(JSON.stringify(a.get(id))!==JSON.stringify(b.get(id)))changes.push({table:key,id,before:a.get(id)||null,after:b.get(id)||null});}for(const key of ['groups','roles','title'])if(JSON.stringify(before[key])!==JSON.stringify(after[key]))changes.push({table:key,before:before[key],after:after[key]});return changes;}
const hex=bytes=>Array.from(new Uint8Array(bytes),v=>v.toString(16).padStart(2,'0')).join('');
const unhex=s=>Uint8Array.from(s.match(/../g)||[],v=>parseInt(v,16));
async function hash(s){return hex(await crypto.subtle.digest('SHA-256',enc.encode(s)));}
function equal(a,b){if(a.length!==b.length)return false;let n=0;for(let i=0;i<a.length;i++)n|=a.charCodeAt(i)^b.charCodeAt(i);return n===0;}
export async function passwordHash(password,salt){if(typeof password!=='string'||password.length<12||password.length>256)throw new Problem('Пароль має містити 12–256 символів.');salt=salt||hex(crypto.getRandomValues(new Uint8Array(16)));const key=await crypto.subtle.importKey('raw',enc.encode(password),'PBKDF2',false,['deriveBits']);const bits=await crypto.subtle.deriveBits({name:'PBKDF2',salt:unhex(salt),iterations:100000,hash:'SHA-256'},key,256);return salt+':'+hex(bits);}
async function passwordOK(password,encoded){try{return equal(await passwordHash(password,encoded.split(':')[0]),encoded);}catch{return false;}}
function randomToken(){return hex(crypto.getRandomValues(new Uint8Array(32)));}
const stmt=(db,sql,...args)=>db.prepare(sql).bind(...args);
async function limit(db,key){const time=ts();await stmt(db,'INSERT INTO attempts(key,count,reset) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN reset>? THEN count+1 ELSE 1 END,reset=CASE WHEN reset>? THEN reset ELSE ? END',key,time+900,time,time,time+900).run();const row=await stmt(db,'SELECT count FROM attempts WHERE key=?',key).first();if(row.count>15)throw new Problem('Забагато спроб. Спробуйте через 15 хвилин.',429);}
async function identity(request,db){const token=request.headers.get('Authorization')?.replace(/^Bearer /,'')||'';const user=await stmt(db,'SELECT u.id,u.login,u.role FROM users u JOIN sessions s ON s.user_id=u.id WHERE s.token=? AND s.expires>? AND u.active=1',await hash(token),ts()).first();if(!user)throw new Problem('Увійдіть у систему.',401);return {user,token};}
async function read(db){const row=await stmt(db,'SELECT * FROM workspace WHERE id=1').first();if(!row)throw new Problem('Спочатку застосуйте cloudflare/schema.sql у базі D1.',503);return {revision:row.revision,state:JSON.parse(row.data),today:today(),version:'2.1.1'};}
async function login(db,env,body,ip){
  const name=String(body.login||'').trim().toLocaleLowerCase('uk');await limit(db,'ip:'+ip);await limit(db,'login:'+name);
  let user=await stmt(db,'SELECT * FROM users WHERE login=? AND active=1',name).first();
  if(!user&&name===(env.ADMIN_LOGIN||'admin')&&env.ADMIN_PASSWORD&&typeof body.password==='string'&&equal(body.password,env.ADMIN_PASSWORD)){
    const count=await stmt(db,'SELECT count(*) count FROM users').first();
    if(!count.count){await stmt(db,'INSERT OR IGNORE INTO users VALUES(?,?,?,?,1)',uuid(),name,await passwordHash(body.password),'owner').run();user=await stmt(db,'SELECT * FROM users WHERE login=? AND active=1',name).first();}
  }
  const encoded=user?.password||'00'.repeat(16)+':'+'00'.repeat(32);
  if(!await passwordOK(body.password,encoded)||!user)throw new Problem('Неправильний логін або пароль.',401);
  const token=randomToken();await stmt(db,'INSERT INTO sessions VALUES(?,?,?)',await hash(token),user.id,ts()+8*3600).run();return {token,user:{id:user.id,login:user.login,role:user.role}};
}
async function commit(db,user,body,restore=false){
  if(user.role==='viewer')throw new Problem('Доступ лише для перегляду.',403);if(restore&&user.role!=='owner')throw new Problem('Потрібен адміністратор.',403);
  const row=await stmt(db,'SELECT * FROM workspace WHERE id=1').first();if(!Number.isSafeInteger(body.revision)||body.revision!==row.revision)throw new Problem('Базу змінив інший користувач. Оновіть дані.',409);
  let raw=body.state;if(restore){const b=await stmt(db,'SELECT data FROM backups WHERE id=?',body.id).first();if(!b)throw new Problem('Копію не знайдено.',404);raw=JSON.parse(b.data);}
  const state=validate(raw),details=diff(JSON.parse(row.data),state);if(!details.length)return read(db);
  const timestamp=now(),action=restore?'Відновлення резервної копії':text(body.action||'Оновлення',150,true);
  const result=await db.batch([
    stmt(db,'INSERT INTO backups(id,created,actor,revision,data) SELECT ?,?,?,revision,data FROM workspace WHERE id=1 AND revision=?',uuid(),timestamp,user.login,body.revision),
    stmt(db,'INSERT INTO audit(created,actor,action,details) SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM workspace WHERE id=1 AND revision=?)',timestamp,user.login,action,JSON.stringify(details),body.revision),
    stmt(db,'UPDATE workspace SET revision=revision+1,data=? WHERE id=1 AND revision=?',JSON.stringify(state),body.revision)
  ]);
  if(!result[2].meta.changes)throw new Problem('Базу змінив інший користувач. Оновіть дані.',409);
  await stmt(db,'DELETE FROM backups WHERE id NOT IN (SELECT id FROM backups ORDER BY rowid DESC LIMIT 100)').run();
  return read(db);
}
async function route(request,env){
  const db=env.DB;if(!db)throw new Problem('Не налаштовано прив’язку D1 DB.',503);const url=new URL(request.url),path=url.pathname,post=request.method==='POST';let body={};
  if(post){if(!request.headers.get('Content-Type')?.startsWith('application/json'))throw new Problem('Очікується JSON.',415);if(Number(request.headers.get('Content-Length'))>2000000)throw new Problem('Запит завеликий.',413);const raw=await request.text();if(raw.length>2000000)throw new Problem('Запит завеликий.',413);try{body=JSON.parse(raw);}catch{throw new Problem('Некоректний JSON.');}if(!body||typeof body!=='object'||Array.isArray(body))throw new Problem('Очікується об’єкт JSON.');}
  if(path==='/api/health'&&!post)return {ok:true,version:'2.1.1'};
  const ip=request.headers.get('CF-Connecting-IP')||'unknown';
  if(path==='/api/login'&&post)return login(db,env,body,ip);
  if(path==='/api/redeem'&&post){await limit(db,'invite:'+ip);const token=await hash(String(body.invitation||'')),name=text(body.login,100,true).toLocaleLowerCase('uk'),encoded=await passwordHash(body.password),invite=await stmt(db,'SELECT * FROM invitations WHERE token=? AND used=0 AND expires>?',token,ts()).first();if(!invite)throw new Problem('Запрошення недійсне або прострочене.',403);if(await stmt(db,'SELECT id FROM users WHERE login=?',name).first())throw new Problem('Цей логін уже існує.');const id=uuid();try{const result=await db.batch([stmt(db,'INSERT INTO users(id,login,password,role,active) SELECT ?,?,?,role,1 FROM invitations WHERE token=? AND used=0 AND expires>?',id,name,encoded,token,ts()),stmt(db,'UPDATE invitations SET used=1 WHERE token=? AND EXISTS(SELECT 1 FROM users WHERE id=?)',token,id),stmt(db,'INSERT INTO audit(created,actor,action,details) SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM users WHERE id=?)',now(),name,'Прийнято запрошення','[]',id)]);if(!result[0].meta.changes)throw new Problem('Запрошення вже використане.',403);}catch(e){if(e instanceof Problem)throw e;throw new Problem('Не вдалося прийняти запрошення. Перевірте логін.');}return login(db,env,body,ip);}
  const {user,token}=await identity(request,db);
  if(path==='/api/update'&&!post){if(user.role!=='owner')throw new Problem('Доступ адміністратора.',403);return {current:'2.1.1',supported:false,enabled:false,state:'web',message:'Вебсайт оновлюється автоматично через GitHub Pages. Автооновлення EXE доступне у Windows-програмі 2.1.1 або новішій.'};}
  if(path==='/api/state'&&!post)return {...await read(db),user};
  if(path==='/api/state'&&post)return commit(db,user,body);
  if(path==='/api/restore'&&post)return commit(db,user,body,true);
  if(path==='/api/logout'&&post){await stmt(db,'DELETE FROM sessions WHERE token=?',await hash(token)).run();return {ok:true};}
  if(path==='/api/password'&&post){const row=await stmt(db,'SELECT password FROM users WHERE id=?',user.id).first();if(!await passwordOK(body.old,row.password))throw new Problem('Поточний пароль неправильний.',403);await db.batch([stmt(db,'UPDATE users SET password=? WHERE id=?',await passwordHash(body.password),user.id),stmt(db,'DELETE FROM sessions WHERE user_id=? AND token!=?',user.id,await hash(token)),stmt(db,'INSERT INTO audit(created,actor,action,details) VALUES(?,?,?,?)',now(),user.login,'Змінено пароль','[]')]);return {ok:true};}
  if(path==='/api/audit'&&!post){const offset=Math.min(1000000,Math.max(0,parseInt(url.searchParams.get('offset')||'0')||0)),rows=await stmt(db,'SELECT * FROM audit ORDER BY id DESC LIMIT 100 OFFSET ?',offset).all();return rows.results.map(r=>({...r,details:JSON.parse(r.details)}));}
  if(path==='/api/backups'&&!post){if(user.role!=='owner')throw new Problem('Доступ адміністратора.',403);return (await stmt(db,'SELECT id,created,actor,revision FROM backups ORDER BY rowid DESC LIMIT 100').all()).results;}
  if(path==='/api/invite'&&post){if(user.role!=='owner'||!['viewer','editor'].includes(body.role))throw new Problem('Доступ адміністратора.',403);const invitation=randomToken();await db.batch([stmt(db,'INSERT INTO invitations VALUES(?,?,?,0)',await hash(invitation),body.role,ts()+48*3600),stmt(db,'INSERT INTO audit(created,actor,action,details) VALUES(?,?,?,?)',now(),user.login,'Створено запрошення: '+body.role,'[]')]);return {invitation,hours:48};}
  if(path==='/api/users'&&!post){if(user.role!=='owner')throw new Problem('Доступ адміністратора.',403);return (await stmt(db,'SELECT id,login,role,active FROM users').all()).results;}
  if(path==='/api/users'&&post){if(user.role!=='owner'||body.id===user.id)throw new Problem('Не можна змінити власний доступ.',403);const target=await stmt(db,'SELECT login,role FROM users WHERE id=?',body.id).first();if(!target||target.role==='owner')throw new Problem('Користувача не знайдено.');await db.batch([stmt(db,'UPDATE users SET active=? WHERE id=?',body.active?1:0,body.id),stmt(db,'DELETE FROM sessions WHERE user_id=?',body.id),stmt(db,'INSERT INTO audit(created,actor,action,details) VALUES(?,?,?,?)',now(),user.login,'Змінено доступ: '+target.login,JSON.stringify([{after:!!body.active}]))]);return {ok:true};}
  throw new Problem('Маршрут не знайдено.',404);
}
export default {async fetch(request,env,ctx){
  const origin=request.headers.get('Origin'),allowed=(env.ALLOWED_ORIGINS||'').split(',').map(s=>s.trim()),headers={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'};
  if(origin&&allowed.includes(origin)){headers['Access-Control-Allow-Origin']=origin;headers.Vary='Origin';}
  try{if(origin&&!allowed.includes(origin))throw new Problem('Цей сайт не має доступу до API.',403);if(request.method==='OPTIONS')return new Response(null,{status:204,headers:{...headers,'Access-Control-Allow-Methods':'GET,POST,OPTIONS','Access-Control-Allow-Headers':'Authorization,Content-Type'}});if(!['GET','POST'].includes(request.method))throw new Problem('Метод не підтримується.',405);const data=await route(request,env);if(ctx&&env.DB)ctx.waitUntil(Promise.all([stmt(env.DB,'DELETE FROM sessions WHERE expires<?',ts()).run(),stmt(env.DB,'DELETE FROM attempts WHERE reset<?',ts()).run()]));return new Response(JSON.stringify(data),{headers});}catch(e){return new Response(JSON.stringify({error:e instanceof Problem?e.message:'Помилка API. Перевірте D1 та журнал Worker.'}),{status:e instanceof Problem?e.status:500,headers});}
}};
