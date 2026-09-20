const DB_NAME = 'shiguang-archive';
const STORE = 'memories';
let selectedPhotos = [];
let pendingDeleteId = null;
let editingRecordId = null;
let draggedPhotoIndex = null;
let currentRecords = [];
let calendarCursor = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
let cinemaRecord = null;
let cinemaPhotoIndex = 0;
let cinemaTimer = null;
let installPrompt = null;
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

function formatDate(value, includeYear = false) {
  if (!value) return '';
  const parts = value.split('-').map(Number);
  return includeYear ? `${parts[0]}年${parts[1]}月${parts[2]}日` : `${parts[1]}月${parts[2]}日`;
}

function showToast(message) {
  const toast = $('#toast');
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove('show'), 2400);
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
const uploadPlaceholder = $('#uploadPlaceholder');
const photoPreviewGrid = $('#photoPreviewGrid');
const photoPickerActions = $('#photoPickerActions');

function resetMemoryForm() {
  form.reset();
  editingRecordId = null;
  selectedPhotos = [];
  $('#dateInput').value = new Date().toISOString().slice(0, 10);
  $('#memoryDialogTitle').textContent = '收藏一段生活';
  $('#memoryDialogHint').textContent = '文字和照片会进入你自己的档案空间。';
  $('#memorySaveButton span').textContent = '保存到我的档案';
  $('#formStatus').textContent = '';
  renderSelectedPhotos();
}

function openDialog(recordId = null) {
  resetMemoryForm();
  if (recordId) {
    const record = currentRecords.find((item) => item.id === recordId);
    if (!record) return;
    editingRecordId = record.id;
    selectedPhotos = [...photosFor(record)];
    $('#titleInput').value = record.title || record.story || '';
    $('#bodyInput').value = record.body || record.story || '';
    $('#dateInput').value = record.date || '';
    $('#locationInput').value = record.location || record.place || '';
    $('#moodInput').value = record.mood || '平静';
    $('#memoryDialogTitle').textContent = '整理这段回忆';
    $('#memoryDialogHint').textContent = '拖动照片调整顺序，第一张就是封面。';
    $('#memorySaveButton span').textContent = '保存本次整理';
    renderSelectedPhotos();
  }
  memoryDialog.showModal();
}

$('#openMemoryDialog').addEventListener('click', () => openDialog());
$('#openFirstMemory').addEventListener('click', () => openDialog());
$('#closeMemoryDialog').addEventListener('click', () => memoryDialog.close());

function renderSelectedPhotos() {
  const hasPhotos = selectedPhotos.length > 0;
  uploadPlaceholder.hidden = hasPhotos;
  photoPreviewGrid.hidden = !hasPhotos;
  photoPickerActions.hidden = !hasPhotos;
  $('#photoOrderTip').hidden = selectedPhotos.length < 2;
  $('#photoSelectionCount').textContent = `已选 ${selectedPhotos.length} 张`;
  photoPreviewGrid.innerHTML = selectedPhotos.map((src, index) => `
    <div class="photo-preview-item${index === 0 ? ' is-cover' : ''}" draggable="true" data-photo-index="${index}">
      <img src="${src}" alt="第 ${index + 1} 张照片预览">
      <span class="cover-label">${index === 0 ? '封面' : index + 1}</span>
      <div class="photo-order-controls">
        <button type="button" data-move-photo="left" data-index="${index}" aria-label="向前移动"${index === 0 ? ' disabled' : ''}>←</button>
        <button type="button" data-cover-photo="${index}" aria-label="设为封面" title="设为封面">★</button>
        <button type="button" data-move-photo="right" data-index="${index}" aria-label="向后移动"${index === selectedPhotos.length - 1 ? ' disabled' : ''}>→</button>
        <button type="button" data-remove-photo="${index}" aria-label="移除第 ${index + 1} 张照片">×</button>
      </div>
    </div>`).join('');
}

function movePhoto(from, to) {
  if (from === to || from < 0 || to < 0 || from >= selectedPhotos.length || to >= selectedPhotos.length) return;
  const [photo] = selectedPhotos.splice(from, 1);
  selectedPhotos.splice(to, 0, photo);
  renderSelectedPhotos();
}

photoPreviewGrid.addEventListener('click', (event) => {
  const removeButton = event.target.closest('[data-remove-photo]');
  const coverButton = event.target.closest('[data-cover-photo]');
  const moveButton = event.target.closest('[data-move-photo]');
  if (removeButton) {
    selectedPhotos.splice(Number(removeButton.dataset.removePhoto), 1);
    renderSelectedPhotos();
  } else if (coverButton) {
    movePhoto(Number(coverButton.dataset.coverPhoto), 0);
    showToast('已设为封面');
  } else if (moveButton) {
    const from = Number(moveButton.dataset.index);
    movePhoto(from, moveButton.dataset.movePhoto === 'left' ? from - 1 : from + 1);
  }
});

