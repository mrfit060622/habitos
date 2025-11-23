'use strict';

const qrcode = require('qrcode-terminal');
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const ExcelJS = require('exceljs');
const fs = require('fs');
const fsp = fs.promises;
const cron = require('node-cron');
const path = require('path');

// ---------------- CONFIG ----------------
const DATA_DIR = path.join(__dirname);
const USERS_FILE = path.join(DATA_DIR, 'users.json'); 
const CLIENT_IDS = (process.env.CLIENT_IDS || 'habitos').split(',').map(s => s.trim()).filter(Boolean);
const MAX_WRITE_RETRIES = 6;
const WRITE_RETRY_MS = 300;

// ---------------- SCHEDULES ----------------
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
await loadUsers();
let usersCache = {};

async function loadUsers() {
  try {
    const raw = await fsp.readFile(USERS_FILE, 'utf8');
    usersCache = JSON.parse(raw);
  } catch {
    usersCache = {};
  }
}

async function saveUsers() {
  await fsp.writeFile(USERS_FILE, JSON.stringify(usersCache, null, 2), 'utf8');
}

async function readUsers(clientId) {
  return usersCache[clientId] || [];
}

async function addUser(clientId, userId) {
  usersCache[clientId] = usersCache[clientId] || [];
  if (!usersCache[clientId].includes(userId)) {
    usersCache[clientId].push(userId);
    await saveUsers();
  }
  return usersCache[clientId];
}

async function removeUser(clientId, userId) {
  usersCache[clientId] = (usersCache[clientId] || []).filter(u => u !== userId);
  await saveUsers();
  return usersCache[clientId];
}


// ---------------- PATH PLANILHA ----------------
function sanitizeForFilename(s) {
    return String(s).replace(/[^a-zA-Z0-9-_]/g, '');
}

function getXLSXPath(userId) {
    const now = new Date();
    const fileName = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}_${sanitizeForFilename(userId)}.xlsx`;
    return path.join(DATA_DIR, fileName);
}

// ---------------- FILE QUEUE ----------------
const fileQueues = new Map();
function enqueueFileOp(filePath, fn) {
    const prev = fileQueues.get(filePath) || Promise.resolve();
    const next = prev.then(() => fn()).catch(err => console.error(`[enqueueFileOp] erro em ${filePath}:`, err));
    fileQueues.set(filePath, next.finally(() => {
        if (fileQueues.get(filePath) === next) fileQueues.delete(filePath);
    }));
    return next;
}

// ---------------- WRITE WORKBOOK ----------------
async function writeWorkbookAtomic(workbook, filePath) {
    const tmpPath = filePath + '.tmp';
    for (let attempt = 1; attempt <= MAX_WRITE_RETRIES; attempt++) {
        try {
            await workbook.xlsx.writeFile(tmpPath);
            await fsp.rename(tmpPath, filePath);
            return;
        } catch (err) {
            try { await fsp.unlink(tmpPath).catch(()=>{}); } catch(_) {}
            if (attempt === MAX_WRITE_RETRIES) throw err;
            console.warn(`[writeWorkbookAtomic] tentativa ${attempt} falhou, retry em ${WRITE_RETRY_MS*attempt}ms`);
            await sleep(WRITE_RETRY_MS * attempt);
        }
    }
}

// ---------------- CREATE MONTHLY WORKBOOK ----------------
async function createMonthlyWorkbook(userId) {
    const filePath = getXLSXPath(userId);
    return enqueueFileOp(filePath, async () => {
        if (fs.existsSync(filePath)) return filePath;
        console.log(`[createMonthlyWorkbook] criando: ${filePath}`);

        const workbook = new ExcelJS.Workbook();
        const sheet1 = workbook.addWorksheet('Registros');
        sheet1.addRow(['Data', ...schedules.map(s => s.area)]);

        const now = new Date();
        const year = now.getFullYear();
        const month = now.getMonth();
        const daysInMonth = new Date(year, month+1, 0).getDate();
        for (let d = 1; d <= daysInMonth; d++) {
            const dateStr = `${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
            sheet1.addRow([dateStr, ...Array(schedules.length).fill('')]);
        }

        const sheet2 = workbook.addWorksheet('Média Mensal');
        sheet2.addRow(['Área','Nota (0-10)']);
        schedules.forEach(s => sheet2.addRow([s.area, 0]));

        await writeWorkbookAtomic(workbook, filePath);
        return filePath;
    });
}

