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
let settings = null;

// 需要跳过的标签
const SKIP_TAGS = new Set([
  'SCRIPT', 'STYLE', 'NOSCRIPT', 'IFRAME', 'OBJECT',
  'EMBED', 'TEXTAREA', 'INPUT', 'CODE', 'PRE', 'KBD',
  'SAMP', 'VAR', 'SVG', 'MATH', 'CANVAS'
]);

// 加载设置
async function loadSettings() {
  try {
    const response = await chrome.runtime.sendMessage({ action: 'getSettings' });
    settings = response || {};
  } catch (e) {
    settings = {};
  }
  return settings;
}

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
    if (parent.classList?.contains('jianyi-bilingual')) return true;
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

// 应用翻译结果（支持双语对照）
function applyTranslations(results, showBilingual = false) {
  results.forEach(({ id, translated, success }) => {
    const node = nodeIdMap.get(id);
    if (node && success && translated) {
      const original = originalTexts.get(node);

      if (showBilingual && node.parentElement) {
        // 双语对照模式：创建包装容器
        const wrapper = document.createElement('span');
        wrapper.className = 'jianyi-bilingual';
        wrapper.innerHTML = `
          <span class="jianyi-translated-text">${translated}</span>
          <span class="jianyi-original-text">${original}</span>
        `;
        node.parentElement.insertBefore(wrapper, node);
        node.textContent = '';
        node.parentElement.classList.add('jianyi-translated');
      } else {
        // 普通模式
        node.textContent = translated;
        if (node.parentElement) {
          node.parentElement.classList.add('jianyi-translated');
          node.parentElement.dataset.original = original;
        }
      }
      translatedNodes.add(node);
    }
  });
}

// 翻译整个页面
async function translatePage() {
  if (currentState === TranslateState.TRANSLATING) return;

  currentState = TranslateState.TRANSLATING;
  showStatus('正在翻译...');

  // 加载设置
  await loadSettings();
  const showBilingual = settings.showOriginal || false;

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

    notifyPopup('translationProgress', { current: 0, total: totalCount });

    const BATCH_SIZE = 50;
    let completedCount = 0;
    let successCount = 0;

    for (let i = 0; i < segments.length; i += BATCH_SIZE) {
      const batch = segments.slice(i, i + BATCH_SIZE);
      let response = await translateWithRetry(batch);

      if (response?.success && response.results) {
        applyTranslations(response.results, showBilingual);
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
  } catch (e) { }
}

// 还原原文
function restoreOriginal() {
  // 移除双语包装
  document.querySelectorAll('.jianyi-bilingual').forEach(wrapper => {
    const parent = wrapper.parentElement;
    const originalText = wrapper.querySelector('.jianyi-original-text')?.textContent || '';
    wrapper.replaceWith(document.createTextNode(originalText));
    if (parent) parent.classList.remove('jianyi-translated');
  });

  // 恢复普通翻译节点
  translatedNodes.forEach((node) => {
    const original = originalTexts.get(node);
    if (original) {
      node.textContent = original;
      if (node.parentElement) {
        node.parentElement.classList.remove('jianyi-translated');
        delete node.parentElement.dataset.original;
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

  const selection = window.getSelection();
  if (selection.rangeCount > 0) {
    const rect = selection.getRangeAt(0).getBoundingClientRect();
    popup.style.top = `${rect.bottom + window.scrollY + 10}px`;
    popup.style.left = `${rect.left + window.scrollX}px`;
  }

  popup.querySelector('.jianyi-popup-close').onclick = () => popup.remove();

  setTimeout(() => {
    document.addEventListener('click', function handler(e) {
      if (!popup.contains(e.target)) {
        popup.remove();
        document.removeEventListener('click', handler);
      }
    });
  }, 100);
}

// ==================
// 悬浮翻译功能
// ==================
let hoverTimeout = null;
let hoverBubble = null;

function initHoverTranslate() {
  document.addEventListener('mouseover', handleHover);
  document.addEventListener('mouseout', handleHoverOut);
}

async function handleHover(e) {
  if (!settings?.hoverTranslate) return;

  const target = e.target;
  if (target.nodeType !== Node.ELEMENT_NODE) return;
  if (SKIP_TAGS.has(target.tagName)) return;
  if (target.closest('.jianyi-popup, .jianyi-hover-bubble, .jianyi-status')) return;

  const text = target.innerText?.trim();
  if (!text || text.length < 3 || text.length > 500) return;
  if (!isEnglishText(text)) return;

  clearTimeout(hoverTimeout);
  hoverTimeout = setTimeout(async () => {
    try {
      const response = await chrome.runtime.sendMessage({
        action: 'translate',
        text: text,
        from: 'en',
        to: 'zh-CN'
      });

      if (response.success) {
        showHoverBubble(target, response.translated, text);
      }
    } catch (err) {
      console.log('[简译] 悬浮翻译失败:', err);
    }
  }, 500);
}

function handleHoverOut(e) {
  clearTimeout(hoverTimeout);
  setTimeout(() => {
    if (hoverBubble && !hoverBubble.matches(':hover')) {
      hideHoverBubble();
    }
  }, 200);
}

function showHoverBubble(target, translated, original) {
  hideHoverBubble();

  hoverBubble = document.createElement('div');
  hoverBubble.className = 'jianyi-hover-bubble';
  hoverBubble.innerHTML = `
    <div class="jianyi-hover-translated">${translated}</div>
    <div class="jianyi-hover-original">${original}</div>
  `;

  document.body.appendChild(hoverBubble);

  const rect = target.getBoundingClientRect();
  hoverBubble.style.top = `${rect.bottom + window.scrollY + 8}px`;
  hoverBubble.style.left = `${rect.left + window.scrollX}px`;

  // 确保不超出视口
  const bubbleRect = hoverBubble.getBoundingClientRect();
  if (bubbleRect.right > window.innerWidth) {
    hoverBubble.style.left = `${window.innerWidth - bubbleRect.width - 10}px`;
  }

  hoverBubble.addEventListener('mouseleave', hideHoverBubble);
}

function hideHoverBubble() {
  if (hoverBubble) {
    hoverBubble.remove();
    hoverBubble = null;
  }
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
      applyTranslations(response.results, settings?.showOriginal);
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
  await loadSettings();

  if (settings.autoTranslate) {
    const hostname = window.location.hostname;
    const blacklist = settings.blacklist || [];
    const whitelist = settings.whitelist || [];

    const isBlacklisted = blacklist.some(domain => hostname.includes(domain));
    const isWhitelisted = whitelist.length === 0 || whitelist.some(domain => hostname.includes(domain));

    if (!isBlacklisted && isWhitelisted && isEnglishPage()) {
      setTimeout(() => translatePage(), 800);
    }
  }

  // 初始化悬浮翻译
  if (settings.hoverTranslate) {
    initHoverTranslate();
  }
}

// 检测页面是否为英文
function isEnglishPage() {
  const lang = document.documentElement.lang?.toLowerCase() || '';
  if (lang.startsWith('en')) return true;
  if (lang.startsWith('zh')) return false;

  const text = document.body?.innerText?.slice(0, 1000) || '';
  const englishChars = (text.match(/[a-zA-Z]/g) || []).length;
  return englishChars / text.length > 0.5;
}

console.log('[简译] Content script 已加载');

function initAutoTranslate() {
  setTimeout(() => {
    console.log('[简译] 开始初始化');
    checkAutoTranslate();
  }, 500);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initAutoTranslate);
} else {
  initAutoTranslate();
}
