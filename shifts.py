"""Warehouse shifts: additive state fields, historical snapshots, UTC intervals."""
from datetime import datetime, timezone
import copy
STATUSES=('Заплановано','Виїжджають','Прибули на склад','Працюють','Завершили зміну','Вихідний','Скасовано')
SHIFT_TABLES=('warehouses','shifts')
def instant(value):
    if not isinstance(value,str) or not value.endswith('Z'):raise ValueError('Некоректний час зміни.')
    dt=datetime.fromisoformat(value.replace('Z','+00:00'))
    if dt.tzinfo is None:raise ValueError('Потрібен час UTC.')
    return dt.isoformat(timespec='milliseconds').replace('+00:00','Z')
def validate_shifts(raw,text):
    result={'warehouses':[],'shifts':[]}; ids=set(); names=set()
    for key in SHIFT_TABLES:
        if not isinstance(raw.get(key,[]),list) or len(raw.get(key,[]))>(12000 if key=='shifts' else 300):raise ValueError('Некоректна таблиця '+key)
    for w in raw.get('warehouses',[]):
        item={k:text(w.get(k,''),500 if k=='address' else 200,k in ('id','name')) for k in ('id','name','number','address')};item['archived']=w.get('archived',False)
        if type(item['archived']) is not bool or item['id'] in ids or item['name'].lower() in names:raise ValueError('Повторення складу або некоректний архів.')
        ids.add(item['id']);names.add(item['name'].lower());result['warehouses'].append(item)
    shift_ids=set();periods={}
    for s in raw.get('shifts',[]):
        item={k:text(s.get(k,''),2000 if k=='notes' else (100 if k in ('group','status') else 200),k in ('id','warehouse_id','warehouse_name','status')) for k in ('id','warehouse_id','warehouse_name','group','status','responsible_id','notes','created_by','created_at','updated_by','updated_at')}
        item.update(start=instant(s.get('start')),end=instant(s.get('end')),actual_end=instant(s['actual_end']) if s.get('actual_end') else '')
        if item['id'] in shift_ids or item['warehouse_id'] not in ids or item['status'] not in STATUSES or item['end']<=item['start']:raise ValueError('Перевірте склад, статус та тривалість зміни.')
        shift_ids.add(item['id'])
        if (item['status']=='Завершили зміну')!=bool(item['actual_end']) or (item['actual_end'] and item['actual_end']<=item['start']):raise ValueError('Перевірте фактичне завершення зміни.')
        if not isinstance(s.get('members'),list) or not 0<len(s['members'])<=3000:raise ValueError('Виберіть працівників.')
        member_ids=set();item['members']=[]
        for m in s['members']:
            member={'id':text(m.get('id'),200,True),'name':text(m.get('name'),200,True)}
            for key in ('role','callsign'):
                if key in m:member[key]=text(m[key],200)
            if 'trainee' in m:
                if type(m['trainee']) is not bool:raise ValueError('Некоректна позначка стажера.')
                member['trainee']=m['trainee'];member['trainee_reason']=text(m.get('trainee_reason',''),500,m['trainee'])
            if member['id'] in member_ids:raise ValueError('Повторення працівника.')
            member_ids.add(member['id']);item['members'].append(member)
            if item['status'] not in ('Скасовано','Вихідний'):
                entries=periods.setdefault(member['id'],[]);end=item['actual_end'] or item['end']
                if any(a<end and item['start']<b for a,b in entries):raise ValueError('Зміни працівника перетинаються: '+member['name'])
                entries.append((item['start'],end))
        if item['responsible_id'] and item['responsible_id'] not in member_ids:raise ValueError('Відповідальний має входити до зміни.')
        result['shifts'].append(item)
    for w in result['warehouses']:
        if w['archived'] and any(s['warehouse_id']==w['id'] and s['status'] not in ('Завершили зміну','Вихідний','Скасовано') for s in result['shifts']):raise ValueError('Спочатку завершіть або перенесіть активні зміни складу.')
    return result
