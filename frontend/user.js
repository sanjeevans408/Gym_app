/**
 * IRONCORE GYM - user.js
 * Member portal logic.
 */

// ============================================================
// DEMO USER
// ============================================================
const DEMO_USER_EMAIL = 'member@ironcore.gym';
const DEMO_USER_PASSWORD = 'member123';
const DEMO_USER_ID = 'demo-user-001';

// ============================================================
// USER STATE
// ============================================================
let currentUser = null;
let userVisits = [];
let userPayments = [];
let userNotifications = [];
let userBookings = [];
let selectedDayIdx = 0;
let notifPanelOpen = false;
let uToastTimeout;
const USER_BACKEND_API_URL =
  window.ironcoreConfig?.BACKEND_API_URL
  || (typeof BACKEND_API_URL !== 'undefined' ? BACKEND_API_URL : 'http://localhost:5000');

// ============================================================
// INIT
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
  if (!document.getElementById('userLoginScreen')) return;

  startUserClock();
  initUserDemoData();

  const saved = sessionStorage.getItem('ironcore_user_auth');
  if (saved) {
    try {
      currentUser = JSON.parse(saved);
      showUserApp();
    } catch (error) {
      console.warn('Failed to restore user session:', error);
    }
  }
});

function startUserClock() {
  setInterval(() => {
    if (currentUser) checkUserNotifications();
  }, 60000);
}

// ============================================================
// DEMO DATA
// ============================================================
function initUserDemoData() {
  if (!localStorage.getItem('ironcore_user_visits')) {
    localStorage.setItem('ironcore_user_visits', JSON.stringify(generateDemoVisits()));
  }

  if (!localStorage.getItem('ironcore_user_payments')) {
    localStorage.setItem('ironcore_user_payments', JSON.stringify(generateDemoPayments()));
  }
}

function generateDemoVisits() {
  const classes = ['CrossFit', 'HIIT', 'Yoga Flow', 'Powerlifting', 'Zumba', 'Boxing', 'Pilates', 'Spin'];
  const times = ['06:00', '07:30', '09:00', '11:00', '17:00', '18:30', '19:00', '20:00'];
  const visits = [];
  const today = new Date();

  for (let i = 0; i < 60; i += 1) {
    if (Math.random() > 0.45) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      visits.push({
        date: date.toISOString().split('T')[0],
        class_name: classes[Math.floor(Math.random() * classes.length)],
        time: times[Math.floor(Math.random() * times.length)],
      });
    }
  }

  return visits;
}

function generateDemoPayments() {
  const planPrices = {
    Monthly: { 'Strength Training': 1000, 'Strength / Cardio': 1500 },
    Quarterly: { 'Strength Training': 2500, 'Strength / Cardio': 4000 },
    Annual: { 'Strength Training': 10000, 'Strength / Cardio': 15000 }
  };
  const payments = [];
  const today = new Date();

  for (let i = 0; i < 8; i += 1) {
    const date = new Date(today);
    date.setMonth(date.getMonth() - i);
    const plan = i < 2 ? 'Monthly' : i < 5 ? 'Quarterly' : 'Annual';
    const membershipType = i % 2 === 0 ? 'Strength Training' : 'Strength / Cardio';
    payments.push({
      date: date.toISOString().split('T')[0],
      plan,
      membership_type: membershipType,
      amount: planPrices[plan][membershipType],
    });
  }

  return payments;
}

function generateSchedule() {
  const classes = [
    { name: 'CrossFit WOD', coach: 'Rajesh Kumar', duration: 60, color: '#66e3c4', maxSlots: 15 },
    { name: 'HIIT Blitz', coach: 'Priya Sharma', duration: 45, color: '#ff7a7a', maxSlots: 20 },
    { name: 'Yoga Flow', coach: 'Anita Desai', duration: 60, color: '#7ae5a0', maxSlots: 25 },
    { name: 'Powerlifting', coach: 'Vikram Singh', duration: 90, color: '#ffd36a', maxSlots: 10 },
    { name: 'Zumba Party', coach: 'Kavya Nair', duration: 60, color: '#ff9f7f', maxSlots: 30 },
    { name: 'Boxing Basics', coach: 'Arjun Mehta', duration: 60, color: '#ff9466', maxSlots: 12 },
    { name: 'Pilates Core', coach: 'Sneha Reddy', duration: 50, color: '#7cc8ff', maxSlots: 20 },
    { name: 'Spin Session', coach: 'Rajan Patel', duration: 45, color: '#ffe08a', maxSlots: 18 },
    { name: 'Stretching', coach: 'Anita Desai', duration: 30, color: '#9df0c2', maxSlots: 30 },
    { name: 'Strength Train', coach: 'Vikram Singh', duration: 75, color: '#9abfff', maxSlots: 15 },
  ];
  const timeSlots = ['06:00', '07:30', '09:00', '10:30', '17:00', '18:30', '19:30', '20:30'];

  const schedule = {};
  for (let offset = 0; offset < 7; offset += 1) {
    const date = new Date();
    date.setDate(date.getDate() + offset);
    const key = date.toISOString().split('T')[0];
    const dayClasses = [];
    const count = 4 + Math.floor(Math.random() * 3);
    const shuffledSlots = [...timeSlots].sort(() => Math.random() - 0.5).slice(0, count).sort();

    shuffledSlots.forEach(slot => {
      const cls = classes[Math.floor(Math.random() * classes.length)];
      dayClasses.push({
        id: `${key}-${slot}`,
        time: slot,
        name: cls.name,
        coach: cls.coach,
        duration: cls.duration,
        color: cls.color,
        maxSlots: cls.maxSlots,
        available: Math.floor(Math.random() * cls.maxSlots),
      });
    });

    schedule[key] = dayClasses;
  }

  return schedule;
}

