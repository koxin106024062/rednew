'use strict';

const STORAGE_KEY = 'travel-handbook-v4';
const LEGACY_KEY = 'travel-handbook-v2';
const CLIENT_KEY = 'travel-handbook-client-v2';
const CURRENCIES = ['TWD', 'JPY', 'KRW', 'USD', 'EUR', 'GBP', 'CHF', 'AUD', 'CAD', 'SGD', 'THB', 'VND', 'CNY', 'HKD'];
const MEMBER_COLORS = ['#a91f24', '#bd632b', '#5e8983', '#8b6ea8', '#cf7f71', '#5278a5', '#9a813e'];
const COVER_COLORS = ['#bd632b', '#527f7a', '#865d9b', '#b34f55', '#557c9a', '#9a713e'];
const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyATF86vVSQ8RDsWY-iBPETVXdnCypnokcY',
  authDomain: 'tokyo-bfcfe.firebaseapp.com',
  projectId: 'tokyo-bfcfe',
  storageBucket: 'tokyo-bfcfe.firebasestorage.app',
  messagingSenderId: '1039269605513',
  appId: '1:1039269605513:web:6e0648659a87a736045658'
};

let state = typeof localStorage !== 'undefined' ? loadState() : { version: 4, trips: [], activeTripId: null };
let ui = {
  screen: 'trips',
  activeTab: 'overview',
  tripFilter: 'upcoming',
  activeDay: null,
  applyingRemote: false
};
let toastTimer = null;
let syncTimer = null;
let syncUnsubscribe = null;
let syncStatus = 'local';
let firebase = {};

const app = typeof document !== 'undefined' ? document.getElementById('app') : null;
const tripNav = typeof document !== 'undefined' ? document.getElementById('trip-nav') : null;

if (typeof document !== 'undefined') initialize();

function initialize() {
  populateCurrencySelects();
  bindForms();
  document.addEventListener('click', handleClick);
  document.addEventListener('change', handleChange);
  render();
}

function uid(prefix) {
  const random = Math.random().toString(36).slice(2, 8);
  return (prefix || 'x') + '-' + Date.now().toString(36) + '-' + random;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function esc(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function dateAtNoon(iso) {
  return iso ? new Date(iso + 'T12:00:00') : null;
}

function todayISO() {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function addDays(iso, amount) {
  const date = dateAtNoon(iso) || new Date();
  date.setDate(date.getDate() + amount);
  return date.toISOString().slice(0, 10);
}

function diffDays(fromISO, toISO) {
  const from = dateAtNoon(fromISO);
  const to = dateAtNoon(toISO);
  if (!from || !to) return 0;
  return Math.round((to - from) / 86400000);
}

function formatDate(iso, options) {
  const date = dateAtNoon(iso);
  if (!date || Number.isNaN(date.getTime())) return '未設定';
  return new Intl.DateTimeFormat('zh-TW', options || { month: 'numeric', day: 'numeric', weekday: 'short' }).format(date);
}

function formatRange(trip) {
  if (!trip.startDate || !trip.endDate) return '日期未設定';
  return formatDate(trip.startDate, { year: 'numeric', month: 'numeric', day: 'numeric' }) + ' — ' +
    formatDate(trip.endDate, { month: 'numeric', day: 'numeric' });
}

function formatMoney(amount, currency) {
  const value = Number(amount || 0);
  try {
    return new Intl.NumberFormat('zh-TW', {
      style: 'currency',
      currency: currency || 'TWD',
      maximumFractionDigits: ['JPY', 'KRW', 'TWD', 'VND'].includes(currency) ? 0 : 2
    }).format(value);
  } catch (error) {
    return (currency || '') + ' ' + value.toLocaleString('zh-TW');
  }
}

function memberById(trip, memberId) {
  return trip.members.find(function (member) { return member.id === memberId; });
}

function avatar(member) {
  if (!member) return '';
  return '<span class="avatar" style="--avatar:' + esc(member.color) + '">' + esc(member.name.slice(0, 1)) + '</span>';
}

function typeIcon(type) {
  return {
    spot: '⌖', food: '♨', transport: '➜', hotel: '⌂', activity: '✦', other: '•',
    flight: '✈', train: '▰', car: '◇', ticket: '◈', restaurant: '♨', insurance: '＋'
  }[type] || '•';
}

function tripDates(trip) {
  if (!trip.startDate || !trip.endDate) return [];
  const count = Math.min(Math.max(diffDays(trip.startDate, trip.endDate) + 1, 1), 90);
  return Array.from({ length: count }, function (_, index) { return addDays(trip.startDate, index); });
}

function makeMember(name, index) {
  return {
    id: uid('member'),
    name: name.trim() || '旅伴',
    color: MEMBER_COLORS[index % MEMBER_COLORS.length]
  };
}

function createDemoTrip() {
  const members = [
    { id: 'member-me', name: '我', color: MEMBER_COLORS[0] },
    { id: 'member-friend', name: '旅伴', color: MEMBER_COLORS[2] }
  ];
  return {
    id: 'demo-tokyo-2027',
    title: '東京春日散步',
    subtitle: '把想去的地方，一筆一筆收進旅程裡。',
    startDate: '2027-04-24',
    endDate: '2027-04-28',
    baseCurrency: 'TWD',
    localCurrency: 'JPY',
    coverColor: COVER_COLORS[0],
    destinations: [
      { id: 'dest-tokyo', name: '日本・東京', countryCode: 'JP', timezone: 'Asia/Tokyo', currency: 'JPY' },
      { id: 'dest-kamakura', name: '鎌倉', countryCode: 'JP', timezone: 'Asia/Tokyo', currency: 'JPY' }
    ],
    members: members,
    itinerary: [
      { id: 'plan-1', date: '2027-04-24', time: '15:00', type: 'spot', title: '淺草散步', city: '東京', note: '雷門、仲見世與隅田川', mapUrl: '' },
      { id: 'plan-2', date: '2027-04-24', time: '19:00', type: 'food', title: '晚餐', city: '淺草', note: '抵達後吃一頓熱呼呼的', mapUrl: '' },
      { id: 'plan-3', date: '2027-04-25', time: '09:30', type: 'transport', title: '前往鎌倉', city: '東京 → 鎌倉', note: '確認車票與月台', mapUrl: '' }
    ],
    bookings: [
      { id: 'booking-1', type: 'flight', title: '台北 → 東京', date: '2027-04-24', time: '08:30', location: '桃園國際機場', code: '', note: '請於起飛前 2.5 小時抵達', url: '' },
      { id: 'booking-2', type: 'hotel', title: '東京住宿', date: '2027-04-24', time: '15:00', location: '淺草', code: '', note: '4 晚', url: '' }
    ],
    expenses: [
      { id: 'expense-1', title: '機場到飯店交通', date: '2027-04-24', category: '交通', amount: 3600, currency: 'JPY', exchangeRate: 0.22, baseAmount: 792, payerId: members[0].id, participantIds: members.map(function (m) { return m.id; }), splitMode: 'equal', customSplits: {}, note: '', settled: false }
    ],
    lists: [
      { id: 'list-1', type: 'todo', title: '確認護照效期', done: false, assigneeId: members[0].id },
      { id: 'list-2', type: 'packing', title: '行動電源與充電線', done: false, assigneeId: '' },
      { id: 'list-3', type: 'shopping', title: '伴手禮清單', done: false, assigneeId: members[1].id }
    ],
    documents: [],
    sync: { enabled: false, code: '' },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

function loadState() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) return normalizeState(JSON.parse(saved));
    const legacy = localStorage.getItem(LEGACY_KEY);
    if (legacy) {
      const migrated = migrateLegacy(JSON.parse(legacy));
      localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated));
      return migrated;
    }
  } catch (error) {
    console.warn('Unable to load saved travel data', error);
  }
  return { version: 4, trips: [createDemoTrip()], activeTripId: null };
}

