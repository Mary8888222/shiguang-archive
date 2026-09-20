const DB_NAME = 'shiguang-archive';
const STORE = 'memories';
let selectedPhoto = '';
let pendingDeleteId = null;

const $ = (selector) => document.querySelector(selector);
const form = $('#entryForm');
const photoInput = $('#photoInput');
const photoPreview = $('#photoPreview');
const uploadPlaceholder = $('#uploadPlaceholder');
const storyInput = $('#storyInput');
const dateInput = $('#dateInput');
const timeline = $('#timeline');
const emptyState = $('#emptyState');
const recordCount = $('#recordCount');
const searchInput = $('#searchInput');
const deleteDialog = $('#deleteDialog');

dateInput.value = new Date().toISOString().slice(0, 10);

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore(mode, action) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const request = action(tx.objectStore(STORE));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => db.close();
  });
}

const getAll = () => withStore('readonly', (store) => store.getAll());
const put = (record) => withStore('readwrite', (store) => store.put(record));
const remove = (id) => withStore('readwrite', (store) => store.delete(id));

function escapeHTML(text = '') {
  const node = document.createElement('div');
  node.textContent = text;
  return node.innerHTML;
}

function formatDate(value) {
  return new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' }).format(new Date(`${value}T00:00:00`));
}

function compressImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => {
      const image = new Image();
      image.onerror = reject;
      image.onload = () => {
        const maxSide = 1600;
        const scale = Math.min(1, maxSide / Math.max(image.width, image.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(image.width * scale);
        canvas.height = Math.round(image.height * scale);
        canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', .82));
      };
      image.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

photoInput.addEventListener('change', async () => {
  const file = photoInput.files[0];
  if (!file) return;
  $('#formNote').textContent = '正在整理照片…';
  try {
    selectedPhoto = await compressImage(file);
    photoPreview.src = selectedPhoto;
    photoPreview.hidden = false;
    uploadPlaceholder.hidden = true;
    $('#formNote').textContent = '';
  } catch {
    $('#formNote').textContent = '这张照片暂时无法读取，请换一张试试。';
  }
});

storyInput.addEventListener('input', () => $('#storyCount').value = storyInput.value.length);

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const record = {
    id: crypto.randomUUID(),
    createdAt: Date.now(),
    date: dateInput.value,
    mood: $('#moodInput').value,
    place: $('#placeInput').value.trim(),
    story: storyInput.value.trim(),
    photo: selectedPhoto
  };
  try {
    await put(record);
    form.reset();
    dateInput.value = new Date().toISOString().slice(0, 10);
    selectedPhoto = '';
    photoPreview.hidden = true;
    photoPreview.removeAttribute('src');
    uploadPlaceholder.hidden = false;
    $('#storyCount').value = 0;
    $('#formNote').textContent = '已经收藏进你的档案馆。';
    setTimeout(() => $('#formNote').textContent = '', 2200);
    await render();
  } catch {
    $('#formNote').textContent = '保存失败，可能是浏览器存储空间已满。请先导出备份。';
  }
});

async function render() {
  const query = searchInput.value.trim().toLowerCase();
  const records = (await getAll()).sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
  const filtered = records.filter((item) => `${item.story} ${item.place} ${item.mood}`.toLowerCase().includes(query));
  recordCount.value = records.length;
  emptyState.hidden = filtered.length > 0;
  timeline.innerHTML = filtered.map((item) => `
    <article class="memory-card">
      ${item.photo ? `<img class="memory-image" src="${item.photo}" alt="${escapeHTML(item.story.slice(0, 28) || '生活记录照片')}">` : '<div class="no-photo">✿</div>'}
      <div class="memory-body">
        <div class="memory-meta"><span>${formatDate(item.date)}</span><span>${escapeHTML(item.mood)}</span></div>
        <p class="memory-story">${escapeHTML(item.story)}</p>
        <div class="memory-footer"><span>${item.place ? `⌖ ${escapeHTML(item.place)}` : '未记录地点'}</span><button class="delete-button" data-delete="${item.id}" type="button" aria-label="删除这条记录">删除</button></div>
      </div>
    </article>`).join('');
}

searchInput.addEventListener('input', render);
timeline.addEventListener('click', (event) => {
  const button = event.target.closest('[data-delete]');
  if (!button) return;
  pendingDeleteId = button.dataset.delete;
  deleteDialog.showModal();
});

deleteDialog.addEventListener('close', async () => {
  if (deleteDialog.returnValue === 'confirm' && pendingDeleteId) {
    await remove(pendingDeleteId);
    await render();
  }
  pendingDeleteId = null;
});

$('#exportButton').addEventListener('click', async () => {
  const records = await getAll();
  const blob = new Blob([JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), records }, null, 2)], { type: 'application/json' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `拾光档案馆备份-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(link.href);
});

$('#importInput').addEventListener('change', async (event) => {
  const file = event.target.files[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!Array.isArray(data.records)) throw new Error('invalid');
    for (const record of data.records) await put(record);
    await render();
  } catch {
    alert('这不是有效的拾光档案馆备份文件。');
  } finally {
    event.target.value = '';
  }
});

render();
