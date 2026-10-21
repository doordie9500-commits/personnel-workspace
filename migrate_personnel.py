"""Explicit offline export of personnel + administrative absences, never positions/tasks."""
import argparse
import json
import sqlite3
from pathlib import Path
from server import empty_state, validate_state, ABSENCES


def export_personnel(source):
    # Read-only connection; no modification or initialization of the source database.
    db = sqlite3.connect(Path(source).resolve().as_uri()+'?mode=ro', uri=True)
    db.row_factory = sqlite3.Row
    result = empty_state()
    try:
        crews = {r['id']: r['name'] for r in db.execute('SELECT id,name FROM crews')}
        result['groups'] = list(crews.values())
        for row in db.execute('SELECT * FROM people'):
            p = dict(row)
            # Do not export unstructured legacy notes, phone defaults, locations or duty plans automatically.
            person = {k: str(p.get(k) or '') for k in ('name', 'callsign', 'rank', 'role', 'phone')}
            person.update(id='legacy-'+str(p['id']), unit=str(p.get('section') or ''), group=crews.get(p['crew_id'], ''), service_since=str(p.get('service_since') or '')[:10], archived=not bool(p['active']), notes='')
            if person['role'] and person['role'] not in result['roles']: result['roles'].append(person['role'])
            result['people'].append(person)
        for row in db.execute('SELECT * FROM events'):
            e = dict(row)
            if e['kind'] not in ABSENCES: continue
            start, end = e['start'][:10], e['end'][:10]
            if e['end'][11:] == '00:00':
                from datetime import date, timedelta
                end = (date.fromisoformat(end)-timedelta(days=1)).isoformat()
            if end < start: end = start
            returned = db.execute('SELECT returned_on FROM leave_returns WHERE event_id=?', (e['id'],)).fetchone()
            result['events'].append(dict(id='legacy-'+str(e['id']),person_id='legacy-'+str(e['person_id']),kind=e['kind'],start=start,end=end,notes='',returned_on=returned['returned_on'][:10] if returned else '',cancelled=e['status']=='Скасовано'))
    finally: db.close()
    return validate_state(result)


if __name__ == '__main__':
    parser=argparse.ArgumentParser(description='Export personnel and leave/medical records to a local JSON file. No automatic upload.')
    parser.add_argument('source')
    parser.add_argument('output')
    args=parser.parse_args()
    data=export_personnel(args.source)
    with open(args.output,'x',encoding='utf-8') as stream:
        json.dump({'format':'personnel-web-v2','state':data},stream,ensure_ascii=False,indent=2)
    print(f"Exported {len(data['people'])} people and {len(data['events'])} administrative absences. Source unchanged.")
