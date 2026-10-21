const number=day=>{
 if(typeof day!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(day))throw Error('Виберіть коректну дату.');
 const value=Date.parse(day+'T00:00:00Z');if(!Number.isFinite(value)||new Date(value).toISOString().slice(0,10)!==day)throw Error('Виберіть коректну дату.');return value/86400000;
};
export const offsetDays=(from,to)=>number(to)-number(from);
export const addDays=(day,offset)=>new Date((number(day)+offset)*86400000).toISOString().slice(0,10);
export function movePeriod(period,sourceDay,targetDay){
 if(period.cancelled||period.returned_on)throw Error('Скасований або завершений поверненням період не можна перетягувати.');
 const offset=offsetDays(sourceDay,targetDay);
 return {...period,start:addDays(period.start,offset),end:addDays(period.end,offset)};
}
