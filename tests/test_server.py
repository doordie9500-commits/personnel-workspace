import copy
import json
import tempfile
import threading
import unittest
import urllib.request
import urllib.error
from pathlib import Path
from unittest.mock import patch
from server import Database, Problem, empty_state, validate_state, make_server, password_ok


def person(pid='p1', name='Тестова людина'):
    return dict(id=pid,name=name,callsign='',rank='',role='',unit='',phone='',group='',notes='',service_since='2020-01-01',archived=False)


def event(eid='e1', start='2026-01-01', end='2026-01-03', kind='ВЛК'):
    return dict(id=eid,person_id='p1',start=start,end=end,kind=kind,notes='',returned_on='',cancelled=False)


class StateTests(unittest.TestCase):
    def setUp(self):
        self.state=empty_state()
        self.state['people']=[person()]

    def test_date_inclusive_conflict(self):
        self.state['events']=[event(),event('e2','2026-01-03','2026-01-05','Відпустка')]
        with self.assertRaises(Problem):validate_state(self.state)
        self.state['events'][1]['start']='2026-01-04'
        self.assertEqual(len(validate_state(self.state)['events']),2)

    def test_rejects_bad_dates_and_unknown_kinds(self):
        for e in [event(start='2026-02-30'),event(kind='На позиції'),event(start='2026-01-04',end='2026-01-02')]:
            with self.subTest(e=e),self.assertRaises(Problem):
                validate_state(dict(self.state,events=[e]))

    def test_rejects_duplicate_person_callsign_and_id(self):
        for other in [person('p2',' Тестова   людина '),person('p1','Інша людина')]:
            with self.assertRaises(Problem):validate_state(dict(self.state,people=[person(),other]))
        a,b=person(),person('p2','Інша людина');a['callsign']='Тест';b['callsign']='тест'
        with self.assertRaises(Problem):validate_state(dict(self.state,people=[a,b]))

    def test_return_closes_only_absence_and_retains_plan(self):
        a=event(end='2026-01-15');a['returned_on']='2026-01-04'
        b=event('e2','2026-01-04','2026-01-05','Робота')
        state=validate_state(dict(self.state,events=[a,b]))
        self.assertEqual(state['events'][0]['end'],'2026-01-15')
        self.assertEqual(state['events'][1],b)

    def test_same_day_return_and_cancelled_period_allow_other_record(self):
        a=event();a['returned_on']=a['start']
        self.assertEqual(len(validate_state(dict(self.state,events=[a,event('e2')]))['events']),2)
        a['returned_on']='';a['cancelled']=True
        self.assertEqual(len(validate_state(dict(self.state,events=[a,event('e2')]))['events']),2)

    def test_return_future_or_work_forbidden(self):
        for e in [dict(event(),returned_on='9999-01-01'),dict(event(kind='Робота'),returned_on='2026-01-02')]:
            with self.assertRaises(Problem):validate_state(dict(self.state,events=[e]))

    def test_admin_fields_only(self):
        p=person();p['location']='unwanted';e=event();e['place_id']=123
        result=validate_state(dict(self.state,people=[p],events=[e]))
        self.assertNotIn('location',result['people'][0]);self.assertNotIn('place_id',result['events'][0])

    def test_categories_and_general_classes(self):
        self.state['people'][0]['category']='Новобранець'
        self.state['classes']=[dict(id='c1',day='2026-10-21',title='Документообіг',teacher='Тест',notes='')]
        self.state['grades']=[dict(id='g1',class_id='c1',person_id='p1',score=84,notes='')]
        result=validate_state(self.state)
        self.assertEqual(result['people'][0]['category'],'Новобранець')
        self.assertEqual(result['grades'][0]['score'],84)
        self.state['grades'][0]['score']=101
        with self.assertRaises(Problem):validate_state(self.state)


class DatabaseTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(dir=Path(__file__).resolve().parent)
        self.db=Database(Path(self.temp.name)/'test.sqlite3')
        self.db.bootstrap('admin','LongTestPassword!123')
        result=self.db.login('admin','LongTestPassword!123','test')
        self.token=result['token'];self.user=result['user']

    def tearDown(self):self.temp.cleanup()

    def test_password_and_session_stored_as_hashes(self):
        with self.db.connect() as conn:
            encoded=conn.execute('SELECT password FROM users').fetchone()[0]
            self.assertNotIn('LongTestPassword',encoded)
            self.assertTrue(password_ok('LongTestPassword!123',encoded))
            self.assertNotEqual(conn.execute('SELECT token FROM sessions').fetchone()[0],self.token)
        self.assertEqual(self.db.identity(self.token)['login'],'admin')
        with self.assertRaises(Problem):self.db.identity('invalid')

    def test_atomic_snapshot_audit_restore_and_conflict(self):
        state=empty_state();state['people']=[person()]
        first=self.db.commit(self.user,state,0,'Додано людину')
        self.assertEqual(first['revision'],1)
        with self.assertRaises(Problem) as err:self.db.commit(self.user,empty_state(),0)
        self.assertEqual(err.exception.status,409)
        with self.db.connect() as conn:
            self.assertEqual(conn.execute('SELECT count(*) FROM backups').fetchone()[0],1)
            audit=json.loads(conn.execute('SELECT details FROM audit').fetchone()[0])
            self.assertEqual(audit[0]['after']['name'],'Тестова людина')
            backup=conn.execute('SELECT id FROM backups').fetchone()[0]
        restored=self.db.commit(self.user,None,1,'Відновлення',backup)
        self.assertEqual(restored['state']['people'],[])
        with self.db.connect() as conn:self.assertEqual(conn.execute('SELECT count(*) FROM backups').fetchone()[0],2)

    def test_invalid_commit_leaves_everything_unchanged(self):
        invalid=empty_state();invalid['people']=[person(),person()]
        with self.assertRaises(Problem):self.db.commit(self.user,invalid,0)
        self.assertEqual(self.db.read()['revision'],0)
        with self.db.connect() as conn:self.assertEqual(conn.execute('SELECT count(*) FROM backups').fetchone()[0],0)

    def test_invite_one_use_and_viewer_cannot_edit(self):
        invited=self.db.invite(self.user,'viewer')['invitation']
        result=self.db.redeem(invited,'viewer','AnotherPassword!123','test2')
        self.assertEqual(result['user']['role'],'viewer')
        with self.assertRaises(Problem):self.db.commit(result['user'],empty_state(),0)
        with self.assertRaises(Problem):self.db.invite(result['user'],'editor')
        with self.assertRaises(Problem):self.db.redeem(invited,'someone','AnotherPassword!123','test2')

    def test_invite_failure_does_not_consume_invite(self):
        invited=self.db.invite(self.user,'editor')['invitation']
        with self.assertRaises(Problem):self.db.redeem(invited,'admin','AnotherPassword!123','test')
        result=self.db.redeem(invited,'editor','AnotherPassword!123','test')
        self.assertEqual(result['user']['role'],'editor')

    def test_shared_data_seen_by_another_user(self):
        invited=self.db.invite(self.user,'editor')['invitation']
        result=self.db.redeem(invited,'editor','AnotherPassword!123','test')
        state=empty_state();state['people']=[person()]
        self.db.commit(result['user'],state,0)
        self.assertEqual(self.db.read()['state']['people'][0]['name'],'Тестова людина')

    def test_rate_limit(self):
        for _ in range(15):self.db.rate_limit('test-rate')
        with self.assertRaises(Problem) as e:self.db.rate_limit('test-rate')
        self.assertEqual(e.exception.status,429)

    def test_snapshot_retention(self):
        for n in range(102):
            state=empty_state();state['title']='Версія '+str(n)
            self.db.commit(self.user,state,n)
        with self.db.connect() as conn:
            self.assertEqual(conn.execute('SELECT count(*) FROM backups').fetchone()[0],100)
            self.assertEqual(conn.execute('SELECT count(*) FROM audit').fetchone()[0],102)


