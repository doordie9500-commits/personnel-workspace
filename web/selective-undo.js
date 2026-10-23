const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const metadata=new Set(['updated_at','updated_by']);
const scalar=new Set(['title','groups','roles','group_colors']);
/** Build an atomic inverse against the current state; never replace unrelated fields. */
export function reverseChange(state,details){
 const next=structuredClone(state);let changed=false;
 const fail=label=>{throw Error('Неможливо скасувати: '+label+'. Ці дані вже змінені або не підтримують окреме скасування.');};
 for(const d of details){
  const {table,before,after}=d;if(!table)fail('службова дія');
  if(table==='people_order')continue;
  if(d.id!==undefined){
   const rows=next[table];if(!Array.isArray(rows)||rows.some(r=>!r||typeof r!=='object'||!r.id))fail(table);
   const index=rows.findIndex(r=>r.id===d.id),current=rows[index];
   if(before==null){
    if(table==='people')throw Error('Створення особової картки не скасовується тут. Видаляйте людину лише через «Особовий склад».');
    if(!current||!equal(current,after))fail(table+' · '+d.id);rows.splice(index,1);changed=true;
   }else if(after==null){if(current)fail(table+' · '+d.id);rows.push(structuredClone(before));changed=true;}
   else{
    if(!current)fail(table+' · '+d.id);
    for(const field of new Set([...Object.keys(before),...Object.keys(after)])){
     if(metadata.has(field)||equal(before[field],after[field]))continue;
     if(!equal(current[field],after[field]))fail(table+' · '+(current.callsign||current.name||d.id)+' · '+field);
     if(Object.hasOwn(before,field))current[field]=structuredClone(before[field]);else delete current[field];changed=true;
    }
   }
  }else{
   if(!scalar.has(table)||!equal(next[table],after))fail(table);next[table]=structuredClone(before);changed=true;
  }
 }
 const order=details.find(d=>d.table==='people_order');
 if(order){
  const ids=state.people.map(p=>p.id),remaining=new Set(order.after),relative=ids.filter(id=>remaining.has(id));
  if(!equal(relative,order.after.filter(id=>ids.includes(id))))fail('порядок людей');
  const byId=new Map(next.people.map(p=>[p.id,p]));next.people=[...order.before.filter(id=>byId.has(id)).map(id=>byId.get(id)),...next.people.filter(p=>!order.before.includes(p.id))];changed=true;
 }
 if(!changed)throw Error('У цьому записі немає змін, які можна скасувати.');
 return next;
}
