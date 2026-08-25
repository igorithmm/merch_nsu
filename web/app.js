/* Мерч НГУ — учёт товара. Без фреймворков: состояние + перерисовка нужного блока. */

const state = {
  data: null,
  mode: localStorage.getItem('merch.mode') || 'sale',
  tab: 'stock',
  seller: localStorage.getItem('merch.seller') || '',
  filters: { q: '', kind: '', color: '', print: '', lowOnly: false },
  journal: { offset: 0, limit: 50, q: '', kind: '', seller: '', from: '', to: '', product_id: '' },
  report: { days: 30, from: '', to: '', kind: '', data: null },
  showArchived: false,
};

const MODES = {
  sale: {
    title: 'Продажа',
    banner: 'Режим продажи — нажатие на количество списывает 1 шт и пишет строку в журнал',
    primary: { delta: -1, kind: 'sale' },
    minus: { delta: -1, kind: 'sale' },
    plus: { delta: 1, kind: 'return' },
    hint: 'Тап по числу — продать 1 шт',
  },
  receipt: {
    title: 'Приёмка',
    banner: 'Режим приёмки — здесь товар только приходит на склад, продажи не пишутся',
    primary: { delta: 1, kind: 'receipt' },
    minus: { delta: -1, kind: 'correction' },
    plus: { delta: 1, kind: 'receipt' },
    hint: 'Тап по числу — принять 1 шт',
  },
  fix: {
    title: 'Коррекция',
    banner: 'Режим коррекции — правка остатков при инвентаризации, продажи не считаются',
    primary: 'set',
    minus: { delta: -1, kind: 'correction' },
    plus: { delta: 1, kind: 'correction' },
    hint: 'Тап по числу — задать точный остаток',
  },
};

const KIND_PILL = {
  sale: 'sale', return: 'return', receipt: 'receipt',
  correction: 'correction', writeoff: 'writeoff',
};

const SWATCHES = {
  'фиолетовая': '#7c4dcc', 'фиолетовый': '#7c4dcc', 'сиреневая': '#a98ae0',
  'чёрная': '#20242c', 'черная': '#20242c', 'чёрный': '#20242c', 'черный': '#20242c',
  'белая': '#f2f4f8', 'белый': '#f2f4f8', 'серая': '#9aa3b0', 'серый': '#9aa3b0',
  'синяя': '#2456b8', 'синий': '#2456b8', 'голубая': '#5aa9e6', 'тёмно-синяя': '#16326b',
  'красная': '#cf3030', 'красный': '#cf3030', 'бордовая': '#7d1f2e', 'бордовый': '#7d1f2e',
  'зелёная': '#2c8a52', 'зеленая': '#2c8a52', 'зелёный': '#2c8a52',
  'жёлтая': '#e5b52c', 'желтая': '#e5b52c', 'бежевая': '#d8c6a8', 'розовая': '#e28ab4',
  'оранжевая': '#e07a2b', 'хаки': '#6b7042', 'мятная': '#7fd0b8',
};

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const nf = new Intl.NumberFormat('ru-RU');
const money = (v) => nf.format(Math.round(v || 0)) + ' ₽';
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function plural(n, one, few, many) {
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
}
const pcs = (n) => `${nf.format(n)} ${plural(n, 'шт', 'шт', 'шт')}`;

function fmtDateTime(ts) {
  if (!ts) return '—';
  const [d, t] = String(ts).split(' ');
  if (!d) return ts;
  const [y, m, day] = d.split('-');
  return `${day}.${m}.${y}${t ? ' ' + t.slice(0, 5) : ''}`;
}
const today = () => new Date().toISOString().slice(0, 10);

/* ---------- Работа с сервером ---------- */

async function request(url, options) {
  const res = await fetch(url, options);
  let body = null;
  try { body = await res.json(); } catch (_) { /* пустой ответ */ }
  if (!res.ok) throw new Error((body && body.error) || `Ошибка ${res.status}`);
  return body;
}
const apiGet = (url, params) => {
  const qs = params ? '?' + new URLSearchParams(
    Object.entries(params).filter(([, v]) => v !== '' && v != null)).toString() : '';
  return request(url + qs);
};
const apiPost = (url, body) => request(url, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body || {}),
});
const apiDelete = (url) => request(url, { method: 'DELETE' });

/* ---------- Уведомления ---------- */

function toast(message, { kind = 'ok', undoId = null, timeout = 5000 } = {}) {
  const box = document.createElement('div');
  box.className = `toast toast--${kind}`;
  box.innerHTML = `<span>${message}</span>`;
  if (undoId) {
    const btn = document.createElement('button');
    btn.textContent = 'Отменить';
    btn.onclick = async () => {
      btn.disabled = true;
      try {
        await apiPost('/api/undo', { movement_id: undoId, seller: state.seller });
        box.remove();
        await reload();
        toast('Операция отменена');
      } catch (err) { btn.disabled = false; toast(err.message, { kind: 'err' }); }
    };
    box.appendChild(btn);
  }
  $('#toasts').appendChild(box);
  setTimeout(() => box.remove(), timeout);
}

/* ---------- Модальные окна ---------- */

function openModal({ title, body, buttons = [], onOpen }) {
  const modal = $('#modal');
  $('#modalTitle').textContent = title;
  const bodyBox = $('#modalBody');
  bodyBox.innerHTML = '';
  bodyBox.append(typeof body === 'string' ? document.createRange().createContextualFragment(body) : body);

  const foot = $('#modalFoot');
  foot.innerHTML = '';
  buttons.forEach((b) => {
    if (b.spacer) { const s = document.createElement('span'); s.className = 'spacer'; foot.appendChild(s); return; }
    const btn = document.createElement('button');
    btn.className = 'btn ' + (b.className || 'btn--ghost');
    btn.textContent = b.label;
    btn.onclick = () => b.onClick(closeModal);
    foot.appendChild(btn);
  });

  modal.hidden = false;
  if (onOpen) onOpen(bodyBox);
  const first = bodyBox.querySelector('input, select, textarea');
  if (first) setTimeout(() => first.focus(), 30);
}
function closeModal() { $('#modal').hidden = true; }