class HTTPTests(DatabaseTests):
    def setUp(self):
        super().setUp()
        self.server=make_server(self.db,port=0)
        self.thread=threading.Thread(target=self.server.serve_forever,daemon=True);self.thread.start()
        self.url=f'http://127.0.0.1:{self.server.server_port}'

    def tearDown(self):
        self.server.shutdown();self.server.server_close();self.thread.join()
        super().tearDown()

    def call(self,path,body=None,token=None,origin=None):
        headers={'Content-Type':'application/json'}
        if token:headers['Authorization']='Bearer '+token
        if origin:headers['Origin']=origin
        req=urllib.request.Request(self.url+path,data=json.dumps(body).encode() if body is not None else None,headers=headers)
        try:
            with urllib.request.urlopen(req) as r:return r.status,json.loads(r.read())
        except urllib.error.HTTPError as e:
            try:return e.code,json.loads(e.read())
            finally:e.close()

    def test_http_auth_cors_and_api(self):
        self.assertEqual(self.call('/api/state')[0],401)
        self.assertEqual(self.call('/api/state',token=self.token,origin='https://evil.example')[0],403)
        status,body=self.call('/api/state',token=self.token)
        self.assertEqual(status,200);self.assertEqual(body['user']['role'],'owner')
        state=empty_state();state['people']=[person()]
        self.assertEqual(self.call('/api/state',{'state':state,'revision':0},self.token)[0],200)
        self.assertEqual(self.call('/api/state',{'state':state,'revision':0},self.token)[0],409)
        self.assertEqual(self.call('/api/audit',token=self.token)[1][0]['details'][0]['after']['name'],'Тестова людина')

    def test_static_assets_cannot_read_database_or_paths(self):
        with urllib.request.urlopen(self.url+'/') as response:
            self.assertIn('Кадровий простір',response.read().decode())
            self.assertEqual(response.headers['X-Content-Type-Options'],'nosniff')
        for path in ['/server.py','/../server.py','/data/personnel.sqlite3']:
            self.assertEqual(self.call(path)[0],404)

    def test_password_change_revokes_other_sessions_and_logout(self):
        second=self.db.login('admin','LongTestPassword!123','second')['token']
        status,_=self.call('/api/password',{'old':'LongTestPassword!123','password':'BrandNewPassword123!'},self.token)
        self.assertEqual(status,200)
        self.assertEqual(self.call('/api/state',token=second)[0],401)
        self.assertEqual(self.call('/api/logout',{},self.token)[0],200)
        self.assertEqual(self.call('/api/state',token=self.token)[0],401)

    def test_revoke_editor_access_and_retains_owner(self):
        invite=self.db.invite(self.user,'editor')['invitation'];editor=self.db.redeem(invite,'editor','LongEditorPassword123!','editor')
        self.assertEqual(self.call('/api/users',{'id':editor['user']['id'],'active':False},self.token)[0],200)
        self.assertEqual(self.call('/api/state',token=editor['token'])[0],401)
        self.assertEqual(self.call('/api/users',{'id':self.user['id'],'active':False},self.token)[0],403)

    def test_pc_proxy_uses_shared_identity_and_state(self):
        remote=make_server(self.db,port=0)
        thread=threading.Thread(target=remote.serve_forever,daemon=True);thread.start()
        self.server.cloud_api=f'http://127.0.0.1:{remote.server_port}'
        try:
            self.assertEqual(self.call('/api/state')[0],401)
            status,result=self.call('/api/state',token=self.token)
            self.assertEqual(status,200);self.assertEqual(result['user']['id'],self.user['id'])
            status,result=self.call('/api/update',token=self.token)
            self.assertEqual(status,200);self.assertFalse(result['supported'])
            with urllib.request.urlopen(self.url+'/config.js') as response:
                self.assertIn('SHARE_URL',response.read().decode())
        finally:
            remote.shutdown();remote.server_close();thread.join()

    def test_manual_registration_and_complete_backup_restore(self):
        self.assertEqual(self.call('/api/register',{'login':'manual','password':'ManualPassword123!','role':'editor'},self.token)[0],200)
        status,backup=self.call('/api/full-backup',token=self.token)
        self.assertEqual(status,200);self.assertEqual(len(backup['tables']['users']),2)
        self.assertTrue(backup['tables']['users'][0]['password'])
        self.assertEqual(self.call('/api/full-restore',{'backup':backup,'revision':0,'confirm':'wrong'},self.token)[0],400)
        status,result=self.call('/api/full-restore',{'backup':backup,'revision':0,'confirm':'ВІДНОВИТИ БАЗУ'},self.token)
        self.assertEqual(status,200);self.assertTrue(result['sign_in_again'])
        self.assertEqual(self.call('/api/state',token=self.token)[0],401)
        self.assertTrue(list(Path(self.temp.name).glob('before-full-restore-*.sqlite3')))


if __name__=='__main__':unittest.main()
