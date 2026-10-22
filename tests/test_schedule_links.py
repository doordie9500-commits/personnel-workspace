import json
import tempfile
import unittest
from pathlib import Path
from server import Database, Problem
from schedule_links import schedule_links, public_schedule, projection, ShareError

class ScheduleLinksTests(unittest.TestCase):
    def test_links_scope_secrets_revocation_and_expiration(self):
        with tempfile.TemporaryDirectory() as temp:
            db=Database(Path(temp)/'test.db');owner=dict(role='owner',login='test')
            state=dict(people=[dict(id='p',name='Людина',phone='SECRET',group='А')],groups=['А'],events=[dict(id='a',person_id='p',kind='Лікарня',start='2026-10-01',end='2026-10-02')],shifts=[dict(id='s',warehouse_id='w',warehouse_name='ВП1',group='А',start='2026-09-01T00:00:00.000Z',end='2027-01-01T00:00:00.000Z',status='Заплановано',responsible_id='',notes='PRIVATE',members=[dict(id='p',name='Людина')])])
            with db.connect() as conn:conn.execute('UPDATE workspace SET data=?',(json.dumps(state),))
            link=schedule_links(db,owner,True,dict(month='2026-10',days=7,group='А'));data=public_schedule(db,'Share '+link['token'])
            text=json.dumps(data,ensure_ascii=False)
            self.assertNotIn('SECRET',text);self.assertNotIn('PRIVATE',text);self.assertNotIn('Лікарня',text)
            self.assertEqual(data['state']['shifts'][0]['start'],'2026-09-30T21:00:00.000Z')
            self.assertEqual(data['state']['shifts'][0]['end'],'2026-11-30T22:00:00.000Z')
            self.assertNotIn(link['token'],json.dumps(schedule_links(db,owner,False,{})))
            with self.assertRaises(ShareError):schedule_links(db,dict(role='viewer'),True,dict(month='2026-10'))
            with self.assertRaises(ShareError):public_schedule(db,'Bearer '+link['token'])
            schedule_links(db,owner,True,dict(revoke=link['id']))
            with self.assertRaises(ShareError):public_schedule(db,'Share '+link['token'])
            with db.connect() as conn:conn.execute('UPDATE schedule_links SET revoked=0,expires=0')
            with self.assertRaises(ShareError):public_schedule(db,'Share '+link['token'])
