const bcrypt = require('bcryptjs');
const mysql = require('mysql2/promise');
mysql.createConnection({
  host:'localhost',user:'freightcore',
  password:'FC_2026_FreightCore!',database:'freightcore'
}).then(async db=>{
  const h1 = await bcrypt.hash('Gia2026!CFS', 12);
  const h2 = await bcrypt.hash('Matt2026!CFS', 12);
  await db.query('INSERT INTO users (username,password_hash,full_name,role) VALUES (?,?,?,?)',
    ['gia@shipcg.com',h1,'Gia','admin']).then(()=>console.log('gia OK')).catch(e=>console.error('gia:',e.message));
  await db.query('INSERT INTO users (username,password_hash,full_name,role) VALUES (?,?,?,?)',
    ['matt@shipcg.com',h2,'Matt','dispatcher']).then(()=>console.log('matt OK')).catch(e=>console.error('matt:',e.message));
  const [rows] = await db.query('SELECT username,role FROM users');
  rows.forEach(r=>console.log(r.username, r.role));
  db.end();
}).catch(e=>console.error('DB:',e.message));