const GYM_SCHEDULE = generateSchedule();

const GYM_ANNOUNCEMENTS = [
  {
    title: 'Summer hours update',
    body: 'From June 1, the gym opens at 5:30 AM on weekdays. Weekend hours stay the same.',
    date: '2026-05-01',
    type: 'highlight',
  },
  {
    title: 'Equipment upgrade complete',
    body: 'New squat racks and cable machines are now available in Zone B.',
    date: '2026-04-28',
    type: 'info',
  },
  {
    title: 'Maintenance notice',
    body: 'Pool and sauna will be closed on May 12 from 8 AM to 2 PM for routine maintenance.',
    date: '2026-05-05',
    type: 'alert',
  },
];

// ============================================================
// AUTH
// ============================================================
async function userLogin() {
  const email = document.getElementById('uEmail').value.trim();
  const password = document.getElementById('uPassword').value;
  const errEl = document.getElementById('uLoginError');

  errEl.classList.add('hidden');

  if (!email || !password) {
    showUError(errEl, 'Please enter your email and password.');
    return;
  }

  if (DEMO_MODE) {
    if (email === 'admin@ironcore.gym' && password === 'admin123') {
      showUError(errEl, 'That account belongs to the admin portal. Please use the admin workspace instead.');
      return;
    }

    let member = null;
    const stored = JSON.parse(localStorage.getItem('ironcore_members') || '[]');

    if (email === DEMO_USER_EMAIL && password === DEMO_USER_PASSWORD) {
      member = stored[0] || {
        id: DEMO_USER_ID,
        name: 'Arjun Sharma',
        email: DEMO_USER_EMAIL,
        phone: '+91 9876543210',
        plan: 'Monthly',
        due_date: (() => {
          const date = new Date();
          date.setDate(date.getDate() + 1);
          return date.toISOString().split('T')[0];
        })(),
        join_date: '2025-08-01',
        notes: '',
      };
    } else {
      member = stored.find(item => item.email.toLowerCase() === email.toLowerCase());
      if (!member) {
        showUError(errEl, 'No member found with that email. Demo: member@ironcore.gym / member123');
        return;
      }
    }

    currentUser = member;
    sessionStorage.setItem('ironcore_user_auth', JSON.stringify(member));
    showUserApp();
    return;
  }

  try {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;

    let member = null;
    try {
      const response = await fetch(`${USER_BACKEND_API_URL}/api/members/by-email?email=${encodeURIComponent(email)}`);
      const result = await response.json();
      if (!response.ok || result.ok === false) {
        throw new Error(result.error || 'Member lookup failed.');
      }
      member = result.member;
    } catch (backendError) {
      const { data, error: memberError } = await supabase.from('members').select('*').eq('email', email).single();
      if (memberError || !data) {
        showUError(errEl, 'No membership found for this account. Please contact the gym desk.');
        return;
      }
      member = data;
    }

    currentUser = member;
    sessionStorage.setItem('ironcore_user_auth', JSON.stringify(member));
    showUserApp();
  } catch (error) {
    showUError(errEl, error.message || 'Login failed.');
  }
}

async function userLogout() {
  if (!DEMO_MODE && supabase) await supabase.auth.signOut();
  sessionStorage.removeItem('ironcore_user_auth');
  currentUser = null;
  notifPanelOpen = false;
  document.getElementById('userApp').classList.add('hidden');
  document.getElementById('userLoginScreen').classList.remove('hidden');
}

function showForgot() {
  document.getElementById('uLoginForm').classList.add('hidden');
  document.getElementById('uForgotForm').classList.remove('hidden');
}

function showLogin() {
  document.getElementById('uForgotForm').classList.add('hidden');
  document.getElementById('uLoginForm').classList.remove('hidden');
}

async function sendReset() {
  const email = document.getElementById('uForgotEmail').value.trim();
  const msgEl = document.getElementById('uForgotMsg');

  msgEl.className = '';
  if (!email) {
    msgEl.textContent = 'Please enter your email.';
    msgEl.className = 'error-msg';
    return;
  }

  if (DEMO_MODE) {
    msgEl.textContent = 'Demo mode: no email was sent. Use member@ironcore.gym / member123.';
    msgEl.className = 'u-notif-item info';
    msgEl.style.display = 'block';
    return;
  }

  try {
    await supabase.auth.resetPasswordForEmail(email);
    msgEl.textContent = 'Reset link sent. Please check your inbox.';
    msgEl.className = 'u-notif-item info';
    msgEl.style.display = 'block';
  } catch (error) {
    msgEl.textContent = error.message;
    msgEl.className = 'error-msg';
    msgEl.style.display = 'block';
  }
}

// ============================================================
// SHOW APP
// ============================================================
function showUserApp() {
  document.getElementById('userLoginScreen').classList.add('hidden');
  document.getElementById('userApp').classList.remove('hidden');

  loadUserData();
  buildDayTabs();
  checkUserNotifications();
  uShowView('home', document.querySelector('[data-view="home"]'));
}

