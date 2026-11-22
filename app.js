'use strict';

/* ============ 常數 ============ */
const MAX_BOOKS = 400;
const APP_VERSION = 'v2.0';

const COLLECTIONS = [
  '兒童繪本-中文',
  '大圖書',
  '教師參考書',
  '宗教圖書',
  '兒童繪本-英文',
  '生活資訊-生命科學',
  '生活資訊-物理科學',
  '生活資訊-地球和太空科學',
  '生活資訊-藝術',
  '生活資訊-烹飪',
  '生活資訊-文化',
  '生活資訊-其他',
];

const STATUS_LABEL = { draft: '草稿', review: '待校對', confirmed: '已核對' };

const HEADERS = [
  '資源分類(最多10位中英文字符)*',
  '館藏分類(最多20位中英文字符)*',
  '條碼(最多20位字符)*',
  '書名(最多30位中英文字符)*',
  '作者(最多20位中英文字符)*',
  '編號/索書號(最多20位中英文字符)*',
  '出版社(最多20位中英文字符)',
  '經費來源(最多20位中英文字符)',
  '價錢(最多10位字符)',
  '書本語言(最多20位中英文字符)',
  '關鍵字(最多20位中英文字符)',
];
const COLS = [15.71, 16, 22.36, 30.36, 29.36, 16.07, 31.86, 33.36, 21.21, 33.36, 31.07, 9.57];

const DB_NAME = 'kinder-library';
const DB_VER = 1;

/* ============ 設定 / 額度 ============ */
const SETTINGS_KEY = 'lib.settings.v2';
const USAGE_KEY = 'lib.usage.v2';
const DEFAULT_SETTINGS = {
  provider: 'vision',
  limit: 950,
  keys: { vision: '', ocrspace: '' },
  ai: { url: 'https://openrouter.ai/api/v1', key: '', model: '' },
};
const PROVIDERS = {
  vision: { label: 'Google Cloud Vision', limit: 950, period: 'month' },
  ocrspace: { label: 'OCR.space', limit: 500, period: 'day' },
};

let settings = loadSettings();

function loadSettings() {
  try {
    const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
    return {
      ...DEFAULT_SETTINGS,
      ...s,
      limit: Math.max(50, Math.min(950, Number(s.limit) || DEFAULT_SETTINGS.limit)),
      keys: { ...DEFAULT_SETTINGS.keys, ...(s.keys || {}) },
      ai: { ...DEFAULT_SETTINGS.ai, ...(s.ai || {}) },
    };
  } catch (e) {
    return {
      provider: DEFAULT_SETTINGS.provider,
      limit: DEFAULT_SETTINGS.limit,
      keys: { ...DEFAULT_SETTINGS.keys },
      ai: { ...DEFAULT_SETTINGS.ai },
    };
  }
}

function saveSettings() {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch (e) { /* ignore */ }
}

function currentProvider() {
  return settings.provider === 'ocrspace' ? 'ocrspace' : 'vision';
}

function currentKey() {
  return String(settings.keys[currentProvider()] || '').trim();
}