function normalizeState(raw) {
  const normalized = raw && Array.isArray(raw.trips) ? raw : { version: 4, trips: [] };
  normalized.version = 4;
  normalized.activeTripId = normalized.activeTripId || null;
  normalized.trips = normalized.trips.map(normalizeTrip);
  return normalized;
}

function normalizeTrip(trip) {
  const result = Object.assign({
    id: uid('trip'),
    title: '未命名旅程',
    subtitle: '',
    startDate: todayISO(),
    endDate: addDays(todayISO(), 4),
    baseCurrency: 'TWD',
    localCurrency: 'JPY',
    coverColor: COVER_COLORS[0],
    destinations: [],
    members: [],
    itinerary: [],
    bookings: [],
    expenses: [],
    lists: [],
    documents: [],
    sync: { enabled: false, code: '' }
  }, trip || {});
  if (!result.members.length) result.members = [makeMember('我', 0)];
  if (!result.sync) result.sync = { enabled: false, code: '' };
  return result;
}

function migrateLegacy(old) {
  const start = old.startDate || todayISO();
  const member = { id: 'member-me', name: '我', color: MEMBER_COLORS[0] };
  const cities = [];
  (old.days || []).forEach(function (day) {
    if (day.city && !cities.includes(day.city)) cities.push(day.city);
  });
  const itinerary = [];
  (old.days || []).forEach(function (day, dayIndex) {
    (day.items || []).forEach(function (item) {
      itinerary.push({
        id: item.id || uid('plan'),
        date: addDays(start, dayIndex),
        time: item.time || '',
        type: item.type === 'meal' ? 'food' : item.type === 'flight' ? 'transport' : item.type || 'other',
        title: item.title || '未命名行程',
        city: day.city || '',
        note: item.sub || '',
        mapUrl: item.mapUrl || ''
      });
    });
  });
  const trip = normalizeTrip({
    id: uid('trip'),
    title: old.title || '匯入的旅程',
    subtitle: old.subtitle || '從舊版旅遊手帖匯入',
    startDate: start,
    endDate: addDays(start, Math.max((old.days || []).length - 1, 0)),
    baseCurrency: 'TWD',
    localCurrency: 'JPY',
    coverColor: COVER_COLORS[0],
    destinations: cities.map(function (name) { return { id: uid('dest'), name: name, countryCode: '', timezone: '', currency: 'JPY' }; }),
    members: [member],
    itinerary: itinerary,
    bookings: (old.bookings || []).map(function (booking) {
      return {
        id: booking.id || uid('booking'),
        type: booking.type || 'other',
        title: booking.title || '未命名預訂',
        date: '',
        time: '',
        location: '',
        code: booking.code || '',
        note: booking.desc || '',
        url: booking.driveUrl || ''
      };
    }),
    expenses: (old.expenses || []).map(function (expense) {
      return {
        id: expense.id || uid('expense'),
        title: expense.title || '未命名花費',
        date: expense.date || start,
        category: expense.category || '其他',
        amount: Number(expense.amount || 0),
        currency: 'TWD',
        exchangeRate: 1,
        baseAmount: Number(expense.amount || 0),
        payerId: member.id,
        participantIds: [member.id],
        splitMode: 'equal',
        customSplits: {},
        note: expense.note || '',
        settled: false
      };
    }),
    lists: []
      .concat((old.todos || []).map(function (item) { return { id: item.id || uid('list'), type: 'todo', title: item.text || '待辦事項', done: !!item.done, assigneeId: '' }; }))
      .concat((old.shopping || []).map(function (item) { return { id: item.id || uid('list'), type: 'shopping', title: item.name || '購物項目', done: !!item.done, assigneeId: '' }; })),
    documents: old.docs || []
  });
  return { version: 4, trips: [trip], activeTripId: null };
}

function saveState(options) {
  const opts = options || {};
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (error) {
    showToast('本機儲存失敗，請先匯出備份');
  }
  if (opts.sync !== false && !ui.applyingRemote) queueCloudUpload();
}

function currentTrip() {
  return state.trips.find(function (trip) { return trip.id === state.activeTripId; }) || null;
}

function updateTripTimestamp(trip) {
  trip.updatedAt = new Date().toISOString();
}

function render() {
  const trip = currentTrip();
  if (ui.screen === 'trip' && !trip) ui.screen = 'trips';
  document.body.classList.toggle('trip-open', ui.screen === 'trip');
  tripNav.hidden = ui.screen !== 'trip';
  if (ui.screen === 'trip') {
    app.innerHTML = renderTripScreen(currentTrip());
    Array.from(tripNav.querySelectorAll('button')).forEach(function (button) {
      button.classList.toggle('active', button.dataset.tab === ui.activeTab);
    });
  } else {
    app.innerHTML = renderDashboard();
  }
}

function tripStatus(trip) {
  const today = todayISO();
  if (trip.endDate < today) return { key: 'past', label: '已結束' };
  if (trip.startDate <= today && trip.endDate >= today) return { key: 'active', label: '旅途中' };
  return { key: 'upcoming', label: '規劃中' };
}

function renderDashboard() {
  let filtered = state.trips.slice().sort(function (a, b) { return (a.startDate || '').localeCompare(b.startDate || ''); });
  if (ui.tripFilter === 'upcoming') filtered = filtered.filter(function (trip) { return tripStatus(trip).key !== 'past'; });
  if (ui.tripFilter === 'past') filtered = filtered.filter(function (trip) { return tripStatus(trip).key === 'past'; });
  const cards = filtered.length
    ? '<div class="trip-grid">' + filtered.map(renderTripCard).join('') + '</div>'
    : '<div class="empty-state"><span class="empty-icon">✈</span><h3>這裡還沒有旅程</h3><p>建立一趟新的旅行，或用行程代碼加入朋友。</p></div>';
  return [
    '<header class="dashboard-head">',
      '<span class="brand-kicker">travel handbook ✿</span>',
      '<h1>旅遊手帖</h1>',
      '<p>每一趟旅行，都值得被好好計畫與收藏。</p>',
    '</header>',
    '<div class="dashboard-actions">',
      '<button class="primary-btn" type="button" data-action="new-trip">＋ 建立新旅程</button>',
      '<button class="secondary-btn" type="button" data-action="join-trip">⌁ 使用代碼加入</button>',
    '</div>',
    '<div class="section-row"><div class="section-label"><h2>我的旅程</h2></div><span class="trip-status">' + state.trips.length + ' TRIPS</span></div>',
    '<div class="filter-pills">',
      filterButton('upcoming', '即將出發'),
      filterButton('all', '全部旅程'),
      filterButton('past', '旅行回憶'),
    '</div>',
    cards
  ].join('');
}

function filterButton(value, label) {
  return '<button class="chip-btn ' + (ui.tripFilter === value ? 'active' : '') + '" type="button" data-action="filter-trips" data-value="' + value + '">' + label + '</button>';
}

