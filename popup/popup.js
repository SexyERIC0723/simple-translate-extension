// 获取当前标签页状态
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
  }

  statusText.textContent = text;
}

// 发送消息到 content script
async function sendToContent(action) {
  const tab = await getCurrentTab();
  if (tab) {
    chrome.tabs.sendMessage(tab.id, { action });
  }
}

// 初始化
document.addEventListener('DOMContentLoaded', async () => {
  const translateBtn = document.getElementById('translateBtn');
  const restoreBtn = document.getElementById('restoreBtn');
  const settingsLink = document.getElementById('settingsLink');

  // 翻译按钮
  translateBtn.addEventListener('click', async () => {
    updateStatus('translating', '翻译中...');
    await sendToContent('translatePage');
  });

  // 还原按钮
  restoreBtn.addEventListener('click', async () => {
    await sendToContent('restoreOriginal');
    updateStatus('idle', '已还原');
  });

  // 设置链接
  settingsLink.addEventListener('click', (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });
});
