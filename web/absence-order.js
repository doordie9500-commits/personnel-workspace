import {addDays} from './schedule-move.js';
import {matches} from './multi-filter.js';
// Sort only the displayed list, never change the stored personnel order.
export function absenceOrder(people,events,from,to,selection=[]){
 const ranks=new Map(),priority={'Відпустка':0,'КЗВ':1};
 for(const e of events){if(e.cancelled||!Object.hasOwn(priority,e.kind)||!matches(selection,e.kind))continue;const end=e.returned_on&&e.returned_on<=e.end?addDays(e.returned_on,-1):e.end;if(end<e.start||end<from||e.start>to)continue;const rank=[priority[e.kind],e.start<from?from:e.start],old=ranks.get(e.person_id);if(!old||rank[0]<old[0]||rank[0]===old[0]&&rank[1]<old[1])ranks.set(e.person_id,rank);}
 return people.map((person,index)=>({person,index,rank:ranks.get(person.id)||[2,'']})).sort((a,b)=>a.rank[0]-b.rank[0]||a.rank[1].localeCompare(b.rank[1])||a.index-b.index).map(row=>row.person);
}
