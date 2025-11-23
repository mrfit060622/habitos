// test.js
'use strict';

const { addUser, createMonthlyWorkbook, updateWorkbook, readUsersMap } = require('./index');

async function run() {
    const clientId = 'habitos'; // mesmo clientId do bot
    const userId = '5511934335702@c.us'; // substitua pelo seu número (WhatsApp Web ID)

    console.log('Lendo users.json antes:');
    console.log(await readUsersMap());

    // Adiciona usuário
    await addUser(clientId, userId);
    console.log('Usuário adicionado.');

    // Cria planilha mensal
    await createMonthlyWorkbook(userId);
    console.log('Planilha criada.');

    // Teste de update
    await updateWorkbook(userId, 'Espírito', 1);
    console.log('Planilha atualizada: Espírito = 1');

    console.log('Lendo users.json depois:');
    console.log(await readUsersMap());
}

run().catch(console.error);
