const stmt=(db,sql,...args)=>db.prepare(sql).bind(...args);
export class ChatError extends Error{constructor(message,status=400){super(message);this.status=status;}}
export async function chatRoute(db,user,path,url,post,body){
  const member=await stmt(db,'SELECT user_id FROM chat_members WHERE user_id=?',user.id).first(),allowed=user.role==='owner'||!!member;
  if(path==='/api/chat/status'){
    if(!allowed)return {allowed:false,unread:0};
    const result=await stmt(db,'SELECT COUNT(*) unread FROM chat_messages WHERE id>COALESCE((SELECT last_id FROM chat_reads WHERE user_id=?),0) AND author_id!=?',user.id,user.id).first();return {allowed:true,unread:result.unread};
  }
  if(path==='/api/chat/members'&&post){
    if(user.role!=='owner')throw new ChatError('Лише адміністратор керує доступом до чату.',403);
    const target=await stmt(db,'SELECT id,role FROM users WHERE id=? AND active=1',body.id).first();
    if(!target||target.role==='owner'||typeof body.allowed!=='boolean')throw new ChatError('Перевірте користувача.');
    await db.batch([body.allowed?stmt(db,'INSERT OR IGNORE INTO chat_members VALUES(?)',target.id):stmt(db,'DELETE FROM chat_members WHERE user_id=?',target.id),stmt(db,'INSERT INTO audit(created,actor,action,details) VALUES(?,?,?,?)',new Date().toISOString(),user.login,'Змінено доступ до чату',JSON.stringify([{actor_id:user.id,target_id:target.id,allowed:body.allowed}]))]);return {ok:true};
  }
  if(!allowed)throw new ChatError('Чат доступний лише адміністраторам та запрошеним учасникам.',403);
  if(path==='/api/chat/read'&&post){const max=(await stmt(db,'SELECT COALESCE(MAX(id),0) id FROM chat_messages').first()).id;if(!Number.isSafeInteger(body.last_id)||body.last_id<0||body.last_id>max)throw new ChatError('Некоректна позначка прочитаного.');await stmt(db,'INSERT INTO chat_reads VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET last_id=MAX(last_id,excluded.last_id)',user.id,body.last_id).run();return {ok:true};}
  if(path!=='/api/chat/messages')throw new ChatError('Маршрут чату не знайдено.',404);
  if(post){
    if(typeof body.body!=='string'||!body.body.trim()||body.body.length>2000||typeof body.client_id!=='string'||!/^[a-zA-Z0-9_-]{8,80}$/.test(body.client_id))throw new ChatError('Повідомлення: 1–2000 символів.');
    const duplicate=await stmt(db,'SELECT * FROM chat_messages WHERE author_id=? AND client_id=?',user.id,body.client_id).first();if(duplicate)return duplicate;
    const time=Math.floor(Date.now()/1000),key='chat:'+user.id;
    await stmt(db,'INSERT INTO attempts(key,count,reset) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN reset>? THEN count+1 ELSE 1 END,reset=CASE WHEN reset>? THEN reset ELSE ? END',key,time+60,time,time,time+60).run();
    if((await stmt(db,'SELECT count FROM attempts WHERE key=?',key).first()).count>20)throw new ChatError('Ліміт: 20 повідомлень за хвилину. Спробуйте трохи пізніше.',429);
    const pref=await stmt(db,'SELECT data FROM preferences WHERE user_id=?',user.id).first(),name=pref?JSON.parse(pref.data).display_name||user.login:user.login;
    await stmt(db,'INSERT OR IGNORE INTO chat_messages(created,author_id,author_login,author_name,body,client_id) VALUES(?,?,?,?,?,?)',new Date().toISOString(),user.id,user.login,name,body.body.trim(),body.client_id).run();
    return stmt(db,'SELECT * FROM chat_messages WHERE author_id=? AND client_id=?',user.id,body.client_id).first();
  }
  const number=name=>{const value=Number(url.searchParams.get(name)||0);if(!Number.isSafeInteger(value)||value<0)throw new ChatError('Некоректний номер повідомлення.');return value;},after=number('after'),before=number('before');
  const rows=after?(await stmt(db,'SELECT * FROM chat_messages WHERE id>? ORDER BY id ASC LIMIT 100',after).all()).results:(await stmt(db,'SELECT * FROM chat_messages WHERE (?=0 OR id<?) ORDER BY id DESC LIMIT 100',before,before).all()).results.reverse();
  return {messages:rows,has_older:rows.length>0&&!!await stmt(db,'SELECT id FROM chat_messages WHERE id<? LIMIT 1',rows[0].id).first()};
}
