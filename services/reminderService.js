const { v4: uuidv4 } = require('uuid');
const userStore = require('./userStore');
const { parseMonthDay, formatMonthDay } = require('./dateUtil');

function addReminder(userId, { text, type = 'other', time = null, date = null, recurring = 'once', memberId = null }) {
  return userStore.updateUser(userId, (user) => {
    user.reminders.push({
      id: uuidv4(),
      text,
      type,
      time,
      date,
      recurring,
      memberId,
      createdAt: new Date().toISOString()
    });
  });
}

function listReminders(userId) {
  const user = userStore.findById(userId);
  return user ? user.reminders : [];
}

function isDueToday(reminder, now = new Date()) {
  if (reminder.recurring === 'daily') return true;
  if (reminder.recurring === 'yearly' && reminder.date) {
    const parts = parseMonthDay(reminder.date);
    return !!parts && parts.month === now.getMonth() + 1 && parts.day === now.getDate();
  }
  if (reminder.date) {
    const parts = parseMonthDay(reminder.date);
    if (parts && parts.year) {
      return parts.year === now.getFullYear() && parts.month === now.getMonth() + 1 && parts.day === now.getDate();
    }
  }
  return false;
}

function getDueNow(userId, now = new Date()) {
  return listReminders(userId).filter((r) => isDueToday(r, now));
}

// Every family member with a birthday gets exactly one yearly reminder, kept in step with
// the member's details (so correcting a birthday later updates the reminder, not duplicates it).
function syncBirthdayReminders(userId) {
  return userStore.updateUser(userId, (user) => {
    for (const member of user.profile.family || []) {
      if (!member.birthday) continue;
      const text = `Wish ${member.name}${member.relation ? ` (your ${member.relation})` : ''} a happy birthday`;
      // A birthday reminder made before this person was saved (no memberId, e.g. "Sam's birthday")
      // is now covered by the member's own reminder, so drop it rather than remind twice.
      const memberName = member.name.trim().toLowerCase();
      user.reminders = user.reminders.filter(
        (r) => !(r.type === 'birthday' && !r.memberId && memberName && r.text.toLowerCase().includes(memberName))
      );
      const existing = user.reminders.find((r) => r.type === 'birthday' && r.memberId === member.id);
      if (existing) {
        existing.text = text;
        existing.date = member.birthday;
      } else {
        user.reminders.push({
          id: uuidv4(),
          text,
          type: 'birthday',
          time: null,
          date: member.birthday,
          recurring: 'yearly',
          memberId: member.id,
          createdAt: new Date().toISOString()
        });
      }
    }
  });
}

module.exports = { addReminder, listReminders, isDueToday, getDueNow, syncBirthdayReminders, formatMonthDay };
