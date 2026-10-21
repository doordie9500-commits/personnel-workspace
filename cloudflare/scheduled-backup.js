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
  await env.DB.batch([env.DB.prepare('INSERT INTO scheduled_backups(id,created,data) VALUES(?,?,?)').bind(id,created,data),env.DB.prepare('DELETE FROM scheduled_backups WHERE id NOT IN (SELECT id FROM scheduled_backups ORDER BY created DESC,rowid DESC LIMIT 30)')]);
  return {id,created};
}
export async function decryptScheduledBackup(row,secret){const data=JSON.parse(row.data);if(data.format!=='personnel-scheduled-v1')throw Error('Невідомий формат резерву.');return JSON.parse(decoder.decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:decode(data.iv),additionalData:encoder.encode(row.id)},await key(secret),decode(data.ciphertext))));}
