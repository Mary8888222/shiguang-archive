const DB_NAME = 'shiguang-archive';
const STORE = 'memories';
let selectedPhoto = '';
let pendingDeleteId = null;
const $ = (selector) => document.querySelector(selector);

function route() {
  const studio = location.hash === '#studio';
  $('#welcomeView').hidden = studio;
  $('#studioView').hidden = !studio;
  document.body.style.overflow = '';
  scrollTo({ top: 0, behavior: 'instant' });
  if (studio) render();
}
addEventListener('hashchange', route);

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
  if (!value) return '';
  const parts = value.split('-');
  return `${Number(parts[1])}月${Number(parts[2])}日`;
}

function showToast(message) {
  const toast = $('#toast');
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove('show'), 2200);
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

const memoryDialog = $('#memoryDialog');
const form = $('#memoryForm');
const photoPreview = $('#photoPreview');
const uploadPlaceholder = $('#uploadPlaceholder');
$('#dateInput').value = new Date().toISOString().slice(0, 10);

function openDialog() {
  $('#formStatus').textContent = '';
  memoryDialog.showModal();
}
$('#openMemoryDialog').addEventListener('click', openDialog);
$('#openFirstMemory').addEventListener('click', openDialog);
$('#closeMemoryDialog').addEventListener('click', () => memoryDialog.close());

$('#photoInput').addEventListener('change', async (event) => {
  const file = event.target.files[0];
  if (!file) return;
  if (file.size > 8 * 1024 * 1024) {
    $('#formStatus').textContent = '图片不能超过 8MB。';
    event.target.value = '';
    return;
  }
  $('#formStatus').textContent = '正在整理照片…';
  try {
    selectedPhoto = await compressImage(file);
    photoPreview.src = selectedPhoto;
    photoPreview.hidden = false;
    uploadPlaceholder.hidden = true;
    $('#formStatus').textContent = '';
  } catch {
    $('#formStatus').textContent = '这张照片暂时无法读取，请换一张试试。';
  }
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const record = {
    id: crypto.randomUUID(),
    createdAt: Date.now(),
    title: $('#titleInput').value.trim(),
    body: $('#bodyInput').value.trim(),
    date: $('#dateInput').value,
    location: $('#locationInput').value.trim(),
    mood: $('#moodInput').value,
    photo: selectedPhoto
  };
  try {
    await put(record);
    form.reset();
    $('#dateInput').value = new Date().toISOString().slice(0, 10);
    selectedPhoto = '';
    photoPreview.hidden = true;
    photoPreview.removeAttribute('src');
    uploadPlaceholder.hidden = false;
    memoryDialog.close();
    await render();
    showToast('记忆已私密保存');
  } catch {
    $('#formStatus').textContent = '保存失败，可能是浏览器存储空间已满。请先导出备份。';
  }
});

async function render() {
  const records = (await getAll()).sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.createdAt || 0) - (a.createdAt || 0));
  $('#memoryCount').textContent = records.length;
  $('#photoCount').textContent = records.filter((item) => item.photo).length;
  $('#archiveSummary').textContent = records.length ? `已收藏 ${records.length} 段记忆` : '从第一段记忆开始';
  $('#archiveEmpty').hidden = records.length > 0;
  const grid = $('#archiveGrid');
  grid.hidden = records.length === 0;
  grid.innerHTML = records.map((item) => {
    const title = item.title || item.story || '生活的一页';
    const body = item.body || item.story || '';
    const location = item.location || item.place || '';
    return `<article class="archive-card">
      ${item.photo ? `<figure><img src="${item.photo}" alt="${escapeHTML(title)}"></figure>` : '<div class="no-photo"><span>这一页没有照片，<br>文字替你记得。</span></div>'}
      <div class="archive-card-body">
        <div class="card-status"><span>仅自己可见</span><time>${formatDate(item.date)}</time></div>
        <h3>${escapeHTML(title)}</h3><p>${escapeHTML(body)}</p>
        <div class="memory-meta">${location ? `<span>⌖ ${escapeHTML(location)}</span>` : ''}<span>☺ ${escapeHTML(item.mood || '平静')}</span></div>
        <div class="card-actions"><button class="delete-action" data-delete="${item.id}" type="button">删除</button></div>
      </div>
    </article>`;
  }).join('');
}

$('#archiveGrid').addEventListener('click', (event) => {
  const button = event.target.closest('[data-delete]');
  if (!button) return;
  pendingDeleteId = button.dataset.delete;
  $('#deleteDialog').showModal();
});

$('#deleteDialog').addEventListener('close', async () => {
  if ($('#deleteDialog').returnValue === 'confirm' && pendingDeleteId) {
    await remove(pendingDeleteId);
    await render();
    showToast('这段记录已删除');
  }
  pendingDeleteId = null;
});

$('#exportButton').addEventListener('click', async () => {
  const records = await getAll();
  const blob = new Blob([JSON.stringify({ version: 2, exportedAt: new Date().toISOString(), records }, null, 2)], { type: 'application/json' });
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
    showToast('备份已导入');
  } catch {
    showToast('这不是有效的备份文件');
  } finally {
    event.target.value = '';
  }
});

route();