function periodKey(kind) {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return kind === 'day'
    ? `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
    : `${d.getFullYear()}-${p(d.getMonth() + 1)}`;
}

function loadUsageAll() {
  try { return JSON.parse(localStorage.getItem(USAGE_KEY) || '{}'); } catch (e) { return {}; }
}

function getUsage() {
  const prov = currentProvider();
  const def = PROVIDERS[prov];
  const pk = periodKey(def.period);
  const all = loadUsageAll();
  const u = all[prov];
  if (!u || u.period !== pk) return { period: pk, count: 0 };
  return u;
}

function saveUsage(u) {
  const all = loadUsageAll();
  all[currentProvider()] = u;
  try { localStorage.setItem(USAGE_KEY, JSON.stringify(all)); } catch (e) { /* ignore */ }
}

function limitFor() {
  if (currentProvider() !== 'vision') return PROVIDERS.ocrspace.limit;
  return Math.max(50, Math.min(950, Number(settings.limit) || 950));
}

function quotaLeft() {
  return Math.max(0, limitFor() - getUsage().count);
}

function incUsage() {
  const u = getUsage();
  u.count += 1;
  saveUsage(u);
  renderUsage();
}

function usageLabel() {
  const prov = currentProvider();
  const def = PROVIDERS[prov];
  const u = getUsage();
  const when = def.period === 'day' ? '今日' : '本月';
  return `${def.label}：${when}已用 ${u.count} / ${limitFor()}（${def.period === 'day' ? '每日' : '每月'}重置）`;
}

function renderUsage() {
  const el1 = $('#set-usage');
  if (el1) el1.textContent = usageLabel();
  renderKeyNotice();
}

function renderKeyNotice() {
  const box = $('#key-notice');
  if (!box) return;
  const hasKey = !!currentKey();
  const left = quotaLeft();
  if (hasKey && left > 0) {
    box.classList.add('hidden');
    return;
  }
  const def = PROVIDERS[currentProvider()];
  $('#key-notice-text').textContent = hasKey
    ? `${def.label} ${def.period === 'day' ? '今日' : '本月'}額度已用完（${limitFor()} 張），已停止辨識。`
    : '尚未設定辨識服務，暫時不能辨識。';
  box.classList.remove('hidden');
}

function showKeyDialog() {
  showModal({
    title: '需要設定辨識服務',
    body: '<p>請先到「更多 → 辨識服務」貼上 API key（每部手機一次）。</p>',
    actions: [
      { label: '前往設定', kind: 'primary', onClick: () => { hideModal(); switchView('more'); } },
      { label: '稍後', kind: 'ghost' },
    ],
  });
}

function showQuotaDialog() {
  const prov = currentProvider();
  const def = PROVIDERS[prov];
  const when = def.period === 'day' ? '今日' : '本月';
  const reset = def.period === 'day' ? '明日' : '下月 1 日';
  showModal({
    title: `${when}辨識額度已用完`,
    body: `<p>${def.label} 已達 <strong>${limitFor()} 張</strong>上限，為確保不會產生額外費用，已停止雲端辨識。</p>` +
      `<p>額度會在${reset}自動重置。已儲存的相片仍會保留，屆時可在卡片內按「重新辨識」。</p>`,
    actions: [
      { label: '去匯出 Excel', kind: 'primary', onClick: () => { hideModal(); switchView('more'); } },
      { label: '知道了', kind: 'ghost' },
    ],
  });
}

/* ============ 小工具 ============ */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

function fmtTime(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function fmtDateShort(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

let toastTimer = null;
function toast(msg, ms = 2600) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), ms);
}

function showModal({ title, body, actions }) {
  $('#modal-title').textContent = title;
  const bodyEl = $('#modal-body');
  bodyEl.innerHTML = '';
  if (typeof body === 'string') bodyEl.innerHTML = body;
  else if (body) bodyEl.appendChild(body);

  const box = $('#modal-actions');
  box.innerHTML = '';
  (actions || [{ label: '知道了' }]).forEach((a) => {
    const b = el('button', 'btn ' + (a.kind || ''), a.label);
    b.addEventListener('click', async () => {
      if (a.onClick) {
        const keep = await a.onClick();
        if (keep === false) return;
      }
      hideModal();
    });
    box.appendChild(b);
  });
  $('#modal').classList.remove('hidden');
}
function hideModal() {
  $('#modal').classList.add('hidden');
}

/* ============ IndexedDB ============ */
let dbPromise = null;

function db() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VER);
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains('books')) {
          const s = d.createObjectStore('books', { keyPath: 'id', autoIncrement: true });
          s.createIndex('status', 'status');
        }
        if (!d.objectStoreNames.contains('images')) {
          d.createObjectStore('images', { keyPath: 'id', autoIncrement: true });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

function reqP(req) {
  return new Promise((res, rej) => {
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}

async function dbGetAll(store) {
  const d = await db();
  return reqP(d.transaction(store, 'readonly').objectStore(store).getAll());
}
async function dbGet(store, key) {
  const d = await db();
  return reqP(d.transaction(store, 'readonly').objectStore(store).get(key));
}
async function dbPut(store, value) {
  const d = await db();
  return reqP(d.transaction(store, 'readwrite').objectStore(store).put(value));
}
async function dbAdd(store, value) {
  const d = await db();
  return reqP(d.transaction(store, 'readwrite').objectStore(store).add(value));
}
async function dbDelete(store, key) {
  const d = await db();
  return reqP(d.transaction(store, 'readwrite').objectStore(store).delete(key));
}
async function dbClear(store) {
  const d = await db();
  return reqP(d.transaction(store, 'readwrite').objectStore(store).clear());
}

/* ============ 狀態 ============ */
const state = {
  books: [],
  view: 'capture',
  queue: [],
  processing: false,
  editing: null,
  editingDirty: false,
  saveTimer: null,
  fullUrl: null,
};

const thumbUrls = new Map();

/* ============ 容量 ============ */
function capacityFull() {
  return state.books.length >= MAX_BOOKS;
}

function fullDialog() {
  showModal({
    title: '儲存量已滿（400 / 400）',
    body: '<p>每部手機最多儲存 <strong>400 條</strong>圖書資料，不能再新增。</p>' +
      '<p>請先按「匯出 Excel」，把已核對的資料存好，再按「全部清除」開始新一批。</p>',
    actions: [
      { label: '去匯出 Excel', kind: 'primary', onClick: () => { hideModal(); switchView('more'); } },
      { label: '已匯出，立即全部清除', kind: '', onClick: async () => { hideModal(); await clearAllFlow(); } },
      { label: '稍後處理', kind: 'ghost' },
    ],
  });
}

/* ============ 圖片處理 ============ */
function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve({ img, url });
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('無法讀取相片')); };
    img.src = url;
  });
}

function drawToBlob(img, maxSide, quality) {
  const w0 = img.naturalWidth || img.width;
  const h0 = img.naturalHeight || img.height;
  const scale = Math.min(1, maxSide / Math.max(w0, h0));
  const w = Math.max(1, Math.round(w0 * scale));
  const h = Math.max(1, Math.round(h0 * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);
  return new Promise((resolve) => {
    canvas.toBlob((b) => resolve(b), 'image/jpeg', quality);
  });
}

async function makeImages(file) {
  const { img, url } = await loadImage(file);
  try {
    if (!img.naturalWidth) throw new Error('無法讀取相片');
    const full = await drawToBlob(img, 1600, 0.8);
    const thumb = await drawToBlob(img, 420, 0.72);
    return { full, thumb };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/* ============ 匯入與佇列 ============ */
async function addFiles(fileList) {
  const files = Array.from(fileList || []).filter((f) => f && f.type.startsWith('image/'));
  if (!files.length) return;

  if (!currentKey()) { showKeyDialog(); return; }
  if (quotaLeft() <= 0) { showQuotaDialog(); return; }

  const used = state.books.length + state.queue.filter((q) => q.state !== 'error').length;
  let room = MAX_BOOKS - used;

  if (room <= 0) { fullDialog(); return; }

  let accepted = files;
  if (files.length > room) {
    accepted = files.slice(0, room);
    toast(`只餘 ${room} 個名額，已略過其餘 ${files.length - room} 張相片`);
  }

  accepted.forEach((file, i) => {
    state.queue.push({
      key: `q${Date.now()}_${i}_${Math.random().toString(36).slice(2, 7)}`,
      file,
      name: file.name || `相片 ${i + 1}`,
      state: 'wait',
      progress: 0,
      message: '等待辨識',
    });
  });

  renderQueue();
  processQueue();
}

async function processQueue() {
  if (state.processing) return;
  state.processing = true;
  try {
    while (state.queue.length) {
      const job = state.queue.find((q) => q.state === 'wait');
      if (!job) break;
      await runJob(job);
      const idx = state.queue.indexOf(job);
      if (idx >= 0) state.queue.splice(idx, 1);
      renderQueue();
    }
  } finally {
    state.processing = false;
    setEngine('ready', '辨識引擎：就緒');
  }
}

function ocrErrorMessage(err) {
  const msg = String((err && err.message) || '');
  const st = err && err.status;
  if (st === 401 || st === 403 || /API key|invalid|permission|unauthor|not authorized/i.test(msg)) {
    return 'API key 無效或未啟用 API';
  }
  if (/billing|disabled|has not been used/i.test(msg)) return 'API 未啟用或帳單未設定';
  if (st === 429 || /quota|rate limit|too many/i.test(msg)) return '雲端額度或頻率已達上限';
  if (/逾時|timeout|abort/i.test(msg)) return '辨識逾時，請重試';
  return '辨識失敗：' + (msg.slice(0, 70) || '未知錯誤');
}

async function runJob(job) {
  job.state = 'working';
  job.progress = 0;
  job.message = '整理相片中…';
  renderQueue();

  let book = null;
  try {
    if (state.books.length >= MAX_BOOKS) {
      job.state = 'error';
      job.message = '儲存量已滿，未加入';
      renderQueue();
      fullDialog();
      return;
    }

    if (!currentKey()) {
      job.state = 'error';
      job.message = '未設定 API key';
      renderQueue();
      showKeyDialog();
      return;
    }

    if (quotaLeft() <= 0) {
      job.state = 'error';
      job.message = '辨識額度已用完';
      renderQueue();
      showQuotaDialog();
      return;
    }

    const { full, thumb } = await makeImages(job.file);
    job.file = null;

    const imageId = await dbAdd('images', { blob: full, thumb });
    const now = Date.now();
    book = {
      createdAt: now,
      updatedAt: now,
      status: 'draft',
      collection: '',
      barcode: '',
      title: '',
      author: '',
      publisher: '',
      callLetter: '',
      language: '',
      ocrText: '',
      ocrConfidence: 0,
      imageId,
      version: 2,
    };
    book.id = await dbAdd('books', book);
    state.books.unshift(book);
    renderAll();

    job.message = '上傳雲端辨識中…';
    renderQueue();
    setEngine('busy', '辨識中 | ' + job.name);

    incUsage();
    const provider = currentProvider();
    const result = await window.OCRCloud.recognize(provider, full, currentKey());
    const fields = window.OCRCloud.parseFields(result.text, result.words, result.confidence);

    const aiPick = await aiClassify(fields, result.text);
    if (aiPick) {
      fields.collection = aiPick;
      fields.callLetter = window.OCRCloud.suggestCallLetter(aiPick, fields.language, fields.author);
    }

    book.ocrText = result.text || '';
    book.ocrConfidence = result.confidence || 0;
    book.collection = fields.collection || '';
    book.barcode = fields.barcode || '';
    book.title = fields.title || '';
    book.author = fields.author || '';
    book.publisher = fields.publisher || '';
    book.language = fields.language || '';
    book.callLetter = fields.callLetter || '';
    book.status = 'review';
    book.updatedAt = Date.now();
    await dbPut('books', book);

    job.state = 'done';
    job.progress = 100;
    job.message = '已加入待校對';
  } catch (err) {
    console.error('OCR 失敗', err);
    const msg = ocrErrorMessage(err);
    job.state = 'error';
    job.message = msg;
    if (book) {
      book.status = 'draft';
      book.ocrError = msg;
      book.updatedAt = Date.now();
      try { await dbPut('books', book); } catch (e) { /* ignore */ }
    }
    setEngine('err', '辨識發生錯誤');
    toast(msg + '（可在卡片內按「重新辨識」）', 4200);
    renderKeyNotice();
  } finally {
    await new Promise((r) => setTimeout(r, 350));
    renderAll();
  }
}
function setEngine(kind, text) {
  const dot = $('#engine-dot');
  dot.className = 'dot ' + (kind === 'busy' ? 'busy' : kind === 'ready' ? 'ready' : kind === 'err' ? 'err' : '');
  $('#engine-text').textContent = text;
}

function renderQueue() {
  const wrap = $('#queue');
  wrap.innerHTML = '';
  const active = state.queue.filter((q) => q.state !== 'done');
  $('#queue-count').textContent = active.length ? `${active.length} 張處理中` : '';

  if (!state.queue.length) {
    wrap.classList.add('hidden');
    $('#queue-head').classList.add('hidden');
    return;
  }
  wrap.classList.remove('hidden');
  $('#queue-head').classList.remove('hidden');

  state.queue.slice(0, 12).forEach((job) => {
    const item = el('div', 'qitem');
    const body = el('div', 'q-body');
    const name = el('div', 'q-name', job.name);
    const st = el('div', 'q-state' + (job.state === 'error' ? ' err' : job.state === 'done' ? ' ok' : ''), job.message);
    const bar = el('div', 'bar');
    const fill = el('i');
    fill.style.width = (job.progress || 0) + '%';
    bar.appendChild(fill);
    body.append(name, st, bar);
    item.appendChild(body);
    wrap.appendChild(item);
  });
}

/* ============ 雲端 OCR 呼叫 ============ */
function normalizeIsbn(s) { return window.OCRCloud.normalizeIsbn(s); }
function isbn13Valid(s) { return window.OCRCloud.isbn13Valid(s); }
function isbn10Valid(s) { return window.OCRCloud.isbn10Valid(s); }
function suggestCallLetter(c, l, a) { return window.OCRCloud.suggestCallLetter(c, l, a); }
function detectLanguage(t, a, all) { return window.OCRCloud.detectLanguage(t, a, all); }

function tidy(s) {
  return String(s || '')
    .replace(/\u3000/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function aiClassify(fields, text) {
  const ai = settings.ai || {};
  if (!ai.url || !ai.key || !ai.model) return '';
  const cats = window.OCRCloud.COLLECTIONS.join('、');
  const prompt = [
    '你是幼稚園圖書館的分類助手。根據版權頁資料，從下列類別選出最合適的一個：',
    cats,
    '規則：宗教書優先「宗教圖書」；教師用書／教學法優先「教師參考書」；其他中文繪本用「兒童繪本-中文」，英文繪本用「兒童繪本-英文」；知識類用「生活資訊-…」。',
    '只輸出 JSON：{"collection":"類別"}',
    '書名：' + (fields.title || ''),
    '作者：' + (fields.author || ''),
    '出版社：' + (fields.publisher || ''),
    '文字：' + String(text || '').slice(0, 1500),
  ].join('\n');

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch(ai.url.replace(/\/+$/, '') + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + ai.key },
      body: JSON.stringify({
        model: ai.model,
        temperature: 0,
        messages: [{ role: 'user', content: prompt }],
        response_format: { type: 'json_object' },
      }),
      signal: ctrl.signal,
    });
    if (!res.ok) return '';
    const data = await res.json();
    const content = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    const m = String(content || '').match(/\{[\s\S]*\}/);
    if (!m) return '';
    const obj = JSON.parse(m[0]);
    return window.OCRCloud.COLLECTIONS.indexOf(obj.collection) >= 0 ? obj.collection : '';
  } catch (e) {
    return '';
  } finally {
    clearTimeout(timer);
  }
}
/* ============ 畫面：清單 ============ */
async function thumbSrc(imageId) {
  if (!imageId) return '';
  if (thumbUrls.has(imageId)) return thumbUrls.get(imageId);
  try {
    const rec = await dbGet('images', imageId);
    if (!rec) return '';
    const url = URL.createObjectURL(rec.thumb || rec.blob);
    thumbUrls.set(imageId, url);
    return url;
  } catch (e) {
    return '';
  }
}

function bookCard(book) {
  const card = el('div', 'book');
  card.dataset.id = book.id;

  const img = el('img');
  img.alt = '';
  img.loading = 'lazy';

  const body = el('div', 'b-body');
  const title = el('div', 'b-title', book.title || '（未填書名）');

  const metaBits = [];
  if (book.barcode) metaBits.push(`ISBN ${book.barcode}`);
  if (book.publisher) metaBits.push(book.publisher);
  const meta = el('div', 'b-meta', metaBits.join(' · ') || '未有資料');

  const tags = el('div', 'b-tags');
  if (book.collection) tags.appendChild(el('span', 'tag cat', book.collection));
  if (book.status === 'draft') tags.appendChild(el('span', 'tag draft', '草稿'));
  if (book.status === 'review') tags.appendChild(el('span', 'tag warn', '待校對'));
  if (book.status === 'confirmed') tags.appendChild(el('span', 'tag', '已核對'));
  if (isDuplicateBarcode(book)) tags.appendChild(el('span', 'tag warn', 'ISBN 重複'));
  const time = el('span', 'tag', fmtDateShort(book.updatedAt));
  tags.appendChild(time);

  body.append(title, meta, tags);
  const letter = el('div', 'b-letter', book.callLetter || '?');

  card.append(img, body, letter);
  card.addEventListener('click', () => openEditor(book.id));

  thumbSrc(book.imageId).then((src) => { if (src) img.src = src; });
  return card;
}

function isDuplicateBarcode(book) {
  if (!book.barcode) return false;
  return state.books.some((b) => b.id !== book.id && b.barcode && b.barcode === book.barcode && b.status !== 'draft');
}

function renderLists() {
  const review = state.books
    .filter((b) => b.status === 'draft' || b.status === 'review')
    .sort((a, b) => b.updatedAt - a.updatedAt);
  const confirmed = state.books
    .filter((b) => b.status === 'confirmed')
    .sort((a, b) => b.updatedAt - a.updatedAt);

  const rl = $('#review-list');
  rl.innerHTML = '';
  if (!review.length) {
    rl.appendChild(el('div', 'empty', '暫無待校對資料。到「拍攝」加入版權頁相片。'));
  } else {
    review.forEach((b) => rl.appendChild(bookCard(b)));
  }

  const cl = $('#confirmed-list');
  cl.innerHTML = '';
  if (!confirmed.length) {
    cl.appendChild(el('div', 'empty', '未有已核對資料。'));
  } else {
    confirmed.forEach((b) => cl.appendChild(bookCard(b)));
  }

  $('#review-count').textContent = review.length;
  $('#confirmed-count').textContent = confirmed.length;

  const badge = $('#tab-badge');
  const pending = review.length;
  badge.textContent = pending > 99 ? '99+' : String(pending);
  badge.classList.toggle('hidden', pending === 0);

  const btn = $('#btn-export');
  btn.textContent = `匯出 Excel（${confirmed.length} 筆）`;
}

function renderCounter() {
  const c = $('#counter');
  c.textContent = `${state.books.length} / ${MAX_BOOKS}`;
  c.classList.toggle('full', state.books.length >= MAX_BOOKS);

  const fill = $('#storage-fill');
  const pct = Math.min(100, (state.books.length / MAX_BOOKS) * 100);
  fill.style.width = pct + '%';
  fill.className = pct >= 100 ? 'full' : pct >= 80 ? 'warn' : '';
  $('#storage-text').textContent = `已使用 ${state.books.length} / ${MAX_BOOKS} 條`;
}

async function renderStorageSize() {
  try {
    if (navigator.storage && navigator.storage.estimate) {
      const est = await navigator.storage.estimate();
      const mb = (n) => (n / 1024 / 1024).toFixed(1) + ' MB';
      $('#storage-size').textContent = `相片及資料約佔 ${mb(est.usage || 0)}（瀏覽器配額 ${mb(est.quota || 0)}）`;
    }
  } catch (e) { /* ignore */ }
}

function renderAll() {
  renderCounter();
  renderLists();
  renderStorageSize();
}

/* ============ 分頁 ============ */
function switchView(name) {
  state.view = name;
  $$('.view').forEach((v) => v.classList.add('hidden'));
  $('#view-' + name).classList.remove('hidden');
  $$('.tab').forEach((t) => t.classList.toggle('active', t.dataset.view === name));
  window.scrollTo(0, 0);
  if (name === 'more') {
    renderStorageSize();
    fillSettingsUI();
    const last = localStorage.getItem('lastExport');
    $('#last-export').textContent = last ? `上次匯出：${last}` : '尚未匯出';
  }
  if (name === 'confirmed') location.hash = '#confirmed';
}

/* ============ 編輯器 ============ */
let editorSaveTimer = null;

async function openEditor(id) {
  const book = state.books.find((b) => b.id === id);
  if (!book) return;
  state.editing = book;
  state.editingDirty = false;

  const sel = $('#ed-collection');
  sel.innerHTML = '<option value="">請選擇…</option>';
  COLLECTIONS.forEach((c) => {
    const o = el('option', null, c);
    o.value = c;
    sel.appendChild(o);
  });

  $('#ed-barcode').value = book.barcode || '';
  $('#ed-title').value = book.title || '';
  $('#ed-author').value = book.author || '';
  $('#ed-publisher').value = book.publisher || '';
  $('#ed-call').value = book.callLetter || '';
  sel.value = book.collection || '';
  $('#ed-ocr').textContent = book.ocrText || '（尚未辨識）';
  $('#ed-headline').textContent = book.title || '核對資料';

  updateIsbnHint();
  updateDupWarning();
  updateStatusButtons();
  updateCallHint();
  updateMeta();

  if (state.fullUrl) { URL.revokeObjectURL(state.fullUrl); state.fullUrl = null; }
  const photo = $('#ed-photo');
  photo.removeAttribute('src');
  try {
    const rec = await dbGet('images', book.imageId);
    if (rec) {
      state.fullUrl = URL.createObjectURL(rec.blob);
      photo.src = state.fullUrl;
    }
  } catch (e) { /* ignore */ }

  $('#editor').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function closeEditor() {
  flushSave();
  $('#editor').classList.add('hidden');
  document.body.style.overflow = '';
  state.editing = null;
  state.editingDirty = false;
  if (state.fullUrl) { URL.revokeObjectURL(state.fullUrl); state.fullUrl = null; }
  renderAll();
}

function updateStatusButtons() {
  const b = state.editing;
  $$('.status-btn').forEach((btn) => {
    btn.classList.toggle('on', b && btn.dataset.status === b.status);
  });
}

function updateCallHint() {
  const b = state.editing;
  if (!b) return;
  let hint = '';
  if (b.callLetter === 'R') hint = '宗教圖書 → R';
  else if (b.callLetter === 'I') hint = '非宗教工具書／教師參考書 → I';
  else if (b.callLetter === 'C') hint = '中文書 → C';
  else if (b.callLetter === 'E') hint = '英文書 → E';
  if (b.collection === '宗教圖書' || b.collection === '教師參考書') {
    const want = b.collection === '宗教圖書' ? 'R' : 'I';
    if (b.callLetter && b.callLetter !== want) hint += `；注意：${b.collection}應為 ${want}`;
  }
  $('#ed-call-hint').textContent = hint;
}

function updateMeta() {
  const b = state.editing;
  if (!b) return;
  $('#ed-meta').innerHTML =
    `建立：${fmtTime(b.createdAt)}<br>最後修改：${fmtTime(b.updatedAt)}` +
    (b.ocrConfidence ? `<br>辨識信心：${b.ocrConfidence}%` : '');
}

function updateIsbnHint() {
  const input = $('#ed-barcode');
  const raw = input.value;
  const s = normalizeIsbn(raw);
  const hint = $('#ed-isbn-hint');
  if (!s) {
    hint.textContent = '掃描 ISBN 條碼上的數字，可含連字號。';
    hint.className = 'hint';
    input.classList.remove('bad');
    return;
  }
  if (isbn13Valid(s)) {
    hint.textContent = `ISBN-13 有效（${s}）`;
    hint.className = 'hint';
    input.classList.remove('bad');
  } else if (isbn10Valid(s)) {
    hint.textContent = `ISBN-10 有效（${s}）`;
    hint.className = 'hint';
    input.classList.remove('bad');
  } else if (s.length === 8) {
    hint.textContent = '8 位條碼（非 ISBN 檢查碼，仍可儲存）';
    hint.className = 'hint';
    input.classList.remove('bad');
  } else {
    hint.textContent = `檢查碼不符（${s.length} 位）— 請核對相片上的數字`;
    hint.className = 'hint warn';
    input.classList.add('bad');
  }
}

function updateDupWarning() {
  const b = state.editing;
  if (!b) return;
  const dup = b.barcode && state.books.some(
    (x) => x.id !== b.id && x.barcode && x.barcode === b.barcode
  );
  $('#ed-dup').classList.toggle('hidden', !dup);
}

function collectEditor() {
  const b = state.editing;
  if (!b) return null;
  b.collection = $('#ed-collection').value;
  b.barcode = normalizeIsbn($('#ed-barcode').value);
  b.title = tidy($('#ed-title').value);
  b.author = tidy($('#ed-author').value);
  b.publisher = tidy($('#ed-publisher').value);
  b.callLetter = $('#ed-call').value;
  return b;
}

function clearEditorField(sel) {
  const node = $(sel);
  if (!node || !state.editing) return;
  node.value = '';
  collectEditor();
  if (sel === '#ed-title') $('#ed-headline').textContent = '核對資料';
  if (sel === '#ed-barcode') { updateIsbnHint(); updateDupWarning(); }
  if (sel === '#ed-collection' || sel === '#ed-call') updateCallHint();
  scheduleSave();
  if (node.tagName !== 'SELECT') node.focus();
}

function scheduleSave() {
  state.editingDirty = true;
  clearTimeout(editorSaveTimer);
  editorSaveTimer = setTimeout(() => { flushSave(); }, 500);
}

async function flushSave() {
  if (!state.editing || !state.editingDirty) return;
  const b = collectEditor();
  if (!b) return;
  b.updatedAt = Date.now();
  state.editingDirty = false;
  updateMeta();
  try {
    await dbPut('books', b);
  } catch (e) {
    console.error(e);
    toast('儲存失敗，請檢查手機儲存空間');
  }
  renderAll();
}

function missingFields(b) {
  const m = [];
  if (!b.collection) m.push('館藏分類');
  if (!b.barcode) m.push('條碼（ISBN）');
  if (!b.title) m.push('書名');
  if (!b.author) m.push('文字作者');
  if (!b.callLetter) m.push('編號／索書號');
  return m;
}

async function setStatus(status) {
  const b = collectEditor();
  if (!b) return;

  if (status === 'confirmed') {
    const miss = missingFields(b);
    if (miss.length) {
      showModal({
        title: '未能確認',
        body: `<p>請先填妥：<strong>${miss.join('、')}</strong></p>`,
        actions: [{ label: '返回填寫', kind: 'primary' }],
      });
      return;
    }
  }
  b.status = status;
  b.updatedAt = Date.now();
  state.editingDirty = false;
  await dbPut('books', b);
  updateStatusButtons();
  updateMeta();
  renderAll();
  toast(`已設為「${STATUS_LABEL[status]}」`);
  if (status === 'confirmed') {
    setTimeout(() => closeEditor(), 420);
  }
}

async function reOcr() {
  const b = state.editing;
  if (!b) return;
  showModal({
    title: '重新辨識',
    body: '<p>會重新讀取這張相片，並以新結果<strong>覆蓋</strong>現有欄位（已手動修改的內容會遺失）。</p>',
    actions: [
      {
        label: '確定重新辨識', kind: 'primary', onClick: async () => {
          hideModal();
          await runReOcr(b);
        },
      },
      { label: '取消', kind: 'ghost' },
    ],
  });
}

async function runReOcr(b) {
  if (!currentKey()) { showKeyDialog(); return; }
  if (quotaLeft() <= 0) { showQuotaDialog(); return; }

  const rec = await dbGet('images', b.imageId);
  if (!rec) { toast('找不到相片'); return; }
  toast('重新辨識中，請稍候…', 5000);
  setEngine('busy', '重新辨識中');
  try {
    incUsage();
    const result = await window.OCRCloud.recognize(currentProvider(), rec.blob, currentKey());
    const f = window.OCRCloud.parseFields(result.text, result.words, result.confidence);
    const aiPick = await aiClassify(f, result.text);
    if (aiPick) {
      f.collection = aiPick;
      f.callLetter = window.OCRCloud.suggestCallLetter(aiPick, f.language, f.author);
    }

    b.ocrText = (result.text || b.ocrText || '').trim();
    b.ocrConfidence = result.confidence || 0;
    b.title = f.title || b.title;
    b.author = f.author || b.author;
    b.publisher = f.publisher || b.publisher;
    b.barcode = f.barcode || b.barcode;
    b.language = f.language || b.language;
    b.collection = f.collection || b.collection;
    b.callLetter = f.callLetter || b.callLetter;
    b.ocrError = '';
    b.status = b.status === 'confirmed' ? 'review' : (b.status === 'draft' ? 'review' : b.status);
    b.updatedAt = Date.now();
    await dbPut('books', b);

    if (state.editing && state.editing.id === b.id) {
      $('#ed-barcode').value = b.barcode || '';
      $('#ed-title').value = b.title || '';
      $('#ed-author').value = b.author || '';
      $('#ed-publisher').value = b.publisher || '';
      $('#ed-collection').value = b.collection || '';
      $('#ed-call').value = b.callLetter || '';
      $('#ed-ocr').textContent = b.ocrText || '';
      updateIsbnHint(); updateDupWarning(); updateStatusButtons(); updateCallHint(); updateMeta();
    }
    renderAll();
    toast('辨識完成');
  } catch (e) {
    console.error(e);
    toast(ocrErrorMessage(e), 4200);
    renderKeyNotice();
  } finally {
    setEngine('ready', '辨識引擎：就緒');
  }
}
/* ============ 刪除 / 清除 ============ */
async function deleteBookFlow() {
  const b = state.editing;
  if (!b) return;
  showModal({
    title: '刪除這本書？',
    body: `<p>「${escapeHtml(b.title || '未命名')}」的資料與相片會一併刪除。</p>`,
    actions: [
      {
        label: '刪除', kind: 'danger', onClick: async () => {
          hideModal();
          await deleteBook(b);
          closeEditor();
          toast('已刪除');
        },
      },
      { label: '取消', kind: 'ghost' },
    ],
  });
}

async function deleteBook(b) {
  try {
    await dbDelete('books', b.id);
    if (b.imageId) {
      await dbDelete('images', b.imageId);
      const u = thumbUrls.get(b.imageId);
      if (u) { URL.revokeObjectURL(u); thumbUrls.delete(b.imageId); }
    }
  } catch (e) { console.error(e); }
  state.books = state.books.filter((x) => x.id !== b.id);
  renderAll();
}

function clearAllFlow() {
  const n = state.books.length;
  showModal({
    title: '全部清除？',
    body: `<p>這會刪除<strong>全部 ${n} 條</strong>圖書資料及相片，<strong>無法復原</strong>。</p>` +
      '<p>請確認已把需要的資料匯出成 Excel。</p>',
    actions: [
      {
        label: `確定清除全部 ${n} 條`, kind: 'danger', onClick: async () => {
          hideModal();
          await clearAll();
          toast('已全部清除');
        },
      },
      { label: '取消', kind: 'ghost' },
    ],
  });
}

async function clearAll() {
  try {
    await dbClear('books');
    await dbClear('images');
  } catch (e) { console.error(e); }
  thumbUrls.forEach((u) => URL.revokeObjectURL(u));
  thumbUrls.clear();
  if (state.fullUrl) { URL.revokeObjectURL(state.fullUrl); state.fullUrl = null; }
  state.books = [];
  state.editing = null;
  $('#ed-photo').removeAttribute('src');
  $('#editor').classList.add('hidden');
  document.body.style.overflow = '';
  renderAll();
  switchView('capture');
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ============ 匯出 Excel ============ */
function timestampName() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

async function exportExcel() {
  const confirmed = state.books
    .filter((b) => b.status === 'confirmed')
    .sort((a, b) => a.id - b.id);

  if (!confirmed.length) {
    showModal({
      title: '沒有可匯出的資料',
      body: '<p>只有狀態為「已核對」的圖書會寫入 Excel。請先完成校對。</p>',
      actions: [{ label: '知道了', kind: 'primary' }],
    });
    return;
  }

  try {
    const rows = confirmed.map((b) => [
      '書本',
      b.collection || '',
      b.barcode || '',
      b.title || '',
      b.author || '',
      b.callLetter || '',
      b.publisher || '',
      null,
      null,
      null,
      null,
    ]);

    const aoa = [HEADERS].concat(rows);
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = COLS.map((w) => ({ wch: w }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');

    const out = XLSX.write(wb, { bookType: 'xls', type: 'array' });
    const blob = new Blob([out], { type: 'application/vnd.ms-excel' });
    const filename = `library_${timestampName()}.xls`;

    const file = new File([blob], filename, { type: 'application/vnd.ms-excel' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: filename });
        localStorage.setItem('lastExport', `${fmtTime(Date.now())}（${confirmed.length} 筆）`);
        $('#last-export').textContent = `上次匯出：${localStorage.getItem('lastExport')}`;
        return;
      } catch (e) {
        if (e && e.name === 'AbortError') return;
      }
    }

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);

    localStorage.setItem('lastExport', `${fmtTime(Date.now())}（${confirmed.length} 筆）`);
    $('#last-export').textContent = `上次匯出：${localStorage.getItem('lastExport')}`;
    toast(`已匯出 ${confirmed.length} 筆`);
  } catch (e) {
    console.error(e);
    toast('匯出失敗：' + (e && e.message ? e.message : '未知錯誤'), 5000);
  }
}

/* ============ 事件 ============ */
/* ============ 設定畫面 ============ */
function fillSettingsUI() {
  const prov = currentProvider();
  $('#set-provider').value = prov;
  $('#set-key').value = settings.keys[prov] || '';
  $('#set-limit').value = settings.limit;
  $('#set-limit').disabled = prov !== 'vision';
  $('#set-limit').closest('.field').classList.toggle('muted-field', prov !== 'vision');
  $('#set-ai-url').value = (settings.ai && settings.ai.url) || '';
  $('#set-ai-key').value = (settings.ai && settings.ai.key) || '';
  $('#set-ai-model').value = (settings.ai && settings.ai.model) || '';
  $('#set-ai-status').textContent = settings.ai && settings.ai.key
    ? '已設定 AI 分類'
    : '未設定（會用關鍵字規則分類）';
  $('#set-status').textContent = '';
  renderUsage();
}

function switchProvider(next) {
  const prev = currentProvider();
  const input = $('#set-key');
  if (input) settings.keys[prev] = input.value.trim();
  settings.provider = next === 'ocrspace' ? 'ocrspace' : 'vision';
  saveSettings();
  fillSettingsUI();
}

function saveProviderSettings() {
  settings.keys[currentProvider()] = $('#set-key').value.trim();
  if (currentProvider() === 'vision') {
    settings.limit = Math.max(50, Math.min(950, Number($('#set-limit').value) || 950));
  }
  saveSettings();
  const ok = !!currentKey();
  $('#set-status').textContent = ok ? '已儲存。' : '請貼上 API key。';
  if (ok) toast('已儲存辨識設定');
  renderUsage();
}

async function testConnection() {
  const key = $('#set-key').value.trim();
  const status = $('#set-status');
  if (!key) { status.textContent = '請先貼上 API key。'; return; }
  if (quotaLeft() <= 0) { status.textContent = '額度已用完，暫時不能測試。'; return; }

  status.textContent = '測試中…';
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 600;
    canvas.height = 200;
    const g = canvas.getContext('2d');
    g.fillStyle = '#fff';
    g.fillRect(0, 0, 600, 200);
    g.fillStyle = '#000';
    g.font = '48px "Microsoft JhengHei", sans-serif';
    g.fillText('TEST 123 ABC', 40, 110);
    const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.85));
    incUsage();
    const res = await window.OCRCloud.recognize(currentProvider(), blob, key);
    const n = String(res.text || '').replace(/\s/g, '').length;
    status.textContent = `連線成功（讀到 ${n} 個字）`;
  } catch (e) {
    status.textContent = ocrErrorMessage(e);
  }
  renderUsage();
}

function saveAiSettings() {
  settings.ai = {
    url: $('#set-ai-url').value.trim() || DEFAULT_SETTINGS.ai.url,
    key: $('#set-ai-key').value.trim(),
    model: $('#set-ai-model').value.trim(),
  };
  saveSettings();
  $('#set-ai-status').textContent = settings.ai.key ? '已設定 AI 分類' : '未設定（會用關鍵字規則分類）';
  toast('已儲存 AI 設定');
}

/* ============ 貼上文字（Lens 後備） ============ */
function openPaste() {
  if (!state.editing) return;
  $('#paste-text').value = '';
  $('#paste-modal').classList.remove('hidden');
  setTimeout(() => $('#paste-text').focus(), 60);
}

function closePaste() {
  $('#paste-modal').classList.add('hidden');
}

async function applyPastedText() {
  const b = state.editing;
  if (!b) return;
  const text = $('#paste-text').value.trim();
  if (text.length < 20) {
    toast('文字太短，請貼上整頁版權頁文字');
    return;
  }

  const f = window.OCRCloud.parseTextOnly(text);
  b.ocrText = text;
  b.title = f.title || b.title;
  b.author = f.author || b.author;
  b.publisher = f.publisher || b.publisher;
  b.barcode = f.barcode || b.barcode;
  b.language = f.language || b.language;
  b.collection = f.collection || b.collection;
  b.callLetter = f.callLetter || b.callLetter;
  b.status = b.status === 'draft' ? 'review' : b.status;
  b.updatedAt = Date.now();
  await dbPut('books', b);

  $('#ed-barcode').value = b.barcode || '';
  $('#ed-title').value = b.title || '';
  $('#ed-author').value = b.author || '';
  $('#ed-publisher').value = b.publisher || '';
  $('#ed-collection').value = b.collection || '';
  $('#ed-call').value = b.callLetter || '';
  $('#ed-ocr').textContent = b.ocrText || '';
  updateIsbnHint();
  updateDupWarning();
  updateStatusButtons();
  updateCallHint();
  updateMeta();
  renderAll();
  closePaste();
  toast('已按貼上文字更新欄位');
}

function bindEvents() {
  $$('.tab').forEach((t) => t.addEventListener('click', () => switchView(t.dataset.view)));

  $('#btn-camera').addEventListener('click', () => {
    if (capacityFull()) { fullDialog(); return; }
    if (!currentKey()) { showKeyDialog(); return; }
    if (quotaLeft() <= 0) { showQuotaDialog(); return; }
    $('#file-camera').value = '';
    $('#file-camera').click();
  });
  $('#btn-gallery').addEventListener('click', () => {
    if (capacityFull()) { fullDialog(); return; }
    if (!currentKey()) { showKeyDialog(); return; }
    if (quotaLeft() <= 0) { showQuotaDialog(); return; }
    $('#file-gallery').value = '';
    $('#file-gallery').click();
  });

  $('#file-camera').addEventListener('change', (e) => { addFiles(e.target.files); e.target.value = ''; });
  $('#file-gallery').addEventListener('change', (e) => { addFiles(e.target.files); e.target.value = ''; });

  $('#ed-close').addEventListener('click', closeEditor);
  $('#ed-done').addEventListener('click', () => { closeEditor(); toast('已儲存'); });
  $('#ed-delete').addEventListener('click', deleteBookFlow);
  $('#ed-reocr').addEventListener('click', reOcr);
  $('#ed-recall').addEventListener('click', () => {
    const b = collectEditor();
    if (!b) return;
    b.callLetter = suggestCallLetter(b.collection, b.language || detectLanguage(b.title, b.author, b.ocrText), b.author);
    $('#ed-call').value = b.callLetter;
    updateCallHint();
    scheduleSave();
    toast('索書號建議：' + b.callLetter);
  });

  $$('.status-btn').forEach((btn) => {
    btn.addEventListener('click', () => setStatus(btn.dataset.status));
  });

  ['#ed-collection', '#ed-barcode', '#ed-title', '#ed-author', '#ed-publisher', '#ed-call'].forEach((sel) => {
    const node = $(sel);
    node.addEventListener('input', () => {
      scheduleSave();
      if (sel === '#ed-barcode') { updateIsbnHint(); updateDupWarning(); }
      if (sel === '#ed-title') $('#ed-headline').textContent = node.value || '核對資料';
    });
    node.addEventListener('change', () => {
      if (sel === '#ed-collection') {
        const b = collectEditor();
        if (b) {
          b.collection = node.value;
          if (b.collection === '宗教圖書') { b.callLetter = 'R'; $('#ed-call').value = 'R'; }
          else if (b.collection === '教師參考書') { b.callLetter = 'I'; $('#ed-call').value = 'I'; }
          else if (!b.callLetter || b.callLetter === 'R' || b.callLetter === 'I') {
            b.callLetter = suggestCallLetter(b.collection, b.language || detectLanguage(b.title, b.author, b.ocrText), b.author);
            $('#ed-call').value = b.callLetter;
          }
          updateCallHint();
          scheduleSave();
        }
      }
      if (sel === '#ed-call') updateCallHint();
      scheduleSave();
    });
  });

  $$('.clear-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      clearEditorField(btn.dataset.clear);
    });
  });

  $('#ed-zoom').addEventListener('click', () => {
    const src = $('#ed-photo').getAttribute('src');
    if (!src) return;
    $('#lightbox-img').src = src;
    $('#lightbox').classList.remove('hidden');
  });
  $('#lightbox-close').addEventListener('click', () => {
    $('#lightbox').classList.add('hidden');
  });

  $('#btn-export').addEventListener('click', exportExcel);
  $('#btn-export-top').addEventListener('click', exportExcel);
  $('#btn-clear').addEventListener('click', clearAllFlow);

  $('#btn-confirm-all-hint').addEventListener('click', () => {
    showModal({
      title: '如何確認一本書',
      body: '<p>打開卡片，核對五項資料：館藏分類、條碼（ISBN）、書名、文字作者、索書號。</p>' +
        '<p>全部正確後按「已核對」。有錯就改，再按「已核對」。</p>',
      actions: [{ label: '明白', kind: 'primary' }],
    });
  });

  $('#notice-settings').addEventListener('click', () => switchView('more'));
  $('#set-provider').addEventListener('change', (e) => switchProvider(e.target.value));
  $('#set-save').addEventListener('click', saveProviderSettings);
  $('#set-test').addEventListener('click', testConnection);
  $('#set-ai-save').addEventListener('click', saveAiSettings);
  $('#ed-paste').addEventListener('click', openPaste);
  $('#paste-cancel').addEventListener('click', closePaste);
  $('#paste-run').addEventListener('click', applyPastedText);
  window.addEventListener('beforeunload', () => { flushSave(); });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushSave();
  });
}

/* ============ 初始化 ============ */
async function init() {
  bindEvents();

  try {
    if (navigator.storage && navigator.storage.persist) {
      navigator.storage.persist().catch(() => {});
    }
  } catch (e) { /* ignore */ }

  try {
    const books = await dbGetAll('books');
    books.sort((a, b) => b.id - a.id);
    state.books = books;
  } catch (e) {
    console.error('讀取資料庫失敗', e);
    toast('讀取資料失敗，請重新開啟網頁');
  }

  if (!state.books.length) {
    try {
      const rec = localStorage.getItem('lastExport');
      if (rec) $('#last-export').textContent = `上次匯出：${rec}`;
    } catch (e) { /* ignore */ }
  }

  renderAll();
  fillSettingsUI();
  renderKeyNotice();
  renderQueue();
  $('#version').textContent = `${APP_VERSION} · 本機儲存 400 條上限`;

  if (state.books.length >= MAX_BOOKS) {
    setTimeout(() => fullDialog(), 600);
  }

  registerSW();
}

function registerSW() {
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
    navigator.serviceWorker.register('./sw.js').catch((e) => console.warn('SW 註冊失敗', e));
  }
}

document.addEventListener('DOMContentLoaded', init);
