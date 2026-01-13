// IndexedDB 数据库
const DB_NAME = 'JianyiHistory';
const DB_VERSION = 1;
const STORE_NAME = 'translations';

let db = null;

// 初始化数据库
async function initDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
            db = request.result;
            resolve(db);
        };

        request.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                const store = db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
                store.createIndex('timestamp', 'timestamp', { unique: false });
                store.createIndex('url', 'url', { unique: false });
            }
        };
    });
}

// 获取所有历史记录
async function getAllHistory() {
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const index = store.index('timestamp');
        const request = index.openCursor(null, 'prev');

        const items = [];
        request.onsuccess = (e) => {
            const cursor = e.target.result;
            if (cursor) {
                items.push(cursor.value);
                cursor.continue();
            } else {
                resolve(items);
            }
        };
        request.onerror = () => reject(request.error);
    });
}

// 删除单条记录
async function deleteItem(id) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const request = store.delete(id);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
    });
}

// 清空所有记录
async function clearAll() {
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const request = store.clear();
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
    });
}

// 格式化时间
function formatTime(timestamp) {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now - date;

    if (diff < 60000) return '刚刚';
    if (diff < 3600000) return Math.floor(diff / 60000) + ' 分钟前';
    if (diff < 86400000) return Math.floor(diff / 3600000) + ' 小时前';
    if (diff < 604800000) return Math.floor(diff / 86400000) + ' 天前';

    return date.toLocaleDateString('zh-CN');
}

// 渲染历史列表
function renderHistory(items) {
    const listEl = document.getElementById('historyList');
    const statsEl = document.getElementById('stats');

    if (items.length === 0) {
        listEl.innerHTML = '<div class="placeholder">暂无翻译历史</div>';
        statsEl.textContent = '';
        return;
    }

    // 统计
    const totalChars = items.reduce((sum, item) => sum + (item.original?.length || 0), 0);
    statsEl.textContent = `共 ${items.length} 条记录，累计翻译 ${totalChars.toLocaleString()} 字符`;

    listEl.innerHTML = items.map(item => `
    <div class="history-item" data-id="${item.id}">
      <div class="history-meta">
        <span class="history-time">${formatTime(item.timestamp)}</span>
        <a class="history-url" href="${item.url}" target="_blank">${new URL(item.url).hostname}</a>
        <button class="delete-btn" title="删除">&times;</button>
      </div>
      <div class="history-translated">${escapeHtml(item.translated)}</div>
      <div class="history-original">${escapeHtml(item.original)}</div>
    </div>
  `).join('');
}

// HTML 转义
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// 搜索过滤
function filterHistory(items, query) {
    if (!query) return items;
    const lower = query.toLowerCase();
    return items.filter(item =>
        (item.original?.toLowerCase().includes(lower)) ||
        (item.translated?.toLowerCase().includes(lower)) ||
        (item.url?.toLowerCase().includes(lower))
    );
}

// 初始化
let allItems = [];

async function init() {
    try {
        await initDB();
        allItems = await getAllHistory();
        renderHistory(allItems);

        // 搜索
        document.getElementById('searchInput').addEventListener('input', (e) => {
            const filtered = filterHistory(allItems, e.target.value);
            renderHistory(filtered);
        });

        // 清空
        document.getElementById('clearBtn').addEventListener('click', async () => {
            if (confirm('确定要清空所有翻译历史吗？')) {
                await clearAll();
                allItems = [];
                renderHistory([]);
            }
        });

        // 删除单条
        document.getElementById('historyList').addEventListener('click', async (e) => {
            if (e.target.classList.contains('delete-btn')) {
                const item = e.target.closest('.history-item');
                const id = parseInt(item.dataset.id);
                await deleteItem(id);
                allItems = allItems.filter(i => i.id !== id);
                renderHistory(allItems);
            }
        });
    } catch (err) {
        console.error('初始化失败:', err);
    }
}

init();
