// Minimal client for the trial booking API. No framework and no build step:
// the backend is the point of this exercise; this page only drives it.
// Every business rule is enforced by the API. The page mirrors a few of them
// (full classes are disabled, buttons lock while a request runs) for comfort.

const POLL_MS = 3000;

const state = {
  userId: null,
  directory: { parents: [], staff: [], testCards: [] },
  classes: [],
  bookings: [],
  selectedChildId: null,
  selectedClassId: null,
  activeBookingId: null,
  selectedCard: 'pm_card_visa',
  bookingNotice: null,
  paymentNotice: null,
  busy: false,
  rosterClassId: null,
  roster: null,
};

const app = document.getElementById('app');
const userSelect = document.getElementById('user-select');

// ---------------------------------------------------------------- helpers

/** Creates an element. Text children become text nodes, so data is never parsed as HTML. */
function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
    else if (value === true) el.setAttribute(key, '');
    else el.setAttribute(key, String(value));
  }
  for (const child of children.flat(Infinity)) {
    if (child === undefined || child === null || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

const sgtFormat = new Intl.DateTimeFormat('en-SG', {
  timeZone: 'Asia/Singapore',
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  hour: 'numeric',
  minute: '2-digit',
});
const when = (iso) => `${sgtFormat.format(new Date(iso))} SGT`;
const money = (cents, currency) => `${currency} ${(cents / 100).toFixed(2)}`;

async function api(path, { method = 'GET', body } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (state.userId) headers['x-user-id'] = state.userId;
  try {
    const response = await fetch(path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await response.json().catch(() => ({}));
    return { ok: response.ok, status: response.status, data };
  } catch {
    return { ok: false, status: 0, data: { error: { message: 'Could not reach the server.' } } };
  }
}

function sessionGet(key) {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function sessionSet(key, value) {
  try {
    sessionStorage.setItem(key, value);
  } catch {
    // Storage can be unavailable (private mode); the ?as= parameter still works.
  }
}

const BOOKING_BADGES = {
  pending_payment: ['warn', 'Pending payment'],
  payment_failed: ['bad', 'Payment failed'],
  confirmed: ['ok', 'Confirmed'],
  cancelled: ['neutral', 'Cancelled'],
};
const CANCEL_REASONS = { class_full: 'class full', booking_closed: 'class started' };
const PAYMENT_LABELS = {
  processing: 'Processing',
  authorized: 'Authorized',
  declined: 'Declined',
  captured: 'Paid',
  voided: 'Not charged (hold released)',
  capture_failed: 'Capture failed',
};
const OUTCOME_TONES = {
  confirmed: 'ok',
  payment_declined: 'bad',
  class_full: 'bad',
  booking_closed: 'bad',
  already_confirmed: 'info',
};

const isPayable = (booking) => booking.status === 'pending_payment' || booking.status === 'payment_failed';

function bookingBadge(booking) {
  const [tone, label] = BOOKING_BADGES[booking.status] ?? ['neutral', booking.status];
  const reason = booking.cancelReason ? ` (${CANCEL_REASONS[booking.cancelReason] ?? booking.cancelReason})` : '';
  return h('span', { class: `badge ${tone}` }, label + reason);
}

function paymentLabel(booking) {
  const last = booking.paymentAttempts.at(-1);
  if (!last) return 'None yet';
  const label = PAYMENT_LABELS[last.status] ?? last.status;
  return last.status === 'declined' && last.failureCode ? `${label} (${last.failureCode.replaceAll('_', ' ')})` : label;
}

function seatsBadge(trialClass) {
  if (trialClass.seatsLeft <= 0) return h('span', { class: 'badge neutral seats' }, 'Full');
  if (trialClass.seatsLeft === 1) return h('span', { class: 'badge warn seats' }, 'Last seat');
  return h('span', { class: 'badge ok seats' }, `${trialClass.seatsLeft} of ${trialClass.capacity} seats left`);
}

function notice(message) {
  return message ? h('div', { class: `notice ${message.tone}`, role: 'status' }, message.text) : null;
}

// ------------------------------------------------------------------- data

const isStaff = () => state.directory.staff.some((user) => user.id === state.userId);
const currentParent = () => state.directory.parents.find((parent) => parent.id === state.userId);

async function refreshClasses() {
  const { ok, data } = await api('/api/trial-classes');
  if (!ok) return;
  state.classes = data.trialClasses;
  // Drop a selection that is no longer bookable (another parent took the last seat).
  const selected = state.classes.find((trialClass) => trialClass.id === state.selectedClassId);
  if (!selected || selected.seatsLeft <= 0) state.selectedClassId = null;
}

async function refreshBookings() {
  if (isStaff()) return;
  const { ok, data } = await api('/api/bookings');
  if (ok) state.bookings = data.bookings;
}

async function refreshRoster() {
  if (!isStaff() || !state.rosterClassId) return;
  const { ok, data } = await api(`/api/staff/trial-classes/${encodeURIComponent(state.rosterClassId)}/roster`);
  state.roster = ok ? data : null;
}

const refreshAll = () => Promise.all([refreshClasses(), refreshBookings(), refreshRoster()]);

// ---------------------------------------------------------------- actions

async function signInAs(userId) {
  state.userId = userId;
  sessionSet('userId', userId);
  const url = new URL(location.href);
  url.searchParams.set('as', userId);
  history.replaceState(null, '', url);

  const parent = currentParent();
  state.selectedChildId = parent?.children.length === 1 ? parent.children[0].id : null;
  Object.assign(state, {
    bookings: [],
    selectedClassId: null,
    activeBookingId: null,
    bookingNotice: null,
    paymentNotice: null,
    rosterClassId: null,
    roster: null,
  });
  await refreshAll();
  render();
}

async function startBooking() {
  state.busy = true;
  state.bookingNotice = null;
  render();
  const { ok, status, data } = await api('/api/bookings', {
    method: 'POST',
    body: { studentId: state.selectedChildId, trialClassId: state.selectedClassId },
  });
  state.busy = false;
  if (!ok) {
    state.bookingNotice = { tone: 'bad', text: data.error?.message ?? 'Something went wrong.' };
    await refreshClasses();
    render();
    return;
  }
  state.activeBookingId = data.booking.id;
  state.paymentNotice =
    status === 200
      ? { tone: 'info', text: 'You had already started this booking. Continue with the payment below.' }
      : null;
  await refreshBookings();
  render();
  document.getElementById('payment')?.scrollIntoView({ block: 'start' });
}

async function pay() {
  const bookingId = state.activeBookingId;
  state.busy = true;
  state.paymentNotice = null;
  render();
  const { data } = await api(`/api/bookings/${encodeURIComponent(bookingId)}/payments`, {
    method: 'POST',
    body: { paymentMethod: state.selectedCard },
  });
  state.busy = false;
  state.paymentNotice = data.error
    ? { tone: 'bad', text: data.error.message }
    : { tone: OUTCOME_TONES[data.outcome] ?? 'info', text: data.message };
  await Promise.all([refreshClasses(), refreshBookings()]);
  render();
}

function openPayment(bookingId) {
  state.activeBookingId = bookingId;
  state.paymentNotice = null;
  render();
  document.getElementById('payment')?.scrollIntoView({ block: 'start' });
}

async function showRoster(trialClassId) {
  state.rosterClassId = trialClassId;
  await refreshRoster();
  render();
}

// -------------------------------------------------------------- rendering

/** Re-renders the whole page from `state`, keeping the reader's scroll position. */
function render() {
  const scrollY = window.scrollY;
  app.replaceChildren(...(isStaff() ? renderStaff() : renderParent()));
  window.scrollTo(0, scrollY);
}

function renderParent() {
  const parent = currentParent();
  if (!parent) return [h('section', { class: 'card' }, 'Pick a user in the top bar.')];
  return [renderBookingForm(parent), renderPayment(), renderMyBookings()].filter(Boolean);
}

function renderBookingForm(parent) {
  const children = parent.children.map((child) =>
    h(
      'label',
      { class: 'chip' },
      h('input', {
        type: 'radio',
        name: 'child',
        value: child.id,
        checked: state.selectedChildId === child.id,
        onchange: () => {
          state.selectedChildId = child.id;
          state.bookingNotice = null;
          render();
        },
      }),
      h('span', {}, `${child.name} `, h('span', { class: 'option-meta' }, `P${child.level}`)),
    ),
  );

  const classes = state.classes.map((trialClass) =>
    h(
      'label',
      { class: 'option' },
      h(
        'span',
        { class: 'option-main' },
        h('input', {
          type: 'radio',
          name: 'class',
          value: trialClass.id,
          checked: state.selectedClassId === trialClass.id,
          disabled: trialClass.seatsLeft <= 0,
          onchange: () => {
            state.selectedClassId = trialClass.id;
            state.bookingNotice = null;
            render();
          },
        }),
        h(
          'span',
          {},
          h('div', { class: 'option-title' }, h('span', { class: 'subject' }, trialClass.subject), trialClass.title),
          h(
            'div',
            { class: 'option-meta' },
            `${when(trialClass.startsAt)} · ${trialClass.teacherName} · ${money(trialClass.priceCents, trialClass.currency)}`,
          ),
        ),
      ),
      seatsBadge(trialClass),
    ),
  );

  return h(
    'section',
    { class: 'card' },
    h('h2', {}, 'Book a trial class'),
    h('p', { class: 'lede' }, `Signed in as ${parent.name}. Trial classes have 4 seats; a seat is yours once payment succeeds.`),
    h('div', { class: 'step-label' }, '1. Child'),
    h('div', { class: 'chips' }, children),
    h('div', { class: 'step-label' }, '2. Trial class'),
    classes.length ? h('div', { class: 'options' }, classes) : h('p', { class: 'empty' }, 'No upcoming classes. Run npm run db:reset.'),
    h(
      'div',
      { class: 'actions' },
      h(
        'button',
        {
          class: 'button',
          disabled: state.busy || !state.selectedChildId || !state.selectedClassId,
          onclick: startBooking,
        },
        'Continue to payment',
      ),
    ),
    notice(state.bookingNotice),
  );
}

function renderPayment() {
  const booking = state.bookings.find((candidate) => candidate.id === state.activeBookingId);
  if (!booking) return null;
  const amount = money(booking.trialClass.priceCents, booking.trialClass.currency);

  const cards = state.directory.testCards.map((card) =>
    h(
      'label',
      { class: 'option' },
      h(
        'span',
        { class: 'option-main' },
        h('input', {
          type: 'radio',
          name: 'card',
          value: card.id,
          checked: state.selectedCard === card.id,
          disabled: state.busy,
          onchange: () => {
            state.selectedCard = card.id;
          },
        }),
        h('span', {}, h('div', { class: 'option-title' }, card.label), h('div', { class: 'option-meta' }, card.description)),
      ),
    ),
  );

  return h(
    'section',
    { class: 'card', id: 'payment' },
    h('h2', {}, 'Payment'),
    h('p', { class: 'lede' }, 'Mock card payment: the card is authorized first and only charged once the seat is secured.'),
    h(
      'dl',
      { class: 'summary' },
      h('dt', {}, 'Child'),
      h('dd', {}, booking.student.name),
      h('dt', {}, 'Class'),
      h('dd', {}, booking.trialClass.title),
      h('dt', {}, 'Starts'),
      h('dd', {}, when(booking.trialClass.startsAt)),
      h('dt', {}, 'Amount'),
      h('dd', {}, amount),
      h('dt', {}, 'Status'),
      h('dd', {}, bookingBadge(booking)),
    ),
    isPayable(booking)
      ? [
          h('div', { class: 'step-label' }, 'Test card'),
          h('div', { class: 'options' }, cards),
          h(
            'div',
            { class: 'actions' },
            h('button', { class: 'button', disabled: state.busy, onclick: pay }, state.busy ? 'Processing payment...' : `Pay ${amount}`),
          ),
        ]
      : h(
          'div',
          { class: 'actions' },
          h(
            'button',
            {
              class: 'button secondary',
              onclick: () => {
                state.activeBookingId = null;
                state.paymentNotice = null;
                render();
              },
            },
            'Book another class',
          ),
        ),
    notice(state.paymentNotice),
  );
}

function renderMyBookings() {
  const rows = state.bookings.map((booking) =>
    h(
      'tr',
      { class: booking.id === state.activeBookingId ? 'selected' : null },
      h('td', {}, booking.student.name),
      h('td', {}, booking.trialClass.title),
      h('td', {}, when(booking.trialClass.startsAt)),
      h('td', {}, bookingBadge(booking)),
      h('td', {}, paymentLabel(booking)),
      h(
        'td',
        {},
        isPayable(booking)
          ? h(
              'button',
              { class: 'button small secondary', disabled: state.busy, onclick: () => openPayment(booking.id) },
              booking.status === 'payment_failed' ? 'Retry payment' : 'Pay',
            )
          : null,
      ),
    ),
  );
  return h(
    'section',
    { class: 'card' },
    h('h2', {}, 'Your bookings'),
    rows.length
      ? h(
          'div',
          { class: 'table-wrap' },
          h(
            'table',
            {},
            h('thead', {}, h('tr', {}, ['Child', 'Class', 'Starts', 'Status', 'Payment', ''].map((label) => h('th', {}, label)))),
            h('tbody', {}, rows),
          ),
        )
      : h('p', { class: 'empty' }, 'No bookings yet.'),
  );
}

function renderStaff() {
  const rows = state.classes.map((trialClass) =>
    h(
      'tr',
      { class: trialClass.id === state.rosterClassId ? 'selected' : null },
      h('td', {}, h('span', { class: 'subject' }, trialClass.subject), trialClass.title),
      h('td', {}, when(trialClass.startsAt)),
      h('td', {}, trialClass.teacherName),
      h('td', { class: 'seats' }, `${trialClass.confirmedCount} of ${trialClass.capacity}`),
      h('td', {}, h('button', { class: 'button small secondary', onclick: () => showRoster(trialClass.id) }, 'View roster')),
    ),
  );
  const classesCard = h(
    'section',
    { class: 'card' },
    h('h2', {}, 'Upcoming trial classes'),
    h('p', { class: 'lede' }, 'Confirmed means paid and holding a seat. Pending or failed payments never count.'),
    h(
      'div',
      { class: 'table-wrap' },
      h(
        'table',
        {},
        h('thead', {}, h('tr', {}, ['Class', 'Starts', 'Teacher', 'Confirmed', ''].map((label) => h('th', {}, label)))),
        h('tbody', {}, rows),
      ),
    ),
  );
  return [classesCard, renderRoster()].filter(Boolean);
}

function renderRoster() {
  const roster = state.roster;
  if (!roster) return null;
  const { trialClass, confirmed, notOnRoster } = roster;
  return h(
    'section',
    { class: 'card' },
    h('h2', {}, `Roster: ${trialClass.title}`),
    h(
      'p',
      { class: 'lede' },
      `${when(trialClass.startsAt)} with ${trialClass.teacherName}. ${trialClass.confirmedCount} of ${trialClass.capacity} seats confirmed.`,
    ),
    confirmed.length
      ? h(
          'div',
          { class: 'table-wrap' },
          h(
            'table',
            {},
            h('thead', {}, h('tr', {}, ['#', 'Child', 'Level', 'Parent', 'Email', 'Confirmed'].map((label) => h('th', {}, label)))),
            h(
              'tbody',
              {},
              confirmed.map((entry, index) =>
                h(
                  'tr',
                  {},
                  h('td', {}, index + 1),
                  h('td', {}, entry.studentName),
                  h('td', {}, `P${entry.level}`),
                  h('td', {}, entry.parentName),
                  h('td', {}, entry.parentEmail),
                  h('td', {}, when(entry.confirmedAt)),
                ),
              ),
            ),
          ),
        )
      : h('p', { class: 'empty' }, 'Nobody is confirmed yet.'),
    h('div', { class: 'step-label' }, 'Not on the roster'),
    notOnRoster.length
      ? h(
          'div',
          { class: 'table-wrap' },
          h(
            'table',
            {},
            h('thead', {}, h('tr', {}, ['Child', 'Parent', 'Booking', 'Last payment'].map((label) => h('th', {}, label)))),
            h(
              'tbody',
              {},
              notOnRoster.map((entry) =>
                h(
                  'tr',
                  {},
                  h('td', {}, entry.studentName),
                  h('td', {}, entry.parentName),
                  h('td', {}, bookingBadge(entry)),
                  h(
                    'td',
                    {},
                    entry.lastPaymentStatus
                      ? `${PAYMENT_LABELS[entry.lastPaymentStatus] ?? entry.lastPaymentStatus}${entry.lastPaymentFailureCode ? ` (${entry.lastPaymentFailureCode.replaceAll('_', ' ')})` : ''}`
                      : 'None',
                  ),
                ),
              ),
            ),
          ),
        )
      : h('p', { class: 'empty' }, 'None.'),
  );
}

function renderUserSelect() {
  const option = (user, label) => h('option', { value: user.id, selected: user.id === state.userId }, label);
  userSelect.replaceChildren(
    h(
      'optgroup',
      { label: 'Parents' },
      state.directory.parents.map((parent) =>
        option(parent, `${parent.name} (${parent.children.map((child) => child.name.split(' ')[0]).join(', ')})`),
      ),
    ),
    h('optgroup', { label: 'Staff' }, state.directory.staff.map((user) => option(user, user.name))),
  );
}

// ------------------------------------------------------------------- boot

async function init() {
  const { ok, data } = await api('/api/demo/users');
  if (!ok) {
    app.replaceChildren(h('section', { class: 'card' }, 'Could not load the demo users. Is the server running?'));
    return;
  }
  state.directory = data;
  const known = new Set([...data.parents, ...data.staff].map((user) => user.id));
  const requested = new URLSearchParams(location.search).get('as') ?? sessionGet('userId');
  state.userId = known.has(requested) ? requested : data.parents[0]?.id;
  renderUserSelect();
  userSelect.addEventListener('change', () => signInAs(userSelect.value));
  await signInAs(state.userId);

  // Keep seat counts and statuses fresh so two windows can race for the last seat.
  let lastSnapshot = '';
  setInterval(async () => {
    await refreshAll();
    const snapshot = JSON.stringify([state.classes, state.bookings, state.roster]);
    if (snapshot !== lastSnapshot && !state.busy) render();
    lastSnapshot = snapshot;
  }, POLL_MS);
}

init();
