'use strict';

require('dotenv').config();
const db = require('./firebase');
const path = require('path');
const fs = require('fs/promises');

// ----------------- Usuários -----------------
async function addUser(userId) {
  try {
    await db.collection('users').doc(String(userId)).set({
      createdAt: new Date().toISOString()
    });
    console.log(`Usuário ${userId} adicionado no Firestore ✅`);
  } catch (err) {
    console.error('Erro ao adicionar usuário no Firestore:', err);
  }
}

async function removeUser(userId) {
  try {
    await db.collection('users').doc(String(userId)).delete();
    console.log(`Usuário ${userId} removido do Firestore ✅`);
  } catch (err) {
    console.error('Erro ao remover usuário do Firestore:', err);
  }
}

async function readUsersMap() {
  try {
    const snapshot = await db.collection('users').get();
    const users = snapshot.docs.map(doc => doc.id);
    return { users };
  } catch (err) {
    console.error('Erro ao ler usuários do Firestore:', err);
    return { users: [] };
  }
}

// ----------------- Helpers -----------------
function sanitizeForFilename(s) {
  return String(s).replace(/[^a-zA-Z0-9-_]/g, '');
}

async function updateWorkbook(userId, area, value) {
  try {
    const today = new Date();
    const dateStr = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;

    const docRef = db.collection('records')
                     .doc(`${userId}_${dateStr}_${area}`);

    await docRef.set({
      userId,
      date: dateStr,
      area,
      value,
      updatedAt: new Date().toISOString()
    }, { merge: true });

  } catch (err) {
    console.error(`[updateWorkbook] erro para ${userId} - ${area}:`, err);
  }
}

async function autoFillZeros(userId, area) {
  const today = new Date();
  const dateStr = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;

  const docRef = db.collection('records').doc(`${userId}_${dateStr}_${area}`);
  const doc = await docRef.get();
  if (!doc.exists) {
    await updateWorkbook(userId, area, 0);
  }
}

module.exports = {
  addUser,
  removeUser,
  readUsersMap,
  updateWorkbook,
  autoFillZeros,
  sanitizeForFilename
};
