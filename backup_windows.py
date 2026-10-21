"""Windows-user encrypted backup. DPAPI binds the file to the current Windows account."""
import ctypes
from ctypes import wintypes
from pathlib import Path
import sys

HEADER=b'PERSONNEL-DPAPI-V1\n'


class Blob(ctypes.Structure):
    _fields_=[('size',wintypes.DWORD),('data',ctypes.POINTER(ctypes.c_ubyte))]


def crypt(data,decrypt=False):
    if sys.platform!='win32':raise OSError('Ця копія використовує Windows DPAPI; для інших систем експортуйте зашифрований резерв із сайту.')
    source_buffer=ctypes.create_string_buffer(data)
    source=Blob(len(data),ctypes.cast(source_buffer,ctypes.POINTER(ctypes.c_ubyte)));target=Blob()
    library=ctypes.WinDLL('crypt32',use_last_error=True)
    function=library.CryptUnprotectData if decrypt else library.CryptProtectData
    function.restype=wintypes.BOOL
    function.argtypes=[ctypes.POINTER(Blob),ctypes.POINTER(ctypes.c_wchar_p) if decrypt else ctypes.c_wchar_p,ctypes.c_void_p,ctypes.c_void_p,ctypes.c_void_p,wintypes.DWORD,ctypes.POINTER(Blob)]
    description=None if decrypt else 'Personnel workspace backup'
    if not function(ctypes.byref(source),description,None,None,None,1,ctypes.byref(target)):raise ctypes.WinError(ctypes.get_last_error())
    try:return ctypes.string_at(target.data,target.size)
    finally:
        kernel=ctypes.WinDLL('kernel32',use_last_error=True)
        kernel.LocalFree.argtypes=[ctypes.c_void_p];kernel.LocalFree.restype=ctypes.c_void_p
        kernel.LocalFree(target.data)


def save_encrypted(data,path):
    cipher=crypt(data)
    if crypt(cipher,True)!=data:raise ValueError('Перевірка зашифрованої копії не пройшла.')
    with open(path,'xb') as stream:stream.write(HEADER+cipher)


if __name__=='__main__':
    if len(sys.argv)!=4 or sys.argv[1]!='decrypt':raise SystemExit('Usage: python backup_windows.py decrypt input.pbackup output.json')
    raw=Path(sys.argv[2]).read_bytes()
    if not raw.startswith(HEADER):raise SystemExit('Це не DPAPI-копія кадрової бази.')
    with open(sys.argv[3],'xb') as stream:stream.write(crypt(raw[len(HEADER):],True))
    print('Розшифровано в окремий файл. Не завантажуйте його в GitHub.')
