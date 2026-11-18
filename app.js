'use strict';

/* ============ 常數 ============ */
const MAX_BOOKS = 400;
const APP_VERSION = 'v1.0';

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

const STATUS_LABEL = { draft: '草稿', review: '待校對', confirmed: '已確認' };

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
      '<p>請先按「匯出 Excel」，把已確認的資料存好，再按「全部清除」開始新一批。</p>',
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
      version: 1,
    };
    book.id = await dbAdd('books', book);
    state.books.unshift(book);
    renderAll();

    job.message = '載入辨識引擎…';
    renderQueue();
    setEngine('busy', '辨識引擎：準備中');

    const worker = await getWorker();
    setEngine('busy', '辨識引擎：辨識中 | ' + job.name);

    job.message = '辨識文字中…';
    renderQueue();

    const { data } = await worker.recognize(full, {}, { text: true, blocks: true });
    const text = (data && data.text) || '';
    const confidence = Math.round((data && data.confidence) || 0);

    const fields = extractFields(text, data && data.blocks);

    book.ocrText = text;
    book.ocrConfidence = confidence;
    book.collection = fields.collection;
    book.barcode = fields.barcode;
    book.title = fields.title;
    book.author = fields.author;
    book.publisher = fields.publisher;
    book.language = fields.language;
    book.callLetter = fields.callLetter;
    book.status = 'review';
    book.updatedAt = Date.now();
    await dbPut('books', book);

    job.state = 'done';
    job.progress = 100;
    job.message = '已加入待校對';
  } catch (err) {
    console.error('OCR 失敗', err);
    job.state = 'error';
    job.message = '辨識失敗，可稍後重試';
    if (book) {
      book.ocrText = book.ocrText || '';
      book.status = 'draft';
      book.updatedAt = Date.now();
      try { await dbPut('books', book); } catch (e) { /* ignore */ }
    }
    setEngine('err', '辨識引擎：發生錯誤');
    toast('有相片辨識失敗，可在卡片內按「重新辨識」');
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

/* ============ OCR 引擎 ============ */
let workerPromise = null;

function getWorker() {
  if (!workerPromise) {
    workerPromise = (async () => {
      if (typeof Tesseract === 'undefined') throw new Error('OCR 引擎未載入');
      const abs = (p) => new URL(p, location.href).href;
      setEngine('busy', '辨識引擎：首次載入語言資料…');
      const worker = await Tesseract.createWorker('chi_tra+eng', 1, {
        workerPath: abs('./vendor/worker.min.js'),
        corePath: abs('./vendor'),
        langPath: abs('./vendor/lang'),
        logger: (m) => {
          if (m && m.status === 'recognizing text') {
            const cur = state.queue.find((q) => q.state === 'working');
            if (cur) {
              cur.progress = Math.round((m.progress || 0) * 100);
              cur.message = `辨識文字中… ${cur.progress}%`;
              const first = $('#queue').querySelector('.qitem .bar > i');
              if (first) first.style.width = cur.progress + '%';
              const st = $('#queue').querySelector('.qitem .q-state');
              if (st) st.textContent = cur.message;
            }
          }
        },
        errorHandler: (e) => console.error('tesseract', e),
      });
      await worker.setParameters({ preserve_interword_spaces: '1' });
      setEngine('ready', '辨識引擎：就緒');
      return worker;
    })().catch((e) => {
      workerPromise = null;
      setEngine('err', '辨識引擎：載入失敗');
      throw e;
    });
  }
  return workerPromise;
}

/* ============ 文字抽取 ============ */
const BAD_TITLE = /作者|作\s*者|譯者|譯\s*者|繪者|繪\s*者|編者|編\s*者|編輯|編\s*輯|攝影|美術|封面|出版|發行|印刷|經銷|ISBN|定價|售價|價錢|版次|初版|地址|電話|傳真|網址|電郵|版權|著作|書名|國家圖書館|CIP/;

function tidy(s) {
  return (s || '')
    .replace(/[\u3000]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\s+([!?！？，,。.；;：:])/g, '$1')
    .replace(/^[·•・\-\s]+/, '')
    .replace(/[\s.。;；:：,，]+$/, '')
    .trim();
}

function normalizeIsbn(raw) {
  return (raw || '').replace(/[^0-9Xx]/g, '').toUpperCase();
}

function isbn13Valid(s) {
  if (!/^\d{13}$/.test(s)) return false;
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(s[i]) * (i % 2 ? 3 : 1);
  return (10 - (sum % 10)) % 10 === Number(s[12]);
}

function isbn10Valid(s) {
  if (!/^\d{9}[\dX]$/.test(s)) return false;
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += Number(s[i]) * (10 - i);
  const c = s[9] === 'X' ? 10 : Number(s[9]);
  return (11 - (sum % 11)) % 11 === c;
}

function extractIsbn(text) {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const tries = [];

  lines.forEach((line, i) => {
    if (/I\s*S\s*B\s*N/i.test(line)) {
      const idx = line.search(/I\s*S\s*B\s*N/i);
      tries.push(line.slice(idx));
      if (lines[i + 1]) tries.push(lines[i + 1]);
      tries.push(line.replace(/^.*?I\s*S\s*B\s*N[^0-9]*/i, ''));
    }
  });
  tries.push(text);

  for (const chunk of tries) {
    const cands = (chunk.match(/(?:97[89][\d\-\s]{9,17}[\dXx]|[\d\-\s]{10,17}[\dXx]|\d{8,13})/g) || []);
    for (const raw of cands) {
      const s = normalizeIsbn(raw);
      if (isbn13Valid(s) || isbn10Valid(s)) return s;
    }
  }
  // 未通過檢查碼：退回「ISBN 附近」最像的一組
  for (const chunk of tries) {
    const m = normalizeIsbn(chunk);
    if (m.length >= 8 && m.length <= 17) {
      const near = chunk.match(/(\d[\d\-\s]{7,16}\d)/);
      if (near) {
        const s = normalizeIsbn(near[1]);
        if (s.length === 10 || s.length === 13 || s.length === 8) return s;
      }
    }
  }
  return '';
}

function titleFromBlocks(blocks) {
  if (!Array.isArray(blocks) || !blocks.length) return '';
  const lines = [];
  blocks.forEach((b) => {
    (b.paragraphs || []).forEach((p) => {
      (p.lines || []).forEach((l) => {
        const t = tidy(l.text);
        const bb = l.bbox;
        if (!t || !bb) return;
        const h = bb.y1 - bb.y0;
        if (h <= 0) return;
        if (t.replace(/\s/g, '').length < 2) return;
        lines.push({ t, h, x: bb.x0, y: bb.y0 });
      });
    });
  });
  if (!lines.length) return '';

  const maxH = Math.max.apply(null, lines.map((l) => l.h));
  const top = lines
    .filter((l) => l.h >= maxH * 0.8 && l.t.length <= 30 && /[\u4e00-\u9fffA-Za-z]/.test(l.t))
    .sort((a, b) => a.y - b.y || a.x - b.x);
  if (!top.length) return '';

  const startY = top[0].y;
  const picked = [];
  for (const l of top) {
    if (l.y - startY > maxH * 3.2) break;
    if (BAD_TITLE.test(l.t)) break;
    if (l.t.replace(/\s/g, '').length <= 1) continue;
    picked.push(l.t);
    if (picked.join('').length > 34) break;
  }
  return tidy(picked.join(''));
}

function extractTitle(text, blocks) {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);

  // 1) CIP 型式：書名 / 作者
  for (const line of lines) {
    const m = line.match(/^(.{2,40}?)\s*[\/／]\s*(.{2,90})$/);
    if (m) {
      const left = tidy(m[1]);
      if (/[\u4e00-\u9fff]/.test(left) && !BAD_TITLE.test(left) && left.length <= 30) return left;
    }
  }

  // 2) 標籤型式：書名：…
  for (const line of lines) {
    const m = line.match(/^書\s*名\s*[：:]\s*(.+)$/);
    if (m) return tidy(m[1]);
  }

  // 3) 版面字型：最大字的一組
  const byLayout = titleFromBlocks(blocks);
  if (byLayout) return byLayout;

  // 4) 第一個像書名的短句
  for (const line of lines.slice(0, 12)) {
    const t = tidy(line);
    if (t.length < 2 || t.length > 26) continue;
    if (BAD_TITLE.test(t)) continue;
    if (/^[\d\s\-–—.]+$/.test(t)) continue;
    if (/^[A-Za-z\s]+$/.test(t) && t.length < 4) continue;
    return t;
  }
  return '';
}