function loadUserData() {
  if (!currentUser) return;

  userVisits = JSON.parse(localStorage.getItem('ironcore_user_visits') || '[]');
  userPayments = JSON.parse(localStorage.getItem('ironcore_user_payments') || '[]');

  const initials = getInitials(currentUser.name);
  const first = firstName(currentUser.name);
  const daysLeft = getDaysLeftU(currentUser.due_date);
  const absDays = Math.abs(daysLeft);
  const months = monthsSince(currentUser.join_date);
  const status = getMemberStatusU(currentUser.due_date);

  document.getElementById('uNavAvatar').textContent = initials;
  document.getElementById('uNavName').textContent = first;
  document.getElementById('uBannerName').textContent = first;
  document.getElementById('uBannerPlan').textContent = `${currentUser.plan} plan`;
  document.getElementById('uBannerDueText').textContent = daysLeft < 0
    ? `Your membership expired ${absDays} day(s) ago. Renew now to get back on track.`
    : daysLeft === 0
      ? 'Your membership renews today. You can take care of it right from this portal.'
      : `You have ${daysLeft} day(s) left before your next renewal.`;

  document.getElementById('uCardAvatar').textContent = initials;
  document.getElementById('uCardName').textContent = currentUser.name;
  document.getElementById('uCardEmail').textContent = currentUser.email;
  document.getElementById('uCardPlan').textContent = currentUser.plan;
  document.getElementById('uCardJoin').textContent = fmtDate(currentUser.join_date);
  document.getElementById('uProfileAvatar').textContent = initials;
  document.getElementById('uProfileName').textContent = currentUser.name;

  const dueEl = document.getElementById('uCardDue');
  dueEl.textContent = fmtDate(currentUser.due_date);
  dueEl.className = `ucard-fval ucard-due${daysLeft < 0 ? ' overdue' : daysLeft <= 2 ? ' expiring' : ''}`;

  const statusLabels = {
    active: 'Active',
    overdue: 'Overdue',
    expiring: 'Expiring soon',
  };
  document.getElementById('uCardStatus').textContent = statusLabels[status] || status;

  const cdEl = document.getElementById('uCdDays');
  cdEl.textContent = daysLeft < 0 ? `-${absDays}` : absDays;
  cdEl.className = `u-cd-number${daysLeft < 0 ? ' overdue' : daysLeft <= 2 ? ' urgent' : ''}`;

  const tipEl = document.getElementById('uRenewalTip');
  if (daysLeft < 0) {
    tipEl.textContent = `Your membership expired ${absDays} day(s) ago. Renew now to continue gym access.`;
    tipEl.className = 'u-renewal-tip visible alert';
  } else if (daysLeft <= 2) {
    tipEl.textContent = `Your membership expires ${daysLeft === 0 ? 'today' : `in ${daysLeft} day(s)`}. Renew now to avoid interruption.`;
    tipEl.className = 'u-renewal-tip visible warn';
  } else {
    tipEl.textContent = '';
    tipEl.className = 'u-renewal-tip';
  }

  const alertEl = document.getElementById('uAlertBanner');
  if (daysLeft < 0) {
    alertEl.innerHTML = `Your membership has expired. <button class="u-link-btn" onclick="openRenewModal()">Renew now</button> to keep your access active.`;
    alertEl.className = 'u-alert-banner alert';
    alertEl.classList.remove('hidden');
  } else if (daysLeft <= 2) {
    alertEl.innerHTML = `Your membership renews ${daysLeft === 0 ? 'today' : `in ${daysLeft} day(s)`}. <button class="u-link-btn" onclick="openRenewModal()">Take care of it now</button>.`;
    alertEl.className = 'u-alert-banner warn';
    alertEl.classList.remove('hidden');
  } else {
    alertEl.textContent = '';
    alertEl.className = 'u-alert-banner hidden';
  }

  document.getElementById('uDaysLeft').textContent = daysLeft < 0 ? '0' : daysLeft;
  document.getElementById('uTotalVisits').textContent = userVisits.length;
  document.getElementById('uStreak').textContent = calcStreak();
  document.getElementById('uMemberMonths').textContent = months;

  document.getElementById('uPfName').value = currentUser.name;
  document.getElementById('uPfEmail').value = currentUser.email;
  document.getElementById('uPfPhone').value = currentUser.phone || '';
  document.getElementById('uPfEmergency').value = currentUser.emergency_contact || '';
  document.getElementById('uPfHealth').value = currentUser.health_notes || '';

  document.getElementById('uProfilePlan').textContent = currentUser.plan;
  document.getElementById('uProfileMeta').textContent = `Member since ${fmtDate(currentUser.join_date)}`;
  document.getElementById('uPsVisits').textContent = userVisits.length;
  document.getElementById('uPsStreak').textContent = calcStreak();
  document.getElementById('uPsMonths').textContent = months;

  const statusBadgeMap = {
    active: '<span style="color:var(--accent-success)">Active</span>',
    overdue: '<span style="color:var(--accent-danger)">Overdue</span>',
    expiring: '<span style="color:var(--accent-warm)">Due soon</span>',
  };
  document.getElementById('uMdPlan').textContent = currentUser.plan;
  document.getElementById('uMdStatus').innerHTML = statusBadgeMap[status] || status;
  document.getElementById('uMdJoin').textContent = fmtDate(currentUser.join_date);
  document.getElementById('uMdDue').textContent = fmtDate(currentUser.due_date);
  document.getElementById('uMdDaysLeft').innerHTML = daysLeft < 0
    ? `<span style="color:var(--accent-danger)">${absDays}d overdue</span>`
    : `<span style="color:${daysLeft <= 2 ? 'var(--accent-warm)' : 'var(--text)'}">${daysLeft}d</span>`;

  renderWeekChart();
  renderUpcomingClasses();
  renderAnnouncements();
  renderHeatmap();
  renderPaymentHistory();
  renderVisitLog();
}

