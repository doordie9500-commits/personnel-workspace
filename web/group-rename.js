export function renameGroup(state,old,name){
 const next=structuredClone(state);name=name.trim();if(!name||!next.groups.includes(old)||next.groups.some(g=>g!==old&&g.toLocaleLowerCase('uk')===name.toLocaleLowerCase('uk')))throw Error('Вкажіть унікальну назву групи.');
 next.groups=next.groups.map(g=>g===old?name:g);for(const p of next.people)if(p.group===old)p.group=name;for(const s of next.shifts||[])if(s.group===old)s.group=name;
 if(next.group_colors&&old!==name){if(next.group_colors[old])next.group_colors[name]=next.group_colors[old];delete next.group_colors[old];}return next;
}
export function groupRenames(before,after){return (before.groups||[]).flatMap((old,i)=>{const name=after.groups?.[i];return name&&name!==old&&!after.groups.includes(old)&&!before.groups.includes(name)?[[old,name]]:[];});}
export function onlyGroupRename(previous,record,before,after){return !!previous&&groupRenames(before,after).some(([old,name])=>previous.group===old&&record.group===name)&&JSON.stringify({...record,group:previous.group})===JSON.stringify(previous);}