function tidyAuthor(s) {
  return tidy(
    (s || '')
      .replace(/\([^)]*\)/g, '')
      .replace(/（[^）]*）/g, '')
      .replace(/(著|文|作|撰文|原著|編著|編寫|翻譯)\s*$/g, '')
      .replace(/([\u4e00-\u9fff])[.·•・](?=[\u4e00-\u9fff])/g, '$1·')
  );
}

function extractAuthor(text) {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);

  for (const line of lines) {
    if (/譯\s*者|繪\s*者|編\s*者|編\s*輯|攝\s*影|美\s*術|封\s*面|總\s*編|責\s*任/.test(line)) continue;
    const m = line.match(/^(?:作\s*者|Author|文|撰文|原著)\s*[：:]?\s*(.{2,60})$/i);
    if (m) {
      const a = tidyAuthor(m[1]);
      if (a) return a;
    }
  }

  // 「蘿拉·艾倫·安德森 文」這類無標籤寫法
  for (const line of lines) {
    if (/譯|繪|編|攝影|美術|封面|出版|發行/.test(line)) continue;
    const m = line.match(/^([\u4e00-\u9fff·•・.\sA-Za-z]{2,28})\s*(?:文|著|作|撰文)$/);
    if (m) {
      const a = tidyAuthor(m[1]);
      if (a && a.replace(/\s/g, '').length >= 2) return a;
    }
  }

  for (const line of lines) {
    if (/譯\s*者|繪\s*者|編\s*者/.test(line)) continue;
    const m = line.match(/[\/／]\s*([^；;\/／]{2,50})/);
    if (m && /[\u4e00-\u9fffA-Za-z]/.test(m[1])) {
      const a = tidyAuthor(m[1]);
      if (a && a.replace(/\s/g, '').length >= 2) return a;
    }
  }
  return '';
}

