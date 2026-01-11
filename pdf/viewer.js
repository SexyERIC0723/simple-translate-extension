// PDF 查看器核心脚本
// =====================

// 配置 PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('lib/pdf.worker.min.js');

// 全局变量
let pdfDoc = null;
let currentPage = 1;
let totalPages = 0;
let scale = 1.0;
let pdfUrl = '';
let pageTextContents = {}; // 缓存每页的文本内容
let pageBlocks = {}; // 缓存每页的段落块
let pageTranslations = {}; // 缓存每页的翻译结果
let displayMode = 'sidebar'; // 'sidebar' | 'overlay' | 'hover'
let currentHighlightIndex = -1; // 当前高亮的段落索引

// 保护片段的正则（精简版：只保护必要内容）
const PROTECTED_PATTERNS = [
  // URLs
  /https?:\/\/[^\s]+/g,
  // 邮箱
  /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
  // 带单位的科学记号：PM2.5, CO2, H2O, mg/m³ 等
  /\b[A-Z]{1,3}\d+\.?\d*\b/g,
  /\d+\.?\d*\s*(?:mg|μg|kg|g|ml|L|m³|cm|mm|μm|nm|Hz|kHz|MHz|GHz)(?:\/[a-zA-Z³²]+)?/gi,
  // 问卷/量表名：PHQ-9, GAD-7, SF-36, MDD 等
  /\b[A-Z]{2,5}[-–]?\d+\b/g,
  // 引用编号：[1], [2,3], (1), (2-5)
  /[\[(]\d+(?:\s*[-–,]\s*\d+)*[\])]/g,
];

// 统计学常用缩写词（翻译时保持原样）
const STAT_ABBREVIATIONS = [
  'OR', 'CI', 'SE', 'SD', 'AME', 'ATE', 'HR', 'RR', 'IRR', 'NNT', 'NNH',
  'AOR', 'aOR', 'RD', 'ARR', 'RRR', 'LR', 'PPV', 'NPV', 'AUC', 'ROC',
  'ANOVA', 'ANCOVA', 'MANOVA', 'OLS', 'GLS', 'GMM', 'IV', '2SLS', 'DID',
  'FE', 'RE', 'HC', 'HAC', 'VIF', 'DW', 'BIC', 'AIC', 'RMSE', 'MAE',
  'vs', 'et al', 'i.e.', 'e.g.', 'cf.', 'etc.'
];