// ---------------- UPDATE WORKBOOK ----------------
async function updateWorkbook(userId, area, value) {
    const filePath = await createMonthlyWorkbook(userId);
    return enqueueFileOp(filePath, async () => {
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.readFile(filePath);
        const sheet1 = workbook.getWorksheet('Registros');
        const sheet2 = workbook.getWorksheet('Média Mensal');

        const today = new Date();
        const dateStr = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;

        let rowNumber = -1;
        sheet1.eachRow((row, rnum) => { if (rnum>1 && row.getCell(1).value==dateStr) rowNumber=rnum; });
        const headerRow = sheet1.getRow(1);
        let colNumber = -1;
        headerRow.eachCell((cell, cnum) => { if (cell.value==area) colNumber=cnum; });

        if (!(rowNumber>=1 && colNumber>=1)) throw new Error('Linha ou coluna não encontrada');

        sheet1.getRow(rowNumber).getCell(colNumber).value = value;
        sheet1.getRow(rowNumber).commit();

        // recalcular média
        for (let i=2;i<=sheet2.rowCount;i++){
            if(sheet2.getRow(i).getCell(1).value==area){
                let sum=0,count=0;
                sheet1.eachRow((r,rnum)=>{if(rnum>1){const v=r.getCell(colNumber).value; if(v!==''&&v!==null) {sum+=Number(v);count++;}}});
                const nota = count ? Math.round((sum/count)*10) : 0;
                sheet2.getRow(i).getCell(2).value = nota;
                sheet2.getRow(i).commit();
            }
        }

        await writeWorkbookAtomic(workbook, filePath);
        return { success:true, filePath };
    });
}