function extractPublisher(text) {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);

  for (const line of lines) {
    if (/出版\s*(日期|年|月份|時間)/.test(line)) continue;
    const m = line.match(/^(?:出\s*版\s*者|出\s*版|發\s*行\s*者|經\s*銷\s*商|Published\s*by)\s*[：:]?\s*(.{2,60})$/i);
    if (m) {
      const p = tidy(m[1].replace(/^[（(]?香港[）)]?\s*/, ''));
      if (p && !/^(日期|年)/.test(p)) return p;
    }
  }

  for (const line of lines) {
    if (/ISBN|版權|地址|電話|傳真|電郵|網址|定價|印刷/.test(line)) continue;
    if (/(出版股份|出版集團|出版事業|出版有限公司|出版公司|出版社|書局|圖書公司|文化事業|Publishing|Press|Publisher)/i.test(line)) {
      const p = tidy(
        line
          .replace(/^(出\s*版|出\s*版\s*者|總\s*經\s*銷|經\s*銷\s*商)\s*[：:]?\s*/, '')
          .replace(/[,，]\s*\d{4}.*$/, '')
      );
      if (p.length >= 2 && p.length <= 40) return p;
    }
  }
  return '';
}

function detectLanguage(title, author, allText) {
  const sample = `${title || ''} ${author || ''}`;
  const cjk = (sample.match(/[\u4e00-\u9fff]/g) || []).length;
  const lat = (sample.match(/[A-Za-z]/g) || []).length;
  if (cjk > 0 && lat > 0) return 'bi';
  if (cjk > 0) return 'zh';
  if (lat >= 2) return 'en';

  const cjkAll = (allText.match(/[\u4e00-\u9fff]/g) || []).length;
  const latAll = (allText.match(/[A-Za-z]/g) || []).length;
  if (cjkAll > latAll) return 'zh';
  if (latAll > cjkAll * 2) return 'en';
  return 'zh';
}

