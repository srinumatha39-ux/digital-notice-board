/* ==========================================================================
   DIGITAL NOTICE BOARD - ONLINE SUPABASE & RENDER PRODUCTION BACKEND
   ========================================================================== */

const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const PORT = process.env.PORT || 5000;

// Create HTTP server and attach Socket.IO
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

io.on('connection', (socket) => {
  console.log('WebSocket client connected:', socket.id);
  socket.on('disconnect', () => console.log('WebSocket client disconnected:', socket.id));
});

// Supabase Config (from environment variables)
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

let supabase = null;
try {
  const { createClient } = require('@supabase/supabase-js');
  supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  console.log(`☁️ Supabase Client Initialized for: ${SUPABASE_URL}`);
} catch (err) {
  console.warn('⚠️ Supabase client load failed:', err.message);
}

// Directories
const FRONTEND_DIR = path.join(__dirname, 'public');
const DATA_DIR = path.join(__dirname, 'data');
const UPLOADS_DIR = path.join(__dirname, 'uploads');
const NOTICES_DB_FILE = path.join(DATA_DIR, 'notices.json');
const USERS_DB_FILE = path.join(DATA_DIR, 'users.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// Middleware
app.use(cors({ origin: '*', methods: ['GET','POST','PUT','DELETE'], allowedHeaders: ['Content-Type','Authorization'] }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve frontend
app.use(express.static(FRONTEND_DIR));

// Serve uploads
app.use('/uploads', express.static(UPLOADS_DIR));

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'online',
    service: 'Digital Notice Board REST API',
    renderUrl: process.env.RENDER_EXTERNAL_URL || 'http://localhost:5000',
    supabaseUrl: SUPABASE_URL,
    timestamp: new Date().toISOString()
  });
});

// … keep your existing Auth, Notices, Stats endpoints here (unchanged) …

// Start Server
server.listen(PORT, () => {
  console.log(`====================================================`);
  console.log(`Digital Notice Board Server running`);
  console.log(`Render URL: ${process.env.RENDER_EXTERNAL_URL || 'http://localhost:5000'}`);
  console.log(`Supabase URL: ${SUPABASE_URL}`);
  console.log(`Port: ${PORT}`);
  console.log(`====================================================`);
});
