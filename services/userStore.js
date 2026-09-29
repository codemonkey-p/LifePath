const fs = require('fs');
const path = require('path');
const low = require('lowdb');
const FileSync = require('lowdb/adapters/FileSync');
const { v4: uuidv4 } = require('uuid');
const config = require('../config');

fs.mkdirSync(config.paths.data, { recursive: true });

const adapter = new FileSync(config.paths.usersFile);
const db = low(adapter);
db.defaults({ users: [] }).write();

function emptyProfile() {
  return {
    preferredName: null,
    condition: null,
    conditionDetailsCaptured: false,
    doctorAppointmentTiming: null,
    doctorOrCaretakerName: null,
    emergencyContact: null,
    medications: [],
    family: [],
    shoppingPlaces: [],
    symptoms: [],
    wizardSessionsCompleted: 0
  };
}

function createUser({ name, email, passwordHash }) {
  const user = {
    id: uuidv4(),
    name,
    email: email.toLowerCase(),
    passwordHash,
    createdAt: new Date().toISOString(),
    firstLoginCompleted: false,
    profile: emptyProfile(),
    reminders: [],
    shoppingList: [],
    quizHistory: []
  };
  db.get('users').push(user).write();
  return user;
}

function findByEmail(email) {
  return db.get('users').find({ email: email.toLowerCase() }).value();
}

function findById(id) {
  return db.get('users').find({ id }).value();
}

function updateUser(id, updater) {
  const user = findById(id);
  if (!user) return null;
  updater(user);
  db.get('users').find({ id }).assign(user).write();
  return user;
}

function markFirstLoginCompleted(id) {
  return updateUser(id, (user) => {
    user.firstLoginCompleted = true;
  });
}

function resetUserData(id) {
  return updateUser(id, (user) => {
    user.profile = emptyProfile();
    user.reminders = [];
    user.shoppingList = [];
    user.quizHistory = [];
    user.firstLoginCompleted = false;
  });
}

module.exports = {
  createUser,
  findByEmail,
  findById,
  updateUser,
  markFirstLoginCompleted,
  resetUserData
};
