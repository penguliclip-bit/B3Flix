// server.js — CineVault Backend Proxy

const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

// FIX node-fetch (CommonJS compatible)
const fetch = (...args) =>
  import('node-fetch').then(({ default: fetch }) => fetch(...args));

const app = express();
const PORT = process.env.PORT || 3000;
const API_BASE = 'https://zeldvorik.ru/apiv3/api.php';

// Allowed actions (whitelist)
const ALLOWED_ACTIONS = [
  'trending',
  'indonesian-movies',
  'indonesian-drama',
  'kdrama',
  'short-tv',
  'anime',
  'indo-dub',
  'search',
  'detail'
];

app.use(cors());
app.use(express.json());

// Serve static HTML dari folder public
app.use(express.static(path.join(__dirname, 'public')));

// ─── PROXY ENDPOINT ─────────────────────────
app.get('/api', async (req, res) => {
  const { action, page, q, detailPath } = req.query;

  if (!action || !ALLOWED_ACTIONS.includes(action)) {
    return res.status(400).json({ success: false, error: 'Invalid action' });
  }

  const params = new URLSearchParams({ action });
  if (page) params.set('page', page);
  if (q) params.set('q', q);
  if (detailPath) params.set('detailPath', detailPath);

  const targetUrl = `${API_BASE}?${params.toString()}`;

  try {
    console.log(`[PROXY] → ${targetUrl}`);

    const response = await fetch(targetUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0',
        'Accept': 'application/json',
        'Referer': 'https://zeldvorik.ru/',
      }
    });

    if (!response.ok) {
      throw new Error(`Upstream HTTP ${response.status}`);
    }

    const data = await response.json();
    console.log(`[PROXY] ✓ action=${action} items=${data?.items?.length ?? '?'}`);

    const isDetail = action === 'detail';
    res.set('Cache-Control', isDetail ? 'public, max-age=600' : 'public, max-age=300');
    res.json(data);

  } catch (err) {
    console.error(`[PROXY] ✗ ${err.message}`);
    res.status(502).json({
      success: false,
      error: 'Gagal mengambil data dari upstream',
      detail: err.message
    });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime(), port: PORT });
});

// Catch-all → index.html (SPA)
app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`\n🎬 CineVault Proxy Server`);
  console.log(`─────────────────────────`);
  console.log(`✅ Running at  http://localhost:${PORT}`);
  console.log(`📡 Proxying    ${API_BASE}`);
  console.log(`─────────────────────────\n`);
});