require('dotenv').config();
const express    = require('express');
const mysql      = require('mysql2/promise');
const bcrypt     = require('bcryptjs');
const session    = require('express-session');
const cors       = require('cors');
const path       = require('path');
const multer     = require('multer');
const fs         = require('fs');

const app  = express();
const PORT = process.env.PORT || 3001;

// ── Database pool ────────────────────────────────────────────────────────────
const db = mysql.createPool({
  host:     process.env.DB_HOST,
  user:     process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
});

// ── Middleware ───────────────────────────────────────────────────────────────
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cors({ origin: true, credentials: true }));
app.use(session({
  secret:            process.env.SESSION_SECRET,
  resave:            false,
  saveUninitialized: false,
  cookie:            { secure: false, maxAge: 8 * 60 * 60 * 1000 }, // 8 hours
}));

// Serve static frontend
app.use(express.static(path.join(__dirname, 'public')));

// File upload (DAT files)
const upload = multer({ dest: path.join(__dirname, 'uploads') });

// ── Auth middleware ──────────────────────────────────────────────────────────
function requireAuth(req, res, next) {
  if (req.session && req.session.user) return next();
  res.status(401).json({ error: 'Not authenticated' });
}

// ── AUTH ROUTES ──────────────────────────────────────────────────────────────
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  try {
    const [rows] = await db.query('SELECT * FROM users WHERE username=? AND active=1', [username]);
    if (!rows.length) return res.status(401).json({ error: 'Invalid credentials' });
    const user = rows[0];
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });
    req.session.user = { id: user.id, username: user.username, full_name: user.full_name, role: user.role };
    res.json({ ok: true, user: req.session.user });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/logout', (req, res) => {
  req.session.destroy();
  res.json({ ok: true });
});

app.get('/api/me', (req, res) => {
  if (req.session.user) res.json(req.session.user);
  else res.status(401).json({ error: 'Not authenticated' });
});