photoPreviewGrid.addEventListener('dragstart', (event) => {
  const item = event.target.closest('[data-photo-index]');
  if (!item) return;
  draggedPhotoIndex = Number(item.dataset.photoIndex);
  item.classList.add('dragging');
  event.dataTransfer.effectAllowed = 'move';
});
photoPreviewGrid.addEventListener('dragover', (event) => {
  const item = event.target.closest('[data-photo-index]');
  if (!item) return;
  event.preventDefault();
  photoPreviewGrid.querySelectorAll('.drag-over').forEach((node) => node.classList.remove('drag-over'));
  item.classList.add('drag-over');
});
photoPreviewGrid.addEventListener('drop', (event) => {
  const item = event.target.closest('[data-photo-index]');
  if (!item || draggedPhotoIndex === null) return;
  event.preventDefault();
  movePhoto(draggedPhotoIndex, Number(item.dataset.photoIndex));
  draggedPhotoIndex = null;
});
photoPreviewGrid.addEventListener('dragend', () => {
  draggedPhotoIndex = null;
  photoPreviewGrid.querySelectorAll('.dragging,.drag-over').forEach((node) => node.classList.remove('dragging', 'drag-over'));
});

$('#photoInput').addEventListener('change', async (event) => {
  const files = [...event.target.files];
  event.target.value = '';
  if (!files.length) return;
  const available = 12 - selectedPhotos.length;
  if (available <= 0) return showToast('每段记忆最多保存 12 张照片');
  const accepted = files.slice(0, available);
  const oversized = accepted.filter((file) => file.size > 8 * 1024 * 1024);
  const valid = accepted.filter((file) => file.size <= 8 * 1024 * 1024);
  if (oversized.length) showToast(`${oversized.length} 张照片超过 8MB，已跳过`);
  $('#formStatus').textContent = `正在整理 ${valid.length} 张照片…`;
  try {
    for (const file of valid) selectedPhotos.push(await compressImage(file));
    renderSelectedPhotos();
    $('#formStatus').textContent = selectedPhotos.length ? `已准备 ${selectedPhotos.length} 张照片` : '';
    if (files.length > available) showToast(`已达到 12 张上限，跳过 ${files.length - available} 张`);
  } catch {
    $('#formStatus').textContent = '部分照片暂时无法读取，请换一张试试。';
  }
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const existing = currentRecords.find((item) => item.id === editingRecordId);
  const record = {
    id: existing?.id || crypto.randomUUID(),
    createdAt: existing?.createdAt || Date.now(),
    updatedAt: Date.now(),
    title: $('#titleInput').value.trim(),
    body: $('#bodyInput').value.trim(),
    date: $('#dateInput').value,
    location: $('#locationInput').value.trim(),
    mood: $('#moodInput').value,
    photos: [...selectedPhotos]
  };
  try {
    await put(record);
    const edited = Boolean(existing);
    resetMemoryForm();
    memoryDialog.close();
    await render();
    showToast(edited ? '这段回忆已重新整理' : '记忆已私密保存');
  } catch {
    $('#formStatus').textContent = '保存失败，可能是浏览器存储空间已满。请先导出备份。';
  }
});

async function render() {
  currentRecords = (await getAll()).sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.createdAt || 0) - (a.createdAt || 0));
  $('#memoryCount').textContent = currentRecords.length;
  $('#photoCount').textContent = currentRecords.reduce((total, item) => total + photosFor(item).length, 0);
  $('#archiveSummary').textContent = currentRecords.length ? `已收藏 ${currentRecords.length} 段记忆` : '从第一段记忆开始';
  $('#archiveEmpty').hidden = currentRecords.length > 0;
  const grid = $('#archiveGrid');
  grid.hidden = currentRecords.length === 0;
  grid.innerHTML = currentRecords.map((item) => {
    const title = item.title || item.story || '生活的一页';
    const body = item.body || item.story || '';
    const location = item.location || item.place || '';
    const photos = photosFor(item);
    return `<article class="archive-card">
      ${photos.length ? renderGallery(photos, title, item.id) : `<button class="no-photo" data-play="${item.id}" type="button"><span>这一页没有照片，<br>文字替你记得。</span></button>`}
      <div class="archive-card-body">
        <div class="card-status"><span>仅自己可见</span><time>${formatDate(item.date)}${photos.length ? `<i class="photo-total">${photos.length} 张照片</i>` : ''}</time></div>
        <h3>${escapeHTML(title)}</h3><p>${escapeHTML(body)}</p>
        <div class="memory-meta">${location ? `<span>⌖ ${escapeHTML(location)}</span>` : ''}<span>☺ ${escapeHTML(item.mood || '平静')}</span></div>
        <div class="card-actions"><button class="play-action" data-play="${item.id}" type="button">▶ 回忆放映</button><button class="edit-action" data-edit="${item.id}" type="button">整理相册</button><button class="delete-action" data-delete="${item.id}" type="button">删除</button></div>
      </div>
    </article>`;
  }).join('');
  renderCalendar();
}

