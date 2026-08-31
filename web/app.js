/* Мерч НГУ — учёт товара. Без фреймворков: состояние + перерисовка нужного блока. */

const state = {
  data: null,
  tab: 'stock',
  seller: '',
  filters: { q: '', category: '', kind: '', color: '', print: '', sizes: [],
             lowOnly: false, no1c: false, blocked: false },
  journal: { offset: 0, limit: 50, q: '', kind: '', group: '', seller: '', from: '', to: '',
             product_id: '', category: '', trash: false },
  wishes: { q: '', status: '' },
  report: { days: 30, from: '', to: '', kind: '', category: '', data: null },
  sort: localStorage.getItem('merch.sort') || 'title',
  view: localStorage.getItem('merch.view') || 'grid',
  showArchived: false,
  catalogCategory: '',
  catalogSort: localStorage.getItem('merch.catalogSort') || 'title',
};

// Цвет полоски на карточке. Ключ — основа слова без окончания, поэтому
// «фиолетовый», «фиолетовая» и «фиолетовые» дают один и тот же оттенок.
// Третий элемент — как цвет называется в справке; без него запись считается
// синонимом и в гайде не показывается.
const SWATCHES = [
  // белые и молочные
  ['белоснежн', '#ffffff', 'белоснежный', 'Белые и молочные'],
  ['бел', '#f4f6fa', 'белый', 'Белые и молочные'],
  ['молочн', '#f7efe0', 'молочный', 'Белые и молочные'],
  ['кремов', '#f2e6cf', 'кремовый', 'Белые и молочные'],
  ['слонов', '#f4efe2', 'слоновая кость', 'Белые и молочные'],
  ['айвори', '#f4efe2'],
  ['ванильн', '#f6ecc9', 'ванильный', 'Белые и молочные'],
  ['экрю', '#e8e0d0', 'экрю', 'Белые и молочные'],
  // бежевые и коричневые
  ['бежев', '#d9c7a7', 'бежевый', 'Бежевые и коричневые'],
  ['песочн', '#ddc9a3', 'песочный', 'Бежевые и коричневые'],
  ['капучино', '#a8825f', 'капучино', 'Бежевые и коричневые'],
  ['верблюжь', '#b98b5a', 'верблюжий', 'Бежевые и коричневые'],
  ['карамельн', '#c68a4e', 'карамельный', 'Бежевые и коричневые'],
  ['горчичн', '#cf9e2b', 'горчичный', 'Бежевые и коричневые'],
  ['кофейн', '#6b4c33', 'кофейный', 'Бежевые и коричневые'],
  ['шоколадн', '#5a3a26', 'шоколадный', 'Бежевые и коричневые'],
  ['коричнев', '#7a5230', 'коричневый', 'Бежевые и коричневые'],
  // серые и чёрные
  ['светло-сер', '#c3c9d2', 'светло-серый', 'Серые и чёрные'],
  ['меланж', '#b9bfc9', 'меланж', 'Серые и чёрные'],
  ['серебр', '#c0c6cf', 'серебряный', 'Серые и чёрные'],
  ['сер', '#9aa3b0', 'серый', 'Серые и чёрные'],
  ['тёмно-сер', '#6a7280', 'тёмно-серый', 'Серые и чёрные'],
  ['темно-сер', '#6a7280'],
  ['мокрый асфальт', '#4a5058', 'мокрый асфальт', 'Серые и чёрные'],
  ['графит', '#3a3f47', 'графитовый', 'Серые и чёрные'],
  ['антрацит', '#2b2f36', 'антрацит', 'Серые и чёрные'],
  ['угольн', '#2a2d33', 'угольный', 'Серые и чёрные'],
  ['чёрн', '#20242c', 'чёрный', 'Серые и чёрные'],
  ['черн', '#20242c'],
  // синие и голубые
  ['небесн', '#7cc0ef', 'небесный', 'Синие и голубые'],
  ['голуб', '#5aa9e6', 'голубой', 'Синие и голубые'],
  ['лазурн', '#2f97d4', 'лазурный', 'Синие и голубые'],
  ['васильков', '#4c74d9', 'васильковый', 'Синие и голубые'],
  ['син', '#2456b8', 'синий', 'Синие и голубые'],
  ['джинсов', '#3f5d8a', 'джинсовый', 'Синие и голубые'],
  ['индиго', '#2a2f7a', 'индиго', 'Синие и голубые'],
  ['тёмно-син', '#16326b', 'тёмно-синий', 'Синие и голубые'],
  ['темно-син', '#16326b'],
  // бирюза и зелень
  ['аквамарин', '#6fd3c4', 'аквамарин', 'Бирюза и зелень'],
  ['мятн', '#7fd0b8', 'мятный', 'Бирюза и зелень'],
  ['тиффани', '#4fc3c0', 'тиффани', 'Бирюза и зелень'],
  ['бирюзов', '#1fb6b0', 'бирюзовый', 'Бирюза и зелень'],
  ['морская волна', '#2e9d9a', 'морская волна', 'Бирюза и зелень'],
  ['морской волны', '#2e9d9a'],
  ['морск', '#2e9d9a'],
  ['фисташков', '#a8c46a', 'фисташковый', 'Бирюза и зелень'],
  ['салатов', '#86c740', 'салатовый', 'Бирюза и зелень'],
  ['оливков', '#7a8a3a', 'оливковый', 'Бирюза и зелень'],
  ['хаки', '#6b7042', 'хаки', 'Бирюза и зелень'],
  ['болотн', '#5c6b3c', 'болотный', 'Бирюза и зелень'],
  ['зелён', '#2c8a52', 'зелёный', 'Бирюза и зелень'],
  ['зелен', '#2c8a52'],
  ['изумрудн', '#1f8a5b', 'изумрудный', 'Бирюза и зелень'],
  ['тёмно-зелён', '#1d5c38', 'тёмно-зелёный', 'Бирюза и зелень'],
  ['темно-зелен', '#1d5c38'],
  // жёлтые и оранжевые
  ['лимонн', '#e8d84a', 'лимонный', 'Жёлтые и оранжевые'],
  ['жёлт', '#e5b52c', 'жёлтый', 'Жёлтые и оранжевые'],
  ['желт', '#e5b52c'],
  ['золот', '#c9a227', 'золотой', 'Жёлтые и оранжевые'],
  ['персиков', '#f0b48a', 'персиковый', 'Жёлтые и оранжевые'],
  ['абрикосов', '#f0a862', 'абрикосовый', 'Жёлтые и оранжевые'],
  ['оранжев', '#e07a2b', 'оранжевый', 'Жёлтые и оранжевые'],
  ['терракот', '#b5573a', 'терракотовый', 'Жёлтые и оранжевые'],
  // красные и бордовые
  ['коралл', '#f0765e', 'коралловый', 'Красные и бордовые'],
  ['алы', '#d92b2b', 'алый', 'Красные и бордовые'],
  ['красн', '#cf3030', 'красный', 'Красные и бордовые'],
  ['малинов', '#b3195a', 'малиновый', 'Красные и бордовые'],
  ['вишнёв', '#8f1d33', 'вишнёвый', 'Красные и бордовые'],
  ['вишнев', '#8f1d33'],
  ['бордов', '#7d1f2e', 'бордовый', 'Красные и бордовые'],
  ['марсала', '#7b3644', 'марсала', 'Красные и бордовые'],
  // розовые и фиолетовые
  ['пудров', '#e6bcc3', 'пудровый', 'Розовые и фиолетовые'],
  ['розов', '#e28ab4', 'розовый', 'Розовые и фиолетовые'],
  ['пыльная роза', '#c48a92', 'пыльная роза', 'Розовые и фиолетовые'],
  ['фуксия', '#e0218a', 'фуксия', 'Розовые и фиолетовые'],
  ['фукси', '#e0218a'],
  ['лаванд', '#b7a5e0', 'лавандовый', 'Розовые и фиолетовые'],
  ['лилов', '#b57edc', 'лиловый', 'Розовые и фиолетовые'],
  ['сиренев', '#a98ae0', 'сиреневый', 'Розовые и фиолетовые'],
  ['фиолетов', '#7c4dcc', 'фиолетовый', 'Розовые и фиолетовые'],
  ['пурпурн', '#7a2f7a', 'пурпурный', 'Розовые и фиолетовые'],
  ['слив', '#5d3a6b', 'сливовый', 'Розовые и фиолетовые'],
  ['баклажан', '#4a2340', 'баклажан', 'Розовые и фиолетовые'],
  // английские названия — на случай, если так записали в карточке
  ['white', '#f4f6fa'], ['black', '#20242c'], ['grey', '#9aa3b0'], ['gray', '#9aa3b0'],
  ['navy', '#16326b'], ['blue', '#2456b8'], ['teal', '#2e9d9a'], ['green', '#2c8a52'],
  ['red', '#cf3030'], ['pink', '#e28ab4'], ['purple', '#7c4dcc'], ['beige', '#d9c7a7'],
];

// Длинные основы проверяем первыми, иначе «син» перехватит «синий» у «тёмно-синего».
const SWATCH_LOOKUP = [...SWATCHES].sort((a, b) => b[0].length - a[0].length);

function swatchEntry(color) {
  const s = String(color || '').toLowerCase().trim();
  if (!s) return null;
  return SWATCH_LOOKUP.find(([stem]) => s.startsWith(stem) || s.includes(' ' + stem)) || null;
}

function swatchFor(color) {
  const hit = swatchEntry(color);
  return hit ? hit[1] : 'var(--border-strong)';
}

// «Бордовый» и «бордовая» — один цвет: сравниваем по оттенку из палитры, а если
// слово незнакомое — по основе без падежного окончания.
const COLOR_ENDINGS = /(ого|ому|ыми|ими|ый|ий|ой|ая|яя|ое|ее|ые|ие|ым|им|ом|ем|ую|юю)$/;

function colorKey(color) {
  const raw = String(color || '').toLowerCase().trim();
  if (!raw) return '';
  const hit = swatchEntry(raw);
  if (hit) return 'hex:' + hit[1];
  return 'txt:' + raw.split(/\s+/).map((w) => w.replace(COLOR_ENDINGS, '')).join(' ');
}

// Порядок семейств для сортировки по цвету: светлое начало, затем радуга,
// в конце серое и чёрное.
const COLOR_FAMILY_ORDER = [
  'Белые и молочные', 'Бежевые и коричневые', 'Красные и бордовые',
  'Жёлтые и оранжевые', 'Бирюза и зелень', 'Синие и голубые',
  'Розовые и фиолетовые', 'Серые и чёрные',
];

// Оттенок → место в этом порядке. Внутри семейства сохраняем порядок палитры:
// он выстроен от светлого к тёмному.
const COLOR_RANK = (() => {
  const rank = new Map();
  SWATCHES.forEach(([, hex, label, family], i) => {
    if (!label || rank.has(hex)) return;
    const fam = COLOR_FAMILY_ORDER.indexOf(family);
    rank.set(hex, [fam < 0 ? COLOR_FAMILY_ORDER.length : fam, i]);
  });
  return rank;
})();

function colorSortKey(color) {
  const hit = swatchEntry(color);
  const known = hit && COLOR_RANK.get(hit[1]);
  // Незнакомые цвета — после известных, по алфавиту.
  return known || [COLOR_FAMILY_ORDER.length + 1, 0];
}

const PILL = {
  sale: 'sale', return: 'return', receipt: 'receipt', defect: 'defect',
  mistake: 'correction', correction: 'correction', writeoff: 'defect',
  product_added: 'event', product_edited: 'event', product_archived: 'event',
  product_restored: 'event', product_deleted: 'event',
};

// Выбранная смена живёт до перезапуска приложения и не дольше SHIFT_HOURS:
// новый рабочий день — новый выбор, чтобы продавец не работал под чужим именем.
const SHIFT_KEY = 'merch.shift';

function loadShift(runId, shiftHours) {
  try {
    const saved = JSON.parse(localStorage.getItem(SHIFT_KEY) || 'null');
    if (!saved || saved.run !== runId) return '';
    if (Date.now() - (saved.at || 0) > shiftHours * 3600 * 1000) return '';
    return saved.name || '';
  } catch (_) {
    return '';
  }
}

function saveShift(name) {
  try {
    localStorage.setItem(SHIFT_KEY, JSON.stringify({
      name, run: state.data ? state.data.run_id : '', at: Date.now(),
    }));
  } catch (_) { /* приватный режим браузера — просто не запомним */ }
}

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

