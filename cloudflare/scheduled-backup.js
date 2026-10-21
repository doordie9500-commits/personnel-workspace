import {fullBackup} from './backup.js';
const encoder=new TextEncoder(),decoder=new TextDecoder();
const encode=bytes=>{let value='';for(const byte of new Uint8Array(bytes))value+=String.fromCharCode(byte);return btoa(value);};
const decode=value=>Uint8Array.from(atob(value),c=>c.charCodeAt(0));
async function key(secret){if(!secret)throw Error('Не налаштовано BACKUP_KEY.');const bytes=decode(secret);if(bytes.length!==32)throw Error('Некоректний ключ резервування.');return crypto.subtle.importKey('raw',bytes,'AES-GCM',false,['encrypt','decrypt']);}
export async function createScheduledBackup(env){
  const packet=await fullBackup(env.DB),iv=crypto.getRandomValues(new Uint8Array(12)),id=crypto.randomUUID(),created=new Date().toISOString();
  const data=JSON.stringify({format:'personnel-scheduled-v1',iv:encode(iv),ciphertext:encode(await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:encoder.encode(id)},await key(env.BACKUP_KEY),encoder.encode(JSON.stringify(packet))))});
  // Verify integrity before saving an encrypted archive.
  const clear=await decryptScheduledBackup({id,data},env.BACKUP_KEY);
  if(clear.format!==packet.format)throw Error('Перевірка резерву не пройшла.');
  const small=encoder.encode(data).length<=1_800_000;
  if(small)await env.DB.batch([env.DB.prepare('INSERT INTO scheduled_backups(id,created,data) VALUES(?,?,?)').bind(id,created,data),env.DB.prepare('DELETE FROM scheduled_backups WHERE id NOT IN (SELECT id FROM scheduled_backups ORDER BY created DESC,rowid DESC LIMIT 30)')]);
  // Export ciphertext only. Keys remain separate secrets, never in an archive.
  const archive=JSON.stringify({id,created,data:JSON.parse(data)}),path='personnel-backups/'+created.slice(0,10)+'/'+id+'.json';
  const external={r2:false,github:false};
  if(env.BACKUP_BUCKET){await env.BACKUP_BUCKET.put(path,archive,{httpMetadata:{contentType:'application/json'}});external.r2=true;}
  if(env.BACKUP_GITHUB_REPO){
    if(!/^[\w.-]+\/[\w.-]+$/.test(env.BACKUP_GITHUB_REPO)||!env.BACKUP_GITHUB_TOKEN)throw Error('Перевірте приватний репозиторій резервів та його токен.');
    if(encoder.encode(archive).length>20_000_000)throw Error('Для копій понад 20 МБ використовуйте BACKUP_BUCKET.');
    const headers={Authorization:'Bearer '+env.BACKUP_GITHUB_TOKEN,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28','User-Agent':'PersonnelWorkspace-Backup'};
    const repo=await fetch('https://api.github.com/repos/'+env.BACKUP_GITHUB_REPO,{headers});
    if(!repo.ok||(await repo.json()).private!==true)throw Error('Резерви дозволені лише у приватний GitHub-репозиторій.');
    const response=await fetch('https://api.github.com/repos/'+env.BACKUP_GITHUB_REPO+'/contents/'+path,{method:'PUT',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({message:'Encrypted personnel backup '+created.slice(0,10),content:encode(encoder.encode(archive))})});
    if(!response.ok)throw Error('Не вдалося зберегти зашифрований резерв у GitHub.');external.github=true;
  }
  const stored=encoder.encode(data).length<=1_800_000?data:env.BACKUP_BUCKET?JSON.stringify({format:'personnel-r2-reference-v1',key:path}):null;
  if(!stored)throw Error('Великий резерв потребує BACKUP_BUCKET; D1 обмежує розмір одного запису.');
  if(!small)await env.DB.batch([env.DB.prepare('INSERT INTO scheduled_backups(id,created,data) VALUES(?,?,?)').bind(id,created,stored),env.DB.prepare('DELETE FROM scheduled_backups WHERE id NOT IN (SELECT id FROM scheduled_backups ORDER BY created DESC,rowid DESC LIMIT 30)')]);
  return {id,created,external};
}
export async function decryptScheduledBackup(row,secret,bucket){let data=JSON.parse(row.data);if(data.format==='personnel-r2-reference-v1'){if(!bucket)throw Error('Не підключено резервне сховище.');const object=await bucket.get(data.key);if(!object)throw Error('Зовнішній резерв не знайдено.');const archive=JSON.parse(await object.text());if(archive.id!==row.id)throw Error('Некоректний ідентифікатор резерву.');data=archive.data;}if(data.format!=='personnel-scheduled-v1')throw Error('Невідомий формат резерву.');return JSON.parse(decoder.decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:decode(data.iv),additionalData:encoder.encode(row.id)},await key(secret),decode(data.ciphertext))));}
