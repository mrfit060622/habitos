'use strict';

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const ExcelJS = require('exceljs');

// ---------------- CONFIG ----------------
const DATA_DIR = path.join(__dirname);
const USERS_FILE = path.join(DATA_DIR, 'users.json');

const schedules = [
    { 
        time: "20:30", 
        area: "Espírito", 
        tipo: "binario", 
        pergunta: "Você alimentou seu espírito hoje?", 
        descricao: "Ex.: Orar, meditar ou praticar gratidão."
    },
    { 
        time: "21:00", 
        area: "Alma", 
        tipo: "binario", 
        pergunta: "Você cuidou da sua alma hoje?", 
        descricao: "Ex.: Pausar, criar, ouvir música ou contemplar arte."
    },
    { 
        time: "08:50", 
        area: "Mente", 
        tipo: "binario", 
        pergunta: "Você estimulou sua mente hoje?", 
        descricao: "Ex.: Ler, estudar, resolver problemas ou planejar."
    },
    { 
        time: "21:05", 
        area: "Mente", 
        tipo: "binario", 
        pergunta: "Você estimulou sua mente hoje?", 
        descricao: "Ex.: Ler, estudar, resolver problemas ou planejar."
    },
    { 
        time: "20:25", 
        area: "Corpo", 
        tipo: "binario", 
        pergunta: "Você cuidou do corpo hoje?", 
        descricao: "Ex.: Exercício, alimentação, hidratação, sono ou alongamento."
    },
    { 
        time: "07:00", 
        area: "Corpo", 
        tipo: "binario", 
        pergunta: "Você cuidou do corpo hoje?", 
        descricao: "Ex.: Exercício, alimentação, hidratação, sono ou alongamento."
    },
    { 
        time: "21:10", 
        area: "Relacionamentos", 
        tipo: "binario", 
        pergunta: "Você se conectou com alguém hoje?", 
        descricao: "Ex.: Conversar, apoiar ou demonstrar carinho."
    },
    { 
        time: "19:00", 
        area: "Trabalho/Recursos", 
        tipo: "binario", 
        pergunta: "Você avançou nas suas metas hoje?", 
        descricao: "Ex.: Trabalhar com foco, organizar tarefas ou aprender."
    },
    { 
        time: "21:15", 
        area: "Tempo/Lazer", 
        tipo: "binario", 
        pergunta: "Você aproveitou seu tempo livre?", 
        descricao: "Ex.: Descansar, se divertir, praticar hobbies ou curtir a natureza."
    }
];

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
            sheet1.eachRow((r, rnum) => { 
                if (rnum > 1) { 
                    const v = r.getCell(colNumber).value; 
                    if (v !== '' && v !== null) { sum += Number(v); count++; } 
                } 
            });
            sheet2.getRow(i).getCell(2).value = count ? Math.round((sum / count) * 10) : 0;
            sheet2.getRow(i).commit();
        }
    }

    await workbook.xlsx.writeFile(filePath);
    return { success: true, filePath };
}

// Preenche 0 automaticamente se não respondeu
async function autoFillZeros(userId, area) {
    await updateWorkbook(userId, area, 0);
}

module.exports = {
    schedules,
    readUsersMap,
    writeUsersMap,
    addUser,
    removeUser,
    getXLSXPath,
    createMonthlyWorkbook,
    updateWorkbook,
    autoFillZeros
};
