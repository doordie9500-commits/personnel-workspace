import {stylesXML,worksheetXML} from './excel-styles.js';
// Minimal interoperable XLSX: ZIP container + SpreadsheetML. No remote scripts.
const enc = new TextEncoder();
const dec = new TextDecoder();
const xml = s => String(s ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
function crc32(bytes) { let crc=-1; for(const b of bytes){crc^=b;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return (crc^-1)>>>0; }
function col(n){let s='';for(n++;n;n=Math.floor((n-1)/26))s=String.fromCharCode(65+(n-1)%26)+s;return s;}
function zip(files){
  let offset=0;const chunks=[],central=[];
  for(const [name,content] of Object.entries(files)){
    const filename=enc.encode(name),body=enc.encode(content),crc=crc32(body);
    const head=new Uint8Array(30+filename.length),v=new DataView(head.buffer);
    v.setUint32(0,0x04034b50,true);v.setUint16(4,20,true);v.setUint32(14,crc,true);v.setUint32(18,body.length,true);v.setUint32(22,body.length,true);v.setUint16(26,filename.length,true);head.set(filename,30);
    const dir=new Uint8Array(46+filename.length),d=new DataView(dir.buffer);
    d.setUint32(0,0x02014b50,true);d.setUint16(4,20,true);d.setUint16(6,20,true);d.setUint32(16,crc,true);d.setUint32(20,body.length,true);d.setUint32(24,body.length,true);d.setUint16(28,filename.length,true);d.setUint32(42,offset,true);dir.set(filename,46);
    chunks.push(head,body);central.push(dir);offset+=head.length+body.length;
  }
  const length=central.reduce((n,a)=>n+a.length,0),tail=new Uint8Array(22),t=new DataView(tail.buffer);
  t.setUint32(0,0x06054b50,true);t.setUint16(8,central.length,true);t.setUint16(10,central.length,true);t.setUint32(12,length,true);t.setUint32(16,offset,true);
  return new Blob([...chunks,...central,tail],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
}
export function workbook(sheets){
  const names=Object.keys(sheets),files={};
  files['[Content_Types].xml']='<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'+'<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'+names.map((_,i)=>`<Override PartName="/xl/worksheets/sheet${i+1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')+'</Types>';
  files['_rels/.rels']='<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>';
  files['xl/workbook.xml']='<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>'+names.map((n,i)=>`<sheet name="${xml(n.slice(0,31))}" sheetId="${i+1}" r:id="rId${i+1}"/>`).join('')+'</sheets></workbook>';
  files['xl/styles.xml']=stylesXML;
  files['xl/_rels/workbook.xml.rels']='<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'+names.map((_,i)=>`<Relationship Id="rId${i+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i+1}.xml"/>`).join('')+`<Relationship Id="rId${names.length+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;
  names.forEach((name,i)=>{files[`xl/worksheets/sheet${i+1}.xml`]=worksheetXML(sheets[name]);});
  return zip(files);
}
async function unzip(buffer){
  const bytes=new Uint8Array(buffer),view=new DataView(buffer),files={};let eocd=-1;
  for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--)if(view.getUint32(i,true)===0x06054b50){eocd=i;break;}
  if(eocd<0)throw Error('Це не файл XLSX. Виберіть .xlsx або .csv.');
  let offset=view.getUint32(eocd+16,true);const count=view.getUint16(eocd+10,true);let total=0;
  if(count>1000)throw Error('Забагато файлів у книзі.');
  for(let i=0;i<count;i++){
    if(view.getUint32(offset,true)!==0x02014b50)throw Error('Пошкоджений XLSX.');
    const method=view.getUint16(offset+10,true),size=view.getUint32(offset+20,true),expanded=view.getUint32(offset+24,true),nl=view.getUint16(offset+28,true),el=view.getUint16(offset+30,true),cl=view.getUint16(offset+32,true),local=view.getUint32(offset+42,true);
    total+=expanded;if(total>20_000_000||expanded>5_000_000)throw Error('Книга завелика. Ліміт розпакованих даних — 20 МБ.');
    const name=dec.decode(bytes.slice(offset+46,offset+46+nl));
    if(view.getUint32(local,true)!==0x04034b50)throw Error('Пошкоджений XLSX.');
    const start=local+30+view.getUint16(local+26,true)+view.getUint16(local+28,true),compressed=bytes.slice(start,start+size);
    if(method===0)files[name]=dec.decode(compressed);
    else if(method===8){
      const reader=new Blob([compressed]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();const chunks=[];let actual=0;
      while(true){const {done,value}=await reader.read();if(done)break;actual+=value.length;if(actual>expanded||actual>5_000_000){await reader.cancel();throw Error('Некоректний розмір XLSX.');}chunks.push(value);}
      files[name]=await new Blob(chunks).text();
    }else throw Error('Непідтримуване стискання XLSX. Збережіть книгу заново або використайте CSV.');
    offset+=46+nl+el+cl;
  }
  return files;
}
function parseXML(s){const dom=new DOMParser().parseFromString(s,'application/xml');if(dom.querySelector('parsererror')||dom.doctype)throw Error('Некоректний XML у книзі.');return dom;}
export async function readWorkbook(file){
  const files=await unzip(await file.arrayBuffer());
  const shared=files['xl/sharedStrings.xml']?[...parseXML(files['xl/sharedStrings.xml']).getElementsByTagName('si')].map(si=>[...si.getElementsByTagName('t')].map(t=>t.textContent).join('')):[];
  const wb=parseXML(files['xl/workbook.xml']),sheet=wb.getElementsByTagName('sheet')[0];
  if(!sheet)throw Error('У книзі немає аркушів.');
  const relid=sheet.getAttribute('r:id'),rels=parseXML(files['xl/_rels/workbook.xml.rels']);
  const target=[...rels.getElementsByTagName('Relationship')].find(r=>r.getAttribute('Id')===relid)?.getAttribute('Target');
  const path=target?.startsWith('/')?target.slice(1):'xl/'+target;
  if(!files[path])throw Error('Не знайдено перший аркуш.');
  const rows=[...parseXML(files[path]).getElementsByTagName('row')];if(rows.length>3001)throw Error('Ліміт імпорту — 3000 людей.');
  return rows.map(row=>{const cells=[];for(const c of row.getElementsByTagName('c')){const ref=c.getAttribute('r')||'',letters=ref.replace(/\d/g,'');let col=0;for(const letter of letters)col=col*26+letter.charCodeAt(0)-64;if(col>50)continue;const type=c.getAttribute('t'),v=c.getElementsByTagName('v')[0]?.textContent||'';cells[col-1]=type==='s'?shared[Number(v)]||'':type==='inlineStr'?[...c.getElementsByTagName('t')].map(t=>t.textContent).join(''):v;}return cells;});
}
export function csvRows(text){
  text=text.replace(/^\uFEFF/,'');const sep=text.split(/\r?\n/)[0].includes(';')?';':',';let rows=[],row=[],value='',quoted=false;
  for(let i=0;i<text.length;i++){const c=text[i];if(c==='"'){if(quoted&&text[i+1]==='"'){value+='"';i++;}else quoted=!quoted;}else if(c===sep&&!quoted){row.push(value);value='';}else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&text[i+1]==='\n')i++;row.push(value);if(row.some(Boolean))rows.push(row);row=[];value='';}else value+=c;}
  if(quoted)throw Error('Незакриті лапки у CSV.');row.push(value);if(row.some(Boolean))rows.push(row);return rows;
}
