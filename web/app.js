/* Мерч НГУ — учёт товара. Без фреймворков: состояние + перерисовка нужного блока. */

const state = {
  data: null,
  tab: 'stock',
  seller: localStorage.getItem('merch.seller') || '',
  filters: { q: '', category: '', kind: '', color: '', print: '', lowOnly: false, no1c: false },
  journal: { offset: 0, limit: 50, q: '', kind: '', group: '', seller: '', from: '', to: '',
             product_id: '', trash: false },
  wishes: { q: '', status: '' },
  report: { days: 30, from: '', to: '', kind: '', category: '', data: null },
  showArchived: false,
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

const PILL = {
  sale: 'sale', return: 'return', receipt: 'receipt', defect: 'defect',
  mistake: 'correction', correction: 'correction', writeoff: 'defect',
  product_added: 'event', product_edited: 'event', product_archived: 'event',
  product_restored: 'event', product_deleted: 'event',
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
const pcs = (n) => `${nf.format(n)} шт`;

function fmtDateTime(ts) {
  if (!ts) return '—';
  const [d, t] = String(ts).split(' ');
  if (!d) return ts;
  const [y, m, day] = d.split('-');
  return `${day}.${m}.${y}${t ? ' ' + t.slice(0, 5) : ''}`;
}
const fmtDate = (d) => (d ? fmtDateTime(d).split(' ')[0] : '—');
const today = () => new Date().toISOString().slice(0, 10);
const isSouvenir = (p) => p.category === 'souvenir';

/* ---------- Работа с сервером ---------- */

async function request(url, options) {
  const res = await fetch(url, options);
  let body = null;
  try { body = await res.json(); } catch (_) { /* пустой ответ */ }
  if (!res.ok) throw new Error((body && body.error) || `Ошибка ${res.status}`);
  return body;
}
const qs = (params) => params ? '?' + new URLSearchParams(
  Object.entries(params).filter(([, v]) => v !== '' && v != null && v !== false)).toString() : '';
const apiGet = (url, params) => request(url + qs(params));
const apiPost = (url, body) => request(url, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ seller: state.seller, ...(body || {}) }),
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
        await apiPost('/api/undo', { movement_id: undoId });
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

/* ---------- Меню причин на кнопках − и + ---------- */

let popContext = null;

function openReasonPopover(anchor, product, size, direction) {
  const reasons = direction > 0 ? state.data.plus_reasons : state.data.minus_reasons;
  popContext = { product, size, direction };

  const label = isSouvenir(product) ? product.title : `${product.title}, размер ${size}`;
  $('#popTitle').innerHTML =
    `<b>${direction > 0 ? 'Прибавить' : 'Убавить'}</b> · ${esc(label)}`;
  $('#popQty').value = 1;
  $('#popList').innerHTML = reasons.map((r) => `
    <button class="pop__item" data-kind="${r.kind}">
      <span class="pop__label">${esc(r.label)}</span>
      <span class="pop__hint">${esc(r.hint)}</span>
    </button>`).join('');

  const pop = $('#pop');
  pop.hidden = false;
  const box = anchor.getBoundingClientRect();
  const width = pop.offsetWidth;
  let left = box.left + box.width / 2 - width / 2;
  left = Math.max(10, Math.min(left, window.innerWidth - width - 10));
  let top = box.bottom + 8;
  if (top + pop.offsetHeight > window.innerHeight - 10) top = box.top - pop.offsetHeight - 8;
  pop.style.left = `${left}px`;
  pop.style.top = `${Math.max(10, top)}px`;
}

function closePopover() {
  $('#pop').hidden = true;
  popContext = null;
}

async function applyReason(kind) {
  if (!popContext) return;
  const { product, size, direction } = popContext;
  const qty = Math.max(1, Number($('#popQty').value) || 1);
  closePopover();
  try {
    const res = await apiPost('/api/move', {
      product_id: product.id, size, delta: direction * qty, kind,
    });
    applyQty(product.id, size, res.qty, direction);
    const label = state.data.kind_labels[kind];
    const where = isSouvenir(product) ? product.title : `${product.title}, ${size}`;
    toast(`${esc(label)}: <b>${esc(where)}</b> ${direction > 0 ? '+' : '−'}${qty} · осталось ${res.qty}`
      + (res.needs_punch ? ' <span class="toast__warn">не пробито в кассе</span>' : ''),
      { kind: direction > 0 ? 'ok' : 'sale', undoId: qty === 1 ? res.movement_id : null });
    if (res.needs_punch) refreshCounters();
  } catch (err) {
    toast(err.message, { kind: 'err' });
  }
}

/* ---------- Загрузка состояния ---------- */

async function reload() {
  state.data = await apiGet('/api/bootstrap');
  if (!state.seller || !state.data.sellers.some((s) => s.name === state.seller && s.active)) {
    const first = state.data.sellers.find((s) => s.active);
    state.seller = first ? first.name : '';
    localStorage.setItem('merch.seller', state.seller);
  }
  renderSellerSelect();
  renderRepFilters();
  renderBadges();
  renderStock();
  if (state.tab === 'catalog') renderCatalog();
  if (state.tab === 'settings') renderSettings();
  if (state.tab === 'journal') loadJournal();
  if (state.tab === 'reports') loadReports();
  if (state.tab === 'punch') loadUnpunched();
  if (state.tab === 'wishes') loadWishes();
}

async function refreshCounters() {
  const fresh = await apiGet('/api/bootstrap');
  state.data.counters = fresh.counters;
  state.data.products = fresh.products;
  renderBadges();
}

function renderBadges() {
  const c = state.data.counters;
  $$('[data-badge]').forEach((el) => {
    const value = c[el.dataset.badge] || 0;
    el.textContent = value ? nf.format(value) : '';
    el.hidden = !value;
  });
}

/* ---------- Шапка ---------- */

function renderSellerSelect() {
  const active = state.data.sellers.filter((s) => s.active);
  const options = (selected) => active.length
    ? active.map((s) => `<option ${s.name === selected ? 'selected' : ''}>${esc(s.name)}</option>`).join('')
    : '<option value="">— добавьте в настройках —</option>';
  $('#sellerSelect').innerHTML = options(state.seller);
  $('#wSeller').innerHTML = options(state.seller);
  $('#journalSeller').innerHTML = '<option value="">Все продавцы</option>' +
    state.data.sellers.map((s) =>
      `<option ${s.name === state.journal.seller ? 'selected' : ''}>${esc(s.name)}</option>`).join('');
}

function renderRepFilters() {
  const cats = state.data.categories;
  $('#repCategory').innerHTML = '<option value="">Все категории</option>' +
    Object.entries(cats).map(([id, label]) =>
      `<option value="${id}" ${state.report.category === id ? 'selected' : ''}>${esc(label)}</option>`).join('');
  $('#repKind').innerHTML = '<option value="">Все типы товара</option>' +
    state.data.facets.kinds.map((k) =>
      `<option value="${esc(k)}" ${state.report.kind === k ? 'selected' : ''}>${esc(k)}</option>`).join('');
  $('#wishStatus').innerHTML = '<option value="">Активные</option>' +
    state.data.wish_statuses.map((s) =>
      `<option value="${s.id}" ${state.wishes.status === s.id ? 'selected' : ''}>${esc(s.label)}</option>`).join('') +
    '<option value="__all">Все, включая закрытые</option>';
}

function setTab(tab) {
  state.tab = tab;
  $$('#tabs .tab').forEach((b) => b.classList.toggle('is-active', b.dataset.tab === tab));
  $$('.view').forEach((v) => { v.hidden = v.id !== `view-${tab}`; });
  if (tab === 'stock') renderStock();
  if (tab === 'journal') loadJournal();
  if (tab === 'reports') loadReports();
  if (tab === 'catalog') renderCatalog();
  if (tab === 'settings') renderSettings();
  if (tab === 'punch') loadUnpunched();
  if (tab === 'wishes') loadWishes();
}

/* ---------- Вкладка «Остатки» ---------- */

function visibleProducts() {
  const f = state.filters;
  const low = state.data.settings.low_stock;
  const needle = f.q.trim().toLowerCase();
  return state.data.products.filter((p) => {
    if (f.category && p.category !== f.category) return false;
    if (f.kind && p.kind !== f.kind) return false;
    if (f.color && p.color !== f.color) return false;
    if (f.print && p.print_name !== f.print) return false;
    if (f.lowOnly && !p.sizes.some((s) => s.qty <= low)) return false;
    if (f.no1c && !p.needs_1c) return false;
    if (needle) {
      const hay = `${p.kind} ${p.color} ${p.print_name} ${p.material} ${p.note} ${p.name_1c}`.toLowerCase();
      if (!needle.split(/\s+/).every((word) => hay.includes(word))) return false;
    }
    return true;
  });
}

function renderFilters() {
  const { facets, categories } = state.data;
  const f = state.filters;
  const cats = Object.entries(categories).map(([id, label]) =>
    `<button class="chip ${f.category === id ? 'is-active' : ''}" data-filter="category" data-value="${id}">${esc(label)}</button>`).join('');
  const kinds = facets.kinds.map((k) =>
    `<button class="chip ${f.kind === k ? 'is-active' : ''}" data-filter="kind" data-value="${esc(k)}">${esc(k)}</button>`).join('');
  const sel = (name, label, values, current) => values.length
    ? `<select class="select" data-filter="${name}">
         <option value="">${label}</option>
         ${values.map((v) => `<option value="${esc(v)}" ${current === v ? 'selected' : ''}>${esc(v)}</option>`).join('')}
       </select>` : '';
  $('#filters').innerHTML = cats + '<span class="filters__sep"></span>' + kinds
    + sel('color', 'Любой цвет', facets.colors, f.color)
    + sel('print', 'Любой принт', facets.prints, f.print)
    + `<button class="chip chip--danger ${f.lowOnly ? 'is-active' : ''}" data-filter="lowOnly">Заканчивается</button>`
    + `<button class="chip chip--warn ${f.no1c ? 'is-active' : ''}" data-filter="no1c">Нет в 1С</button>`;
  $('#resetFilters').hidden = !(f.category || f.kind || f.color || f.print || f.lowOnly || f.no1c || f.q);
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
    <span><span class="dot" style="background:var(--warn)"></span>≤ ${low} шт — пора заказывать</span>
    <span class="legend__tip">Тап по числу — продажа 1 шт. Кнопки − и + спросят причину.</span>` : '';

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

  grid.innerHTML = items.map(renderCard).join('');
}

function tile(product, s, low, showLabel) {
  return `
    <div class="size ${sizeClass(s.qty, low)}" data-product="${product.id}" data-size="${esc(s.size)}">
      ${showLabel ? `<div class="size__label">${esc(s.size)}</div>` : ''}
      <button class="size__qty" data-act="sell"
              title="Продать 1 шт" aria-label="${esc(product.title)}${showLabel ? ', размер ' + esc(s.size) : ''}: ${s.qty} шт">${s.qty}</button>
      <div class="size__ctl">
        <button data-act="minus" title="Убавить: продажа, брак, случайный клик" ${s.qty <= 0 ? 'disabled' : ''}>−</button>
        <button data-act="plus" title="Прибавить: поставка, возврат">+</button>
      </div>
    </div>`;
}

function renderCard(p) {
  const low = state.data.settings.low_stock;
  const swatch = SWATCHES[(p.color || '').toLowerCase()] || 'var(--border-strong)';
  const souvenir = isSouvenir(p);
  const body = souvenir
    ? `<div class="sizes sizes--single">${tile(p, p.sizes[0] || { size: '—', qty: 0 }, low, false)}
         <div class="single-hint">Сувенир — без размеров</div></div>`
    : `<div class="sizes">${p.sizes.map((s) => tile(p, s, low, true)).join('')}</div>`;

  const flags = [
    p.needs_1c ? '<span class="tag tag--warn" title="У товара не заполнено наименование в 1С">Нет в 1С</span>' : '',
    p.unpunched ? `<span class="tag tag--danger" data-punch="${p.id}" role="button"
        title="Продажи, которые ещё не пробиты в кассе">${p.unpunched} не пробито</span>` : '',
  ].join('');

  return `<article class="card ${p.total === 0 ? 'is-empty' : ''}">
    <div class="card__head">
      <div class="card__swatch" style="background:${swatch}"></div>
      <div class="card__main">
        <div class="card__title">${esc(p.title)}
          ${p.link ? `<a class="card__link" href="${esc(p.link)}" target="_blank" rel="noopener"
                        title="Открыть в интернет-магазине">↗</a>` : ''}</div>
        <div class="card__meta">
          <span class="tag">${esc(p.kind)}</span>
          ${p.color ? `<span class="tag">${esc(p.color)}</span>` : ''}
          ${p.print_name ? `<span class="tag">${esc(p.print_name)}</span>` : ''}
          ${p.material ? `<span class="tag">${esc(p.material)}</span>` : ''}
          ${flags}
        </div>
      </div>
      <div class="card__side">
        <div class="card__price">${money(p.price)}</div>
        <div class="card__total">всего ${pcs(p.total)}</div>
      </div>
    </div>
    ${body}
    <div class="card__foot">
      ${souvenir ? '' : `<button class="btn btn--sm" data-batch="${p.id}">Поставка партии</button>`}
      <button class="btn btn--sm" data-batch="${p.id}" data-inventory="1">Пересчитать</button>
      <button class="btn btn--ghost btn--sm" data-history="${p.id}">История</button>
      <button class="btn btn--ghost btn--sm" data-edit-stock="${p.id}">Карточка</button>
    </div>
  </article>`;
}

/* ---------- Изменение остатка ---------- */

function applyQty(productId, size, qty, direction) {
  const product = state.data.products.find((p) => p.id === productId);
  if (product) {
    const row = product.sizes.find((s) => s.size === size);
    if (row) row.qty = qty; else product.sizes.push({ size, qty });
    product.total = product.sizes.reduce((sum, s) => sum + s.qty, 0);
  }
  const tileEl = $(`.size[data-product="${productId}"][data-size="${CSS.escape(size)}"]`);
  if (tileEl) {
    tileEl.querySelector('.size__qty').textContent = qty;
    tileEl.className = `size ${sizeClass(qty, state.data.settings.low_stock)}`;
    tileEl.querySelector('[data-act="minus"]').disabled = qty <= 0;
    void tileEl.offsetWidth;
    tileEl.classList.add(direction < 0 ? 'flash-down' : 'flash-up');
    setTimeout(() => tileEl.classList.remove('flash-down', 'flash-up'), 460);
  }
  const card = tileEl && tileEl.closest('.card');
  if (card && product) {
    card.classList.toggle('is-empty', product.total === 0);
    const total = card.querySelector('.card__total');
    if (total) total.textContent = `всего ${pcs(product.total)}`;
  }
}

async function sellOne(tileEl) {
  const productId = Number(tileEl.dataset.product);
  const size = tileEl.dataset.size;
  const product = state.data.products.find((p) => p.id === productId);
  try {
    const res = await apiPost('/api/move', { product_id: productId, size, delta: -1, kind: 'sale' });
    applyQty(productId, size, res.qty, -1);
    const where = isSouvenir(product) ? product.title : `${product.title}, размер ${size}`;
    toast(`Продано: <b>${esc(where)}</b> · осталось ${res.qty}`
      + (res.needs_punch ? ' <span class="toast__warn">не пробито в кассе</span>' : ''),
      { kind: 'sale', undoId: res.movement_id });
    if (res.needs_punch) refreshCounters();
  } catch (err) {
    toast(err.message, { kind: 'err' });
  }
}

/* ---------- Поставка партии и пересчёт ---------- */

function openBatch(productId, inventory = false) {
  const product = state.data.products.find((p) => p.id === productId);
  if (!product) return;
  const souvenir = isSouvenir(product);
  const fields = product.sizes.map((s) => `
    <label><b>${souvenir ? 'Штук' : esc(s.size)}</b>
      <input type="number" min="0" data-size="${esc(s.size)}"
             value="${inventory ? s.qty : ''}" placeholder="—">
      <span class="was muted">${inventory ? 'по учёту ' + s.qty : 'есть ' + s.qty}</span>
    </label>`).join('');

  openModal({
    title: inventory ? `Пересчёт: ${product.title}` : `Поставка: ${product.title}`,
    body: `<p class="hint">${inventory
        ? 'Впишите фактическое количество. Разница попадёт в журнал как коррекция.'
        : 'Впишите, сколько штук пришло. Пустые поля пропускаются.'}</p>
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
                await apiPost('/api/set-qty', { product_id: productId, size: input.dataset.size, qty, note });
                changed += 1;
              }
              close();
              await reload();
              toast(changed ? `Пересчёт записан: изменено ${changed} ${plural(changed, 'позиция', 'позиции', 'позиций')}`
                            : 'Расхождений не найдено');
            } else {
              const items = {};
              inputs.forEach((input) => {
                const qty = Number(input.value);
                if (input.value !== '' && Number.isFinite(qty) && qty > 0) items[input.dataset.size] = qty;
              });
              const res = await apiPost('/api/receipt', { product_id: productId, items, note });
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

/* ---------- Вкладка «Не пробито» ---------- */

async function loadUnpunched() {
  let data;
  try { data = await apiGet('/api/unpunched'); }
  catch (err) { return toast(err.message, { kind: 'err' }); }

  const box = $('#punchBody');
  if (!data.total) {
    box.innerHTML = `<div class="empty">
      <div class="empty__title">Всё пробито</div>
      <p>Здесь появляются продажи товаров, у которых не заполнено наименование в 1С —
         их нельзя пробить в кассе сразу. Как пробьёте, отметьте это здесь.</p></div>`;
    return;
  }

  const groups = data.groups.map((g) => `
    <div class="punch-group">
      <div class="punch-group__head">
        <div>
          <div class="punch-group__title">${esc(g.title)}</div>
          <div class="punch-group__meta">
            ${g.has_1c
              ? `<span class="tag tag--ok">в 1С: ${esc(g.name_1c)}</span>`
              : '<span class="tag tag--warn">наименование в 1С не заполнено</span>'}
            <span class="muted">смены: ${g.sellers.map(esc).join(', ')}</span>
          </div>
        </div>
        <div class="punch-group__side">
          <div class="punch-group__count">${g.count} ${plural(g.count, 'продажа', 'продажи', 'продаж')}</div>
          <div class="muted">${money(g.amount)}</div>
        </div>
        <button class="btn btn--primary btn--sm" data-punch-all="${g.product_id ?? ''}">Пробито всё</button>
      </div>
    </div>`).join('');

  const rows = data.items.map((m) => `
    <tr>
      <td class="num muted" style="white-space:nowrap">${fmtDateTime(m.ts)}</td>
      <td>${esc(m.title)}</td>
      <td class="ta-c num">${m.size === '—' ? '' : esc(m.size)}</td>
      <td class="ta-r num">${money(m.price)}</td>
      <td>${esc(m.seller) || '<span class="muted">—</span>'}</td>
      <td class="ta-r"><button class="btn btn--sm btn--primary" data-punch-one="${m.id}">Пробито</button></td>
    </tr>`).join('');

  box.innerHTML = `
    <div class="banner banner--warn">
      <b>${data.total} ${plural(data.total, 'продажа', 'продажи', 'продаж')} на ${money(data.amount)}</b>
      ещё не пробиты в кассе. Пробейте их, когда товар заведут в 1С, и отметьте здесь.
    </div>
    <div class="by-seller">${data.by_seller.map(([name, n]) =>
      `<span class="tag tag--danger">${esc(name)}: ${n}</span>`).join('')}</div>
    ${groups}
    <div class="table-wrap" style="margin-top:16px">
      <table class="table"><thead><tr>
        <th>Когда</th><th>Товар</th><th class="ta-c">Размер</th><th class="ta-r">Цена</th>
        <th>Чья смена</th><th></th>
      </tr></thead><tbody>${rows}</tbody></table>
    </div>`;
}

/* ---------- Журнал ---------- */

async function loadJournal() {
  const j = state.journal;
  const params = {
    limit: j.limit, offset: j.offset, q: j.q, kind: j.kind, group: j.group,
    seller: j.seller, from: j.from, to: j.to, product_id: j.product_id,
    trash: j.trash ? 1 : '',
  };
  $('#journalExport').href = '/api/export/movements.csv' + qs(
    Object.fromEntries(Object.entries(params).filter(([k]) => k !== 'limit' && k !== 'offset')));

  const focused = j.product_id && state.data.products.find((p) => p.id === Number(j.product_id));
  $('#journalFocus').innerHTML = focused
    ? `<span class="chip is-active" data-clear-focus>Только «${esc(focused.title)}» ✕</span>` : '';

  const note = $('#trashNote');
  note.hidden = !j.trash;
  note.innerHTML = j.trash
    ? `Удалённые записи хранятся ${state.data.settings.trash_days} дней, потом исчезают сами.
       <button class="btn btn--sm btn--danger" id="emptyTrash">Очистить корзину</button>` : '';

  let data;
  try { data = await apiGet('/api/movements', params); }
  catch (err) { return toast(err.message, { kind: 'err' }); }

  const body = $('#journalBody');
  if (!data.items.length) {
    body.innerHTML = `<tr><td colspan="9"><div class="empty">
      <div class="empty__title">${j.trash ? 'Корзина пуста' : 'Записей нет'}</div>
      ${j.trash ? 'Удалённые записи журнала попадают сюда.'
                : 'Здесь появятся продажи, поставки, коррекции и правки справочника.'}</div></td></tr>`;
  } else {
    body.innerHTML = data.items.map((m) => `
      <tr class="${m.undone ? 'row-undone' : ''}">
        <td class="num muted" style="white-space:nowrap">${fmtDateTime(m.ts)}</td>
        <td><span class="pill pill--${PILL[m.kind] || 'correction'}">${esc(m.kind_label)}</span>
            ${m.unpunched ? '<span class="tag tag--danger">не пробито</span>' : ''}</td>
        <td>${esc(m.title) || '<span class="muted">—</span>'}</td>
        <td class="ta-c num">${m.size === '—' ? '' : esc(m.size)}</td>
        <td class="ta-c num" style="font-weight:650;color:${m.delta < 0 ? 'var(--danger)' : m.delta > 0 ? 'var(--ok)' : 'var(--text-faint)'}">
          ${m.delta ? (m.delta > 0 ? '+' : '') + m.delta : '·'}</td>
        <td class="ta-r num">${m.amount ? money(m.amount) : '<span class="muted">—</span>'}</td>
        <td>${esc(m.seller) || '<span class="muted">—</span>'}</td>
        <td class="muted">${esc(m.note)}</td>
        <td class="ta-r" style="white-space:nowrap">${j.trash
          ? `<button class="btn btn--sm" data-restore="${m.id}">Вернуть</button>
             <button class="btn btn--sm btn--danger" data-purge="${m.id}">Удалить насовсем</button>`
          : `${m.delta && !m.undone ? `<button class="btn btn--sm" data-undo="${m.id}">Откатить</button>` : ''}
             <button class="btn btn--sm btn--danger" data-trash="${m.id}">Удалить</button>`}</td>
      </tr>`).join('');
  }

  const from = data.total ? data.offset + 1 : 0;
  const to = Math.min(data.offset + data.limit, data.total);
  $('#journalPager').innerHTML = `
    <button class="btn btn--sm" data-page="prev" ${data.offset === 0 ? 'disabled' : ''}>← Раньше</button>
    <span>${from}–${to} из ${nf.format(data.total)}</span>
    <button class="btn btn--sm" data-page="next" ${to >= data.total ? 'disabled' : ''}>Позже →</button>`;
}

async function trashMovement(id, mode) {
  try {
    await apiPost('/api/movements/trash', { movement_id: id, mode });
    await reload();
    toast(mode === 'undo' ? 'Запись откачена и убрана в корзину' : 'Запись убрана в корзину');
  } catch (err) {
    throw err;
  }
}

function askTrashMode(id, message) {
  openModal({
    title: 'Удалить запись журнала',
    body: `<p>${esc(message)}</p>
      <p class="hint">Откат вернёт товар на склад и оставит в журнале пометку об отмене.
         Если остаток уже поправлен другим способом, запись можно убрать, не трогая склад.</p>`,
    buttons: [
      { label: 'Отмена', onClick: (close) => close() },
      {
        label: 'Удалить, не трогая склад',
        onClick: async (close) => {
          try { await trashMovement(id, 'keep'); close(); }
          catch (err) { toast(err.message, { kind: 'err' }); }
        },
      },
      {
        label: 'Откатить и удалить', className: 'btn--primary',
        onClick: async (close) => {
          try { await trashMovement(id, 'undo'); close(); }
          catch (err) { toast(err.message, { kind: 'err' }); }
        },
      },
    ],
  });
}

/* ---------- Желания ---------- */

async function loadWishes() {
  const w = state.wishes;
  const params = { q: w.q };
  if (w.status === '__all') params.all = 1;
  else if (w.status) params.status = w.status;

  let data;
  try { data = await apiGet('/api/wishes', params); }
  catch (err) { return toast(err.message, { kind: 'err' }); }

  const body = $('#wishBody');
  if (!data.wishes.length) {
    body.innerHTML = `<tr><td colspan="7"><div class="empty">
      <div class="empty__title">Желаний нет</div>
      Записывайте сюда то, что спрашивали покупатели, но чего не оказалось в наличии.</div></td></tr>`;
    return;
  }
  const statuses = state.data.wish_statuses;
  body.innerHTML = data.wishes.map((w) => `
    <tr class="${w.status === 'closed' ? 'row-done' : ''}">
      <td class="num muted" style="white-space:nowrap">${fmtDate(w.asked_on)}</td>
      <td style="font-weight:600">${esc(w.product)}</td>
      <td>${esc(w.contact) || '<span class="muted">—</span>'}</td>
      <td>${esc(w.seller) || '<span class="muted">—</span>'}</td>
      <td class="muted">${esc(w.note)}</td>
      <td>
        <select class="select select--sm" data-wish-status="${w.id}">
          ${statuses.map((s) => `<option value="${s.id}" ${w.status === s.id ? 'selected' : ''}>${esc(s.label)}</option>`).join('')}
        </select>
      </td>
      <td class="ta-r"><button class="btn btn--sm btn--danger" data-wish-delete="${w.id}">Удалить</button></td>
    </tr>`).join('');
}

/* ---------- Отчёты ---------- */

async function loadReports() {
  const r = state.report;
  const base = { dead_days: state.data.settings.dead_days, kind: r.kind, category: r.category };
  const params = r.from && r.to ? { ...base, from: r.from, to: r.to } : { ...base, days: r.days };
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
    : '<div class="empty">Нет данных по одежде за период</div>';

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
      ${stat('Поставки', pcs(s.received_qty), s.defect_qty ? `брак: ${pcs(s.defect_qty)}` : 'брака нет')}
      ${stat('Сейчас на складе', pcs(s.stock_qty), `на ${money(s.stock_amount)}`)}
    </div>

    <div class="panel">
      <h2 class="panel__title">Что продаётся</h2>
      <p class="panel__hint">Период ${fmtDate(s.date_from)} — ${fmtDate(s.date_to)}. «Хватит на» — при текущем темпе продаж.</p>
      <div class="table-wrap"><table class="table"><thead><tr>
        <th>Модель</th><th class="ta-c">Продано</th><th class="ta-r">Выручка</th>
        <th class="ta-c">Остаток</th><th class="ta-c">Хватит на</th><th></th>
      </tr></thead><tbody>${topRows}</tbody></table></div>
    </div>

    <div class="panel">
      <h2 class="panel__title">Какие размеры вымываются первыми</h2>
      <p class="panel__hint">Только одежда. Слева доля в продажах, справа доля в остатке. Если синяя полоса заметно длиннее серой — размер уходит быстрее, чем лежит на складе, и его стоит заказывать больше.</p>
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

async function catalogProducts() {
  return state.showArchived
    ? (await apiGet('/api/products', { archived: 1 })).products
    : state.data.products;
}

async function renderCatalog() {
  const products = await catalogProducts();
  const body = $('#catalogBody');
  if (!products.length) {
    body.innerHTML = `<tr><td colspan="8"><div class="empty">
      <div class="empty__title">Список пуст</div>Нажмите «Новая одежда» или «Новый сувенир».</div></td></tr>`;
    return;
  }
  body.innerHTML = products.map((p) => `
    <tr style="${p.archived ? 'opacity:.55' : ''}">
      <td style="font-weight:600">${esc(p.title)}
        ${p.archived ? '<span class="tag">архив</span>' : ''}
        ${p.link ? `<a class="card__link" href="${esc(p.link)}" target="_blank" rel="noopener">↗</a>` : ''}</td>
      <td>${esc(state.data.categories[p.category] || p.category)}</td>
      <td class="muted">${esc(p.material) || '—'}</td>
      <td class="ta-r num">${money(p.price)}</td>
      <td class="ta-c muted num">${isSouvenir(p) ? '—' : p.sizes.map((s) => s.size).join(', ')}</td>
      <td class="ta-c num" style="font-weight:650">${p.total}</td>
      <td>${p.name_1c
        ? esc(p.name_1c)
        : '<span class="tag tag--warn">Не заведён в 1С</span>'}</td>
      <td class="ta-r" style="white-space:nowrap">
        <button class="btn btn--sm" data-edit="${p.id}">Изменить</button>
        <button class="btn btn--sm" data-archive="${p.id}" data-to="${p.archived ? 0 : 1}">${p.archived ? 'Вернуть' : 'В архив'}</button>
        ${p.total === 0 ? `<button class="btn btn--sm btn--danger" data-delete="${p.id}">Удалить</button>` : ''}
      </td>
    </tr>`).join('');
}

function openProductForm(product, category) {
  const cat = product ? product.category : (category || 'clothing');
  const presets = state.data.size_presets;
  const sizes = product && !isSouvenir(product)
    ? product.sizes.map((s) => s.size).join(', ')
    : presets[0].sizes.join(', ');
  const kindList = state.data.facets.kind_suggestions[cat] || [];
  const materials = state.data.facets.material_suggestions;
  const clothing = cat === 'clothing';

  openModal({
    title: product ? `Карточка: ${product.title}`
                   : (clothing ? 'Новая одежда' : 'Новый сувенир'),
    body: `
      <input type="hidden" id="pCategory" value="${cat}">
      <div class="field2">
        <label class="field">Тип товара
          <input type="text" id="pKind" list="kindList" placeholder="${clothing ? 'Толстовка' : 'Кружка'}" value="${esc(product?.kind || '')}">
          <datalist id="kindList">${kindList.map((k) => `<option value="${esc(k)}">`).join('')}</datalist>
        </label>
        <label class="field">Цвет
          <input type="text" id="pColor" placeholder="${clothing ? 'фиолетовая' : 'белая'}" value="${esc(product?.color || '')}"></label>
        <label class="field">Принт
          <input type="text" id="pPrint" placeholder="большая печать" value="${esc(product?.print_name || '')}"></label>
        <label class="field">Цена, ₽
          <input type="number" id="pPrice" min="0" step="10" value="${product?.price ?? 0}"></label>
      </div>

      ${clothing ? `
      <label class="field">Материал
        <input type="text" id="pMaterial" list="materialList" placeholder="Футер трёхнитка" value="${esc(product?.material || '')}">
        <datalist id="materialList">${materials.map((m) => `<option value="${esc(m)}">`).join('')}</datalist>
      </label>
      <label class="field">Размерный ряд
        <div class="row" style="margin-bottom:6px">
          ${presets.map((p) => `<button type="button" class="chip" data-preset="${p.sizes.join(',')}">${esc(p.label)}</button>`).join('')}
        </div>
        <input type="text" id="pSizes" value="${esc(sizes)}">
      </label>
      <p class="hint">Через запятую. Размер с остатком удалить нельзя — сначала спишите товар.</p>` : ''}

      <label class="field">Наименование в 1С
        <input type="text" id="pName1c" placeholder="как товар называется в 1С" value="${esc(product?.name_1c || '')}"></label>
      <label class="check">
        <input type="checkbox" id="pNo1c" ${product && product.name_1c ? '' : 'checked'}>
        <span>Не заведён в 1С</span>
      </label>
      <p class="hint">Пока наименования нет, каждая продажа этого товара помечается как «не пробито в кассе» и попадает на вкладку «Не пробито».</p>

      <label class="field">Ссылка на товар в интернет-магазине
        <input type="text" id="pLink" placeholder="store.nsu.ru/…" value="${esc(product?.link || '')}"></label>
      <label class="field">Заметка
        <input type="text" id="pNote" placeholder="например, лимитированная партия" value="${esc(product?.note || '')}"></label>`,
    onOpen: (box) => {
      box.querySelectorAll('[data-preset]').forEach((btn) => {
        btn.onclick = () => { $('#pSizes').value = btn.dataset.preset.split(',').join(', '); };
      });
      const name = $('#pName1c');
      const flag = $('#pNo1c');
      const sync = () => { flag.checked = !name.value.trim(); };
      name.addEventListener('input', sync);
      flag.addEventListener('change', () => {
        if (flag.checked) name.value = '';
        else name.focus();
      });
    },
    buttons: [
      { label: 'Отмена', onClick: (close) => close() },
      {
        label: product ? 'Сохранить' : 'Создать', className: 'btn--primary',
        onClick: async (close) => {
          const payload = {
            category: $('#pCategory').value,
            kind: $('#pKind').value, color: $('#pColor').value, print_name: $('#pPrint').value,
            price: $('#pPrice').value, note: $('#pNote').value,
            name_1c: $('#pNo1c').checked ? '' : $('#pName1c').value,
            link: $('#pLink').value,
            material: clothing ? $('#pMaterial').value : '',
            sizes: clothing ? $('#pSizes').value : '',
          };
          try {
            await apiPost(product ? `/api/products/${product.id}` : '/api/products', payload);
            close();
            await reload();
            if (state.tab === 'catalog') await renderCatalog();
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

function showFarewell() {
  document.body.innerHTML = `<div class="farewell">
    <div class="farewell__mark">НГУ</div>
    <h1>Приложение закрыто</h1>
    <p>Все продажи и приёмки сохранены в базе. Эту вкладку можно закрыть.</p>
    <p class="muted">Чтобы начать работу снова, дважды щёлкните по ярлыку «Запустить».</p>
  </div>`;
}

/* ---------- События ---------- */

function bind() {
  $('#tabs').addEventListener('click', (e) => {
    const btn = e.target.closest('.tab');
    if (btn) setTab(btn.dataset.tab);
  });
  $('#sellerSelect').addEventListener('change', (e) => {
    state.seller = e.target.value;
    localStorage.setItem('merch.seller', state.seller);
    $('#wSeller').value = state.seller;
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
    if (key === 'lowOnly' || key === 'no1c') state.filters[key] = !state.filters[key];
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
    state.filters = { q: '', category: '', kind: '', color: '', print: '', lowOnly: false, no1c: false };
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
    const punch = e.target.closest('[data-punch]');
    if (punch) return setTab('punch');
    const batch = e.target.closest('[data-batch]');
    if (batch) return openBatch(Number(batch.dataset.batch), batch.dataset.inventory === '1');
    const editStock = e.target.closest('[data-edit-stock]');
    if (editStock) {
      const p = state.data.products.find((x) => x.id === Number(editStock.dataset.editStock));
      return openProductForm(p);
    }
    const history = e.target.closest('[data-history]');
    if (history) {
      state.journal = { ...state.journal, offset: 0, q: '', kind: '', group: '', seller: '',
                        from: '', to: '', trash: false, product_id: Number(history.dataset.history) };
      ['journalSearch', 'journalKind', 'journalGroup', 'journalSeller', 'journalFrom', 'journalTo']
        .forEach((id) => { $('#' + id).value = ''; });
      $('#journalTrash').checked = false;
      return setTab('journal');
    }
    const actBtn = e.target.closest('[data-act]');
    if (!actBtn) return;
    const tileEl = actBtn.closest('.size');
    if (!tileEl) return;
    const product = state.data.products.find((p) => p.id === Number(tileEl.dataset.product));
    if (actBtn.dataset.act === 'sell') return sellOne(tileEl);
    openReasonPopover(actBtn, product, tileEl.dataset.size, actBtn.dataset.act === 'plus' ? 1 : -1);
  });

  // Меню причин
  $('#popList').addEventListener('click', (e) => {
    const item = e.target.closest('[data-kind]');
    if (item) applyReason(item.dataset.kind);
  });
  document.addEventListener('click', (e) => {
    if ($('#pop').hidden) return;
    if (e.target.closest('#pop') || e.target.closest('[data-act]')) return;
    closePopover();
  });
  window.addEventListener('resize', closePopover);

  // Не пробито
  $('#punchBody').addEventListener('click', async (e) => {
    const one = e.target.closest('[data-punch-one]');
    const all = e.target.closest('[data-punch-all]');
    if (!one && !all) return;
    try {
      if (one) await apiPost('/api/punched', { movement_id: Number(one.dataset.punchOne) });
      else await apiPost('/api/punched', { product_id: Number(all.dataset.punchAll) });
      await reload();
      toast('Отмечено как пробитое в кассе');
    } catch (err) { toast(err.message, { kind: 'err' }); }
  });

  // Журнал
  let jTimer;
  $('#journalSearch').addEventListener('input', (e) => {
    clearTimeout(jTimer);
    const value = e.target.value;
    jTimer = setTimeout(() => { state.journal.q = value; state.journal.offset = 0; loadJournal(); }, 220);
  });
  ['journalKind', 'journalGroup', 'journalSeller', 'journalFrom', 'journalTo', 'journalTrash']
    .forEach((id) => $('#' + id).addEventListener('change', () => {
      Object.assign(state.journal, {
        kind: $('#journalKind').value,
        group: $('#journalGroup').value,
        seller: $('#journalSeller').value,
        from: $('#journalFrom').value,
        to: $('#journalTo').value,
        trash: $('#journalTrash').checked,
        offset: 0,
      });
      loadJournal();
    }));
  $('#journalReset').addEventListener('click', () => {
    state.journal = { offset: 0, limit: 50, q: '', kind: '', group: '', seller: '', from: '',
                      to: '', product_id: '', trash: false };
    ['journalSearch', 'journalKind', 'journalGroup', 'journalSeller', 'journalFrom', 'journalTo']
      .forEach((id) => { $('#' + id).value = ''; });
    $('#journalTrash').checked = false;
    loadJournal();
  });
  $('#journalFocus').addEventListener('click', (e) => {
    if (!e.target.closest('[data-clear-focus]')) return;
    state.journal.product_id = '';
    state.journal.offset = 0;
    loadJournal();
  });
  $('#trashNote').addEventListener('click', async (e) => {
    if (!e.target.closest('#emptyTrash')) return;
    if (!confirm('Очистить корзину полностью? Записи исчезнут навсегда.')) return;
    try {
      const res = await apiPost('/api/trash/empty');
      await reload();
      toast(`Корзина очищена: ${res.removed} ${plural(res.removed, 'запись', 'записи', 'записей')}`);
    } catch (err) { toast(err.message, { kind: 'err' }); }
  });
  $('#journalBody').addEventListener('click', async (e) => {
    const undo = e.target.closest('[data-undo]');
    if (undo) {
      undo.disabled = true;
      try {
        await apiPost('/api/undo', { movement_id: Number(undo.dataset.undo) });
        await reload();
        toast('Операция откачена, остаток восстановлен');
      } catch (err) { undo.disabled = false; toast(err.message, { kind: 'err' }); }
      return;
    }
    const trash = e.target.closest('[data-trash]');
    if (trash) {
      const id = Number(trash.dataset.trash);
      try { await trashMovement(id, ''); }
      catch (err) { askTrashMode(id, err.message); }
      return;
    }
    const restore = e.target.closest('[data-restore]');
    if (restore) {
      try {
        await apiPost(`/api/movements/${restore.dataset.restore}/restore`);
        await reload();
        toast('Запись возвращена в журнал');
      } catch (err) { toast(err.message, { kind: 'err' }); }
      return;
    }
    const purge = e.target.closest('[data-purge]');
    if (purge) {
      if (!confirm('Удалить запись навсегда?')) return;
      try {
        await apiPost(`/api/movements/${purge.dataset.purge}/purge`);
        await reload();
        toast('Запись удалена навсегда');
      } catch (err) { toast(err.message, { kind: 'err' }); }
    }
  });
  $('#journalPager').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-page]');
    if (!btn) return;
    state.journal.offset = Math.max(0, state.journal.offset +
      (btn.dataset.page === 'next' ? state.journal.limit : -state.journal.limit));
    loadJournal();
  });

  // Желания
  $('#wishForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await apiPost('/api/wishes', {
        product: $('#wProduct').value,
        asked_on: $('#wDate').value || today(),
        contact: $('#wContact').value,
        seller: $('#wSeller').value,
        note: $('#wNote').value,
      });
      ['wProduct', 'wContact', 'wNote'].forEach((id) => { $('#' + id).value = ''; });
      $('#wDate').value = today();
      await reload();
      toast('Желание записано');
    } catch (err) { toast(err.message, { kind: 'err' }); }
  });
  let wTimer;
  $('#wishSearch').addEventListener('input', (e) => {
    clearTimeout(wTimer);
    const value = e.target.value;
    wTimer = setTimeout(() => { state.wishes.q = value; loadWishes(); }, 220);
  });
  $('#wishStatus').addEventListener('change', (e) => {
    state.wishes.status = e.target.value;
    loadWishes();
  });
  $('#wishBody').addEventListener('change', async (e) => {
    const sel = e.target.closest('[data-wish-status]');
    if (!sel) return;
    try {
      await apiPost(`/api/wishes/${sel.dataset.wishStatus}/status`, { status: sel.value });
      await reload();
      toast('Статус обновлён');
    } catch (err) { toast(err.message, { kind: 'err' }); }
  });
  $('#wishBody').addEventListener('click', async (e) => {
    const del = e.target.closest('[data-wish-delete]');
    if (!del) return;
    if (!confirm('Удалить эту заявку?')) return;
    try {
      await apiDelete(`/api/wishes/${del.dataset.wishDelete}`);
      await reload();
      toast('Заявка удалена');
    } catch (err) { toast(err.message, { kind: 'err' }); }
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
  ['repKind', 'repCategory'].forEach((id) => $('#' + id).addEventListener('change', () => {
    state.report.kind = $('#repKind').value;
    state.report.category = $('#repCategory').value;
    loadReports();
  }));
  ['repFrom', 'repTo'].forEach((id) => $('#' + id).addEventListener('change', () => {
    state.report.from = $('#repFrom').value;
    state.report.to = $('#repTo').value || today();
    if (state.report.from) loadReports();
  }));

  // Товары
  $('#addClothing').addEventListener('click', () => openProductForm(null, 'clothing'));
  $('#addSouvenir').addEventListener('click', () => openProductForm(null, 'souvenir'));
  $('#showArchived').addEventListener('change', (e) => {
    state.showArchived = e.target.checked;
    renderCatalog();
  });
  $('#catalogBody').addEventListener('click', async (e) => {
    const edit = e.target.closest('[data-edit]');
    if (edit) {
      const list = await catalogProducts();
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
        await apiDelete(`/api/products/${del.dataset.delete}?seller=${encodeURIComponent(state.seller)}`);
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
  $('#shutdownBtn').addEventListener('click', async () => {
    if (!confirm('Завершить работу приложения? Все данные уже сохранены.')) return;
    try { await apiPost('/api/shutdown'); } catch (_) { /* сервер закрылся, не дослав ответ */ }
    showFarewell();
  });

  // Модалка и клавиши
  $('#modal').addEventListener('click', (e) => { if (e.target.closest('[data-close]')) closeModal(); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (!$('#pop').hidden) return closePopover();
      if (!$('#modal').hidden) return closeModal();
    }
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
      Запустите приложение ярлыком «Запустить» и обновите страницу.</div>`;
    return;
  }

  $('#journalKind').innerHTML = '<option value="">Все операции</option>' +
    Object.entries(state.data.kind_labels).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('');
  $('#repTo').value = today();
  $('#wDate').value = today();

  if (!state.seller) {
    const first = state.data.sellers.find((s) => s.active);
    state.seller = first ? first.name : '';
  }
  renderSellerSelect();
  renderRepFilters();
  renderBadges();
  setTab('stock');
}

init();