// ============================================================
// VIEWS
// ============================================================
function uShowView(view, el) {
  document.querySelectorAll('.u-view').forEach(node => {
    node.classList.add('hidden');
    node.classList.remove('active');
  });
  document.querySelectorAll('.u-nav-tab').forEach(node => node.classList.remove('active'));

  const viewEl = document.getElementById(`uview-${view}`);
  if (viewEl) {
    viewEl.classList.remove('hidden');
    viewEl.classList.add('active');
  }
  if (el) el.classList.add('active');

  if (view === 'schedule') renderScheduleForDay(selectedDayIdx);
  if (view === 'payments') loadPaymentsView();
  return false;
}

// ============================================================
// HOME VIEW
// ============================================================
function renderWeekChart() {
  const container = document.getElementById('uWeekChart');
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const today = new Date();
  const todayDay = (today.getDay() + 6) % 7;
  let sessionCount = 0;

  const bars = days.map((day, index) => {
    const date = new Date(today);
    date.setDate(date.getDate() - todayDay + index);
    const dateStr = date.toISOString().split('T')[0];
    const visits = userVisits.filter(visit => visit.date === dateStr).length;
    if (visits) sessionCount += 1;
    return {
      day,
      visits,
      isToday: index === todayDay,
      isFuture: index > todayDay,
    };
  });

  document.getElementById('uWeekTotal').textContent = `${sessionCount} session${sessionCount === 1 ? '' : 's'}`;

  const maxVisits = Math.max(...bars.map(bar => bar.visits), 1);
  container.innerHTML = bars.map(bar => {
    const height = bar.isFuture ? 0 : Math.max((bar.visits / maxVisits) * 86, bar.visits > 0 ? 12 : 0);
    const cls = bar.isToday ? 'today' : bar.visits > 0 ? 'active' : '';
    return `
      <div class="u-wc-bar-wrap">
        <div class="u-wc-bar ${cls}" style="height:${height}px"></div>
        <div class="u-wc-label ${bar.isToday ? 'today' : ''}">${bar.day}</div>
      </div>
    `;
  }).join('');
}

function renderUpcomingClasses() {
  const container = document.getElementById('uUpcomingClasses');
  const today = new Date().toISOString().split('T')[0];
  const nowTime = new Date().toTimeString().slice(0, 5);
  const upcoming = [];

  Object.entries(GYM_SCHEDULE).forEach(([date, classes]) => {
    classes.forEach(cls => {
      if (date > today || (date === today && cls.time > nowTime)) {
        upcoming.push({ ...cls, date });
      }
    });
  });

  upcoming.sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));
  const nextItems = upcoming.slice(0, 4);

  if (!nextItems.length) {
    container.innerHTML = '<p class="empty-state">No upcoming classes.</p>';
    return;
  }

  container.innerHTML = nextItems.map(item => {
    const isFull = item.available === 0;
    const dateLabel = item.date === today ? 'Today' : fmtDateShort(item.date);
    return `
      <div class="u-class-item" onclick="uShowView('schedule', document.querySelector('[data-view=&quot;schedule&quot;]'))">
        <div class="u-class-time">${item.time}<br><span style="font-size:10px;color:var(--text3)">${dateLabel}</span></div>
        <div class="u-class-info">
          <div class="u-class-name">${esc2(item.name)}</div>
          <div class="u-class-coach">${esc2(item.coach)}</div>
        </div>
        <span class="u-class-slots ${isFull ? 'full' : ''}">${isFull ? 'Full' : `${item.available} left`}</span>
      </div>
    `;
  }).join('');
}

function renderAnnouncements() {
  const container = document.getElementById('uAnnouncements');
  container.innerHTML = GYM_ANNOUNCEMENTS.map(item => `
    <div class="u-ann-item ${item.type}">
      <div class="u-ann-title">${esc2(item.title)}</div>
      <div class="u-ann-body">${esc2(item.body)}</div>
      <div class="u-ann-date">${fmtDate(item.date)}</div>
    </div>
  `).join('');
}

// ============================================================
// SCHEDULE
// ============================================================
function buildDayTabs() {
  const container = document.getElementById('uDayTabs');
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const today = new Date();

  container.innerHTML = '';
  for (let index = 0; index < 7; index += 1) {
    const date = new Date(today);
    date.setDate(date.getDate() + index);
    const tab = document.createElement('div');
    tab.className = `u-day-tab ${index === 0 ? 'active' : ''}`;
    tab.innerHTML = `<div class="u-day-tab-day">${days[date.getDay()]}</div><div class="u-day-tab-date">${date.getDate()}</div>`;
    tab.onclick = () => {
      document.querySelectorAll('.u-day-tab').forEach(node => node.classList.remove('active'));
      tab.classList.add('active');
      selectedDayIdx = index;
      renderScheduleForDay(index);
    };
    container.appendChild(tab);
  }
}

