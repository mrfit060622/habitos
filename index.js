'use strict';
const { Telegraf, Markup } = require('telegraf');
require("dotenv").config();

const { addUser, removeUser, updateWorkbook, schedules } = require('./utils');
const startAgenda = require('./agenda');

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const bot = new Telegraf(BOT_TOKEN);

// ---------------- BOT ----------------
bot.start(async (ctx) => {
    await addUser(ctx.from.id);
    await ctx.reply('✅ Você foi inscrito para registro diário de hábitos.');
});

bot.command('stop', async (ctx) => {
    await removeUser(ctx.from.id);
    await ctx.reply('✅ Você foi removido do registro diário.');
});

// Inicia agenda e obtém pendentes
const pendentes = startAgenda(bot);

// ---------------- Resposta binária ----------------
bot.action(/^(sim|nao)_(.+)$/, async (ctx) => {
    const area = ctx.match[2];
    const value = ctx.match[1] === 'sim' ? 1 : 0;

    await updateWorkbook(ctx.from.id, area, value);

    // Cancela pendente se existir
    const key = `${ctx.from.id}_${area}`;
    if (pendentes.has(key)) {
        clearTimeout(pendentes.get(key));
        pendentes.delete(key);
    }

    await ctx.answerCbQuery();
    await ctx.reply(`✅ Resposta registrada para *${area}*: ${ctx.match[1].toUpperCase()}`, { parse_mode: "Markdown" });
});

// ---------------- Resposta escala (0–10) ----------------
bot.action(/^escala_(.+)_(\d+)$/, async (ctx) => {
    const area = ctx.match[1];
    const value = Number(ctx.match[2]);

    await updateWorkbook(ctx.from.id, area, value);

    // Cancela pendente se existir
    const key = `${ctx.from.id}_${area}`;
    if (pendentes.has(key)) {
        clearTimeout(pendentes.get(key));
        pendentes.delete(key);
    }

    await ctx.answerCbQuery();
    await ctx.reply(`📊 Nota registrada para *${area}*: ${value}`, { parse_mode: "Markdown" });
});

// ---------------- START ----------------
bot.launch();
console.log('Bot Telegram iniciado ✅');