function renderTripCard(trip) {
  const status = tripStatus(trip);
  const destinations = trip.destinations.map(function (dest) { return dest.name; }).join('・') || '目的地未設定';
  const avatars = trip.members.slice(0, 4).map(avatar).join('');
  const more = trip.members.length > 4 ? '<span class="avatar" style="--avatar:#2c211b">+' + (trip.members.length - 4) + '</span>' : '';
  return [
    '<button class="trip-card" type="button" data-action="open-trip" data-id="' + esc(trip.id) + '">',
      '<div class="trip-card-cover" style="--cover:' + esc(trip.coverColor) + '">',
        '<span class="trip-status">' + status.label + '</span>',
        '<h3>' + esc(trip.title) + '</h3>',
        '<span class="cover-kicker">' + esc(destinations) + '</span>',
      '</div>',
      '<div class="trip-card-body">',
        '<div class="trip-card-meta"><strong>' + esc(formatRange(trip)) + '</strong><br>' + tripDates(trip).length + ' 天・' + trip.members.length + ' 位旅伴</div>',
        '<div class="avatar-stack">' + avatars + more + '</div>',
      '</div>',
    '</button>'
  ].join('');
}

function renderTripScreen(trip) {
  const destinations = trip.destinations.map(function (dest) { return dest.name; }).join('・') || '目的地未設定';
  return [
    '<header class="trip-topbar">',
      '<button class="icon-btn" type="button" data-action="back-trips" aria-label="回到我的旅程">←</button>',
      '<div class="trip-topbar-text"><strong>' + esc(trip.title) + '</strong><small>' + esc(destinations) + '</small></div>',
      '<button class="icon-btn" type="button" data-action="share-trip" aria-label="分享旅程">⌁</button>',
    '</header>',
    '<section class="trip-content">',
      renderActiveTab(trip),
    '</section>'
  ].join('');
}

function renderActiveTab(trip) {
  if (ui.activeTab === 'itinerary') return renderItinerary(trip);
  if (ui.activeTab === 'bookings') return renderBookings(trip);
  if (ui.activeTab === 'expenses') return renderExpenses(trip);
  if (ui.activeTab === 'more') return renderMore(trip);
  return renderOverview(trip);
}

function renderOverview(trip) {
  const today = todayISO();
  const countdown = diffDays(today, trip.startDate);
  const countdownText = countdown > 0 ? countdown : countdown === 0 ? 'GO' : tripStatus(trip).key === 'past' ? '✓' : 'NOW';
  const countdownLabel = countdown > 0 ? 'DAYS TO GO' : tripStatus(trip).key === 'past' ? 'MEMORY' : 'ON TRIP';
  const expenseTotal = trip.expenses.reduce(function (sum, expense) { return sum + Number(expense.baseAmount || (expense.amount * expense.exchangeRate) || 0); }, 0);
  const nextItems = trip.itinerary
    .filter(function (item) { return item.date >= today; })
    .sort(sortPlan)
    .slice(0, 3);
  const todoCount = trip.lists.filter(function (item) { return item.type === 'todo' && !item.done; }).length;
  return [
    '<div class="trip-hero" style="--cover:' + esc(trip.coverColor) + '">',
      '<span class="brand-kicker">our next story</span>',
      '<h1 class="hero-title">' + esc(trip.title) + '</h1>',
      '<p class="hero-sub">' + esc(trip.subtitle || formatRange(trip)) + '</p>',
      '<div class="hero-destinations">' + trip.destinations.map(function (dest) { return '<span>' + esc(dest.name) + '</span>'; }).join('') + '</div>',
      '<div class="countdown-stamp"><div><strong>' + countdownText + '</strong><small>' + countdownLabel + '</small></div></div>',
    '</div>',
    '<div class="stats-grid">',
      statCard(tripDates(trip).length, '旅行天數'),
      statCard(trip.bookings.length, '預訂項目'),
      statCard(formatMoney(expenseTotal, trip.baseCurrency), '目前花費'),
      statCard(trip.members.length, '同行旅伴'),
    '</div>',
    '<section class="paper-section">',
      '<div class="paper-section-head"><h2>接下來的行程</h2><button class="text-btn" data-action="go-tab" data-tab="itinerary">查看全部 →</button></div>',
      nextItems.length ? '<div class="timeline-list">' + nextItems.map(renderTimelineItem).join('') + '</div>' : emptyInline('還沒有安排接下來的行程'),
    '</section>',
    '<section class="paper-section">',
      '<div class="paper-section-head"><h2>出發準備</h2><button class="text-btn" data-action="go-tab" data-tab="more">管理清單 →</button></div>',
      '<div class="money-card accent"><span>尚未完成的待辦</span><strong>' + todoCount + ' 件</strong></div>',
    '</section>'
  ].join('');
}

function statCard(value, label) {
  return '<div class="stat-card"><strong>' + esc(value) + '</strong><span>' + label + '</span></div>';
}

function emptyInline(message) {
  return '<div class="card-meta" style="padding:18px 2px;text-align:center">' + esc(message) + '</div>';
}

function renderItinerary(trip) {
  const dates = tripDates(trip);
  if (!ui.activeDay || !dates.includes(ui.activeDay)) ui.activeDay = dates[0] || todayISO();
  const items = trip.itinerary.filter(function (item) { return item.date === ui.activeDay; }).sort(sortPlan);
  return [
    '<div class="section-row"><div class="section-label"><h2>每日行程</h2></div><button class="secondary-btn compact" data-action="add-itinerary">＋ 新增</button></div>',
    '<div class="day-pills">' + dates.map(function (date, index) {
      return '<button class="chip-btn ' + (date === ui.activeDay ? 'active' : '') + '" type="button" data-action="select-day" data-date="' + date + '"><strong>D' + (index + 1) + '</strong> ' + esc(formatDate(date, { month: 'numeric', day: 'numeric' })) + '</button>';
    }).join('') + '</div>',
    '<section class="paper-section">',
      '<div class="paper-section-head"><div><span class="eyebrow">' + esc(formatDate(ui.activeDay, { weekday: 'long' })) + '</span><h2>' + esc(formatDate(ui.activeDay, { month: 'long', day: 'numeric' })) + '</h2></div><span class="trip-status">' + items.length + ' PLANS</span></div>',
      items.length ? '<div class="timeline-list">' + items.map(renderTimelineItem).join('') + '</div>' : emptyInline('這一天還是空白的，加入第一個想去的地方吧。'),
    '</section>'
  ].join('');
}

function sortPlan(a, b) {
  return ((a.date || '') + (a.time || '99:99')).localeCompare((b.date || '') + (b.time || '99:99'));
}

function renderTimelineItem(item) {
  const meta = [item.city, item.note].filter(Boolean).join('・');
  return [
    '<div class="timeline-item" data-action="edit-itinerary" data-id="' + esc(item.id) + '">',
      '<span class="timeline-time">' + esc(item.time || '彈性') + '</span>',
      '<span class="type-icon">' + typeIcon(item.type) + '</span>',
      '<div class="timeline-body"><strong>' + esc(item.title) + '</strong><small>' + esc(meta || '尚無備註') + '</small></div>',
    '</div>'
  ].join('');
}

