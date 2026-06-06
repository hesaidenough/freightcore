const bcrypt = require('bcryptjs');
const mysql = require('mysql2/promise');
mysql.createConnection({host:'localhost',user:'freightcore',password:'FC_2026_FreightCore!',database:'freightcore'}).then(async db=>{
  const h1 = await bcrypt.hash('Gia2026!CFS', 12);
  const h2 = await bcrypt.hash('Matt2026!CFS', 12);
  await db.query('UPDATE users SET password_hash=? WHERE username=?',[h1,'gia@shipcg.com']);
  await db.query('UPDATE users SET password_hash=? WHERE username=?',[h2,'matt@shipcg.com']);
  console.log('Passwords reset');
  db.end();
});