// ── LOADS ────────────────────────────────────────────────────────────────────
app.get('/api/loads', requireAuth, async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM loads ORDER BY pu_date DESC');
    res.json(rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/loads', requireAuth, async (req, res) => {
  const l = req.body;
  try {
    const [r] = await db.query(
      `INSERT INTO loads (load_number,schedule_number,driver,truck,trailer,customer,broker_load_number,
       pu_date,pu_city,pu_state,pu_zip,del_date,del_city,del_state,del_zip,route,amount,
       empty_miles,loaded_miles,status,special,is_tonu,is_tanker,notes,created_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [l.load_number,l.schedule_number,l.driver,l.truck,l.trailer,l.customer,l.broker_load_number,
       l.pu_date||null,l.pu_city,l.pu_state,l.pu_zip,l.del_date||null,l.del_city,l.del_state,l.del_zip,
       l.route,l.amount||0,l.empty_miles||0,l.loaded_miles||0,l.status||'Confirmed',
       l.special,l.is_tonu||0,l.is_tanker||0,l.notes,req.session.user.username]
    );
    res.json({ ok: true, id: r.insertId });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/loads/:id', requireAuth, async (req, res) => {
  const l = req.body;
  try {
    await db.query(
      `UPDATE loads SET load_number=?,schedule_number=?,driver=?,truck=?,trailer=?,customer=?,
       broker_load_number=?,pu_date=?,pu_city=?,pu_state=?,pu_zip=?,del_date=?,del_city=?,
       del_state=?,del_zip=?,route=?,amount=?,empty_miles=?,loaded_miles=?,status=?,
       special=?,is_tonu=?,is_tanker=?,notes=? WHERE id=?`,
      [l.load_number,l.schedule_number,l.driver,l.truck,l.trailer,l.customer,l.broker_load_number,
       l.pu_date||null,l.pu_city,l.pu_state,l.pu_zip,l.del_date||null,l.del_city,l.del_state,l.del_zip,
       l.route,l.amount||0,l.empty_miles||0,l.loaded_miles||0,l.status,
       l.special,l.is_tonu||0,l.is_tanker||0,l.notes,req.params.id]
    );
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/loads/:id', requireAuth, async (req, res) => {
  try {
    await db.query('DELETE FROM loads WHERE id=?', [req.params.id]);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── REPAIRS ──────────────────────────────────────────────────────────────────
app.get('/api/repairs', requireAuth, async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM repairs ORDER BY repair_date DESC');
    res.json(rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/repairs', requireAuth, async (req, res) => {
  const r = req.body;
  try {
    const [result] = await db.query(
      `INSERT INTO repairs (repair_date,unit,unit_type,description,amount,vendor,
       payment_method,mileage,invoice_number,wo_number,notes,created_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [r.repair_date||null,r.unit,r.unit_type||'Truck',r.description,r.amount||null,
       r.vendor,r.payment_method||'CC',r.mileage,r.invoice_number,r.wo_number,r.notes,
       req.session.user.username]
    );
    res.json({ ok: true, id: result.insertId });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/repairs/:id', requireAuth, async (req, res) => {
  const r = req.body;
  try {
    await db.query(
      `UPDATE repairs SET repair_date=?,unit=?,unit_type=?,description=?,amount=?,vendor=?,
       payment_method=?,mileage=?,invoice_number=?,wo_number=?,notes=? WHERE id=?`,
      [r.repair_date||null,r.unit,r.unit_type||'Truck',r.description,r.amount||null,
       r.vendor,r.payment_method||'CC',r.mileage,r.invoice_number,r.wo_number,r.notes,req.params.id]
    );
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/repairs/:id', requireAuth, async (req, res) => {
  try {
    await db.query('DELETE FROM repairs WHERE id=?', [req.params.id]);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── DRIVERS ──────────────────────────────────────────────────────────────────
app.get('/api/drivers', requireAuth, async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM drivers ORDER BY name');
    res.json(rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/drivers', requireAuth, async (req, res) => {
  const d = req.body;
  try {
    const [r] = await db.query(
      `INSERT INTO drivers (name,address,dl,dob,dl_exp,med_exp,hire_date,email,phone,
       pay_type,pay_rate,pay_floor,occ_ins,truck_unit,trailer_unit,company)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [d.name,d.address,d.dl,d.dob||null,d.dl_exp||null,d.med_exp||null,d.hire_date||null,
       d.email,d.phone,d.pay_type||'permile',d.pay_rate||0,d.pay_floor||0,d.occ_ins||35,
       d.truck_unit,d.trailer_unit,d.company]
    );
    res.json({ ok: true, id: r.insertId });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/drivers/:id', requireAuth, async (req, res) => {
  const d = req.body;
  try {
    await db.query(
      `UPDATE drivers SET name=?,address=?,dl=?,dob=?,dl_exp=?,med_exp=?,hire_date=?,
       email=?,phone=?,pay_type=?,pay_rate=?,pay_floor=?,occ_ins=?,truck_unit=?,trailer_unit=?,company=?
       WHERE id=?`,
      [d.name,d.address,d.dl,d.dob||null,d.dl_exp||null,d.med_exp||null,d.hire_date||null,
       d.email,d.phone,d.pay_type,d.pay_rate,d.pay_floor,d.occ_ins,
       d.truck_unit,d.trailer_unit,d.company,req.params.id]
    );
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── TRUCKS ───────────────────────────────────────────────────────────────────
app.get('/api/trucks', requireAuth, async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM trucks ORDER BY unit');
    res.json(rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/trucks', requireAuth, async (req, res) => {
  const t = req.body;
  try {
    const [r] = await db.query(
      `INSERT INTO trucks (unit,make,model,year,vin,plate,plate_state,plate_exp,insp_exp,
       color,engine,ins_value,status,assigned_driver,notes,ctc_exp)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [t.unit,t.make,t.model,t.year,t.vin,t.plate,t.plate_state,t.plate_exp||null,
       t.insp_exp||null,t.color,t.engine,t.ins_value||null,t.status||'In Use',
       t.assigned_driver,t.notes,t.ctc_exp||null]
    );
    res.json({ ok: true, id: r.insertId });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/trucks/:id', requireAuth, async (req, res) => {
  const t = req.body;
  try {
    await db.query(
      `UPDATE trucks SET unit=?,make=?,model=?,year=?,vin=?,plate=?,plate_state=?,plate_exp=?,
       insp_exp=?,color=?,engine=?,ins_value=?,status=?,assigned_driver=?,notes=?,ctc_exp=?
       WHERE id=?`,
      [t.unit,t.make,t.model,t.year,t.vin,t.plate,t.plate_state,t.plate_exp||null,
       t.insp_exp||null,t.color,t.engine,t.ins_value||null,t.status,
       t.assigned_driver,t.notes,t.ctc_exp||null,req.params.id]
    );
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── TRAILERS ─────────────────────────────────────────────────────────────────
app.get('/api/trailers', requireAuth, async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM trailers ORDER BY unit');
    res.json(rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/trailers/:id', requireAuth, async (req, res) => {
  const t = req.body;
  try {
    await db.query(
      `UPDATE trailers SET unit=?,make=?,year=?,vin=?,plate=?,plate_state=?,plate_exp=?,
       insp_exp=?,ins_value=?,status=?,assigned_truck=?,notes=? WHERE id=?`,
      [t.unit,t.make,t.year,t.vin,t.plate,t.plate_state,t.plate_exp||null,
       t.insp_exp||null,t.ins_value||null,t.status,t.assigned_truck,t.notes,req.params.id]
    );
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── BROKERS ──────────────────────────────────────────────────────────────────
app.get('/api/brokers', requireAuth, async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM brokers ORDER BY name');
    res.json(rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/brokers', requireAuth, async (req, res) => {
  const b = req.body;
  try {
    const [r] = await db.query(
      `INSERT INTO brokers (name,address,city,state,zip,phone,email,contact_name,mc_number,credit_rating,notes)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE address=VALUES(address),phone=VALUES(phone),email=VALUES(email),
       mc_number=VALUES(mc_number),credit_rating=VALUES(credit_rating)`,
      [b.name,b.address,b.city,b.state,b.zip,b.phone,b.email,b.contact_name,b.mc_number,b.credit_rating||'',b.notes]
    );
    res.json({ ok: true, id: r.insertId });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/brokers/:id', requireAuth, async (req, res) => {
  const b = req.body;
  try {
    await db.query(
      `UPDATE brokers SET name=?,address=?,city=?,state=?,zip=?,phone=?,email=?,
       contact_name=?,mc_number=?,credit_rating=?,notes=? WHERE id=?`,
      [b.name,b.address,b.city,b.state,b.zip,b.phone,b.email,
       b.contact_name,b.mc_number,b.credit_rating||'',b.notes,req.params.id]
    );
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── FUEL ─────────────────────────────────────────────────────────────────────
app.get('/api/fuel', requireAuth, async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM fuel_transactions ORDER BY transaction_date DESC');
    res.json(rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/fuel', requireAuth, async (req, res) => {
  const f = req.body;
  try {
    const [r] = await db.query(
      `INSERT INTO fuel_transactions (transaction_date,transaction_time,report_date,upload_date,
       driver,driver_name,unit,location,state,zip,lat,lon,account_number,
       diesel_gallons,diesel_ppu,diesel_amount,def_gallons,def_ppu,def_amount,total_amount)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [f.transaction_date||null,f.transaction_time,f.report_date||null,f.upload_date||null,
       f.driver,f.driver_name,f.unit,f.location,f.state,f.zip,f.lat||null,f.lon||null,
       f.account_number,f.diesel_gallons||null,f.diesel_ppu||null,f.diesel_amount||null,
       f.def_gallons||null,f.def_ppu||null,f.def_amount||null,f.total_amount||0]
    );
    res.json({ ok: true, id: r.insertId });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/fuel/:id', requireAuth, async (req, res) => {
  const f = req.body;
  try {
    await db.query(
      `UPDATE fuel_transactions SET transaction_date=?,driver=?,unit=?,location=?,state=?,
       diesel_gallons=?,diesel_amount=?,def_gallons=?,def_amount=?,total_amount=?,account_number=?
       WHERE id=?`,
      [f.transaction_date||null,f.driver,f.unit,f.location,f.state,
       f.diesel_gallons||null,f.diesel_amount||null,f.def_gallons||null,f.def_amount||null,
       f.total_amount||0,f.account_number,req.params.id]
    );
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── USERS (admin only) ───────────────────────────────────────────────────────
app.get('/api/users', requireAuth, async (req, res) => {
  if (req.session.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  try {
    const [rows] = await db.query('SELECT id,username,full_name,role,active,created_at FROM users');
    res.json(rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/users', requireAuth, async (req, res) => {
  if (req.session.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  const { username, password, full_name, role } = req.body;
  try {
    const hash = await bcrypt.hash(password, 12);
    const [r] = await db.query(
      'INSERT INTO users (username,password_hash,full_name,role) VALUES (?,?,?,?)',
      [username, hash, full_name, role||'dispatcher']
    );
    res.json({ ok: true, id: r.insertId });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/users/:id/password', requireAuth, async (req, res) => {
  const { password } = req.body;
  const targetId = parseInt(req.params.id);
  if (req.session.user.role !== 'admin' && req.session.user.id !== targetId)
    return res.status(403).json({ error: 'Forbidden' });
  try {
    const hash = await bcrypt.hash(password, 12);
    await db.query('UPDATE users SET password_hash=? WHERE id=?', [hash, targetId]);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── DASHBOARD STATS ──────────────────────────────────────────────────────────
app.get('/api/stats', requireAuth, async (req, res) => {
  try {
    const [[loads]]   = await db.query("SELECT COUNT(*) as total, SUM(amount) as revenue FROM loads WHERE status='Delivered'");
    const [[repairs]] = await db.query("SELECT COUNT(*) as total, SUM(amount) as cost FROM repairs");
    const [[fuel]]    = await db.query("SELECT COUNT(*) as total, SUM(total_amount) as cost FROM fuel_transactions");
    const [expiring]  = await db.query(
      `SELECT unit, 'truck' as type, plate_exp, insp_exp FROM trucks
       WHERE plate_exp <= DATE_ADD(NOW(), INTERVAL 60 DAY) OR insp_exp <= DATE_ADD(NOW(), INTERVAL 60 DAY)
       UNION
       SELECT unit, 'trailer' as type, plate_exp, insp_exp FROM trailers
       WHERE plate_exp <= DATE_ADD(NOW(), INTERVAL 60 DAY) OR insp_exp <= DATE_ADD(NOW(), INTERVAL 60 DAY)`
    );
    res.json({ loads, repairs, fuel, expiring });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── HEALTH CHECK ─────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ ok: true, app: 'FreightCore', version: '1.0.0', time: new Date() });
});

// ── Routes ───────────────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/app', (req, res) => {
  if (!req.session.user) return res.redirect('/');
  res.sendFile(path.join(__dirname, 'public', 'app.html'));
});

app.get('/{*path}', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// ── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`FreightCore running on port ${PORT}`);
});