// Роль приходит с сервера и решает, показывать ли кнопки изменения. Настоящая
// защита — на сервере: он всё равно отклонит запись от наблюдателя.
const canEdit = () => state.data?.can_edit !== false;

/* ---------- Работа с сервером ---------- */

async function request(url, options) {
  const res = await fetch(url, options);
  let body = null;
  try { body = await res.json(); } catch (_) { /* пустой ответ */ }
  if (!res.ok) {
    const err = new Error((body && body.error) || `Ошибка ${res.status}`);
    err.status = res.status;
    throw err;
  }
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
// У DELETE нет тела запроса, поэтому имя продавца уходит в адресе — иначе
// удаление попадёт в журнал без автора.
const apiDelete = (url) => request(
  url + (url.includes('?') ? '&' : '?') + 'seller=' + encodeURIComponent(state.seller || ''),
  { method: 'DELETE' });

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
      } catch (err) { btn.disabled = false; toast(esc(err.message), { kind: 'err' }); }
    };
    box.appendChild(btn);
  }
  $('#toasts').appendChild(box);
  setTimeout(() => box.remove(), timeout);
}

/* ---------- Модальные окна ---------- */

let modalDismissible = true;

function openModal({ title, body, buttons = [], onOpen, dismissible = true }) {
  const modal = $('#modal');
  modalDismissible = dismissible;
  modal.classList.toggle('modal--locked', !dismissible);
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
function closeModal(force = false) {
  if (!modalDismissible && !force) return;
  modalDismissible = true;
  $('#modal').classList.remove('modal--locked');
  $('#modal').hidden = true;
}

/* ---------- Кто на смене ---------- */

function askShift({ initial = false } = {}) {
  const active = state.data.sellers.filter((s) => s.active);
  const list = active.length
    ? `<div class="shift">${active.map((x) =>
        `<button class="shift__btn" data-shift="${esc(x.name)}">${esc(x.name)}</button>`).join('')}</div>`
    : `<p class="hint">В списке пока никого. Впишите имя — оно сразу появится в настройках.</p>
       <div class="row"><input type="text" id="shiftNew" placeholder="Имя продавца" autocomplete="off">
         <button class="btn btn--primary" id="shiftAdd">Добавить и начать смену</button></div>`;

  openModal({
    title: 'Кто на смене?',
    dismissible: !initial,
    body: `<p class="hint">${initial
        ? 'Приложение запущено заново — выберите себя. Все операции этой смены будут записаны на выбранное имя.'
        : 'Выберите, кто продолжает работу. Все следующие операции будут записаны на это имя.'}</p>
      ${list}`,
    onOpen: (box) => {
      box.addEventListener('click', async (e) => {
        const pick = e.target.closest('[data-shift]');
        if (pick) return startShift(pick.dataset.shift);
        if (!e.target.closest('#shiftAdd')) return;
        const name = box.querySelector('#shiftNew').value.trim();
        if (!name) return;
        try {
          await apiPost('/api/sellers', { name });
          state.data = await apiGet('/api/bootstrap');
          startShift(name);
        } catch (err) { toast(esc(err.message), { kind: 'err' }); }
      });
      const input = box.querySelector('#shiftNew');
      if (input) input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); box.querySelector('#shiftAdd').click(); }
      });
    },
    // Обязательное окно смены закрыть нечем — иначе операции уйдут в журнал без
    // имени. Но тот, кто пришёл по сети, мог просто перепутать код: не заставлять
    // же его занимать чужую смену, чтобы вернуться к просмотру.
    buttons: initial
      ? (state.data.local === false
          ? [{ label: 'Сменить роль', onClick: () => switchRole() }] : [])
      : [{ label: 'Отмена', onClick: (close) => close() }],
  });
}

// Роль зашита в маркер входа, поэтому сменить её можно только заново
// представившись: выходим и возвращаемся на экран ввода кода.
async function switchRole() {
  if (!confirm('Выйти и ввести код заново?\n\n'
    + 'Роль зависит от того, какой код ввести: код продавца даёт полный доступ, '
    + 'код наблюдателя — только просмотр.')) return;
  try { await apiPost('/api/logout'); } catch (_) { /* всё равно перезагружаемся */ }
  location.reload();
}

// Ни одна операция не должна уйти в журнал без имени продавца.
function requireShift() {
  if (state.seller) return true;
  askShift({ initial: true });
  return false;
}

function startShift(name) {
  state.seller = name;
  saveShift(name);
  renderSellerSelect();
  closeModal(true);
  toast(`Смена: <b>${esc(name)}</b>`);
}

/* ---------- Меню причин на кнопках − и + ---------- */

let popContext = null;

function openReasonPopover(anchor, product, size, direction) {
  const row = product.sizes.find((s) => s.size === size) || {};
  const alt = (row.alt_1c || '').trim();
  const held = row.blocked_qty || 0;
  const available = Math.max(0, (row.qty || 0) - held);
  const stop = product.blocked
    ? (product.block_note || 'товар снят с продажи')
    : (held && available === 0
        ? `все ${held} шт сняты с продажи` + (row.block_note ? ': ' + row.block_note : '')
        : '');
  const partial = !product.blocked && held && available > 0
    ? `Снято с продажи ${held} шт из ${row.qty}. Доступно к продаже: ${available}.`
      + (row.block_note ? ' ' + row.block_note : '')
    : '';
  popContext = { product, size, direction };

  const label = isSouvenir(product) ? product.title : `${product.title}, размер ${size}`;
  const head = direction > 0 ? 'Прибавить' : direction < 0 ? 'Убавить' : 'Изменить остаток';
  $('#popTitle').innerHTML = `<b>${esc(head)}</b> · ${esc(label)}`
    + (product.attention
        ? `<div class="pop__note"><b>❗ Обратите внимание.</b> ${esc(product.attention)}</div>` : '')
    + (stop ? `<div class="pop__stop"><b>Снят с продажи.</b> ${esc(stop)}</div>` : '')
    + (partial ? `<div class="pop__stop">${esc(partial)}</div>` : '')
    + (alt ? `<div class="pop__alt"><b>Пересорт.</b> Пробивать в кассе как:<br>${esc(alt)}
              ${row.alt_note ? `<span class="muted">${esc(row.alt_note)}</span>` : ''}</div>` : '');
  $('#popQty').value = 1;

  const item = (r) => {
    const off = stop && r.kind === 'sale';
    return `<button class="pop__item ${off ? 'is-off' : ''}" data-kind="${r.kind}" ${off ? 'disabled' : ''}>
      <span class="pop__label">${esc(r.label)}</span>
      <span class="pop__hint">${off ? 'недоступно: товар снят с продажи' : esc(r.hint)}</span>
    </button>`;
  };
  const group = (title, list) => `<div class="pop__group">${title}</div>` + list.map(item).join('');

  $('#popList').innerHTML = direction === 0
    ? group('Списать', state.data.minus_reasons) + group('Добавить', state.data.plus_reasons)
    : (direction > 0 ? state.data.plus_reasons : state.data.minus_reasons).map(item).join('');

  placePopover($('#pop'), anchor);
}

function placePopover(pop, anchor) {
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
  const { product, size } = popContext;
  const plus = state.data.plus_reasons.some((r) => r.kind === kind);
  const direction = plus ? 1 : -1;
  const qty = Math.max(1, Number($('#popQty').value) || 1);
  closePopover();
  try {
    const res = await apiPost('/api/move', {
      product_id: product.id, size, delta: direction * qty, kind,
    });
    applyQty(product.id, size, res.qty, direction);
    const label = state.data.kind_labels[kind];
    const where = isSouvenir(product) ? product.title : `${product.title}, ${size}`;
    const row = product.sizes.find((s) => s.size === size);
    const alt = kind === 'sale' && row && (row.alt_1c || '').trim();
    toast(`${esc(label)}: <b>${esc(where)}</b> ${direction > 0 ? '+' : '−'}${qty} · осталось ${res.qty}`
      + (alt ? ` <span class="toast__warn">пробить как: ${esc(alt)}</span>` : '')
      + (res.needs_punch ? ' <span class="toast__warn">не пробито в кассе</span>' : ''),
      { kind: direction > 0 ? 'ok' : 'sale', undoId: qty === 1 ? res.movement_id : null });
    if (res.needs_punch) refreshCounters();
  } catch (err) {
    toast(esc(err.message), { kind: 'err' });
  }
}

/* ---------- Загрузка состояния ---------- */

