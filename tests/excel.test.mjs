import test from 'node:test';
import assert from 'node:assert/strict';
import {workbook,csvRows} from '../web/excel.js';
import {writeFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {scheduleSheets} from '../web/schedule-export.js';
import {encryptBackup,decryptBackup} from '../web/backup-client.js';

test('XLSX is a valid ZIP workbook; formulas and private strings remain literal',async()=>{
  const blob=workbook({'Люди':[['ПІБ','Позивний','Примітки'],['Тестова людина','Тест','<>&"'],['=1+1','@SUM(1)','Текст']], 'Табель':[['Дата','Дні'],['2026-10-21',3]]});
  const directory=await mkdtemp(join(tmpdir(),'personnel-xlsx-'));
  try{
    const file=join(directory,'test.xlsx');await writeFile(file,new Uint8Array(await blob.arrayBuffer()));
    const python=spawnSync('python',['-c',`import zipfile,sys,xml.etree.ElementTree as E
with zipfile.ZipFile(sys.argv[1]) as z:
 assert z.testzip() is None
 assert len(z.namelist())==7
 for name in z.namelist(): E.fromstring(z.read(name))
 s=z.read('xl/worksheets/sheet1.xml').decode()
 assert '=1+1' in s and '<f>' not in s
 assert '&lt;&gt;&amp;&quot;' in s
 assert 'Тестова людина' in s
`,file],{encoding:'utf8'});
    assert.equal(python.status,0,python.stderr);
  }finally{await rm(directory,{recursive:true,force:true});}
});
test('CSV handles BOM, semicolon, quoted separators, CRLF and multiline notes',()=>{
  assert.deepEqual(csvRows('\ufeffПІБ;Примітки\r\n"Тест; один";"рядок 1\nрядок 2"\r\n"Два ""ім’я""";текст'),[['ПІБ','Примітки'],['Тест; один','рядок 1\nрядок 2'],['Два "ім’я"','текст']]);
  assert.throws(()=>csvRows('a,b\n"broken'),/лапки/);
});
test('Styled calendar freezes names and header, colors cells, and calculates totals',async()=>{
  const person={id:'p1',name:'Тест',callsign:'Кедр'},state={title:'Тестовий простір',events:[{id:'e1',person_id:'p1',kind:'Позиції',start:'2026-10-01',end:'2026-10-03'}]};
  const sheets=scheduleSheets(state,[person],'2026-10'),spec=sheets['Поденний графік'];
  assert.equal(spec.rows[4][33].value,3);assert.equal(spec.rows[4][33].formula,'COUNTIFS(C5:AG5,"П")');assert.equal(spec.freezeCols,2);assert.equal(spec.headerRow,3);assert.ok(spec.merge.includes('A1:AM1'));
  const blob=workbook(sheets);assert.ok(blob.size>10000);
});
test('Complete backup encryption round trip rejects wrong passwords and damaged bytes',async()=>{
  const packet={format:'personnel-full-v1',tables:{users:[{login:'test',password:'hash'}],workspace:[]}},encrypted=await encryptBackup(packet,'TestBackupPassword123!');
  assert.ok(!JSON.stringify(encrypted).includes('hash'));
  assert.deepEqual(await decryptBackup(encrypted,'TestBackupPassword123!'),packet);
  await assert.rejects(decryptBackup(encrypted,'WrongPassword123!'));
  await assert.rejects(decryptBackup({...encrypted,data:encrypted.data.slice(0,-5)+'AAAA'},'TestBackupPassword123!'));
});
