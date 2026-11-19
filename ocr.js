/* 雲端 OCR 與欄位解析：Google Cloud Vision / OCR.space */
(function (global) {
  'use strict';

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

  const BAD_TITLE = /作者|作\s*者|譯者|譯\s*者|繪者|繪\s*者|編者|編\s*者|編輯|編\s*輯|攝影|美術|封面|出版|發行|印刷|經銷|ISBN|定價|售價|價錢|版次|初版|地址|電話|傳真|網址|電郵|版權|著作|書名|國家圖書館|CIP|總編輯|責任編輯/;
  const ADDRESS = /(號|樓|路|街|道|區|市|縣|郵政|Tel|Fax|Email|www\.|https?:|Sdn\.?\s*Bhd|Jalan|No\.\s*\d|@)/i;
  const COMPANY = /(出版社|出版有限公司|出版公司|出版股份|出版集團|出版事業|書局|圖書公司|文化事業|Publishing|Publishers?|Press)/i;

  /* ---------- 影像 ---------- */
  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = () => reject(new Error('讀取相片失敗'));
      r.readAsDataURL(blob);
    });
  }

  async function blobToJpeg(blob, maxSide, quality) {
    const url = URL.createObjectURL(blob);
    try {
      const img = await new Promise((res, rej) => {
        const i = new Image();
        i.onload = () => res(i);
        i.onerror = () => rej(new Error('無法讀取相片'));
        i.src = url;
      });
      const w0 = img.naturalWidth || img.width;
      const h0 = img.naturalHeight || img.height;
      const scale = Math.min(1, maxSide / Math.max(w0, h0));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(w0 * scale));
      canvas.height = Math.max(1, Math.round(h0 * scale));
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      return await new Promise((res) => canvas.toBlob((b) => res(b), 'image/jpeg', quality));
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  async function fitForOcr(blob, limitBytes) {
    const attempts = [
      [1900, 0.86],
      [1700, 0.8],
      [1500, 0.74],
      [1200, 0.68],
    ];
    for (const [side, q] of attempts) {
      const out = await blobToJpeg(blob, side, q);
      if (!limitBytes || out.size <= limitBytes) return out;
    }
    return await blobToJpeg(blob, 1000, 0.6);
  }

  /* ---------- Vision ---------- */
  function parseVisionResponse(r0) {
    const ann = (r0 && r0.fullTextAnnotation) || {};
    const text = ann.text || (r0 && r0.textAnnotations && r0.textAnnotations[0] && r0.textAnnotations[0].description) || '';
    const words = [];
    let confSum = 0;
    let confN = 0;
    let ln = 0;

    (ann.pages || []).forEach((page) => {
      (page.blocks || []).forEach((block) => {
        (block.paragraphs || []).forEach((para) => {
          (para.lines || []).forEach((line) => {
            const lineNo = ln++;
            (line.words || []).forEach((word) => {
              let t = '';
              (word.symbols || []).forEach((sym) => {
                t += sym.text || '';
                const br = sym.property && sym.property.detectedBreak && sym.property.detectedBreak.type;
                if (br === 'SPACE' || br === 'SURE_SPACE' || br === 'EOL_SURE_SPACE') t += ' ';
              });
              const verts = (word.boundingBox && word.boundingBox.vertices) || [];
              if (!t.trim() || !verts.length) return;
              const xs = verts.map((p) => +p.x || 0);
              const ys = verts.map((p) => +p.y || 0);
              words.push({
                t: t.trim(),
                x0: Math.min.apply(null, xs),
                y0: Math.min.apply(null, ys),
                x1: Math.max.apply(null, xs),
                y1: Math.max.apply(null, ys),
                ln: lineNo,
              });
              if (typeof word.confidence === 'number') {
                confSum += word.confidence;
                confN++;
              }
            });
          });
        });
      });
    });

    return {
      text,
      words,
      confidence: confN ? Math.round((confSum / confN) * 100) : 0,
    };
  }

  async function visionRecognize(blob, key, opts) {
    const dataUrl = await blobToDataUrl(blob);
    const content = dataUrl.slice(dataUrl.indexOf(',') + 1);
    const body = {
      requests: [
        {
          image: { content },
          features: [{ type: 'DOCUMENT_TEXT_DETECTION', maxResults: 1 }],
          imageContext: { languageHints: ['zh-Hant', 'zh', 'en'] },
        },
      ],
    };
    const res = await fetch(
      'https://vision.googleapis.com/v1/images:annotate?key=' + encodeURIComponent(key),
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
    );
    const data = await res.json().catch(() => ({}));

    if (!res.ok || (data && data.error)) {
      const msg = (data.error && data.error.message) || ('HTTP ' + res.status);
      throw makeErr('vision', res.status, msg);
    }
    const r0 = (data.responses && data.responses[0]) || {};
    if (r0.error) throw makeErr('vision', res.status, r0.error.message || 'Vision 錯誤');

    const parsed = parseVisionResponse(r0);
    parsed.provider = 'vision';
    return parsed;
  }
  /* ---------- OCR.space ---------- */
  async function ocrSpaceRecognize(blob, key, opts) {
    const img = await fitForOcr(blob, 950 * 1024);
    const fd = new FormData();
    fd.append('file', img, 'page.jpg');
    fd.append('apikey', key);
    fd.append('language', 'cht');
    fd.append('OCREngine', '2');
    fd.append('isOverlayRequired', 'true');
    fd.append('scale', 'true');
    fd.append('detectOrientation', 'true');

    const res = await fetch('https://api.ocr.space/parse/image', { method: 'POST', body: fd });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw makeErr('ocrspace', res.status, `HTTP ${res.status}`);
    if (data.IsError) {
      const msg = Array.isArray(data.ErrorMessage) ? data.ErrorMessage.join('；') : (data.ErrorMessage || 'OCR 失敗');
      throw makeErr('ocrspace', 400, msg);
    }
    const r0 = (data.ParsedResults && data.ParsedResults[0]) || {};
    const text = r0.ParsedText || '';
    const words = [];
    const lines = (r0.TextOverlay && r0.TextOverlay.Lines) || [];
    lines.forEach((line, li) => {
      (line.Words || []).forEach((w) => {
        const t = (w.WordText || '').trim();
        if (!t) return;
        words.push({
          t,
          x0: +w.Left || 0,
          y0: +w.Top || 0,
          x1: (+w.Left || 0) + (+w.Width || 0),
          y1: (+w.Top || 0) + (+w.Height || 0),
          ln: li,
        });
      });
    });
    return { provider: 'ocrspace', text, words, confidence: 0 };
  }

  function makeErr(provider, status, message) {
    const e = new Error(message || 'OCR 失敗');
    e.provider = provider;
    e.status = status;
    return e;
  }

  /* ---------- 版面 → 行 ---------- */
  const isLatin = (s) => /[A-Za-z0-9]/.test(s);

  function buildLines(words) {
    const ws = (words || [])
      .filter((w) => w && w.t && String(w.t).trim())
      .map((w) => ({
        t: String(w.t).replace(/\s+/g, ' ').trim(),
        x0: +w.x0 || 0,
        y0: +w.y0 || 0,
        x1: +w.x1 || 0,
        y1: +w.y1 || 0,
        ln: typeof w.ln === 'number' ? w.ln : null,
      }))
      .map((w) => ({ ...w, cy: (w.y0 + w.y1) / 2, h: Math.max(1, w.y1 - w.y0) }));

    let groups = [];

    if (ws.length && ws.every((w) => w.ln !== null)) {
      const map = new Map();
      ws.forEach((w) => {
        if (!map.has(w.ln)) map.set(w.ln, []);
        map.get(w.ln).push(w);
      });
      groups = Array.from(map.values()).map((g) => ({ ws: g }));
    } else {
      const sorted = ws.slice().sort((a, b) => a.cy - b.cy || a.x0 - b.x0);
      sorted.forEach((w) => {
        let best = null;
        let bestD = Infinity;
        groups.forEach((l) => {
          const d = Math.abs(l.cy - w.cy);
          const tol = Math.max(l.h, w.h) * 0.55;
          if (d <= tol && d < bestD) { best = l; bestD = d; }
        });
        if (!best) {
          best = { ws: [] };
          groups.push(best);
        }
        best.ws.push(w);
        best.cy = best.ws.reduce((s, x) => s + x.cy, 0) / best.ws.length;
        best.h = Math.max(best.h || 0, w.h);
      });
    }

    groups.forEach((l) => {
      l.ws.sort((a, b) => a.x0 - b.x0);
      l.cy = l.ws.reduce((s, x) => s + x.cy, 0) / l.ws.length;
      l.h = Math.max.apply(null, l.ws.map((x) => x.h));
      l.x0 = Math.min.apply(null, l.ws.map((x) => x.x0));
      l.x1 = Math.max.apply(null, l.ws.map((x) => x.x1));
      l.y0 = Math.min.apply(null, l.ws.map((x) => x.y0));
    });

    groups.sort((a, b) => a.cy - b.cy || a.x0 - b.x0);

    const merged = [];
    groups.forEach((g) => {
      let target = null;
      for (const m of merged) {
        const dy = Math.abs(m.cy - g.cy);
        const gap = Math.max(g.x0 - m.x1, m.x0 - g.x1, 0);
        if (dy <= Math.min(m.h, g.h) * 0.35 && gap <= Math.min(m.h, g.h) * 5) {
          target = m;
          break;
        }
      }
      if (!target) {
        merged.push({ ws: g.ws.slice(), cy: g.cy, h: g.h, x0: g.x0, x1: g.x1, y0: g.y0 });
        return;
      }
      target.ws = target.ws.concat(g.ws);
      target.cy = target.ws.reduce((s, x) => s + x.cy, 0) / target.ws.length;
      target.h = Math.max(target.h, g.h);
      target.x0 = Math.min(target.x0, g.x0);
      target.x1 = Math.max(target.x1, g.x1);
      target.y0 = Math.min(target.y0, g.y0);
    });

    merged.forEach((l) => {
      l.ws.sort((a, b) => a.x0 - b.x0);
      let text = '';
      l.ws.forEach((w, i) => {
        if (i > 0) {
          const p = l.ws[i - 1];
          const gap = w.x0 - p.x1;
          if (gap > l.h * 5) text += '\t';
          else if (isLatin(p.t.slice(-1)) && isLatin(w.t.slice(0, 1))) text += ' ';
        }
        text += w.t;
      });
      l.text = text;
    });

    merged.sort((a, b) => a.cy - b.cy || a.x0 - b.x0);
    return merged;
  }
  function clean(s) {
    return String(s || '')
      .replace(/\u3000/g, ' ')
      .replace(/[•・‧]/g, '·')
      .replace(/\s+/g, ' ')
      .replace(/\s+([!?！？，,。.；;：:])/g, '$1')
      .replace(/^[\s·.\-–—]+/, '')
      .replace(/[\s,，、;；:：]+$/, '')
      .trim();
  }

  function findLabeled(lines, re) {
    for (const l of lines) {
      const raw = l.text;
      const m = raw.match(re);
      if (!m || m.index > 3) continue;
      const rest = raw.slice(m.index + m[0].length);
      const segs = rest.split('\t').map((s) => s.trim()).filter(Boolean);
      if (segs.length) return { value: segs[0], line: l };
    }
    return null;
  }

  /* ---------- 欄位 ---------- */
  function normalizeIsbn(raw) {
    return String(raw || '').replace(/[^0-9Xx]/g, '').toUpperCase();
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
    const flat = String(text || '').replace(/\n/g, ' ');
    const near = [];
    const re = /I\s*S\s*B\s*N[\s:：\-–—]*([0-9][0-9\-\s–—]{8,22}[0-9Xx])/gi;
    let m;
    while ((m = re.exec(flat))) near.push(m[1]);
    if (near.length) {
      for (const raw of near) {
        const s = normalizeIsbn(raw);
        if (isbn13Valid(s) || isbn10Valid(s)) return s;
      }
    }
    const any = flat.match(/(?:97[89][\d\-\s–—]{9,17}[\dXx]|\d{8,13})/g) || [];
    for (const raw of any) {
      const s = normalizeIsbn(raw);
      if (isbn13Valid(s) || isbn10Valid(s)) return s;
    }
    if (near.length) {
      const s = normalizeIsbn(near[0]);
      if (s.length >= 8 && s.length <= 17) return s;
    }
    return '';
  }

  function cipTitle(lines) {
    for (const l of lines) {
      const t = l.text.replace(/\t/g, ' ');
      const m = t.match(/^(.{2,40}?)\s*[\/／]\s*(.{2,90})$/);
      if (!m) continue;
      const left = clean(m[1]);
      if (!left || left.length > 30) continue;
      if (!/[\u4e00-\u9fff]/.test(left)) continue;
      if (BAD_TITLE.test(left)) continue;
      return left;
    }
    return '';
  }

  function titleByLayout(lines) {
    const cand = lines.filter((l) => {
      const t = clean(l.text.replace(/\t.*$/, ''));
      if (!t || t.length < 2 || t.length > 28) return false;
      if (BAD_TITLE.test(t)) return false;
      if (ADDRESS.test(t)) return false;
      if (/^[\d\s\-–—.]+$/.test(t)) return false;
      return /[\u4e00-\u9fffA-Za-z]/.test(t);
    });
    if (!cand.length) return '';

    const anchor = cand.reduce((a, b) => (b.h > a.h ? b : a), cand[0]);
    if (anchor.h < 18) return '';

    const picked = cand
      .filter((l) => {
        if (l === anchor) return true;
        if (l.h < anchor.h * 0.2) return false;
        if (Math.abs(l.cy - anchor.cy) > anchor.h * 3.6) return false;
        const nearX = l.x1 > anchor.x0 - anchor.h * 2.5 && l.x0 < anchor.x1 + anchor.h * 2.5;
        return nearX;
      })
      .sort((a, b) => a.cy - b.cy || a.x0 - b.x0);

    const out = [];
    for (const l of picked) {
      const t = clean(l.text.replace(/\t.*$/, '')).replace(/[、,，]+$/, '');
      if (!t) continue;
      if (out.some((x) => x === t)) continue;
      out.push(t);
      if (out.join('').length > 32) break;
    }
    return clean(out.join(''));
  }

  function extractTitle(lines) {
    const cip = cipTitle(lines);
    if (cip) return cip;
    const layout = titleByLayout(lines);
    if (layout) return layout;
    for (const l of lines.slice(0, 25)) {
      const t = clean(l.text.replace(/\t.*$/, ''));
      if (t.length >= 2 && t.length <= 26 && !BAD_TITLE.test(t) && !ADDRESS.test(t) && /[\u4e00-\u9fffA-Za-z]/.test(t)) return t;
    }
    return '';
  }

  function tidyAuthor(s) {
    let a = String(s || '');
    a = a.replace(/[（(][^）)]*$/g, '');
    a = a.replace(/\([^)]*\)/g, '').replace(/（[^）]*）/g, '');
    a = a.replace(/[\s·.]*$/, '');
    a = a.replace(/(著|文|作|撰文|原著|編著|編寫|翻譯)\s*$/g, '');
    a = clean(a);
    if (ADDRESS.test(a) || /\d/.test(a)) return '';
    return a;
  }

  function extractAuthor(lines) {
    for (const re of [
      /(?:^|\t)\s*(?:作\s*者|Author|撰文)\s*[：:]?\s*/i,
    ]) {
      const hit = findLabeled(lines, re);
      if (hit) {
        const a = tidyAuthor(hit.value);
        if (a && a.length >= 2) return a;
      }
    }
    for (const l of lines) {
      const t = l.text;
      if (!/[\/／]/.test(t)) continue;
      if (/譯\s*者|繪\s*者|編\s*者/.test(t)) continue;
      const m = t.match(/[\/／]\s*([^；;\t\/／]{2,50})/);
      if (!m) continue;
      const a = tidyAuthor(m[1]);
      if (a) return a;
    }
    return '';
  }

  function extractPublisher(lines) {
    const hit = findLabeled(lines, /(?:^|\t)\s*(?:出\s*版\s*者|出\s*版(?!\s*(?:日期|年|月份|時間))|Published\s*by)\s*[：:]?\s*/i);
    if (hit) {
      let p = clean(hit.value).replace(/[,，]\s*\d{4}.*$/, '');
      p = p.replace(/\s*(定\s*價|售\s*價)[：:].*$/, '');
      if (p.length >= 2 && p.length <= 40 && !ADDRESS.test(p)) return p;
    }
    for (const l of lines) {
      const t = clean(l.text.replace(/\t.*$/, ''));
      if (!COMPANY.test(t)) continue;
      if (ADDRESS.test(t)) continue;
      if (t.length < 2 || t.length > 40) continue;
      return t;
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

    const cjkAll = (String(allText).match(/[\u4e00-\u9fff]/g) || []).length;
    const latAll = (String(allText).match(/[A-Za-z]/g) || []).length;
    if (latAll > cjkAll * 1.5) return 'en';
    return 'zh';
  }

  const COLLECTION_HINTS = [
    ['生活資訊-烹飪', /(烹飪|食譜|料理|烘焙|蛋糕|甜品|甜點|麵包|飲食|食物|廚房|煮)/],
    ['生活資訊-藝術', /(藝術|美術|音樂|繪畫|畫畫|手工|勞作|摺紙|舞蹈|戲劇|色彩|創作)/],
    ['生活資訊-生命科學', /(生命科學|生物|動物|植物|昆蟲|人體|生態|恐龍|海洋生物)/],
    ['生活資訊-物理科學', /(物理|力學|光學|聲音|電學|能量|機械|磁)/],
    ['生活資訊-地球和太空科學', /(地球|太空|宇宙|星球|天文|氣象|天氣|海洋|地質|月亮|太陽)/],
    ['生活資訊-文化', /(文化|節日|習俗|歷史|地理|傳統|節慶|各地)/],
    ['宗教圖書', /(聖經|宗教|耶穌|基督|天主|佛|禪|禱告|祈禱|靈修|福音|信徒|教會|牧師|神學)/],
    ['教師參考書', /(教師|教學|課程|教案|教材|指南|手冊|理論|參考|評估|活動設計|教育)/],
  ];

  function suggestCollection(text, language) {
    const t = String(text || '');
    let best = { name: '', score: 0 };
    COLLECTION_HINTS.forEach(([name, re]) => {
      const hits = (t.match(new RegExp(re.source, 'g')) || []).length;
      if (hits > best.score) best = { name, score: hits };
    });
    if (best.score > 0) return best.name;
    return language === 'en' ? '兒童繪本-英文' : '兒童繪本-中文';
  }

  function suggestCallLetter(collection, language, author) {
    if (collection === '宗教圖書') return 'R';
    if (collection === '教師參考書') return 'I';
    if (language === 'zh') return 'C';
    if (language === 'en') return 'E';
    const a = String(author || '');
    if (/[\u4e00-\u9fff]/.test(a)) return 'C';
    if (/[A-Za-z]/.test(a)) return 'E';
    return 'C';
  }

  /* ---------- 主解析 ---------- */
  function parseFields(text, words, confidence) {
    const t = String(text || '').replace(/\r/g, '');
    const lines = buildLines(words);
    const title = lines.length ? extractTitle(lines) : parseTextOnlyTitle(t);
    const author = lines.length ? extractAuthor(lines) : parseTextOnlyAuthor(t);
    const publisher = lines.length ? extractPublisher(lines) : parseTextOnlyPublisher(t);
    const barcode = extractIsbn(t) || extractIsbn(lines.map((l) => l.text).join('\n'));
    const language = detectLanguage(title, author, t);
    const context = `${title}\n${author}\n${publisher}\n${t.slice(0, 1800)}`;
    const collection = suggestCollection(context, language);
    const callLetter = suggestCallLetter(collection, language, author);
    return { title, author, publisher, barcode, language, collection, callLetter, confidence: confidence || 0 };
  }

  /* ---------- 純文字（Lens 貼上） ---------- */
  const linesOf = (text) => String(text || '').split('\n').map((s) => s.trim()).filter(Boolean);

  function parseTextOnlyTitle(text) {
    const lines = linesOf(text);
    for (const l of lines) {
      const m = l.match(/^(.{2,40}?)\s*[\/／]\s*(.{2,90})$/);
      if (m) {
        const left = clean(m[1]);
        if (/[\u4e00-\u9fff]/.test(left) && !BAD_TITLE.test(left)) return left;
      }
    }
    for (const l of lines) {
      const m = l.match(/^書\s*名\s*[：:]\s*(.+)$/);
      if (m) return clean(m[1]);
    }
    for (const l of lines.slice(0, 15)) {
      const t = clean(l);
      if (t.length >= 2 && t.length <= 26 && !BAD_TITLE.test(t) && !ADDRESS.test(t)) return t;
    }
    return '';
  }

  function parseTextOnlyAuthor(text) {
    const lines = linesOf(text);
    for (const l of lines) {
      if (/譯\s*者|繪\s*者|編\s*者|編\s*輯|攝\s*影|美\s*術|封\s*面|總\s*編|責\s*任/.test(l)) continue;
      const m = l.match(/^(?:作\s*者|Author|撰文)\s*[：:]?\s*(.+)$/i);
      if (m) {
        const a = tidyAuthor(m[1]);
        if (a) return a;
      }
    }
    for (const l of lines) {
      const m = l.match(/[\/／]\s*([^；;\/／]{2,50})/);
      if (m && !/譯\s*者|繪\s*者/.test(l)) {
        const a = tidyAuthor(m[1]);
        if (a) return a;
      }
    }
    return '';
  }

  function parseTextOnlyPublisher(text) {
    const lines = linesOf(text);
    for (const l of lines) {
      if (/出版\s*(日期|年)/.test(l)) continue;
      const m = l.match(/^(?:出\s*版\s*者|出\s*版|Published\s*by)\s*[：:]?\s*(.+)$/i);
      if (m) {
        const p = clean(m[1]).replace(/[,，]\s*\d{4}.*$/, '');
        if (p.length >= 2 && p.length <= 40 && !ADDRESS.test(p)) return p;
      }
    }
    for (const l of lines) {
      if (COMPANY.test(l) && !ADDRESS.test(l) && l.length <= 40) return clean(l);
    }
    return '';
  }

  function parseTextOnly(text) {
    const t = String(text || '').replace(/\r/g, '');
    const title = parseTextOnlyTitle(t);
    const author = parseTextOnlyAuthor(t);
    const publisher = parseTextOnlyPublisher(t);
    const barcode = extractIsbn(t);
    const language = detectLanguage(title, author, t);
    const collection = suggestCollection(`${title}\n${author}\n${publisher}\n${t.slice(0, 1800)}`, language);
    const callLetter = suggestCallLetter(collection, language, author);
    return { title, author, publisher, barcode, language, collection, callLetter, confidence: 0 };
  }

  /* ---------- 對外 ---------- */
  async function recognize(provider, blob, key) {
    if (!key) throw makeErr(provider, 0, '未設定 API key');
    if (provider === 'vision') return visionRecognize(blob, key);
    if (provider === 'ocrspace') return ocrSpaceRecognize(blob, key);
    throw makeErr(provider, 0, '未知的辨識服務');
  }

  global.OCRCloud = {
    recognize,
    parseFields,
    parseTextOnly,
    extractIsbn,
    buildLines,
    normalizeIsbn,
    isbn13Valid,
    isbn10Valid,
    suggestCallLetter,
    detectLanguage,
    _parseVision: parseVisionResponse,
    COLLECTIONS,
    VISION_LIMIT: 950,
    OCRSPACE_DAILY: 500,
  };
})(window);
