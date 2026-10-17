(function(root){
  'use strict';
  // Decimal arithmetic avoids binary floating-point errors such as 1.005 -> 1.00.
  function money(value){
    var s=String(value==null?'':value).normalize('NFKC').trim().replace(/^[¥￥]\s*/,'');
    if(!/^(?:\d+|[1-9]\d{0,2}(?:,\d{3})+)(?:\.\d+)?$/.test(s)) throw Error('请输入有效的非负金额，千分位须为三位一组');
    var parts=s.replace(/,/g,'').split('.'), fraction=parts[1]||'';
    var cents=BigInt(parts[0])*100n+BigInt((fraction+'00').slice(0,2));
    if(fraction.length>2&&fraction[2]>='5') cents+=1n;
    if(cents>9999999n) throw Error('现有报销模板最多支持 99,999.99 元');
    return {cents:Number(cents),amount:String(cents/100n)+'.'+String(cents%100n).padStart(2,'0')};
  }
  function uppercaseMoney(value){
    var cents=money(value).cents, integer=Math.floor(cents/100), cn='零壹贰叁肆伍陆柒捌玖', units=['','拾','佰','仟','万'];
    var text='',zero=false;
    for(var p=4;p>=0;p--){
      var digit=Math.floor(integer/Math.pow(10,p))%10;
      if(digit){if(zero)text+='零';text+=cn[digit]+units[p];zero=false;}
      else if(text)zero=true;
    }
    text=(text||'零')+'元';
    var jiao=Math.floor(cents%100/10),fen=cents%10;
    if(!jiao&&!fen)return text+'整';
    if(jiao)text+=cn[jiao]+'角';
    if(fen)text+=(jiao?'':'零')+cn[fen]+'分';
    return text;
  }
  function validDate(s){
    var m=String(s).match(/^(\d{4})[-年/.](\d{1,2})[-月/.](\d{1,2})日?$/);
    if(!m)return '';
    var y=+m[1],mo=+m[2],day=+m[3],d=new Date(Date.UTC(y,mo-1,day));
    return y>=1900&&d.getUTCFullYear()===y&&d.getUTCMonth()===mo-1&&d.getUTCDate()===day ? m[1]+'-'+m[2].padStart(2,'0')+'-'+m[3].padStart(2,'0') : '';
  }
  function parseInvoice(raw){
    var text=String(raw||'').normalize('NFKC').replace(/\r/g,'').replace(/([\u3400-\u9fff])[^\S\n]+(?=[\u3400-\u9fff])/g,'$1');
    var result={date:'',number:'',seller:'',amount:'',content:'',warnings:[]};
    if(!text.trim()){result.warnings.push('OCR 文本为空，请重试或手工填写并核对原图');return result;}
    var dates=Array.from(text.matchAll(/开票日期\s*[:：]?\s*(\d{4}[-年/.]\d{1,2}[-月/.]\d{1,2}日?)(?!\d)/g),m=>validDate(m[1]));
    if(dates.length===1)result.date=dates[0];
    if(dates.length&&!result.date)result.warnings.push('开票日期无效或不唯一，请人工核对');
    var numbers=Array.from(text.matchAll(/发票(?:号码|号)\s*[:：]?\s*(\d{8,20})(?!\d)/g),m=>m[1]);
    if(numbers.length===1)result.number=numbers[0];
    // Only read the explicitly labelled seller block; never fall back to the first 名称.
    var sellers=Array.from(text.matchAll(/销售方(?:信息)?\s*[:：]?\s*([\s\S]*?)(?=购买方|销售方|价税合计|货物|项目名称|商品|服务名称|$)/g),m=>m[1]);
    if(sellers.length===1){
      var seller=sellers[0].match(/^(?:名称\s*[:：]?\s*)?([^\n:：]+?)(?=\s*(?:纳税人|统一社会|税号|地址|电话|开户|银行)|\n|$)/);
      if(seller&&!/^(纳税人|统一社会|税号|地址|电话|开户|银行)/.test(seller[1]))result.seller=seller[1].trim();
    }
    var candidates=[],invalid=false;
    var lines=text.split('\n');
    lines.forEach(function(line,i){
      if(!/价税合计/.test(line))return;
      if(line.split('价税合计').length!==2)invalid=true;
      var region=line.split('价税合计')[1];
      for(var n=1;n<=2&&i+n<lines.length;n++){
        if(/^\s*(?:\(?小写\)?\s*[:：]?|[¥￥])/.test(lines[i+n]))region+=' '+lines[i+n];else break;
      }
      region=region.split(/税额|税率|开票日期|发票号码|销售方|购买方/)[0];
      if(/小写/.test(region))region=region.split('小写').slice(1).join('小写');
      if(/[A-Za-z?？%％]/.test(region))invalid=true;
      var tokens=region.match(/[-+]?\d[\d,.]*/g)||[];
      if(!tokens.length)invalid=true;
      tokens.forEach(function(token){
        if(!/^(?:\d+|[1-9]\d{0,2}(?:,\d{3})+)(?:\.\d{1,2})?$/.test(token)){invalid=true;return;}
        try{candidates.push(money(token).amount);}catch(e){invalid=true;}
      });
    });
    if(!invalid&&candidates.length===1)result.amount=candidates[0];
    else result.warnings.push('价税合计缺失或存在歧义，金额已留空，请对照原图人工判断');
    var content=text.match(/(?:项目名称|商品(?:名称|\/服务内容)|货物或应税劳务、?服务名称|服务名称)\s*[:：]?\s*([^\n]+)/);
    if(content&&!/规格型号|单价|税率|数量/.test(content[1]))result.content=content[1].trim();
    if(!result.content){var item=lines.find(line=>/^\s*\*[^*]+\*[^\s]+/.test(line));if(item)result.content=item.trim().split(/\s{2,}|\t/)[0];}
    if(!result.seller)result.warnings.push('销售方未明确识别，请人工填写');
    return result;
  }
  var api={parseInvoice:parseInvoice,money:money,uppercaseMoney:uppercaseMoney,validDate:validDate};
  if(typeof module==='object'&&module.exports)module.exports=api;
  root.InvoiceOCR=api;
  if(typeof document==='undefined')return;

  function init(){
    var $=id=>document.getElementById(id);
    if(!$('invoice-file'))return;
    var file=null,previewURL='',scriptPromise=null,busy=false;
    var fieldIds=['invoice-date','invoice-number','invoice-seller','invoice-amount','invoice-content'];
    function status(message,error){$('invoice-status').textContent=message;$('invoice-status').style.color=error?'#c62828':'#666';}
    function reset(){fieldIds.forEach(id=>$(id).value='');$('invoice-raw').value='';$('invoice-reviewed').checked=false;}
    function loadScript(){
      if(root.Tesseract)return Promise.resolve();
      if(scriptPromise)return scriptPromise;
      scriptPromise=new Promise(function(resolve,reject){
        var script=document.createElement('script'),timer;
        function fail(){clearTimeout(timer);script.remove();scriptPromise=null;reject(Error('OCR 脚本加载失败，请检查网络后重试'));}
        script.src='https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
        script.onload=function(){clearTimeout(timer);if(root.Tesseract)resolve();else fail();};
        script.onerror=fail;timer=setTimeout(fail,45000);document.head.appendChild(script);
      });
      return scriptPromise;
    }
    $('invoice-file').addEventListener('change',function(){
      if(previewURL)URL.revokeObjectURL(previewURL);
      previewURL='';file=null;reset();$('invoice-preview').hidden=true;$('invoice-preview').removeAttribute('src');$('invoice-run').disabled=true;
      var files=this.files;
      if(!files.length){status('请选择单张发票图片，或直接手工核对填写');return;}
      if(files.length!==1||!['image/jpeg','image/png','image/webp'].includes(files[0].type)){status('只支持单张 JPEG、PNG 或 WebP 图片',true);return;}
      file=files[0];previewURL=URL.createObjectURL(file);$('invoice-preview').src=previewURL;$('invoice-preview').hidden=false;
      $('invoice-run').disabled=false;status('图片仅在本机预览。点击开始本地识别。');
    });
    $('invoice-preview').addEventListener('error',function(){file=null;$('invoice-run').disabled=true;status('图片无法解码，请重新选择有效图片；也可手工填写',true);});
    function extract(){
      var parsed=parseInvoice($('invoice-raw').value);
      ['date','number','seller','amount','content'].forEach((key,i)=>$(fieldIds[i]).value=parsed[key]);
      $('invoice-reviewed').checked=false;
      status(parsed.warnings.length?parsed.warnings.join('；'):'已提取，请逐项对照原图核对后确认填写',parsed.warnings.length>0);
    }
    $('invoice-parse').addEventListener('click',extract);
    $('invoice-run').addEventListener('click',async function(){
      if(!file||busy)return;
      busy=true;reset();$('invoice-progress').value=0;
      ['invoice-file','invoice-run','invoice-parse','invoice-apply','invoice-raw','invoice-reviewed'].concat(fieldIds).forEach(id=>$(id).disabled=true);
      var worker=null,timer,finished=false;
      status('加载本地 OCR 引擎和中文语言包，首次使用需要联网…');
      try{
        await loadScript();
        var rejectWorker;
        var failure=new Promise((resolve,reject)=>{rejectWorker=reject;timer=setTimeout(()=>reject(Error('OCR 加载或识别超时，请重试')),180000);});
        var creation=root.Tesseract.createWorker('chi_sim',1,{
          workerPath:'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/worker.min.js',
          corePath:'https://cdn.jsdelivr.net/npm/tesseract.js-core@5.1.1',
          langPath:'https://cdn.jsdelivr.net/npm/@tesseract.js-data/chi_sim@1.0.0/4.0.0_best_int',
          cachePath:'reimburse-chi_sim-1.0.0',
          logger:function(m){
            if(finished)return;
            var labels={'loading tesseract core':'加载 OCR 核心','initializing tesseract':'初始化 OCR','loading language traineddata':'加载中文语言包','initializing api':'初始化识别引擎','recognizing text':'识别文字'};
            var percent=Math.round((m.progress||0)*100);$('invoice-progress').value=percent;
            status((labels[m.status]||'加载本地 OCR')+' '+percent+'%');
          },
          errorHandler:function(error){rejectWorker(Error(String(error)));}
        });
        creation.then(function(w){if(finished)w.terminate();},function(){});
        worker=await Promise.race([creation,failure]);
        var result=await Promise.race([worker.recognize(file),failure]);
        $('invoice-raw').value=result.data.text||'';extract();$('invoice-progress').value=100;
      }catch(e){status('本地识别失败：'+(e.message||String(e))+'。可点击重试或手工填写核对结果。',true);}
      finally{
        finished=true;clearTimeout(timer);if(worker)await worker.terminate();busy=false;
        ['invoice-file','invoice-run','invoice-parse','invoice-apply','invoice-raw','invoice-reviewed'].concat(fieldIds).forEach(id=>$(id).disabled=false);
        $('invoice-run').textContent='重试本地识别';
      }
    });
    fieldIds.concat(['invoice-raw']).forEach(id=>$(id).addEventListener('input',()=>{$('invoice-reviewed').checked=false;}));
    $('invoice-apply').addEventListener('click',function(){
      if(busy)return;
      try{
        var amount=money($('invoice-amount').value).amount;
        var content=$('invoice-content').value.trim(),date=$('invoice-date').value.trim();
        if(date&&!validDate(date))throw Error('开票日期无效，请修正或留空');
        if(!content)throw Error('请填写并核对商品/服务内容');
        if(!$('invoice-reviewed').checked)throw Error('请先勾选已对照原图核对金额和各项内容');
        var detail=[date,$('invoice-seller').value.trim(),content,$('invoice-number').value.trim()?'发票号：'+$('invoice-number').value.trim():''].filter(Boolean).join('；');
        if(($('amount').value.trim()||$('detail').value.trim())&&!root.confirm('费用金额或说明已有内容。确认用本次核对结果覆盖这两个字段？取消将保留原值。'))return;
        $('amount').value=amount;$('detail').value=detail;
        status('已按人工确认结果填写费用金额和说明，申请日期保持原值。');
      }catch(e){status(e.message,true);}
    });
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})(typeof window==='object'?window:globalThis);
