"""Windows EXE updates from this project's GitHub Releases, verified before staging."""
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import threading
import urllib.request
import urllib.error
from urllib.parse import urlsplit

REPOSITORY = 'doordie9500-commits/personnel-workspace'
MAX_EXE = 200_000_000


def version_tuple(value):
    match = re.fullmatch(r'v?(\d+)\.(\d+)\.(\d+)', str(value))
    if not match: raise ValueError('Невідомий формат версії.')
    return tuple(map(int, match.groups()))


def trusted_asset(url):
    parsed = urlsplit(url)
    return parsed.scheme == 'https' and parsed.netloc == 'github.com' and parsed.path.startswith('/'+REPOSITORY+'/releases/download/') and not parsed.username


def fetch_json(url, maximum=1_000_000):
    request = urllib.request.Request(url, headers={'User-Agent': 'PersonnelWorkspace-Updater', 'Accept': 'application/vnd.github+json'})
    with urllib.request.urlopen(request, timeout=30) as response:
        data=response.read(maximum+1)
    if len(data)>maximum: raise ValueError('Завеликий опис оновлення.')
    return json.loads(data)


def release_info(current):
    try: release=fetch_json('https://api.github.com/repos/'+REPOSITORY+'/releases/latest')
    except urllib.error.HTTPError as error:
        if error.code==404:return None
        raise
    if release.get('draft') or release.get('prerelease') or version_tuple(release.get('tag_name'))<=version_tuple(current):return None
    assets={item['name']:item for item in release.get('assets',[])}
    if not {'PersonnelWeb.exe','update-manifest.json'}<=assets.keys():raise ValueError('Реліз не містить усіх файлів оновлення.')
    exe,manifest=assets['PersonnelWeb.exe'],assets['update-manifest.json']
    if not trusted_asset(exe['browser_download_url']) or not trusted_asset(manifest['browser_download_url']):raise ValueError('Оновлення має походити лише з репозиторію програми.')
    info=fetch_json(manifest['browser_download_url'],10000)
    if version_tuple(info.get('version'))!=version_tuple(release['tag_name']) or info.get('filename')!='PersonnelWeb.exe':raise ValueError('Маніфест не відповідає версії релізу.')
    checksum=info.get('sha256','')
    if not re.fullmatch('[a-fA-F0-9]{64}',checksum) or not 0<int(info.get('size',0))<=MAX_EXE or int(info['size'])!=exe.get('size'):raise ValueError('Некоректна контрольна сума або розмір оновлення.')
    if exe.get('digest') and exe['digest'].lower()!='sha256:'+checksum.lower():raise ValueError('Контрольна сума GitHub не збігається з маніфестом.')
    return {'version':info['version'],'url':exe['browser_download_url'],'sha256':checksum.lower(),'size':int(info['size'])}


def download_verified(info,folder):
    folder=Path(folder);folder.mkdir(parents=True,exist_ok=True)
    if not trusted_asset(info['url']):raise ValueError('Недовірене джерело оновлення.')
    target=folder/'PersonnelWeb.pending.exe';partial=folder/'PersonnelWeb.download'
    digest=hashlib.sha256();count=0
    try:
        request=urllib.request.Request(info['url'],headers={'User-Agent':'PersonnelWorkspace-Updater'})
        with urllib.request.urlopen(request,timeout=60) as response,partial.open('wb') as output:
            while chunk:=response.read(262144):
                count+=len(chunk)
                if count>min(info['size'],MAX_EXE):raise ValueError('Розмір завантаження перевищує маніфест.')
                digest.update(chunk);output.write(chunk)
        if count!=info['size'] or digest.hexdigest()!=info['sha256']:raise ValueError('Оновлення пошкоджене: перевірка SHA-256 не пройшла.')
        partial.replace(target)
        return target
    except Exception:
        partial.unlink(missing_ok=True)
        raise


def powershell_literal(value):
    return "'"+str(value).replace("'","''")+"'"