/* ---------- Загрузка состояния ---------- */

async function reload() {
  state.data = await apiGet('/api/bootstrap');
  if (!state.seller || !state.data.sellers.some((s) => s.name === state.seller && s.active)) {
    const first = state.data.sellers.find((s) => s.active);
    state.seller = first ? first.name : '';
    localStorage.setItem('merch.seller', state.seller);
  }
  renderSellerSelect();
  renderRepKinds();
  renderStock();
  if (state.tab === 'catalog') renderCatalog();
  if (state.tab === 'settings') renderSettings();
  if (state.tab === 'journal') loadJournal();
  if (state.tab === 'reports') loadReports();
}

/* ---------- Шапка ---------- */

function renderRepKinds() {
  const sel = $('#repKind');
  sel.innerHTML = '<option value="">Все типы товара</option>' +
    state.data.facets.kinds.map((k) =>
      `<option value="${esc(k)}" ${state.report.kind === k ? 'selected' : ''}>${esc(k)}</option>`).join('');
}

function renderSellerSelect() {
  const sel = $('#sellerSelect');
  const active = state.data.sellers.filter((s) => s.active);
  sel.innerHTML = active.length
    ? active.map((s) => `<option ${s.name === state.seller ? 'selected' : ''}>${esc(s.name)}</option>`).join('')
    : '<option value="">— добавьте в настройках —</option>';
  const journalSeller = $('#journalSeller');
  journalSeller.innerHTML = '<option value="">Все продавцы</option>' +
    state.data.sellers.map((s) => `<option ${s.name === state.journal.seller ? 'selected' : ''}>${esc(s.name)}</option>`).join('');
}

function setMode(mode) {
  state.mode = mode;
  localStorage.setItem('merch.mode', mode);
  $$('#modes .mode').forEach((b) => b.classList.toggle('is-active', b.dataset.mode === mode));
  const banner = $('#modeBanner');
  banner.dataset.mode = mode;
  banner.textContent = MODES[mode].banner;
  renderStock();
}

function setTab(tab) {
  state.tab = tab;
  $$('#tabs .tab').forEach((b) => b.classList.toggle('is-active', b.dataset.tab === tab));
  $$('.view').forEach((v) => { v.hidden = v.id !== `view-${tab}`; });
  if (tab === 'journal') loadJournal();
  if (tab === 'reports') loadReports();
  if (tab === 'catalog') renderCatalog();
  if (tab === 'settings') renderSettings();
}

/* ---------- Вкладка «Остатки» ---------- */

function visibleProducts() {
  const f = state.filters;
  const low = state.data.settings.low_stock;
  const needle = f.q.trim().toLowerCase();
  return state.data.products.filter((p) => {
    if (f.kind && p.kind !== f.kind) return false;
    if (f.color && p.color !== f.color) return false;
    if (f.print && p.print_name !== f.print) return false;
    if (f.lowOnly && !p.sizes.some((s) => s.qty <= low)) return false;
    if (needle) {
      const hay = `${p.kind} ${p.color} ${p.print_name} ${p.note}`.toLowerCase();
      if (!needle.split(/\s+/).every((word) => hay.includes(word))) return false;
    }
    return true;
  });
}

function renderFilters() {
  const { facets } = state.data;
  const f = state.filters;
  const kinds = facets.kinds.map((k) =>
    `<button class="chip ${f.kind === k ? 'is-active' : ''}" data-filter="kind" data-value="${esc(k)}">${esc(k)}</button>`).join('');
  const sel = (name, label, values, current) => values.length
    ? `<select class="select" data-filter="${name}">
         <option value="">${label}</option>
         ${values.map((v) => `<option value="${esc(v)}" ${current === v ? 'selected' : ''}>${esc(v)}</option>`).join('')}
       </select>` : '';
  $('#filters').innerHTML = kinds
    + sel('color', 'Любой цвет', facets.colors, f.color)
    + sel('print', 'Любой принт', facets.prints, f.print)
    + `<button class="chip chip--danger ${f.lowOnly ? 'is-active' : ''}" data-filter="lowOnly">Заканчивается</button>`;
  $('#resetFilters').hidden = !(f.kind || f.color || f.print || f.lowOnly || f.q);
}

function sizeClass(qty, low) {
  if (qty <= 0) return 'size--zero';
  if (qty <= low) return 'size--low';
  return '';
}

