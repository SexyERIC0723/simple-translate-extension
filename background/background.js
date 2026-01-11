// 翻译服务配置
const TRANSLATE_API = {
  google: {
    url: 'https://translate.googleapis.com/translate_a/single',
    buildParams: (text, from, to) => ({
      client: 'gtx',
      sl: from,
      tl: to,
      dt: 't',
      q: text
    })
  },
  ollama: {
    url: 'http://localhost:11434/api/generate',
    model: 'qwen2.5:7b'  // 推荐使用 qwen2.5 翻译效果好
  }
};

// 翻译缓存
const translationCache = new Map();

// 当前翻译引擎
let currentEngine = 'google';

// PDF 查看器 URL
const PDF_VIEWER_URL = chrome.runtime.getURL('pdf/viewer.html');

// 初始化右键菜单
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'translate-selection',
    title: '翻译选中文本',
    contexts: ['selection']
  });

  chrome.contextMenus.create({
    id: 'translate-page',
    title: '翻译整个页面',
    contexts: ['page']
  });

  chrome.contextMenus.create({
    id: 'open-pdf-translator',
    title: '用简译打开 PDF',
    contexts: ['link'],
    targetUrlPatterns: ['*://*/*.pdf', '*://*/*.PDF']
  });
});

// 右键菜单点击处理
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'translate-selection') {
    chrome.tabs.sendMessage(tab.id, {
      action: 'translateSelection'
    });
  } else if (info.menuItemId === 'translate-page') {
    chrome.tabs.sendMessage(tab.id, {
      action: 'translatePage'
    });
  } else if (info.menuItemId === 'open-pdf-translator') {
    // 用简译 PDF 查看器打开链接
    const pdfUrl = info.linkUrl;
    chrome.tabs.create({
      url: `${PDF_VIEWER_URL}?file=${encodeURIComponent(pdfUrl)}`
    });
  }
});

// 生成缓存键
function getCacheKey(text, from, to) {
  return `${from}:${to}:${text}`;
}

// 调用 Ollama 本地模型翻译
async function translateWithOllama(text, from = 'en', to = 'zh-CN') {
  const cacheKey = getCacheKey(text, from, to) + ':ollama';
  if (translationCache.has(cacheKey)) {
    return translationCache.get(cacheKey);
  }

  const prompt = `Translate the following English text to Chinese. Only output the translation, nothing else.\n\nText: ${text}\n\nTranslation:`;

  try {
    const response = await fetch(TRANSLATE_API.ollama.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: TRANSLATE_API.ollama.model,
        prompt: prompt,
        stream: false
      })
    });

    if (!response.ok) {
      throw new Error(`Ollama HTTP ${response.status}`);
    }

    const data = await response.json();
    const translated = data.response?.trim();

    if (!translated) {
      throw new Error('Empty Ollama response');
    }

    translationCache.set(cacheKey, translated);
    return translated;
  } catch (error) {
    console.error('Ollama error:', error);
    throw error;
  }
}

// 调用 Google 翻译 API
async function translateWithGoogle(text, from = 'en', to = 'zh-CN') {
  const cacheKey = getCacheKey(text, from, to);
  if (translationCache.has(cacheKey)) {
    return translationCache.get(cacheKey);
  }

  try {
    const params = new URLSearchParams(TRANSLATE_API.google.buildParams(text, from, to));
    const url = `${TRANSLATE_API.google.url}?${params}`;

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Accept': 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();

    // 解析 Google 翻译返回格式
    let translated = '';
    if (data && data[0]) {
      translated = data[0].map(item => item[0]).filter(Boolean).join('');
    }

    if (!translated) {
      throw new Error('Empty translation result');
    }

    translationCache.set(cacheKey, translated);
    return translated;
  } catch (error) {
    console.error('Google Translate API error:', error);
    throw error;
  }
}

