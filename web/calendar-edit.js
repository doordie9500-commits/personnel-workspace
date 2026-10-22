import {addDays} from './schedule-move.js';
import {utc} from './shifts-ui.js';
export function clearCalendarDay(state,personId,date,uid,includeWork=true){
 const next=structuredClone(state);
 next.events=next.events.flatMap(e=>{if((!includeWork&&e.kind==='Робота')||e.person_id!==personId||e.cancelled||date<e.start||date>(e.returned_on&&e.returned_on<=e.end?addDays(e.returned_on,-1):e.end))return [e];const end=e.returned_on&&e.returned_on<=e.end?addDays(e.returned_on,-1):e.end;return [...(e.start<date?[{...e,end:addDays(date,-1),returned_on:''}]:[]),...(date<end?[{...e,id:uid(),start:addDays(date,1),end,returned_on:''}]:[])];});
 if(!includeWork)return next;
 const a=utc(date+'T00:00'),b=utc(addDays(date,1)+'T00:00');
 next.shifts=(next.shifts||[]).flatMap(s=>{const member=s.members.find(m=>m.id===personId),end=s.actual_end||s.end;if(!member||['Скасовано','Вихідний'].includes(s.status)||s.start>=b||end<=a)return [s];const others=s.members.filter(m=>m.id!==personId),result=others.length?[{...s,members:others,responsible_id:s.responsible_id===personId?'':s.responsible_id}]:[];for(const [start,finish] of [[s.start,end<a?end:a],[s.start>b?s.start:b,end]])if(start<finish)result.push({...s,id:uid(),members:[member],responsible_id:s.responsible_id===personId?personId:'',start,end:finish,actual_end:s.actual_end?finish:''});return result;});
 return next;
}