function renderBookings(trip) {
  const sorted = trip.bookings.slice().sort(function (a, b) { return ((a.date || '') + (a.time || '')).localeCompare((b.date || '') + (b.time || '')); });
  return [
    '<div class="section-row"><div class="section-label"><h2>預訂與票券</h2></div><button class="secondary-btn compact" data-action="add-booking">＋ 新增</button></div>',
    '<section class="paper-section">',
      '<div class="paper-section-head"><h2>全部預訂</h2><span class="trip-status">' + sorted.length + ' SAVED</span></div>',
      sorted.length ? '<div class="booking-list">' + sorted.map(renderBookingCard).join('') + '</div>' : emptyInline('還沒有預訂資料'),
    '</section>'
  ].join('');
}

function renderBookingCard(booking) {
  const meta = [booking.date ? formatDate(booking.date) : '', booking.time, booking.location, booking.note].filter(Boolean).join('・');
  return [
    '<div class="booking-card" data-action="edit-booking" data-id="' + esc(booking.id) + '">',
      '<span class="booking-icon">' + typeIcon(booking.type) + '</span>',
      '<div><div class="card-title">' + esc(booking.title) + '</div><div class="card-meta">' + esc(meta || '尚無詳細資料') + '</div></div>',
      booking.code ? '<span class="booking-code">' + esc(booking.code) + '</span>' : '',
    '</div>'
  ].join('');
}

function expenseBaseAmount(expense) {
  return Number(expense.baseAmount || (Number(expense.amount) * Number(expense.exchangeRate || 1)) || 0);
}

function expenseShares(expense) {
  const participants = expense.participantIds || [];
  const base = expenseBaseAmount(expense);
  if (!participants.length) return {};
  if (expense.splitMode === 'custom' && expense.customSplits) {
    const rate = Number(expense.exchangeRate || 1);
    return participants.reduce(function (result, id) {
      result[id] = Number(expense.customSplits[id] || 0) * rate;
      return result;
    }, {});
  }
  const share = base / participants.length;
  return participants.reduce(function (result, id) { result[id] = share; return result; }, {});
}

function calculateBalances(trip) {
  const balances = {};
  trip.members.forEach(function (member) { balances[member.id] = { paid: 0, owed: 0, net: 0 }; });
  trip.expenses.filter(function (expense) { return !expense.settled; }).forEach(function (expense) {
    const base = expenseBaseAmount(expense);
    if (!balances[expense.payerId]) balances[expense.payerId] = { paid: 0, owed: 0, net: 0 };
    balances[expense.payerId].paid += base;
    const shares = expenseShares(expense);
    Object.keys(shares).forEach(function (memberId) {
      if (!balances[memberId]) balances[memberId] = { paid: 0, owed: 0, net: 0 };
      balances[memberId].owed += shares[memberId];
    });
  });
  Object.keys(balances).forEach(function (id) { balances[id].net = balances[id].paid - balances[id].owed; });
  return balances;
}

function calculateSettlements(trip, balances) {
  const creditors = [];
  const debtors = [];
  Object.keys(balances).forEach(function (memberId) {
    const amount = balances[memberId].net;
    if (amount > 0.5) creditors.push({ id: memberId, amount: amount });
    if (amount < -0.5) debtors.push({ id: memberId, amount: -amount });
  });
  creditors.sort(function (a, b) { return b.amount - a.amount; });
  debtors.sort(function (a, b) { return b.amount - a.amount; });
  const result = [];
  let creditorIndex = 0;
  let debtorIndex = 0;
  while (creditorIndex < creditors.length && debtorIndex < debtors.length) {
    const amount = Math.min(creditors[creditorIndex].amount, debtors[debtorIndex].amount);
    result.push({ from: debtors[debtorIndex].id, to: creditors[creditorIndex].id, amount: amount });
    creditors[creditorIndex].amount -= amount;
    debtors[debtorIndex].amount -= amount;
    if (creditors[creditorIndex].amount < 0.5) creditorIndex += 1;
    if (debtors[debtorIndex].amount < 0.5) debtorIndex += 1;
  }
  return result;
}

function renderExpenses(trip) {
  const total = trip.expenses.reduce(function (sum, expense) { return sum + expenseBaseAmount(expense); }, 0);
  const outstanding = trip.expenses.filter(function (expense) { return !expense.settled; }).reduce(function (sum, expense) { return sum + expenseBaseAmount(expense); }, 0);
  const balances = calculateBalances(trip);
  const settlements = calculateSettlements(trip, balances);
  const expenseCards = trip.expenses.slice().sort(function (a, b) { return (b.date || '').localeCompare(a.date || ''); }).map(function (expense) { return renderExpenseCard(trip, expense); }).join('');
  return [
    '<div class="section-row"><div class="section-label"><h2>旅伴分帳</h2></div><button class="secondary-btn compact" data-action="add-expense">＋ 記一筆</button></div>',
    '<div class="expense-summary">',
      '<div class="money-card"><span>旅程總花費</span><strong>' + esc(formatMoney(total, trip.baseCurrency)) + '</strong></div>',
      '<div class="money-card accent"><span>尚未結清</span><strong>' + esc(formatMoney(outstanding, trip.baseCurrency)) + '</strong></div>',
    '</div>',
    '<section class="paper-section">',
      '<div class="paper-section-head"><h2>每人差額</h2><span class="trip-status">' + esc(trip.baseCurrency) + '</span></div>',
      '<div class="balance-grid">' + trip.members.map(function (member) {
        const info = balances[member.id] || { paid: 0, owed: 0, net: 0 };
        const tone = info.net > 0.5 ? 'positive' : info.net < -0.5 ? 'negative' : '';
        const label = info.net > 0.5 ? '應收' : info.net < -0.5 ? '應付' : '已平衡';
        return '<div class="balance-card ' + tone + '"><div class="balance-card-head">' + avatar(member) + '<span class="card-title">' + esc(member.name) + '</span></div><strong>' + label + ' ' + esc(formatMoney(Math.abs(info.net), trip.baseCurrency)) + '</strong><div class="card-meta">已付 ' + esc(formatMoney(info.paid, trip.baseCurrency)) + '・應分攤 ' + esc(formatMoney(info.owed, trip.baseCurrency)) + '</div></div>';
      }).join('') + '</div>',
    '</section>',
    '<section class="paper-section">',
      '<div class="paper-section-head"><h2>建議結算</h2><span class="trip-status">' + settlements.length + ' TRANSFERS</span></div>',
      settlements.length ? '<div class="settlement-note">' + settlements.map(function (settlement) {
        const from = memberById(trip, settlement.from);
        const to = memberById(trip, settlement.to);
        return '<div class="settlement-line"><strong>' + esc(from ? from.name : '旅伴') + '</strong> 付給 <strong>' + esc(to ? to.name : '旅伴') + '</strong>　' + esc(formatMoney(settlement.amount, trip.baseCurrency)) + '</div>';
      }).join('') + '</div>' : emptyInline('目前帳目已經平衡'),
    '</section>',
    '<section class="paper-section">',
      '<div class="paper-section-head"><h2>花費明細</h2><span class="trip-status">' + trip.expenses.length + ' ITEMS</span></div>',
      expenseCards ? '<div class="expense-list">' + expenseCards + '</div>' : emptyInline('還沒有共同花費'),
    '</section>'
  ].join('');
}

