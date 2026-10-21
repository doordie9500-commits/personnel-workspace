// Administrative extensions shared by the browser and the hosted validator.
export const CATEGORIES=['Військовослужбовець','Новобранець','Стажер'];
export const EXTRA_TABLES=['admin_tasks','admin_log','classes','grades'];
const str=(v,max=1000,required=false)=>{if(typeof v!=='string'||v.length>max||(required&&!v.trim()))throw Error('Перевірте текст та обов’язкові поля.');return v.trim();};
const day=(v,optional=false)=>{if(optional&&!v)return '';if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(v)||!Number.isFinite(Date.parse(v))||new Date(v+'T00:00:00Z').toISOString().slice(0,10)!==v)throw Error('Некоректна дата.');return v;};
export function extensions(raw,personIds){
  const result={};
  for(const table of EXTRA_TABLES){
    const rows=raw[table]??[];if(!Array.isArray(rows)||rows.length>3000)throw Error('Некоректна або завелика таблиця '+table);
    const ids=new Set();result[table]=rows.map(item=>{
      const id=str(item.id,200,true);if(ids.has(id))throw Error('Повторення запису.');ids.add(id);
      if(table==='admin_tasks'){const status=item.status||'Заплановано';if(!['Заплановано','В роботі','Виконано'].includes(status))throw Error('Невідомий стан справи.');return {id,title:str(item.title,200,true),notes:str(item.notes||'',4000),owner:str(item.owner||'',200),due:day(item.due||'',true),status};}
      if(table==='admin_log')return {id,day:day(item.day),category:str(item.category||'Облік',100,true),title:str(item.title,200,true),notes:str(item.notes||'',4000)};
      if(table==='classes')return {id,day:day(item.day),title:str(item.title,200,true),teacher:str(item.teacher||'',200),notes:str(item.notes||'',4000)};
      if(!personIds.has(item.person_id))throw Error('Людину для оцінки не знайдено.');
      const score=Number(item.score);if(!Number.isFinite(score)||score<0||score>100)throw Error('Оцінка має бути від 0 до 100.');
      return {id,class_id:str(item.class_id,200,true),person_id:item.person_id,score,notes:str(item.notes||'',1000)};
    });
  }
  const classIds=new Set(result.classes.map(v=>v.id)),graded=new Set();
  for(const grade of result.grades){if(!classIds.has(grade.class_id))throw Error('Заняття для оцінки не знайдено.');const key=grade.class_id+'|'+grade.person_id;if(graded.has(key))throw Error('Для людини вже є оцінка за це заняття.');graded.add(key);}
  return result;
}