function suggestCollection(text, language) {
  const t = text || '';
  if (/(聖經|宗教|耶穌|基督|天主|佛|禪|禱告|祈禱|靈修|福音|信徒|教會|牧師|神學)/.test(t)) return '宗教圖書';
  if (/(教師|教學|課程|教案|教材|指南|手冊|理論|參考|評估|活動設計)/.test(t)) return '教師參考書';
  if (/(生命科學|生物|動物|植物|昆蟲|人體|生態)/.test(t)) return '生活資訊-生命科學';
  if (/(物理|力學|光學|聲音|電學|能量|機械)/.test(t)) return '生活資訊-物理科學';
  if (/(地球|太空|宇宙|星球|天文|氣象|海洋|地質)/.test(t)) return '生活資訊-地球和太空科學';
  if (/(藝術|美術|音樂|繪畫|手工|勞作|舞蹈|戲劇)/.test(t)) return '生活資訊-藝術';
  if (/(烹飪|食譜|料理|烘焙|食物|飲食)/.test(t)) return '生活資訊-烹飪';
  if (/(文化|節日|習俗|歷史|地理|世界|國家)/.test(t)) return '生活資訊-文化';
  if (language === 'en') return '兒童繪本-英文';
  return '兒童繪本-中文';
}

function suggestCallLetter(collection, language, author) {
  if (collection === '宗教圖書') return 'R';
  if (collection === '教師參考書') return 'I';
  if (language === 'zh') return 'C';
  if (language === 'en') return 'E';
  const a = author || '';
  if (/[\u4e00-\u9fff]/.test(a)) return 'C';
  if (/[A-Za-z]/.test(a)) return 'E';
  return 'C';
}

function extractFields(text, blocks) {
  const clean = (text || '').replace(/\r/g, '');
  const title = extractTitle(clean, blocks);
  const author = extractAuthor(clean);
  const publisher = extractPublisher(clean);
  const barcode = extractIsbn(clean);
  const language = detectLanguage(title, author, clean);
  const collection = suggestCollection(`${title}\n${clean.slice(0, 1200)}`, language);
  const callLetter = suggestCallLetter(collection, language, author);
  return { title, author, publisher, barcode, language, collection, callLetter };
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
  if (book.status === 'confirmed') tags.appendChild(el('span', 'tag', '已確認'));
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
    cl.appendChild(el('div', 'empty', '未有已確認資料。'));
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
  const rec = await dbGet('images', b.imageId);
  if (!rec) { toast('找不到相片'); return; }
  toast('重新辨識中，請稍候…', 5000);
  setEngine('busy', '辨識引擎：重新辨識');
  try {
    const worker = await getWorker();
    const { data } = await worker.recognize(rec.blob, {}, { text: true, blocks: true });
    const f = extractFields(data && data.text, data && data.blocks);
    b.ocrText = (data && data.text) || b.ocrText;
    b.ocrConfidence = Math.round((data && data.confidence) || 0);
    b.title = f.title || b.title;
    b.author = f.author || b.author;
    b.publisher = f.publisher || b.publisher;
    b.barcode = f.barcode || b.barcode;
    b.language = f.language;
    b.collection = f.collection;
    b.callLetter = f.callLetter;
    b.status = b.status === 'confirmed' ? 'review' : b.status;
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
    toast('辨識失敗，請稍後再試');
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
      body: '<p>只有狀態為「已確認」的圖書會寫入 Excel。請先完成校對。</p>',
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
function bindEvents() {
  $$('.tab').forEach((t) => t.addEventListener('click', () => switchView(t.dataset.view)));

  $('#btn-camera').addEventListener('click', () => {
    if (capacityFull()) { fullDialog(); return; }
    $('#file-camera').value = '';
    $('#file-camera').click();
  });
  $('#btn-gallery').addEventListener('click', () => {
    if (capacityFull()) { fullDialog(); return; }
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
        '<p>全部正確後按「已確認」。有錯就改，再按「已確認」。</p>',
      actions: [{ label: '明白', kind: 'primary' }],
    });
  });

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
