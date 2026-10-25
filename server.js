require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const mysql = require('mysql2/promise');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ---- Remote MySQL connection (credentials come from environment variables) ----
const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  ssl: process.env.DB_SSL === 'false' ? undefined : { rejectUnauthorized: false },
  waitForConnections: true,
  connectionLimit: 5,
  multipleStatements: true,
});

const wrap = (fn) => (req, res) =>
  fn(req, res).catch((e) => {
    console.error(e);
    res.status(e.status || 500).json({ error: e.status ? e.message : 'Server error: ' + e.message });
  });
const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });

// ---------- Health (shows which remote host the app is using) ----------
app.get('/api/health', wrap(async (req, res) => {
  const [[row]] = await pool.query('SELECT NOW() AS now, DATABASE() AS db');
  res.json({ ok: true, db_host: process.env.DB_HOST, database: row.db, server_time: row.now });
}));

// ---------- MENU: CRUD ----------
app.get('/api/menu', wrap(async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM menu_items ORDER BY category, name');
  res.json(rows);
}));

function validateItem(b) {
  const name = String(b.name || '').trim();
  const price = Number(b.price);
  const stock = Number(b.stock);
  if (!name) throw bad('Item name is required');
  if (!(price >= 0)) throw bad('Price must be 0 or more');
  if (!Number.isInteger(stock) || stock < 0) throw bad('Stock must be a whole number, 0 or more');
  return { name, category: String(b.category || 'Snacks').trim(), price, stock, is_special: b.is_special ? 1 : 0 };
}

app.post('/api/menu', wrap(async (req, res) => {
  const i = validateItem(req.body);
  const [r] = await pool.query(
    'INSERT INTO menu_items (name, category, price, stock, is_special) VALUES (?,?,?,?,?)',
    [i.name, i.category, i.price, i.stock, i.is_special]);
  res.status(201).json({ id: r.insertId, ...i });
}));

app.put('/api/menu/:id', wrap(async (req, res) => {
  const i = validateItem(req.body);
  const [r] = await pool.query(
    'UPDATE menu_items SET name=?, category=?, price=?, stock=?, is_special=? WHERE id=?',
    [i.name, i.category, i.price, i.stock, i.is_special, req.params.id]);
  if (!r.affectedRows) throw bad('Item not found', 404);
  res.json({ id: Number(req.params.id), ...i });
}));

app.delete('/api/menu/:id', wrap(async (req, res) => {
  const [r] = await pool.query('DELETE FROM menu_items WHERE id=?', [req.params.id]);
  if (!r.affectedRows) throw bad('Item not found', 404);
  res.json({ deleted: true });
}));

// ---------- ORDERS: CRUD (with stock deduction + daily token) ----------
app.get('/api/orders', wrap(async (req, res) => {
  const [orders] = await pool.query('SELECT * FROM orders ORDER BY created_at DESC, id DESC LIMIT 100');
  const ids = orders.map((o) => o.id);
  let items = [];
  if (ids.length) [items] = await pool.query('SELECT * FROM order_items WHERE order_id IN (?)', [ids]);
  res.json(orders.map((o) => ({ ...o, items: items.filter((x) => x.order_id === o.id) })));
}));

app.post('/api/orders', wrap(async (req, res) => {
  const customer = String(req.body.customer_name || '').trim();
  const lines = Array.isArray(req.body.items) ? req.body.items : [];
  if (!customer) throw bad('Customer name is required');
  if (!lines.length) throw bad('Add at least one item to the order');

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    let total = 0;
    const resolved = [];
    for (const l of lines) {
      const qty = Number(l.qty);
      if (!Number.isInteger(qty) || qty < 1) throw bad('Quantity must be 1 or more');
      const [[item]] = await conn.query('SELECT * FROM menu_items WHERE id=? FOR UPDATE', [l.menu_item_id]);
      if (!item) throw bad('An item in your cart no longer exists');
      if (item.stock < qty) throw bad(`Only ${item.stock} left of ${item.name}`);
      await conn.query('UPDATE menu_items SET stock = stock - ? WHERE id=?', [qty, item.id]);
      total += Number(item.price) * qty;
      resolved.push({ item, qty });
    }
    const [[t]] = await conn.query(
      'SELECT COALESCE(MAX(token_no),0)+1 AS next FROM orders WHERE DATE(created_at)=CURDATE() FOR UPDATE');
    const [o] = await conn.query(
      'INSERT INTO orders (token_no, customer_name, total) VALUES (?,?,?)', [t.next, customer, total]);
    for (const { item, qty } of resolved) {
      await conn.query(
        'INSERT INTO order_items (order_id, menu_item_id, item_name, qty, unit_price) VALUES (?,?,?,?,?)',
        [o.insertId, item.id, item.name, qty, item.price]);
    }
    await conn.commit();
    res.status(201).json({ id: o.insertId, token_no: t.next, total });
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}));

app.put('/api/orders/:id/status', wrap(async (req, res) => {
  const status = req.body.status;
  if (!['Preparing', 'Ready', 'Collected'].includes(status)) throw bad('Invalid status');
  const [r] = await pool.query('UPDATE orders SET status=? WHERE id=?', [status, req.params.id]);
  if (!r.affectedRows) throw bad('Order not found', 404);
  res.json({ id: Number(req.params.id), status });
}));

// Cancel an order and put the stock back
app.delete('/api/orders/:id', wrap(async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [items] = await conn.query('SELECT * FROM order_items WHERE order_id=?', [req.params.id]);
    for (const it of items) {
      if (it.menu_item_id) await conn.query('UPDATE menu_items SET stock = stock + ? WHERE id=?', [it.qty, it.menu_item_id]);
    }
    const [r] = await conn.query('DELETE FROM orders WHERE id=?', [req.params.id]);
    if (!r.affectedRows) throw bad('Order not found', 404);
    await conn.commit();
    res.json({ deleted: true });
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}));

// ---------- Start: create tables if missing, then listen ----------
async function init() {
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await pool.query(sql);
  const [[c]] = await pool.query('SELECT COUNT(*) AS n FROM menu_items');
  if (c.n === 0) {
    await pool.query(
      'INSERT INTO menu_items (name, category, price, stock, is_special) VALUES ?',
      [[
        ['Veg Biryani', 'Meals', 80, 40, 1],
        ['Masala Dosa', 'Tiffin', 45, 30, 0],
        ['Idli (2 pcs)', 'Tiffin', 25, 50, 0],
        ['Samosa', 'Snacks', 15, 60, 0],
        ['Filter Coffee', 'Drinks', 15, 80, 0],
      ]]);
  }
}

const PORT = process.env.PORT || 3000;
init()
  .then(() => app.listen(PORT, () => console.log('Canteen app running on port ' + PORT)))
  .catch((e) => { console.error('Could not connect to the database:', e.message); process.exit(1); });
