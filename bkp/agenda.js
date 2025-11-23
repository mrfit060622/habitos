'use strict';

const cron = require('node-cron');
const axios = require('axios');
const path = require('path');
const fs = require('fs/promises');
const { readUsersMap, autoFillZeros, schedules } = require('./utils');

const REPORT_SERVICE_URL = process.env.REPORT_SERVICE_URL || 'http://127.0.0.1:8000';
const HTTP_TIMEOUT_MS = 60 * 1000;

function startAgenda(bot) {
  const pendentes = new Map();

  // CRON DAILY: checa cada minuto se há perguntas programadas
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
              // Preenche zeros de áreas anteriores que ficaram pendentes
              const previousAreas = schedules.filter(s => s.time < sched.time).map(s => s.area);
              for (const area of previousAreas) {
                // note: atualizar por usuário pode ser pesado; ok aqui se poucos usuários
                await autoFillZeros(user, area);
              }

              // construir inline keyboard
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

              // envia
              await bot.telegram.sendMessage(user,
                `⏰ Registro do dia - *${sched.area}*\n${sched.pergunta}\n${sched.descricao}`,
                {
                  parse_mode: 'Markdown',
                  reply_markup: { inline_keyboard: keyboard }
                }
              );

              // define pendente para auto-fill em 1 minuto
              
            } catch (errSched) {
              console.error('[agenda] erro ao processar schedule para user', user, errSched);
            }
          }
        }
      } catch (err) {
        console.error('[agenda cron daily] erro geral:', err);
      }
    });
  });

  // CRON MONTHLY: tenta gerar e enviar relatórios no último dia às 23:59
  cron.schedule('59 23 * * *', () => {
    setImmediate(async () => {
      const now = new Date();
      const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
      if (now.getDate() !== lastDay) return;

      try {
        const usersMap = await readUsersMap();
        const users = usersMap.users || [];

        for (const user of users) {
          try {
            const resp = await axios.post(`${REPORT_SERVICE_URL}/relatorio`, {
              userId: user,
              year: now.getFullYear(),
              month: now.getMonth() + 1
            }, { timeout: HTTP_TIMEOUT_MS });

            const data = resp.data || {};

            // envia PDF se existir no response
            if (data.pdf) {
              try {
                await fs.access(data.pdf); // não-bloqueante
                await bot.telegram.sendDocument(user, { source: data.pdf, filename: path.basename(data.pdf) });
              } catch (e) {
                console.warn('[agenda monthly] arquivo PDF não encontrado ou não acessível:', data.pdf, e.message);
              }
            }

            // envia xlsx se retornado (opcional)
            if (data.xlsx) {
              try {
                await fs.access(data.xlsx);
                await bot.telegram.sendDocument(user, { source: data.xlsx, filename: path.basename(data.xlsx) });
              } catch (e) {
                console.warn('[agenda monthly] arquivo XLSX não encontrado ou não acessível:', data.xlsx, e.message);
              }
            }
          } catch (errUser) {
            console.error('[agenda monthly] falha para usuário', user, errUser.message || errUser);
          }
        }
      } catch (err) {
        console.error('[agenda monthly] erro geral:', err);
      }
    });
  });

  console.log('Agenda de jobs iniciada ✅');
  return pendentes;
}

module.exports = startAgenda;