def prepare_shifts(raw,before,user):
    for key in SHIFT_TABLES:
        if key not in raw:raw[key]=copy.deepcopy(before.get(key,[]))
    old={s['id']:s for s in before.get('shifts',[])};people={p['id']:p for p in raw['people']};now=datetime.now(timezone.utc).isoformat()
    for s in raw['shifts']:
        previous=old.get(s['id'])
        if previous==s:continue
        renamed=bool(previous) and previous.get('group') in before.get('groups',[]) and previous.get('group') not in raw.get('groups',[]) and s.get('group') not in before.get('groups',[]) and s.get('group') in raw.get('groups',[]) and previous==dict(s,group=previous.get('group'))
        if renamed:
            s['updated_by']=user['id'];s['updated_at']=now;continue
        if previous and previous['status'] in ('Завершили зміну','Скасовано') and user.get('role')!='owner':raise ValueError('Історична зміна доступна лише для перегляду.')
        for m in s.get('members',[]):
            if m['id'] not in people or people[m['id']]['archived']:
                if user.get('role')!='owner' or not any(x['id']==m['id'] and x['name']==m['name'] for old_shift in before.get('shifts',[]) for x in old_shift['members']):raise ValueError('Виберіть активного працівника.')
            else:m['name']=people[m['id']]['name']
            snapshot=next((x for x in previous.get('members',[]) if x['id']==m['id']),{}) if previous else {}
            for key in ('role','callsign'):m[key]=m.get(key,snapshot.get(key,people.get(m['id'],{}).get(key,'')))
        for m in s.get('members',[]):
            person=people.get(m['id'],{});snapshot=next((x for x in previous.get('members',[]) if x['id']==m['id']),{}) if previous else {}
            new_role=bool(person.get('role') and m.get('role') and m.get('role')!=person.get('role'))
            m['trainee']=m.get('trainee',snapshot.get('trainee',person.get('category')=='Стажер' or new_role))
            m['trainee_reason']=(m.get('trainee_reason') or snapshot.get('trainee_reason') or ('Нова посада: '+m['role'] if new_role else person.get('trainee_reason') or 'Новий працівник')) if m['trainee'] else ''
        s['warehouse_name']=next((w['name'] for w in raw['warehouses'] if w['id']==s['warehouse_id']),'')
        s.update(created_by=previous.get('created_by') if previous else user['id'],created_at=previous.get('created_at') if previous else now,updated_by=user['id'],updated_at=now)
    if user.get('role')!='owner' and set(old)-{s['id'] for s in raw['shifts']}:raise ValueError('Історію змін не можна видаляти. Скористайтеся скасуванням.')


def assert_no_new_conflicts(before,after):
    from datetime import date,timedelta
    from calendar import monthrange
    def day(value):
        utc=datetime.fromisoformat(value.replace('Z','+00:00'))
        def transition(month):
            d=date(utc.year,month,monthrange(utc.year,month)[1])
            return datetime.combine(d-timedelta(days=(d.weekday()+1)%7),datetime.min.time(),timezone.utc)+timedelta(hours=1)
        return (utc+timedelta(hours=3 if transition(3)<=utc<transition(10) else 2)).date().toordinal()
    def conflicts(state):
        work={}
        for s in state.get('shifts',[]):
            if s['status'] in ('Скасовано','Вихідний'):continue
            end=(datetime.fromisoformat((s.get('actual_end') or s['end']).replace('Z','+00:00'))-timedelta(milliseconds=1)).isoformat().replace('+00:00','Z')
            for m in s['members']:work.setdefault(m['id'],[]).append((day(s['start']),day(end),s['warehouse_name']))
        for e in state.get('events',[]):
            if e['kind']=='Робота' and not e.get('cancelled'):work.setdefault(e['person_id'],[]).append((date.fromisoformat(e['start']).toordinal(),date.fromisoformat(e['end']).toordinal(),'Індивідуальна робота'))
        result=[]
        for e in state.get('events',[]):
            if e['kind']=='Робота' or e.get('cancelled'):continue
            a=date.fromisoformat(e['start']).toordinal();b=date.fromisoformat(e['end']).toordinal()
            if e.get('returned_on'):b=min(b,date.fromisoformat(e['returned_on']).toordinal()-1)
            for x,y,point in work.get(e['person_id'],[]):
                start=max(a,x);end=min(b,y)
                if start<=end:result.append((e['person_id'],start,end,e['kind'],point))
        return result
    previous={}
    for person,start,end,kind,point in conflicts(before):previous.setdefault(person,[]).append((start,end))
    for person,start,end,kind,point in conflicts(after):
        cursor=start
        for a,b in sorted(previous.get(person,[])):
            if a>cursor:break
            if b>=cursor:cursor=b+1
            if cursor>end:break
        if cursor<=end:
            name=next((p['name'] for p in after['people'] if p['id']==person),person)
            raise ValueError(name+' · '+kind+' перетинається з роботою на '+point+'. Спочатку оформіть заміну або змініть дати.')
