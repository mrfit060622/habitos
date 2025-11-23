'use strict';

const { Telegraf } = require('telegraf');
require('dotenv').config();

const cron = require('node-cron');
const axios = require('axios');
const fs = require('fs/promises');
const path = require('path');

const { getListaCompras, adicionarItem, removerItem } = require('./listas');

const {
  addUser,
  removeUser,
  updateWorkbook,
  readUsersMap
} = require('./utils');
const startAgenda = require('./agenda');

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const REPORT_SERVICE_URL = process.env.REPORT_SERVICE_URL || 'http://127.0.0.1:8000';
const REPORTS_DIR = process.env.REPORTS_DIR || path.join(process.cwd(), 'reports');

if (!BOT_TOKEN) {
  console.error('FATAL: TELEGRAM_BOT_TOKEN não definido em .env');
  process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);

// ---------------- START AGENDA ----------------
startAgenda(bot);

// ---------------- BOT HANDLERS ----------------
bot.start(async (ctx) => {
  try {
    await addUser(ctx.from.id);
    await ctx.reply('✅ Você foi inscrito para registro diário de hábitos.');
  } catch (err) {
    console.error('[bot.start] erro ao adicionar usuário:', err);
    await ctx.reply('❌ Erro ao inscrever. Tente novamente mais tarde.');
  }
});

bot.command('stop', async (ctx) => {
  try {
    await removeUser(ctx.from.id);
    await ctx.reply('✅ Você foi removido do registro diário.');
  } catch (err) {
    console.error('[bot.stop] erro ao remover usuário:', err);
    await ctx.reply('❌ Erro ao remover. Tente novamente mais tarde.');
  }
});

// binary response (sim/nao)
bot.action(/^(sim|nao)_(.+)$/, async (ctx) => {
  try {
    const area = ctx.match[2];
    const value = ctx.match[1] === 'sim' ? 1 : 0;
    await updateWorkbook(ctx.from.id, area, value);

    await ctx.answerCbQuery();
    await ctx.reply(`✅ Resposta registrada para *${area}*: ${ctx.match[1].toUpperCase()}`, { parse_mode: 'Markdown' });
  } catch (err) {
    console.error('[bot.action binary] erro:', err);
    await ctx.reply('❌ Erro registrando resposta. Tente novamente.');
  }
});

// escala 0-10
bot.action(/^escala_(.+)_(\d+)$/, async (ctx) => {
  try {
    const area = ctx.match[1];
    const value = Number(ctx.match[2]);
    if (Number.isNaN(value) || value < 0 || value > 10) {
      await ctx.answerCbQuery('Valor inválido');
      return;
    }

    await updateWorkbook(ctx.from.id, area, value);

    await ctx.answerCbQuery();
    await ctx.reply(`📊 Nota registrada para *${area}*: ${value}`, { parse_mode: 'Markdown' });
  } catch (err) {
    console.error('[bot.action escala] erro:', err);
    await ctx.reply('❌ Erro registrando nota. Tente novamente.');
  }
});

// ---------------- gerarRelatorio (chama FastAPI) ----------------
async function gerarRelatorio(userId, params) {
  try {
    const resp = await axios.post(`${REPORT_SERVICE_URL}/relatorio`, { userId, ...params }, { timeout: 120000 });
    const data = resp.data || {};
    if (!data.pdf) throw new Error('Resposta do serviço sem "pdf"');
    return data.pdf;
  } catch (err) {
    if (err.response?.data) {
      console.error('[gerarRelatorio] resposta do serviço:', err.response.data);
    }
    throw err;
  }
}

// ---------------- Função auxiliar para envio ----------------
async function enviarRelatorios(tipo, params, legendaFn) {
  try {
    const { users } = await readUsersMap();
    if (!Array.isArray(users) || users.length === 0) {
      console.log(`[cron-${tipo}] sem usuários cadastrados`);
      return;
    }

    for (const userId of users) {
      try {
        const pdfPath = await gerarRelatorio(userId, params);

        try {
          await fs.access(pdfPath);
        } catch {
          console.warn(`[cron-${tipo}] PDF não encontrado para ${userId}: ${pdfPath}`);
          continue;
        }

        await bot.telegram.sendDocument(userId, { source: pdfPath }, {
          caption: legendaFn()
        });

        console.log(`[cron-${tipo}] enviado para ${userId}`);
      } catch (err) {
        console.error(`[cron-${tipo}] falha usuário ${userId}:`, err.message || err);
      }
    }
  } catch (err) {
    console.error(`[cron-${tipo}] erro geral:`, err);
  }
}

