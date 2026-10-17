const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const crypto=require('node:crypto');
const {inflateRawSync}=require('node:zlib');
const {spawnSync}=require('node:child_process');
const JSZip=require('./vendor/jszip-3.10.1.min.cjs');
require('../invoice-ocr.js');
const InvoiceOCR=globalThis.InvoiceOCR;
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
const script=Array.from(html.matchAll(/<script>([\s\S]*?)<\/script>/g),m=>m[1]).join('\n');
const templates=Array.from(html.matchAll(/\{b64:"([^"]+)",out:"([^"]+)"\}/g),m=>({bytes:Buffer.from(m[1],'base64'),name:m[2]}));

// Independent ZIP reader: never use JSZip to read back what JSZip generated.
function unzip(buffer){
  const end=buffer.lastIndexOf(Buffer.from([0x50,0x4b,0x05,0x06]));assert.ok(end>=0);
  const files=new Map();let offset=buffer.readUInt32LE(end+16);
  for(let i=0;i<buffer.readUInt16LE(end+10);i++){
    assert.equal(buffer.readUInt32LE(offset),0x02014b50);
    const method=buffer.readUInt16LE(offset+10),size=buffer.readUInt32LE(offset+20),nameLen=buffer.readUInt16LE(offset+28),extra=buffer.readUInt16LE(offset+30),comment=buffer.readUInt16LE(offset+32),local=buffer.readUInt32LE(offset+42);
    const name=buffer.toString('utf8',offset+46,offset+46+nameLen);
    const start=local+30+buffer.readUInt16LE(local+26)+buffer.readUInt16LE(local+28),data=buffer.subarray(start,start+size);
    assert.ok(method===0||method===8);files.set(name,method===8?inflateRawSync(data):data);offset+=46+nameLen+extra+comment;
  }
  return files;
}
function xmlCells(xml){
  // Standard-library XML parser additionally verifies namespaces and well-formedness.
  const p=spawnSync('python3',['-c',`import sys,json,xml.etree.ElementTree as E
r=E.fromstring(sys.stdin.buffer.read()); n={'w':'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}
print(json.dumps([[[ ''.join(t.itertext()) for t in c.findall('.//w:t',n)] for c in row.findall('w:tc',n)] for row in r.find('.//w:tbl',n).findall('w:tr',n)]))`],{input:xml,encoding:'utf8'});
  assert.equal(p.status,0,p.stderr);return JSON.parse(p.stdout).map(row=>row.map(r=>r.join('')));
}
async function generate(amount){
  const inputs={name:'合成测试员',dept:'合成部门',reason:'合成测试',detail:'合成服务 & 核对 <内容>',amount};
  const elements=new Map(),downloads=[];let currentBlob;
  const get=id=>{if(!elements.has(id))elements.set(id,{value:inputs[id]||'',classList:{add(){},remove(){}},style:{}});return elements.get(id);};
  const document={getElementById:get,querySelector:()=>({value:'晚餐'}),createElement:()=>({style:{},click(){downloads.push({name:this.download,blob:currentBlob});}}),body:{appendChild(){},removeChild(){}}};
  const ctx={document,JSZip,InvoiceOCR,Blob,Uint8Array,ArrayBuffer,atob,console,URL:{createObjectURL(blob){currentBlob=blob;return 'blob:synthetic';},revokeObjectURL(){}},setTimeout:fn=>{fn();return 0;}};
  vm.createContext(ctx);vm.runInContext(script,ctx);get('date').value='2026-10-17';
  await ctx.gen();assert.equal(get('errEl').textContent,undefined);
  assert.equal(downloads.length,4);
  return Promise.all(downloads.map(async d=>({name:d.name,bytes:Buffer.from(await d.blob.arrayBuffer())})));
}
const cases=[['106.00','10600','壹佰零陆元整'],['0.00','000','零元整'],['1.005','101','壹元零壹分'],['9.999','1000','壹拾元整'],['9999.995','1000000','壹万元整'],['0.01','001','零元零壹分'],['10001.10','1000110','壹万零壹元壹角']];
for(const [input,cents,uppercase] of cases)test('实际四份 DOCX 导出及独立 XML 回读：'+input,async()=>{
  const docs=await generate(input);assert.deepEqual(docs.map(d=>d.name),templates.map(t=>t.name));
  for(let i=0;i<docs.length;i++){
    const actual=unzip(docs[i].bytes),original=unzip(templates[i].bytes),xml=actual.get('word/document.xml');
    assert.ok(actual.has('[Content_Types].xml'));assert.ok(actual.has('_rels/.rels'));
    for(const [name,data] of original)if(name!=='word/document.xml')assert.deepEqual(actual.get(name),data,name);
    const rows=xmlCells(xml);assert.doesNotMatch(xml.toString(),/\{\{[A-Z_]+\}\}/);
    if(i===1||i===2){
      const total=i===1?11:7;const expected=cents.padStart(7,' ').split('').map(s=>s.trim());
      assert.deepEqual(rows[3].slice(2),expected,'明细实际金额格');
      assert.deepEqual(rows[total].slice(3),expected,'合计实际数字格');assert.equal(rows[total][1],uppercase,'实际大写格');
      assert.equal(rows[3][1],'合成服务 & 核对 <内容>');
      for(let r=4;r<total;r++)assert.ok(rows[r].every(cell=>cell===''),'未使用明细行 '+r+' 残留样例');
      // Fixed table and cell properties must remain byte-identical.
      for(const pattern of [/<w:tblPr[ >][\s\S]*?<\/w:tblPr>/g,/<w:tblGrid[ >][\s\S]*?<\/w:tblGrid>/g,/<w:trPr[ >][\s\S]*?<\/w:trPr>/g,/<w:tcPr[ >][\s\S]*?<\/w:tcPr>/g])assert.deepEqual(xml.toString().match(pattern),original.get('word/document.xml').toString().match(pattern));
    }else assert.match(xml.toString(),i===0?/合成测试员/:/商务接待/);
    if(input==='106.00'){
      fs.mkdirSync(path.join(__dirname,'output'),{recursive:true});fs.writeFileSync(path.join(__dirname,'output',docs[i].name),docs[i].bytes);
    }
  }
});
test('测试使用生产所载同一 JSZip 版本，四份内嵌模板 ZIP 与基线一致',()=>{
  assert.match(html,/https:\/\/cdn\.jsdelivr\.net\/npm\/jszip@3\.10\.1\/dist\/jszip\.min\.js/);
  assert.equal(JSZip.version,'3.10.1');assert.equal(templates.length,4);
  const hashes=JSON.parse(fs.readFileSync(path.join(__dirname,'baseline-template-sha256.json'),'utf8'));
  assert.deepEqual(templates.map(t=>crypto.createHash('sha256').update(t.bytes).digest('hex')),hashes);
});
