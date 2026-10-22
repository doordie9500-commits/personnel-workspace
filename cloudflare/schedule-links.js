import {shareScope,sharedSchedule} from '../web/shared-schedule.js';
export class ShareError extends Error{constructor(message,status=400){super(message);this.status=status;}}
const stmt=(db,sql,...args)=>db.prepare(sql).bind(...args),now=()=>Math.floor(Date.now()/1000);
const digest=async token=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token))),v=>v.toString(16).padStart(2,'0')).join('');
export async function publicSchedule(db,request){
 const token=request.headers.get('Authorization')?.match(/^Share ([a-f0-9]{64})$/)?.[1];if(!token)throw new ShareError('Посилання недійсне або вимкнене.',404);
 const link=await stmt(db,'SELECT scope,expires FROM schedule_links WHERE token_hash=? AND revoked=0 AND expires>?',await digest(token),now()).first();if(!link)throw new ShareError('Строк посилання минув або його вимкнули.',404);
 const row=await stmt(db,'SELECT data FROM workspace WHERE id=1').first();return {state:sharedSchedule(JSON.parse(row.data),JSON.parse(link.scope)),expires:link.expires};
}
export async function scheduleLinks(db,user,post,body){
 if(user.role!=='owner')throw new ShareError('Посиланнями керує адміністратор.',403);
 if(!post)return (await stmt(db,'SELECT id,created,expires,scope,revoked FROM schedule_links ORDER BY created DESC LIMIT 100').all()).results.map(r=>({...r,scope:JSON.parse(r.scope)}));
 if(body.revoke){await db.batch([stmt(db,'UPDATE schedule_links SET revoked=1 WHERE id=?',String(body.revoke)),stmt(db,'INSERT INTO audit(created,actor,action,details) VALUES(?,?,?,?)',new Date().toISOString(),user.login,'Вимкнено посилання на графік','[]')]);return {ok:true};}
 let scope;try{scope=shareScope(body);}catch(e){throw new ShareError(e.message);}
 const token=Array.from(crypto.getRandomValues(new Uint8Array(32)),v=>v.toString(16).padStart(2,'0')).join(''),id=crypto.randomUUID(),expires=now()+scope.days*86400;
 await db.batch([stmt(db,'INSERT INTO schedule_links(id,token_hash,created,expires,scope,revoked) VALUES(?,?,?,?,?,0)',id,await digest(token),new Date().toISOString(),expires,JSON.stringify(scope)),stmt(db,'INSERT INTO audit(created,actor,action,details) VALUES(?,?,?,?)',new Date().toISOString(),user.login,'Створено посилання на графік',JSON.stringify([{id,scope,expires}]))]);return {id,token,expires};
}