async function reload() {
  state.data = await apiGet('/api/bootstrap');
  // Если продавца убрали из смены, пока приложение работало, — просим выбрать заново.
  if (state.seller && !state.data.sellers.some((s) => s.name === state.seller && s.active)) {
    state.seller = '';
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
  const options = (selected) => (active.length
    ? (selected ? '' : '<option value="">— выберите смену —</option>')
      + active.map((s) => `<option ${s.name === selected ? 'selected' : ''}>${esc(s.name)}</option>`).join('')
    : '<option value="">— добавьте в настройках —</option>');
  $('#sellerSelect').innerHTML = options(state.seller);
  $('#sellerSelect').classList.toggle('is-empty', !state.seller);
  $('#wSeller').innerHTML = options(state.seller);
  $('#journalSeller').innerHTML = '<option value="">Все продавцы</option>' +
    state.data.sellers.map((s) =>
      `<option ${s.name === state.journal.seller ? 'selected' : ''}>${esc(s.name)}</option>`).join('');
}

function categoryOptions(selected) {
  return '<option value="">Все категории</option>' +
    Object.entries(state.data.categories).map(([id, label]) =>
      `<option value="${id}" ${selected === id ? 'selected' : ''}>${esc(label)}</option>`).join('');
}

function renderRepFilters() {
  $('#journalCategory').innerHTML = categoryOptions(state.journal.category);
  $('#catalogCategory').innerHTML = categoryOptions(state.catalogCategory);
  const cats = state.data.categories;
  $('#repCategory').innerHTML = '<option value="">Все категории</option>' +
    Object.entries(cats).map(([id, label]) =>
      `<option value="${id}" ${state.report.category === id ? 'selected' : ''}>${esc(label)}</option>`).join('');
  $('#repKind').innerHTML = '<option value="">Все типы товара</option>' +
    state.data.facets.kinds.map((k) =>
      `<option value="${esc(k)}" ${state.report.kind === k ? 'selected' : ''}>${esc(k)}</option>`).join('');
  $('#wishStatus').innerHTML = '<option value="">Все заявки</option>'
    + `<option value="__open" ${state.wishes.status === '__open' ? 'selected' : ''}>Только незакрытые</option>`
    + state.data.wish_statuses.map((s) =>
      `<option value="${s.id}" ${state.wishes.status === s.id ? 'selected' : ''}>${esc(s.label)}</option>`).join('');
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

// Размеры товара с учётом выбранного фильтра размеров.
function shownSizes(p) {
  const picked = state.filters.sizes;
  if (!picked.length || isSouvenir(p)) return p.sizes;
  return p.sizes.filter((s) => picked.includes(s.size));
}

function visibleProducts() {
  const f = state.filters;
  const low = state.data.settings.low_stock;
  const needle = f.q.trim().toLowerCase();
  return state.data.products.filter((p) => {
    if (f.category && p.category !== f.category) return false;
    if (f.kind && p.kind !== f.kind) return false;
    if (f.color && colorKey(p.color) !== f.color) return false;
    if (f.print && p.print_name !== f.print) return false;
    // Фильтр по размерам — про одежду: сувенирку он прячет. Показываем только
    // те модели, где выбранный размер действительно есть в наличии.
    if (f.sizes.length
        && (isSouvenir(p) || !shownSizes(p).some((s) => s.qty > 0))) return false;
    if (f.no1c && !p.needs_1c) return false;
    if (f.blocked && !p.blocked && !p.blocked_qty) return false;
    if (f.lowOnly && !shownSizes(p).some((s) => ['size--zero', 'size--low'].includes(stockClass(s.qty, p, s)))) return false;
    if (needle) {
      const hay = `${p.kind} ${p.color} ${p.print_name} ${p.material} ${p.note} ${p.name_1c}`.toLowerCase();
      if (!needle.split(/\s+/).every((word) => hay.includes(word))) return false;
    }
    return true;
  }).sort(sortComparator(state.sort));
}

const byTitle = (a, b) => a.title.localeCompare(b.title, 'ru');

// Общая для «Остатков» и «Товаров»: строка выбора одинаковая в обоих местах.
function sortComparator(mode) {
  switch (mode) {
    case 'price_asc': return (a, b) => a.price - b.price || byTitle(a, b);
    case 'price_desc': return (a, b) => b.price - a.price || byTitle(a, b);
    case 'stock_desc': return (a, b) => b.total - a.total || byTitle(a, b);
    case 'stock_asc': return (a, b) => a.total - b.total || byTitle(a, b);
    case 'color': return (a, b) => {
      const ka = colorSortKey(a.color), kb = colorSortKey(b.color);
      // Разные написания одного цвета — одна группа, внутри неё по названию.
      return ka[0] - kb[0] || ka[1] - kb[1]
        || colorKey(a.color).localeCompare(colorKey(b.color), 'ru') || byTitle(a, b);
    };
    default: return (a, b) => a.category.localeCompare(b.category) || byTitle(a, b);
  }
}

// Один пункт на цвет, а не на каждое написание: «бордовый» и «бордовая» — одно.
// Товары выбранной категории. Фильтры строятся по ним, а не по всему складу:
// в «Одежде» незачем предлагать «Термос», а в сувенирке — «Лонгслив».
function productsInCategory() {
  const cat = state.filters.category;
  return cat ? state.data.products.filter((p) => p.category === cat) : state.data.products;
}

function colorOptions() {
  const groups = new Map();
  productsInCategory().forEach((p) => {
    const key = colorKey(p.color);
    if (!key) return;
    if (!groups.has(key)) {
      const hit = swatchEntry(p.color);
      groups.set(key, { label: (hit && hit[2]) || p.color, color: p.color });
    }
  });
  return [...groups.entries()]
    .sort((a, b) => {
      const ka = colorSortKey(a[1].color), kb = colorSortKey(b[1].color);
      return ka[0] - kb[0] || ka[1] - kb[1] || a[1].label.localeCompare(b[1].label, 'ru');
    })
    .map(([key, g]) => [key, g.label]);
}

function renderFilters() {
  const { facets, categories } = state.data;
  const f = state.filters;

  // Категория — не такой же фильтр, как остальные: это главное деление товара,
  // поэтому отдельная строка и вид переключателя, а не чипа.
  const counts = { '': state.data.products.length };
  state.data.products.forEach((p) => { counts[p.category] = (counts[p.category] || 0) + 1; });
  const cat = (id, label) => `<button class="cat ${f.category === id ? 'is-active' : ''}"
      data-cat="${id}">${esc(label)}<span class="cat__n">${counts[id] || 0}</span></button>`;
  $('#cats').innerHTML = cat('', 'Всё вместе')
    + Object.entries(categories).map(([id, label]) => cat(id, label)).join('');

  const shown = productsInCategory();
  const kindList = [...new Set(shown.map((p) => p.kind))].sort((a, b) => a.localeCompare(b, 'ru'));
  const printList = [...new Set(shown.map((p) => p.print_name).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, 'ru'));
  const kinds = kindList.map((k) =>
    `<button class="chip ${f.kind === k ? 'is-active' : ''}" data-filter="kind" data-value="${esc(k)}">${esc(k)}</button>`).join('');
  const sel = (name, label, values, current) => values.length
    ? `<select class="select" data-filter="${name}">
         <option value="">${label}</option>
         ${values.map(([value, text]) => `<option value="${esc(value)}" ${current === value ? 'selected' : ''}>${esc(text)}</option>`).join('')}
       </select>` : '';
  $('#filters').innerHTML = kinds
    + sel('color', 'Любой цвет', colorOptions(), f.color)
    + sel('print', 'Любой принт', printList.map((v) => [v, v]), f.print)
    + `<button class="chip chip--danger ${f.lowOnly ? 'is-active' : ''}" data-filter="lowOnly">Заканчивается</button>`
    + `<button class="chip chip--warn ${f.no1c ? 'is-active' : ''}" data-filter="no1c">Нет в 1С</button>`
    + `<button class="chip chip--stop ${f.blocked ? 'is-active' : ''}" data-filter="blocked">Снято с продажи</button>`;

  // Размеры — отдельной строкой, выбирать можно сразу несколько.
  const sizes = facets.sizes || [];
  const box = $('#sizeFilter');
  box.hidden = !sizes.length;
  box.innerHTML = sizes.length ? `
    <span class="sizefilter__label">Размеры</span>
    ${sizes.map((size) => `<button class="chip chip--size ${f.sizes.includes(size) ? 'is-active' : ''}"
        data-size-filter="${esc(size)}">${esc(size)}</button>`).join('')}
    ${f.sizes.length ? '<button class="chip chip--clear" data-size-filter="__clear">Все размеры</button>' : ''}` : '';

  $('#resetFilters').hidden = !(f.category || f.kind || f.color || f.print
    || f.sizes.length || f.lowOnly || f.no1c || f.blocked || f.q);
}

// Подсветка остатка — она есть всегда, ровно одна из четырёх:
//   красный — товара нет;
//   жёлтый  — сувенирки осталось ниже порога (у одежды такого не бывает);
//   синий   — при продаже нужно быть внимательным: товар снят с продажи,
//             сняты отдельные экземпляры или у размера свой пересорт в 1С;
//   зелёный — всё остальное, продавать можно как обычно.
function stockClass(qty, product, row) {
  if (qty <= 0) return 'size--zero';
  if (isSouvenir(product) && qty <= state.data.settings.low_souvenir) return 'size--low';
  if (needsAttention(product, row)) return 'size--attn';
  return 'size--ok';
}

function needsAttention(product, row) {
  if (product.blocked) return true;
  if (!row) return false;
  return Boolean((row.alt_1c || '').trim()) || (row.blocked_qty || 0) > 0;
}

function renderStock() {
  renderFilters();
  const grid = $('#productGrid');
  const items = visibleProducts();

  $('#stockLegend').innerHTML = state.data.products.length ? `
    <span><b>${items.length}</b> ${plural(items.length, 'модель', 'модели', 'моделей')} на экране</span>
    <span><span class="dot" style="background:var(--danger)"></span>нет товара</span>
    <span><span class="dot" style="background:var(--warn)"></span>сувенирка ≤ ${state.data.settings.low_souvenir} шт</span>
    <span><span class="dot" style="background:var(--accent)"></span>нужно внимание при продаже</span>
    <span><span class="dot" style="background:var(--ok)"></span>всё в порядке</span>
    ${state.filters.sizes.length
      ? `<span><b>${state.filters.sizes.join(', ')}</b> — показаны только эти размеры</span>` : ''}
    <span class="legend__tip">${canEdit()
      ? 'Кнопки − и + под числом спросят причину операции.'
      : 'Только просмотр: остатки видно, менять их можно за компьютером в магазине.'}</span>` : '';

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

  grid.className = state.view === 'list' ? 'rows' : 'grid';
  if (state.view === 'list') {
    // Блок размеров занимает одинаковую ширину во всех строках — иначе цена и
    // остаток съезжают в зависимости от того, сколько у товара размеров.
    const cols = Math.max(1, ...items.map((p) => shownSizes(p).length));
    grid.style.setProperty('--size-cols', cols);
  } else {
    grid.style.removeProperty('--size-cols');
  }
  grid.innerHTML = state.view === 'list'
    ? items.map(renderRow).join('')
    : items.map(renderCard).join('');
}

function renderRow(p) {
  const rows = shownSizes(p);
  const souvenir = isSouvenir(p);
  const cells = rows.map((s) => {
    const held = s.blocked_qty || 0;
    const stop = p.blocked || (held > 0 && held >= s.qty);
    const hint = [
      souvenir ? p.title : `размер ${s.size}`,
      s.alt_1c ? 'пересорт: ' + s.alt_1c : '',
      held ? `снято с продажи ${held} из ${s.qty}` : '',
    ].filter(Boolean).join(' · ');
    return `<button class="scell ${stockClass(s.qty, p, s)} ${s.alt_1c ? 'scell--alt' : ''} ${stop ? 'scell--stop' : ''}"
        data-product="${p.id}" data-size="${esc(s.size)}" data-act="both" title="${esc(hint)}">
      ${souvenir ? '' : `<span class="scell__size">${esc(s.size)}</span>`}
      <b>${s.qty}</b>${held ? `<i class="scell__held" title="снято с продажи ${held} шт">−${held}</i>` : ''}</button>`;
  }).join('');

  return `<div class="rowitem ${p.blocked ? 'is-stopped' : ''} ${p.total === 0 ? 'is-empty' : ''}">
    <span class="rowitem__dot" style="background:${swatchFor(p.color)}"></span>
    <div class="rowitem__main">
      <span class="rowitem__title">${esc(p.title)}</span>
      ${p.blocked ? '<span class="tag tag--stop">снят с продажи</span>' : ''}
      ${!p.blocked && p.blocked_qty ? `<span class="tag tag--stop">стоп: ${p.blocked_qty} шт</span>` : ''}
      ${p.attention ? `<span class="tag tag--note" title="${esc(p.attention)}">❗</span>` : ''}
      ${p.needs_1c ? '<span class="tag tag--warn">нет в 1С</span>' : ''}
      ${p.overrides ? '<span class="tag tag--alt">пересорт</span>' : ''}
    </div>
    <span class="rowitem__price">${money(p.price)}</span>
    <span class="rowitem__total" title="Всего на складе">${p.total}</span>
    <div class="rowitem__sizes">${cells}</div>
    <button class="icon-btn icon-btn--sm" data-rowmenu="${p.id}" title="Действия с товаром">⋯</button>
  </div>`;
}

function tile(product, s, showLabel) {
  const alt = (s.alt_1c || '').trim();
  const held = s.blocked_qty || 0;
  const stop = product.blocked || (held > 0 && held >= s.qty);
  const where = `${esc(product.title)}${showLabel ? ', размер ' + esc(s.size) : ''}`;
  const hints = [
    alt ? 'Пересорт — продавать в кассе как: ' + alt : '',
    held ? `Снято с продажи ${held} шт из ${s.qty}` + (s.block_note ? ': ' + s.block_note : '') : '',
  ].filter(Boolean).join('\n');
  return `
    <div class="size ${stockClass(s.qty, product, s)} ${alt ? 'size--alt' : ''} ${stop ? 'size--stop' : ''}"
         data-product="${product.id}" data-size="${esc(s.size)}"
         ${hints ? `title="${esc(hints)}"` : ''}>
      ${showLabel ? `<div class="size__label">${esc(s.size)}</div>` : ''}
      <div class="size__qty" aria-label="${where}: ${s.qty} шт">${s.qty}
        ${alt ? '<span class="size__alt">1С</span>' : ''}
        ${held ? `<span class="size__stop" title="Снято с продажи ${held} шт">−${held}</span>` : ''}</div>
      ${canEdit() ? `<div class="size__ctl">
        <button data-act="minus" title="Убавить: продажа, брак, случайный клик" ${s.qty <= 0 ? 'disabled' : ''}>−</button>
        <button data-act="plus" title="Прибавить: поставка, возврат">+</button>
      </div>` : ''}
    </div>`;
}

function renderCard(p) {
  const swatch = swatchFor(p.color);
  const souvenir = isSouvenir(p);
  const rows = shownSizes(p);
  const partial = !souvenir && rows.length < p.sizes.length;
  const body = souvenir
    ? `<div class="sizes sizes--single">${tile(p, p.sizes[0] || { size: '—', qty: 0 }, false)}</div>`
    : `<div class="sizes">${rows.map((s) => tile(p, s, true)).join('')}</div>`;
  const shownQty = rows.reduce((sum, s) => sum + s.qty, 0);

  const flags = [
    p.needs_1c ? '<span class="tag tag--warn" title="У товара не заполнено наименование в 1С">Нет в 1С</span>' : '',
    p.unpunched ? `<span class="tag tag--danger" data-punch="${p.id}" role="button"
        title="Продажи, которые ещё не пробиты в кассе">${p.unpunched} не пробито</span>` : '',
    p.overrides ? `<span class="tag tag--alt" title="Размеры, которые пробиваются под другим наименованием 1С">Пересорт: ${p.overrides}</span>` : '',
    p.attention ? `<span class="tag tag--note" title="${esc(p.attention)}">❗ ${esc(p.attention)}</span>` : '',
    p.blocked ? `<span class="tag tag--stop">Снят с продажи${p.block_note ? ': ' + esc(p.block_note) : ''}</span>` : '',
    !p.blocked && p.blocked_qty ? `<span class="tag tag--stop">Снято с продажи: ${p.blocked_qty} шт</span>` : '',
  ].join('');

  return `<article class="card ${p.total === 0 ? 'is-empty' : ''} ${p.blocked ? 'is-stopped' : ''}">
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
        <div class="card__total">${partial
          ? `${pcs(shownQty)} в выбранных · всего ${p.total}`
          : `всего ${pcs(p.total)}`}</div>
      </div>
    </div>
    ${body}
    <div class="card__foot">
      ${canEdit() ? `
      ${souvenir ? '' : `<button class="btn btn--sm" data-batch="${p.id}">Поставка партии</button>`}
      <button class="btn btn--sm" data-batch="${p.id}" data-inventory="1">Пересчитать</button>
      <button class="btn btn--sm ${p.overrides || p.blocked_qty ? 'btn--alt' : ''}" data-alt="${p.id}"
              title="Пересорт в 1С и запрет продажи по размерам">Отметки размеров</button>` : ''}
      <button class="btn btn--ghost btn--sm" data-history="${p.id}">История</button>
      <button class="btn btn--ghost btn--sm" data-edit-stock="${p.id}">Карточка</button>
    </div>
  </article>`;
}

// В списке кнопки не помещаются, поэтому все действия карточки собраны
// в одно меню под троеточием — вид строки от этого не тяжелеет.
function openRowMenu(anchor, product) {
  const items = [
    canEdit() && !isSouvenir(product) && ['batch', 'Поставка партии', 'приход сразу по всем размерам'],
    canEdit() && ['inventory', 'Пересчитать', 'сверить остаток с полкой'],
    canEdit() && ['marks', 'Отметки размеров', 'пересорт в 1С и стоп-продажа'],
    ['history', 'История', 'операции по этому товару'],
    ['card', 'Карточка', 'цена, размеры, наименование в 1С'],
  ].filter(Boolean);

  $('#rowMenuTitle').innerHTML = esc(product.title)
    + (product.attention
        ? `<div class="pop__note"><b>❗</b> ${esc(product.attention)}</div>` : '');
  $('#rowMenuList').innerHTML = items.map(([act, label, hint]) => `
    <button class="pop__item" data-rowact="${act}">
      <span class="pop__label">${esc(label)}</span>
      <span class="pop__hint">${esc(hint)}</span>
    </button>`).join('');
  rowMenuProduct = product;
  placePopover($('#rowMenu'), anchor);
}

let rowMenuProduct = null;

function closeRowMenu() {
  $('#rowMenu').hidden = true;
  rowMenuProduct = null;
}

/* ---------- Изменение остатка ---------- */

function applyQty(productId, size, qty, direction) {
  const product = state.data.products.find((p) => p.id === productId);
  if (product) {
    const row = product.sizes.find((s) => s.size === size);
    if (row) row.qty = qty; else product.sizes.push({ size, qty });
    product.total = product.sizes.reduce((sum, s) => sum + s.qty, 0);
  }
  // Перерисовываем только изменившуюся ячейку — и в плитках, и в списке.
  const sel = `[data-product="${productId}"][data-size="${CSS.escape(size)}"]`;
  const tileEl = $(`.size${sel}`);
  if (tileEl) {
    const box = tileEl.querySelector('.size__qty');
    box.childNodes[0].nodeValue = qty;
    tileEl.classList.remove('size--zero', 'size--low', 'size--attn', 'size--ok');
    tileEl.classList.add(stockClass(qty, product, product && product.sizes.find((x) => x.size === size)));
    tileEl.querySelector('[data-act="minus"]').disabled = qty <= 0;
    flash(tileEl, direction);
  }
  const cell = $(`.scell${sel}`);
  if (cell) {
    cell.querySelector('b').textContent = qty;
    cell.classList.remove('size--zero', 'size--low', 'size--attn', 'size--ok');
    cell.classList.add(stockClass(qty, product, product && product.sizes.find((x) => x.size === size)));
    flash(cell, direction);
  }

  const card = tileEl && tileEl.closest('.card');
  if (card && product) {
    card.classList.toggle('is-empty', product.total === 0);
    const total = card.querySelector('.card__total');
    if (total) total.textContent = `всего ${pcs(product.total)}`;
  }
  const rowEl = cell && cell.closest('.rowitem');
  if (rowEl && product) {
    rowEl.classList.toggle('is-empty', product.total === 0);
    rowEl.querySelector('.rowitem__total').textContent = product.total;
  }
}

function flash(el, direction) {
  void el.offsetWidth;
  el.classList.add(direction < 0 ? 'flash-down' : 'flash-up');
  setTimeout(() => el.classList.remove('flash-down', 'flash-up'), 460);
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
          } catch (err) { toast(esc(err.message), { kind: 'err' }); }
        },
      },
    ],
  });
}

