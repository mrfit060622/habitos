'use strict';

const cron = require('node-cron');
const { readUsersMap, schedules, autoFillZeros, getXLSXPath } = require('./utils');
const fs = require('fs');
const path = require('path');

function startAgenda(bot) {
    const pendentes = new Map(); // userId -> { area, timeoutId }

    // ---------------- CRON DAILY ----------------
    cron.schedule('* * * * *', async () => {
        const now = new Date();
        const hhmm = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
        const matches = schedules.filter(s => s.time === hhmm);
        if (matches.length === 0) return;

        const usersMap = await readUsersMap();
        const users = usersMap.users || [];

        for (const user of users) {
            for (const sched of matches) {
                // Preenche zeros das áreas anteriores que não responderam
                const previousAreas = schedules.filter(s => s.time < sched.time).map(s => s.area);
                for (const area of previousAreas) {
                    await autoFillZeros(user, area);
                }

                // Cria teclado
                let keyboard = [];
                if (sched.tipo === "binario") {
                    keyboard = [[
                        { text: "✅ SIM", callback_data: `sim_${sched.area}` },
                        { text: "❌ NÃO", callback_data: `nao_${sched.area}` }
                    ]];
                } else if (sched.tipo === "escala") {
                    keyboard = [
                        [0,1,2,3,4].map(n => ({ text: `${n}`, callback_data: `escala_${sched.area}_${n}` })),
                        [5,6,7,8,9,10].map(n => ({ text: `${n}`, callback_data: `escala_${sched.area}_${n}` }))
                    ];
                }

                // Envia mensagem
                await bot.telegram.sendMessage(user,
                    `⏰ Registro do dia - *${sched.area}*\n${sched.pergunta}\n${sched.descricao}`,
                    { parse_mode: "Markdown", reply_markup: { inline_keyboard: keyboard } }
                );

                // Marca pendente para auto-fill 0 em 1 minuto se não responder
                const timeoutId = setTimeout(async () => {
                    await autoFillZeros(user, sched.area);
                    pendentes.delete(`${user}_${sched.area}`);
                    await bot.telegram.sendMessage(user, `❌ Sem resposta para *${sched.area}*. Valor definido como 0.`, { parse_mode: 'Markdown' });
                }, 60 * 1000);

                pendentes.set(`${user}_${sched.area}`, timeoutId);
            }
        }
    });

    // ---------------- CRON MONTHLY ----------------
    cron.schedule('59 23 * * *', async () => {
        const now = new Date();
        const lastDay = new Date(now.getFullYear(), now.getMonth()+1, 0).getDate();
        if (now.getDate() !== lastDay) return;

        const usersMap = await readUsersMap();
        const users = usersMap.users || [];
        for (const user of users) {
            const fp = getXLSXPath(user);
            if (fs.existsSync(fp)) {
                await bot.telegram.sendDocument(user, { source: fp, filename: path.basename(fp) });
            }
        }
    });

    console.log("Agenda de jobs iniciada ✅");
    return pendentes;
}

module.exports = startAgenda;