function renderScheduleForDay(dayIdx) {
  const container = document.getElementById('uScheduleGrid');
  const date = new Date();
  date.setDate(date.getDate() + dayIdx);
  const key = date.toISOString().split('T')[0];
  const classes = GYM_SCHEDULE[key] || [];

  if (!classes.length) {
    container.innerHTML = '<div class="u-card" style="padding:40px;text-align:center;color:var(--text3)">No classes scheduled for this day.</div>';
    return;
  }

  container.innerHTML = classes.map(item => {
    const isFull = item.available === 0;
    const isBooked = userBookings.includes(item.id);
    return `
      <div class="u-sched-item">
        <div class="u-sched-time">${item.time}</div>
        <div class="u-sched-color" style="background:${item.color}"></div>
        <div class="u-sched-info">
          <div class="u-sched-name">${esc2(item.name)}</div>
          <div class="u-sched-meta">${esc2(item.coach)} | ${item.duration} min</div>
        </div>
        <div class="u-sched-right">
          <span class="u-sched-slots ${isFull ? 'full' : 'open'}">${isFull ? 'Full' : `${item.available} / ${item.maxSlots} open`}</span>
          <button class="u-book-btn" ${isFull && !isBooked ? 'disabled' : ''} onclick="bookClass('${item.id}', this)">
            ${isBooked ? 'Booked' : isFull ? 'Full' : 'Book'}
          </button>
        </div>
      </div>
    `;
  }).join('');
}

function bookClass(classId, btn) {
  if (userBookings.includes(classId)) {
    userBookings = userBookings.filter(id => id !== classId);
    btn.textContent = 'Book';
    btn.style.background = '';
    showUToast('Booking cancelled.');
    return;
  }

  userBookings.push(classId);
  btn.textContent = 'Booked';
  btn.style.background = 'var(--accent-success)';
  showUToast('Class booked successfully.', 'success');
}

// ============================================================
// HISTORY
// ============================================================
function renderHeatmap() {
  const container = document.getElementById('uHeatmap');
  const monthLabel = document.getElementById('uHeatmapMonth');
  const today = new Date();
  const year = today.getFullYear();
  const month = today.getMonth();

  monthLabel.textContent = today.toLocaleString('default', { month: 'long', year: 'numeric' });

  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstDay = new Date(year, month, 1).getDay();
  const visitMap = {};

  userVisits.forEach(visit => {
    const date = new Date(visit.date);
    if (date.getMonth() === month && date.getFullYear() === year) {
      visitMap[visit.date] = (visitMap[visit.date] || 0) + 1;
    }
  });

  let html = '';
  for (let index = 0; index < firstDay; index += 1) {
    html += '<div class="u-hm-cell s0"></div>';
  }

  for (let day = 1; day <= daysInMonth; day += 1) {
    const date = new Date(year, month, day);
    const dateStr = date.toISOString().split('T')[0];
    const visits = visitMap[dateStr] || 0;
    const shade = visits === 0 ? 's0' : visits === 1 ? 's1' : visits === 2 ? 's2' : 's3';
    const isToday = dateStr === today.toISOString().split('T')[0];
    html += `<div class="u-hm-cell ${shade} ${isToday ? 'today-cell' : ''}" title="${dateStr}: ${visits} visit(s)"></div>`;
  }

  container.innerHTML = html;
}

function renderPaymentHistory() {
  const container = document.getElementById('uPaymentHistory');
  if (!userPayments.length) {
    container.innerHTML = '<p class="empty-state">No payment records.</p>';
    return;
  }

  container.innerHTML = userPayments.map(payment => `
    <div class="u-pay-item">
      <div>
        <div class="u-pay-plan">${esc2(payment.plan)} plan</div>
        <div class="u-pay-date">${fmtDate(payment.date)}</div>
      </div>
      <div class="u-pay-amount">Rs ${payment.amount.toLocaleString()}</div>
    </div>
  `).join('');
}

function renderVisitLog() {
  const container = document.getElementById('uVisitLog');
  const recent = [...userVisits].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 15);

  if (!recent.length) {
    container.innerHTML = '<p class="empty-state">No visits recorded yet.</p>';
    return;
  }

  container.innerHTML = recent.map(visit => `
    <div class="u-visit-item">
      <div class="u-visit-dot"></div>
      <div class="u-visit-day">${fmtDate(visit.date)}</div>
      <div class="u-visit-class">${esc2(visit.class_name)}</div>
      <div class="u-visit-time">${visit.time}</div>
    </div>
  `).join('');
}

// ============================================================
// NOTIFICATIONS
// ============================================================
function checkUserNotifications() {
  if (!currentUser) return;

  userNotifications = [];
  const days = getDaysLeftU(currentUser.due_date);

  if (days < 0) {
    userNotifications.push({
      type: 'alert',
      title: 'Membership expired',
      body: `Your membership expired ${Math.abs(days)} day(s) ago. Renew now to regain access.`,
      time: 'Just now',
    });
  } else if (days <= 2) {
    userNotifications.push({
      type: 'warn',
      title: 'Membership due soon',
      body: `Your ${currentUser.plan} membership renews ${days === 0 ? 'today' : `in ${days} day(s)`}.`,
      time: 'Just now',
    });
  }

  userNotifications.push({
    type: 'info',
    title: 'New class added',
    body: 'Early morning CrossFit WOD is now available at 5:30 AM on weekdays.',
    time: '2 days ago',
  });

  const dot = document.getElementById('uNotifDot');
  if (dot) {
    const hasAlert = userNotifications.some(item => item.type !== 'info');
    dot.className = `u-notif-dot${hasAlert ? ' visible' : ''}`;
  }
}

