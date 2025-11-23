const fs = require('fs/promises');
const path = require('path');

const LIST_FILE = path.join(__dirname, 'listas.json');

// Garantir que o arquivo exista
async function garantirArquivo() {
  try {
    await fs.access(LIST_FILE);
  } catch {
    await fs.writeFile(LIST_FILE, JSON.stringify({ lista_compras: {} }, null, 2), 'utf-8');
  }
}

async function getListaCompras() {
  try {
    await garantirArquivo();
    const data = await fs.readFile(LIST_FILE, 'utf-8');
    const json = JSON.parse(data);
    return json.lista_compras || {};
  } catch (err) {
    console.error('[getListaCompras] erro lendo arquivo:', err);
    return {};
  }
}

async function salvarListaCompras(lista) {
  try {
    await fs.writeFile(LIST_FILE, JSON.stringify({ lista_compras: lista }, null, 2), 'utf-8');
  } catch (err) {
    console.error('[salvarListaCompras] erro salvando arquivo:', err);
  }
}

async function adicionarItem(item, quantidade, categoria = 'outros') {
  if (!item || !quantidade) throw new Error('Item e quantidade são obrigatórios');
  
  const lista = await getListaCompras();
  if (!lista[categoria]) lista[categoria] = [];
  lista[categoria].push({ item, quantidade });
  await salvarListaCompras(lista);
  return lista;
}

async function removerItem(nomeItem, categoria) {
  const lista = await getListaCompras();
  if (!lista[categoria]) return lista;

  lista[categoria] = lista[categoria].filter(i => i.item.toLowerCase() !== nomeItem.toLowerCase());
  await salvarListaCompras(lista);
  return lista;
}

module.exports = { getListaCompras, adicionarItem, removerItem };
