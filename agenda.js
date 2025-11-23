'use strict';

const cron = require('node-cron');
const { readUsersMap, autoFillZeros, schedules } = require('./utils');
const db = require("./firebase");

function startAgenda(bot) {
  const pendentes = new Map();

  // 🔥 CRON MINUTELY: envia PDFs de eventos concluídos
  cron.schedule("* * * * *", async () => {
    const eventos = await db.collection("events")
      .where("status", "==", "done")
      .get();

    for (const doc of eventos.docs) {
      const data = doc.data();
      const userId = data.userId;

      try {
        await bot.telegram.sendDocument(
          userId,
          { source: data.pdfPath }
        );

        await db.collection("events").doc(doc.id).update({
          status: "sent",
          sentAt: new Date().toISOString()
        });

        console.log(`PDF enviado para ${userId}`);
      } catch (err) {
        console.error("Erro ao enviar PDF via Telegram:", err);
      }
    }
  });

  // 🔥 CRON DAILY: envia mensagens diárias
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
              const previousAreas = schedules.filter(s => s.time < sched.time).map(s => s.area);
              for (const area of previousAreas) {
                await autoFillZeros(user, area);
              }

              // Monta teclado
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
              console.error('[agenda] erro ao processar schedule:', user, errSched);
            }
          }
        }
      } catch (err) {
        console.error('[agenda cron daily] erro geral:', err);
      }
    });
  });

  // 🔥 CRON MONTHLY / TEST: cria evento no Firestore
  async function criarEventosMensais() {
    try {
      const usersMap = await readUsersMap();
      const users = usersMap.users || [];

      for (const user of users) {
        await db.collection("events").add({
          type: "monthly-report",
          userId: user,
          year: new Date().getFullYear(),
          month: new Date().getMonth() + 1,
          status: "pending",
          createdAt: new Date().toISOString()
        });

        console.log(`Evento mensal criado para ${user}`);
      }
    } catch (err) {
      console.error("[agenda monthly] erro geral:", err);
    }
  }

  // 🔹 Rodar evento imediatamente para teste
  criarEventosMensais();

  // 🔹 Cron real para último dia do mês às 23:59 (UTC-3)
  cron.schedule('59 23 L * *', () => {
    criarEventosMensais();
  }, {
    timezone: "America/Sao_Paulo"
  });

  console.log('Agenda de jobs iniciada ✅');
  return pendentes;
}

module.exports = startAgenda;
