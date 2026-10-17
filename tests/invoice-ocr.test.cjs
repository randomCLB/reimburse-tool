const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
require('../invoice-ocr.js');
const {parseInvoice,money,uppercaseMoney,validDate}=globalThis.InvoiceOCR;

test('价税合计优先于税额及未税金额，不混淆买卖方、票号与税号',()=>{
  const result=parseInvoice('发票号码：12345678\n开票日期：2026年10月17日\n购买方信息\n名称：合成购买公司\n纳税人识别号：911111111111111111\n销售方信息\n名称：合成销售公司\n纳税人识别号：922222222222222222\n项目名称：测试服务\n金额：100.00 税额：6.00\n价税合计（大写）壹佰零陆元整（小写）￥106.00');
  assert.deepEqual({...result,warnings:[]},{date:'2026-10-17',number:'12345678',seller:'合成销售公司',amount:'106.00',content:'测试服务',warnings:[]});
});
test('没有价税合计时留空，不能用税额、未税金额或大写猜测',()=>{
  for(const text of ['税额 6.00\n金额 100.00','价税合计（大写）壹佰元整','']){
    const r=parseInvoice(text);assert.equal(r.amount,'');assert.ok(r.warnings.length);
  }
});
test('合法千分位、跨行小写与零元',()=>{
  assert.equal(parseInvoice('价税合计（大写）合成\n（小写）￥1,234.56').amount,'1234.56');
  assert.equal(parseInvoice('价税合计 ¥0.00').amount,'0.00');
  assert.equal(parseInvoice('价 税 合 计：￥１０６．００').amount,'106.00');
});
test('歧义、不完整数字、负数、多个总额及错误千分位不猜测',()=>{
  for(const text of ['价税合计 106.00 107.00','价税合计 106.00 价税合计 107.00','价税合计 106.00\n价税合计 106.00','价税合计 1,23.45','价税合计 1.2.3','价税合计 -106.00','价税合计 106.001','价税合计\n发票号码 12345678','价税合计 100000.00','价税合计 ¥10O','价税合计 10?','价税合计 6%'])assert.equal(parseInvoice(text).amount,'',text);
});
test('日期真实存在且仅从开票日期提取',()=>{
  for(const d of ['2026-02-29','2026-13-01','2026-04-31','2026-00-10','2026-01-123'])assert.equal(parseInvoice('开票日期：'+d).date,'');
  assert.equal(validDate('2024-02-29'),'2024-02-29');
  assert.equal(parseInvoice('申请日期 2026-10-17').date,'');
});
test('没有明确销售方和发票号码时不得用购买方或税号替代',()=>{
  const r=parseInvoice('购买方 名称：合成买方\n纳税人识别号：123456789012345678\n发票代码：123456789012');
  assert.equal(r.seller,'');assert.equal(r.number,'');
  assert.equal(parseInvoice('销售方\n名称：合成卖方\n购买方\n名称：合成买方').seller,'合成卖方');
  assert.equal(parseInvoice('购买方 销售方\n名称：合成买方 名称：合成卖方').seller,'');
});
test('十进制进位与人民币大写',()=>{
  for(const [input,expected,cn] of [['106','106.00','壹佰零陆元整'],['0','0.00','零元整'],['1.005','1.01','壹元零壹分'],['9.999','10.00','壹拾元整'],['9999.995','10000.00','壹万元整'],['10001.10','10001.10','壹万零壹元壹角'],['0.01','0.01','零元零壹分']]){
    assert.equal(money(input).amount,expected);assert.equal(uppercaseMoney(input),cn);
  }
  for(const input of ['', '-1','NaN','1e3','1,23','99999.995'])assert.throws(()=>money(input));
});