function toggleNotifPanel() {
  const panel = document.getElementById('uNotifPanel');
  const overlay = document.getElementById('uNotifOverlay');

  notifPanelOpen = !notifPanelOpen;
  if (notifPanelOpen) {
    renderNotifPanel();
    panel.classList.remove('hidden');
    panel.classList.add('open');
    overlay.classList.remove('hidden');
    return;
  }

  panel.classList.remove('open');
  overlay.classList.add('hidden');
  setTimeout(() => panel.classList.add('hidden'), 300);
}

function renderNotifPanel() {
  const list = document.getElementById('uNotifPanelList');
  if (!userNotifications.length) {
    list.innerHTML = '<p class="empty-state">No notifications.</p>';
    return;
  }

  list.innerHTML = userNotifications.map(item => `
    <div class="u-notif-item ${item.type}">
      <div class="u-notif-title">${esc2(item.title)}</div>
      <div class="u-notif-body">${esc2(item.body)}</div>
      <div class="u-notif-time">${item.time}</div>
    </div>
  `).join('');
}

// ============================================================
// PROFILE
// ============================================================
async function saveProfile() {
  const name = document.getElementById('uPfName').value.trim();
  const phone = document.getElementById('uPfPhone').value.trim();
  const emergency = document.getElementById('uPfEmergency').value.trim();
  const health = document.getElementById('uPfHealth').value.trim();
  const msgEl = document.getElementById('uProfileMsg');

  if (!name) {
    msgEl.textContent = 'Name is required.';
    msgEl.className = 'error-msg';
    msgEl.classList.remove('hidden');
    return;
  }

  currentUser = {
    ...currentUser,
    name,
    phone,
    emergency_contact: emergency,
    health_notes: health,
  };

  sessionStorage.setItem('ironcore_user_auth', JSON.stringify(currentUser));

  if (DEMO_MODE) {
    const stored = JSON.parse(localStorage.getItem('ironcore_members') || '[]');
    const index = stored.findIndex(item => item.id === currentUser.id);
    if (index > -1) {
      stored[index] = {
        ...stored[index],
        name,
        phone,
        emergency_contact: emergency,
        health_notes: health,
      };
      localStorage.setItem('ironcore_members', JSON.stringify(stored));
    }
    msgEl.textContent = 'Profile updated successfully.';
    msgEl.className = 'u-notif-item info';
    msgEl.style.display = 'block';
    msgEl.classList.remove('hidden');
    loadUserData();
    return;
  }

  try {
    try {
      const response = await fetch(`${USER_BACKEND_API_URL}/api/members/${currentUser.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          phone,
          emergency_contact: emergency,
          health_notes: health,
        }),
      });
      const result = await response.json();
      if (!response.ok || result.ok === false) {
        throw new Error(result.error || 'Profile update failed.');
      }
      currentUser = result.member || currentUser;
      sessionStorage.setItem('ironcore_user_auth', JSON.stringify(currentUser));
    } catch (backendError) {
      const { error } = await supabase.from('members').update({
        name,
        phone,
        emergency_contact: emergency,
        health_notes: health,
      }).eq('id', currentUser.id);
      if (error) throw error;
    }

    msgEl.textContent = 'Profile updated.';
    msgEl.className = 'u-notif-item info';
    msgEl.classList.remove('hidden');
    loadUserData();
  } catch (error) {
    msgEl.textContent = error.message;
    msgEl.className = 'error-msg';
    msgEl.classList.remove('hidden');
  }
}

async function changePassword() {
  const current = document.getElementById('uPwCurrent').value;
  const next = document.getElementById('uPwNew').value;
  const confirm = document.getElementById('uPwConfirm').value;
  const msgEl = document.getElementById('uPwMsg');

  msgEl.className = '';

  if (!current || !next || !confirm) {
    msgEl.textContent = 'All fields are required.';
    msgEl.className = 'error-msg';
    msgEl.classList.remove('hidden');
    return;
  }

  if (next !== confirm) {
    msgEl.textContent = 'New passwords do not match.';
    msgEl.className = 'error-msg';
    msgEl.classList.remove('hidden');
    return;
  }

  if (next.length < 6) {
    msgEl.textContent = 'Password must be at least 6 characters.';
    msgEl.className = 'error-msg';
    msgEl.classList.remove('hidden');
    return;
  }

  if (DEMO_MODE) {
    msgEl.textContent = 'Demo mode: password was not actually changed.';
    msgEl.style.color = 'var(--accent-success)';
    msgEl.classList.remove('hidden');
    return;
  }

  try {
    const { error } = await supabase.auth.updateUser({ password: next });
    if (error) throw error;
    msgEl.textContent = 'Password updated.';
    msgEl.style.color = 'var(--accent-success)';
    msgEl.classList.remove('hidden');
    document.getElementById('uPwCurrent').value = '';
    document.getElementById('uPwNew').value = '';
    document.getElementById('uPwConfirm').value = '';
  } catch (error) {
    msgEl.textContent = error.message;
    msgEl.className = 'error-msg';
    msgEl.classList.remove('hidden');
  }
}

// ============================================================
// RENEW MODAL
// ============================================================
function openRenewModal() {
  document.getElementById('uRenewModal').classList.remove('hidden');
  document.getElementById('uRenewMsg').classList.add('hidden');
  document.querySelectorAll('.u-renew-opt').forEach(node => node.classList.remove('selected'));
}

function closeRenewModal() {
  document.getElementById('uRenewModal').classList.add('hidden');
}

function selectRenewPlan(plan, element) {
  document.querySelectorAll('.u-renew-opt').forEach(node => node.classList.remove('selected'));
  if (element) element.classList.add('selected');

  const msgEl = document.getElementById('uRenewMsg');
  msgEl.textContent = `${plan} plan selected. Visit the gym desk or use the payment option to complete your renewal.`;
  msgEl.className = 'u-notif-item info';
  msgEl.style.display = 'block';
  msgEl.classList.remove('hidden');

  showUToast(`${plan} plan selected.`, 'success');
}

// ============================================================
// RAZORPAY PAYMENT
// ============================================================
const planPrices = {
  Monthly: { 'Strength Training': 1000, 'Strength / Cardio': 1500 },
  Quarterly: { 'Strength Training': 2500, 'Strength / Cardio': 4000 },
  Annual: { 'Strength Training': 10000, 'Strength / Cardio': 15000 }
};

function openPaymentModal(plan) {
  if (!currentUser) return;

  const membershipType = currentUser.membership_type || 'Strength Training';
  const amount = planPrices[plan] && planPrices[plan][membershipType] ? planPrices[plan][membershipType] : 1000;

  document.getElementById('paymentAmount').textContent = amount.toLocaleString();
  document.getElementById('paymentPlanText').textContent = `${plan} - ${membershipType}`;
  document.getElementById('paymentError').classList.add('hidden');
  document.getElementById('payNowBtn').disabled = false;

  // Store plan info for later use
  window.currentPaymentPlan = plan;
  window.currentPaymentAmount = amount * 100; // Convert to paise

  document.getElementById('paymentModal').classList.remove('hidden');
}

function closePaymentModal() {
  document.getElementById('paymentModal').classList.add('hidden');
  window.currentPaymentPlan = null;
  window.currentPaymentAmount = null;
}

async function readApiResponse(response, fallbackMessage) {
  const contentType = response.headers.get('content-type') || '';

  if (contentType.includes('application/json')) {
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || fallbackMessage);
    }
    return data;
  }

  const bodyText = (await response.text()).replace(/\s+/g, ' ').trim();
  const returnedHtml = /^<!doctype|^<html/i.test(bodyText);
  const details = returnedHtml
    ? 'The backend returned HTML instead of JSON. Restart the Flask backend from the latest code on port 5000.'
    : bodyText.slice(0, 160) || 'Unexpected response format.';

  throw new Error(`${fallbackMessage} (HTTP ${response.status}). ${details}`);
}

async function processPayment() {
  if (!window.currentPaymentPlan || !window.currentPaymentAmount) {
    showUToast('Payment plan not selected', 'error');
    return;
  }

  const payBtn = document.getElementById('payNowBtn');
  const errorEl = document.getElementById('paymentError');

  payBtn.disabled = true;
  errorEl.classList.add('hidden');

  try {
    // Step 1: Create order on backend
    const orderResponse = await fetch(`${USER_BACKEND_API_URL}/api/create-order`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        amount: window.currentPaymentAmount,
        currency: 'INR',
        receipt: `order_${Date.now()}_${currentUser.id}`,
        description: `${window.currentPaymentPlan} membership renewal for ${currentUser.name}`
      })
    });

    const orderData = await readApiResponse(orderResponse, 'Failed to create order');
    const orderId = orderData.order_id;

    // Step 2: Open checkout
    const options = {
      key: orderData.key_id,
      order_id: orderId,
      amount: orderData.amount,
      currency: orderData.currency,
      name: 'Forge Fitness',
      description: `${window.currentPaymentPlan} Membership Renewal`,
      prefill: {
        name: currentUser.name,
        email: currentUser.email,
        contact: currentUser.phone
      },
      handler: async function (response) {
        // Step 3: Verify payment on backend
        try {
          const verifyResponse = await fetch(`${USER_BACKEND_API_URL}/api/verify-payment`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              razorpay_order_id: response.razorpay_order_id,
              razorpay_payment_id: response.razorpay_payment_id,
              razorpay_signature: response.razorpay_signature
            })
          });

          await readApiResponse(verifyResponse, 'Payment verification failed');

          const renewResponse = await fetch(`${USER_BACKEND_API_URL}/api/members/${currentUser.id}/renew`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              plan: window.currentPaymentPlan,
            })
          });

          const renewData = await readApiResponse(renewResponse, 'Membership renewal failed');
          currentUser = renewData.member || currentUser;
          sessionStorage.setItem('ironcore_user_auth', JSON.stringify(currentUser));

          // Payment successful - update local storage and close modal
          const payments = JSON.parse(localStorage.getItem('ironcore_user_payments') || '[]');
          payments.unshift({
            date: new Date().toISOString().split('T')[0],
            plan: window.currentPaymentPlan,
            membership_type: currentUser.membership_type || 'Strength Training',
            amount: window.currentPaymentAmount / 100,
            payment_id: response.razorpay_payment_id,
            order_id: response.razorpay_order_id
          });
          localStorage.setItem('ironcore_user_payments', JSON.stringify(payments));
          userPayments = payments;

          closePaymentModal();
          closeRenewModal();
          loadUserData();
          showUToast(`Payment successful! Your membership has been renewed for ${window.currentPaymentPlan}.`, 'success');

          // Refresh payments view if visible
          const tab = document.querySelector('[data-view="payments"].active');
          if (tab) loadPaymentsView();

        } catch (err) {
          console.error('Payment verification failed:', err);
          errorEl.textContent = err.message;
          errorEl.classList.remove('hidden');
          payBtn.disabled = false;
        }
      },
      modal: {
        ondismiss: function () {
          showUToast('Payment cancelled', 'info');
          payBtn.disabled = false;
        }
      },
      theme: {
        color: '#DC4050'
      }
    };

    const rzp = new Razorpay(options);
    rzp.open();

  } catch (err) {
    console.error('Payment processing error:', err);
    errorEl.textContent = err.message;
    errorEl.classList.remove('hidden');
    payBtn.disabled = false;
  }
}

// ============================================================
// UTILITIES
// ============================================================
function getDaysLeftU(dueDateStr) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const due = new Date(dueDateStr);
  due.setHours(0, 0, 0, 0);

  return Math.round((due - today) / 86400000);
}

function getMemberStatusU(dueDateStr) {
  const days = getDaysLeftU(dueDateStr);
  if (days < 0) return 'overdue';
  if (days <= 2) return 'expiring';
  return 'active';
}

function calcStreak() {
  const today = new Date();
  let streak = 0;

  for (let offset = 0; offset < 365; offset += 1) {
    const date = new Date(today);
    date.setDate(date.getDate() - offset);
    const dateStr = date.toISOString().split('T')[0];
    const visited = userVisits.some(visit => visit.date === dateStr);
    if (visited) streak += 1;
    else if (offset > 0) break;
  }

  return streak;
}

function monthsSince(dateStr) {
  const start = new Date(dateStr);
  const now = new Date();
  return Math.max(0, (now.getFullYear() - start.getFullYear()) * 12 + now.getMonth() - start.getMonth());
}

function fmtDate(dateStr) {
  if (!dateStr) return '-';
  return new Date(dateStr).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

function fmtDateShort(dateStr) {
  if (!dateStr) return '-';
  return new Date(dateStr).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
}

function getInitials(name = '') {
  return name.split(' ').map(part => part[0]).join('').toUpperCase().slice(0, 2);
}

function firstName(name = '') {
  return name.split(' ')[0];
}

function esc2(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function showUError(el, msg) {
  el.textContent = msg;
  el.classList.remove('hidden');
}

function showUToast(msg, type = '') {
  const toast = document.getElementById('uToast');
  toast.textContent = msg;
  toast.className = `toast ${type}`;
  toast.classList.remove('hidden');
  clearTimeout(uToastTimeout);
  uToastTimeout = setTimeout(() => toast.classList.add('hidden'), 3500);
}

// ============================================================
// PAYMENTS VIEW
// ============================================================
function loadPaymentsView() {
  const planPrices = {
    Monthly: { 'Strength Training': 1000, 'Strength / Cardio': 1500 },
    Quarterly: { 'Strength Training': 2500, 'Strength / Cardio': 4000 },
    Annual: { 'Strength Training': 10000, 'Strength / Cardio': 15000 }
  };
  const currentPlan = currentUser && currentUser.plan ? currentUser.plan : 'Monthly';
  const currentMembershipType = currentUser && currentUser.membership_type ? currentUser.membership_type : 'Strength Training';
  const amount = planPrices[currentPlan] && planPrices[currentPlan][currentMembershipType] ? planPrices[currentPlan][currentMembershipType] : 1000;
  const status = currentUser ? getMemberStatusU(currentUser.due_date) : 'active';

  document.getElementById('uPaymentPlan').textContent = `${currentPlan} - ${currentMembershipType}`;
  document.getElementById('uPaymentAmount').textContent = `Rs ${amount.toLocaleString()}`;
  document.getElementById('uPaymentStatus').textContent = status === 'active' ? 'Active' : status === 'expiring' ? 'Due soon' : 'Overdue';
  document.getElementById('uPaymentDue').textContent = currentUser ? fmtDate(currentUser.due_date) : '-';

  const payments = JSON.parse(localStorage.getItem('ironcore_user_payments') || '[]');
  document.getElementById('uPaymentHistoryCount').textContent = `${payments.length} payment${payments.length === 1 ? '' : 's'}`;

  const historyList = document.getElementById('uPaymentHistoryList');
  if (!payments.length) {
    historyList.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text3)">No payments yet</div>';
    return;
  }

  historyList.innerHTML = payments.slice(0, 10).map(payment => `
    <div class="u-payment-item">
      <div class="u-payment-item-info">
        <div class="u-payment-item-date">${fmtDate(payment.date)}</div>
        <div class="u-payment-item-plan">${payment.plan}${payment.membership_type ? ` - ${payment.membership_type}` : ''} plan</div>
      </div>
      <div class="u-payment-item-amount">Rs ${payment.amount.toLocaleString()}</div>
    </div>
  `).join('');
}

// ============================================================
// KEYBOARD
// ============================================================
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') {
    closeRenewModal();
    if (notifPanelOpen) toggleNotifPanel();
  }

  const loginScreen = document.getElementById('userLoginScreen');
  if (event.key === 'Enter' && loginScreen && !loginScreen.classList.contains('hidden')) {
    userLogin();
  }
});
