'use strict';

const { Telegraf, Markup } = require('telegraf');
const ExcelJS = require('exceljs');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const cron = require('node-cron');

// ---------------- CONFIG ----------------
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN; // Token do BotFather
const DATA_DIR = path.join(__dirname);
const USERS_FILE = path.join(DATA_DIR, 'users.json');

// Áreas e horários
const schedules = [
    { time: "11:07", area: "Espírito" },
    { time: "10:02", area: "Alma" },
    { time: "10:04", area: "Mente" },
    { time: "10:05", area: "Corpo" },
    { time: "10:06", area: "Relacionamentos" },
    { time: "10:07", area: "Trabalho/Recursos" },
    { time: "10:08", area: "Tempo/Lazer" }
];

// ---------------- UTIL ----------------
const sleep = ms => new Promise(res => setTimeout(res, ms));

// ---------------- USERS ----------------
async function readUsersMap() {
    try {
        const raw = await fsp.readFile(USERS_FILE, 'utf8');
        return JSON.parse(raw);
    } catch (_) {
        return {};
    }
}

async function writeUsersMap(map) {
    await fsp.writeFile(USERS_FILE, JSON.stringify(map, null, 2), 'utf8');
}

async function addUser(userId) {
    const map = await readUsersMap();
    map.users = map.users || [];
    if (!map.users.includes(userId)) map.users.push(userId);
    await writeUsersMap(map);
}

async function removeUser(userId) {
    const map = await readUsersMap();
    map.users = map.users || [];
    map.users = map.users.filter(u => u !== userId);
    await writeUsersMap(map);
}

// ---------------- PLANILHA ----------------
function sanitizeForFilename(s) {
    return String(s).replace(/[^a-zA-Z0-9-_]/g, '');
}

function getXLSXPath(userId) {
    const now = new Date();
    const fileName = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}_${sanitizeForFilename(userId)}.xlsx`;
    return path.join(DATA_DIR, fileName);
}

// Cria planilha mensal se não existir
async function createMonthlyWorkbook(userId) {
    const filePath = getXLSXPath(userId);
    if (fs.existsSync(filePath)) return filePath;

    const workbook = new ExcelJS.Workbook();
    const sheet1 = workbook.addWorksheet('Registros');
    sheet1.addRow(['Data', ...schedules.map(s => s.area)]);

    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    for (let d = 1; d <= daysInMonth; d++) {
        const dateStr = `${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
        sheet1.addRow([dateStr, ...Array(schedules.length).fill('')]);
    }

    const sheet2 = workbook.addWorksheet('Média Mensal');
    sheet2.addRow(['Área', 'Nota (0-10)']);
    schedules.forEach(s => sheet2.addRow([s.area, 0]));

    await workbook.xlsx.writeFile(filePath);
    return filePath;
}

// Atualiza a planilha
async function updateWorkbook(userId, area, value) {
    const filePath = await createMonthlyWorkbook(userId);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(filePath);

    const sheet1 = workbook.getWorksheet('Registros');
    const sheet2 = workbook.getWorksheet('Média Mensal');

    const today = new Date();
    const dateStr = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;

    let rowNumber = -1;
    sheet1.eachRow((row, rnum) => { if (rnum > 1 && row.getCell(1).value == dateStr) rowNumber = rnum; });
    const headerRow = sheet1.getRow(1);
    let colNumber = -1;
    headerRow.eachCell((cell, cnum) => { if (cell.value == area) colNumber = cnum; });

    if (!(rowNumber >= 1 && colNumber >= 1)) throw new Error('Linha ou coluna não encontrada');

    sheet1.getRow(rowNumber).getCell(colNumber).value = value;
    sheet1.getRow(rowNumber).commit();

    // recalcula média
    for (let i = 2; i <= sheet2.rowCount; i++) {
        if (sheet2.getRow(i).getCell(1).value == area) {
            let sum = 0, count = 0;
            sheet1.eachRow((r, rnum) => { if (rnum > 1) { const v = r.getCell(colNumber).value; if (v !== '' && v !== null) { sum += Number(v); count++; } } });
            sheet2.getRow(i).getCell(2).value = count ? Math.round((sum / count) * 10) : 0;
            sheet2.getRow(i).commit();
        }
    }

    await workbook.xlsx.writeFile(filePath);
    return { success: true, filePath };
}

// ---------------- BOT ----------------
const bot = new Telegraf(BOT_TOKEN);

bot.start(async (ctx) => {
    await addUser(ctx.from.id);
    await createMonthlyWorkbook(ctx.from.id);
    await ctx.reply('✅ Você foi inscrito para registro diário de hábitos.');
});

bot.command('stop', async (ctx) => {
    await removeUser(ctx.from.id);
    await ctx.reply('✅ Você foi removido do registro diário.');
});

// Responde sim/não via botões
bot.action(/^(sim|nao)$/, async (ctx) => {
    const value = ctx.match[0] === 'sim' ? 1 : 0;
    // area precisa ser armazenada no callback_data ou contexto
    // Aqui, só exemplo simples: área fixa
    await updateWorkbook(ctx.from.id, schedules[0].area, value);
    await ctx.answerCbQuery();
    await ctx.reply(`✅ Resposta registrada: ${ctx.match[0].toUpperCase()}`);
});

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
            await bot.telegram.sendMessage(user,
                `⏰ Registro do dia - *${sched.area}*\nResponda apenas com:`,
                Markup.inlineKeyboard([
                    Markup.button.callback('SIM', 'sim'),
                    Markup.button.callback('NÃO', 'nao')
                ]).extra()
            );
        }
    }
});

// ---------------- CRON MONTHLY ----------------
cron.schedule('59 23 * * *', async () => {
    const now = new Date();
    const lastDay = new Date(now.getFullYear(), now.getMonth()+1,0).getDate();
    if(now.getDate()!==lastDay) return;

    const usersMap = await readUsersMap();
    const users = usersMap.users || [];
    for(const user of users){
        const fp = getXLSXPath(user);
        if(fs.existsSync(fp)){
            await bot.telegram.sendDocument(user, { source: fp, filename: path.basename(fp) });
        }
    }
});

// ---------------- START ----------------
bot.launch();
console.log('Bot Telegram iniciado ✅');