function renderStock() {
  renderFilters();
  const low = state.data.settings.low_stock;
  const grid = $('#productGrid');
  const items = visibleProducts();

  $('#stockLegend').innerHTML = state.data.products.length ? `
    <span><b>${items.length}</b> ${plural(items.length, 'модель', 'модели', 'моделей')} на экране</span>
    <span><span class="dot" style="background:var(--danger)"></span>0 шт — закончилось</span>
    <span><span class="dot" style="background:var(--warn)"></span>≤ ${low} шт — пора заказывать</span>` : '';

  if (!state.data.products.length) {
    grid.innerHTML = `<div class="empty">
      <div class="empty__title">Товаров пока нет</div>
      <p>Заведите первую модель на вкладке «Товары» — например, толстовку фиолетовую
         с большой печатью. Или посмотрите, как всё выглядит на готовом примере.</p>
      <button class="btn btn--primary" id="seedDemo">Заполнить примером</button>
    </div>`;
    return;
  }
  if (!items.length) {
    grid.innerHTML = `<div class="empty">
      <div class="empty__title">Ничего не нашлось</div>Попробуйте изменить поиск или сбросить фильтры.</div>`;
    return;
  }

  const mode = MODES[state.mode];
  grid.innerHTML = items.map((p) => {
    const swatch = SWATCHES[(p.color || '').toLowerCase()] || 'var(--border-strong)';
    const tiles = p.sizes.map((s) => `
      <div class="size ${sizeClass(s.qty, low)}" data-product="${p.id}" data-size="${esc(s.size)}">
        <div class="size__label">${esc(s.size)}</div>
        <button class="size__qty" data-act="primary"
                title="${esc(mode.hint)}" aria-label="${esc(p.title)}, размер ${esc(s.size)}: ${s.qty} шт">${s.qty}</button>
        <div class="size__ctl">
          <button data-act="minus" title="Убавить" ${s.qty <= 0 ? 'disabled' : ''}>−</button>
          <button data-act="plus" title="Прибавить">+</button>
        </div>
      </div>`).join('');

    const footBtn = state.mode === 'receipt'
      ? `<button class="btn btn--primary btn--sm" data-batch="${p.id}">Принять партию</button>`
      : state.mode === 'fix'
        ? `<button class="btn btn--sm" data-batch="${p.id}" data-inventory="1">Пересчитать всё</button>`
        : `<button class="btn btn--ghost btn--sm" data-history="${p.id}">История</button>`;

    return `<article class="card ${p.total === 0 ? 'is-empty' : ''}">
      <div class="card__head">
        <div class="card__swatch" style="background:${swatch}"></div>
        <div class="card__main">
          <div class="card__title">${esc(p.title)}</div>
          <div class="card__meta">
            <span class="tag">${esc(p.kind)}</span>
            ${p.color ? `<span class="tag">${esc(p.color)}</span>` : ''}
            ${p.print_name ? `<span class="tag">${esc(p.print_name)}</span>` : ''}
            ${p.note ? `<span class="tag">${esc(p.note)}</span>` : ''}
          </div>
        </div>
        <div class="card__side">
          <div class="card__price">${money(p.price)}</div>
          <div class="card__total">всего ${pcs(p.total)}</div>
        </div>
      </div>
      <div class="sizes">${tiles}</div>
      <div class="card__foot">${footBtn}<span class="card__hint">${esc(mode.hint)}</span></div>
    </article>`;
  }).join('');
}

/* ---------- Операции с остатком ---------- */

async function move(productId, size, delta, kind, note = '') {
  if (!state.seller && kind !== 'correction') {
    // Не блокируем работу, но напоминаем — журнал без имени бесполезен при сверке.
    toast('Продавец не выбран — запись уйдёт без имени', { kind: 'err', timeout: 3000 });
  }
  const res = await apiPost('/api/move', {
    product_id: productId, size, delta, kind, seller: state.seller, note,
  });
  applyQty(productId, size, res.qty, delta);
  return res;
}

function applyQty(productId, size, qty, delta) {
  const product = state.data.products.find((p) => p.id === productId);
  if (product) {
    const row = product.sizes.find((s) => s.size === size);
    if (row) row.qty = qty;
    else product.sizes.push({ size, qty });
    product.total = product.sizes.reduce((sum, s) => sum + s.qty, 0);
  }
  const tile = $(`.size[data-product="${productId}"][data-size="${CSS.escape(size)}"]`);
  if (tile) {
    tile.querySelector('.size__qty').textContent = qty;
    tile.className = `size ${sizeClass(qty, state.data.settings.low_stock)}`;
    tile.querySelector('[data-act="minus"]').disabled = qty <= 0;
    void tile.offsetWidth;
    tile.classList.add(delta < 0 ? 'flash-down' : 'flash-up');
    setTimeout(() => tile.classList.remove('flash-down', 'flash-up'), 460);
  }
  const card = tile && tile.closest('.card');
  if (card && product) {
    card.classList.toggle('is-empty', product.total === 0);
    const total = card.querySelector('.card__total');
    if (total) total.textContent = `всего ${pcs(product.total)}`;
  }
}

async function onTileAction(tile, act) {
  const productId = Number(tile.dataset.product);
  const size = tile.dataset.size;
  const product = state.data.products.find((p) => p.id === productId);
  const mode = MODES[state.mode];
  const action = act === 'primary' ? mode.primary : mode[act];

  if (action === 'set') return askExactQty(product, size);

  try {
    const res = await move(productId, size, action.delta, action.kind);
    const labels = {
      sale: [`Продано: <b>${esc(product.title)}</b>, размер ${esc(size)}`, 'sale'],
      return: [`Возврат: <b>${esc(product.title)}</b>, размер ${esc(size)}`, 'ok'],
      receipt: [`Принято 1 шт: <b>${esc(product.title)}</b>, размер ${esc(size)}`, 'ok'],
      correction: [`Остаток исправлен: ${esc(product.title)}, ${esc(size)} → ${res.qty}`, 'ok'],
    };
    const [text, tone] = labels[action.kind];
    toast(`${text} · осталось ${res.qty}`, { kind: tone, undoId: res.movement_id });
  } catch (err) {
    toast(err.message, { kind: 'err' });
  }
}