function renderExpenseCard(trip, expense) {
  const payer = memberById(trip, expense.payerId);
  return [
    '<div class="expense-card ' + (expense.settled ? 'settled' : '') + '">',
      '<div data-action="edit-expense" data-id="' + esc(expense.id) + '"><div class="card-title">' + esc(expense.title) + '</div><div class="card-meta">' + esc(formatDate(expense.date)) + '・' + esc(expense.category) + '・' + esc(payer ? payer.name : '未知') + '付款・' + (expense.participantIds || []).length + ' 人分攤</div>',
      '<button class="text-btn" type="button" data-action="toggle-expense-settled" data-id="' + esc(expense.id) + '">' + (expense.settled ? '設為未結清' : '標記已結清') + '</button></div>',
      '<div class="expense-amount">' + esc(formatMoney(expense.amount, expense.currency)) + '<small>≈ ' + esc(formatMoney(expenseBaseAmount(expense), trip.baseCurrency)) + '</small>' + (expense.settled ? '<span class="settled-badge">已結清</span>' : '') + '</div>',
    '</div>'
  ].join('');
}

function renderMore(trip) {
  const listTypes = [
    { key: 'todo', title: '待辦事項', icon: '✓' },
    { key: 'packing', title: '行李清單', icon: '▣' },
    { key: 'shopping', title: '購物清單', icon: '◇' }
  ];
  const listPanels = listTypes.map(function (config) {
    const items = trip.lists.filter(function (item) { return item.type === config.key; });
    return '<div class="mini-panel"><div class="paper-section-head"><h3>' + config.icon + ' ' + config.title + '</h3><span class="trip-status">' + items.filter(function (i) { return !i.done; }).length + '</span></div>' +
      (items.length ? '<div class="check-list">' + items.map(function (item) { return renderListItem(trip, item); }).join('') + '</div>' : '<div class="card-meta">尚無項目</div>') +
      '</div>';
  }).join('');
  const syncLabel = trip.sync && trip.sync.enabled ? '已同步・' + trip.sync.code : '尚未啟用';
  return [
    '<div class="section-row"><div class="section-label"><h2>清單與設定</h2></div><button class="secondary-btn compact" data-action="add-list">＋ 新增清單</button></div>',
    '<div class="more-grid">' + listPanels + '</div>',
    '<section class="paper-section">',
      '<div class="paper-section-head"><h2>同行旅伴</h2><button class="text-btn" data-action="add-member">＋ 新增旅伴</button></div>',
      '<div class="member-list">' + trip.members.map(function (member, index) {
        return '<div class="member-row"><div class="member-info">' + avatar(member) + '<div><div class="card-title">' + esc(member.name) + '</div><div class="card-meta">' + (index === 0 ? '旅程建立者' : '旅伴') + '</div></div></div></div>';
      }).join('') + '</div>',
    '</section>',
    '<section class="paper-section">',
      '<div class="paper-section-head"><h2>旅程資料</h2><span class="trip-status">' + (syncStatus === 'syncing' ? 'SYNCING' : syncStatus === 'error' ? 'OFFLINE' : 'SAFE') + '</span></div>',
      '<div class="settings-list">',
        '<button class="settings-btn" data-action="edit-trip"><span><strong>編輯旅程設定</strong><br><small>名稱、目的地、日期與主要幣別</small></span><span>→</span></button>',
        '<button class="settings-btn" data-action="cloud-settings"><span><strong>雲端共享</strong><br><small>' + esc(syncLabel) + '</small></span><span>→</span></button>',
        '<button class="settings-btn" data-action="export-trip"><span><strong>匯出 JSON 備份</strong><br><small>下載這一趟旅程的完整資料</small></span><span>↓</span></button>',
        '<button class="settings-btn" data-action="delete-trip"><span><strong>刪除這趟旅程</strong><br><small>此動作不會影響其他旅程</small></span><span>×</span></button>',
      '</div>',
      '<p class="card-meta">共享代碼等同於旅程鑰匙，請只傳給同行旅伴；護照與信用卡資料不要存入公開連結。</p>',
    '</section>'
  ].join('');
}

function renderListItem(trip, item) {
  const assigned = memberById(trip, item.assigneeId);
  return '<div class="check-item ' + (item.done ? 'done' : '') + '"><button class="check-toggle ' + (item.done ? 'done' : '') + '" type="button" data-action="toggle-list" data-id="' + esc(item.id) + '">' + (item.done ? '✓' : '') + '</button><span class="check-title">' + esc(item.title) + '</span><span class="assignee">' + esc(assigned ? assigned.name : '') + '</span><button class="list-delete" type="button" data-action="delete-list" data-id="' + esc(item.id) + '" aria-label="刪除清單項目">×</button></div>';
}

function handleClick(event) {
  const close = event.target.closest('[data-close-dialog]');
  if (close) {
    const dialog = close.closest('dialog');
    if (dialog) dialog.close();
    return;
  }
  const tabButton = event.target.closest('[data-tab]');
  if (tabButton && tabButton.closest('#trip-nav')) {
    ui.activeTab = tabButton.dataset.tab;
    render();
    window.scrollTo({ top: 0, behavior: 'smooth' });
    return;
  }
  const target = event.target.closest('[data-action]');
  if (!target) return;
  const action = target.dataset.action;
  if (action === 'new-trip') return openTripDialog();
  if (action === 'join-trip') return openSyncDialog('download');
  if (action === 'filter-trips') { ui.tripFilter = target.dataset.value; return render(); }
  if (action === 'open-trip') return openTrip(target.dataset.id);
  if (action === 'back-trips') return backToTrips();
  if (action === 'share-trip') return shareTrip();
  if (action === 'go-tab') { ui.activeTab = target.dataset.tab; return render(); }
  if (action === 'select-day') { ui.activeDay = target.dataset.date; return render(); }
  if (action === 'add-itinerary') return openItineraryDialog();
  if (action === 'edit-itinerary') return openItineraryDialog(target.dataset.id);
  if (action === 'add-booking') return openBookingDialog();
  if (action === 'edit-booking') return openBookingDialog(target.dataset.id);
  if (action === 'add-expense') return openExpenseDialog();
  if (action === 'edit-expense') return openExpenseDialog(target.dataset.id);
  if (action === 'toggle-expense-settled') return toggleExpenseSettled(target.dataset.id);
  if (action === 'add-list') return openListDialog();
  if (action === 'toggle-list') return toggleList(target.dataset.id);
  if (action === 'delete-list') return deleteList(target.dataset.id);
  if (action === 'add-member') return openMemberDialog();
  if (action === 'edit-trip') return openTripDialog(currentTrip().id);
  if (action === 'cloud-settings') return openSyncDialog('upload');
  if (action === 'export-trip') return exportTrip();
  if (action === 'delete-trip') return deleteTrip();
}

function handleChange(event) {
  if (event.target.closest('#expense-form') && (event.target.name === 'splitMode' || event.target.name === 'participantIds')) {
    refreshCustomSplits();
  }
}

function openTrip(id) {
  const trip = state.trips.find(function (item) { return item.id === id; });
  if (!trip) return;
  state.activeTripId = id;
  ui.screen = 'trip';
  ui.activeTab = 'overview';
  ui.activeDay = trip.startDate;
  saveState({ sync: false });
  render();
  if (trip.sync && trip.sync.enabled && trip.sync.code) startCloudListener(trip);
  window.scrollTo(0, 0);
}

function backToTrips() {
  stopCloudListener();
  state.activeTripId = null;
  ui.screen = 'trips';
  saveState({ sync: false });
  render();
  window.scrollTo(0, 0);
}

function populateCurrencySelects() {
  const options = CURRENCIES.map(function (currency) { return '<option value="' + currency + '">' + currency + '</option>'; }).join('');
  document.querySelectorAll('[data-currency-select]').forEach(function (select) { select.innerHTML = options; });
}

