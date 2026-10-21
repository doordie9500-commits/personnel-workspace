import hashlib
import io
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from updater import version_tuple, trusted_asset, release_info, download_verified, powershell_literal, REPOSITORY, UpdateManager


class UpdateTests(unittest.TestCase):
    def test_version_and_source_restrictions(self):
        self.assertGreater(version_tuple('v2.10.0'),version_tuple('2.9.9'))
        for version in ('v2.0.0-beta','2.0','latest','../../file'):
            with self.assertRaises(ValueError):version_tuple(version)
        self.assertTrue(trusted_asset('https://github.com/'+REPOSITORY+'/releases/download/v2.1.0/PersonnelWeb.exe'))
        for url in ('http://github.com/'+REPOSITORY+'/releases/download/v2.1.0/a','https://github.com.evil.example/'+REPOSITORY+'/releases/download/v2.1.0/a','https://github.com/other/project/releases/download/v2.1.0/a','file:///PersonnelWeb.exe'):
            self.assertFalse(trusted_asset(url))

    def test_release_manifest_must_match_github_digest_and_version(self):
        base='https://github.com/'+REPOSITORY+'/releases/download/v2.2.0/'
        release={'tag_name':'v2.2.0','assets':[{'name':'PersonnelWeb.exe','browser_download_url':base+'PersonnelWeb.exe','size':5,'digest':'sha256:'+'a'*64},{'name':'update-manifest.json','browser_download_url':base+'update-manifest.json'}]}
        manifest={'version':'2.2.0','filename':'PersonnelWeb.exe','sha256':'a'*64,'size':5}
        with patch('updater.fetch_json',side_effect=[release,manifest]):self.assertEqual(release_info('2.1.0')['version'],'2.2.0')
        with patch('updater.fetch_json',side_effect=[release,dict(manifest,sha256='b'*64)]),self.assertRaises(ValueError):release_info('2.1.0')
        with patch('updater.fetch_json',side_effect=[release,dict(manifest,version='2.3.0')]),self.assertRaises(ValueError):release_info('2.1.0')
        with patch('updater.fetch_json',return_value=release):self.assertIsNone(release_info('2.2.0'))

    def test_corrupt_download_is_never_staged(self):
        payload=b'MZtest';info={'url':'https://github.com/'+REPOSITORY+'/releases/download/v2.2.0/PersonnelWeb.exe','size':len(payload),'sha256':'a'*64}
        with tempfile.TemporaryDirectory(dir=Path(__file__).resolve().parent) as folder:
            with patch('updater.urllib.request.urlopen',return_value=io.BytesIO(payload)),self.assertRaises(ValueError):download_verified(info,folder)
            self.assertFalse(list(Path(folder).iterdir()))
            info['sha256']=hashlib.sha256(payload).hexdigest()
            with patch('updater.urllib.request.urlopen',return_value=io.BytesIO(payload)):
                staged=download_verified(info,folder)
            self.assertEqual(staged.read_bytes(),payload)

    def test_powershell_paths_are_literal_quoted(self):
        value="C:/Users/O'Brien/$not-a-command.exe"
        self.assertEqual(powershell_literal(value),"'C:/Users/O''Brien/$not-a-command.exe'")

    def test_source_installation_does_not_download_updates(self):
        with tempfile.TemporaryDirectory(dir=Path(__file__).resolve().parent) as folder:
            manager=UpdateManager('2.1.0',folder)
            with patch('updater.release_info') as check:
                manager.check_async()
                check.assert_not_called()
            manager.settings(False)
            self.assertFalse(UpdateManager('2.1.0',folder).snapshot()['enabled'])


if __name__=='__main__':unittest.main()