// DOM contract tests only: these do not claim a real browser or real OCR run.
function ui(extra={}){
  const elements=new Map();
  const get=id=>{
    if(!elements.has(id))elements.set(id,{value:'',checked:false,disabled:false,style:{},events:{},addEventListener(name,fn){this.events[name]=fn;},removeAttribute(name){delete this[name];}});
    if(id==='invoice-file'&&!elements.get(id).fileInputStub){
      const el=elements.get(id);let value='';el.files=[];el.fileInputStub=true;
      Object.defineProperty(el,'value',{get(){return value;},set(next){value=next;if(next==='')this.files=[];}});
    }
    return elements.get(id);
  };
  const browser={document:{readyState:'complete',getElementById:get},confirm:()=>true,setTimeout,clearTimeout,...extra};
  browser.window=browser;
  vm.runInNewContext(fs.readFileSync(require.resolve('../invoice-ocr.js'),'utf8'),browser);
  return {get,browser,click:id=>get(id).events.click()};
}
test('提取不自动填费；需人工勾选；取消覆盖保留原值与申请日期',()=>{
  const {get,browser,click}=ui();
  get('amount').value='88.00';get('detail').value='原说明';get('date').value='2026-01-02';
  get('invoice-raw').value='开票日期 2026-10-17\n价税合计 106.00\n项目名称：合成服务';click('invoice-parse');
  assert.equal(get('amount').value,'88.00');assert.equal(get('detail').value,'原说明');
  click('invoice-apply');assert.equal(get('amount').value,'88.00');
  get('invoice-reviewed').checked=true;browser.confirm=()=>false;click('invoice-apply');
  assert.equal(get('amount').value,'88.00');assert.equal(get('detail').value,'原说明');
  browser.confirm=()=>true;click('invoice-apply');assert.equal(get('amount').value,'106.00');assert.match(get('detail').value,/合成服务/);assert.equal(get('date').value,'2026-01-02');
});
test('空白 OCR 后可手工填入零元；编辑会撤销核对状态',()=>{
  const {get,click}=ui();click('invoice-parse');get('invoice-reviewed').checked=true;click('invoice-apply');assert.equal(get('amount').value,'');
  get('invoice-amount').value='0.00';get('invoice-content').value='合成免费服务';get('invoice-amount').events.input();assert.equal(get('invoice-reviewed').checked,false);
  get('invoice-reviewed').checked=true;click('invoice-apply');assert.equal(get('amount').value,'0.00');
});