function bindForms() {
  document.getElementById('trip-form').addEventListener('submit', saveTripForm);
  document.getElementById('itinerary-form').addEventListener('submit', saveItineraryForm);
  document.getElementById('booking-form').addEventListener('submit', saveBookingForm);
  document.getElementById('expense-form').addEventListener('submit', saveExpenseForm);
  document.getElementById('list-form').addEventListener('submit', saveListForm);
  document.getElementById('member-form').addEventListener('submit', saveMemberForm);
  document.getElementById('sync-form').addEventListener('submit', saveSyncForm);
  document.querySelectorAll('[data-delete-record]').forEach(function (button) {
    button.addEventListener('click', deleteRecordFromDialog);
  });
}

function setFormValues(form, values) {
  Object.keys(values || {}).forEach(function (key) {
    const field = form.elements[key];
    if (field && values[key] != null) field.value = values[key];
  });
}

function showDialog(id) {
  const dialog = document.getElementById(id);
  if (dialog && !dialog.open) dialog.showModal();
}

function openTripDialog(id) {
  const form = document.getElementById('trip-form');
  form.reset();
  const trip = id ? state.trips.find(function (item) { return item.id === id; }) : null;
  document.getElementById('trip-dialog-title').textContent = trip ? '編輯旅程' : '建立新旅程';
  setFormValues(form, trip ? {
    id: trip.id,
    title: trip.title,
    destinations: trip.destinations.map(function (dest) { return dest.name; }).join('、'),
    startDate: trip.startDate,
    endDate: trip.endDate,
    baseCurrency: trip.baseCurrency,
    localCurrency: trip.localCurrency,
    members: trip.members.map(function (member) { return member.name; }).join('、'),
    subtitle: trip.subtitle
  } : {
    id: '',
    startDate: addDays(todayISO(), 30),
    endDate: addDays(todayISO(), 35),
    baseCurrency: 'TWD',
    localCurrency: 'JPY',
    members: '我'
  });
  showDialog('trip-dialog');
}

function saveTripForm(event) {
  event.preventDefault();
  const values = Object.fromEntries(new FormData(event.currentTarget).entries());
  if (values.endDate < values.startDate) return showToast('回程日期不能早於出發日期');
  const destinationNames = values.destinations.split(/[，,、]+/).map(function (value) { return value.trim(); }).filter(Boolean);
  const memberNames = values.members.split(/[，,、]+/).map(function (value) { return value.trim(); }).filter(Boolean);
  if (!memberNames.length) memberNames.push('我');
  const existing = values.id ? state.trips.find(function (item) { return item.id === values.id; }) : null;
  const memberList = existing
    ? existing.members.map(function (member, index) {
        return Object.assign({}, member, { name: memberNames[index] || member.name });
      }).concat(memberNames.slice(existing.members.length).map(function (name, index) {
        return makeMember(name, existing.members.length + index);
      }))
    : memberNames.map(makeMember);
  const trip = normalizeTrip(Object.assign(existing || {}, {
    id: existing ? existing.id : uid('trip'),
    title: values.title.trim(),
    subtitle: values.subtitle.trim(),
    startDate: values.startDate,
    endDate: values.endDate,
    baseCurrency: values.baseCurrency,
    localCurrency: values.localCurrency,
    coverColor: existing ? existing.coverColor : COVER_COLORS[state.trips.length % COVER_COLORS.length],
    destinations: destinationNames.map(function (name) {
      return { id: uid('dest'), name: name, countryCode: '', timezone: '', currency: values.localCurrency };
    }),
    members: memberList,
    itinerary: existing ? existing.itinerary : [],
    bookings: existing ? existing.bookings : [],
    expenses: existing ? existing.expenses : [],
    lists: existing ? existing.lists : [],
    documents: existing ? existing.documents : [],
    sync: existing ? existing.sync : { enabled: false, code: '' },
    createdAt: existing ? existing.createdAt : new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }));
  if (!existing) state.trips.push(trip);
  state.activeTripId = trip.id;
  ui.screen = 'trip';
  ui.activeTab = 'overview';
  ui.activeDay = trip.startDate;
  saveState({ sync: false });
  event.currentTarget.closest('dialog').close();
  render();
  showToast(existing ? '旅程設定已更新' : '新旅程已建立');
}

function openItineraryDialog(id) {
  const trip = currentTrip();
  const form = document.getElementById('itinerary-form');
  form.reset();
  const item = id ? trip.itinerary.find(function (plan) { return plan.id === id; }) : null;
  setFormValues(form, item || { id: '', date: ui.activeDay || trip.startDate, time: '09:00', type: 'spot' });
  form.querySelector('[data-delete-record]').style.display = item ? 'inline-block' : 'none';
  showDialog('itinerary-dialog');
}

function saveItineraryForm(event) {
  event.preventDefault();
  const trip = currentTrip();
  const values = Object.fromEntries(new FormData(event.currentTarget).entries());
  const payload = {
    id: values.id || uid('plan'),
    date: values.date,
    time: values.time,
    type: values.type,
    title: values.title.trim(),
    city: values.city.trim(),
    note: values.note.trim(),
    mapUrl: values.mapUrl.trim()
  };
  const index = trip.itinerary.findIndex(function (item) { return item.id === payload.id; });
  if (index >= 0) trip.itinerary[index] = payload;
  else trip.itinerary.push(payload);
  ui.activeDay = payload.date;
  updateTripTimestamp(trip);
  saveState();
  event.currentTarget.closest('dialog').close();
  render();
  showToast('行程已儲存');
}

function openBookingDialog(id) {
  const trip = currentTrip();
  const form = document.getElementById('booking-form');
  form.reset();
  const booking = id ? trip.bookings.find(function (item) { return item.id === id; }) : null;
  setFormValues(form, booking || { id: '', type: 'flight', date: trip.startDate, time: '' });
  form.querySelector('[data-delete-record]').style.display = booking ? 'inline-block' : 'none';
  showDialog('booking-dialog');
}

function saveBookingForm(event) {
  event.preventDefault();
  const trip = currentTrip();
  const values = Object.fromEntries(new FormData(event.currentTarget).entries());
  const payload = {
    id: values.id || uid('booking'),
    type: values.type,
    title: values.title.trim(),
    date: values.date,
    time: values.time,
    location: values.location.trim(),
    code: values.code.trim(),
    note: values.note.trim(),
    url: values.url.trim()
  };
  const index = trip.bookings.findIndex(function (item) { return item.id === payload.id; });
  if (index >= 0) trip.bookings[index] = payload;
  else trip.bookings.push(payload);
  updateTripTimestamp(trip);
  saveState();
  event.currentTarget.closest('dialog').close();
  render();
  showToast('預訂已儲存');
}

