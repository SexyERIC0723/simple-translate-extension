// 翻译状态
const TranslateState = {
  IDLE: 'idle',
  TRANSLATING: 'translating',
  TRANSLATED: 'translated',
  ERROR: 'error'
};

// 全局状态
let currentState = TranslateState.IDLE;
let originalTexts = new WeakMap();
let translatedNodes = new Set();
let nodeIdCounter = 0;
let nodeIdMap = new Map();

// 需要跳过的标签
const SKIP_TAGS = new Set([
  'SCRIPT', 'STYLE', 'NOSCRIPT', 'IFRAME', 'OBJECT',
  'EMBED', 'TEXTAREA', 'INPUT', 'CODE', 'PRE', 'KBD',
  'SAMP', 'VAR', 'SVG', 'MATH', 'CANVAS'
]);

// 判断是否为英文文本
function isEnglishText(text) {
  const cleaned = text.replace(/[\s\d\p{P}]/gu, '');
  if (cleaned.length < 3) return false;
  const englishChars = (cleaned.match(/[a-zA-Z]/g) || []).length;
  return englishChars / cleaned.length > 0.5;
}

// 判断节点是否可见
function isVisible(node) {
  if (!node.parentElement) return false;
  const style = window.getComputedStyle(node.parentElement);
  return style.display !== 'none' &&
    style.visibility !== 'hidden' &&
    style.opacity !== '0';
}

// 判断是否应该跳过该节点
function shouldSkipNode(node) {
  if (!node.parentElement) return true;
  let parent = node.parentElement;
  while (parent) {
    if (SKIP_TAGS.has(parent.tagName)) return true;
    if (parent.isContentEditable) return true;
    parent = parent.parentElement;
  }
  return false;
}

// 收集所有需要翻译的文本节点
function collectTextNodes(root = document.body) {
  const textNodes = [];
  const walker = document.createTreeWalker(
    root,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode: (node) => {
        const text = node.textContent.trim();
        if (!text) return NodeFilter.FILTER_REJECT;
        if (shouldSkipNode(node)) return NodeFilter.FILTER_REJECT;
        if (!isVisible(node)) return NodeFilter.FILTER_REJECT;
        if (!isEnglishText(text)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    }
  );

  let node;
  while (node = walker.nextNode()) {
    textNodes.push(node);
  }
  return textNodes;
}

// 准备翻译段落
function prepareSegments(textNodes) {
  const segments = [];
  textNodes.forEach((node) => {
    const id = nodeIdCounter++;
    nodeIdMap.set(id, node);
    originalTexts.set(node, node.textContent);
    segments.push({ id, text: node.textContent.trim() });
  });
  return segments;
}

// 应用翻译结果
function applyTranslations(results) {
  results.forEach(({ id, translated, success }) => {
    const node = nodeIdMap.get(id);
    if (node && success && translated) {
      node.textContent = translated;
      translatedNodes.add(node);
      if (node.parentElement) {
        node.parentElement.classList.add('jianyi-translated');
      }
    }
  });
}

// 翻译整个页面
async function translatePage() {
  if (currentState === TranslateState.TRANSLATING) return;

  currentState = TranslateState.TRANSLATING;
  showStatus('正在翻译...');

  try {
    const textNodes = collectTextNodes();
    console.log('[简译] 找到文本节点:', textNodes.length);

    if (textNodes.length === 0) {
      showStatus('没有找到需要翻译的英文内容', 3000);
      currentState = TranslateState.IDLE;
      notifyPopup('translationError', { message: '没有可翻译内容' });
      return;
    }

    const segments = prepareSegments(textNodes);
    const totalCount = segments.length;

    // 通知 popup 开始翻译
    notifyPopup('translationProgress', { current: 0, total: totalCount });

    // 分批翻译以显示进度
    const BATCH_SIZE = 50;
    let completedCount = 0;
    let successCount = 0;

    for (let i = 0; i < segments.length; i += BATCH_SIZE) {
      const batch = segments.slice(i, i + BATCH_SIZE);

      // 带重试的翻译请求
      let response = await translateWithRetry(batch);

      if (response?.success && response.results) {
        applyTranslations(response.results);
        successCount += response.results.filter(r => r.success).length;
      }

      completedCount += batch.length;
      showStatus(`翻译中 ${completedCount}/${totalCount}`);
      notifyPopup('translationProgress', { current: completedCount, total: totalCount });
    }

    currentState = TranslateState.TRANSLATED;
    showStatus(`翻译完成 (${successCount}/${totalCount})`, 2000);
    notifyPopup('translationComplete', { count: successCount });

  } catch (error) {
    console.error('[简译] 翻译错误:', error);
    currentState = TranslateState.ERROR;
    showStatus('翻译失败: ' + error.message, 3000);
    notifyPopup('translationError', { message: error.message });
  }
}

// 带重试的翻译请求
async function translateWithRetry(segments, maxRetries = 2) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await chrome.runtime.sendMessage({
        action: 'translateBatch',
        segments: segments,
        from: 'en',
        to: 'zh-CN'
      });
      return response;
    } catch (error) {
      console.log(`[简译] 翻译请求失败 (尝试 ${attempt}/${maxRetries}):`, error.message);
      if (attempt === maxRetries) throw error;
      await new Promise(r => setTimeout(r, 500 * attempt));
    }
  }
}

