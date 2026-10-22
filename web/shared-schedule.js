// Explicit public projection. Never return the personnel workspace to a link visitor.
export function shareScope(raw){
 const month=raw.month;if(typeof month!=='string'||!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)||+month.slice(0,4)<2000||+month.slice(0,4)>2199)throw Error('Оберіть місяць графіка.');
 const days=Number(raw.days??7);if(!Number.isInteger(days)||days<1||days>90)throw Error('Строк посилання: 1–90 днів.');
 for(const k of ['group','warehouse'])if(typeof (raw[k]??'')!=='string'||(raw[k]||'').length>200)throw Error('Некоректний фільтр.');
 return {month,group:raw.group||'',warehouse:raw.warehouse||'',days};
}
export function sharedSchedule(state,scope){
 const start=scope.month+'-01',end=new Date(Date.UTC(+start.slice(0,4),+start.slice(5,7)+1,1)).toISOString().slice(0,10);
 // Midnight limits use Kyiv's actual offset, including summer/winter transitions.
 const midnight=d=>{let t=Date.parse(d+'T00:00:00Z');for(let i=0;i<3;i++){const wall=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Kyiv',dateStyle:'short',timeStyle:'medium',hourCycle:'h23'}).format(new Date(t)).replace(' ','T');t+=Date.parse(d+'T00:00:00Z')-Date.parse(wall+'Z');}return new Date(t).toISOString();};
 const from=midnight(start),until=midnight(end),known=new Map(state.people.map(p=>[p.id,p]));
 const shifts=(state.shifts||[]).filter(s=>!['Скасовано','Вихідний'].includes(s.status)&&(!scope.group||s.group===scope.group)&&(!scope.warehouse||s.warehouse_id===scope.warehouse)&&s.start<until&&(s.actual_end||s.end)>from).map(s=>({id:s.id,warehouse_id:s.warehouse_id,warehouse_name:s.warehouse_name,group:s.group||'',start:s.start<from?from:s.start,end:(s.actual_end||s.end)>until?until:(s.actual_end||s.end),actual_end:'',status:s.status,responsible_id:s.responsible_id,members:s.members.map(m=>({id:m.id,name:m.name,callsign:m.callsign??known.get(m.id)?.callsign??'',role:m.role??known.get(m.id)?.role??'',trainee:!!m.trainee,trainee_reason:m.trainee?'Стажування на посаді: '+(m.role||'не вказано'):''}))}));
 const members=new Map(shifts.flatMap(s=>s.members.map(m=>[m.id,{id:m.id,name:m.name,callsign:m.callsign,role:m.role,group:s.group||''}])));
 const events=(state.events||[]).filter(e=>e.kind==='Робота'&&!e.cancelled&&!scope.warehouse&&(!scope.group||known.get(e.person_id)?.group===scope.group)&&e.start<end&&e.end>=start&&(!e.returned_on||e.returned_on>start)).map(e=>{const p=known.get(e.person_id);if(p)members.set(p.id,{id:p.id,name:p.name,callsign:p.callsign,role:p.role,group:p.group||''});return {id:e.id,person_id:e.person_id,kind:'Робота',start:e.start<start?start:e.start,end:[e.end,new Date(Date.parse(end)-86400000).toISOString().slice(0,10),...(e.returned_on?[new Date(Date.parse(e.returned_on)-86400000).toISOString().slice(0,10)]:[])].sort()[0],cancelled:false};});
 const groups=[...new Set([...shifts.map(s=>s.group),...members.values()].map(v=>typeof v==='string'?v:v.group).filter(Boolean))];
 return {month:scope.month,people:[...members.values()],shifts,events,groups,roles:[],warehouses:[...new Map(shifts.map(s=>[s.warehouse_id,{id:s.warehouse_id,name:s.warehouse_name}])).values()],group_colors:Object.fromEntries(groups.filter(g=>state.group_colors?.[g]).map(g=>[g,state.group_colors[g]]))};
}