test('模拟 worker 加载失败后恢复控件且可以重试，识别完成仍不自动填写',async()=>{
  let attempts=0,terminated=0;
  const {get,browser,click}=ui({URL:{createObjectURL:()=> 'blob:synthetic',revokeObjectURL(){}},Tesseract:{async createWorker(lang,oem,options){
    attempts++;assert.equal(lang,'chi_sim');assert.match(options.workerPath,/@5\.1\.1\//);assert.match(options.langPath,/@1\.0\.0\//);
    if(attempts===1){options.errorHandler('synthetic load failure');return new Promise(()=>{});}
    return {recognize:async()=>({data:{text:'价税合计 106.00\n项目名称：合成服务'}}),terminate:async()=>{terminated++;}};
  }}});
  get('invoice-file').files=[{type:'image/png'}];get('invoice-file').events.change.call(get('invoice-file'));
  get('amount').value='88.00';await click('invoice-run');assert.match(get('invoice-status').textContent,/失败.*synthetic load failure/);assert.equal(get('invoice-run').disabled,false);
  await click('invoice-run');assert.equal(get('invoice-amount').value,'106.00');assert.equal(get('amount').value,'88.00');assert.equal(get('invoice-reviewed').checked,false);assert.equal(terminated,1);
});
test('模拟脚本加载失败后重新插入脚本并恢复手工编辑',async()=>{
  let attempts=0,removed=0;
  const {get,browser,click}=ui({URL:{createObjectURL:()=> 'blob:synthetic',revokeObjectURL(){}}});
  browser.document.createElement=()=>({remove(){removed++;}});
  browser.document.head={appendChild(script){attempts++;queueMicrotask(()=>script.onerror());}};
  get('invoice-file').files=[{type:'image/jpeg'}];get('invoice-file').events.change.call(get('invoice-file'));
  await click('invoice-run');await click('invoice-run');assert.equal(attempts,2);assert.equal(removed,2);assert.match(get('invoice-status').textContent,/脚本加载失败/);assert.equal(get('invoice-apply').disabled,false);
});

// Full, unedited OCR from .bridge/fixtures/browser-first-result.json.
// Evidence: randomCLB/al-loc-workspace, commit 55d60f0,
// results/codex-chatgpt-bridge-macos/handoffs/reimburse-ocr-001-browser-first.json.
// Synthetic PNG SHA256: a0fddc4277eb6d780f53eca3c23c444fa67f679c92ba9255124e16eea3f0ad0c.
const browserFirstRaw="电子 发 票 〈 普 通 发 票 )\n发 票 号 码 : 12345678901234567890\n开票 日 期 : 2026 年 10 月 17 日\n购买 方 名 称 : 测试 采购 公司\n\n纳税 人 识别 号 : TESTBUYER0000000001\n销售 方 名 称 : 示例 餐饮 有 限 公司\n\n纳税 人 识别 号 : TESTSELLER000000001\n项 目 名 称 : 餐饮 服务\n\n金额 : 100.00 ”税额 : 6.00\n\n价 税 合计 (大写 ) : 过 佰 零 陆 元 整\n\n价 税 合计 (小 写 ) : 工 106.00\n\n仅 供 软件 测试 使 用 ， 无 真实 交易\n";
test('完整浏览器 OCR 原文回归：证据哈希及全部五个字段',()=>{
  assert.equal(require('node:crypto').createHash('sha256').update(browserFirstRaw).digest('hex'),'c01d17cbd814cfef1e7d583b7a255c1356864f103669d83ae6b40cd03004372b');
  const r=parseInvoice(browserFirstRaw);
  assert.equal(r.date,'2026-10-17');assert.equal(r.amount,'106.00');
  assert.equal(r.number,'12345678901234567890');assert.equal(r.seller,'示例餐饮有限公司');assert.equal(r.content,'餐饮服务');
});
test('OCR 日期分词与分隔符周围空格，不修补不存在的日期',()=>{
  for(const date of ['2026 年 10 月 17 日','2026 - 10 - 17','2026 / 10 / 17','2026 . 10 . 17'])assert.equal(parseInvoice('开票 日 期 : '+date).date,'2026-10-17');
  for(const date of ['2026 年 02 月 29 日','2026 年 13 月 17 日','2026 年 04 月 31 日','2026 年 10 月 00 日','2026 年 10 月 171 日'])assert.equal(parseInvoice('开票 日 期 : '+date).date,'');
  assert.equal(parseInvoice('开票 日 期 : 2024 年 02 月 29 日').date,'2024-02-29');
});
test('中文大写行不否决唯一小写总额，空行和独立 OCR 噪声可保留',()=>{
  for(const gap of ['\n','\n\n','\n \n\n']){
    for(const lower of ['价 税 合计 (小 写 ) : 工 106.00','价 税 合计 (小 写 ) : X 106.00','(小 写 ) : 工 ￥1,234.56']){
      const text='金额 100.00 税额 6.00\n价 税 合计 (大写 ) : 过 佰 零 陆 元 整'+gap+lower;
      assert.equal(parseInvoice(text).amount,lower.includes('1,234')?'1234.56':'106.00');
    }
  }
});
test('分行总额缺失、负数、损坏或多候选均保留人工判断防线',()=>{
  const upper='价 税 合计 (大写 ) : 过 佰 零 陆 元 整\n\n';
  const invalid=['','价税合计 (小写) : 工','价税合计 (小写) : -106.00','价税合计 (小写) : - 106.00','价税合计 (小写) : −106.00','价税合计 (小写) : 10O.00','价税合计 (小写) : 106.OO','价税合计 (小写) : O106.00','价税合计 (小写) : 工106.00','价税合计 (小写) : 1,06.00','价税合计 (小写) : .106.00','价税合计 (小写) : 106.00 .','价税合计 (小写) : (小写) 106.00','价税合计 (小写) : 106.001','价税合计 (小写) : 1 06.00','价税合计 (小写) : 106.00 107.00','价税合计 (小写) : 106.00\n\n价税合计 (小写) : 107.00','价税合计 (小写) : 106.00\n价税合计 (小写) : 106.00','价税合计 (小写) : 106.00\n价税合计 (小写) :','价税合计 (小写) : 106.00\n价税合计 (小写) : 10O.00'];
  for(const text of invalid){const r=parseInvoice(upper+text+'\n金额 100.00 税额 6.00');assert.equal(r.amount,'',text);assert.ok(r.warnings.some(s=>s.includes('金额已留空')),text);}
});

// Execute the real UI handlers against DOM/File/worker doubles; no image OCR is performed.
function selectSyntheticFile(get,file){
  const input=get('invoice-file');input.value='C:\\fakepath\\'+file.name;input.files=[file];input.events.change.call(input);
}
function assertInvoiceCleared(get){
  assert.equal(get('invoice-file').value,'');assert.equal(get('invoice-file').files.length,0);
  assert.equal(get('invoice-preview').hidden,true);assert.equal(get('invoice-preview').src,undefined);
  for(const id of ['invoice-raw','invoice-date','invoice-number','invoice-seller','invoice-amount','invoice-content'])assert.equal(get(id).value,'',id);
  assert.equal(get('invoice-reviewed').checked,false);assert.equal(Number(get('invoice-progress').value),0);
  assert.equal(get('invoice-run').disabled,true);assert.equal(get('invoice-run').textContent,'开始本地识别');
  assert.match(get('invoice-status').textContent,/请选择/);
}
test('清空当前图片释放 URL，复位发票区，保留所有报销输入且不请求覆盖确认',()=>{
  const revoked=[],created=[];
  const {get,click}=ui({URL:{createObjectURL(file){created.push(file);return 'blob:synthetic-'+created.length;},revokeObjectURL(url){revoked.push(url);}},confirm(){assert.fail('清空不能触发覆盖确认');}});
  const html=fs.readFileSync(require.resolve('../index.html'),'utf8');
  assert.ok(/<button\b[^>]*id="invoice-clear"[^>]*type="button"[^>]*>清空本张发票<\/button>/.test(html),'页面包含非提交类型的清空按钮');
  const businessIds=Array.from(html.matchAll(/<(?:input|textarea)\b[^>]*\bid="([^"]+)"/g),m=>m[1]).filter(id=>!id.startsWith('invoice-'));
  for(const id of businessIds)get(id).value='保留-'+id;
  const image=new File(['synthetic PNG bytes'],'synthetic.png',{type:'image/png'});
  selectSyntheticFile(get,image);assert.equal(get('invoice-preview').src,'blob:synthetic-1');assert.equal(get('invoice-preview').hidden,false);assert.equal(get('invoice-run').disabled,false);
  for(const id of ['invoice-raw','invoice-date','invoice-number','invoice-seller','invoice-amount','invoice-content'])get(id).value='旧识别值';
  get('invoice-reviewed').checked=true;get('invoice-progress').value=100;
  click('invoice-clear');assertInvoiceCleared(get);assert.deepEqual(revoked,['blob:synthetic-1']);
  for(const id of businessIds)assert.equal(get(id).value,'保留-'+id,id);
  click('invoice-clear');assertInvoiceCleared(get);assert.equal(revoked.length,1,'重复清空不重复撤销 URL');
  selectSyntheticFile(get,image);assert.equal(get('invoice-preview').src,'blob:synthetic-2');assert.equal(get('invoice-run').disabled,false);assert.equal(get('invoice-raw').value,'');
  const other=new File(['synthetic WebP bytes'],'another.webp',{type:'image/webp'});
  selectSyntheticFile(get,other);assert.deepEqual(revoked,['blob:synthetic-1','blob:synthetic-2']);assert.equal(get('invoice-preview').src,'blob:synthetic-3');
  click('invoice-clear');assertInvoiceCleared(get);assert.deepEqual(revoked,['blob:synthetic-1','blob:synthetic-2','blob:synthetic-3']);
});
test('加载和识别 busy 时不可清空，完成后保留已确认费用并可重选原 File 重新识别',async(t)=>{
  let finishLoad,startRecognize,finishRecognize,attempts=0;
  const loading=new Promise(resolve=>{finishLoad=resolve;});
  const started=new Promise(resolve=>{startRecognize=resolve;});
  const recognizing=new Promise(resolve=>{finishRecognize=resolve;});
  const seen=[],revoked=[];
  const worker={recognize(file){seen.push(file);startRecognize();return seen.length===1?recognizing:Promise.resolve({data:{text:'价税合计 7.77\n项目名称：第二次合成服务'}});},async terminate(){}};
  const {get,click}=ui({URL:{createObjectURL:()=> 'blob:busy-image',revokeObjectURL:url=>revoked.push(url)},Tesseract:{createWorker(){attempts++;return attempts===1?loading:Promise.resolve(worker);}}});
  const image=new File(['synthetic PNG bytes'],'same.png',{type:'image/png'});
  selectSyntheticFile(get,image);const run=click('invoice-run');
  t.after(async()=>{finishLoad(worker);finishRecognize({data:{text:''}});await run;});
  assert.equal(get('invoice-clear').disabled,true,'加载阶段禁用');click('invoice-clear');assert.equal(get('invoice-preview').hidden,false);assert.equal(revoked.length,0);
  finishLoad(worker);await started;
  assert.equal(get('invoice-clear').disabled,true,'识别阶段禁用');click('invoice-clear');assert.equal(get('invoice-file').files[0],image);
  finishRecognize({data:{text:'价税合计 106.00\n项目名称：第一次合成服务'}});await run;
  assert.equal(get('invoice-clear').disabled,false);assert.equal(get('invoice-amount').value,'106.00');
  get('invoice-reviewed').checked=true;click('invoice-apply');const detail=get('detail').value;assert.equal(get('amount').value,'106.00');
  click('invoice-clear');assertInvoiceCleared(get);assert.equal(get('amount').value,'106.00');assert.equal(get('detail').value,detail);
  await click('invoice-run');assert.equal(seen.length,1,'清空后即使直接调用也不能识别旧文件');
  selectSyntheticFile(get,image);assert.equal(get('invoice-raw').value,'');await click('invoice-run');
  assert.deepEqual(seen,[image,image]);assert.equal(get('invoice-amount').value,'7.77');assert.doesNotMatch(get('invoice-raw').value,/第一次/);
  assert.equal(get('amount').value,'106.00');assert.equal(get('detail').value,detail);assert.equal(get('invoice-clear').disabled,false);
});
test('识别失败后恢复清空能力，清空错误后重新选图可重试',async()=>{
  let attempts=0;const revoked=[];
  const {get,click}=ui({URL:{createObjectURL:()=> 'blob:retry-image',revokeObjectURL:url=>revoked.push(url)},Tesseract:{async createWorker(){
    return {async recognize(){if(++attempts===1)throw Error('synthetic recognition failure');return {data:{text:'价税合计 0.00\n项目名称：合成免费服务'}};},async terminate(){}};
  }}});
  const image=new File(['synthetic JPEG bytes'],'retry.jpeg',{type:'image/jpeg'});
  selectSyntheticFile(get,image);await click('invoice-run');assert.match(get('invoice-status').textContent,/识别失败/);assert.equal(get('invoice-clear').disabled,false);
  click('invoice-clear');assertInvoiceCleared(get);assert.deepEqual(revoked,['blob:retry-image']);
  selectSyntheticFile(get,image);await click('invoice-run');assert.equal(get('invoice-amount').value,'0.00');assert.equal(get('invoice-clear').disabled,false);
  click('invoice-clear');assertInvoiceCleared(get);
});