function photosFor(item) {
  if (Array.isArray(item.photos)) return item.photos.filter(Boolean);
  return item.photo ? [item.photo] : [];
}

function renderGallery(photos, title, id) {
  const visible = photos.slice(0, 4);
  const galleryClass = photos.length === 1 ? 'count-1' : photos.length === 2 ? 'count-2' : photos.length === 3 ? 'count-3' : 'count-many';
  return `<button class="memory-gallery ${galleryClass}" data-play="${id}" type="button" aria-label="播放${escapeHTML(title)}">${visible.map((src, index) => `<img src="${src}" alt="${escapeHTML(title)} · ${index + 1}">`).join('')}${photos.length > 4 ? `<span class="gallery-more">+${photos.length - 4}</span>` : ''}<span class="gallery-play">▶</span></button>`;
}

$('#archiveGrid').addEventListener('click', (event) => {
  const deleteButton = event.target.closest('[data-delete]');
  const editButton = event.target.closest('[data-edit]');
  const playButton = event.target.closest('[data-play]');
  if (deleteButton) {
    pendingDeleteId = deleteButton.dataset.delete;
    $('#deleteDialog').showModal();
  } else if (editButton) {
    openDialog(editButton.dataset.edit);
  } else if (playButton) {
    openCinema(playButton.dataset.play);
  }
});

$('#deleteDialog').addEventListener('close', async () => {
  if ($('#deleteDialog').returnValue === 'confirm' && pendingDeleteId) {
    await remove(pendingDeleteId);
    await render();
    showToast('这段记录已删除');
  }
  pendingDeleteId = null;
});

function openCinema(recordId) {
  cinemaRecord = currentRecords.find((item) => item.id === recordId);
  if (!cinemaRecord) return;
  cinemaPhotoIndex = 0;
  renderCinema();
  $('#cinemaDialog').showModal();
  startCinemaTimer();
}

function renderCinema() {
  const photos = photosFor(cinemaRecord);
  const hasPhotos = photos.length > 0;
  const image = $('#cinemaImage');
  image.hidden = !hasPhotos;
  if (hasPhotos) {
    image.src = photos[cinemaPhotoIndex];
    image.alt = `${cinemaRecord.title || '生活的一页'} · 第 ${cinemaPhotoIndex + 1} 张`;
  } else {
    image.removeAttribute('src');
  }
  $('#cinemaDialog').classList.toggle('text-only', !hasPhotos);
  $('#cinemaPrevious').hidden = photos.length < 2;
  $('#cinemaNext').hidden = photos.length < 2;
  $('#cinemaCounter').textContent = hasPhotos ? `${cinemaPhotoIndex + 1} / ${photos.length}` : '文字档案';
  $('#cinemaDate').textContent = formatDate(cinemaRecord.date, true);
  $('#cinemaTitle').textContent = cinemaRecord.title || cinemaRecord.story || '生活的一页';
  $('#cinemaBody').textContent = cinemaRecord.body || cinemaRecord.story || '这一刻没有留下文字，但它依然被好好收藏。';
  const meta = [cinemaRecord.location || cinemaRecord.place ? `⌖ ${cinemaRecord.location || cinemaRecord.place}` : '', cinemaRecord.mood ? `☺ ${cinemaRecord.mood}` : ''].filter(Boolean);
  $('#cinemaMeta').textContent = meta.join('　');
  $('#cinemaProgress').innerHTML = photos.map((_, index) => `<button type="button" data-cinema-photo="${index}" class="${index === cinemaPhotoIndex ? 'active' : ''}" aria-label="第 ${index + 1} 张"></button>`).join('');
}

function changeCinemaPhoto(step) {
  const photos = photosFor(cinemaRecord);
  if (photos.length < 2) return;
  cinemaPhotoIndex = (cinemaPhotoIndex + step + photos.length) % photos.length;
  renderCinema();
  startCinemaTimer();
}

function startCinemaTimer() {
  clearInterval(cinemaTimer);
  if (photosFor(cinemaRecord || {}).length > 1) cinemaTimer = setInterval(() => changeCinemaPhoto(1), 4800);
}