// 标准化文本中的特殊字符（en-dash 转 hyphen 等）
function normalizeText(text) {
  return text
    .replace(/–/g, '-')  // en-dash → hyphen
    .replace(/—/g, '-')  // em-dash → hyphen
    .replace(/'/g, "'")  // 智能引号 → 普通引号
    .replace(/'/g, "'")
    .replace(/"/g, '"')
    .replace(/"/g, '"')
    .replace(/\s+/g, ' ') // 多空格合并
    .trim();
}

// DOM 元素
const elements = {
  canvas: document.getElementById('pdfCanvas'),
  textLayer: document.getElementById('textLayer'),
  translationLayer: document.getElementById('translationLayer'),
  pageWrapper: document.getElementById('pageWrapper'),
  pdfContainer: document.getElementById('pdfContainer'),
  loadingOverlay: document.getElementById('loadingOverlay'),
  loadingText: document.getElementById('loadingText'),
  toast: document.getElementById('toast'),
  filename: document.getElementById('filename'),
  pageInput: document.getElementById('pageInput'),
  totalPages: document.getElementById('totalPages'),
  zoomLevel: document.getElementById('zoomLevel'),
  panelContent: document.getElementById('panelContent'),
  sidePanel: document.getElementById('sidePanel'),
  downloadLink: document.getElementById('downloadLink')
};

const ctx = elements.canvas.getContext('2d');

// =====================
// 工具函数
// =====================

function showLoading(text = '加载中...') {
  elements.loadingText.textContent = text;
  elements.loadingOverlay.classList.remove('hidden');
}

function hideLoading() {
  elements.loadingOverlay.classList.add('hidden');
}

function showToast(message, duration = 3000) {
  elements.toast.textContent = message;
  elements.toast.classList.add('show');
  setTimeout(() => {
    elements.toast.classList.remove('show');
  }, duration);
}

// =====================
// PDF 加载和渲染
// =====================

async function loadPDF(url) {
  showLoading('正在加载 PDF...');
  pdfUrl = url;

  try {
    pdfDoc = await pdfjsLib.getDocument(url).promise;
    totalPages = pdfDoc.numPages;

    elements.totalPages.textContent = totalPages;
    elements.filename.textContent = decodeURIComponent(url.split('/').pop());
    elements.downloadLink.href = url;

    await renderPage(1);
    hideLoading();
  } catch (error) {
    hideLoading();
    showToast('PDF 加载失败: ' + error.message);
    console.error('PDF load error:', error);
  }
}

async function renderPage(pageNum) {
  if (!pdfDoc || pageNum < 1 || pageNum > totalPages) return;

  currentPage = pageNum;
  elements.pageInput.value = pageNum;

  const page = await pdfDoc.getPage(pageNum);
  const viewport = page.getViewport({ scale });

  // 设置 canvas 尺寸
  elements.canvas.width = viewport.width;
  elements.canvas.height = viewport.height;
  elements.pageWrapper.style.width = viewport.width + 'px';
  elements.pageWrapper.style.height = viewport.height + 'px';

  // 渲染 PDF 页面
  await page.render({
    canvasContext: ctx,
    viewport: viewport
  }).promise;

  // 提取并渲染文本层
  await renderTextLayer(page, viewport);

  // 如果有缓存的翻译，显示翻译
  if (pageTranslations[pageNum]) {
    renderTranslationOverlay(pageTranslations[pageNum], viewport);
    updateSidePanel(pageTranslations[pageNum]);
  } else {
    elements.translationLayer.innerHTML = '';
  }
}

async function renderTextLayer(page, viewport) {
  const textContent = await page.getTextContent();
  pageTextContents[currentPage] = textContent;

  elements.textLayer.innerHTML = '';
  elements.textLayer.style.width = viewport.width + 'px';
  elements.textLayer.style.height = viewport.height + 'px';

  for (const item of textContent.items) {
    const span = document.createElement('span');
    const tx = pdfjsLib.Util.transform(
      viewport.transform,
      item.transform
    );

    span.textContent = item.str;
    span.style.left = tx[4] + 'px';
    span.style.top = (viewport.height - tx[5]) + 'px';
    span.style.fontSize = Math.abs(tx[0]) + 'px';
    span.style.fontFamily = item.fontName || 'sans-serif';

    elements.textLayer.appendChild(span);
  }
}

function renderTranslationOverlay(translations, viewport) {
  elements.translationLayer.innerHTML = '';

  // 侧边栏模式：不在 PDF 上覆盖，只更新侧边栏
  if (displayMode === 'sidebar') {
    return;
  }

  // hover 模式：不预渲染，等用户悬停
  if (displayMode === 'hover') {
    renderHoverTargets(translations, viewport);
    return;
  }

  // overlay 模式：在 PDF 上显示翻译块
  translations.forEach((block, index) => {
    if (block.skipped) return;

    // 计算位置（PDF 坐标转换为屏幕坐标）
    const x = block.bbox.x * scale;
    const y = viewport.height - (block.bbox.y + block.bbox.height) * scale;
    const width = block.bbox.width * scale;
    const height = block.bbox.height * scale;

    // 创建遮罩层（完全覆盖原文）
    const mask = document.createElement('div');
    mask.className = 'translation-mask';
    mask.style.left = x + 'px';
    mask.style.top = y + 'px';
    mask.style.width = width + 'px';
    mask.style.height = height + 'px';
    elements.translationLayer.appendChild(mask);

    // 创建翻译文本块
    const div = document.createElement('div');
    div.className = 'translation-block-overlay';
    div.dataset.index = index;

    div.style.left = x + 'px';
    div.style.top = y + 'px';
    div.style.width = width + 'px';

    // bbox 适配策略：计算合适的字体大小
    const fontSize = calculateFittingFontSize(block.translated, width, height, block.fontSize * scale);
    div.style.fontSize = fontSize + 'px';

    div.textContent = block.translated;
    div.title = block.text; // 悬停显示原文

    // 点击联动侧边栏
    div.addEventListener('click', () => highlightBlock(index));

    elements.translationLayer.appendChild(div);
  });
}

// 计算适配 bbox 的字体大小
function calculateFittingFontSize(text, boxWidth, boxHeight, baseFontSize) {
  // 基础字体大小
  let fontSize = Math.max(baseFontSize * 0.85, 11);

  // 估算文本所需空间
  const charsPerLine = Math.floor(boxWidth / (fontSize * 0.6));
  const lines = Math.ceil(text.length / charsPerLine);
  const lineHeight = 1.5;
  const estimatedHeight = lines * fontSize * lineHeight;

  // 如果超出高度，缩小字体
  if (estimatedHeight > boxHeight * 1.5) {
    const ratio = Math.sqrt(boxHeight * 1.5 / estimatedHeight);
    fontSize = Math.max(fontSize * ratio, 10);
  }

  return Math.min(fontSize, 16); // 最大不超过 16px
}

// hover 模式：渲染悬停目标区域
function renderHoverTargets(translations, viewport) {
  translations.forEach((block, index) => {
    const target = document.createElement('div');
    target.className = 'hover-target';
    target.dataset.index = index;

    const x = block.bbox.x * scale;
    const y = viewport.height - (block.bbox.y + block.bbox.height) * scale;
    const width = block.bbox.width * scale;
    const height = block.bbox.height * scale;

    target.style.left = x + 'px';
    target.style.top = y + 'px';
    target.style.width = width + 'px';
    target.style.height = height + 'px';

    // 悬停显示翻译
    target.addEventListener('mouseenter', (e) => showHoverTranslation(block, e));
    target.addEventListener('mouseleave', hideHoverTranslation);

    elements.translationLayer.appendChild(target);
  });
}

// 显示悬停翻译气泡
function showHoverTranslation(block, event) {
  let bubble = document.getElementById('hoverBubble');
  if (!bubble) {
    bubble = document.createElement('div');
    bubble.id = 'hoverBubble';
    bubble.className = 'hover-bubble';
    document.body.appendChild(bubble);
  }

  bubble.innerHTML = `
    <div class="bubble-original">${block.text}</div>
    <div class="bubble-translated">${block.translated}</div>
  `;

  // 定位气泡
  const rect = event.target.getBoundingClientRect();
  bubble.style.left = rect.left + 'px';
  bubble.style.top = (rect.bottom + 5) + 'px';
  bubble.classList.add('show');
}

// 隐藏悬停翻译气泡
function hideHoverTranslation() {
  const bubble = document.getElementById('hoverBubble');
  if (bubble) bubble.classList.remove('show');
}

// =====================
// 翻译功能
// =====================

async function translateCurrentPage() {
  if (!pdfDoc) {
    showToast('请先加载 PDF 文件');
    return;
  }

  if (!pageTextContents[currentPage]) {
    showToast('请先等待页面加载完成');
    return;
  }

  showLoading('正在分析页面结构...');

  const textContent = pageTextContents[currentPage];
  const blocks = extractTextBlocks(textContent);
  pageBlocks[currentPage] = blocks;

  if (blocks.length === 0) {
    hideLoading();
    showToast('当前页面没有可翻译的文本');
    return;
  }

  showLoading(`正在翻译第 ${currentPage} 页 (${blocks.length} 个段落)...`);

  try {
    const results = await translateBlocks(blocks);
    pageTranslations[currentPage] = results;

    const page = await pdfDoc.getPage(currentPage);
    const viewport = page.getViewport({ scale });
    renderTranslationOverlay(results, viewport);
    updateSidePanel(results);

    hideLoading();
    showToast(`翻译完成，共 ${results.length} 个段落`);
  } catch (error) {
    hideLoading();
    showToast('翻译失败: ' + error.message);
  }
}

// =====================
// 版面分析模块
// =====================

// 将 PDF 文本碎片聚类成行
function clusterIntoLines(items) {
  if (!items.length) return [];

  const lines = [];
  let currentLine = null;

  // 按 Y 坐标排序（从上到下）
  const sorted = [...items].sort((a, b) => b.transform[5] - a.transform[5]);

  for (const item of sorted) {
    const text = item.str;
    if (!text || !text.trim()) continue;

    const x = item.transform[4];
    const y = item.transform[5];
    const fontSize = Math.abs(item.transform[0]) || 12;
    const width = item.width || text.length * fontSize * 0.5;

    // 判断是否属于当前行（Y 坐标接近）
    const yThreshold = fontSize * 0.4;

    if (currentLine && Math.abs(y - currentLine.y) < yThreshold) {
      // 同一行，添加到当前行
      currentLine.items.push({ text, x, y, fontSize, width });
      currentLine.minX = Math.min(currentLine.minX, x);
      currentLine.maxX = Math.max(currentLine.maxX, x + width);
    } else {
      // 新行
      if (currentLine) lines.push(currentLine);
      currentLine = {
        y,
        fontSize,
        minX: x,
        maxX: x + width,
        items: [{ text, x, y, fontSize, width }]
      };
    }
  }

  if (currentLine) lines.push(currentLine);

  // 对每行内的文本按 X 坐标排序并合并
  return lines.map(line => {
    line.items.sort((a, b) => a.x - b.x);
    line.text = mergeLineItems(line.items, line.fontSize);
    return line;
  });
}

// 合并行内文本碎片
function mergeLineItems(items, fontSize) {
  if (!items.length) return '';

  let result = items[0].text;
  const spaceThreshold = fontSize * 0.3;

  for (let i = 1; i < items.length; i++) {
    const prev = items[i - 1];
    const curr = items[i];
    const gap = curr.x - (prev.x + prev.width);

    // 根据间距决定是否加空格
    if (gap > spaceThreshold) {
      result += ' ' + curr.text;
    } else {
      result += curr.text;
    }
  }

  return result;
}

// 将行聚类成段落
function clusterIntoParagraphs(lines) {
  if (!lines.length) return [];

  const paragraphs = [];
  let currentPara = null;

  for (const line of lines) {
    if (!line.text.trim()) continue;

    const lineHeight = line.fontSize * 1.5;
    const paraThreshold = lineHeight * 1.8; // 段落间距阈值

    if (currentPara) {
      const yGap = currentPara.minY - line.y;
      const leftAligned = Math.abs(line.minX - currentPara.minX) < line.fontSize * 2;

      // 判断是否属于同一段落
      if (yGap < paraThreshold && yGap > 0 && leftAligned) {
        currentPara.lines.push(line);
        currentPara.minY = Math.min(currentPara.minY, line.y);
        currentPara.maxY = Math.max(currentPara.maxY, line.y);
        currentPara.maxX = Math.max(currentPara.maxX, line.maxX);
      } else {
        paragraphs.push(finalizeParagraph(currentPara));
        currentPara = createParagraph(line);
      }
    } else {
      currentPara = createParagraph(line);
    }
  }

  if (currentPara) paragraphs.push(finalizeParagraph(currentPara));

  return paragraphs;
}

// 创建新段落
function createParagraph(line) {
  return {
    lines: [line],
    minX: line.minX,
    maxX: line.maxX,
    minY: line.y,
    maxY: line.y,
    fontSize: line.fontSize
  };
}

// 完成段落处理
function finalizeParagraph(para) {
  const text = para.lines.map(l => l.text).join(' ');
  const avgFontSize = para.lines.reduce((s, l) => s + l.fontSize, 0) / para.lines.length;

  return {
    text: text.trim(),
    bbox: {
      x: para.minX,
      y: para.minY,
      width: para.maxX - para.minX,
      height: para.maxY - para.minY + avgFontSize
    },
    fontSize: avgFontSize,
    lineCount: para.lines.length,
    type: detectBlockType(text, para)
  };
}

// 检测块类型（普通文本、表格、公式等）
function detectBlockType(text, para) {
  // 公式检测：大量数学符号
  const mathSymbols = /[=+\-×÷∑∫∏√∞≈≠≤≥αβγδεζηθλμπσφψω]/g;
  const mathCount = (text.match(mathSymbols) || []).length;
  if (mathCount > text.length * 0.1) return 'formula';

  // 代码检测：大量特殊字符
  const codePattern = /[{}()\[\];:]/g;
  const codeCount = (text.match(codePattern) || []).length;
  if (codeCount > text.length * 0.05) return 'code';

  // 标题检测：字体较大且行数少
  if (para.lineCount <= 2 && para.fontSize > 14) return 'heading';

  return 'text';
}

// 主提取函数：从 PDF 文本内容提取段落块
function extractTextBlocks(textContent) {
  const items = textContent.items.filter(item => {
    const text = item.str.trim();
    // 过滤空文本和纯数字（页码等）
    return text && !/^\d+$/.test(text);
  });

  const lines = clusterIntoLines(items);
  const paragraphs = clusterIntoParagraphs(lines);

  // 过滤页眉页脚和非英文段落
  return paragraphs.filter(p => {
    // 必须包含英文
    if (!/[a-zA-Z]{3,}/.test(p.text)) return false;
    // 排除页眉页脚
    if (isHeaderOrFooter(p)) return false;
    return true;
  });
}

// 检测是否为页眉或页脚
function isHeaderOrFooter(block) {
  const text = block.text.trim();
  const y = block.bbox.y;

  // 页码模式
  if (/^(Page\s*)?\d+(\s*of\s*\d+)?$/i.test(text)) return true;
  if (/^\d+\s*[|/]\s*\d+$/.test(text)) return true;

  // 期刊页眉常见模式
  if (/^(Vol\.|Volume|Issue|No\.|Number)\s*\d+/i.test(text)) return true;

  // 日期模式
  if (/^(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4}$/i.test(text)) return true;

  // 短文本且在页面顶部或底部（Y坐标判断）
  // 假设页面高度约 800pt，顶部 50pt 和底部 50pt 为页眉页脚区域
  if (text.length < 50 && (y < 50 || y > 750)) return true;

  // DOI 链接
  if (/^https?:\/\/doi\.org/i.test(text)) return true;
  if (/^doi:/i.test(text)) return true;

  return false;
}

// 保护特殊片段（URL、单位、量表名、引用编号等）
// 使用 ⟦T0⟧ 格式，不易被翻译API清洗
function protectSpecialText(text) {
  const placeholders = [];

  // 先标准化文本（en-dash → hyphen 等）
  let normalized = normalizeText(text);

  // 应用正则保护模式
  PROTECTED_PATTERNS.forEach(pattern => {
    pattern.lastIndex = 0;
    normalized = normalized.replace(pattern, (match) => {
      if (match.includes('⟦T')) return match;
      const placeholder = `⟦T${placeholders.length}⟧`;
      placeholders.push(match);
      return placeholder;
    });
  });

  // 保护统计学缩写
  STAT_ABBREVIATIONS.forEach(abbr => {
    const regex = new RegExp(`\\b${abbr}\\b`, 'g');
    normalized = normalized.replace(regex, (match) => {
      if (normalized.includes(`⟦T`) && placeholders.includes(match)) return match;
      const placeholder = `⟦T${placeholders.length}⟧`;
      placeholders.push(match);
      return placeholder;
    });
  });

  return { protected: normalized, placeholders, count: placeholders.length };
}

// 还原保护的片段（带一致性检查）
function restoreSpecialText(text, placeholders) {
  let restored = text;

  // 统计翻译结果中的占位符数量
  const foundPlaceholders = (text.match(/⟦T\d+⟧/g) || []);
  const foundCount = foundPlaceholders.length;
  const expectedCount = placeholders.length;

  // 一致性检查：如果占位符数量不匹配，记录警告
  if (foundCount !== expectedCount) {
    console.warn(`占位符数量不匹配: 期望 ${expectedCount}, 实际 ${foundCount}`);
  }

  // 还原所有占位符
  placeholders.forEach((original, idx) => {
    const placeholder = `⟦T${idx}⟧`;
    restored = restored.replace(placeholder, original);
  });

  // 清理任何未还原的占位符（防止泄漏）
  restored = restored.replace(/⟦T\d+⟧/g, '');

  return restored;
}

// 翻译段落块
async function translateBlocks(blocks) {
  const results = [];
  const batchSize = 5; // 段落更长，减少批次大小

  for (let i = 0; i < blocks.length; i += batchSize) {
    const batch = blocks.slice(i, i + batchSize);

    // 跳过公式和代码块
    const translatableBatch = batch.filter(b => b.type === 'text' || b.type === 'heading');

    if (translatableBatch.length === 0) {
      batch.forEach(b => results.push({
        ...b,
        translated: b.type === 'formula' ? '[公式]' : b.type === 'code' ? '[代码]' : b.text,
        skipped: b.type !== 'text' && b.type !== 'heading'
      }));
      continue;
    }

    // 保护特殊文本
    const protectedData = translatableBatch.map(b => protectSpecialText(b.text));

    const batchData = protectedData.map((p, idx) => ({
      id: i + idx,
      text: p.protected
    }));

    try {
      const response = await chrome.runtime.sendMessage({
        action: 'translateBatch',
        segments: batchData,
        from: 'en',
        to: 'zh-CN'
      });

      if (response.success) {
        let transIdx = 0;
        batch.forEach(block => {
          if (block.type === 'text' || block.type === 'heading') {
            const translated = response.results[transIdx]?.translated || block.text;
            const restored = restoreSpecialText(translated, protectedData[transIdx].placeholders);
            results.push({ ...block, translated: restored, skipped: false });
            transIdx++;
          } else {
            results.push({
              ...block,
              translated: block.type === 'formula' ? '[公式]' : '[代码]',
              skipped: true
            });
          }
        });
      }
    } catch (error) {
      batch.forEach(b => results.push({ ...b, translated: b.text, skipped: true }));
    }
  }

  return results;
}

async function translateAllPages() {
  showLoading('正在翻译全部页面...');

  for (let i = 1; i <= totalPages; i++) {
    elements.loadingText.textContent = `正在翻译第 ${i}/${totalPages} 页...`;

    if (!pageTextContents[i]) {
      const page = await pdfDoc.getPage(i);
      const textContent = await page.getTextContent();
      pageTextContents[i] = textContent;
    }

    const blocks = extractTextBlocks(pageTextContents[i]);
    pageBlocks[i] = blocks;

    if (blocks.length > 0) {
      const results = await translateBlocks(blocks);
      pageTranslations[i] = results;
    }
  }

  hideLoading();
  showToast('全部翻译完成');

  // 重新渲染当前页
  if (pageTranslations[currentPage]) {
    const page = await pdfDoc.getPage(currentPage);
    const viewport = page.getViewport({ scale });
    renderTranslationOverlay(pageTranslations[currentPage], viewport);
    updateSidePanel(pageTranslations[currentPage]);
  }
}

function updateSidePanel(translations) {
  elements.panelContent.innerHTML = '';

  translations.forEach((block, index) => {
    const item = document.createElement('div');
    item.className = 'panel-block';
    item.dataset.index = index;

    // 类型标签
    if (block.type === 'heading') {
      item.classList.add('is-heading');
    } else if (block.skipped) {
      item.classList.add('is-skipped');
    }

    // 段落序号
    const indexLabel = document.createElement('span');
    indexLabel.className = 'panel-index';
    indexLabel.textContent = `¶${index + 1}`;

    // 翻译文本（默认显示）
    const translated = document.createElement('div');
    translated.className = 'panel-translated';
    translated.textContent = block.translated;

    // 原文（默认折叠）
    const original = document.createElement('div');
    original.className = 'panel-original collapsed';
    original.textContent = block.text;

    // 展开/折叠按钮
    const toggleBtn = document.createElement('button');
    toggleBtn.className = 'panel-toggle';
    toggleBtn.textContent = '原文';
    toggleBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      original.classList.toggle('collapsed');
      toggleBtn.textContent = original.classList.contains('collapsed') ? '原文' : '收起';
    });

    // 组装
    const header = document.createElement('div');
    header.className = 'panel-header-row';
    header.appendChild(indexLabel);
    header.appendChild(toggleBtn);

    item.appendChild(header);
    item.appendChild(translated);
    item.appendChild(original);

    // 点击高亮对应段落
    item.addEventListener('click', () => highlightBlock(index));

    elements.panelContent.appendChild(item);
  });
}

// 高亮指定段落（双向联动）
function highlightBlock(index) {
  currentHighlightIndex = index;

  // 移除之前的高亮
  document.querySelectorAll('.panel-block.active').forEach(el => {
    el.classList.remove('active');
  });
  document.querySelectorAll('.translation-block-overlay.active').forEach(el => {
    el.classList.remove('active');
  });
  document.querySelectorAll('.pdf-highlight').forEach(el => el.remove());

  // 高亮侧边栏
  const panelBlock = document.querySelector(`.panel-block[data-index="${index}"]`);
  if (panelBlock) {
    panelBlock.classList.add('active');
    panelBlock.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  // 高亮 overlay 块
  const overlayBlock = document.querySelector(`.translation-block-overlay[data-index="${index}"]`);
  if (overlayBlock) {
    overlayBlock.classList.add('active');
  }

  // 在 PDF 上显示高亮框
  const translations = pageTranslations[currentPage];
  if (translations && translations[index]) {
    showPdfHighlight(translations[index]);
  }
}

// 在 PDF 上显示高亮框
function showPdfHighlight(block) {
  const highlight = document.createElement('div');
  highlight.className = 'pdf-highlight';

  const x = block.bbox.x * scale;
  const y = elements.canvas.height - (block.bbox.y + block.bbox.height) * scale;
  const width = block.bbox.width * scale;
  const height = block.bbox.height * scale;

  highlight.style.left = x + 'px';
  highlight.style.top = y + 'px';
  highlight.style.width = width + 'px';
  highlight.style.height = height + 'px';

  elements.translationLayer.appendChild(highlight);

  // 1.5秒后淡出
  setTimeout(() => {
    highlight.classList.add('fade-out');
    setTimeout(() => highlight.remove(), 500);
  }, 1500);
}

// =====================
// 事件监听
// =====================

// 翻译按钮
document.getElementById('translateBtn').addEventListener('click', translateCurrentPage);
document.getElementById('translateAllBtn').addEventListener('click', translateAllPages);

// 页面导航
document.getElementById('prevPage').addEventListener('click', () => {
  if (currentPage > 1) renderPage(currentPage - 1);
});

document.getElementById('nextPage').addEventListener('click', () => {
  if (currentPage < totalPages) renderPage(currentPage + 1);
});

elements.pageInput.addEventListener('change', (e) => {
  const page = parseInt(e.target.value);
  if (page >= 1 && page <= totalPages) {
    renderPage(page);
  }
});

// 缩放控制
document.getElementById('zoomIn').addEventListener('click', () => {
  scale = Math.min(scale + 0.25, 3);
  elements.zoomLevel.textContent = Math.round(scale * 100) + '%';
  renderPage(currentPage);
});

document.getElementById('zoomOut').addEventListener('click', () => {
  scale = Math.max(scale - 0.25, 0.5);
  elements.zoomLevel.textContent = Math.round(scale * 100) + '%';
  renderPage(currentPage);
});

// 显示模式切换
document.getElementById('toggleMode').addEventListener('click', (e) => {
  const modes = ['sidebar', 'overlay', 'hover'];
  const labels = ['侧栏对照', '页面嵌入', '悬浮翻译'];
  const idx = (modes.indexOf(displayMode) + 1) % modes.length;
  displayMode = modes[idx];
  e.target.textContent = labels[idx];
  showToast('切换到: ' + labels[idx]);

  // 重新渲染翻译层
  if (pageTranslations[currentPage]) {
    pdfDoc.getPage(currentPage).then(page => {
      const viewport = page.getViewport({ scale });
      renderTranslationOverlay(pageTranslations[currentPage], viewport);
    });
  }
});

// 侧边面板收起/展开
document.getElementById('togglePanel').addEventListener('click', (e) => {
  const panel = elements.sidePanel;
  panel.classList.toggle('collapsed');
  e.target.textContent = panel.classList.contains('collapsed') ? '▶' : '◀';
});

// 键盘快捷键
document.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowLeft') {
    if (currentPage > 1) renderPage(currentPage - 1);
  } else if (e.key === 'ArrowRight') {
    if (currentPage < totalPages) renderPage(currentPage + 1);
  }
});

// =====================
// 初始化
// =====================

function init() {
  const params = new URLSearchParams(window.location.search);
  const url = params.get('file');

  if (url) {
    loadPDF(url);
  } else {
    showToast('未指定 PDF 文件');
  }
}

init();