// ---------------- DAILY QUESTIONS ----------------
function scheduleDailyQuestions(clientInstance, clientId){
    cron.schedule('* * * * *', async ()=>{
        const now=new Date();
        const hhmm=`${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
        const matches = schedules.filter(s=>s.time===hhmm);
        if(matches.length===0) return;
        const users=await readUsers(clientId);
        for(const user of users){
            for(const sched of matches){
                try{
                    await clientInstance.sendMessage(user, `⏰ Registro do dia - *${sched.area}*\nResponda apenas com: *SIM* ou *NÃO*`);
                    console.log(`[daily-send] ${sched.area} -> ${user}`);
                }catch(err){console.error(err);}
            }
        }
    });
}
// ----- teste
async function sendMonthlyReports(clientInstance, clientId) {
    const now = new Date();
    const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();

    // deixe isso comentado para testar
    // if (now.getDate() !== lastDay) return;

    const users = await readUsers(clientId);
    for (const user of users) {
        const fp = getXLSXPath(user);
        if (fs.existsSync(fp)) {
            try {
                const media = MessageMedia.fromFilePath(fp);
                await clientInstance.sendMessage(user, media, {
                    caption: `📊 Relatório mensal: ${now.getMonth() + 1}/${now.getFullYear()}`
                });
                console.log(`[monthly-send] ${fp} -> ${user}`);
            } catch (err) {
                console.error(err);
            }
        }
    }
}

function scheduleMonthlySendPerClient(clientInstance, clientId) {
    cron.schedule('59 23 * * *', () => sendMonthlyReports(clientInstance, clientId));
}

module.exports = { scheduleMonthlySendPerClient, sendMonthlyReports };

// ---------------- MONTHLY SEND ----------------
function scheduleMonthlySendPerClient(clientInstance, clientId){
    cron.schedule('59 23 * * *', async ()=>{
        const now=new Date();
        const lastDay = new Date(now.getFullYear(), now.getMonth()+1,0).getDate();
        if(now.getDate()!==lastDay) return;
        const users=await readUsers(clientId);
        for(const user of users){
            const fp=getXLSXPath(user);
            if(fs.existsSync(fp)){
                try{
                    const media = MessageMedia.fromFilePath(fp);
                    await clientInstance.sendMessage(user, media, {caption:`📊 Relatório mensal: ${now.getMonth()+1}/${now.getFullYear()}`});
                    console.log(`[monthly-send] ${fp} -> ${user}`);
                }catch(err){console.error(err);}
            }
        }
    });
}

// ---------------- CREATE CLIENT ----------------
function createWhatsAppClient(clientId){
    const client = new Client({
        authStrategy: new LocalAuth({clientId}),
        puppeteer:{headless:true,args:['--no-sandbox','--disable-setuid-sandbox']}
    });

    client.on('qr', qr => {console.log(`[${clientId}] QR recebido:`); qrcode.generate(qr,{small:true});});
    client.on('ready', async ()=>{
        console.log(`[${clientId}] pronto ✅`);
        const users = await readUsers(clientId);
        for(const u of users) await createMonthlyWorkbook(u).catch(console.error);
        scheduleDailyQuestions(client, clientId);
        scheduleMonthlySendPerClient(client, clientId);
    });
    client.on('auth_failure', msg=>console.error(`[${clientId}] auth_failure:`,msg));
    client.on('disconnected', reason=>console.warn(`[${clientId}] disconnected:`,reason));

    client.on('message', async msg=>{
        try{
        const sender = msg.from;

        // Ignora grupos e mensagens sem remetente
        if (!sender || sender.endsWith('@g.us')) return;

        // 🔒 Só processa se o número já estiver cadastrado
        const users = await readUsers(clientId);
        if (!users.includes(sender)) {
            console.log(`[${clientId}] mensagem ignorada de ${sender}`);
            return;
        }

        const raw = String(msg.body || '').trim();
        if (!raw) return;
        const up = raw.toUpperCase();

            if(up==='START'){await addUser(clientId,sender); await createMonthlyWorkbook(sender); await msg.reply('✅ Você foi inscrito.'); return;}
            if(up==='STOP'){await removeUser(clientId,sender); await msg.reply('✅ Você foi removido.'); return;}
            if(up==='TEST WRITE'){await updateWorkbook(sender,schedules[0].area,1); await msg.reply('✅ TEST WRITE executado.'); return;}
            if(up==='SHOW FILE'){const fp=getXLSXPath(sender); if(fs.existsSync(fp)){const media=MessageMedia.fromFilePath(fp); await client.sendMessage(sender,media,{caption:'📁 Sua planilha atual:'});} else await msg.reply('❌ Nenhuma planilha encontrada.'); return;}

            const respNorm = up.normalize ? up.normalize('NFKD').replace(/[\u0300-\u036f]/g,'') : up;
            if(respNorm==='SIM'||respNorm==='NAO'||respNorm==='NAO'){
                const now = new Date();
                const last = schedules.reduce((prev,curr)=>{
                    const [h,m]=curr.time.split(':').map(Number);
                    const candidate = new Date(now.getFullYear(),now.getMonth(),now.getDate(),h,m);
                    return (candidate<=now && candidate>prev.date)?{...curr,date:candidate}:prev;
                },{date:new Date(0)});
                if(!last.area){await msg.reply('❌ Não consegui identificar pergunta'); return;}
                const value = respNorm==='SIM'?1:0;
                await updateWorkbook(sender,last.area,value);
                await msg.reply(`✅ Resposta registrada em *${last.area}*: ${respNorm} (${value})`);
                return;
            }

            const foundArea = schedules.find(s=>raw.toLowerCase().includes(s.area.toLowerCase()));
            const containsSim = /(^|\s)SIM(\s|$)/i.test(raw);
            const containsNao = /(^|\s)N(Ã|A|AO)?O?(\s|$)/i.test(raw) || /(^|\s)NAO(\s|$)/i.test(raw);
            if(foundArea && (containsSim||containsNao)){
                const value = containsSim?1:0;
                await updateWorkbook(sender,foundArea.area,value);
                await msg.reply(`✅ Resposta registrada em *${foundArea.area}*: ${containsSim?'SIM':'NÃO'} (${value})`);
                return;
            }

            await msg.reply('Responda com *SIM* ou *NÃO*.');
        }catch(err){console.error(err);}
    });

    (async ()=>{
        const MAX_INIT_RETRIES=3;
        for(let attempt=1;attempt<=MAX_INIT_RETRIES;attempt++){
            try{await client.initialize(); return;}catch(err){console.error(`[${clientId}] initialize erro (attempt ${attempt})`,err); await sleep(1000*attempt);}
        }
    })().catch(err=>console.error(`[${clientId}] falha crítica:`,err));

    return client;
}

// ---------------- START ALL CLIENTS ----------------
console.log(`Inicializando clients: ${CLIENT_IDS.join(', ')}`);
const clients = CLIENT_IDS.map(id=>createWhatsAppClient(id));

// ---------------- EXPORTS ----------------
module.exports = { createMonthlyWorkbook, updateWorkbook, readUsersMap, addUser, removeUser };