// ---------------- CRON MENSAL ----------------
// roda todo dia às 23:59, mas só executa se for último dia do mês
cron.schedule('59 23 * * *', () => {
  setImmediate(async () => {
    console.log('[cron-monthly] checando envio mensal:', new Date().toISOString());

    const now = new Date();
    const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    if (now.getDate() !== lastDay) {
      console.log('[cron-monthly] hoje não é último dia do mês — nada a fazer');
      return;
    }

    await enviarRelatorios(
      'monthly',
      { year: now.getFullYear(), month: now.getMonth() + 1 },
      () => `📊 Relatório mensal: ${now.getMonth() + 1}/${now.getFullYear()}`
    );
  });
});

// ---------------- CRON SEMANAL ----------------
// roda todo sábado às 21:00
cron.schedule('0 21 * * 6', () => {
  setImmediate(async () => {
    console.log('[cron-weekly] checando envio semanal:', new Date().toISOString());

    const now = new Date();
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - now.getDay()); // domingo
    startOfWeek.setHours(0, 0, 0, 0);

    const endOfWeek = new Date(startOfWeek);
    endOfWeek.setDate(startOfWeek.getDate() + 6);
    endOfWeek.setHours(23, 59, 59, 999);

    await enviarRelatorios(
      'weekly',
      { startDate: startOfWeek.toISOString(), endDate: endOfWeek.toISOString() },
      () => `📆 Relatório semanal (${startOfWeek.toLocaleDateString()} - ${endOfWeek.toLocaleDateString()})`
    );
  });
});


// ---------------- LISTA DE COMPRAS ----------------
// Mostrar lista completa organizada por categoria
bot.hears(/lista de compras/i, async (ctx) => {
  const lista = await getListaCompras();
  if (!Object.keys(lista).length) {
    await ctx.reply('📋 A lista de compras está vazia.');
    return;
  }

  let mensagem = '🛒 *Lista de Compras:*\n\n';
  for (const categoria in lista) {
    mensagem += `*${categoria.toUpperCase()}*\n`;
    lista[categoria].forEach((item, index) => {
      mensagem += `  ${index + 1}. ${item.item} - ${item.quantidade}\n`;
    });
    mensagem += '\n';
  }

  await ctx.reply(mensagem, { parse_mode: 'Markdown' });
});

// Adicionar item (com categoria opcional)
bot.command('adicionar', async (ctx) => {
  const texto = ctx.message.text.split(' ').slice(1).join(' ');
  const [categoria, item, quantidade] = texto.split(',').map(s => s.trim());

  if (!item || !quantidade) {
    await ctx.reply('❌ Use: /adicionar Categoria, Nome do Item, Quantidade (categoria opcional)');
    return;
  }

  await adicionarItem(item, quantidade, categoria || 'outros');
  await ctx.reply(`✅ Item adicionado em *${categoria || 'outros'}*: ${item} - ${quantidade}`, { parse_mode: 'Markdown' });
});

// Remover item (necessário informar categoria)
bot.command('remover', async (ctx) => {
  const texto = ctx.message.text.split(' ').slice(1).join(' ');
  const [categoria, nomeItem] = texto.split(',').map(s => s.trim());

  if (!categoria || !nomeItem) {
    await ctx.reply('❌ Use: /remover Categoria, Nome do Item');
    return;
  }

  await removerItem(nomeItem, categoria);
  await ctx.reply(`✅ Item removido de *${categoria}*: ${nomeItem}`, { parse_mode: 'Markdown' });
});
// ---------------- FIM LISTA DE COMPRAS ----------------

// ---------------- START BOT ----------------
(async () => {
  try {
    await bot.launch();
    console.log('Bot Telegram iniciado ✅');

    process.once('SIGINT', () => bot.stop('SIGINT'));
    process.once('SIGTERM', () => bot.stop('SIGTERM'));
  } catch (err) {
    console.error('Erro ao iniciar bot:', err);
    process.exit(1);
  }
})();

module.exports = { bot };