function closeCinema() {
  clearInterval(cinemaTimer);
  $('#cinemaDialog').close();
}

$('#cinemaPrevious').addEventListener('click', () => changeCinemaPhoto(-1));
$('#cinemaNext').addEventListener('click', () => changeCinemaPhoto(1));
$('#cinemaClose').addEventListener('click', closeCinema);
$('#cinemaProgress').addEventListener('click', (event) => {
  const dot = event.target.closest('[data-cinema-photo]');
  if (!dot) return;
  cinemaPhotoIndex = Number(dot.dataset.cinemaPhoto);
  renderCinema();
  startCinemaTimer();
});
$('#cinemaDialog').addEventListener('click', (event) => {
  if (event.target === $('#cinemaDialog')) closeCinema();
});
addEventListener('keydown', (event) => {
  if (!$('#cinemaDialog').open) return;
  if (event.key === 'ArrowLeft') changeCinemaPhoto(-1);
  if (event.key === 'ArrowRight') changeCinemaPhoto(1);
  if (event.key === 'Escape') clearInterval(cinemaTimer);
});

function renderCalendar() {
  const year = calendarCursor.getFullYear();
  const month = calendarCursor.getMonth();
  const firstWeekday = (new Date(year, month, 1).getDay() + 6) % 7;
  const days = new Date(year, month + 1, 0).getDate();
  const today = new Date().toISOString().slice(0, 10);
  $('#calendarMonth').textContent = `${year} 年 ${month + 1} 月`;
  const blanks = Array.from({ length: firstWeekday }, () => '<span class="calendar-blank" aria-hidden="true"></span>');
  const cells = Array.from({ length: days }, (_, index) => {
    const day = index + 1;
    const date = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const records = currentRecords.filter((item) => item.date === date);
    const cover = records.map((item) => photosFor(item)[0]).find(Boolean);
    return `<button class="calendar-day${records.length ? ' has-memory' : ''}${date === today ? ' is-today' : ''}" type="button" ${records.length ? `data-calendar-date="${date}"` : 'disabled'}>
      ${cover ? `<img src="${cover}" alt="">` : ''}<span class="day-number">${day}</span>${records.length ? `<span class="day-count">${records.length} 段</span>` : ''}
    </button>`;
  });
  $('#memoryCalendar').innerHTML = [...blanks, ...cells].join('');
}

function setArchiveView(view) {
  const calendar = view === 'calendar';
  $('.archive-section').hidden = calendar;
  $('#calendarSection').hidden = !calendar;
  $('#timelineViewButton').classList.toggle('active', !calendar);
  $('#calendarViewButton').classList.toggle('active', calendar);
  $('#timelineViewButton').setAttribute('aria-pressed', String(!calendar));
  $('#calendarViewButton').setAttribute('aria-pressed', String(calendar));
  if (calendar) renderCalendar();
}

$('#timelineViewButton').addEventListener('click', () => setArchiveView('timeline'));
$('#calendarViewButton').addEventListener('click', () => setArchiveView('calendar'));
$('#calendarPrevious').addEventListener('click', () => {
  calendarCursor = new Date(calendarCursor.getFullYear(), calendarCursor.getMonth() - 1, 1);
  renderCalendar();
});
$('#calendarNext').addEventListener('click', () => {
  calendarCursor = new Date(calendarCursor.getFullYear(), calendarCursor.getMonth() + 1, 1);
  renderCalendar();
});
$('#memoryCalendar').addEventListener('click', (event) => {
  const day = event.target.closest('[data-calendar-date]');
  if (!day) return;
  const record = currentRecords.find((item) => item.date === day.dataset.calendarDate);
  if (record) openCinema(record.id);
});

$('#exportButton').addEventListener('click', async () => {
  const records = await getAll();
  const blob = new Blob([JSON.stringify({ version: 3, exportedAt: new Date().toISOString(), records }, null, 2)], { type: 'application/json' });
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

const installButton = $('#installAppButton');
if (!matchMedia('(display-mode: standalone)').matches) installButton.hidden = false;
addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  installPrompt = event;
  installButton.hidden = false;
});
installButton.addEventListener('click', async () => {
  if (!installPrompt) {
    showToast('请在浏览器菜单中选择“添加到主屏幕”');
    return;
  }
  installPrompt.prompt();
  const choice = await installPrompt.userChoice;
  if (choice.outcome === 'accepted') installButton.hidden = true;
  installPrompt = null;
});
addEventListener('appinstalled', () => {
  installButton.hidden = true;
  showToast('拾光档案馆已安装到桌面');
});

if ('serviceWorker' in navigator) addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));

resetMemoryForm();
route();
