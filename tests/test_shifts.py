import unittest,copy,tempfile,sys
from pathlib import Path
from server import Database,Problem,validate_state
from shifts import prepare_shifts,validate_shifts
from server import text
def state():
    return dict(title='Тест',people=[dict(id='p',name='Іван',archived=False)],events=[],groups=[],roles=[],warehouses=[dict(id='w',name='АТБ',number='',address='',archived=False)],shifts=[dict(id='s',warehouse_id='w',warehouse_name='АТБ',group='',start='2026-10-21T05:00:00.000Z',end='2026-10-21T17:00:00.000Z',actual_end='',status='Заплановано',members=[dict(id='p',name='Іван')],responsible_id='p',notes='')])
class ShiftTests(unittest.TestCase):
    def test_merged_backup_contains_chat_and_shifts(self):
        from chat import chat_route
        from fullbackup import full_backup
        import json
        with tempfile.TemporaryDirectory() as folder:
            db=Database(Path(folder)/'test.sqlite3');db.bootstrap('admin','TestPassword123!');user=db.login('admin','TestPassword123!','test')['user'];db.commit(user,state(),0)
            chat_route(db,user,'/api/chat/messages',{},True,dict(body='Тест об’єднання',client_id='merged-test-123'))
            packet=full_backup(db);self.assertEqual(len(packet['tables']['chat_messages']),1);self.assertEqual(len(json.loads(packet['tables']['workspace'][0]['data'])['shifts']),1)
    def test_local_server_serves_all_new_browser_modules(self):
        from server import make_server
        import threading,urllib.request
        with tempfile.TemporaryDirectory() as folder:
            server=make_server(Database(Path(folder)/'test.sqlite3'),port=0);thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
            try:
                for module in ('shifts-ui.js','shifts-model.js','chat-ui.js'):
                    with urllib.request.urlopen('http://127.0.0.1:'+str(server.server_port)+'/'+module) as response:self.assertEqual(response.status,200)
            finally:server.shutdown();server.server_close();thread.join()
    @unittest.skipUnless(sys.platform=='win32','Windows DPAPI')
    def test_daily_local_backup_roundtrip(self):
        import local_backups
        with tempfile.TemporaryDirectory() as folder:
            db=Database(Path(folder)/'test.sqlite3');db.commit(dict(id='actor',login='editor',role='editor'),state(),0)
            result=local_backups.create(db);self.assertEqual(local_backups.rows(db)[0]['id'],result['id']);packet=local_backups.read(db,result['id']);self.assertEqual(packet['engine'],'python-sqlite');self.assertEqual(len(__import__('json').loads(packet['tables']['workspace'][0]['data'])['shifts']),1)
            with self.assertRaises(ValueError):local_backups.read(db,'../test')
    def test_overlap_and_adjacent(self):
        s=state();two=copy.deepcopy(s['shifts'][0]);two['id']='two';s['shifts'].append(two)
        with self.assertRaises(ValueError):validate_shifts(s,text)
        two['start']=two['end'];two['end']='2026-10-22T05:00:00.000Z';self.assertEqual(len(validate_shifts(s,text)['shifts']),2)
        s['warehouses'][0]['archived']=True
        with self.assertRaises(ValueError):validate_shifts(s,text)
    def test_history_snapshots_and_server_actor(self):
        s=state();prepare_shifts(s,{},dict(id='actor'));s=validate_state(s);after=copy.deepcopy(s);after['people']=[];prepare_shifts(after,s,dict(id='other'));self.assertEqual(validate_state(after)['shifts'][0]['members'][0]['name'],'Іван')
        after=copy.deepcopy(s);after['shifts']=[]
        with self.assertRaises(ValueError):prepare_shifts(after,s,dict(id='other'))
    def test_database_commit_persistence_and_stale_client(self):
        with tempfile.TemporaryDirectory() as folder:
            db=Database(Path(folder)/'test.sqlite3');user=dict(id='actor',login='editor',role='editor');out=db.commit(user,state(),0);self.assertEqual(out['state']['shifts'][0]['created_by'],'actor')
            old={k:v for k,v in out['state'].items() if k not in ('warehouses','shifts')};out=db.commit(user,old,out['revision']);self.assertEqual(len(out['state']['shifts']),1)
            self.assertEqual(len(Database(db.path).read()['state']['shifts']),1)
            with self.assertRaises(Problem):db.commit(dict(user,role='viewer'),state(),out['revision'])