def launch_installer(staged,target,checksum,restart_args):
    if os.name!='nt':raise ValueError('Встановлення EXE доступне лише у Windows.')
    staged,target=Path(staged).resolve(),Path(target).resolve()
    if staged.name!='PersonnelWeb.pending.exe' or target.suffix.lower()!='.exe':raise ValueError('Неправильний шлях оновлення.')
    if hashlib.sha256(staged.read_bytes()).hexdigest()!=checksum:raise ValueError('SHA-256 змінився перед встановленням.')
    # All interpolated paths/arguments are literal-quoted; no shell-built executable commands.
    script=staged.parent/'install-update.ps1'
    args=powershell_literal(subprocess.list2cmdline(restart_args))
    source=f'''$ErrorActionPreference = 'Stop'
$oldProcessId = {os.getpid()}
$targetFile = {powershell_literal(target)}
$stagedFile = {powershell_literal(staged)}
$checksum = {powershell_literal(checksum)}
$deadline = (Get-Date).AddHours(24)
while ((Get-Process -Id $oldProcessId -ErrorAction SilentlyContinue) -and (Get-Date) -lt $deadline) {{ Start-Sleep -Seconds 2 }}
if (Get-Process -Id $oldProcessId -ErrorAction SilentlyContinue) {{ exit 1 }}
Start-Sleep -Seconds 2
if ((Get-FileHash -LiteralPath $stagedFile -Algorithm SHA256).Hash.ToLower() -ne $checksum) {{ exit 2 }}
$backupFile = $targetFile + '.previous'
try {{
  if (Test-Path -LiteralPath $backupFile) {{ Remove-Item -LiteralPath $backupFile -Force }}
  Move-Item -LiteralPath $targetFile -Destination $backupFile -Force
  try {{ Move-Item -LiteralPath $stagedFile -Destination $targetFile -Force }}
  catch {{ Move-Item -LiteralPath $backupFile -Destination $targetFile -Force; throw }}
  Start-Process -FilePath $targetFile -ArgumentList {args} -WindowStyle Normal
}} catch {{ $_ | Out-File -LiteralPath {powershell_literal(staged.parent/'update-error.txt')} }}
'''
    script.write_text(source,encoding='utf-8-sig')
    return subprocess.Popen(['powershell.exe','-NoProfile','-ExecutionPolicy','Bypass','-WindowStyle','Hidden','-File',str(script)],creationflags=subprocess.CREATE_NO_WINDOW|subprocess.DETACHED_PROCESS,close_fds=True)


class UpdateManager:
    def __init__(self,current,directory,executable=None,restart_args=None):
        self.current=current;self.directory=Path(directory);self.executable=Path(executable or sys.executable)
        self.supported=bool(getattr(sys,'frozen',False) and os.name=='nt')
        self.restart_args=restart_args or ['--open',*sys.argv[1:]]
        self.preferences=self.directory/'update-settings.json'
        self.status={'current':current,'supported':self.supported,'enabled':True,'state':'idle','message':'Оновлення EXE доступне у Windows-збірці.' if not self.supported else 'Оновлення перевіряються автоматично.'}
        self.lock=threading.Lock();self.armed=False;self.info=None;self.installer=None
        if self.preferences.exists():
            try:self.status['enabled']=json.loads(self.preferences.read_text()).get('enabled',True) is True
            except (OSError,ValueError):pass

    def settings(self,enabled):
        self.directory.mkdir(parents=True,exist_ok=True)
        self.preferences.write_text(json.dumps({'enabled':bool(enabled)}),encoding='utf-8')
        self.status['enabled']=bool(enabled)
        if not enabled and self.installer and self.installer.poll() is None:
            self.installer.terminate();self.installer=None;self.armed=False
            self.status.update(state='idle',message='Автоматичне встановлення вимкнено.')

    def check_async(self):
        if self.armed:return self.snapshot()
        if not self.supported:return self.snapshot()
        if not self.lock.acquire(blocking=False):return self.snapshot()
        def run():
            try:
                self.status.update(state='checking',message='Перевірка GitHub Releases…')
                self.info=release_info(self.current)
                if not self.info:self.status.update(state='current',message='Встановлено актуальну версію.');return
                self.status.update(state='downloading',latest=self.info['version'],message='Завантаження й перевірка SHA-256…')
                staged=download_verified(self.info,self.directory)
                if not self.armed and self.status['enabled']:
                    self.installer=launch_installer(staged,self.executable,self.info['sha256'],self.restart_args);self.armed=True
                self.status.update(state='ready',message='Версія '+self.info['version']+' готова. Її буде встановлено після закриття програми.')
            except Exception as error:self.status.update(state='error',message='Не вдалося оновити: '+str(error))
            finally:self.lock.release()
        threading.Thread(target=run,daemon=True).start()
        return self.snapshot()

    def arm(self):
        if not self.supported or not self.info or self.status['state']!='ready':raise ValueError('Оновлення ще не готове.')
        if not self.armed:
            self.installer=launch_installer(self.directory/'PersonnelWeb.pending.exe',self.executable,self.info['sha256'],self.restart_args)
            self.armed=True

    def snapshot(self):return dict(self.status)
