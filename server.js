import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, 'public')));

const required = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY'];
const missing = required.filter(k => !process.env[k]);
const supabaseAdmin = missing.length ? null : createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

function ready(res) {
  if (!supabaseAdmin) {
    res.status(503).json({ error: 'Store setup is incomplete. Add Supabase credentials to .env and restart the server.' });
    return false;
  }
  return true;
}
async function getUser(req, res) {
  if (!ready(res)) return null;
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) { res.status(401).json({ error: 'Please log in first.' }); return null; }
  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data.user) { res.status(401).json({ error: 'Your session has expired. Please log in again.' }); return null; }
  return data.user;
}
async function isAdmin(user) {
  const { data } = await supabaseAdmin.from('profiles').select('is_admin').eq('id', user.id).maybeSingle();
  return !!data?.is_admin;
}

app.get('/api/config', (_req, res) => res.json({
  supabaseUrl: process.env.SUPABASE_URL || '',
  supabaseAnonKey: process.env.SUPABASE_ANON_KEY || '',
  whatsapp: process.env.WHATSAPP_NUMBER || ''
}));

app.get('/api/products', async (_req, res) => {
  if (!ready(res)) return;
  const { data, error } = await supabaseAdmin.from('products')
    .select('id,name,description,price,image_url,category,stock,is_active')
    .eq('is_active', true).order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: 'Could not load products.' });
  res.json(data || []);
});

app.get('/api/me', async (req, res) => {
  const user = await getUser(req, res); if (!user) return;
  const { data: profile } = await supabaseAdmin.from('profiles')
    .select('full_name,phone,is_admin').eq('id', user.id).maybeSingle();
  res.json({ user: { id: user.id, email: user.email }, profile: profile || {} });
});

app.put('/api/profile', async (req, res) => {
  const user = await getUser(req, res); if (!user) return;
  const full_name = String(req.body.full_name || '').trim().slice(0, 100);
  const phone = String(req.body.phone || '').trim().slice(0, 30);
  const { error } = await supabaseAdmin.from('profiles')
    .upsert({ id: user.id, full_name, phone }, { onConflict: 'id' });
  if (error) return res.status(400).json({ error: 'Could not save profile.' });
  res.json({ ok: true });
});

app.post('/api/orders', async (req, res) => {
  const user = await getUser(req, res); if (!user) return;
  const items = Array.isArray(req.body.items) ? req.body.items : [];
  const address = String(req.body.delivery_address || '').trim().slice(0, 500);
  if (!items.length || items.length > 30 || !address) return res.status(400).json({ error: 'Add items and a delivery address.' });

  const ids = [...new Set(items.map(x => Number(x.id)).filter(Number.isInteger))];
  if (!ids.length) return res.status(400).json({ error: 'Invalid basket.' });
  const { data: products, error: pErr } = await supabaseAdmin.from('products')
    .select('id,name,price,stock,is_active').in('id', ids);
  if (pErr || !products) return res.status(400).json({ error: 'Could not validate basket.' });

  let total = 0, cleanItems = [];
  for (const item of items) {
    const product = products.find(p => p.id === Number(item.id));
    const qty = Math.max(0, Math.min(20, Math.floor(Number(item.qty))));
    if (!product || !product.is_active || !qty || qty > product.stock) {
      return res.status(400).json({ error: 'One or more products are unavailable or have insufficient stock. Refresh your basket.' });
    }
    total += Number(product.price) * qty;
    cleanItems.push({ product_id: product.id, name: product.name, unit_price: product.price, quantity: qty });
  }
  const { data: order, error } = await supabaseAdmin.from('orders').insert({
    user_id: user.id, items: cleanItems, total, delivery_address: address, status: 'pending'
  }).select('id,total,status').single();
  if (error) return res.status(500).json({ error: 'Could not place your order.' });
  // Payment is intentionally not marked as paid here. Configure a verified payment provider before taking live payments.
  res.status(201).json({ order, message: 'Order request saved. Payment is not yet enabled; the store owner must contact you to confirm payment and delivery.' });
});

app.get('/api/orders', async (req, res) => {
  const user = await getUser(req, res); if (!user) return;
  const { data, error } = await supabaseAdmin.from('orders')
    .select('id,items,total,status,delivery_address,created_at')
    .eq('user_id', user.id).order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: 'Could not load order history.' });
  res.json(data || []);
});

app.get('/api/admin/summary', async (req, res) => {
  const user = await getUser(req, res); if (!user) return;
  if (!(await isAdmin(user))) return res.status(403).json({ error: 'Admin access required.' });
  const [{ data: products }, { data: orders }] = await Promise.all([
    supabaseAdmin.from('products').select('*').order('created_at', { ascending: false }),
    supabaseAdmin.from('orders').select('*').order('created_at', { ascending: false }).limit(100)
  ]);
  res.json({ products: products || [], orders: orders || [] });
});

app.post('/api/admin/products', async (req, res) => {
  const user = await getUser(req, res); if (!user) return;
  if (!(await isAdmin(user))) return res.status(403).json({ error: 'Admin access required.' });
  const p = req.body || {};
  const record = {
    name: String(p.name || '').trim().slice(0, 120),
    description: String(p.description || '').trim().slice(0, 500),
    price: Number(p.price), image_url: String(p.image_url || '').trim().slice(0, 1000),
    category: String(p.category || 'Hair').trim().slice(0, 80),
    stock: Math.max(0, Math.floor(Number(p.stock) || 0)), is_active: p.is_active !== false
  };
  if (!record.name || !Number.isFinite(record.price) || record.price <= 0) return res.status(400).json({ error: 'Enter a product name and valid price.' });
  const { data, error } = await supabaseAdmin.from('products').insert(record).select().single();
  if (error) return res.status(400).json({ error: 'Could not add product.' });
  res.status(201).json(data);
});

app.patch('/api/admin/products/:id', async (req, res) => {
  const user = await getUser(req, res); if (!user) return;
  if (!(await isAdmin(user))) return res.status(403).json({ error: 'Admin access required.' });
  const allowed = ['name','description','price','image_url','category','stock','is_active'];
  const patch = Object.fromEntries(Object.entries(req.body || {}).filter(([k]) => allowed.includes(k)));
  const { data, error } = await supabaseAdmin.from('products').update(patch).eq('id', Number(req.params.id)).select().single();
  if (error) return res.status(400).json({ error: 'Could not update product.' });
  res.json(data);
});

app.patch('/api/admin/orders/:id', async (req, res) => {
  const user = await getUser(req, res); if (!user) return;
  if (!(await isAdmin(user))) return res.status(403).json({ error: 'Admin access required.' });
  const statuses = ['pending','confirmed','processing','shipped','completed','cancelled'];
  const status = String(req.body.status || '');
  if (!statuses.includes(status)) return res.status(400).json({ error: 'Invalid order status.' });
  const { data, error } = await supabaseAdmin.from('orders').update({ status }).eq('id', Number(req.params.id)).select().single();
  if (error) return res.status(400).json({ error: 'Could not update order.' });
  res.json(data);
});

app.get('*', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
const port = Number(process.env.PORT || 3000);
app.listen(port, () => console.log(`NamiLuxe running at http://localhost:${port}`));