function openExpenseDialog(id) {
  const trip = currentTrip();
  const form = document.getElementById('expense-form');
  form.reset();
  const expense = id ? trip.expenses.find(function (item) { return item.id === id; }) : null;
  const defaults = expense || {
    id: '',
    title: '',
    date: todayISO() >= trip.startDate && todayISO() <= trip.endDate ? todayISO() : trip.startDate,
    category: '餐飲',
    amount: '',
    currency: trip.localCurrency,
    exchangeRate: trip.localCurrency === trip.baseCurrency ? 1 : '',
    payerId: trip.members[0].id,
    participantIds: trip.members.map(function (member) { return member.id; }),
    splitMode: 'equal',
    customSplits: {},
    note: ''
  };
  setFormValues(form, defaults);
  form.elements.payerId.innerHTML = trip.members.map(function (member) { return '<option value="' + esc(member.id) + '">' + esc(member.name) + '</option>'; }).join('');
  form.elements.payerId.value = defaults.payerId;
  form.elements.splitMode.value = defaults.splitMode || 'equal';
  document.getElementById('expense-participants').innerHTML = trip.members.map(function (member) {
    const checked = (defaults.participantIds || []).includes(member.id) ? ' checked' : '';
    return '<label class="choice"><input type="checkbox" name="participantIds" value="' + esc(member.id) + '"' + checked + '>' + avatar(member) + '<span>' + esc(member.name) + '</span></label>';
  }).join('');
  form.querySelector('[data-delete-record]').style.display = expense ? 'inline-block' : 'none';
  refreshCustomSplits(defaults.customSplits || {});
  showDialog('expense-dialog');
}

function collectCustomSplitValues() {
  const values = {};
  document.querySelectorAll('#custom-splits [data-split-member]').forEach(function (input) {
    values[input.dataset.splitMember] = Number(input.value || 0);
  });
  return values;
}

function refreshCustomSplits(initialValues) {
  const form = document.getElementById('expense-form');
  const container = document.getElementById('custom-splits');
  const selected = Array.from(form.querySelectorAll('input[name="participantIds"]:checked')).map(function (input) { return input.value; });
  const existing = initialValues || collectCustomSplitValues();
  const isCustom = form.elements.splitMode.value === 'custom';
  container.hidden = !isCustom;
  if (!isCustom) return;
  const trip = currentTrip();
  container.innerHTML = selected.map(function (memberId) {
    const member = memberById(trip, memberId);
    return '<label class="custom-split-row"><span>' + esc(member ? member.name : '旅伴') + '</span><input type="number" min="0" step="0.01" data-split-member="' + esc(memberId) + '" value="' + esc(existing[memberId] || '') + '" placeholder="分攤金額"></label>';
  }).join('');
}

function saveExpenseForm(event) {
  event.preventDefault();
  const trip = currentTrip();
  const form = event.currentTarget;
  const values = Object.fromEntries(new FormData(form).entries());
  const participantIds = Array.from(form.querySelectorAll('input[name="participantIds"]:checked')).map(function (input) { return input.value; });
  if (!participantIds.length) return showToast('請至少選擇一位分帳旅伴');
  const amount = Number(values.amount);
  const rate = Number(values.exchangeRate);
  const customSplits = values.splitMode === 'custom' ? collectCustomSplitValues() : {};
  if (values.splitMode === 'custom') {
    const splitTotal = Object.values(customSplits).reduce(function (sum, value) { return sum + Number(value || 0); }, 0);
    if (Math.abs(splitTotal - amount) > 0.02) return showToast('自訂分攤合計必須等於原始金額');
  }
  const existing = values.id ? trip.expenses.find(function (item) { return item.id === values.id; }) : null;
  const payload = {
    id: values.id || uid('expense'),
    title: values.title.trim(),
    date: values.date,
    category: values.category,
    amount: amount,
    currency: values.currency,
    exchangeRate: rate,
    baseAmount: amount * rate,
    payerId: values.payerId,
    participantIds: participantIds,
    splitMode: values.splitMode,
    customSplits: customSplits,
    note: values.note.trim(),
    settled: existing ? !!existing.settled : false
  };
  const index = trip.expenses.findIndex(function (item) { return item.id === payload.id; });
  if (index >= 0) trip.expenses[index] = payload;
  else trip.expenses.push(payload);
  updateTripTimestamp(trip);
  saveState();
  form.closest('dialog').close();
  render();
  showToast('花費與分帳已更新');
}

function toggleExpenseSettled(id) {
  const trip = currentTrip();
  const expense = trip.expenses.find(function (item) { return item.id === id; });
  if (!expense) return;
  expense.settled = !expense.settled;
  updateTripTimestamp(trip);
  saveState();
  render();
}

function openListDialog() {
  const trip = currentTrip();
  const form = document.getElementById('list-form');
  form.reset();
  form.elements.assigneeId.innerHTML = '<option value="">未指定</option>' + trip.members.map(function (member) { return '<option value="' + esc(member.id) + '">' + esc(member.name) + '</option>'; }).join('');
  showDialog('list-dialog');
}

function saveListForm(event) {
  event.preventDefault();
  const trip = currentTrip();
  const values = Object.fromEntries(new FormData(event.currentTarget).entries());
  trip.lists.push({ id: uid('list'), type: values.type, title: values.title.trim(), done: false, assigneeId: values.assigneeId });
  updateTripTimestamp(trip);
  saveState();
  event.currentTarget.closest('dialog').close();
  render();
  showToast('已加入清單');
}

function toggleList(id) {
  const trip = currentTrip();
  const item = trip.lists.find(function (entry) { return entry.id === id; });
  if (!item) return;
  item.done = !item.done;
  updateTripTimestamp(trip);
  saveState();
  render();
}

function deleteList(id) {
  const trip = currentTrip();
  trip.lists = trip.lists.filter(function (item) { return item.id !== id; });
  updateTripTimestamp(trip);
  saveState();
  render();
}

function openMemberDialog() {
  document.getElementById('member-form').reset();
  showDialog('member-dialog');
}

function saveMemberForm(event) {
  event.preventDefault();
  const trip = currentTrip();
  const values = Object.fromEntries(new FormData(event.currentTarget).entries());
  trip.members.push(makeMember(values.name, trip.members.length));
  updateTripTimestamp(trip);
  saveState();
  event.currentTarget.closest('dialog').close();
  render();
  showToast('新旅伴已加入');
}

function deleteRecordFromDialog(event) {
  const type = event.currentTarget.dataset.deleteRecord;
  const trip = currentTrip();
  const form = event.currentTarget.closest('form');
  const id = form.elements.id.value;
  if (!id || !confirm('確定要刪除這筆資料嗎？')) return;
  if (type === 'itinerary') trip.itinerary = trip.itinerary.filter(function (item) { return item.id !== id; });
  if (type === 'booking') trip.bookings = trip.bookings.filter(function (item) { return item.id !== id; });
  if (type === 'expense') trip.expenses = trip.expenses.filter(function (item) { return item.id !== id; });
  updateTripTimestamp(trip);
  saveState();
  form.closest('dialog').close();
  render();
  showToast('資料已刪除');
}