// 通知 popup
function notifyPopup(action, data) {
  try {
    chrome.runtime.sendMessage({ action, ...data });
  } catch (e) {
    // popup 可能未打开
  }
}

// 还原原文
function restoreOriginal() {
  translatedNodes.forEach((node) => {
    const original = originalTexts.get(node);
    if (original) {
      node.textContent = original;
      if (node.parentElement) {
        node.parentElement.classList.remove('jianyi-translated');
      }
    }
  });
  translatedNodes.clear();
  currentState = TranslateState.IDLE;
  showStatus('已还原原文', 2000);
}

// 切换翻译/原文
function toggleTranslation() {
  if (currentState === TranslateState.TRANSLATED) {
    restoreOriginal();
  } else if (currentState === TranslateState.IDLE) {
    translatePage();
  }
}

// 翻译选中文本
async function translateSelection() {
  const selection = window.getSelection();
  const text = selection.toString().trim();

  if (!text) {
    showStatus('请先选中要翻译的文本');
    return;
  }

  showStatus('正在翻译选中内容...');

  try {
    const response = await chrome.runtime.sendMessage({
      action: 'translate',
      text: text,
      from: 'en',
      to: 'zh-CN'
    });

    if (response.success) {
      showTranslationPopup(response.translated, text);
    } else {
      showStatus('翻译失败', 2000);
    }
  } catch (error) {
    showStatus('翻译失败: ' + error.message, 2000);
  }
}

// 显示状态提示
let statusElement = null;
function showStatus(message, duration = 0) {
  if (!statusElement) {
    statusElement = document.createElement('div');
    statusElement.className = 'jianyi-status';
    document.body.appendChild(statusElement);
  }

  statusElement.textContent = message;
  statusElement.classList.add('jianyi-status-show');

  if (duration > 0) {
    setTimeout(() => {
      statusElement.classList.remove('jianyi-status-show');
    }, duration);
  }
}

// 显示翻译弹窗
function showTranslationPopup(translated, original) {
  const existing = document.querySelector('.jianyi-popup');
  if (existing) existing.remove();

  const popup = document.createElement('div');
  popup.className = 'jianyi-popup';
  popup.innerHTML = `
    <div class="jianyi-popup-header">
      <span>翻译结果</span>
      <button class="jianyi-popup-close">&times;</button>
    </div>
    <div class="jianyi-popup-content">
      <div class="jianyi-popup-translated">${translated}</div>
      <div class="jianyi-popup-original">${original}</div>
    </div>
  `;

  document.body.appendChild(popup);

  // 定位到选中位置
  const selection = window.getSelection();
  if (selection.rangeCount > 0) {
    const rect = selection.getRangeAt(0).getBoundingClientRect();
    popup.style.top = `${rect.bottom + window.scrollY + 10}px`;
    popup.style.left = `${rect.left + window.scrollX}px`;
  }

  // 关闭按钮
  popup.querySelector('.jianyi-popup-close').onclick = () => popup.remove();

  // 点击外部关闭
  setTimeout(() => {
    document.addEventListener('click', function handler(e) {
      if (!popup.contains(e.target)) {
        popup.remove();
        document.removeEventListener('click', handler);
      }
    });
  }, 100);
}

