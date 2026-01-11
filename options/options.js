// 加载设置
async function loadSettings() {
  const result = await chrome.storage.sync.get(['settings']);
  const settings = result.settings || {
    autoTranslate: false,
    blacklist: [],
    engine: 'google'
  };

  document.getElementById('autoTranslate').checked = settings.autoTranslate;
  document.getElementById('blacklist').value = settings.blacklist.join('\n');

  // 设置引擎选择
  const engine = settings.engine || 'google';
  document.getElementById('engineGoogle').checked = (engine === 'google');
  document.getElementById('engineOllama').checked = (engine === 'ollama');

  // 检测 Ollama 状态
  checkOllamaStatus();
}

// 检测 Ollama 状态
async function checkOllamaStatus() {
  const statusEl = document.getElementById('ollamaStatus');
  const hintEl = document.getElementById('ollamaHint');

  statusEl.textContent = '检测中...';
  statusEl.className = 'status-badge checking';

  const response = await chrome.runtime.sendMessage({ action: 'checkOllama' });

  if (response.available) {
    statusEl.textContent = '已连接';
    statusEl.className = 'status-badge connected';
    hintEl.textContent = '可用模型: ' + response.models.join(', ');
  } else {
    statusEl.textContent = '未连接';
    statusEl.className = 'status-badge disconnected';
    hintEl.innerHTML = '请先安装并启动 <a href="https://ollama.ai" target="_blank">Ollama</a>，然后运行: ollama pull qwen2.5:7b';
  }
}

// 保存设置
async function saveSettings() {
  const engine = document.querySelector('input[name="engine"]:checked').value;

  const settings = {
    autoTranslate: document.getElementById('autoTranslate').checked,
    blacklist: document.getElementById('blacklist').value
      .split('\n')
      .map(s => s.trim())
      .filter(Boolean),
    engine: engine
  };

  await chrome.storage.sync.set({ settings });

  // 通知 background 切换引擎
  await chrome.runtime.sendMessage({ action: 'setEngine', engine: engine });

  const status = document.getElementById('saveStatus');
  status.textContent = '已保存';
  setTimeout(() => status.textContent = '', 2000);
}

// 初始化
document.addEventListener('DOMContentLoaded', () => {
  loadSettings();
  document.getElementById('saveBtn').addEventListener('click', saveSettings);
});
