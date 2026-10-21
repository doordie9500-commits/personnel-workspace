export const DEFAULT_PREFERENCES={display_name:'',theme:'system',date_format:'uk',time_format:'24',density:'normal',notifications:true,language:'uk'};
export function validatePreferences(raw){
  if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('Некоректні налаштування.');
  const p={...DEFAULT_PREFERENCES,...raw};
  if(typeof p.display_name!=='string'||p.display_name.length>100)throw Error('Ім’я має містити до 100 символів.');
  for(const [key,allowed] of Object.entries({theme:['system','light','dark'],date_format:['uk','iso'],time_format:['24','12'],density:['normal','compact'],language:['uk']}))if(!allowed.includes(p[key]))throw Error('Некоректний параметр: '+key);
  if(typeof p.notifications!=='boolean')throw Error('Некоректне налаштування сповіщень.');
  return Object.fromEntries(Object.keys(DEFAULT_PREFERENCES).map(k=>[k,k==='display_name'?p[k].trim():p[k]]));
}
