export const values=value=>Array.isArray(value)?value:value?[value]:[];
export const matches=(selection,value)=>!values(selection).length||values(selection).includes(value);
// Checkboxes work on touch screens and do not require holding Ctrl.
export function multiFilter(el,{label,options,value,onChange}){
 const displayLabel=({'Склад графіка':'Склади','Група графіка':'Групи','Працівник графіка':'Працівники','Посада графіка':'Посади'})[label]||label;
 const choices=options.map(v=>Array.isArray(v)?v:[v,v]).filter(([key])=>key!==''),selected=new Set(values(value)),root=el('details',{class:'multi-filter',name:'personnel-filter'}),summary=el('summary',{'aria-label':label},selected.size?displayLabel+' · '+selected.size:displayLabel+' · усі'),search=el('input',{type:'search',placeholder:'Пошук…','aria-label':'Пошук: '+label}),list=el('div',{class:'multi-filter-options'});
 const rows=choices.map(([key,title])=>{const box=el('input',{type:'checkbox',checked:selected.has(key),'aria-label':title,onChange:()=>{box.checked?selected.add(key):selected.delete(key);summary.textContent=selected.size?displayLabel+' · '+selected.size:displayLabel+' · усі';}});return el('label',{class:'select-check'},box,title);});list.append(...rows);search.addEventListener('input',()=>rows.forEach((row,i)=>row.hidden=!String(choices[i][1]).toLocaleLowerCase('uk').includes(search.value.toLocaleLowerCase('uk'))));
 root.addEventListener('keydown',event=>{if(event.key==='Escape'){root.open=false;summary.focus();}});
 root.append(summary,el('div',{class:'multi-filter-popover'},search,el('p',{class:'muted'},'Без позначок — показати всі.'),list,el('div',{class:'actions'},el('button',{type:'button',onClick:()=>{selected.clear();rows.forEach(r=>r.querySelector('input').checked=false);summary.textContent=displayLabel+' · усі';}},'Зняти всі'),el('button',{type:'button',class:'primary',onClick:()=>{root.open=false;onChange([...selected]);}},'Застосувати'))));return root;
}