function askExactQty(product, size) {
  const row = product.sizes.find((s) => s.size === size);
  const current = row ? row.qty : 0;
  openModal({
    title: `Пересчёт: ${product.title}, размер ${size}`,
    body: `<label class="field">Сколько штук фактически на полке
             <input type="number" id="exactQty" min="0" value="${current}"></label>
           <label class="field">Комментарий <input type="text" id="exactNote" placeholder="Инвентаризация"></label>
           <p class="hint">Было по учёту: ${current} шт. Разница уйдёт в журнал как коррекция.</p>`,
    buttons: [
      { label: 'Отмена', onClick: (close) => close() },
      {
        label: 'Сохранить', className: 'btn--primary',
        onClick: async (close) => {
          const qty = Number($('#exactQty').value);
          if (!Number.isFinite(qty) || qty < 0) return toast('Введите число не меньше нуля', { kind: 'err' });
          try {
            const res = await apiPost('/api/set-qty', {
              product_id: product.id, size, qty, seller: state.seller, note: $('#exactNote').value,
            });
            applyQty(product.id, size, res.qty, res.qty - current);
            close();
            toast(`Остаток ${esc(product.title)} ${esc(size)}: ${current} → ${res.qty}`,
              { undoId: res.movement_id });
          } catch (err) { toast(err.message, { kind: 'err' }); }
        },
      },
    ],
  });
}

/* ---------- Приёмка партии / инвентаризация модели ---------- */

function openBatch(productId, inventory = false) {
  const product = state.data.products.find((p) => p.id === productId);
  if (!product) return;
  const fields = product.sizes.map((s) => `
    <label><b>${esc(s.size)}</b>
      <input type="number" min="0" data-size="${esc(s.size)}"
             value="${inventory ? s.qty : ''}" placeholder="—">
      <span class="was muted">${inventory ? 'по учёту ' + s.qty : 'есть ' + s.qty}</span>
    </label>`).join('');

  openModal({
    title: inventory ? `Пересчёт: ${product.title}` : `Приёмка партии: ${product.title}`,
    body: `<p class="hint">${inventory
        ? 'Впишите фактическое количество по каждому размеру. Разница попадёт в журнал как коррекция.'
        : 'Впишите, сколько штук пришло по каждому размеру. Пустые поля пропускаются.'}</p>
      <div class="batch">${fields}</div>
      <label class="field" style="margin-top:16px">Комментарий к операции
        <input type="text" id="batchNote" placeholder="${inventory ? 'Инвентаризация' : 'Накладная №…'}"></label>`,
    buttons: [
      { label: 'Отмена', onClick: (close) => close() },
      {
        label: inventory ? 'Записать пересчёт' : 'Принять',
        className: 'btn--primary',
        onClick: async (close) => {
          const note = $('#batchNote').value;
          const inputs = $$('#modalBody .batch input');
          try {
            if (inventory) {
              let changed = 0;
              for (const input of inputs) {
                if (input.value === '') continue;
                const qty = Number(input.value);
                const row = product.sizes.find((s) => s.size === input.dataset.size);
                if (!Number.isFinite(qty) || qty < 0 || (row && row.qty === qty)) continue;
                await apiPost('/api/set-qty', {
                  product_id: productId, size: input.dataset.size, qty, seller: state.seller, note,
                });
                changed += 1;
              }
              close();
              await reload();
              toast(changed ? `Пересчёт записан: изменено ${changed} ${plural(changed, 'размер', 'размера', 'размеров')}`
                            : 'Расхождений не найдено');
            } else {
              const items = {};
              inputs.forEach((input) => {
                const qty = Number(input.value);
                if (input.value !== '' && Number.isFinite(qty) && qty > 0) items[input.dataset.size] = qty;
              });
              const res = await apiPost('/api/receipt', { product_id: productId, items, seller: state.seller, note });
              close();
              await reload();
              toast(`Принято ${pcs(res.total)}: <b>${esc(product.title)}</b>`, { kind: 'ok' });
            }
          } catch (err) { toast(err.message, { kind: 'err' }); }
        },
      },
    ],
  });
}

/* ---------- Журнал ---------- */

async function loadJournal() {
  const j = state.journal;
  const params = {
    limit: j.limit, offset: j.offset, q: j.q, kind: j.kind,
    seller: j.seller, from: j.from, to: j.to, product_id: j.product_id,
  };
  const focused = j.product_id && state.data.products.find((p) => p.id === Number(j.product_id));
  $('#journalFocus').innerHTML = focused
    ? `<span class="chip is-active" data-clear-focus>Только «${esc(focused.title)}» ✕</span>` : '';
  $('#journalExport').href = '/api/export/movements.csv?' + new URLSearchParams(
    Object.entries(params).filter(([k, v]) => v !== '' && v != null && k !== 'limit' && k !== 'offset')).toString();

  let data;
  try { data = await apiGet('/api/movements', params); }
  catch (err) { return toast(err.message, { kind: 'err' }); }

  const body = $('#journalBody');
  if (!data.items.length) {
    body.innerHTML = `<tr><td colspan="9"><div class="empty">
      <div class="empty__title">Записей нет</div>Здесь появятся все продажи, приёмки и коррекции.</div></td></tr>`;
  } else {
    body.innerHTML = data.items.map((m) => `
      <tr class="${m.undone ? 'row-undone' : ''}">
        <td class="num muted" style="white-space:nowrap">${fmtDateTime(m.ts)}</td>
        <td><span class="pill pill--${KIND_PILL[m.kind] || 'correction'}">${esc(m.kind_label)}</span></td>
        <td>${esc(m.title)}</td>
        <td class="ta-c num">${esc(m.size)}</td>
        <td class="ta-c num" style="font-weight:650;color:${m.delta < 0 ? 'var(--danger)' : 'var(--ok)'}">
          ${m.delta > 0 ? '+' : ''}${m.delta}</td>
        <td class="ta-r num">${m.amount ? money(m.amount) : '<span class="muted">—</span>'}</td>
        <td>${esc(m.seller) || '<span class="muted">—</span>'}</td>
        <td class="muted">${esc(m.note)}</td>
        <td class="ta-r">${m.undone ? '<span class="muted">отменено</span>'
          : `<button class="btn btn--sm btn--danger" data-undo="${m.id}">Откатить</button>`}</td>
      </tr>`).join('');
  }

  const from = data.total ? data.offset + 1 : 0;
  const to = Math.min(data.offset + data.limit, data.total);
  $('#journalPager').innerHTML = `
    <button class="btn btn--sm" data-page="prev" ${data.offset === 0 ? 'disabled' : ''}>← Раньше</button>
    <span>${from}–${to} из ${nf.format(data.total)}</span>
    <button class="btn btn--sm" data-page="next" ${to >= data.total ? 'disabled' : ''}>Позже →</button>`;
}

