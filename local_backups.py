"""Daily local full archives protected by the current Windows user's DPAPI."""
import json,re,secrets,sys,threading
from datetime import datetime,timezone
from pathlib import Path
from fullbackup import full_backup
from backup_windows import save_encrypted,crypt,HEADER
_lock=threading.Lock()
def directory(database):return database.path.parent/'daily-backups'
def rows(database):
    folder=directory(database)
    return [dict(id=p.stem,created=p.stem[:10]+'T'+p.stem[11:19].replace('-',':')+'Z') for p in sorted(folder.glob('*.pbackup'),reverse=True)][:30]
def create(database):
    if sys.platform!='win32':raise ValueError('Локальні щоденні копії потребують Windows DPAPI. Експортуйте парольний резерв.')
    with _lock:
        folder=directory(database);folder.mkdir(parents=True,exist_ok=True)
        stamp=datetime.now(timezone.utc);identifier=stamp.strftime('%Y-%m-%dT%H-%M-%S')+'-'+secrets.token_hex(4)
        save_encrypted(json.dumps(full_backup(database),ensure_ascii=False).encode(),folder/(identifier+'.pbackup'))
        for old in sorted(folder.glob('*.pbackup'),reverse=True)[30:]:old.unlink()
        return dict(id=identifier,created=stamp.isoformat())
def read(database,identifier):
    if not re.fullmatch(r'\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-[a-f0-9]{8}',identifier):raise ValueError('Некоректний ідентифікатор резерву.')
    raw=(directory(database)/(identifier+'.pbackup')).read_bytes()
    if not raw.startswith(HEADER):raise ValueError('Некоректний резерв.')
    return json.loads(crypt(raw[len(HEADER):],True))
def start(database,stop):
    def run():
        while not stop.is_set():
            try:
                if not rows(database) or rows(database)[0]['created'][:10]!=datetime.now(timezone.utc).date().isoformat():create(database)
            except Exception as exc:print('Daily backup failed:',type(exc).__name__,flush=True)
            stop.wait(60)
    if sys.platform=='win32':threading.Thread(target=run,daemon=True,name='daily-backup').start()