function openMarks(productId) {
  const product = state.data.products.find((p) => p.id === productId);
  if (!product) return;
  const souvenir = isSouvenir(product);
  const rows = product.sizes.map((s) => `
    <div class="markrow ${s.blocked_qty ? 'is-stopped' : ''}">
      <span class="markrow__size">${souvenir ? 'Весь товар' : esc(s.size)}
        <i>${s.qty} шт</i></span>
      <label class="markrow__stop" title="Сколько отдельных экземпляров сейчас нельзя продать">
        <span>снято, шт</span>
        <input type="number" min="0" max="${s.qty}" data-block="${esc(s.size)}"
               value="${s.blocked_qty || 0}">
      </label>
      <input type="text" data-blocknote="${esc(s.size)}" value="${esc(s.block_note || '')}"
             placeholder="почему снят" class="markrow__note">
      <input type="text" data-size="${esc(s.size)}" value="${esc(s.alt_1c || '')}"
             placeholder="пересорт: как пробивать в кассе">
      <input type="text" data-note="${esc(s.size)}" value="${esc(s.alt_note || '')}"
             placeholder="примечание к пересорту" class="markrow__note">
    </div>`).join('');

  openModal({
    title: `Отметки размеров: ${product.title}`,
    body: `<p class="hint"><b>Снято, шт</b> — сколько отдельных экземпляров этого размера
        сейчас нельзя продать: например, одна толстовка L испачкана или отложена.
        Остальные того же размера продаются как обычно. Приход и списание брака
        остаются доступны в любом случае.<br>
        <b>Пересорт</b> — размер пробивается в кассе под другим наименованием 1С.
        Пустое поле означает, что товар пробивается как обычно${
          product.name_1c ? `: <b>${esc(product.name_1c)}</b>` : ' (наименование товара не заполнено)'}.</p>
      <div class="marklist">${rows}</div>
      <p class="hint">Чтобы снять с продажи весь товар целиком, поставьте флажок
         в его карточке — кнопка «Карточка».</p>`,
    buttons: [
      { label: 'Отмена', onClick: (close) => close() },
      {
        label: 'Сохранить', className: 'btn--primary',
        onClick: async (close) => {
          const items = {};
          $$('#modalBody .markrow').forEach((r) => {
            const name = r.querySelector('[data-size]');
            items[name.dataset.size] = {
              name_1c: name.value,
              note: r.querySelector('[data-note]').value,
              blocked_qty: Number(r.querySelector('[data-block]').value) || 0,
              block_note: r.querySelector('[data-blocknote]').value,
            };
          });
          try {
            const res = await apiPost('/api/marks', { product_id: productId, items });
            close();
            await reload();
            const parts = [];
            if (res.overrides.length) parts.push('пересорт: ' + res.overrides.join(', '));
            if (res.blocked.length) parts.push('снято с продажи: ' + res.blocked.join(', '));
            toast(parts.length ? 'Отметки сохранены — ' + parts.join('; ') : 'Отметки сняты');
          } catch (err) { toast(esc(err.message), { kind: 'err' }); }
        },
      },
    ],
  });
}

/* ---------- Вкладка «Не пробито» ---------- */

