import json
import secrets
from contextlib import closing
from datetime import datetime,timezone

TABLES={'chat_members':('user_id',),'chat_reads':('user_id','last_id'),'chat_messages':('id','created','author_id','author_login','author_name','body','client_id'),'preferences':('user_id','data'),'users':('id','login','password','role','active'),'workspace':('id','revision','data'),'audit':('id','created','actor','action','details'),'backups':('id','created','actor','revision','data')}


def full_backup(database):
    with database.connect() as db:
        db.execute('BEGIN')
        tables={name:[dict(row) for row in db.execute('SELECT * FROM '+name)] for name in TABLES}
    return dict(format='personnel-full-v1',engine='python-sqlite',exported_at=datetime.now(timezone.utc).isoformat(),tables=tables)


def restore_full(database,user,body,validate):
    packet=body.get('backup',{})
    if body.get('confirm')!='ВІДНОВИТИ БАЗУ' or packet.get('format')!='personnel-full-v1' or packet.get('engine')!='python-sqlite':raise ValueError('Потрібна повна копія Python-бази та підтвердження.')
    for optional in ['preferences','chat_members','chat_reads','chat_messages']:packet.get('tables',{}).setdefault(optional,[])
    for name,columns in TABLES.items():
        rows=packet.get('tables',{}).get(name)
        if not isinstance(rows,list) or len(rows)>100000:raise ValueError('Некоректна таблиця копії.')
        if any(not isinstance(row.get(c),(str,int,float)) for row in rows for c in columns):raise ValueError('Некоректні поля копії.')
    if not any(u['id']==user['id'] and u['role']=='owner' and u['active']==1 for u in packet['tables']['users']):raise ValueError('Копія має містити ваш обліковий запис адміністратора.')
    import re
    for account in packet['tables']['users']:
        if account['role'] not in ('owner','editor','viewer') or not re.fullmatch('[a-f0-9]{32}:[a-f0-9]{64}',account['password']):raise ValueError('Некоректний обліковий запис.')
    work=packet['tables']['workspace']
    if len(work)!=1 or work[0]['id']!=1:raise ValueError('Не знайдено кадрової бази.')
    state=validate(json.loads(work[0]['data']))
    # Keep a complete on-disk recovery copy before the destructive transaction.
    import sqlite3
    path=database.path.parent/('before-full-restore-'+secrets.token_hex(8)+'.sqlite3')
    with database.connect() as source,closing(sqlite3.connect(path)) as target:source.backup(target)
    with database.connect() as db:
        db.execute('BEGIN IMMEDIATE')
        current=db.execute('SELECT revision FROM workspace WHERE id=1').fetchone()[0]
        if current!=body.get('revision'):raise ValueError('Базу змінив інший користувач. Оновіть дані.')
        for name,columns in TABLES.items():
            db.execute('DELETE FROM '+name)
            for row in packet['tables'][name]:
                row=dict(row)
                if name=='workspace':row.update(revision=max(current,row['revision'])+1,data=json.dumps(state,ensure_ascii=False))
                db.execute('INSERT INTO '+name+' ('+','.join(columns)+') VALUES('+','.join('?' for _ in columns)+')',tuple(row[c] for c in columns))
        db.execute('DELETE FROM sessions');db.execute('DELETE FROM invitations')
        db.execute('INSERT INTO audit(created,actor,action,details) VALUES(?,?,?,?)',(datetime.now(timezone.utc).isoformat(),user['login'],'Відновлено повну базу',json.dumps([dict(actor_id=user['id'])])))
    return {'ok':True,'sign_in_again':True}
