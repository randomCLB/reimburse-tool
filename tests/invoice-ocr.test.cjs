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
    if(!elements.has(id))elements.set(id,{value:'',checked:false,disabled:false,style:{},events:{},addEventListener(name,fn){this.events[name]=fn;},removeAttribute(){}});
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
