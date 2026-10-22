import {calendarDates} from './schedule-move.js';
import {column} from './excel-styles.js';
import {groupColor} from './group-colors.js';
import {pointName} from './point-labels.js';
const day=value=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Kyiv'}).format(new Date(value));
export function workCalendarSheets(state,people,shifts,month){
 const dates=calendarDates(month),last=4+dates.length,blank=()=>Array(last+1).fill(''),rows=[blank(),blank(),blank(),blank(),blank()],merge=[`A1:${column(last)}1`,`A2:${column(last)}2`],cellStyles={},rowStyles={0:'title',1:'note',2:'head',3:'head',4:'head'},rowHeights={0:38,1:30,2:28,3:24,4:24},customStyles={title:{color:'183D49',bold:true,left:true},note:{color:'EDF3F5',left:true},head:{color:'244853',bold:true},month:{color:'244853',bold:true,left:true},weekend:{color:'EDF1F4'},normal:{color:'FFFFFF'},person:{color:'F5F8FA',left:true},total:{color:'D5EAE4'}};
 rows[0][0]='Графік роботи · поіменний';rows[1][0]='Позначка — точка роботи; СТ — стажер. Люди одного екіпажу розташовані поруч. Облік у днях.';
 ['Група / екіпаж','ПІБ','Позивний','Посада'].forEach((v,c)=>{rows[2][c]=v;merge.push(`${column(c)}3:${column(c)}5`);});rows[2][last]='Днів';merge.push(`${column(last)}3:${column(last)}5`);
 const months=[...new Set(dates.map(d=>d.slice(0,7)))];for(const m of months){const a=dates.findIndex(d=>d.startsWith(m))+4,b=dates.findLastIndex(d=>d.startsWith(m))+4;cellStyles[column(a)+'3']='month';rows[2][a]=new Date(m+'-01T12:00Z').toLocaleDateString('uk-UA',{month:'long',year:'numeric'});merge.push(`${column(a)}3:${column(b)}3`);}
 dates.forEach((d,i)=>{rows[3][i+4]=+d.slice(8);rows[4][i+4]=new Date(d+'T12:00Z').toLocaleDateString('uk-UA',{weekday:'short'});});
 const active=shifts.filter(s=>!['Скасовано','Вихідний'].includes(s.status)),bounds=new Map(active.map(s=>[s.id,[day(s.start),day(new Date(Date.parse(s.actual_end||s.end)-1))]])),names=[...new Set([...state.groups,...people.map(p=>p.group||'')])],detail=[['Група','ПІБ','Позивний','Посада на зміні','Точка роботи','З дати','По дату включно','Стажер','Причина стажування']];
 const colorKey=g=>{const key='group:'+g;customStyles[key]??={color:groupColor(state,g),bold:true};return key;};
 for(const group of names){const crew=people.filter(p=>(p.group||'')===group);if(!crew.length)continue;const band=rows.length;rows.push(blank());rows[band][0]=(group||'Без групи')+' · '+crew.length+' ос.';merge.push(`A${band+1}:${column(last)}${band+1}`);customStyles['band:'+group]={color:groupColor(state,group),bold:true,left:true};rowStyles[band]='band:'+group;rowHeights[band]=28;
 for(const p of crew){const r=rows.length,row=blank(),own=active.filter(s=>s.members.some(m=>m.id===p.id));row[0]=group||'Без групи';row[1]=p.name;row[2]=p.callsign||'';row[3]=[...new Set(own.map(s=>s.members.find(m=>m.id===p.id).role||p.role).filter(Boolean))].join(' / ')||p.role||'';let count=0;
 dates.forEach((d,i)=>{const records=own.filter(s=>bounds.get(s.id)[0]<=d&&bounds.get(s.id)[1]>=d),legacy=(state.events||[]).some(e=>e.person_id===p.id&&e.kind==='Робота'&&!e.cancelled&&e.start<=d&&e.end>=d),c=i+4,ref=column(c)+(r+1);if(records.length||legacy){count++;row[c]=records.length?[...new Set(records.map(s=>pointName(s)+(s.members.find(m=>m.id===p.id).trainee?'\nСТ':'')))].join('\n→ '):'Р';cellStyles[ref]=colorKey(records[0]?.group||group);}else cellStyles[ref]=[0,6].includes(new Date(d+'T12:00Z').getUTCDay())?'weekend':'normal';});
 row[last]={formula:`COUNTIF(E${r+1}:${column(last-1)}${r+1},"?*")`,value:count};cellStyles[column(last)+(r+1)]='total';for(let c=0;c<4;c++)cellStyles[column(c)+(r+1)]='person';rows.push(row);rowHeights[r]=44;
 for(const s of own){const m=s.members.find(m=>m.id===p.id);detail.push([s.group||'Без групи',p.name,m.callsign||p.callsign||'',m.role||p.role||'',s.warehouse_name,bounds.get(s.id)[0],bounds.get(s.id)[1],m.trainee?'Так':'',m.trainee_reason||'']);}
 }}
 return {'Графік':{rows,title:true,headerRow:4,freezeRows:5,freezeCols:4,filter:false,merge,cellStyles,rowStyles,rowHeights,customStyles,widths:[18,36,20,24,...dates.map(()=>12),9]},'Призначення':{rows:detail,freezeRows:1,freezeCols:3,widths:[20,36,20,24,30,15,18,12,40]}};
}