/* ---------- Отчёты ---------- */

async function loadReports() {
  const r = state.report;
  const params = r.from && r.to
    ? { from: r.from, to: r.to, dead_days: state.data.settings.dead_days, kind: r.kind }
    : { days: r.days, dead_days: state.data.settings.dead_days, kind: r.kind };
  $$('#periods .chip').forEach((c) => c.classList.toggle('is-active', !r.from && Number(c.dataset.days) === r.days));

  let data;
  try { data = await apiGet('/api/reports', params); }
  catch (err) { return toast(err.message, { kind: 'err' }); }
  r.data = data;
  renderReports(data);
}

function renderReports(rep) {
  const s = rep.summary;
  const stat = (label, value, hint) =>
    `<div class="stat"><div class="stat__label">${label}</div>
       <div class="stat__value">${value}</div>
       ${hint ? `<div class="stat__hint">${hint}</div>` : ''}</div>`;

  const bar = (share, cls = '') =>
    `<div class="bar ${cls}"><span style="width:${Math.min(100, share)}%"></span></div>`;

  const topRows = rep.top.length ? rep.top.map((r) => `
    <tr><td>${esc(r.title)}</td>
      <td class="ta-c num">${nf.format(r.sold)}</td>
      <td class="ta-r num">${money(r.revenue)}</td>
      <td class="ta-c num">${nf.format(r.stock)}</td>
      <td class="ta-c num muted">${r.days_left != null ? Math.round(r.days_left) + ' дн' : '—'}</td>
      <td style="width:150px">${bar(rep.top[0].sold ? r.sold / rep.top[0].sold * 100 : 0)}</td>
    </tr>`).join('')
    : `<tr><td colspan="6"><div class="empty">За период продаж не было</div></td></tr>`;

  const sizeTable = (group) => `
    ${rep.sizes.length > 1 ? `<h3 class="subhead">${esc(group.label)}</h3>` : ''}
    <div class="table-wrap"><table class="table"><thead><tr>
      <th>Размер</th><th class="ta-c">Продано</th><th>Доля продаж</th>
      <th class="ta-c">Остаток</th><th>Доля остатка</th><th class="ta-c">Хватит на</th>
    </tr></thead><tbody>${group.items.map((r) => `
      <tr><td class="num" style="font-weight:650">${esc(r.size)}</td>
        <td class="ta-c num">${nf.format(r.sold)}</td>
        <td style="width:130px">${bar(r.sold_share)}</td>
        <td class="ta-c num" style="${r.stock === 0 ? 'color:var(--danger);font-weight:650' : ''}">${nf.format(r.stock)}</td>
        <td style="width:130px">${bar(r.stock_share, 'bar--stock')}</td>
        <td class="ta-c num muted">${r.days_left != null ? Math.round(r.days_left) + ' дн' : '—'}</td>
      </tr>`).join('')}</tbody></table></div>`;
  const sizeBlocks = rep.sizes.length
    ? rep.sizes.map(sizeTable).join('')
    : '<div class="empty">Нет данных за период</div>';

  const restockRows = rep.restock.length ? rep.restock.map((r) => `
    <tr><td>${esc(r.title)}</td>
      <td class="ta-c num" style="font-weight:650">${esc(r.size)}</td>
      <td class="ta-c num" style="${r.stock === 0 ? 'color:var(--danger);font-weight:650' : ''}">${r.stock}</td>
      <td class="ta-c num">${r.sold}</td>
      <td class="ta-c num muted">${r.days_left != null ? Math.round(r.days_left) + ' дн' : '—'}</td>
      <td class="ta-c num" style="font-weight:650">${r.suggest}</td>
    </tr>`).join('')
    : `<tr><td colspan="6"><div class="empty">Дефицита нет — всё в достатке</div></td></tr>`;

  const deadRows = rep.dead.length ? rep.dead.map((r) => `
    <tr><td>${esc(r.title)}</td>
      <td class="ta-c num">${nf.format(r.stock)}</td>
      <td class="ta-r num">${money(r.frozen)}</td>
      <td class="num muted">${r.last_sale ? fmtDateTime(r.last_sale) : 'ни разу не продавался'}</td>
      <td class="ta-c num" style="font-weight:650">${r.idle_days} дн</td>
    </tr>`).join('')
    : `<tr><td colspan="5"><div class="empty">Залежавшихся позиций нет</div></td></tr>`;

  $('#reportBody').innerHTML = `
    <div class="stats">
      ${stat('Продано', pcs(s.sold_qty), `${s.per_day} шт в день · ${s.days} ${plural(s.days, 'день', 'дня', 'дней')}`)}
      ${stat('Выручка', money(s.revenue), s.returned_qty ? `возвраты: ${pcs(s.returned_qty)}` : 'возвратов нет')}
      ${stat('Средняя цена', money(s.avg_price), `${nf.format(s.sales_ops)} ${plural(s.sales_ops, 'продажа', 'продажи', 'продаж')}`)}
      ${stat('Принято', pcs(s.received_qty), 'за период')}
      ${stat('Сейчас на складе', pcs(s.stock_qty), `на ${money(s.stock_amount)}`)}
    </div>

    <div class="panel">
      <h2 class="panel__title">Что продаётся</h2>
      <p class="panel__hint">Период ${fmtDateTime(s.date_from)} — ${fmtDateTime(s.date_to)}. «Хватит на» — при текущем темпе продаж.</p>
      <div class="table-wrap"><table class="table"><thead><tr>
        <th>Модель</th><th class="ta-c">Продано</th><th class="ta-r">Выручка</th>
        <th class="ta-c">Остаток</th><th class="ta-c">Хватит на</th><th></th>
      </tr></thead><tbody>${topRows}</tbody></table></div>
    </div>

    <div class="panel">
      <h2 class="panel__title">Какие размеры вымываются первыми</h2>
      <p class="panel__hint">Слева доля в продажах, справа доля в остатке. Если синяя полоса заметно длиннее серой — размер уходит быстрее, чем лежит на складе, и его стоит заказывать больше.</p>
      ${sizeBlocks}
    </div>

    <div class="panel">
      <h2 class="panel__title">Пора заказывать</h2>
      <p class="panel__hint">Позиции, которые продаются и вот-вот закончатся. «Заказать» — оценка на месяц вперёд по текущему темпу.</p>
      <div class="table-wrap"><table class="table"><thead><tr>
        <th>Модель</th><th class="ta-c">Размер</th><th class="ta-c">Остаток</th>
        <th class="ta-c">Продано</th><th class="ta-c">Хватит на</th><th class="ta-c">Заказать</th>
      </tr></thead><tbody>${restockRows}</tbody></table></div>
    </div>

    <div class="panel">
      <h2 class="panel__title">Лежит без движения</h2>
      <p class="panel__hint">Товар с остатком, который не продавался ${rep.dead_days} ${plural(rep.dead_days, 'день', 'дня', 'дней')} и дольше. Порог меняется в настройках.</p>
      <div class="table-wrap"><table class="table"><thead><tr>
        <th>Модель</th><th class="ta-c">Остаток</th><th class="ta-r">Заморожено</th>
        <th>Последняя продажа</th><th class="ta-c">Простой</th>
      </tr></thead><tbody>${deadRows}</tbody></table></div>
    </div>`;
}

