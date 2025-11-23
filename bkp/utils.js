require('dotenv').config();
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(process.cwd(), 'habitos.db');

let dbPromise = null;

async function initDb() {
  if (!dbPromise) {
    dbPromise = open({ filename: DB_PATH, driver: sqlite3.Database });
  }
  const db = await dbPromise;

  // criar tabelas se não existirem
  await db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      userId INTEGER PRIMARY KEY
    );
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      userId INTEGER,
      date TEXT,
      area TEXT,
      value INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(userId, date, area)
    );
  `);

  return db;
}

async function readUsersMap() {
  const db = await initDb();
  const rows = await db.all(`SELECT userId FROM users`);
  return { users: rows.map(r => r.userId) };
}

async function addUser(userId) {
  const db = await initDb();
  await db.run(`INSERT OR IGNORE INTO users(userId) VALUES(?)`, userId);
}

async function removeUser(userId) {
  const db = await initDb();
  await db.run(`DELETE FROM users WHERE userId = ?`, userId);
}

function sanitizeForFilename(s) {
  return String(s).replace(/[^a-zA-Z0-9-_]/g, '');
}

async function updateWorkbook(userId, area, value) {
  const db = await initDb();
  const today = new Date();
  const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

  await db.run(
    `INSERT INTO records (userId, date, area, value) VALUES (?, ?, ?, ?)
     ON CONFLICT(userId, date, area) DO UPDATE SET value=excluded.value`,
    [userId, dateStr, area, value]
  );
}

async function autoFillZeros(userId, area) {
  const db = await initDb();
  const today = new Date();
  const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const existing = await db.get(`SELECT 1 FROM records WHERE userId = ? AND date = ? AND area = ?`, [userId, dateStr, area]);
  if (!existing) {
    await updateWorkbook(userId, area, 0);
  }
}

module.exports = {
  schedules: require('./utils_schedules_placeholder') || [],
  readUsersMap,
  addUser,
  removeUser,
  updateWorkbook,
  autoFillZeros,
  sanitizeForFilename,
  DB_PATH
};
