import {onlyGroupRename} from './group-rename.js';
export const SHIFT_TABLES=['warehouses','shifts'];
export const STATUSES=['Заплановано','Виїжджають','Прибули на склад','Працюють','Завершили зміну','Вихідний','Скасовано'];
export const active=s=>!['Завершили зміну','Вихідний','Скасовано'].includes(s.status);
export const hours=s=>s.status==='Завершили зміну'&&s.actual_end?Math.max(0,(Date.parse(s.actual_end)-Date.parse(s.start))/3600000):0;
const text=(v,max=200,required=false)=>{if(typeof v!=='string'||v.length>max||(required&&!v.trim()))throw Error('Перевірте поля зміни або складу.');return v.trim();};
const instant=v=>{if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/.test(v)||!Number.isFinite(Date.parse(v))||new Date(v).toISOString().slice(0,19)!==v.slice(0,19))throw Error('Некоректний час зміни.');return new Date(v).toISOString();};
export function validateShifts(raw){
 const out={warehouses:[],shifts:[]},ids=new Set(),names=new Set();
 for(const key of SHIFT_TABLES)if(!Array.isArray(raw[key]??[])||(raw[key]??[]).length>(key==='shifts'?12000:300))throw Error('Некоректна або завелика таблиця '+key);
 for(const w of raw.warehouses??[]){if(!w||typeof w!=='object')throw Error('Некоректний склад.');const item={id:text(w.id,200,true),name:text(w.name,200,true),number:text(w.number??'',100),address:text(w.address??'',500),archived:w.archived??false};if(typeof item.archived!=='boolean'||ids.has(item.id)||names.has(item.name.toLocaleLowerCase('uk')))throw Error('Повторення складу або некоректний архів.');ids.add(item.id);names.add(item.name.toLocaleLowerCase('uk'));out.warehouses.push(item);}
 const shiftIds=new Set(),periods=new Map();
 for(const s of raw.shifts??[]){if(!s||typeof s!=='object')throw Error('Некоректна зміна.');const item={id:text(s.id,200,true),warehouse_id:text(s.warehouse_id,200,true),warehouse_name:text(s.warehouse_name,200,true),group:text(s.group??'',100),start:instant(s.start),end:instant(s.end),actual_end:s.actual_end?instant(s.actual_end):'',status:text(s.status,100,true),responsible_id:text(s.responsible_id??'',200),notes:text(s.notes??'',2000)};
 if(shiftIds.has(item.id)||!ids.has(item.warehouse_id)||!STATUSES.includes(item.status)||item.end<=item.start)throw Error('Перевірте склад і статус; завершення має бути після початку.');shiftIds.add(item.id);
 if((item.status==='Завершили зміну')!==!!item.actual_end||(item.actual_end&&item.actual_end<=item.start))throw Error('Завершена зміна потребує фактичного часу після початку.');
 if(!Array.isArray(s.members)||!s.members.length||s.members.length>3000)throw Error('Виберіть працівників.');const memberIds=new Set();item.members=s.members.map(p=>{const m={id:text(p.id,200,true),name:text(p.name,200,true)};for(const key of ['role','callsign'])if(Object.hasOwn(p,key))m[key]=text(p[key],200);if(Object.hasOwn(p,'trainee')){if(typeof p.trainee!=='boolean')throw Error('Некоректна позначка стажера.');m.trainee=p.trainee;m.trainee_reason=text(p.trainee_reason??'',500,m.trainee);}if(memberIds.has(m.id))throw Error('Повторення працівника.');memberIds.add(m.id);return m;});if(item.responsible_id&&!memberIds.has(item.responsible_id))throw Error('Відповідальний має входити до зміни.');
 if(!['Скасовано','Вихідний'].includes(item.status))for(const m of item.members){const entries=periods.get(m.id)||[],end=item.actual_end||item.end;if(entries.some(([a,b])=>a<end&&item.start<b))throw Error('Зміни працівника перетинаються: '+m.name);entries.push([item.start,end]);periods.set(m.id,entries);}
 for(const k of ['created_by','created_at','updated_by','updated_at'])item[k]=text(s[k]??'',200);out.shifts.push(item);
 }
 for(const w of out.warehouses)if(w.archived&&out.shifts.some(s=>s.warehouse_id===w.id&&active(s)))throw Error('Спочатку завершіть або перенесіть активні зміни складу.');
 return out;
}
export function prepareShifts(raw,before,user,now=new Date().toISOString()){
 for(const key of SHIFT_TABLES)if(!Object.hasOwn(raw,key))raw[key]=structuredClone(before[key]||[]);
 const old=new Map((before.shifts||[]).map(s=>[s.id,s])),people=new Map(raw.people.map(p=>[p.id,p]));
 for(const s of raw.shifts){const previous=old.get(s.id);if(previous&&JSON.stringify(s)===JSON.stringify(previous))continue;
   if(onlyGroupRename(previous,s,before,raw)){s.updated_by=user.id;s.updated_at=now;continue;}
   if(previous&&['Завершили зміну','Скасовано'].includes(previous.status)&&user.role!=='owner')throw Error('Історична зміна доступна лише для перегляду.');
   for(const m of s.members||[]){if(!people.has(m.id)||people.get(m.id).archived){if(user.role!=='owner'||!(before.shifts||[]).some(old=>old.members.some(x=>x.id===m.id&&x.name===m.name)))throw Error('Виберіть активного працівника.');}else m.name=people.get(m.id).name;for(const key of ['role','callsign']){const snapshot=previous?.members.find(x=>x.id===m.id);m[key]=m[key]??snapshot?.[key]??people.get(m.id)?.[key]??'';}}
   for(const m of s.members||[]){const person=people.get(m.id),snapshot=previous?.members.find(x=>x.id===m.id),newRole=person&&person.role&&m.role&&person.role!==m.role;m.trainee=m.trainee??snapshot?.trainee??(person?.category==='Стажер'||!!newRole);m.trainee_reason=m.trainee?(m.trainee_reason||snapshot?.trainee_reason||(newRole?'Нова посада: '+m.role:person?.trainee_reason||'Новий працівник')):'';}
   s.warehouse_name=(raw.warehouses||[]).find(w=>w.id===s.warehouse_id)?.name||'';
   s.created_by=previous?.created_by||user.id;s.created_at=previous?.created_at||now;s.updated_by=user.id;s.updated_at=now;
 }
 if(user.role!=='owner'&&[...old.keys()].some(id=>!raw.shifts.some(s=>s.id===id)))throw Error('Історію змін не можна видаляти. Скористайтеся скасуванням.');
 return raw;
}
