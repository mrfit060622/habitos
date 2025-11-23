'use strict';

const cron = require('node-cron');
const path = require('path');
const fs = require('fs/promises');
const { readUsersMap, autoFillZeros, schedules } = require('./utils');
const db = require("./firebase");

function startAgenda(bot) {

  // CRON: Enviar PDFs gerados (status: done)
  cron.schedule("* * * * *", async () => {
    try {
      const eventos = await db.collection("events")
        .where("status", "==", "done")
        .get();

      for (const doc of eventos.docs) {
        const data = doc.data();
        const userId = data.userId;

        await bot.telegram.sendDocument(
          userId,
          { source: data.Path }
        );

        await db.collection("events").doc(doc.id).update({
          status: "sent",
          sentAt: new Date().toISOString()
        });
      }
    } catch (err) {
      console.error("[cron-send-pdf] erro:", err);
    }
  });

  // CRON DAILY
  cron.schedule('* * * * *', () => {
    setImmediate(async () => {
      try {
        const now = new Date();
        const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
        const matches = schedules.filter(s => s.time === hhmm);
        if (!matches || matches.length === 0) return;

        const usersMap = await readUsersMap();
        const users = usersMap.users || [];

        for (const user of users) {
          for (const sched of matches) {
            try {
              // preencher zeros
              const previousAreas = schedules.filter(s => s.time < sched.time).map(s => s.area);
              for (const area of previousAreas) {
                await autoFillZeros(user, area);
              }

              let keyboard = [];
              if (sched.tipo === 'binario') {
                keyboard = [
                  [{ text: '✅ SIM', callback_data: `sim_${sched.area}` }, { text: '❌ NÃO', callback_data: `nao_${sched.area}` }]
                ];
              } else if (sched.tipo === 'escala') {
                keyboard = [
                  [0,1,2,3,4].map(n => ({ text: `${n}`, callback_data: `escala_${sched.area}_${n}` })),
                  [5,6,7,8,9,10].map(n => ({ text: `${n}`, callback_data: `escala_${sched.area}_${n}` }))
                ];
              }

              await bot.telegram.sendMessage(
                user,
                `⏰ Registro do dia - *${sched.area}*\n${sched.pergunta}\n${sched.descricao}`,
                {
                  parse_mode: 'Markdown',
                  reply_markup: { inline_keyboard: keyboard }
                }
              );

            } catch (errSched) {
              console.error('[agenda daily] erro para user', user, errSched);
            }
          }
        }
      } catch (err) {
        console.error('[agenda daily] erro geral:', err);
      }
    });
  });

  // CRON MONTHLY — cria evento no Firestore
  cron.schedule('59 23 * * *', () => {
    setImmediate(async () => {
      const now = new Date();
      const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
      if (now.getDate() !== lastDay) return;

      try {
        const usersMap = await readUsersMap();
        const users = usersMap.users || [];

        for (const user of users) {
          await db.collection("events").add({
            type: "monthly-report",
            userId: user,
            year: now.getFullYear(),
            month: now.getMonth() + 1,
            status: "pending",
            createdAt: new Date().toISOString()
          });
        }
      } catch (err) {
        console.error("[agenda monthly] erro geral:", err);
      }
    });
  });

  console.log('Agenda de jobs iniciada ✅');
}

module.exports = startAgenda;
