# 报销材料生成器

保留原有中文表单与四份 DOCX 导出；新增单张发票图片的浏览器本地 OCR 和人工核对入口。

## 使用

1. 使用支持 WebAssembly、Web Worker、BigInt 的现代浏览器打开 `index.html`，保持 `invoice-ocr.js` 与它同目录。部分浏览器会限制本地文件启动 Worker；这种情况下可使用已有的静态站点环境，本项目不包含服务端。
2. 填写通用信息、差旅信息等。申请日期是独立字段。
3. 在“发票图片识别”选择一张 JPEG、PNG 或 WebP，查看本地预览，再点击“开始本地识别”。不支持 PDF、多图或批量识别。
4. 对照原图检查 OCR 原文及开票日期、发票号码、销售方、价税合计、商品/服务内容。可直接修改提取字段，也可修订原文后重新提取（会替换核对区内容并撤销勾选）。
5. 识别或提取不会自动改动费用表单。金额缺失、多个候选、非法千分位、不完整数字等情况会留空；必须自行核对填写。只从明确的“价税合计”读金额，不用税额或未税金额代替，不根据大写金额猜数值。发票布局复杂、买卖方并列或标签缺失时可直接人工填写。
6. 勾选“我已对照原图核对金额与各项内容”，点击“确认并填写费用信息”。须有有效金额和商品/服务内容；金额为零是有效值。已有金额或说明时会再次询问是否覆盖，取消则两个原字段均保留。开票日期只进入费用说明，申请日期始终保持原值。
7. 点击“生成 4 份报销文档”，允许浏览器的多文件下载，用 Word 检查文件。请对最终内容负责，OCR 不是票据真实性或报销合规性的验证。

两份费用报销单均按单张发票写一条明细，清空其他明细行；明细和合计数字直接写入原有表格的“万、千、百、十、元、角、分”单元格，另写正确人民币大写合计。未使用不存在的 `{{AMOUNT}}` 占位符。原模板 ZIP、表格结构和样式不变，另外两份文档保留原导出行为及模板内容，含其原有固定文字。本轮不修改其样例/固定字段。

金额接受 `1234.56` 或合法千分位 `1,234.56`。手工输入超过两位小数时按十进制四舍五入到分（例如 `1.005 → 1.01`，`9.999 → 10.00`），不用浮点乘法计算金额。模板最高只有“万”位，因此仅支持 0 至 99,999.99 元，负数、空金额或进位后超限会报错，不会截断或当作零元导出。

## 本地处理、资源版本与限制

- Tesseract.js **5.1.1**：`https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js`
- Worker **5.1.1**：`https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/worker.min.js`
- Tesseract.js-core **5.1.1**：`https://cdn.jsdelivr.net/npm/tesseract.js-core@5.1.1`。由引擎按 SIMD 能力选择 LSTM 核心及 WASM。
- 简体中文语言包 **@tesseract.js-data/chi_sim 1.0.0**：`https://cdn.jsdelivr.net/npm/@tesseract.js-data/chi_sim@1.0.0/4.0.0_best_int/chi_sim.traineddata.gz`。
- 原有 DOCX 依赖 JSZip **3.10.1** 改为浏览器 UMD 构建：`https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js`。

Tesseract 脚本、Worker、核心和语言包仅在点击识别后加载；没有 `latest`、范围版本或浮动资源地址。2026-10-17 实际下载上述 OCR 资源及 SIMD/非 SIMD 核心分支均返回 HTTP 200，大小和 SHA-256 见 `tests/resource-check.json`。[Tesseract.js 5.1.1 官方 API](https://github.com/naptha/tesseract.js/blob/v5.1.1/docs/api.md)说明了本地 Worker、资源路径及进度回调。

图片以本地 Blob URL 预览，File 对象交给浏览器中的 Tesseract Worker。此应用没有上传图片、像素或 OCR 文本的请求，没有云端 OCR、API key、业务后端、遥测或持久保存发票的逻辑。CDN 会收到正常资源下载请求和网络元数据；加载第三方代码仍依赖 CDN/依赖供应链。语言包可能由 Tesseract 缓存在浏览器 IndexedDB，发票图片和 OCR 结果由本页面保持在内存中，刷新后不保留。

首次使用需联网下载依赖。之后是否离线可用取决于浏览器资源和语言缓存，不保证离线启动；本项目不包含离线安装包或 Service Worker。JSZip 在页面载入时下载；未加载时导出会提示检查网络并刷新重试。

识别显示当前阶段及百分比，阶段切换时百分比会重置。脚本加载 45 秒、Worker 加载和识别合计 180 秒后提示超时。加载、识别、图片解码失败或空白文本都有可见提示；可重新选择图片、点击重试，或者手工核对填写。重试清空旧识别结果，不覆盖费用表单。极端情况下第三方 Worker 初始化失败可能需要刷新页面释放残余 Worker；刷新前请保留手工内容。

## 检查与验证范围

需要 Node.js 22.12+（本次为 22.22.3）和 Python 3 标准库（独立解析 DOCX XML）。无 npm install、新框架或新运行依赖。`tests/vendor/jszip-3.10.1.min.cjs` 是原生产依赖的同版本 UMD 副本，保留原版权/许可证头，仅用于可离线复现导出测试。

```sh
node --test tests/invoice-ocr.test.cjs tests/export.test.cjs
node --check invoice-ocr.js
```

`invoice-ocr.js` 暴露 `globalThis.InvoiceOCR`，包含 `parseInvoice`、`money`、`uppercaseMoney` 和 `validDate`。CommonJS 环境也提供 `module.exports`。此工程的父目录声明了 `type: module`，原生 Node 测试通过 `require('../invoice-ocr.js')` 执行后读取 `globalThis.InvoiceOCR`，不修改父目录配置。

测试仅用合成文本和合成表单输入。导出测试执行 `index.html` 的真实 `gen()` → `downloadDocx()`，捕获真实 Blob/ZIP；用 Node zlib 独立解压、Python ElementTree 独立解析实际 `word/document.xml`，检查两份费用表的数字格、大写格、未使用行及样式属性，并检查四份文档其余 ZIP 成员。测试会生成四个 106.00 元示例到 `tests/output/`，供独立复核。`tests/baseline-template-sha256.json` 记录从基线 `28ebdda` 提取的四份模板 ZIP 哈希。

自动化中的 UI 和 Worker 测试是模拟环境，不能单独证明真实图片 OCR 通过。2026-10-17 另在本机 HTTP 预览中实际上传合成 PNG，核对日期、票号、销售方和 106.00 元总额，验证未勾选核对时不回填、确认后回填且申请日期不变，并实际下载四份 DOCX、独立解包核对两份费用表的金额与说明。首次图片检查发现日期空格和大小写总额分行的问题，已用原始 OCR 原文加入回归并修复，最终 23 项测试通过。原生覆盖确认框的取消/确定按钮未由浏览器自动化可靠控制（对应逻辑有单元测试），Word 视觉排版及其他复杂真实票据仍为未验收项。逐版本原文交接和独立证据保存在 Bridge 仓库，本项目 PR 记录交付版本；不要把单张合成图结果推广为所有票据准确率。
