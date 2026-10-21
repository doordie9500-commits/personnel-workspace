import json,re,time
from datetime import datetime,timezone

SCHEMA='''CREATE TABLE IF NOT EXISTS chat_members(user_id TEXT PRIMARY KEY);
CREATE TABLE IF NOT EXISTS chat_reads(user_id TEXT PRIMARY KEY,last_id INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS chat_messages(id INTEGER PRIMARY KEY AUTOINCREMENT,created TEXT NOT NULL,author_id TEXT NOT NULL,author_login TEXT NOT NULL,author_name TEXT NOT NULL,body TEXT NOT NULL,client_id TEXT NOT NULL,UNIQUE(author_id,client_id));'''
class ChatError(Exception):
    def __init__(self,message,status=400):super().__init__(message);self.status=status

def chat_route(database,user,path,query,post,body):
    with database.connect() as db:
        allowed=user['role']=='owner' or bool(db.execute('SELECT user_id FROM chat_members WHERE user_id=?',(user['id'],)).fetchone())
        if path=='/api/chat/status':
            return dict(allowed=allowed,unread=db.execute('SELECT COUNT(*) FROM chat_messages WHERE id>COALESCE((SELECT last_id FROM chat_reads WHERE user_id=?),0) AND author_id!=?',(user['id'],user['id'])).fetchone()[0] if allowed else 0)
        if path=='/api/chat/members' and post:
            if user['role']!='owner':raise ChatError('Лише адміністратор керує доступом до чату.',403)
            target=db.execute('SELECT id,role FROM users WHERE id=? AND active=1',(body.get('id'),)).fetchone()
            if not target or target['role']=='owner' or not isinstance(body.get('allowed'),bool):raise ChatError('Перевірте користувача.')
            db.execute('INSERT OR IGNORE INTO chat_members VALUES(?)' if body['allowed'] else 'DELETE FROM chat_members WHERE user_id=?',(target['id'],))
            db.execute('INSERT INTO audit(created,actor,action,details) VALUES(?,?,?,?)',(datetime.now(timezone.utc).isoformat(),user['login'],'Змінено доступ до чату',json.dumps([dict(actor_id=user['id'],target_id=target['id'],allowed=body['allowed'])])))
            return dict(ok=True)
        if not allowed:raise ChatError('Немає доступу до чату.',403)
        if path=='/api/chat/read' and post:
            value=body.get('last_id');maximum=db.execute('SELECT COALESCE(MAX(id),0) FROM chat_messages').fetchone()[0]
            if type(value)!=int or not 0<=value<=maximum:raise ChatError('Некоректна позначка прочитаного.')
            db.execute('INSERT INTO chat_reads VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET last_id=MAX(last_id,excluded.last_id)',(user['id'],value));return dict(ok=True)
        if path!='/api/chat/messages':raise ChatError('Маршрут чату не знайдено.',404)
        if post:
            message=body.get('body');nonce=body.get('client_id')
            if not isinstance(message,str) or not message.strip() or len(message)>2000 or not isinstance(nonce,str) or not re.fullmatch('[a-zA-Z0-9_-]{8,80}',nonce):raise ChatError('Повідомлення: 1–2000 символів.')
            duplicate=db.execute('SELECT * FROM chat_messages WHERE author_id=? AND client_id=?',(user['id'],nonce)).fetchone()
            if duplicate:return dict(duplicate)
            stamp=int(time.time());key='chat:'+user['id']
            db.execute('INSERT INTO attempts(key,count,reset) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN reset>? THEN count+1 ELSE 1 END,reset=CASE WHEN reset>? THEN reset ELSE ? END',(key,stamp+60,stamp,stamp,stamp+60))
            if db.execute('SELECT count FROM attempts WHERE key=?',(key,)).fetchone()[0]>20:raise ChatError('Ліміт: 20 повідомлень за хвилину.',429)
            pref=db.execute('SELECT data FROM preferences WHERE user_id=?',(user['id'],)).fetchone();name=json.loads(pref['data']).get('display_name') if pref else ''
            db.execute('INSERT OR IGNORE INTO chat_messages(created,author_id,author_login,author_name,body,client_id) VALUES(?,?,?,?,?,?)',(datetime.now(timezone.utc).isoformat(),user['id'],user['login'],name or user['login'],message.strip(),nonce))
            return dict(db.execute('SELECT * FROM chat_messages WHERE author_id=? AND client_id=?',(user['id'],nonce)).fetchone())
        def number(key):
            try:value=int(query.get(key,['0'])[0])
            except (ValueError,TypeError):raise ChatError('Некоректний номер повідомлення.')
            if not 0<=value<=9007199254740991:raise ChatError('Некоректний номер повідомлення.')
            return value
        after=number('after');before=number('before')
        rows=[dict(r) for r in (db.execute('SELECT * FROM chat_messages WHERE id>? ORDER BY id ASC LIMIT 100',(after,)) if after else db.execute('SELECT * FROM chat_messages WHERE (?=0 OR id<?) ORDER BY id DESC LIMIT 100',(before,before)))]
        if not after:rows.reverse()
        return dict(messages=rows,has_older=bool(rows and db.execute('SELECT id FROM chat_messages WHERE id<? LIMIT 1',(rows[0]['id'],)).fetchone()))