/* ---------- Вкладка «Товары» ---------- */

async function renderCatalog() {
  let products = state.data.products;
  if (state.showArchived) {
    products = (await apiGet('/api/products', { archived: 1 })).products;
  }
  const body = $('#catalogBody');
  if (!products.length) {
    body.innerHTML = `<tr><td colspan="8"><div class="empty">
      <div class="empty__title">Список пуст</div>Нажмите «Новая модель», чтобы завести первый товар.</div></td></tr>`;
    return;
  }
  body.innerHTML = products.map((p) => `
    <tr style="${p.archived ? 'opacity:.55' : ''}">
      <td style="font-weight:600">${esc(p.title)}${p.archived ? ' <span class="tag">архив</span>' : ''}</td>
      <td>${esc(p.kind)}</td><td>${esc(p.color) || '<span class="muted">—</span>'}</td>
      <td>${esc(p.print_name) || '<span class="muted">—</span>'}</td>
      <td class="ta-r num">${money(p.price)}</td>
      <td class="ta-c muted num">${p.sizes.map((s) => s.size).join(', ')}</td>
      <td class="ta-c num" style="font-weight:650">${p.total}</td>
      <td class="ta-r" style="white-space:nowrap">
        <button class="btn btn--sm" data-edit="${p.id}">Изменить</button>
        <button class="btn btn--sm" data-archive="${p.id}" data-to="${p.archived ? 0 : 1}">${p.archived ? 'Вернуть' : 'В архив'}</button>
        ${p.total === 0 ? `<button class="btn btn--sm btn--danger" data-delete="${p.id}">Удалить</button>` : ''}
      </td>
    </tr>`).join('');
}

function openProductForm(product) {
  const presets = state.data.size_presets;
  const sizes = product ? product.sizes.map((s) => s.size).join(', ') : presets[0].sizes.join(', ');
  const kindList = state.data.facets.kind_suggestions;

  openModal({
    title: product ? `Изменить: ${product.title}` : 'Новая модель',
    body: `
      <div class="field2">
        <label class="field">Тип товара
          <input type="text" id="pKind" list="kindList" placeholder="Толстовка" value="${esc(product?.kind || '')}">
          <datalist id="kindList">${kindList.map((k) => `<option value="${esc(k)}">`).join('')}</datalist>
        </label>
        <label class="field">Цвет
          <input type="text" id="pColor" placeholder="фиолетовая" value="${esc(product?.color || '')}"></label>
        <label class="field">Принт
          <input type="text" id="pPrint" placeholder="большая печать" value="${esc(product?.print_name || '')}"></label>
        <label class="field">Цена, ₽
          <input type="number" id="pPrice" min="0" step="10" value="${product?.price ?? 0}"></label>
      </div>
      <label class="field">Размерный ряд
        <div class="row" style="margin-bottom:6px">
          ${presets.map((p) => `<button type="button" class="chip" data-preset="${p.sizes.join(',')}">${esc(p.label)}</button>`).join('')}
        </div>
        <input type="text" id="pSizes" value="${esc(sizes)}">
      </label>
      <p class="hint">Через запятую. Размер с остатком удалить нельзя — сначала спишите товар.</p>
      <label class="field">Заметка
        <input type="text" id="pNote" placeholder="например, лимитированная партия" value="${esc(product?.note || '')}"></label>`,
    onOpen: (box) => {
      box.querySelectorAll('[data-preset]').forEach((btn) => {
        btn.onclick = () => { $('#pSizes').value = btn.dataset.preset.split(',').join(', '); };
      });
    },
    buttons: [
      { label: 'Отмена', onClick: (close) => close() },
      {
        label: product ? 'Сохранить' : 'Создать', className: 'btn--primary',
        onClick: async (close) => {
          const payload = {
            kind: $('#pKind').value, color: $('#pColor').value, print_name: $('#pPrint').value,
            price: $('#pPrice').value, sizes: $('#pSizes').value, note: $('#pNote').value,
          };
          try {
            await apiPost(product ? `/api/products/${product.id}` : '/api/products', payload);
            close();
            await reload();
            await renderCatalog();
            toast(product ? 'Изменения сохранены' : 'Модель добавлена');
          } catch (err) { toast(err.message, { kind: 'err' }); }
        },
      },
    ],
  });
}

