// index.js
'use strict';

/*
  Versão final revisada:
  - múltiplos clients via CLIENT_IDS env var (ex: CLIENT_IDS=habitos,user2)
  - LocalAuth per clientId (sessões separadas)
  - users.json guarda inscritos por clientId: { clientId: [userId,...], ... }
  - planilhas por usuário: YYYY-MM_<userId>.xlsx
  - escrita atômica (tmp -> rename) com retry/backoff
  - fila por arquivo (serialize operations) para evitar concorrência
  - schedule diário (envio perguntas) + schedule mensal (envio planilha último dia)
  - comandos: START / STOP / TEST WRITE / SHOW FILE
  - aceita respostas SIM / NÃO (e fallback "Area SIM")
*/

const qrcode = require('qrcode-terminal');
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const ExcelJS = require('exceljs');
const fs = require('fs');
const fsp = fs.promises;
const cron = require('node-cron');
const path = require('path');

// CONFIG -------------------------------------------------------
const DATA_DIR = path.join(__dirname);
const USERS_FILE = path.join(DATA_DIR, 'users.json'); // mapa clientId -> [userIds]
const CLIENT_IDS = (process.env.CLIENT_IDS || 'habitos').split(',').map(s => s.trim()).filter(Boolean);
// Ex.: CLIENT_IDS=habitos,user2,user3
const MAX_WRITE_RETRIES = 6;
const WRITE_RETRY_MS = 300; // backoff base (ms)

// SCHEDULES (ajuste horários conforme necessário)
const schedules = [
    { time: "10:48", area: "Espírito" },
    { time: "10:02", area: "Alma" },
    { time: "10:04", area: "Mente" },
    { time: "10:05", area: "Corpo" },
    { time: "10:06", area: "Relacionamentos" },
    { time: "10:07", area: "Trabalho/Recursos" },
    { time: "10:08", area: "Tempo/Lazer" }
];

// UTIL
const sleep = ms => new Promise(res => setTimeout(res, ms));

// ---------------- users.json helpers (mapa por clientId) ----------------
async function readUsersMap() {
    try {
        const raw = await fsp.readFile(USERS_FILE, 'utf8');
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') return parsed;
    } catch (err) {
        // ignore
    }
    return {};
}
async function writeUsersMap(map) {
    const tmp = USERS_FILE + '.tmp';
    await fsp.writeFile(tmp, JSON.stringify(map, null, 2), 'utf8');
    await fsp.rename(tmp, USERS_FILE);
}
async function readUsers(clientId) {
    const map = await readUsersMap();
    return map[clientId] || [];
}
async function addUser(clientId, userId) {
    const map = await readUsersMap();
    map[clientId] = map[clientId] || [];
    if (!map[clientId].includes(userId)) {
        map[clientId].push(userId);
        await writeUsersMap(map);
        console.log(`[users] adicionado ${userId} em ${clientId}`);
    }
    return map[clientId];
}

async function removeUser(clientId, userId) {
    const map = await readUsersMap();
    map[clientId] = map[clientId] || [];
    map[clientId] = map[clientId].filter(u => u !== userId);
    await writeUsersMap(map);
    console.log(`[users] removido ${userId} de ${clientId}`);
    return map[clientId];
}

