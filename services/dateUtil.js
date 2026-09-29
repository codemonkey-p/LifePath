const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// Birthdays are stored as "YYYY-MM-DD", or "MM-DD" when the year isn't known.
// Parsed by hand (not new Date) so a birthday never shifts a day because of time zones.
function parseMonthDay(value) {
  if (!value || typeof value !== 'string') return null;
  const text = value.trim();
  let match = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  let year = null;
  let month;
  let day;
  if (match) {
    year = parseInt(match[1], 10);
    month = parseInt(match[2], 10);
    day = parseInt(match[3], 10);
  } else {
    match = text.match(/^-{0,2}(\d{1,2})-(\d{1,2})$/);
    if (!match) return null;
    month = parseInt(match[1], 10);
    day = parseInt(match[2], 10);
  }
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { year, month, day };
}

function normalizeBirthday(value) {
  const parts = parseMonthDay(value);
  if (!parts) return null;
  const mm = String(parts.month).padStart(2, '0');
  const dd = String(parts.day).padStart(2, '0');
  return parts.year ? `${parts.year}-${mm}-${dd}` : `${mm}-${dd}`;
}

function formatMonthDay(value) {
  const parts = parseMonthDay(value);
  if (!parts) return '';
  return `${MONTHS[parts.month - 1]} ${parts.day}`;
}

module.exports = { parseMonthDay, normalizeBirthday, formatMonthDay };
