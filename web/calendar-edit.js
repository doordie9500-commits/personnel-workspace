import {addDays} from './schedule-move.js';
import {utc} from './shifts-ui.js';
export function clearCalendarDay(state,personId,date,uid,includeWork=true,includeAbsence=true){return clearCalendarRange(state,personId,date,date,uid,includeWork,includeAbsence);}
export function clearCalendarRange(state,personId,from,to,uid,includeWork=true,includeAbsence=true){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(from)||!/^\d{4}-\d{2}-\d{2}$/.test(to)||!Number.isFinite(Date.parse(from+'T00:00Z'))||!Number.isFinite(Date.parse(to+'T00:00Z'))||new Date(from+'T00:00Z').toISOString().slice(0,10)!==from||new Date(to+'T00:00Z').toISOString().slice(0,10)!==to||from>to)throw Error('Перевірте початок та завершення періоду.');
 const next=structuredClone(state);
 next.events=next.events.flatMap(e=>{const end=e.returned_on&&e.returned_on<=e.end?addDays(e.returned_on,-1):e.end;if((!includeWork&&e.kind==='Робота')||(!includeAbsence&&e.kind!=='Робота')||e.person_id!==personId||e.cancelled||to<e.start||from>end)return [e];return [...(e.start<from?[{...e,end:addDays(from,-1),returned_on:''}]:[]),...(to<end?[{...e,id:uid(),start:addDays(to,1),end,returned_on:''}]:[])];});
 if(!includeWork)return next;
 const a=utc(from+'T00:00'),b=utc(addDays(to,1)+'T00:00');
 next.shifts=(next.shifts||[]).flatMap(s=>{const member=s.members.find(m=>m.id===personId),end=s.actual_end||s.end;if(!member||['Скасовано','Вихідний'].includes(s.status)||s.start>=b||end<=a)return [s];const others=s.members.filter(m=>m.id!==personId),result=others.length?[{...s,members:others,responsible_id:s.responsible_id===personId?'':s.responsible_id}]:[];for(const [start,finish] of [[s.start,end<a?end:a],[s.start>b?s.start:b,end]])if(start<finish)result.push({...s,id:uid(),members:[member],responsible_id:s.responsible_id===personId?personId:'',start,end:finish,actual_end:s.actual_end?finish:''});return result;});
 return next;
}