/* ---------- Вкладка «Настройки» ---------- */

function renderSettings() {
  $('#lowStock').value = state.data.settings.low_stock;
  $('#deadDays').value = state.data.settings.dead_days;
  $('#sellerList').innerHTML = state.data.sellers.length
    ? state.data.sellers.map((s) => `
      <li>
        <span class="name ${s.active ? '' : 'is-off'}">${esc(s.name)}</span>
        <button class="btn btn--sm" data-seller="${s.id}" data-active="${s.active ? 0 : 1}">
          ${s.active ? 'Убрать из смены' : 'Вернуть'}</button>
      </li>`).join('')
    : '<li class="muted">Пока никого. Добавьте хотя бы одного продавца.</li>';
}

/* ---------- События ---------- */

function bind() {
  $('#modes').addEventListener('click', (e) => {
    const btn = e.target.closest('.mode');
    if (btn) setMode(btn.dataset.mode);
  });
  $('#tabs').addEventListener('click', (e) => {
    const btn = e.target.closest('.tab');
    if (btn) setTab(btn.dataset.tab);
  });
  $('#sellerSelect').addEventListener('change', (e) => {
    state.seller = e.target.value;
    localStorage.setItem('merch.seller', state.seller);
  });
  $('#themeBtn').addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    localStorage.setItem('merch.theme', next);
  });

  // Остатки
  let searchTimer;
  $('#search').addEventListener('input', (e) => {
    clearTimeout(searchTimer);
    const value = e.target.value;
    searchTimer = setTimeout(() => { state.filters.q = value; renderStock(); }, 120);
  });
  $('#filters').addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    const key = chip.dataset.filter;
    if (key === 'lowOnly') state.filters.lowOnly = !state.filters.lowOnly;
    else state.filters[key] = state.filters[key] === chip.dataset.value ? '' : chip.dataset.value;
    renderStock();
  });
  $('#filters').addEventListener('change', (e) => {
    const sel = e.target.closest('select[data-filter]');
    if (!sel) return;
    state.filters[sel.dataset.filter] = sel.value;
    renderStock();
  });
  $('#resetFilters').addEventListener('click', () => {
    state.filters = { q: '', kind: '', color: '', print: '', lowOnly: false };
    $('#search').value = '';
    renderStock();
  });

  $('#productGrid').addEventListener('click', async (e) => {
    const seed = e.target.closest('#seedDemo');
    if (seed) {
      if (!confirm('Заполнить базу примером товаров и продаж? Это делается один раз, в пустую базу.')) return;
      seed.disabled = true;
      try {
        const res = await apiPost('/api/demo');
        await reload();
        toast(`Пример добавлен: ${res.added} ${plural(res.added, 'модель', 'модели', 'моделей')}`);
      } catch (err) { seed.disabled = false; toast(err.message, { kind: 'err' }); }
      return;
    }
    const batch = e.target.closest('[data-batch]');
    if (batch) return openBatch(Number(batch.dataset.batch), batch.dataset.inventory === '1');
    const history = e.target.closest('[data-history]');
    if (history) {
      state.journal = { offset: 0, limit: 50, q: '', kind: '', seller: '', from: '', to: '',
                        product_id: Number(history.dataset.history) };
      ['journalSearch', 'journalKind', 'journalSeller', 'journalFrom', 'journalTo']
        .forEach((id) => { $('#' + id).value = ''; });
      return setTab('journal');
    }
    const actBtn = e.target.closest('[data-act]');
    if (!actBtn) return;
    const tile = actBtn.closest('.size');
    if (tile) onTileAction(tile, actBtn.dataset.act);
  });

  // Журнал
  let jTimer;
  $('#journalSearch').addEventListener('input', (e) => {
    clearTimeout(jTimer);
    const value = e.target.value;
    jTimer = setTimeout(() => { state.journal.q = value; state.journal.offset = 0; loadJournal(); }, 220);
  });
  ['journalKind', 'journalSeller', 'journalFrom', 'journalTo'].forEach((id) => {
    $('#' + id).addEventListener('change', () => {
      state.journal.kind = $('#journalKind').value;
      state.journal.seller = $('#journalSeller').value;
      state.journal.from = $('#journalFrom').value;
      state.journal.to = $('#journalTo').value;
      state.journal.offset = 0;
      loadJournal();
    });
  });
  $('#journalReset').addEventListener('click', () => {
    state.journal = { offset: 0, limit: 50, q: '', kind: '', seller: '', from: '', to: '', product_id: '' };
    ['journalSearch', 'journalKind', 'journalSeller', 'journalFrom', 'journalTo']
      .forEach((id) => { $('#' + id).value = ''; });
    loadJournal();
  });
  $('#journalBody').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-undo]');
    if (!btn) return;
    btn.disabled = true;
    try {
      await apiPost('/api/undo', { movement_id: Number(btn.dataset.undo), seller: state.seller });
      await reload();
      toast('Операция откачена, остаток восстановлен');
    } catch (err) { btn.disabled = false; toast(err.message, { kind: 'err' }); }
  });
  $('#journalFocus').addEventListener('click', (e) => {
    if (!e.target.closest('[data-clear-focus]')) return;
    state.journal.product_id = '';
    state.journal.offset = 0;
    loadJournal();
  });
  $('#journalPager').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-page]');
    if (!btn) return;
    state.journal.offset = Math.max(0, state.journal.offset +
      (btn.dataset.page === 'next' ? state.journal.limit : -state.journal.limit));
    loadJournal();
  });

  // Отчёты
  $('#periods').addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    state.report.days = Number(chip.dataset.days);
    state.report.from = state.report.to = '';
    $('#repFrom').value = ''; $('#repTo').value = '';
    loadReports();
  });
  $('#repKind').addEventListener('change', (e) => {
    state.report.kind = e.target.value;
    loadReports();
  });
  ['repFrom', 'repTo'].forEach((id) => $('#' + id).addEventListener('change', () => {
    state.report.from = $('#repFrom').value;
    state.report.to = $('#repTo').value || today();
    if (state.report.from) loadReports();
  }));

  // Товары
  $('#addProduct').addEventListener('click', () => openProductForm(null));
  $('#showArchived').addEventListener('change', (e) => {
    state.showArchived = e.target.checked;
    renderCatalog();
  });
  $('#catalogBody').addEventListener('click', async (e) => {
    const edit = e.target.closest('[data-edit]');
    if (edit) {
      const list = state.showArchived ? (await apiGet('/api/products', { archived: 1 })).products : state.data.products;
      return openProductForm(list.find((p) => p.id === Number(edit.dataset.edit)));
    }
    const archive = e.target.closest('[data-archive]');
    if (archive) {
      try {
        await apiPost(`/api/products/${archive.dataset.archive}/archive`, { archived: archive.dataset.to === '1' });
        await reload();
        await renderCatalog();
        toast(archive.dataset.to === '1' ? 'Модель убрана в архив' : 'Модель возвращена в работу');
      } catch (err) { toast(err.message, { kind: 'err' }); }
      return;
    }
    const del = e.target.closest('[data-delete]');
    if (del) {
      if (!confirm('Удалить модель насовсем? Отменить будет нельзя.')) return;
      try {
        await apiDelete(`/api/products/${del.dataset.delete}`);
        await reload();
        await renderCatalog();
        toast('Модель удалена');
      } catch (err) { toast(err.message, { kind: 'err' }); }
    }
  });

  // Настройки
  $('#sellerForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = $('#sellerName').value.trim();
    if (!name) return;
    try {
      await apiPost('/api/sellers', { name });
      $('#sellerName').value = '';
      await reload();
      renderSettings();
      toast(`Продавец «${esc(name)}» добавлен`);
    } catch (err) { toast(err.message, { kind: 'err' }); }
  });
  $('#sellerList').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-seller]');
    if (!btn) return;
    try {
      await apiPost(`/api/sellers/${btn.dataset.seller}/active`, { active: btn.dataset.active === '1' });
      await reload();
      renderSettings();
    } catch (err) { toast(err.message, { kind: 'err' }); }
  });
  $('#shutdownBtn').addEventListener('click', async () => {
    if (!confirm('Завершить работу приложения? Все данные уже сохранены.')) return;
    try { await apiPost('/api/shutdown'); } catch (_) { /* сервер закрылся, не дослав ответ */ }
    showFarewell();
  });
  $('#saveSettings').addEventListener('click', async () => {
    try {
      await apiPost('/api/settings', {
        low_stock: Number($('#lowStock').value) || 0,
        dead_days: Number($('#deadDays').value) || 30,
      });
      await reload();
      toast('Настройки сохранены');
    } catch (err) { toast(err.message, { kind: 'err' }); }
  });

  // Модалка
  $('#modal').addEventListener('click', (e) => { if (e.target.closest('[data-close]')) closeModal(); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !$('#modal').hidden) return closeModal();
    if (e.key === '/' && document.activeElement.tagName !== 'INPUT' && state.tab === 'stock') {
      e.preventDefault();
      $('#search').focus();
    }
    if (e.key === 'Enter' && !$('#modal').hidden) {
      const primary = $('#modalFoot .btn--primary');
      if (primary && document.activeElement.tagName !== 'TEXTAREA') primary.click();
    }
  });
}

function showFarewell() {
  document.body.innerHTML = `<div class="farewell">
    <div class="farewell__mark">НГУ</div>
    <h1>Приложение закрыто</h1>
    <p>Все продажи и приёмки сохранены в базе. Эту вкладку можно закрыть.</p>
    <p class="muted">Чтобы начать работу снова, дважды щёлкните по ярлыку «Запустить».</p>
  </div>`;
}

/* ---------- Старт ---------- */

async function init() {
  document.documentElement.dataset.theme =
    localStorage.getItem('merch.theme') ||
    (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');

  bind();
  try {
    state.data = await apiGet('/api/bootstrap');
  } catch (err) {
    document.body.innerHTML = `<div class="empty"><div class="empty__title">Не удалось связаться с сервером</div>
      Запустите приложение командой <code>python run.py</code> и обновите страницу.</div>`;
    return;
  }

  $('#journalKind').innerHTML = '<option value="">Все операции</option>' +
    Object.entries(state.data.kind_labels).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('');
  $('#repTo').value = today();

  if (!state.seller) {
    const first = state.data.sellers.find((s) => s.active);
    state.seller = first ? first.name : '';
  }
  renderSellerSelect();
  renderRepKinds();
  setMode(state.mode);
  setTab('stock');
}

init();
