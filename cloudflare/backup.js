const TABLES={chat_members:['user_id'],chat_reads:['user_id','last_id'],chat_messages:['id','created','author_id','author_login','author_name','body','client_id'],preferences:['user_id','data'],users:['id','login','password','role','active'],workspace:['id','revision','data'],audit:['id','created','actor','action','details'],backups:['id','created','actor','revision','data']};
const prepare=(db,sql,...args)=>db.prepare(sql).bind(...args);
export async function fullBackup(db){const tables={},names=Object.keys(TABLES),batch=await db.batch(names.map(name=>db.prepare('SELECT * FROM '+name)));for(let i=0;i<names.length;i++)tables[names[i]]=batch[i].results;return {format:'personnel-full-v1',engine:'cloudflare-d1',exported_at:new Date().toISOString(),tables};}
export async function restoreFull(db,user,body,validate){
  const packet=body.backup;if(body.confirm!=='ВІДНОВИТИ БАЗУ'||packet?.format!=='personnel-full-v1'||packet.engine!=='cloudflare-d1')throw Error('Підтвердьте відновлення повної копії Cloudflare.');
  if(packet.tables)for(const optional of ['preferences','chat_members','chat_reads','chat_messages'])packet.tables[optional]??=[];
  for(const [table,columns] of Object.entries(TABLES)){const rows=packet.tables?.[table];if(!Array.isArray(rows)||rows.length>100000)throw Error('Некоректна таблиця резервної копії.');for(const row of rows)for(const col of columns)if(!['string','number'].includes(typeof row[col]))throw Error('Некоректні поля резервної копії.');}
  const owner=packet.tables.users.find(u=>u.id===user.id&&u.role==='owner'&&u.active===1);if(!owner)throw Error('Копія має містити ваш обліковий запис адміністратора.');
  for(const u of packet.tables.users)if(!['owner','editor','viewer'].includes(u.role)||!/^[a-f0-9]{32}:[a-f0-9]{64}$/i.test(u.password)||!u.login.trim())throw Error('Некоректні облікові записи.');
  if(packet.tables.workspace.length!==1||packet.tables.workspace[0].id!==1)throw Error('Немає кадрової бази в копії.');
  const state=validate(JSON.parse(packet.tables.workspace[0].data));
  const old=await db.prepare('SELECT revision FROM workspace WHERE id=1').first();if(old.revision!==body.revision)throw Error('Базу змінив інший користувач. Оновіть дані.');
  const safety=await fullBackup(db),compressed=await new Response(new Blob([JSON.stringify(safety)]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer();
  if(compressed.byteLength>1500000)throw Error('Копія поточної бази завелика для безпечного автоматичного відновлення. Спочатку зверніться до адміністратора хостингу.');
  let binary='';for(const b of new Uint8Array(compressed))binary+=String.fromCharCode(b);
  const statements=[prepare(db,'UPDATE workspace SET id=CASE WHEN revision=? THEN 1 ELSE 0 END WHERE id=1',body.revision),prepare(db,'INSERT INTO recovery(id,created,data) VALUES(?,?,?)',crypto.randomUUID(),new Date().toISOString(),btoa(binary))];
  for(const table of Object.keys(TABLES)){statements.push(db.prepare('DELETE FROM '+table));const rows=packet.tables[table],columns=TABLES[table],size=Math.floor(90/columns.length);for(let i=0;i<rows.length;i+=size){const chunk=rows.slice(i,i+size).map(row=>{const values=columns.map(c=>row[c]);if(table==='workspace'){values[1]=Math.max(old.revision,Number(row.revision)||0)+1;values[2]=JSON.stringify(state);}return values;});statements.push(prepare(db,'INSERT INTO '+table+' ('+columns.join(',')+') VALUES '+chunk.map(v=>'('+v.map(()=>'?').join(',')+')').join(','),...chunk.flat()));}}
  // Bound D1 batch size. Large restores use the downloaded complete archive and an operator migration.
  if(statements.length>36)throw Error('Для цієї великої копії потрібне відновлення через адміністратора Cloudflare. Файл містить усі дані.');
  statements.push(db.prepare('DELETE FROM sessions'),db.prepare('DELETE FROM invitations'),prepare(db,'INSERT INTO audit(created,actor,action,details) VALUES(?,?,?,?)',new Date().toISOString(),user.login,'Відновлено повну базу',JSON.stringify([{actor_id:user.id}])),db.prepare('DELETE FROM recovery WHERE id NOT IN (SELECT id FROM recovery ORDER BY rowid DESC LIMIT 3)'));
  await db.batch(statements);return {ok:true,sign_in_again:true};
}