// 监听来自 background 的消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  switch (request.action) {
    case 'translatePage':
      translatePage();
      break;
    case 'translateSelection':
      translateSelection();
      break;
    case 'toggleTranslation':
      toggleTranslation();
      break;
    case 'restoreOriginal':
      restoreOriginal();
      break;
    case 'getState':
      sendResponse({ state: currentState });
      break;
  }
  return true;
});

// MutationObserver 监听动态内容
let observer = null;
let pendingNodes = [];
let translateTimeout = null;

function setupObserver() {
  if (observer) return;

  observer = new MutationObserver((mutations) => {
    if (currentState !== TranslateState.TRANSLATED) return;

    mutations.forEach((mutation) => {
      mutation.addedNodes.forEach((node) => {
        if (node.nodeType === Node.ELEMENT_NODE) {
          const textNodes = collectTextNodes(node);
          pendingNodes.push(...textNodes);
        }
      });
    });

    // 防抖处理
    if (pendingNodes.length > 0 && !translateTimeout) {
      translateTimeout = setTimeout(translatePendingNodes, 500);
    }
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true
  });
}

async function translatePendingNodes() {
  if (pendingNodes.length === 0) {
    translateTimeout = null;
    return;
  }

  const nodes = [...pendingNodes];
  pendingNodes = [];
  translateTimeout = null;

  const segments = prepareSegments(nodes);
  if (segments.length === 0) return;

  try {
    const response = await chrome.runtime.sendMessage({
      action: 'translateBatch',
      segments,
      from: 'en',
      to: 'zh-CN'
    });

    if (response.success) {
      applyTranslations(response.results);
    }
  } catch (error) {
    console.error('翻译动态内容失败:', error);
  }
}

// 初始化
setupObserver();

// 检查是否需要自动翻译
async function checkAutoTranslate() {
  console.log('[简译] 检查自动翻译...');
  try {
    const response = await chrome.runtime.sendMessage({ action: 'getSettings' });
    console.log('[简译] 设置:', response);

    if (response && response.autoTranslate) {
      // 检查黑名单
      const hostname = window.location.hostname;
      const blacklist = response.blacklist || [];
      const isBlacklisted = blacklist.some(domain => hostname.includes(domain));
      console.log('[简译] 域名:', hostname, '黑名单:', isBlacklisted);

      if (!isBlacklisted) {
        const isEng = isEnglishPage();
        console.log('[简译] 是否英文页面:', isEng);
        if (isEng) {
          setTimeout(() => translatePage(), 800);
        }
      }
    }
  } catch (e) {
    console.log('[简译] 获取设置失败:', e);
  }
}

// 检测页面是否为英文
function isEnglishPage() {
  const lang = document.documentElement.lang?.toLowerCase() || '';
  if (lang.startsWith('en')) return true;
  if (lang.startsWith('zh')) return false;

  // 采样检测
  const text = document.body?.innerText?.slice(0, 1000) || '';
  const englishChars = (text.match(/[a-zA-Z]/g) || []).length;
  return englishChars / text.length > 0.5;
}

// 页面加载完成后检查自动翻译
console.log('[简译] Content script 已加载, readyState:', document.readyState);

function initAutoTranslate() {
  // 延迟执行确保 DOM 完全就绪
  setTimeout(() => {
    console.log('[简译] 开始初始化自动翻译检查');
    checkAutoTranslate();
  }, 500);
}

// document_idle 时 readyState 可能是 'interactive' 或 'complete'
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initAutoTranslate);
} else {
  // 已经加载完成，直接执行
  initAutoTranslate();
}
