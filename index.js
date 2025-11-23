'use strict';

require('dotenv').config();
const path = require('path');
const fs = require('fs/promises');
const cron = require('node-cron');

const { Telegraf } = require('telegraf');
const express = require('express');

const { getListaCompras, adicionarItem, removerItem } = require('./listas');
const { addUser, removeUser, updateWorkbook, readUsersMap } = require('./utils');

let startAgenda;
try {
  startAgenda = require('./agenda');
} catch (err) {
  console.error('Erro ao carregar ./agenda:', err);
}

let db;
try {
  db = require('./firebase');
} catch (err) {
  console.error('Erro ao carregar ./firebase:', err);
}

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
if (!BOT_TOKEN) {
  console.error('FATAL: TELEGRAM_BOT_TOKEN não definido no .env');
  process.exit(1);
}

const REPORTS_DIR = process.env.REPORTS_DIR || path.join(process.cwd(), 'reports');

// -------------------
// Health endpoint para Fly.io
// -------------------
const server = express();
const PORT = process.env.PORT || 8080;

server.get('/', (req, res) => res.send('🤖 Bot rodando!'));
server.listen(PORT, '0.0.0.0', () => console.log(`Express rodando na porta ${PORT}`));

// -------------------
// Inicializa bot
// -------------------
const bot = new Telegraf(BOT_TOKEN);

// ---------------------------------------------------
// START AGENDA (agendamentos + envio de PDFs do Firestore)
// ---------------------------------------------------
if (startAgenda) {
  try {
    startAgenda(bot);
    console.log('Agenda iniciada com sucesso!');
  } catch (err) {
    console.error('Erro ao iniciar agenda:', err);
  }
}

// ---------------------------------------------------
// BOT HANDLERS
// ---------------------------------------------------
bot.start(async (ctx) => {
  try {
    await addUser(ctx.from.id);
    await ctx.reply('✅ Você foi inscrito para registro diário de hábitos.');
  } catch (err) {
    console.error('[bot.start] erro:', err);
    await ctx.reply('❌ Erro ao registrar. Tente novamente.');
  }
});

bot.command('stop', async (ctx) => {
  try {
    await removeUser(ctx.from.id);
    await ctx.reply('🛑 Você foi removido do registro diário.');
  } catch (err) {
    console.error('[bot.stop] erro:', err);
    await ctx.reply('❌ Erro ao remover.');
  }
});

// ---------------------------------------------------
// CALLBACK — resposta binária (sim/não)
// ---------------------------------------------------
bot.action(/^(sim|nao)_(.+)$/, async (ctx) => {
  try {
    const area = ctx.match[2];
    const value = ctx.match[1] === 'sim' ? 1 : 0;
    await updateWorkbook(ctx.from.id, area, value);

    await ctx.answerCbQuery();
    await ctx.reply(`✅ Resposta registrada para *${area}*: ${ctx.match[1].toUpperCase()}`, {
      parse_mode: 'Markdown'
    });
  } catch (err) {
    console.error('[binary] erro:', err);
    await ctx.reply('❌ Erro ao registrar.');
  }
});

// ---------------------------------------------------
// CALLBACK — escala 0–10
// ---------------------------------------------------
bot.action(/^escala_(.+)_(\d+)$/, async (ctx) => {
  try {
    const area = ctx.match[1];
    const value = Number(ctx.match[2]);

    await updateWorkbook(ctx.from.id, area, value);

    await ctx.answerCbQuery();
    await ctx.reply(`📊 Nota registrada em *${area}*: ${value}`, {
      parse_mode: 'Markdown'
    });
  } catch (err) {
    console.error('[escala] erro:', err);
    await ctx.reply('❌ Erro ao registrar.');
  }
});
// ---------------------------------------------------
// COMANDO DE TESTE: gerar relatório semanal/mensal
// ---------------------------------------------------
bot.command('gerar_relatorio', async (ctx) => {
  const args = ctx.message.text.split(' ').slice(1); // /gerar_relatorio semanal
  const tipo = args[0] || 'semanal'; // padrão semanal

  let params = {};
  const now = new Date();

  if (tipo === 'mensal') {
    params.start = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    params.end = now.toISOString();
  } else if (tipo === 'semanal') {
    const dayOfWeek = now.getDay(); // 0-domingo ... 6-sábado
    const start = new Date(now);
    start.setDate(now.getDate() - dayOfWeek); // início da semana
    params.start = start.toISOString();
    params.end = now.toISOString();
  } else {
    return ctx.reply('❌ Tipo inválido. Use "semanal" ou "mensal".');
  }

  try {
    await enviarRelatorios(tipo, params, () => `📊 Relatório ${tipo} de hábitos`);

    await ctx.reply(`✅ Relatórios ${tipo} enviados para todos os usuários.`);
  } catch (err) {
    console.error('[gerar_relatorio] erro no envio:', err);
    await ctx.reply('❌ Erro ao gerar/enviar relatórios.');
  }
});