async function loadUnpunched() {
  let data;
  try { data = await apiGet('/api/unpunched'); }
  catch (err) { return toast(esc(err.message), { kind: 'err' }); }

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
        ${canEdit() ? `<button class="btn btn--primary btn--sm" data-punch-all="${g.product_id ?? ''}">Пробито всё</button>` : ''}
      </div>
    </div>`).join('');

  const rows = data.items.map((m) => `
    <tr>
      <td class="num muted" style="white-space:nowrap">${fmtDateTime(m.ts)}</td>
      <td>${esc(m.title)}</td>
      <td class="ta-c num">${m.size === '—' ? '' : esc(m.size)}</td>
      <td class="ta-r num">${money(m.price)}</td>
      <td>${esc(m.seller) || '<span class="muted">—</span>'}</td>
      <td class="ta-r">${canEdit()
        ? `<button class="btn btn--sm btn--primary" data-punch-one="${m.id}">Пробито</button>` : ''}</td>
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
    category: j.category, trash: j.trash ? 1 : '',
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
       ${canEdit() ? '<button class="btn btn--sm btn--danger" id="emptyTrash">Очистить корзину</button>' : ''}` : '';

  let data;
  try { data = await apiGet('/api/movements', params); }
  catch (err) { return toast(esc(err.message), { kind: 'err' }); }

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
        <td class="cell-op"><span class="pill pill--${PILL[m.kind] || 'correction'}">${esc(m.kind_label)}</span>${
          m.unpunched ? '<span class="tag tag--danger">не пробито</span>' : ''}</td>
        <td>${esc(m.title) || '<span class="muted">—</span>'}
            ${m.sold_as ? `<span class="tag tag--alt" title="Под этим наименованием продано в 1С">1С: ${esc(m.sold_as)}</span>` : ''}</td>
        <td class="ta-c num">${m.size === '—' ? '' : esc(m.size)}</td>
        <td class="ta-c num" style="font-weight:650;color:${m.delta < 0 ? 'var(--danger)' : m.delta > 0 ? 'var(--ok)' : 'var(--text-faint)'}">
          ${m.delta ? (m.delta > 0 ? '+' : '') + m.delta : '·'}</td>
        <td class="ta-r num">${m.amount ? money(m.amount) : '<span class="muted">—</span>'}</td>
        <td>${esc(m.seller) || '<span class="muted">—</span>'}</td>
        <td class="muted">${esc(m.note)}</td>
        <td class="ta-r" style="white-space:nowrap">${!canEdit() ? '' : j.trash
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
          catch (err) { toast(esc(err.message), { kind: 'err' }); }
        },
      },
      {
        label: 'Откатить и удалить', className: 'btn--primary',
        onClick: async (close) => {
          try { await trashMovement(id, 'undo'); close(); }
          catch (err) { toast(esc(err.message), { kind: 'err' }); }
        },
      },
    ],
  });
}

/* ---------- Желания ---------- */

async function loadWishes() {
  const w = state.wishes;
  const params = { q: w.q };
  if (w.status === '__open') params.open = 1;
  else if (w.status) params.status = w.status;

  let data;
  try { data = await apiGet('/api/wishes', params); }
  catch (err) { return toast(esc(err.message), { kind: 'err' }); }

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
      <td style="font-weight:600">${w.status === 'closed'
        ? `<span class="wish-done" title="Заявка закрыта">✓</span> ` : ''}${esc(w.product)}</td>
      <td>${esc(w.contact) || '<span class="muted">—</span>'}</td>
      <td>${esc(w.seller) || '<span class="muted">—</span>'}</td>
      <td class="muted">${esc(w.note)}</td>
      <td>${canEdit() ? `
        <select class="select select--sm" data-wish-status="${w.id}">
          ${statuses.map((s) => `<option value="${s.id}" ${w.status === s.id ? 'selected' : ''}>${esc(s.label)}</option>`).join('')}
        </select>` : esc(w.status_label)}
      </td>
      <td class="ta-r">${canEdit()
        ? `<button class="btn btn--sm btn--danger" data-wish-delete="${w.id}">Удалить</button>` : ''}</td>
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
  catch (err) { return toast(esc(err.message), { kind: 'err' }); }
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
  const all = state.showArchived
    ? (await apiGet('/api/products', { archived: 1 })).products
    : state.data.products;
  const list = state.catalogCategory
    ? all.filter((p) => p.category === state.catalogCategory)
    : all;
  return [...list].sort(sortComparator(state.catalogSort));
}

async function renderCatalog() {
  const products = await catalogProducts();
  const body = $('#catalogBody');
  if (!products.length) {
    body.innerHTML = `<tr><td colspan="8"><div class="empty">
      <div class="empty__title">${state.catalogCategory ? 'В этой категории пусто' : 'Список пуст'}</div>
      ${state.catalogCategory ? 'Выберите «Все категории» или заведите товар.'
                              : 'Нажмите «Новая одежда» или «Новый сувенир».'}</div></td></tr>`;
    return;
  }
  body.innerHTML = products.map((p) => `
    <tr style="${p.archived ? 'opacity:.55' : ''}">
      <td style="font-weight:600">${esc(p.title)}
        ${p.archived ? '<span class="tag">архив</span>' : ''}
        ${p.blocked ? `<span class="tag tag--stop">снят с продажи</span>` : ''}
        ${!p.blocked && p.blocked_qty ? `<span class="tag tag--stop">стоп: ${p.blocked_qty} шт</span>` : ''}
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
        ${canEdit() ? `
        <button class="btn btn--sm" data-edit="${p.id}">Изменить</button>
        <button class="btn btn--sm" data-archive="${p.id}" data-to="${p.archived ? 0 : 1}">${p.archived ? 'Вернуть' : 'В архив'}</button>
        <button class="btn btn--sm btn--danger" data-delete="${p.id}">Удалить</button>`
        : `<button class="btn btn--sm" data-edit="${p.id}">Открыть</button>`}
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

      <label class="field">Обратить внимание
        <input type="text" id="pAttention" placeholder="например: одну штуку продать по 2000 ₽"
               value="${esc(product?.attention || '')}"></label>
      <p class="hint">Если поле заполнено, на карточке товара появится значок ❗, а перед
         списанием приложение покажет эту заметку.</p>

      <label class="check">
        <input type="checkbox" id="pBlocked" ${product?.blocked ? 'checked' : ''}>
        <span>Снят с продажи целиком</span>
      </label>
      <label class="field">Почему снят с продажи
        <input type="text" id="pBlockNote" placeholder="например: ждём переоценку"
               value="${esc(product?.block_note || '')}"></label>
      <p class="hint">Пока флажок стоит, продавец видит метку на карточке, а продажу
         приложение не проведёт. Приход и списание брака остаются доступны.</p>

      <label class="field">Ссылка на товар в интернет-магазине
        <input type="text" id="pLink" placeholder="store.nsu.ru/…" value="${esc(product?.link || '')}"></label>
      <label class="field">Заметка
        <input type="text" id="pNote" placeholder="например, лимитированная партия" value="${esc(product?.note || '')}"></label>`,
    onOpen: (box) => {
      if (!canEdit()) {
        // Наблюдателю карточка нужна как справка: цена, размеры, наименование
        // в 1С. Поля показываем, но трогать их нельзя.
        box.querySelectorAll('input, select, textarea, [data-preset]')
           .forEach((el) => { el.disabled = true; });
        return;
      }
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
    buttons: !canEdit() ? [{ label: 'Закрыть', onClick: (close) => close() }] : [
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
            attention: $('#pAttention').value,
            blocked: $('#pBlocked').checked,
            block_note: $('#pBlockNote').value,
            material: clothing ? $('#pMaterial').value : '',
            sizes: clothing ? $('#pSizes').value : '',
          };
          try {
            await apiPost(product ? `/api/products/${product.id}` : '/api/products', payload);
            close();
            await reload();
            if (state.tab === 'catalog') await renderCatalog();
            toast(product ? 'Изменения сохранены' : 'Модель добавлена');
          } catch (err) { toast(esc(err.message), { kind: 'err' }); }
        },
      },
    ],
  });
}

/* ---------- Вкладка «Настройки» ---------- */

function fmtSize(bytes) {
  if (!bytes) return '';
  const mb = bytes / 1024 / 1024;
  return mb >= 1 ? `${mb.toFixed(1)} МБ` : `${Math.max(1, Math.round(bytes / 1024))} КБ`;
}

function renderSettings() {
  $('#lowSouvenir').value = state.data.settings.low_souvenir;
  $('#deadDays').value = state.data.settings.dead_days;
  const size = fmtSize(state.data.settings.db_size);
  $('#dbSize').textContent = size ? `сейчас ${size}` : '';
  $('#sellerList').innerHTML = state.data.sellers.length
    ? state.data.sellers.map((s) => `
      <li>
        <span class="name ${s.active ? '' : 'is-off'}">${esc(s.name)}</span>
        <button class="btn btn--sm" data-seller="${s.id}" data-active="${s.active ? 0 : 1}">
          ${s.active ? 'Убрать из смены' : 'Вернуть'}</button>
      </li>`).join('')
    : '<li class="muted">Пока никого. Добавьте хотя бы одного продавца.</li>';
  renderShare();
}

/* ---------- Совместный доступ по сети ---------- */

async function refreshShare() {
  try {
    const fresh = await apiGet('/api/bootstrap');
    state.data.share = fresh.share;
    if (state.tab === 'settings') renderShare();
  } catch (_) { /* не смогли — покажем при следующем открытии вкладки */ }
}

// Настоящая проверка подключением, а не догадки по настройкам.
async function runShareCheck() {
  const out = $('#shareCheckOut');
  out.innerHTML = '<div class="share__note">Проверяю…</div>';
  try {
    const res = await apiPost('/api/share/check');
    state.data.share = res;
    const kind = res.check === 'ok' ? 'share__ok' : 'share__warn';
    out.innerHTML = `<div class="${kind}">${esc(res.message)}</div>`;
  } catch (err) {
    out.innerHTML = `<div class="share__warn">${esc(err.message)}</div>`;
  }
}

// Блок виден только на самом компьютере с базой: сервер отдаёт state.data.share
// лишь запросам с этой машины, а по сети присылает null.
function renderShare() {
  const share = state.data.share;
  const panel = $('#sharePanel');
  panel.hidden = !share;
  if (!share) return;

  $('#shareToggle').checked = share.enabled;
  if (!share.enabled) {
    $('#shareBody').innerHTML = `
      <p class="panel__hint">Пока доступ выключен, приложение видно только на этом
         компьютере — из сети до него не достучаться.</p>`;
    return;
  }

  // Адрес показываем, только если сокет и правда слушает сеть. Показать его
  // раньше — значит отправить человека по ссылке, на которой его встретит
  // «не удалось установить соединение».
  const address = !share.listening
    ? `<div class="share__warn">Приложение ещё не слушает сеть — адрес появится,
         когда это произойдёт. Обычно достаточно секунды; если надпись не уходит,
         закройте приложение кнопкой «Завершить работу» и запустите ярлык заново.</div>`
    : share.addresses.length
      ? share.urls.map((u) => `<div><code class="share__url">${esc(u)}</code></div>`).join('')
      : `<div class="share__warn">Компьютер не подключён к локальной сети: сетевого
           адреса нет. Проверьте кабель или Wi-Fi.</div>`;

  $('#shareBody').innerHTML = `
    <div class="share__row">
      <div class="share__label">Адрес для коллеги</div>
      ${address}
      <p class="panel__hint">Этот адрес открывают в браузере на другом компьютере.
         Он работает, пока приложение запущено, а компьютер не спит. Адресов может
         быть несколько — подойдёт тот, что начинается так же, как адрес коллеги.</p>
      <button class="btn btn--sm" id="shareCheck">Проверить доступ</button>
      <div id="shareCheckOut"></div>
    </div>
    ${Object.entries(share.codes).map(([role, code]) => `
      <div class="share__row">
        <div class="share__label">${esc(share.role_labels[role] || role)}</div>
        <div class="share__code">
          <code>${esc(code)}</code>
          <button class="btn btn--sm" data-newcode="${role}">Сменить</button>
        </div>
        <p class="panel__hint">${esc(share.role_hints[role] || '')}</p>
      </div>`).join('')}
    <p class="panel__hint">Код спрашивают только у тех, кто пришёл по сети: за этим
       компьютером доступ полный и без кода. Введённый код помнится ${share.session_days}
       дней; смена кода тут же выкидывает всех, кто входил по старому.</p>`;
}

function showFarewell() {
  document.body.innerHTML = `<div class="farewell">
    <div class="farewell__mark">НГУ</div>
    <h1>Приложение закрыто</h1>
    <p>Все продажи и приёмки сохранены в базе. Эту вкладку можно закрыть.</p>
    <p class="muted">Чтобы начать работу снова, дважды щёлкните по ярлыку «Запустить».</p>
  </div>`;
}

/* ---------- Справка ---------- */

// Справка идёт по пути продавца: сначала общее устройство и смена, потом работа
// за прилавком, затем справочник, и только в конце редкие разделы — отчёты,
// настройки и совместный доступ. Каждая тема объясняется ровно в одном месте,
// остальные на неё ссылаются: так текст не расползается при следующей правке.
const HELP_SECTIONS = [
  ['С чего начать', `
    <p>Приложение заменяет таблицу учёта: сколько чего лежит на складе, что продано
       и что пора заказать. Всё хранится на этом компьютере, интернет не нужен.</p>
    <p>Работа разложена по семи вкладкам:</p>
    <ul>
      <li><b>Остатки</b> — главный экран: что есть на складе и кнопки продажи;</li>
      <li><b>Товары</b> — справочник: завести модель, поправить цену, убрать в архив;</li>
      <li><b>Не пробито</b> — продажи, которые ещё не провели через кассу;</li>
      <li><b>Желания</b> — что спрашивали покупатели, но чего не было;</li>
      <li><b>Журнал</b> — вся история: кто, когда и что сделал;</li>
      <li><b>Отчёты</b> — что продаётся, что лежит, что пора заказывать;</li>
      <li><b>Настройки</b> — продавцы, бэкап, выгрузки, доступ по сети.</li>
    </ul>
    <p>Данные сохраняются сразу после каждого действия — нажимать «сохранить» нигде
       не нужно, и закрыть приложение можно в любой момент. Кнопка <b>◐</b> в шапке
       переключает светлую и тёмную тему.</p>
    <p>Если база ещё пустая, на «Остатках» будет кнопка <b>«Заполнить примером»</b>:
       она заведёт несколько моделей с продажами, чтобы осмотреться. Поверх ваших
       данных пример не запишется.</p>`],

  ['Смена продавца', `
    <p>При каждом запуске приложение спрашивает, <b>кто на смене</b>, и не даёт работать,
       пока имя не выбрано: иначе операции уйдут в журнал под чужим именем. Окно нельзя
       закрыть ни крестиком, ни клавишей Esc — нужно выбрать себя из списка.</p>
    <p>Выбор держится до перезапуска приложения, но не дольше 12 часов. Обновление
       страницы среди дня ничего не сбрасывает, а если программу оставили включённой
       на ночь — утром она спросит заново.</p>
    <p>Передать смену можно списком в шапке: приложение переспросит для подтверждения.
       Список имён редактируется в «Настройках» → «Продавцы».</p>`],

  ['Остатки: как найти товар', `
    <p>Самая верхняя строка делит склад на <b>одежду</b> (есть размерный ряд) и
       <b>сувенирную продукцию</b> (один счётчик без размеров); «Всё вместе» показывает
       и то и другое.</p>
    <p><b>Поиск</b> ищет сразу по названию, цвету, принту и материалу: «толстовка фиолет»
       найдёт нужное. Быстро попасть в поле — клавиша <code>/</code>.</p>
    <p><b>Фильтры</b> рядом с поиском показывают только то, что встречается в выбранной
       категории: в «Одежде» не предлагаются кружки и термосы, в сувенирке — лонгсливы.
       Это тип товара, цвет, принт, а также «Заканчивается»
       (где что-то на нуле или сувенирки мало), «Нет в 1С» и «Снято с продажи».
       Строка <b>«Размеры»</b> оставляет только выбранные размеры — можно отметить
       несколько сразу, например 42 и 44. В списке останутся лишь те модели, где такой
       размер <b>есть в наличии</b>, а сувенирка при этом фильтре прячется.</p>
    <p><b>Сортировка</b>: по названию, по цвету, по цене и по остатку. Порядок цветов
       естественный — от белого и бежевого через радугу к серому и чёрному; разные
       написания одного цвета («бордовый», «бордовая», «Бордовые») считаются одним.
       Выбор запоминается до следующего раза.</p>
    <p><b>Плитки или список</b> — переключатель рядом с сортировкой. Плитками виден
       каждый размер отдельной кнопкой; списком на экран помещается вдвое больше товара,
       а все действия карточки собраны под кнопкой <b>⋯</b> в конце строки. Стрелка
       <b>↗</b> у названия ведёт на товар в интернет-магазине, если ссылка заполнена.</p>`],

  ['Подсветка и метки', `
    <p>Каждая клетка размера всегда окрашена — ровно в один из четырёх цветов:</p>
    <ul>
      <li><span class="help-dot" style="background:var(--danger)"></span>
          <b>красный</b> — товара нет совсем;</li>
      <li><span class="help-dot" style="background:var(--warn)"></span>
          <b>жёлтый</b> — осталось мало, <b>только у сувенирной продукции</b>: у одежды
          одна-две штуки размера это норма, а не повод для тревоги. Порог задаётся
          в «Настройках»;</li>
      <li><span class="help-dot" style="background:var(--accent)"></span>
          <b>синий</b> — при продаже нужно быть внимательным: в «Отметках размеров»
          по этой позиции что-то заполнено (пересорт или снятые экземпляры);</li>
      <li><span class="help-dot" style="background:var(--ok)"></span>
          <b>зелёный</b> — всё остальное: продавать можно как обычно.</li>
    </ul>
    <p>Рядом с названием бывают ярлыки: <b>Нет в 1С</b>, <b>N не пробито</b> (нажимается
       и ведёт на соответствующую вкладку), <b>Пересорт: N</b>, <b>Снят с продажи</b>,
       <b>Снято с продажи: N шт</b> и <b>❗</b> с заметкой «Обратить внимание».
       Цветная полоска слева от названия подбирается по слову в поле «Цвет» — полный
       список оттенков смотрите во вкладке «Гайд по цветам» этой же справки.</p>`],

  ['Как менять остаток', `
    <p>Число на плитке — просто подпись, нажать на него нельзя: так не спишешь товар
       случайным движением мыши. Остаток меняют кнопки <b>−</b> и <b>+</b> под числом,
       и каждая сначала спрашивает причину и количество.</p>
    <ul>
      <li><b>+</b> — Поставка (пришла партия) · Возврат (покупатель вернул товар) ·
          Случайный клик (лишнее списание, вернуть на склад);</li>
      <li><b>−</b> — Продажа · Брак (товар испорчен) ·
          Случайный клик (лишний приход, убрать со склада).</li>
    </ul>
    <p><b>Случайный клик</b> есть в обоих меню и правит ошибку в любую сторону: списали
       лишнее — верните плюсом, приняли лишнее — уберите минусом.</p>
    <p>Ошиблись — нажмите <b>«Отменить»</b> во всплывающем уведомлении сразу или
       <b>«Откатить»</b> в журнале позже. Остаток вернётся, а в журнале останутся обе
       записи: история не переписывается.</p>
    <p>В отображении списком нажимают на саму клетку размера — меню откроется сразу
       с обеими половинами, «Прибавить» и «Убавить».</p>`],

  ['Поставка партии и пересчёт', `
    <p>Две кнопки на карточке одежды (в списке — под <b>⋯</b>):</p>
    <p><b>«Поставка партии»</b> — приход сразу по всем размерам одной накладной. Впишите,
       сколько штук пришло по каждому размеру; пустые поля пропускаются. Так же удобно
       вводить остатки в самый первый раз.</p>
    <p><b>«Пересчитать»</b> — инвентаризация. Здесь вписывают не «сколько пришло»,
       а <b>сколько лежит на полке сейчас</b>; приложение само посчитает разницу
       и запишет её в журнал как коррекцию. Строки, где число совпало с учётным,
       не трогаются.</p>
    <p>У сувенирной продукции размеров нет, поэтому доступен только пересчёт.</p>`],

  ['Карточка товара', `
    <p>Открывается кнопкой <b>«Карточка»</b> на «Остатках» или <b>«Изменить»</b>
       на вкладке «Товары». Там же заводят новые модели — кнопками
       «+ Новая одежда» и «+ Новый сувенир».</p>
    <ul>
      <li><b>Тип, цвет, принт</b> — из них складывается название товара на всех экранах;</li>
      <li><b>Цена</b> — за штуку, попадает в журнал и отчёты;</li>
      <li><b>Материал</b> — только у одежды, ищется поиском;</li>
      <li><b>Размерный ряд</b> — готовые наборы (российские 42–56, буквенные XXS–3XL,
          OS для шоперов) или свой через запятую. Размер с остатком удалить нельзя —
          сначала спишите товар;</li>
      <li><b>Наименование в 1С</b> — см. следующий раздел;</li>
      <li><b>Обратить внимание</b> — короткая заметка для продавца. Пока она заполнена,
          на «Остатках» рядом с названием висит <b>❗</b>, и та же заметка всплывает
          в меню причин перед списанием. Для разовых оговорок: «одна кружка со сколом —
          отдать за 400 ₽»;</li>
      <li><b>Снят с продажи целиком</b> и причина — карточка станет полосатой, а пункт
          «Продажа» в меню недоступен. Приход, возврат и брак при этом работают;</li>
      <li><b>Ссылка</b> на товар в интернет-магазине и <b>заметка</b> для себя.</li>
    </ul>
    <p>Любая правка карточки попадает в журнал с перечнем того, что именно изменилось:
       «цена: 4200 ₽ → 3900 ₽». Если ничего не тронули, записи не будет.</p>`],

  ['Отметки размеров: пересорт и стоп-продажа', `
    <p>Кнопка <b>«Отметки размеров»</b> открывает список размеров товара, где у каждого
       есть две настройки. Обе делают клетку размера синей — знаком «продавать
       внимательно».</p>
    <p><b>Пересорт</b> — размер нужно пробивать в кассе под другим наименованием 1С.
       Впишите его и, если нужно, примечание. Такой размер помечается значком <b>1С</b>,
       а перед списанием меню крупно напомнит, под каким именем пробивать. То же имя
       сохранится в журнале, так что при сверке видно, что и как ушло.</p>
    <p><b>Снято, шт</b> — сколько отдельных экземпляров этого размера продавать нельзя.
       Например, из пяти толстовок L одна испачкана: ставим 1, и продать можно будет
       только четыре. На плитке появится метка <b>−1</b>. Отметка привязана к штукам,
       а не ко всему размеру, поэтому уходит сама: списали испачканную как брак —
       счётчик обнулился, и новая партия придёт уже чистой.</p>
    <p>Чтобы запретить продажу товара целиком, а не отдельных штук, используйте флажок
       «Снят с продажи целиком» в карточке товара.</p>`],

  ['Наименование в 1С и «Не пробито»', `
    <p>Пока в карточке не заполнено <b>наименование в 1С</b>, стоит флажок
       «Не заведён в 1С», и каждая продажа такого товара помечается как
       <b>не пробитая в кассе</b> — так бывает, когда оплату приняли раньше, чем товар
       можно провести через кассу.</p>
    <p>Вкладка <b>«Не пробито»</b> собирает все такие продажи: сколько их, на какую сумму,
       по каким товарам и в чью смену. Пробили чек — нажмите «Пробито» у записи или
       «Пробито всё» у товара.</p>
    <p>Заполнение наименования в 1С само по себе флажки не снимает: это разные вещи —
       товар заведён в номенклатуре, но чек по прошлым продажам ещё не пробит.
       Если у размера задан пересорт, его продажа сразу считается пробиваемой и сюда
       не попадает.</p>`],

  ['Товары: архив и удаление', `
    <p>Вкладка <b>«Товары»</b> — весь справочник списком, с фильтром по категории
       и сортировкой по названию, цене или остатку.</p>
    <p><b>Архив</b> — для того, что кончилось или снято с ассортимента. Товар исчезает
       с «Остатков», но остаётся в отчётах и журнале; вернуть можно в любой момент.
       Переключатель «Показывать архив» открывает такие позиции в списке.</p>
    <p><b>Удаление</b> работает всегда, даже если по товару уже были продажи. Записи
       журнала при этом никуда не деваются: у каждой сохранён снимок названия, а в журнал
       добавляется отметка об удалении с числом сохранённых операций. Если сомневаетесь —
       лучше архив: он ничего не теряет.</p>`],

  ['Желания', `
    <p>Вкладка <b>«Желания»</b> — что спрашивали покупатели, но чего не было в наличии:
       товар, дата обращения, контакты клиента, продавец и комментарий. Пригодится
       при заказе новой партии и чтобы перезвонить, когда товар придёт.</p>
    <p>У заявки есть статус: <b>ждёт</b> → <b>клиенту сообщили</b> → <b>закрыта</b>.
       Закрытые никуда не деваются: они остаются в списке, помечены галочкой и уходят
       вниз. Убрать их можно только вручную кнопкой «Удалить» — приложение само заявки
       не стирает. Список сверху фильтруется по статусу, если нужны только незакрытые.</p>
    <p>Всё, что происходит с заявками, попадает в журнал: кто записал, кто поправил,
       кто сменил статус и кто удалил. В журнале для этого есть отдельная группа
       «Желания».</p>`],

  ['Журнал и корзина', `
    <p><b>Журнал</b> хранит всё: продажи, поставки, возвраты, брак, коррекции, правки
       справочника (заведение товара, изменение карточки, архив, удаление) и работу
       с желаниями. По каждой записи видно, когда, кто, что, сколько штук и на какую
       сумму.</p>
    <p>Фильтры сверху: поиск по тексту, категория, группа записей («Движение товара»,
       «Справочник товаров» или «Желания»), тип операции, продавец и период. Кнопка <b>«История»</b> на карточке товара
       открывает журнал сразу по одной модели.</p>
    <p><b>«Откатить»</b> возвращает товар на склад и оставляет пометку об отмене.
       <b>«Удалить»</b> убирает запись в корзину — переключатель <b>«Показать корзину»</b>
       рядом с фильтрами показывает её содержимое. Если удаляемая запись ещё учтена
       в остатках, приложение предложит сначала откатить операцию. Из корзины запись
       возвращается обратно, а через 60 дней исчезает сама.</p>
    <p>Стереть журнал целиком можно в «Настройках» → «Данные». Остатки при этом
       не изменятся — журнал их не хранит, — но вместе с историей исчезнет и корзина,
       и разбираться в расхождениях будет уже нечем. Сначала скачайте бэкап;
       приложение переспросит дважды.</p>`],

  ['Отчёты', `
    <p>Период задаётся кнопками (7, 30, 90 дней, год) или парой дат; можно ограничить
       категорией и типом товара.</p>
    <ul>
      <li><b>Что продаётся</b> — штуки, выручка, остаток и на сколько дней его хватит
          при текущем темпе;</li>
      <li><b>Какие размеры вымываются первыми</b> — только по одежде: доля размера
          в продажах против его доли в остатке. Синяя полоса заметно длиннее серой —
          этого размера в следующей партии нужно больше;</li>
      <li><b>Пора заказывать</b> — что продаётся и вот-вот кончится, с оценкой
          количества на месяц вперёд;</li>
      <li><b>Лежит без движения</b> — товар с остатком, который не продавался дольше
          порога из настроек, и сколько денег в нём заморожено.</li>
    </ul>`],

  ['Настройки и бэкап', `
    <p><b>Продавцы</b> — список имён для выбора смены. Убранный из смены продавец
       перестаёт предлагаться, но остаётся в старых записях журнала.</p>
    <p><b>Пороги</b> — сколько штук сувенирки считать «мало» (жёлтая подсветка)
       и через сколько дней без продаж товар попадает в отчёт «Лежит без движения».</p>
    <p><b>Бэкап</b> — вся база одним файлом: товары, остатки, журнал, желания и настройки.
       Кнопка работает не закрывая приложение; рядом показан текущий размер базы.
       Чтобы вернуться к копии, положите скачанный файл в папку <code>data</code>
       под именем <code>merch.db</code> при закрытом приложении.</p>
    <p>Сама база — файл <code>data/merch.db</code> рядом с программой. Технический
       журнал <code>data/app.log</code> нужен только при разборе неполадок и чистится
       сам: записи старше 180 дней удаляются при запуске.</p>
    <p>Кнопка <b>«Завершить работу»</b> в шапке закрывает приложение. Данные сохраняются
       сразу после каждой операции, поэтому закрывать можно в любой момент.</p>`],

  ['Доступ с другого компьютера', `
    <p>Учёт можно открыть из другого кабинета — например, начальнице подразделения.
       Компьютер в магазине остаётся <b>единственным</b>, где живёт база, и раздаёт её
       по локальной сети; второй компьютер ничего не устанавливает, а просто заходит
       браузером по адресу первого. Оба должны быть в одной сети.</p>
    <p><b>Как включить.</b> «Настройки» → «Совместный доступ» → галочка «Открыть доступ
       по локальной сети». Перезапускать ничего не нужно: через секунду появится
       <b>адрес</b> вида <code>http://192.168.1.42:8765/</code> и два <b>кода</b>.
       Пока адрес не показан, приложение ещё не слушает сеть. Адресов может быть
       несколько — коллеге подойдёт тот, что начинается так же, как адрес её компьютера.</p>
    <p><b>Два кода — две роли.</b> Одним общим кодом роли не различить, поэтому их два,
       и роль определяется тем, какой ввели: <b>Продавец</b> — полный доступ;
       <b>Только просмотр</b> — остатки, журнал, отчёты и выгрузки без права что-либо
       менять. Второй и дают начальнице. За самим компьютером в магазине код не
       спрашивают никогда. Код помнится в браузере 14 дней; сменили код в настройках —
       все, кто входил по старому, тут же вылетят.</p>
    <p><b>Как сменить роль.</b> Роль определяется кодом, который ввели при входе,
       поэтому поменять её можно только представившись заново: кнопка
       <b>«Сменить роль»</b> в шапке (она видна только тем, кто пришёл по сети) выходит
       и возвращает на экран ввода кода. Если вошли кодом продавца по ошибке, та же
       кнопка есть и в окне «Кто на смене?» — занимать чужую смену, чтобы выйти,
       не придётся.</p>
    <p><b>Windows спросит про брандмауэр</b> при первом включении: нажмите «Разрешить
       доступ» хотя бы для частных сетей. Если нажать «Отмена», коллега получит
       «не удалось установить соединение», хотя у вас всё будет выглядеть правильно.
       Кнопка <b>«Проверить доступ»</b> подключается к показанному адресу по-настоящему
       и говорит, что именно не так.</p>
    <p><b>Компьютер не должен засыпать</b> — спящая машина не отвечает по сети.
       В Windows: «Параметры» → «Система» → «Питание», поставить «Никогда» для сна
       при работе от сети. <b>Адрес может смениться</b> после перезагрузки роутера;
       актуальный всегда виден в настройках.</p>
    <p><b>Чего делать нельзя.</b> Копировать <code>data/merch.db</code> в сетевую папку
       или в облако и открывать оттуда с двух компьютеров — база так портится
       безвозвратно. Правильный способ ровно один, тот что описан выше.</p>
    <p><b>Что открывается, а что нет.</b> По сети доступен только учёт мерча; добраться
       через приложение до других файлов на компьютере нельзя. Завершение работы,
       настройка доступа и смена кодов работают лишь за самим компьютером — по сети
       их не выполнить даже по коду продавца. Бэкап скачивает только продавец:
       в файле базы лежат и коды доступа.</p>`],

  ['Выгрузки в CSV', `
    <p>Три кнопки в «Настройках», такие же — на «Журнале» и «Отчётах». Файлы разделены
       точкой с запятой: так их открывает Excel при обычных русских региональных
       настройках Windows. Если на компьютере стоит английский формат, двойной клик всё
       перепутает — открывайте через «Данные» → «Из текста/CSV» и укажите разделителем
       точку с запятой вручную.</p>
    <p><b>Остатки</b> — срез склада для сверки с полкой: категория, тип, цвет, принт,
       размер, остаток, цена, наименование в 1С, пересорт и заметка «Обратить внимание».
       В файл попадает только то, что <b>есть в наличии</b>: нулевые размеры
       пропускаются. Снятое с продажи выгружается наравне со всем остальным и никак
       не помечается — на полке оно лежит, значит и в пересчёте участвует.</p>
    <p><b>Журнал</b> учитывает выбранные фильтры — период, категорию, тип операции,
       продавца и поиск. <b>Желания</b> выгружаются целиком, вместе с закрытыми.</p>`],
];

function openHelp(tab = 'guide') {
  const guide = HELP_SECTIONS.map(([title, html]) =>
    `<section class="help-sec"><h3>${esc(title)}</h3>${html}</section>`).join('');

  const groups = [];
  SWATCHES.filter((e) => e[2]).forEach(([, hex, label, group]) => {
    let g = groups.find((x) => x.name === group);
    if (!g) groups.push((g = { name: group, items: [] }));
    g.items.push({ hex, label });
  });
  const colors = `
    <p class="hint">Полоска слева от названия товара красится по слову в поле «Цвет».
       Окончание не важно: «фиолетовый», «фиолетовая» и «фиолетовые» дадут один оттенок.
       Если слово незнакомое, полоска остаётся серой — на учёт это никак не влияет.</p>
    ${groups.map((g) => `
      <section class="help-sec">
        <h3>${esc(g.name)}</h3>
        <div class="colorgrid">${g.items.map((c) => `
          <div class="colorgrid__item">
            <span class="colorgrid__chip" style="background:${c.hex}"></span>
            <span>${esc(c.label)}</span>
          </div>`).join('')}</div>
      </section>`).join('')}`;

  openModal({
    title: 'Справка',
    body: `<div class="helptabs" id="helpTabs">
        <button data-help="guide" class="${tab === 'guide' ? 'is-active' : ''}">Как работать</button>
        <button data-help="colors" class="${tab === 'colors' ? 'is-active' : ''}">Гайд по цветам</button>
      </div>
      <div class="help" id="helpGuide" ${tab === 'guide' ? '' : 'hidden'}>${guide}</div>
      <div class="help" id="helpColors" ${tab === 'colors' ? '' : 'hidden'}>${colors}</div>`,
    onOpen: (box) => {
      box.querySelector('#helpTabs').addEventListener('click', (e) => {
        const btn = e.target.closest('[data-help]');
        if (!btn) return;
        box.querySelectorAll('#helpTabs button').forEach((b) =>
          b.classList.toggle('is-active', b === btn));
        box.querySelector('#helpGuide').hidden = btn.dataset.help !== 'guide';
        box.querySelector('#helpColors').hidden = btn.dataset.help !== 'colors';
        box.parentElement.scrollTop = 0;
      });
    },
    buttons: [{ label: 'Закрыть', className: 'btn--primary', onClick: (close) => close() }],
  });
}

/* ---------- События ---------- */

function bind() {
  $('#tabs').addEventListener('click', (e) => {
    const btn = e.target.closest('.tab');
    if (btn) setTab(btn.dataset.tab);
  });
  $('#sellerSelect').addEventListener('change', (e) => {
    const next = e.target.value;
    // Смена продавца влияет на весь журнал дальше, поэтому спрашиваем подтверждение.
    if (next && next !== state.seller
        && !confirm(`Передать смену: ${next}?\n\nВсе следующие операции будут записаны на это имя.`)) {
      e.target.value = state.seller;
      return;
    }
    state.seller = next;
    saveShift(next);
    $('#wSeller').value = state.seller;
    if (next) toast(`Смена: <b>${esc(next)}</b>`);
  });
  $('#helpBtn').addEventListener('click', () => openHelp());
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
  $('#sizeFilter').addEventListener('click', (e) => {
    const chip = e.target.closest('[data-size-filter]');
    if (!chip) return;
    const size = chip.dataset.sizeFilter;
    if (size === '__clear') state.filters.sizes = [];
    else {
      const picked = state.filters.sizes;
      const at = picked.indexOf(size);
      if (at === -1) picked.push(size); else picked.splice(at, 1);
    }
    renderStock();
  });
  $('#cats').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-cat]');
    if (!btn) return;
    state.filters.category = btn.dataset.cat;
    // Выбранный тип, цвет или принт может не встречаться в новой категории:
    // тогда фильтр остаётся включённым, но его чипа на экране уже нет, и список
    // выглядит пустым без видимой причины. Снимаем такие фильтры.
    const shown = productsInCategory();
    const f = state.filters;
    if (f.kind && !shown.some((p) => p.kind === f.kind)) f.kind = '';
    if (f.color && !shown.some((p) => colorKey(p.color) === f.color)) f.color = '';
    if (f.print && !shown.some((p) => p.print_name === f.print)) f.print = '';
    renderStock();
  });
  $('#filters').addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    const key = chip.dataset.filter;
    if (key === 'lowOnly' || key === 'no1c' || key === 'blocked') state.filters[key] = !state.filters[key];
    else state.filters[key] = state.filters[key] === chip.dataset.value ? '' : chip.dataset.value;
    renderStock();
  });
  $('#filters').addEventListener('change', (e) => {
    const sel = e.target.closest('select[data-filter]');
    if (!sel) return;
    state.filters[sel.dataset.filter] = sel.value;
    renderStock();
  });
  $('#viewToggle').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-view]');
    if (!btn) return;
    state.view = btn.dataset.view;
    localStorage.setItem('merch.view', state.view);
    $$('#viewToggle [data-view]').forEach((b) => b.classList.toggle('is-active', b.dataset.view === state.view));
    renderStock();
  });
  $('#sortBy').addEventListener('change', (e) => {
    state.sort = e.target.value;
    localStorage.setItem('merch.sort', state.sort);
    renderStock();
  });
  $('#resetFilters').addEventListener('click', () => {
    state.filters = { q: '', category: '', kind: '', color: '', print: '', sizes: [],
                      lowOnly: false, no1c: false, blocked: false };
    $('#search').value = '';
    renderStock();
  });

  $('#productGrid').addEventListener('click', async (e) => {
    if (e.target.closest('[data-act], [data-batch]') && !requireShift()) return;
    const seed = e.target.closest('#seedDemo');
    if (seed) {
      if (!confirm('Заполнить базу примером товаров и продаж? Это делается один раз, в пустую базу.')) return;
      seed.disabled = true;
      try {
        const res = await apiPost('/api/demo');
        await reload();
        toast(`Пример добавлен: ${res.added} ${plural(res.added, 'модель', 'модели', 'моделей')}`);
      } catch (err) { seed.disabled = false; toast(esc(err.message), { kind: 'err' }); }
      return;
    }
    const punch = e.target.closest('[data-punch]');
    if (punch) return setTab('punch');
    const batch = e.target.closest('[data-batch]');
    if (batch) return openBatch(Number(batch.dataset.batch), batch.dataset.inventory === '1');
    const alt = e.target.closest('[data-alt]');
    if (alt) return openMarks(Number(alt.dataset.alt));
    const rowMenu = e.target.closest('[data-rowmenu]');
    if (rowMenu) {
      const p = state.data.products.find((x) => x.id === Number(rowMenu.dataset.rowmenu));
      if (p) openRowMenu(rowMenu, p);
      return;
    }
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
    const tileEl = actBtn.closest('.size') || (actBtn.dataset.act === 'both' ? actBtn : null);
    if (!tileEl) return;
    const product = state.data.products.find((p) => p.id === Number(tileEl.dataset.product));
    const dir = { plus: 1, minus: -1, both: 0 }[actBtn.dataset.act];
    openReasonPopover(actBtn, product, tileEl.dataset.size, dir);
  });

  // Меню действий строки
  $('#rowMenuList').addEventListener('click', (e) => {
    const item = e.target.closest('[data-rowact]');
    if (!item || !rowMenuProduct) return;
    const p = rowMenuProduct;
    closeRowMenu();
    switch (item.dataset.rowact) {
      case 'batch': return requireShift() && openBatch(p.id, false);
      case 'inventory': return requireShift() && openBatch(p.id, true);
      case 'marks': return openMarks(p.id);
      case 'card': return openProductForm(p);
      case 'history': {
        state.journal = { offset: 0, limit: 50, q: '', kind: '', group: '', seller: '',
                          category: '', from: '', to: '', trash: false, product_id: p.id };
        ['journalSearch', 'journalKind', 'journalGroup', 'journalCategory', 'journalSeller',
         'journalFrom', 'journalTo'].forEach((id) => { $('#' + id).value = ''; });
        $('#journalTrash').checked = false;
        return setTab('journal');
      }
      default: return undefined;
    }
  });

  // Меню причин
  $('#popList').addEventListener('click', (e) => {
    const item = e.target.closest('[data-kind]');
    if (item) applyReason(item.dataset.kind);
  });
  document.addEventListener('click', (e) => {
    // Экран входа и прощание подменяют весь body, а этот обработчик висит на
    // document и переживает подмену — поэтому проверяем, что элемент ещё есть.
    const pop = $('#pop');
    const menu = $('#rowMenu');
    if (pop && !pop.hidden && !e.target.closest('#pop') && !e.target.closest('[data-act]')) {
      closePopover();
    }
    if (menu && !menu.hidden && !e.target.closest('#rowMenu')
        && !e.target.closest('[data-rowmenu]')) {
      closeRowMenu();
    }
  });
  window.addEventListener('resize', () => { closePopover(); closeRowMenu(); });

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
    } catch (err) { toast(esc(err.message), { kind: 'err' }); }
  });

  // Журнал
  let jTimer;
  $('#journalSearch').addEventListener('input', (e) => {
    clearTimeout(jTimer);
    const value = e.target.value;
    jTimer = setTimeout(() => { state.journal.q = value; state.journal.offset = 0; loadJournal(); }, 220);
  });
  ['journalKind', 'journalGroup', 'journalCategory', 'journalSeller', 'journalFrom',
   'journalTo', 'journalTrash']
    .forEach((id) => $('#' + id).addEventListener('change', () => {
      Object.assign(state.journal, {
        kind: $('#journalKind').value,
        group: $('#journalGroup').value,
        category: $('#journalCategory').value,
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
                      to: '', product_id: '', category: '', trash: false };
    ['journalSearch', 'journalKind', 'journalGroup', 'journalCategory', 'journalSeller',
     'journalFrom', 'journalTo'].forEach((id) => { $('#' + id).value = ''; });
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
    } catch (err) { toast(esc(err.message), { kind: 'err' }); }
  });
  $('#journalBody').addEventListener('click', async (e) => {
    if (e.target.closest('[data-undo], [data-trash]') && !requireShift()) return;
    const undo = e.target.closest('[data-undo]');
    if (undo) {
      undo.disabled = true;
      try {
        await apiPost('/api/undo', { movement_id: Number(undo.dataset.undo) });
        await reload();
        toast('Операция откачена, остаток восстановлен');
      } catch (err) { undo.disabled = false; toast(esc(err.message), { kind: 'err' }); }
      return;
    }
    const trash = e.target.closest('[data-trash]');
    if (trash) {
      const id = Number(trash.dataset.trash);
      try { await trashMovement(id, ''); }
      catch (err) { askTrashMode(id, err.message); }   // текст экранируется в askTrashMode
      return;
    }
    const restore = e.target.closest('[data-restore]');
    if (restore) {
      try {
        await apiPost(`/api/movements/${restore.dataset.restore}/restore`);
        await reload();
        toast('Запись возвращена в журнал');
      } catch (err) { toast(esc(err.message), { kind: 'err' }); }
      return;
    }
    const purge = e.target.closest('[data-purge]');
    if (purge) {
      if (!confirm('Удалить запись навсегда?')) return;
      try {
        await apiPost(`/api/movements/${purge.dataset.purge}/purge`);
        await reload();
        toast('Запись удалена навсегда');
      } catch (err) { toast(esc(err.message), { kind: 'err' }); }
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
    } catch (err) { toast(esc(err.message), { kind: 'err' }); }
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
    } catch (err) { toast(esc(err.message), { kind: 'err' }); }
  });
  $('#wishBody').addEventListener('click', async (e) => {
    const del = e.target.closest('[data-wish-delete]');
    if (!del) return;
    if (!confirm('Удалить эту заявку?')) return;
    try {
      await apiDelete(`/api/wishes/${del.dataset.wishDelete}`);
      await reload();
      toast('Заявка удалена');
    } catch (err) { toast(esc(err.message), { kind: 'err' }); }
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
  $('#catalogCategory').addEventListener('change', (e) => {
    state.catalogCategory = e.target.value;
    renderCatalog();
  });
  $('#catalogSort').addEventListener('change', (e) => {
    state.catalogSort = e.target.value;
    localStorage.setItem('merch.catalogSort', state.catalogSort);
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
      } catch (err) { toast(esc(err.message), { kind: 'err' }); }
      return;
    }
    const del = e.target.closest('[data-delete]');
    if (del) {
      const list = await catalogProducts();
      const p = list.find((x) => x.id === Number(del.dataset.delete));
      const warn = [
        `Удалить «${p ? p.title : 'товар'}» насовсем?`,
        p && p.total ? `На складе ещё ${p.total} шт — остаток пропадёт.` : '',
        'Записи журнала по этому товару останутся как история, в журнал добавится отметка об удалении.',
        'Отменить удаление будет нельзя.',
      ].filter(Boolean).join('\n\n');
      if (!confirm(warn)) return;
      try {
        const res = await apiDelete(`/api/products/${del.dataset.delete}`);
        await reload();
        await renderCatalog();
        toast(res.movements
          ? `Товар удалён · ${res.movements} ${plural(res.movements, 'операция', 'операции', 'операций')} осталось в журнале`
          : 'Товар удалён');
      } catch (err) { toast(esc(err.message), { kind: 'err' }); }
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
    } catch (err) { toast(esc(err.message), { kind: 'err' }); }
  });
  $('#sellerList').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-seller]');
    if (!btn) return;
    try {
      await apiPost(`/api/sellers/${btn.dataset.seller}/active`, { active: btn.dataset.active === '1' });
      await reload();
      renderSettings();
    } catch (err) { toast(esc(err.message), { kind: 'err' }); }
  });
  $('#backupBtn').addEventListener('click', () => {
    toast(`Бэкап сохраняется в загрузки: <b>merch-${today()}.db</b>`, { timeout: 6000 });
  });
  $('#saveSettings').addEventListener('click', async () => {
    try {
      await apiPost('/api/settings', {
        low_souvenir: Math.max(0, Number($('#lowSouvenir').value) || 0),
        dead_days: Number($('#deadDays').value) || 30,
      });
      await reload();
      toast('Настройки сохранены');
    } catch (err) { toast(esc(err.message), { kind: 'err' }); }
  });
  $('#shareToggle').addEventListener('change', async (e) => {
    const on = e.target.checked;
    if (on && !confirm('Открыть доступ к учёту по локальной сети?\n\n'
      + 'Коллеги смогут зайти с других компьютеров по адресу этого компьютера — '
      + 'но только по коду доступа. Коды появятся здесь же.')) {
      e.target.checked = false;
      return;
    }
    try {
      state.data.share = await apiPost('/api/share', { enabled: on });
      renderShare();
      toast(on ? 'Доступ по сети включён' : 'Доступ по сети выключен');
      // Сокет поднимается в другом потоке — через мгновение состояние уже точное.
      if (on) setTimeout(refreshShare, 900);
    } catch (err) {
      e.target.checked = !on;
      toast(esc(err.message), { kind: 'err' });
    }
  });
  $('#shareBody').addEventListener('click', async (e) => {
    if (e.target.closest('#shareCheck')) return runShareCheck();
    const btn = e.target.closest('[data-newcode]');
    if (!btn) return;
    const role = btn.dataset.newcode;
    const label = state.data.share.role_labels[role] || role;
    if (!confirm(`Сменить код «${label}»?\n\n`
      + 'Все, кто заходил по старому коду, тут же вылетят и попросят новый.')) return;
    try {
      state.data.share = await apiPost('/api/share/code', { role });
      renderShare();
      toast(`Новый код: ${esc(state.data.share.codes[role])}`, { timeout: 12000 });
    } catch (err) { toast(esc(err.message), { kind: 'err' }); }
  });
  $('#clearJournal').addEventListener('click', async () => {
    const total = state.data.counters.journal;
    if (!total) return toast('Журнал и так пуст');
    if (!confirm(`Стереть весь журнал — ${total} ${plural(total, 'запись', 'записи', 'записей')}?\n\n`
      + 'Вместе с ним исчезнет корзина. Остатки не изменятся, но восстановить историю '
      + 'будет невозможно.\n\nЕсли бэкап ещё не скачан — отмените и сделайте его сначала.')) return;
    if (!confirm('Точно очистить журнал? Это последнее предупреждение.')) return;
    try {
      const res = await apiPost('/api/journal/clear');
      await reload();
      toast(`Журнал очищен: удалено ${res.removed} ${plural(res.removed, 'запись', 'записи', 'записей')}`);
    } catch (err) { toast(esc(err.message), { kind: 'err' }); }
  });
  $('#logoutBtn').addEventListener('click', switchRole);
  $('#shutdownBtn').addEventListener('click', async () => {
    if (!confirm('Завершить работу приложения? Все данные уже сохранены.')) return;
    try { await apiPost('/api/shutdown'); } catch (_) { /* сервер закрылся, не дослав ответ */ }
    showFarewell();
  });

  // Модалка и клавиши
  $('#modal').addEventListener('click', (e) => { if (e.target.closest('[data-close]')) closeModal(); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const [menu, pop, modal] = [$('#rowMenu'), $('#pop'), $('#modal')];
      if (menu && !menu.hidden) return closeRowMenu();
      if (pop && !pop.hidden) return closePopover();
      if (modal && !modal.hidden) return closeModal();
    }
    if (e.key === '/' && document.activeElement.tagName !== 'INPUT'
        && state.tab === 'stock' && $('#search')) {
      e.preventDefault();
      $('#search').focus();
    }
    const modalNow = $('#modal');
    if (e.key === 'Enter' && modalNow && !modalNow.hidden) {
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

  try {
    state.data = await apiGet('/api/bootstrap');
  } catch (err) {
    if (err.status === 401 || err.status === 403) return showLogin(err);
    document.body.innerHTML = `<div class="empty"><div class="empty__title">Не удалось связаться с сервером</div>
      Запустите приложение ярлыком «Запустить» и обновите страницу.</div>`;
    return;
  }
  bind();

  // Наблюдателю кнопки изменения просто не показываем — запись ему всё равно
  // запретит сервер, но пустые кнопки, которые ругаются, только злят.
  document.body.classList.toggle('is-viewer', !canEdit());
  // Завершение работы — действие за прилавком: по сети сервер его не примет,
  // поэтому и кнопку удалённому продавцу не показываем.
  document.body.classList.toggle('is-remote', state.data.local === false);
  if (!canEdit()) {
    const badge = $('#roleBadge');
    badge.hidden = false;
    badge.textContent = state.data.role_label || 'Только просмотр';
    badge.title = 'Вы вошли по коду наблюдателя: данные видно, менять нельзя';
  }

  $('#journalKind').innerHTML = '<option value="">Все операции</option>' +
    Object.entries(state.data.kind_labels).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('');
  $('#repTo').value = today();
  $('#wDate').value = today();
  $('#sortBy').value = state.sort;
  $('#catalogSort').value = state.catalogSort;
  $$('#viewToggle [data-view]').forEach((b) => b.classList.toggle('is-active', b.dataset.view === state.view));

  state.seller = canEdit() ? loadShift(state.data.run_id, state.data.shift_hours) : '';
  renderSellerSelect();
  renderRepFilters();
  renderBadges();
  setTab('stock');
  // Наблюдатель ничего не пишет в журнал, поэтому и смену не выбирает.
  if (canEdit() && !state.seller) askShift({ initial: true });
}

/* ---------- Вход по коду доступа ---------- */

// Экран для тех, кто пришёл по сети. На самом компьютере с приложением он не
// появляется никогда: там роль продавца выдаётся без всякого кода.
function showLogin(err) {
  document.body.innerHTML = `
    <div class="login">
      <form class="login__box" id="loginForm">
        <div class="login__logo">НГУ</div>
        <h1 class="login__title">Мерч НГУ — учёт товара</h1>
        <p class="login__hint">${err && err.status === 403
          ? esc(err.message)
          : 'Введите код доступа. Его подскажет продавец — код виден у него в «Настройках».'}</p>
        ${err && err.status === 403 ? '' : `
        <input type="text" id="loginCode" class="login__code" autocomplete="one-time-code"
               autocapitalize="characters" spellcheck="false" placeholder="код доступа" autofocus>
        <button class="btn btn--primary login__btn" type="submit">Войти</button>`}
        <div class="login__err" id="loginErr" hidden></div>
      </form>
    </div>`;
  const form = document.getElementById('loginForm');
  const box = document.getElementById('loginErr');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = document.getElementById('loginCode');
    if (!input) return;
    box.hidden = true;
    try {
      await apiPost('/api/login', { code: input.value });
      location.reload();
    } catch (e2) {
      box.textContent = e2.message;
      box.hidden = false;
      input.select();
    }
  });
}

init();
