# 🎬 CineVault — Streaming Web App

Platform streaming film, anime, K-Drama, dan series dengan backend proxy untuk mengatasi CORS.

---

## 🏗️ Struktur Project

```
cinevault/
├── server.js          ← Express backend proxy (mengatasi CORS)
├── package.json
├── .env
└── public/
    └── index.html     ← Frontend app (HTML/CSS/JS)
```

---

## ⚙️ Cara Menjalankan (Lokal)

### 1. Install Node.js
Download dari https://nodejs.org (versi 14 ke atas)

### 2. Install dependencies
```bash
npm install
```

### 3. Jalankan server
```bash
npm start
```

### 4. Buka browser
```
http://localhost:3000
```

---

## 🚀 Deploy ke Railway / Render (Gratis)

### Railway
1. Buat akun di https://railway.app
2. Klik **New Project → Deploy from GitHub**
3. Upload folder ini / connect ke repo
4. Railway otomatis detect `package.json` dan menjalankan `npm start`
5. Akses URL yang diberikan Railway

### Render
1. Buat akun di https://render.com
2. **New → Web Service**
3. Connect repo / upload folder
4. Build Command: `npm install`
5. Start Command: `node server.js`
6. Free tier tersedia

### VPS (Ubuntu)
```bash
# Install Node
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt install -y nodejs

# Clone / upload project
cd /var/www/cinevault
npm install

# Jalankan dengan PM2 (process manager)
npm install -g pm2
pm2 start server.js --name cinevault
pm2 startup
pm2 save
```

---

## 🔧 Cara Kerja

```
Browser → GET /api?action=trending
           ↓
      Express server.js
           ↓
      fetch() ke zeldvorik.ru   ← tidak ada CORS karena ini server-to-server
           ↓
      JSON dikembalikan ke browser
```

Karena `fetch()` di `server.js` dilakukan **server-side** (Node.js), tidak ada batasan CORS. CORS hanya berlaku untuk request dari browser.

---

## 📡 API Endpoints (Proxy)

| Endpoint | Keterangan |
|----------|-----------|
| `GET /api?action=trending&page=1` | Konten trending |
| `GET /api?action=anime&page=1` | Anime |
| `GET /api?action=kdrama&page=1` | K-Drama |
| `GET /api?action=indonesian-movies&page=1` | Film Indonesia |
| `GET /api?action=indonesian-drama&page=1` | Drama Indonesia |
| `GET /api?action=short-tv&page=1` | Short TV |
| `GET /api?action=search&q=naruto` | Search |
| `GET /api?action=detail&detailPath=...` | Detail film/series |
| `GET /health` | Health check |

---

## ✨ Fitur

- Hero slider trending dengan auto-slide
- 6 kategori konten dengan infinite scroll
- Search real-time dengan debounce
- Detail page dengan daftar episode
- Video player overlay
- Watchlist (disimpan di localStorage)
- Skeleton loading
- Responsive mobile/tablet/desktop
- Dark theme premium