// ----------------------
// Função de envio (seu código)
async function enviarRelatorios(tipo, params, legendaFn, bot) {
  try {
    const { users } = await readUsersMap();
    if (!Array.isArray(users) || users.length === 0) {
      console.log(`[cron-${tipo}] sem usuários cadastrados`);
      return;
    }

    for (const userId of users) {
      try {
        const pdfPath = await gerarRelatorio(userId, params);

        // Verifica se PDF existe
        try {
          await fs.access(pdfPath);
        } catch {
          console.warn(`[cron-${tipo}] PDF não encontrado para ${userId}: ${pdfPath}`);
          continue;
        }

        await bot.telegram.sendDocument(userId, { source: pdfPath }, {
          caption: legendaFn()
        });

        console.log(`[cron-${tipo}] PDF enviado para ${userId}`);

      } catch (err) {
        console.error(`[cron-${tipo}] falha usuário ${userId}:`, err.message || err);
      }
    }

  } catch (err) {
    console.error(`[cron-${tipo}] erro geral:`, err);
  }
}
// ---------------------------------------------------
// LISTA DE COMPRAS
// ---------------------------------------------------
bot.hears(/lista de compras/i, async (ctx) => {
  const lista = await getListaCompras();

  if (!Object.keys(lista).length) {
    return ctx.reply('📋 A lista de compras está vazia.');
  }

  let mensagem = '🛒 *Lista de Compras:*\n\n';

  for (const categoria in lista) {
    mensagem += `*${categoria.toUpperCase()}*\n`;
    lista[categoria].forEach((item, i) => {
      mensagem += `  ${i + 1}. ${item.item} — ${item.quantidade}\n`;
    });
    mensagem += '\n';
  }

  await ctx.reply(mensagem, { parse_mode: 'Markdown' });
});

bot.command('adicionar', async (ctx) => {
  const texto = ctx.message.text.split(' ').slice(1).join(' ');
  const [categoria, item, quantidade] = texto.split(',').map(s => s.trim());

  if (!item || !quantidade) {
    return ctx.reply('❌ Use: /adicionar Categoria, Item, Quantidade');
  }

  await adicionarItem(item, quantidade, categoria || 'outros');
  await ctx.reply(`✅ Adicionado em *${categoria || 'outros'}*: ${item} — ${quantidade}`, {
    parse_mode: 'Markdown'
  });
});

bot.command('remover', async (ctx) => {
  const texto = ctx.message.text.split(' ').slice(1).join(' ');
  const [categoria, nomeItem] = texto.split(',').map(s => s.trim());

  if (!categoria || !nomeItem) {
    return ctx.reply('❌ Use: /remover Categoria, Item');
  }

  await removerItem(nomeItem, categoria);
  await ctx.reply(`🗑️ Removido de *${categoria}*: ${nomeItem}`, {
    parse_mode: 'Markdown'
  });
});

// ---------------------------------------------------
// START BOT
// ---------------------------------------------------
(async () => {
  try {
    await bot.launch();
    console.log('🤖 Bot Telegram iniciado com sucesso!');

    process.once('SIGINT', () => bot.stop('SIGINT'));
    process.once('SIGTERM', () => bot.stop('SIGTERM'));
  } catch (err) {
    console.error('Erro ao iniciar bot:', err);
  }
})();

module.exports = { bot };
