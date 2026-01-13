// 加载设置
async function loadSettings() {
  const result = await chrome.storage.sync.get(['settings']);
  const settings = result.settings || {
    autoTranslate: false,
    showOriginal: false,
    hoverTranslate: false,
    blacklist: [],
    whitelist: [],
    glossary: [],
    engine: 'google'
  };

  document.getElementById('autoTranslate').checked = settings.autoTranslate;
  document.getElementById('showOriginal').checked = settings.showOriginal || false;
  document.getElementById('hoverTranslate').checked = settings.hoverTranslate || false;
  document.getElementById('blacklist').value = (settings.blacklist || []).join('\n');
  document.getElementById('whitelist').value = (settings.whitelist || []).join('\n');

  // 加载术语库
  const glossaryText = (settings.glossary || [])
    .map(item => `${item.en}=${item.zh}`)
    .join('\n');
  document.getElementById('glossary').value = glossaryText;

  // 设置引擎选择
  const engine = settings.engine || 'google';
  document.getElementById('engineGoogle').checked = (engine === 'google');
  document.getElementById('engineOllama').checked = (engine === 'ollama');

  checkOllamaStatus();
}

// 检测 Ollama 状态
async function checkOllamaStatus() {
  const statusEl = document.getElementById('ollamaStatus');
  const hintEl = document.getElementById('ollamaHint');

  statusEl.textContent = '检测中...';
  statusEl.className = 'status-badge checking';

  try {
    const response = await chrome.runtime.sendMessage({ action: 'checkOllama' });

    if (response?.available) {
      statusEl.textContent = '已连接';
      statusEl.className = 'status-badge connected';
      hintEl.textContent = '可用模型: ' + (response.models || []).join(', ');
    } else {
      statusEl.textContent = '未连接';
      statusEl.className = 'status-badge disconnected';
      hintEl.innerHTML = '请先安装并启动 <a href="https://ollama.ai" target="_blank">Ollama</a>，然后运行: <code>ollama pull qwen2.5:7b</code>';
    }
  } catch (e) {
    statusEl.textContent = '检测失败';
    statusEl.className = 'status-badge disconnected';
  }
}

// 解析术语库
function parseGlossary(text) {
  return text.split('\n')
    .map(line => line.trim())
    .filter(line => line.includes('='))
    .map(line => {
      const [en, zh] = line.split('=').map(s => s.trim());
      return { en, zh };
    })
    .filter(item => item.en && item.zh);
}

// 保存设置
async function saveSettings() {
  const engine = document.querySelector('input[name="engine"]:checked')?.value || 'google';

  const settings = {
    autoTranslate: document.getElementById('autoTranslate').checked,
    showOriginal: document.getElementById('showOriginal').checked,
    hoverTranslate: document.getElementById('hoverTranslate').checked,
    blacklist: document.getElementById('blacklist').value
      .split('\n')
      .map(s => s.trim())
      .filter(Boolean),
    whitelist: document.getElementById('whitelist').value
      .split('\n')
      .map(s => s.trim())
      .filter(Boolean),
    glossary: parseGlossary(document.getElementById('glossary').value),
    engine: engine
  };

  await chrome.storage.sync.set({ settings });
  await chrome.runtime.sendMessage({ action: 'setEngine', engine: engine });

  const status = document.getElementById('saveStatus');
  status.textContent = '✓ 已保存';
  status.classList.add('show');
  setTimeout(() => {
    status.textContent = '';
    status.classList.remove('show');
  }, 2000);
}

// 初始化
document.addEventListener('DOMContentLoaded', () => {
  loadSettings();
  document.getElementById('saveBtn').addEventListener('click', saveSettings);
  document.getElementById('engineOllama').addEventListener('change', checkOllamaStatus);
});
