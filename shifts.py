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
        if item['id'] in shift_ids or item['warehouse_id'] not in ids or item['status'] not in STATUSES or item['end']<=item['start'] or (datetime.fromisoformat(item['end'].replace('Z','+00:00'))-datetime.fromisoformat(item['start'].replace('Z','+00:00'))).total_seconds()>7*86400:raise ValueError('Перевірте склад, статус та тривалість зміни.')
        shift_ids.add(item['id'])
        if (item['status']=='Завершили зміну')!=bool(item['actual_end']) or (item['actual_end'] and item['actual_end']<=item['start']):raise ValueError('Перевірте фактичне завершення зміни.')
        if not isinstance(s.get('members'),list) or not 0<len(s['members'])<=3000:raise ValueError('Виберіть працівників.')
        member_ids=set();item['members']=[]
        for m in s['members']:
            member={'id':text(m.get('id'),200,True),'name':text(m.get('name'),200,True)}
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
        if previous and previous['status'] in ('Завершили зміну','Скасовано'):raise ValueError('Історична зміна доступна лише для перегляду.')
        for m in s.get('members',[]):
            if m['id'] not in people or people[m['id']]['archived']:raise ValueError('Виберіть активного працівника.')
            m['name']=people[m['id']]['name']
        s['warehouse_name']=next((w['name'] for w in raw['warehouses'] if w['id']==s['warehouse_id']),'')
        s.update(created_by=previous.get('created_by') if previous else user['id'],created_at=previous.get('created_at') if previous else now,updated_by=user['id'],updated_at=now)
    if set(old)-{s['id'] for s in raw['shifts']}:raise ValueError('Історію змін не можна видаляти. Скористайтеся скасуванням.')
