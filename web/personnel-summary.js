import {shiftCoversDay} from './shifts-ui.js';
export function personnelStatus(state,person,date){
 const events=(state.events||[]).filter(e=>e.person_id===person.id&&!e.cancelled&&e.start<=date&&e.end>=date&&(!e.returned_on||e.returned_on>date));
 if(events.some(e=>e.kind!=='Робота'))return 'absence';
 if(events.some(e=>e.kind==='Робота')||(state.shifts||[]).some(s=>s.members.some(m=>m.id===person.id)&&shiftCoversDay(s,date)))return 'work';
 return 'free';
}
export function personnelSummary(state,date){const result={total:0,work:0,absence:0,free:0};for(const p of state.people||[]){if(p.archived)continue;result.total++;result[personnelStatus(state,p,date)]++;}return result;}