// ---------------- path planilha por usuário ----------------
function sanitizeForFilename(s) {
    return String(s).replace(/[^a-zA-Z0-9-_]/g, '');
}
function getXLSXPath(userId) {
    const now = new Date();
    const fileName = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}_${sanitizeForFilename(userId)}.xlsx`;
    return path.join(DATA_DIR, fileName);
}

// ---------------- file queue (serialize operations por arquivo) ----------------
const fileQueues = new Map();
function enqueueFileOp(filePath, fn) {
    const prev = fileQueues.get(filePath) || Promise.resolve();
    const next = prev.then(() => fn()).catch(err => {
        console.error(`[enqueueFileOp] erro em ${filePath}:`, err);
    });
    fileQueues.set(filePath, next.finally(() => {
        if (fileQueues.get(filePath) === next) fileQueues.delete(filePath);
    }));
    return next;
}

// ---------------- atomic write com retry ----------------
async function writeWorkbookAtomic(workbook, filePath) {
    const tmpPath = filePath + '.tmp';
    for (let attempt = 1; attempt <= MAX_WRITE_RETRIES; attempt++) {
        try {
            await workbook.xlsx.writeFile(tmpPath);
            await fsp.rename(tmpPath, filePath);
            return;
        } catch (err) {
            try { await fsp.unlink(tmpPath).catch(()=>{}); } catch(_) {}
            if (attempt === MAX_WRITE_RETRIES) {
                console.error(`[writeWorkbookAtomic] falha após ${attempt} tentativas:`, err);
                throw err;
            }
            console.warn(`[writeWorkbookAtomic] tentativa ${attempt} falhou (${err.code || err.message}), retry em ${WRITE_RETRY_MS * attempt}ms`);
            await sleep(WRITE_RETRY_MS * attempt);
        }
    }
}

// ---------------- create monthly workbook (serialized por file) ----------------
async function createMonthlyWorkbook(userId) {
    const filePath = getXLSXPath(userId);
    return enqueueFileOp(filePath, async () => {
        if (fs.existsSync(filePath)) {
            // já existe
            return filePath;
        }
        console.log(`[createMonthlyWorkbook] criando: ${filePath}`);
        const workbook = new ExcelJS.Workbook();

        // Aba 1: Registros
        const sheet1 = workbook.addWorksheet('Registros');
        sheet1.addRow([
            'Data',
            'Espírito',
            'Alma',
            'Mente',
            'Corpo',
            'Relacionamentos',
            'Trabalho/Recursos',
            'Tempo/Lazer'
        ]);

        // Preencher todos os dias do mês atual
        const now = new Date();
        const year = now.getFullYear();
        const month = now.getMonth();
        const daysInMonth = new Date(year, month + 1, 0).getDate();
        for (let d = 1; d <= daysInMonth; d++) {
            const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
            sheet1.addRow([dateStr,'','','','','','','']);
        }

        // Aba 2: Média Mensal
        const sheet2 = workbook.addWorksheet('Média Mensal');
        sheet2.addRow(['Área','Nota (0-10)']);
        schedules.forEach(s => sheet2.addRow([s.area, 0]));

        await writeWorkbookAtomic(workbook, filePath);
        console.log(`[createMonthlyWorkbook] criado e salvo: ${filePath}`);
        return filePath;
    });
}

// ---------------- update workbook (serialized) ----------------
async function updateWorkbook(userId, area, value) {
    const filePath = await createMonthlyWorkbook(userId); // garante criação
    return enqueueFileOp(filePath, async () => {
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.readFile(filePath);
        const sheet1 = workbook.getWorksheet('Registros');
        const sheet2 = workbook.getWorksheet('Média Mensal');

        // encontrar linha do dia
        const today = new Date();
        const dateStr = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
        let rowNumber = -1;
        sheet1.eachRow((row, rowNum) => {
            if (rowNum === 1) return;
            const cell = row.getCell(1).value;
            if (cell && cell.toString() === dateStr) rowNumber = rowNum;
        });

        // encontrar coluna da area
        const headerRow = sheet1.getRow(1);
        let colNumber = -1;
        headerRow.eachCell((cell, colNum) => {
            if (cell.value && cell.value.toString() === area) colNumber = colNum;
        });

        console.log(`[updateWorkbook] user=${userId} date=${dateStr} row=${rowNumber} col=${colNumber} area=${area} value=${value}`);

        if (!(rowNumber >= 1 && colNumber >= 1)) {
            // tenta recriar planilha e reprocessar (por segurança)
            console.warn(`[updateWorkbook] linha/col não encontrada, recriando planilha e tentando novamente.`);
            await createMonthlyWorkbook(userId);
            await workbook.xlsx.readFile(filePath);
            const sheet1b = workbook.getWorksheet('Registros');
            let rowNumber2 = -1;
            sheet1b.eachRow((row, rowNum) => {
                if (rowNum === 1) return;
                const cell = row.getCell(1).value;
                if (cell && cell.toString() === dateStr) rowNumber2 = rowNum;
            });
            let colNumber2 = -1;
            const headerRow2 = sheet1b.getRow(1);
            headerRow2.eachCell((cell, colNum) => {
                if (cell.value && cell.value.toString() === area) colNumber2 = colNum;
            });
            if (rowNumber2 >= 1 && colNumber2 >= 1) {
                rowNumber = rowNumber2;
                colNumber = colNumber2;
            } else {
                throw new Error('Linha ou coluna não encontrada mesmo após recriar planilha');
            }
        }

        // grava valor
        const row = sheet1.getRow(rowNumber);
        row.getCell(colNumber).value = value;
        row.commit();
        console.log(`[updateWorkbook] gravado: ${userId} ${dateStr} ${area}=${value}`);

        // recalcula média
        for (let i = 2; i <= sheet2.rowCount; i++) {
            const areaName = sheet2.getRow(i).getCell(1).value;
            if (areaName && areaName.toString() === area) {
                let sum = 0, count = 0;
                sheet1.eachRow((r, rnum) => {
                    if (rnum === 1) return;
                    const v = r.getCell(colNumber).value;
                    if (v !== null && v !== undefined && v !== '') {
                        sum += Number(v);
                        count++;
                    }
                });
                const nota = count ? Math.round((sum / count) * 10) : 0;
                sheet2.getRow(i).getCell(2).value = nota;
                sheet2.getRow(i).commit();
                console.log(`[updateWorkbook] média atualizada: ${area} = ${nota}`);
            }
        }

        // salva
        await writeWorkbookAtomic(workbook, filePath);
        const stat = await fsp.stat(filePath);
        console.log(`[updateWorkbook] salvo com sucesso (${stat.size} bytes): ${filePath}`);
        return { success: true, filePath };
    });
}

// ---------------- send monthly report (uses MessageMedia) ----------------
async function scheduleMonthlySendPerClient(clientInstance, clientId) {
    // roda todo dia às 23:59 e verifica se é último dia do mês
    cron.schedule('59 23 * * *', async () => {
        try {
            const now = new Date();
            const lastDay = new Date(now.getFullYear(), now.getMonth()+1, 0).getDate();
            if (now.getDate() !== lastDay) return;
            const users = await readUsers(clientId);
            for (const user of users) {
                const fp = getXLSXPath(user);
                if (fs.existsSync(fp)) {
                    try {
                        const media = MessageMedia.fromFilePath(fp);
                        await clientInstance.sendMessage(user, media, { caption: `📊 Relatório mensal: ${now.getMonth()+1}/${now.getFullYear()}` });
                        console.log(`[monthly-send] enviado ${fp} -> ${user} via ${clientId}`);
                    } catch (err) {
                        console.error(`[monthly-send] falha ao enviar ${fp} -> ${user}:`, err);
                    }
                }
            }
        } catch (err) {
            console.error('[monthly-send] erro:', err);
        }
    });
}

// ---------------- daily questions scheduler ----------------
function scheduleDailyQuestions(clientInstance, clientId) {
    // roda a cada minuto e compara HH:MM
    cron.schedule('* * * * *', async () => {
        const now = new Date();
        const hh = String(now.getHours()).padStart(2,'0');
        const mm = String(now.getMinutes()).padStart(2,'0');
        const hhmm = `${hh}:${mm}`;

        // verifica se existe agendamento para esse horário
        const matches = schedules.filter(s => s.time === hhmm);
        if (matches.length === 0) return;

        const users = await readUsers(clientId);
        for (const user of users) {
            for (const sched of matches) {
                const text = `⏰ Registro do dia - *${sched.area}*\n\n${sched.area} — Responda apenas com: *SIM* ou *NÃO*`;
                try {
                    await clientInstance.sendMessage(user, text);
                    console.log(`[daily-send] enviado lembrete (${sched.area}) -> ${user} via ${clientId} (${hhmm})`);
                } catch (err) {
                    console.error(`[daily-send] erro ao enviar para ${user}:`, err);
                }
            }
        }
    });
}

// ---------------- Create and configure clients ----------------
function createWhatsAppClient(clientId) {
    const client = new Client({
        authStrategy: new LocalAuth({ clientId }),
        puppeteer: {
            headless: true,
            args: ['--no-sandbox','--disable-setuid-sandbox']
        }
    });

    client.on('qr', qr => {
        console.log(`[${clientId}] QR recebido — escaneie apenas para essa sessão:`);
        qrcode.generate(qr, { small: true });
    });

    client.on('ready', async () => {
        console.log(`[${clientId}] pronto ✅`);
        // garante planilhas para inscritos deste client
        const users = await readUsers(clientId);
        for (const u of users) {
            await createMonthlyWorkbook(u).catch(err => console.error(`[${clientId}] createMonthly erro`, err));
        }
        // agenda envios diários e mensais para este client
        scheduleDailyQuestions(client, clientId);
        scheduleMonthlySendPerClient(client, clientId);
        console.log(`[${clientId}] Agendamentos e preparação finalizados.`);
    });

    client.on('auth_failure', msg => {
        console.error(`[${clientId}] auth_failure:`, msg);
    });

    client.on('disconnected', reason => {
        console.warn(`[${clientId}] disconnected:`, reason);
    });

    client.on('message', async msg => {
        try {
            console.log(`[${clientId} message] from=${msg.from} body="${msg.body}"`);
            const sender = msg.from;
            if (!sender || sender.endsWith('@g.us')) {
                console.log(`[${clientId}] ignorando (grupo ou sender inválido): ${sender}`);
                return;
            }

            const raw = String(msg.body || '').trim();
            if (!raw) return;
            const up = raw.toUpperCase();

            // COMMANDS: START, STOP, TEST WRITE, SHOW FILE
            if (up === 'START') {
                await addUser(clientId, sender);
                await createMonthlyWorkbook(sender);
                await msg.reply('✅ Você foi inscrito para receber lembretes diários e relatórios mensais.');
                return;
            }
            if (up === 'STOP') {
                await removeUser(clientId, sender);
                await msg.reply('✅ Você foi removido da lista de lembretes.');
                return;
            }
            if (up === 'TEST WRITE') {
                try {
                    await updateWorkbook(sender, schedules[0].area, 1);
                    await msg.reply('✅ TEST WRITE executado (Espírito=1)');
                } catch (err) {
                    console.error(`[${clientId} TEST WRITE] erro:`, err);
                    await msg.reply('❌ Erro no TEST WRITE. Veja logs do servidor.');
                }
                return;
            }
            if (up === 'SHOW FILE') {
                const fp = getXLSXPath(sender);
                if (fs.existsSync(fp)) {
                    try {
                        const media = MessageMedia.fromFilePath(fp);
                        await client.sendMessage(sender, media, { caption: '📁 Sua planilha atual:' });
                    } catch (err) {
                        console.error(`[${clientId} SHOW FILE] erro ao enviar arquivo:`, err);
                        await msg.reply('❌ Erro ao enviar a planilha. Veja logs do servidor.');
                    }
                } else {
                    await msg.reply('❌ Nenhuma planilha encontrada para você. Envie START para se inscrever.');
                }
                return;
            }

            // Resposta SIM / NÃO (normaliza acento)
            const respNorm = up.normalize ? up.normalize('NFKD').replace(/[\u0300-\u036f]/g, '') : up;
            if (respNorm === 'SIM' || respNorm === 'NAO' || respNorm === 'NÃO') {
                // determina última pergunta enviada (horários)
                const now = new Date();
                const last = schedules.reduce((prev, curr) => {
                    const [h, m] = curr.time.split(':').map(Number);
                    const candidate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m);
                    return (candidate <= now && candidate > prev.date) ? { ...curr, date: candidate } : prev;
                }, { date: new Date(0) });

                if (!last.area) {
                    await msg.reply('❌ Não consegui identificar qual pergunta você está respondendo. Você pode enviar no formato: "Espírito SIM"');
                    return;
                }
                const value = (respNorm === 'SIM') ? 1 : 0;
                try {
                    await updateWorkbook(sender, last.area, value);
                    await msg.reply(`✅ Resposta registrada em *${last.area}*: ${respNorm} (${value})`);
                } catch (err) {
                    console.error(`[${clientId} message] erro ao gravar:`, err);
                    await msg.reply('❌ Erro ao gravar sua resposta. Veja logs do servidor.');
                }
                return;
            }

            // Fallback: interpretar "Area SIM" no texto
            const foundArea = schedules.find(s => raw.toLowerCase().includes(s.area.toLowerCase()));
            const containsSim = /(^|\s)SIM(\s|$)/i.test(raw);
            const containsNao = /(^|\s)N(Ã|A|AO)?O?(\s|$)/i.test(raw) || /(^|\s)NAO(\s|$)/i.test(raw);
            if (foundArea && (containsSim || containsNao)) {
                const value = containsSim ? 1 : 0;
                try {
                    await updateWorkbook(sender, foundArea.area, value);
                    await msg.reply(`✅ Resposta registrada em *${foundArea.area}*: ${containsSim ? 'SIM' : 'NÃO'} (${value})`);
                } catch (err) {
                    console.error(`[${clientId} fallback] erro ao gravar:`, err);
                    await msg.reply('❌ Erro ao gravar sua resposta via fallback. Veja logs do servidor.');
                }
                return;
            }

            // Mensagem desconhecida
            await msg.reply('Responda com *SIM* ou *NÃO* quando receber o lembrete. Comandos: *START*, *STOP*, *TEST WRITE*, *SHOW FILE*.');
        } catch (err) {
            console.error(`[${clientId} message] erro inesperado:`, err);
        }
    });

    // protected initialize (retry)
    (async () => {
        const MAX_INIT_RETRIES = 3;
        for (let attempt = 1; attempt <= MAX_INIT_RETRIES; attempt++) {
            try {
                await client.initialize();
                return;
            } catch (err) {
                console.error(`[${clientId}] initialize erro (attempt ${attempt}):`, err);
                if (attempt === MAX_INIT_RETRIES) {
                    console.error(`[${clientId}] falha inicializando após ${attempt} tentativas.`);
                    throw err;
                }
                await sleep(1000 * attempt);
            }
        }
    })().catch(err => {
        console.error(`[${clientId}] falha crítica no initialize:`, err);
    });

    return client;
}

// ---------------- start all clients ----------------
console.log(`Inicializando clients: ${CLIENT_IDS.join(', ')}`);
const clients = CLIENT_IDS.map(id => createWhatsAppClient(id));

// exports for testability
module.exports = {
    createMonthlyWorkbook,
    updateWorkbook,
    readUsersMap,
    addUser,
    removeUser
};
