const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");

const DATA = path.join(__dirname, "..", "data");
const EVENTS_FILE = path.join(DATA, "events.json");
const BOOKINGS_FILE = path.join(DATA, "bookings.json");

const usePostgres = Boolean(process.env.DATABASE_URL);
const pool = usePostgres ? new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false
}) : null;

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}
function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

async function initDb() {
  if (!usePostgres) return;

  await pool.query(`
    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      event_date TIMESTAMPTZ NOT NULL,
      venue TEXT NOT NULL,
      description TEXT,
      capacity INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      passes JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS bookings (
      id TEXT PRIMARY KEY,
      event_id TEXT NOT NULL REFERENCES events(id),
      guest_name TEXT NOT NULL,
      phone TEXT NOT NULL,
      email TEXT NOT NULL,
      pass_type TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      amount INTEGER NOT NULL,
      status TEXT NOT NULL,
      razorpay_order_id TEXT,
      razorpay_payment_id TEXT,
      qr_data_url TEXT,
      checked_in BOOLEAN NOT NULL DEFAULT FALSE,
      checked_in_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_bookings_event_id ON bookings(event_id);
    CREATE INDEX IF NOT EXISTS idx_bookings_created_at ON bookings(created_at DESC);
  `);

  const { rows } = await pool.query("SELECT COUNT(*)::int AS c FROM events");
  if (rows[0].c === 0) {
    for (const e of readJson(EVENTS_FILE)) {
      await pool.query(`
        INSERT INTO events (id,name,event_date,venue,description,capacity,status,passes)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)
        ON CONFLICT (id) DO NOTHING
      `, [e.id,e.name,e.event_date,e.venue,e.description,e.capacity,e.status,JSON.stringify(e.passes)]);
    }
  }
}

async function getEvents() {
  if (usePostgres) {
    const { rows } = await pool.query(`
      SELECT e.*,
        COALESCE(SUM(CASE WHEN b.status IN ('confirmed','demo-confirmed') THEN b.quantity ELSE 0 END),0)::int AS sold
      FROM events e
      LEFT JOIN bookings b ON b.event_id=e.id
      WHERE e.status='active'
      GROUP BY e.id
      ORDER BY e.event_date ASC
    `);
    return rows.map(e => ({
      ...e,
      passes: typeof e.passes === "string" ? JSON.parse(e.passes) : e.passes,
      remaining: Math.max(0, e.capacity - e.sold)
    }));
  }

  const events = readJson(EVENTS_FILE);
  const bookings = readJson(BOOKINGS_FILE);
  return events.filter(e=>e.status==="active").map(e=>{
    const sold = bookings
      .filter(b=>b.event_id===e.id && ["confirmed","demo-confirmed"].includes(b.status))
      .reduce((s,b)=>s+Number(b.quantity||0),0);
    return {...e,sold,remaining:Math.max(0,e.capacity-sold)};
  });
}

async function createBooking(b) {
  if (usePostgres) {
    await pool.query(`
      INSERT INTO bookings
      (id,event_id,guest_name,phone,email,pass_type,quantity,amount,status,razorpay_order_id,created_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW())
    `, [b.id,b.event_id,b.guest_name,b.phone,b.email,b.pass_type,b.quantity,b.amount,b.status,b.razorpay_order_id]);
    return getBooking(b.id);
  }
  const rows = readJson(BOOKINGS_FILE);
  rows.push(b);
  writeJson(BOOKINGS_FILE,rows);
  return b;
}

async function getBooking(id) {
  if (usePostgres) {
    const { rows } = await pool.query("SELECT * FROM bookings WHERE id=$1",[id]);
    return rows[0] || null;
  }
  return readJson(BOOKINGS_FILE).find(b=>b.id===id) || null;
}

async function updateBooking(id, fields) {
  if (usePostgres) {
    const allowed = {
      status:"status", razorpay_payment_id:"razorpay_payment_id",
      qr_data_url:"qr_data_url", checked_in:"checked_in",
      checked_in_at:"checked_in_at"
    };
    const entries = Object.entries(fields).filter(([k])=>allowed[k]);
    if (!entries.length) return getBooking(id);
    const sets = entries.map(([k],i)=>`${allowed[k]}=$${i+1}`).join(",");
    const vals = entries.map(([,v])=>v);
    vals.push(id);
    await pool.query(`UPDATE bookings SET ${sets} WHERE id=$${vals.length}`, vals);
    return getBooking(id);
  }

  const rows = readJson(BOOKINGS_FILE);
  const idx = rows.findIndex(b=>b.id===id);
  if (idx < 0) return null;
  Object.assign(rows[idx],fields);
  writeJson(BOOKINGS_FILE,rows);
  return rows[idx];
}

async function listBookings() {
  if (usePostgres) {
    const { rows } = await pool.query(`
      SELECT b.*, e.name AS event_name
      FROM bookings b JOIN events e ON e.id=b.event_id
      ORDER BY b.created_at DESC
    `);
    return rows;
  }
  const map = Object.fromEntries(readJson(EVENTS_FILE).map(e=>[e.id,e.name]));
  return readJson(BOOKINGS_FILE)
    .sort((a,b)=>new Date(b.created_at)-new Date(a.created_at))
    .map(b=>({...b,event_name:map[b.event_id]||b.event_id}));
}

async function stats() {
  const rows = await listBookings();
  const confirmed = rows.filter(b=>["confirmed","demo-confirmed"].includes(b.status));
  return {
    total: rows.length,
    confirmed: confirmed.length,
    tickets: confirmed.reduce((s,b)=>s+Number(b.quantity||0),0),
    revenue: confirmed.reduce((s,b)=>s+Number(b.amount||0),0),
    checkedIn: rows.filter(b=>Boolean(b.checked_in)).length
  };
}

module.exports = {
  usePostgres, initDb, getEvents, createBooking, getBooking, updateBooking, listBookings, stats
};
