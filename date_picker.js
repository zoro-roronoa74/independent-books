'use strict';

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

function daysInMonth(year, month) { return new Date(year, month, 0).getDate(); }
function stepMonth(value, delta) {
  const date = new Date(value.year, value.month - 1 + Number(delta), 1);
  return {year: date.getFullYear(), month: date.getMonth() + 1};
}
function isoDate(year, month, day) {
  if (day < 1 || day > daysInMonth(year, month)) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}
function parseDate(value) {
  const source = String(value || '').trim();
  let match = source.match(/^(\d{4})[-/]?(\d{2})[-/]?(\d{2})$/);
  if (match) return {year: Number(match[1]), month: Number(match[2]), day: Number(match[3])};
  match = source.match(/^(\d{1,2})[-/]([A-Za-z]{3,9})[-/](\d{2}|\d{4})$/);
  if (match) {
    const month = MONTHS.findIndex(name => name.toLowerCase().startsWith(match[2].slice(0, 3).toLowerCase())) + 1;
    let year = Number(match[3]); if (year < 100) year += 2000;
    return {year, month, day: Number(match[1])};
  }
  const now = new Date();
  return {year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate()};
}
function calendarDays(year, month) {
  const firstDay = new Date(year, month - 1, 1).getDay();
  return [...Array(firstDay).fill(null), ...Array.from({length: daysInMonth(year, month)}, (_, index) => index + 1)];
}

function createDatePicker() {
  if (typeof document === 'undefined') return {open() {}, close() {}};
  let active = null;
  let view = parseDate(new Date().toISOString().slice(0, 10));
  const popup = document.createElement('div');
  popup.className = 'date-picker-popup';
  popup.hidden = true;
  popup.innerHTML = '<div class="date-picker-head"><button type="button" data-date-prev aria-label="Previous month">‹</button><strong data-date-title></strong><button type="button" data-date-next aria-label="Next month">›</button></div><div class="date-picker-week"><span>Su</span><span>Mo</span><span>Tu</span><span>We</span><span>Th</span><span>Fr</span><span>Sa</span></div><div class="date-picker-grid" role="grid"></div>';
  document.body.appendChild(popup);
  const title = popup.querySelector('[data-date-title]');
  const grid = popup.querySelector('.date-picker-grid');
  const render = () => {
    title.textContent = `${MONTHS[view.month - 1]} ${view.year}`;
    const selected = parseDate(active?.value);
    grid.innerHTML = calendarDays(view.year, view.month).map(day => {
      if (!day) return '<span class="date-picker-empty"></span>';
      const value = isoDate(view.year, view.month, day);
      const current = selected.year === view.year && selected.month === view.month && selected.day === day;
      return `<button type="button" role="gridcell" data-date-select="${value}" class="${current ? 'selected' : ''}">${day}</button>`;
    }).join('');
  };
  const close = () => { popup.hidden = true; active?.focus(); active = null; };
  const open = control => {
    active = control;
    const selected = parseDate(control.value);
    view = {year: selected.year, month: selected.month};
    render();
    const rect = control.getBoundingClientRect();
    popup.style.left = `${Math.max(4, Math.min(window.innerWidth - 238, rect.left))}px`;
    popup.style.top = `${Math.min(window.innerHeight - 260, rect.bottom + 4)}px`;
    popup.hidden = false;
    popup.querySelector('[data-date-select].selected')?.focus();
  };
  popup.addEventListener('click', event => {
    const button = event.target.closest('[data-date-select]');
    if (button && active) {
      active.value = button.dataset.dateSelect;
      active.dispatchEvent(new Event('input', {bubbles: true}));
      active.dispatchEvent(new Event('change', {bubbles: true}));
      close();
    } else if (event.target.closest('[data-date-prev]')) { view = stepMonth(view, -1); render(); }
    else if (event.target.closest('[data-date-next]')) { view = stepMonth(view, 1); render(); }
  });
  document.addEventListener('input', event => {
    const control = event.target.closest?.('.tally-date,[name="date"]');
    if (control && active === control && !popup.hidden) {
      const selected = parseDate(control.value);
      view = {year: selected.year, month: selected.month};
      render();
    }
  }, true);
  document.addEventListener('click', event => {
    const control = event.target.closest?.('.tally-date,[name="date"]');
    if (control) { event.preventDefault(); open(control); }
    else if (!popup.hidden && !popup.contains(event.target)) close();
  }, true);
  document.addEventListener('keydown', event => {
    if (popup.hidden) return;
    if (event.key === 'Escape') { event.preventDefault(); close(); }
  }, true);
  return {open, close, popup};
}

const datePickerApi = {calendarDays, createDatePicker, daysInMonth, isoDate, parseDate, stepMonth};
if (typeof module !== 'undefined' && module.exports) module.exports = datePickerApi;
if (typeof window !== 'undefined') { window.IndependentDatePicker = datePickerApi; createDatePicker(); }