// 批量翻译 - 合并文本并并行请求
async function translateBatch(segments, from = 'en', to = 'zh-CN') {
  if (segments.length === 0) return [];

  const SEPARATOR = '\n###\n';
  const MAX_LENGTH = 4500;
  const batches = [];
  let currentBatch = [];
  let currentLength = 0;

  // 分组
  for (const seg of segments) {
    const segLength = seg.text.length + SEPARATOR.length;
    if (currentLength + segLength > MAX_LENGTH && currentBatch.length > 0) {
      batches.push(currentBatch);
      currentBatch = [];
      currentLength = 0;
    }
    currentBatch.push(seg);
    currentLength += segLength;
  }
  if (currentBatch.length > 0) {
    batches.push(currentBatch);
  }

  // 并行请求（最多3个同时）
  const CONCURRENT = 3;
  const results = [];
  for (let i = 0; i < batches.length; i += CONCURRENT) {
    const chunk = batches.slice(i, i + CONCURRENT);
    const chunkResults = await Promise.all(
      chunk.map(batch => translateSingleBatch(batch, from, to, SEPARATOR))
    );
    chunkResults.forEach(r => results.push(...r));
  }

  return results;
}

// 统一翻译接口
async function translate(text, from = 'en', to = 'zh-CN') {
  if (currentEngine === 'ollama') {
    return translateWithOllama(text, from, to);
  }
  return translateWithGoogle(text, from, to);
}

// 翻译单个批次
async function translateSingleBatch(segments, from, to, separator) {
  const combinedText = segments.map(s => s.text).join(separator);

  try {
    const translated = await translate(combinedText, from, to);
    const parts = translated.split(/\n*###\n*/);

    return segments.map((seg, i) => ({
      id: seg.id,
      translated: parts[i]?.trim() || seg.text,
      success: !!parts[i]
    }));
  } catch (error) {
    console.error('批次翻译失败:', error);
    return segments.map(seg => ({
      id: seg.id,
      translated: seg.text,
      success: false
    }));
  }
}

// 监听来自 content script 的消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'translate') {
    translate(request.text, request.from, request.to)
      .then(translated => sendResponse({ success: true, translated }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (request.action === 'translateBatch') {
    translateBatch(request.segments, request.from, request.to)
      .then(results => sendResponse({ success: true, results }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (request.action === 'getSettings') {
    chrome.storage.sync.get(['settings'], (result) => {
      const settings = result.settings || getDefaultSettings();
      settings.engine = currentEngine;
      sendResponse(settings);
    });
    return true;
  }

  if (request.action === 'setEngine') {
    currentEngine = request.engine;
    chrome.storage.sync.get(['settings'], (result) => {
      const settings = result.settings || getDefaultSettings();
      settings.engine = currentEngine;
      chrome.storage.sync.set({ settings });
    });
    sendResponse({ success: true, engine: currentEngine });
    return true;
  }

  if (request.action === 'checkOllama') {
    checkOllamaStatus().then(sendResponse);
    return true;
  }
});

// 默认设置
function getDefaultSettings() {
  return {
    autoTranslate: false,
    showOriginal: false,
    blacklist: [],
    whitelist: [],
    engine: 'google'
  };
}

// 检测 Ollama 状态
async function checkOllamaStatus() {
  try {
    const response = await fetch('http://localhost:11434/api/tags', {
      method: 'GET'
    });
    if (response.ok) {
      const data = await response.json();
      const models = data.models || [];
      return {
        available: true,
        models: models.map(m => m.name)
      };
    }
    return { available: false, error: 'Ollama not responding' };
  } catch (e) {
    return { available: false, error: e.message };
  }
}

// 初始化时加载引擎设置
chrome.storage.sync.get(['settings'], (result) => {
  if (result.settings?.engine) {
    currentEngine = result.settings.engine;
  }
});

// 快捷键处理
chrome.commands.onCommand.addListener((command, tab) => {
  if (command === 'toggle-translation') {
    chrome.tabs.sendMessage(tab.id, { action: 'toggleTranslation' });
  }
});

// PDF 自动拦截设置
let pdfAutoOpen = true;

// 监听标签页更新，检测 PDF
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (!pdfAutoOpen) return;
  if (changeInfo.status !== 'loading') return;

  const url = tab.url || tab.pendingUrl;
  if (!url) return;

  // 检测是否是 PDF 文件
  if (isPdfUrl(url) && !url.startsWith(PDF_VIEWER_URL)) {
    chrome.tabs.update(tabId, {
      url: `${PDF_VIEWER_URL}?file=${encodeURIComponent(url)}`
    });
  }
});

// 检测 URL 是否是 PDF
function isPdfUrl(url) {
  if (!url) return false;
  const lowerUrl = url.toLowerCase();
  return lowerUrl.endsWith('.pdf') ||
         lowerUrl.includes('.pdf?') ||
         lowerUrl.includes('.pdf#');
}
