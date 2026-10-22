"""Capability links expose only a bounded work calendar, never personnel records."""
import hashlib
import json
import re
import secrets
import time
from datetime import datetime, date, timedelta, timezone
from zoneinfo import ZoneInfo

class ShareError(Exception):
    def __init__(self,message,status=400):super().__init__(message);self.status=status

def scope_for(raw):
    month=raw.get('month',''); days=raw.get('days',7)
    if not isinstance(month,str) or not re.fullmatch(r'20\d\d-(0[1-9]|1[0-2])|21\d\d-(0[1-9]|1[0-2])',month): raise ValueError('Оберіть місяць графіка.')
    if isinstance(days,bool) or not isinstance(days,int) or not 1<=days<=90: raise ValueError('Строк посилання: 1–90 днів.')
    for k in ('group','warehouse'):
        if not isinstance(raw.get(k,''),str) or len(raw.get(k,''))>200: raise ValueError('Некоректний фільтр.')
    return dict(month=month,days=days,group=raw.get('group',''),warehouse=raw.get('warehouse',''))

def projection(state,scope):
    start=scope['month']+'-01'; y,m=map(int,scope['month'].split('-')); m+=2; y+=(m-1)//12; m=(m-1)%12+1
    end=f'{y:04d}-{m:02d}-01'; zone=ZoneInfo('Europe/Kyiv')
    midnight=lambda d:datetime.fromisoformat(d).replace(tzinfo=zone).astimezone(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00','Z')
    lo,hi=midnight(start),midnight(end); known={p['id']:p for p in state['people']}; shifts=[]; people={}; events=[]
    for s in state.get('shifts',[]):
        if s['status'] in ('Скасовано','Вихідний') or scope['group'] and s['group']!=scope['group'] or scope['warehouse'] and s['warehouse_id']!=scope['warehouse'] or s['start']>=hi or (s.get('actual_end') or s['end'])<=lo: continue
        item={k:s[k] for k in ('id','warehouse_id','warehouse_name','group','status','responsible_id')}; item.update(start=max(s['start'],lo),end=min(s.get('actual_end') or s['end'],hi),actual_end='',members=[])
        for member in s['members']:
            p=known.get(member['id'],{}); role=member.get('role',p.get('role','')); trainee=bool(member.get('trainee'))
            item['members'].append(dict(id=member['id'],name=member['name'],callsign=member.get('callsign',p.get('callsign','')),role=role,trainee=trainee,trainee_reason='Стажування на посаді: '+(role or 'не вказано') if trainee else ''))
            people[member['id']]={k:item['members'][-1][k] for k in ('id','name','callsign','role')}; people[member['id']]['group']=s['group'] or ''
        shifts.append(item)
    for e in state.get('events',[]):
        p=known.get(e['person_id'])
        if e['kind']!='Робота' or e.get('cancelled') or scope['warehouse'] or scope['group'] and (p or {}).get('group')!=scope['group'] or e['start']>=end or e['end']<start or e.get('returned_on') and e['returned_on']<=start:continue
        if p:people[p['id']]={k:p.get(k,'') for k in ('id','name','callsign','role','group')}
        events.append(dict(id=e['id'],person_id=e['person_id'],kind='Робота',start=max(start,e['start']),end=min(e['end'],(date.fromisoformat(end)-timedelta(days=1)).isoformat(),(date.fromisoformat(e['returned_on'])-timedelta(days=1)).isoformat() if e.get('returned_on') else e['end']),cancelled=False))
    groups=list(dict.fromkeys([s['group'] for s in shifts if s['group']]+[p['group'] for p in people.values() if p['group']]))
    return dict(month=scope['month'],people=list(people.values()),shifts=shifts,events=events,groups=groups,roles=[],warehouses=list({s['warehouse_id']:dict(id=s['warehouse_id'],name=s['warehouse_name']) for s in shifts}.values()),group_colors={g:state['group_colors'][g] for g in groups if g in state.get('group_colors',{})})

def public_schedule(database,authorization):
    if not re.fullmatch(r'Share [a-f0-9]{64}',authorization):raise ShareError('Посилання недійсне або вимкнене.',404)
    with database.connect() as db:
        link=db.execute('SELECT scope,expires FROM schedule_links WHERE token_hash=? AND revoked=0 AND expires>?',(hashlib.sha256(authorization[6:].encode()).hexdigest(),time.time())).fetchone()
        if not link:raise ShareError('Строк посилання минув або його вимкнули.',404)
        state=json.loads(db.execute('SELECT data FROM workspace WHERE id=1').fetchone()['data'])
    return dict(state=projection(state,json.loads(link['scope'])),expires=link['expires'])

def schedule_links(database,user,post,body):
    if user['role']!='owner':raise ShareError('Посиланнями керує адміністратор.',403)
    with database.connect() as db:
        if not post:return [dict(dict(r),scope=json.loads(r['scope'])) for r in db.execute('SELECT id,created,expires,scope,revoked FROM schedule_links ORDER BY created DESC LIMIT 100')]
        if body.get('revoke'):
            db.execute('UPDATE schedule_links SET revoked=1 WHERE id=?',(str(body['revoke']),)); action='Вимкнено посилання на графік';result=dict(ok=True)
        else:
            try:scope=scope_for(body)
            except ValueError as e:raise ShareError(str(e))
            token=secrets.token_hex(32); id=secrets.token_hex(16);expires=int(time.time())+scope['days']*86400
            db.execute('INSERT INTO schedule_links VALUES(?,?,?,?,?,0)',(id,hashlib.sha256(token.encode()).hexdigest(),datetime.now(timezone.utc).isoformat(),expires,json.dumps(scope,ensure_ascii=False)));action='Створено посилання на графік';result=dict(id=id,token=token,expires=expires)
        db.execute('INSERT INTO audit(created,actor,action,details) VALUES(?,?,?,?)',(datetime.now(timezone.utc).isoformat(),user['login'],action,'[]'))
    return result
