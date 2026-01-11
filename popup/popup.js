// 获取当前标签页
async function getCurrentTab() {
  const [tab] = await chrome.tabs.query({
    active: true,
    currentWindow: true
  });
  return tab;
}

// 更新状态显示
function updateStatus(state, text) {
  const dot = document.querySelector('.status-dot');
  const statusText = document.querySelector('.status-text');

  dot.className = 'status-dot';
  if (state === 'translating') {
    dot.classList.add('translating');
  } else if (state === 'error') {
    dot.classList.add('error');
  } else if (state === 'success') {
    dot.classList.add('success');
  }

  statusText.textContent = text;
}

// 更新进度条
function updateProgress(current, total) {
  const container = document.getElementById('progressContainer');
  const fill = document.getElementById('progressFill');
  const text = document.getElementById('progressText');

  if (total > 0) {
    container.style.display = 'block';
    const percent = Math.round((current / total) * 100);
    fill.style.width = percent + '%';
    text.textContent = `${current}/${total}`;
  } else {
    container.style.display = 'none';
  }
}

// 发送消息到 content script
async function sendToContent(action) {
  const tab = await getCurrentTab();
  if (tab && !tab.url?.startsWith('chrome://')) {
    try {
      await chrome.tabs.sendMessage(tab.id, { action });
    } catch (e) {
      updateStatus('error', '无法连接页面');
    }
  } else {
    updateStatus('error', '不支持此页面');
  }
}

// 获取当前页面翻译状态
async function getPageState() {
  const tab = await getCurrentTab();
  if (tab && !tab.url?.startsWith('chrome://')) {
    try {
      const response = await chrome.tabs.sendMessage(tab.id, { action: 'getState' });
      if (response?.state === 'translated') {
        updateStatus('success', '已翻译');
      } else if (response?.state === 'translating') {
        updateStatus('translating', '翻译中...');
      }
    } catch (e) {
      // content script 未加载
    }
  }
}

// 监听来自 content script 的消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'translationProgress') {
    updateProgress(request.current, request.total);
    updateStatus('translating', `翻译中 ${request.current}/${request.total}`);
  } else if (request.action === 'translationComplete') {
    updateStatus('success', `翻译完成 (${request.count})`);
    updateProgress(0, 0);
  } else if (request.action === 'translationError') {
    updateStatus('error', '翻译失败');
    updateProgress(0, 0);
  }
});

// 初始化
document.addEventListener('DOMContentLoaded', async () => {
  const translateBtn = document.getElementById('translateBtn');
  const restoreBtn = document.getElementById('restoreBtn');
  const settingsLink = document.getElementById('settingsLink');

  // 获取当前状态
  await getPageState();

  // 翻译按钮
  translateBtn.addEventListener('click', async () => {
    updateStatus('translating', '翻译中...');
    await sendToContent('translatePage');
  });

  // 还原按钮
  restoreBtn.addEventListener('click', async () => {
    await sendToContent('restoreOriginal');
    updateStatus('idle', '已还原');
    updateProgress(0, 0);
  });

  // 设置链接
  settingsLink.addEventListener('click', (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });
});
