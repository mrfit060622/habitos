// const sqlite3 = require("sqlite3");
// const { open } = require("sqlite");

// (async () => {
//   const db = await open({ filename: "./habitos.db", driver: sqlite3.Database });
//   const rows = await db.all("SELECT * FROM records");
//   console.log(rows);
// })();

const { sendMonthlyReports } = require('./utils');

(async () => {
    await sendMonthlyReports(clientInstance, "5434823722");
})();