function exportTrip() {
  const trip = currentTrip();
  const blob = new Blob([JSON.stringify(trip, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = trip.title.replace(/[^\w\u4e00-\u9fff]+/g, '-') + '.json';
  link.click();
  URL.revokeObjectURL(url);
  showToast('旅程備份已下載');
}

function deleteTrip() {
  const trip = currentTrip();
  if (!trip || !confirm('確定要刪除「' + trip.title + '」？請先匯出備份，刪除後無法復原。')) return;
  stopCloudListener();
  state.trips = state.trips.filter(function (item) { return item.id !== trip.id; });
  state.activeTripId = null;
  ui.screen = 'trips';
  saveState({ sync: false });
  render();
  showToast('旅程已刪除');
}

function generateShareCode() {
  const bytes = new Uint8Array(8);
  if (window.crypto && window.crypto.getRandomValues) window.crypto.getRandomValues(bytes);
  else bytes.forEach(function (_, index) { bytes[index] = Math.floor(Math.random() * 255); });
  return 'trip-' + Array.from(bytes).map(function (value) { return value.toString(36); }).join('').slice(0, 12);
}

function openSyncDialog(mode) {
  const form = document.getElementById('sync-form');
  form.reset();
  form.elements.mode.value = mode;
  const trip = currentTrip();
  const download = mode === 'download';
  document.getElementById('sync-dialog-title').textContent = download ? '加入朋友的旅程' : '雲端共享';
  document.getElementById('sync-dialog-note').textContent = download
    ? '輸入朋友傳來的行程代碼，雲端旅程會加入你的「我的旅程」。'
    : '建立共享代碼後，把網址與代碼傳給旅伴即可一起編輯。';
  form.elements.code.value = download ? '' : (trip && trip.sync && trip.sync.code ? trip.sync.code : generateShareCode());
  showDialog('sync-dialog');
}

async function saveSyncForm(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const values = Object.fromEntries(new FormData(form).entries());
  const code = values.code.trim().toLowerCase();
  if (!/^[a-z0-9-]{6,50}$/.test(code)) return showToast('代碼只能使用英文小寫、數字與短橫');
  const button = form.querySelector('.primary-btn');
  button.disabled = true;
  button.textContent = '連線中…';
  try {
    if (values.mode === 'download') await downloadSharedTrip(code);
    else await uploadSharedTrip(currentTrip(), code);
    form.closest('dialog').close();
  } catch (error) {
    console.error(error);
    syncStatus = 'error';
    showToast('雲端連線失敗，請確認代碼與網路');
  } finally {
    button.disabled = false;
    button.textContent = '連線雲端';
  }
}

async function loadFirebase() {
  if (firebase.db) return firebase;
  const appModule = await import('https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js');
  const firestoreModule = await import('https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js');
  const firebaseApp = appModule.initializeApp(FIREBASE_CONFIG);
  firebase = {
    db: firestoreModule.getFirestore(firebaseApp),
    doc: firestoreModule.doc,
    getDoc: firestoreModule.getDoc,
    setDoc: firestoreModule.setDoc,
    onSnapshot: firestoreModule.onSnapshot,
    serverTimestamp: firestoreModule.serverTimestamp
  };
  return firebase;
}

function cloudDocId(code) {
  return 'v2-' + code;
}

async function uploadSharedTrip(trip, code) {
  if (!trip) throw new Error('No active trip');
  const fb = await loadFirebase();
  trip.sync = { enabled: true, code: code };
  updateTripTimestamp(trip);
  await fb.setDoc(fb.doc(fb.db, 'trips', cloudDocId(code)), {
    schemaVersion: 2,
    payload: JSON.stringify(trip),
    clientId: getClientId(),
    updatedAt: fb.serverTimestamp()
  });
  saveState({ sync: false });
  syncStatus = 'synced';
  await startCloudListener(trip);
  render();
  showToast('雲端共享已啟用');
}

async function downloadSharedTrip(code) {
  const fb = await loadFirebase();
  const snapshot = await fb.getDoc(fb.doc(fb.db, 'trips', cloudDocId(code)));
  if (!snapshot.exists()) throw new Error('Trip not found');
  const remote = snapshot.data();
  if (!remote || !remote.payload) throw new Error('Invalid trip');
  const trip = normalizeTrip(JSON.parse(remote.payload));
  trip.sync = { enabled: true, code: code };
  const existingIndex = state.trips.findIndex(function (item) { return item.id === trip.id; });
  if (existingIndex >= 0) state.trips[existingIndex] = trip;
  else state.trips.push(trip);
  state.activeTripId = trip.id;
  ui.screen = 'trip';
  ui.activeTab = 'overview';
  ui.activeDay = trip.startDate;
  saveState({ sync: false });
  syncStatus = 'synced';
  await startCloudListener(trip);
  render();
  showToast('已加入共享旅程');
}

async function startCloudListener(trip) {
  stopCloudListener();
  if (!trip || !trip.sync || !trip.sync.enabled || !trip.sync.code) return;
  try {
    const fb = await loadFirebase();
    const reference = fb.doc(fb.db, 'trips', cloudDocId(trip.sync.code));
    syncUnsubscribe = fb.onSnapshot(reference, function (snapshot) {
      if (!snapshot.exists()) return;
      const remote = snapshot.data();
      if (!remote || !remote.payload || remote.clientId === getClientId()) return;
      try {
        const remoteTrip = normalizeTrip(JSON.parse(remote.payload));
        ui.applyingRemote = true;
        const index = state.trips.findIndex(function (item) { return item.id === remoteTrip.id; });
        if (index >= 0) state.trips[index] = remoteTrip;
        else state.trips.push(remoteTrip);
        state.activeTripId = remoteTrip.id;
        saveState({ sync: false });
        syncStatus = 'synced';
        render();
        showToast('旅伴更新了行程');
      } finally {
        ui.applyingRemote = false;
      }
    }, function (error) {
      console.error('Cloud listener error', error);
      syncStatus = 'error';
    });
  } catch (error) {
    syncStatus = 'error';
    console.error(error);
  }
}

function stopCloudListener() {
  if (syncUnsubscribe) syncUnsubscribe();
  syncUnsubscribe = null;
}

function queueCloudUpload() {
  const trip = currentTrip();
  if (!trip || !trip.sync || !trip.sync.enabled || !trip.sync.code || ui.applyingRemote) return;
  clearTimeout(syncTimer);
  syncStatus = 'syncing';
  syncTimer = setTimeout(async function () {
    try {
      const fb = await loadFirebase();
      await fb.setDoc(fb.doc(fb.db, 'trips', cloudDocId(trip.sync.code)), {
        schemaVersion: 2,
        payload: JSON.stringify(trip),
        clientId: getClientId(),
        updatedAt: fb.serverTimestamp()
      });
      syncStatus = 'synced';
    } catch (error) {
      console.error('Cloud upload failed', error);
      syncStatus = 'error';
    }
  }, 700);
}

function getClientId() {
  let id = localStorage.getItem(CLIENT_KEY);
  if (!id) {
    id = uid('client');
    localStorage.setItem(CLIENT_KEY, id);
  }
  return id;
}

async function shareTrip() {
  const trip = currentTrip();
  if (!trip.sync || !trip.sync.enabled || !trip.sync.code) return openSyncDialog('upload');
  const url = location.href.split('#')[0].split('?')[0];
  const text = '一起規劃「' + trip.title + '」\n' + url + '\n\n行程代碼：' + trip.sync.code + '\n打開旅遊手帖後，選擇「使用代碼加入」。';
  try {
    if (navigator.share) await navigator.share({ title: '旅遊手帖｜' + trip.title, text: text });
    else if (navigator.clipboard) {
      await navigator.clipboard.writeText(text);
      showToast('網址與行程代碼已複製');
    } else {
      window.prompt('複製以下內容傳給旅伴：', text);
    }
  } catch (error) {
    if (error && error.name !== 'AbortError') showToast('分享失敗，請再試一次');
  }
}

function showToast(message) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function () { toast.classList.remove('show'); }, 2200);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    expenseBaseAmount: expenseBaseAmount,
    expenseShares: expenseShares,
    calculateBalances: calculateBalances,
    calculateSettlements: calculateSettlements,
    normalizeTrip: normalizeTrip,
    migrateLegacy: migrateLegacy
  };
}
