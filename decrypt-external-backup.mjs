// Offline recovery: BACKUP_KEY is supplied in the environment, never as a CLI argument.
import {readFile,writeFile} from 'node:fs/promises';
import {decryptScheduledBackup} from './cloudflare/scheduled-backup.js';
const [input,output]=process.argv.slice(2);
if(!input||!output||!process.env.BACKUP_KEY)throw Error('Usage: set BACKUP_KEY securely, then node decrypt-external-backup.mjs archive.json recovered.json');
const archive=JSON.parse(await readFile(input,'utf8'));
const packet=await decryptScheduledBackup({id:archive.id,data:JSON.stringify(archive.data)},process.env.BACKUP_KEY);
await writeFile(output,JSON.stringify(packet,null,2),{flag:'wx'});
console.log('Recovery file created. It contains private data; keep it outside Git.');
