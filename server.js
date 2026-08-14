/* ========================================================================
   DIGITAL NOTICE BOARD - RENDER DEPLOYMENT BACKEND
   ======================================================================== */

const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const PORT = process.env.PORT || 5000;

// Create HTTP server and attach Socket.IO for realtime updates
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: '*' }
});

io.on('connection', (socket) => {
    console.log('WebSocket client connected:', socket.id);
    socket.on('disconnect', () => {
        console.log('WebSocket client disconnected:', socket.id);
    });
});

// Supabase Cloud Configuration & Credentials
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || '';

let supabase = null;
try {
    const { createClient } = require('@supabase/supabase-js');
    supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    console.log(`☁️ Supabase Cloud Client Initialized for: ${SUPABASE_URL}`);
} catch (err) {
    console.warn('⚠️ @supabase/supabase-js optional load notice:', err.message);
}
// Web Push (VAPID) Configuration
const webpush = require('web-push');
if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    webpush.setVapidDetails(
        process.env.VAPID_SUBJECT || 'mailto:srinumatha39@gmail.com',
        process.env.VAPID_PUBLIC_KEY,
        process.env.VAPID_PRIVATE_KEY
    );
    console.log('🔔 Web Push VAPID configured');
} else {
    console.warn('⚠️ VAPID keys not set — push notifications disabled');
}

async function sendPushToCollege(collegeId, notice) {
    if (!supabase) return;
    try {
        const { data: subscriptions, error } = await supabase
            .from('push_subscriptions')
            .select('*')
            .eq('college_id', collegeId);

        if (error) throw error;
        if (!subscriptions || subscriptions.length === 0) return;

        const payload = JSON.stringify({
            title: `📢 New ${notice.category || 'Notice'}`,
            body: notice.title,
            url: './index.html'
        });

        const sendPromises = subscriptions.map(async (row) => {
            try {
                await webpush.sendNotification(row.subscription, payload);
            } catch (err) {
                if (err.statusCode === 410 || err.statusCode === 404) {
                    await supabase.from('push_subscriptions').delete().eq('endpoint', row.endpoint);
                } else {
                    console.error('Push send error:', err.message);
                }
            }
        });

        await Promise.all(sendPromises);
        console.log(`Push sent to ${subscriptions.length} subscriber(s) for college ${collegeId}`);
    } catch (err) {
        console.error('sendPushToCollege failed:', err);
    }
}
// Directories
const FRONTEND_DIR = __dirname;
const DATA_DIR = path.join(__dirname, 'data');
const UPLOADS_DIR = path.join(__dirname, 'uploads');
const NOTICES_DB_FILE = path.join(DATA_DIR, 'notices.json');
const USERS_DB_FILE = path.join(DATA_DIR, 'users.json');

// Ensure data & upload directories exist
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// Production CORS Middleware
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static frontend files (index.html, style.css, script.js)
app.use(express.static(FRONTEND_DIR));

// Serve static uploaded attachment files
app.use('/uploads', express.static(UPLOADS_DIR));

// Configure Multer for File Uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOADS_DIR),
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const ext = path.extname(file.originalname);
        const nameWithoutExt = path.basename(file.originalname, ext).replace(/[^a-zA-Z0-9_\-]/g, '_');
        cb(null, `${nameWithoutExt}_${uniqueSuffix}${ext}`);
    }
});

const upload = multer({
    storage: storage,
    limits: { fileSize: 10 * 1024 * 1024 }
});

// Helper Functions - Notices DB
function readNoticesDB() {
    try {
        if (!fs.existsSync(NOTICES_DB_FILE)) return [];
        const raw = fs.readFileSync(NOTICES_DB_FILE, 'utf8');
        return JSON.parse(raw);
    } catch (err) {
        console.error('Error reading notices database:', err);
        return [];
    }
}

function writeNoticesDB(notices) {
    try {
        fs.writeFileSync(NOTICES_DB_FILE, JSON.stringify(notices, null, 2), 'utf8');
        return true;
    } catch (err) {
        console.error('Error writing notices database:', err);
        return false;
    }
}

// Helper Functions - Users DB
function readUsersDB() {
    try {
        if (!fs.existsSync(USERS_DB_FILE)) {
            const initialUsers = [
                { id: 'usr-admin-1', role: 'admin', name: 'College Administrator', collegeId: 'COLLEGE001', collegeName: 'Apex Institute of Technology', username: 'COLLEGE001', password: 'admin123', createdAt: new Date().toISOString() },
                { id: 'usr-student-1', role: 'student', name: 'Student Account', collegeId: 'COLLEGE001', username: '23A81A0501', password: 'student123', createdAt: new Date().toISOString() }
            ];
            writeUsersDB(initialUsers);
            return initialUsers;
        }
        const raw = fs.readFileSync(USERS_DB_FILE, 'utf8');
        return JSON.parse(raw);
    } catch (err) {
        console.error('Error reading users database:', err);
        return [];
    }
}

function writeUsersDB(users) {
    try {
        fs.writeFileSync(USERS_DB_FILE, JSON.stringify(users, null, 2), 'utf8');
        return true;
    } catch (err) {
        console.error('Error writing users database:', err);
        return false;
    }
}

// Frontend root
app.get('/', (req, res) => {
    res.sendFile(path.join(FRONTEND_DIR, 'index.html'));
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({
        status: 'online',
        service: 'Digital Notice Board Production REST API',
        renderUrl: `${req.protocol}://${req.get('host')}`,
        supabaseUrl: SUPABASE_URL,
        timestamp: new Date().toISOString()
    });
});

app.get('/api/config', (req, res) => {
    res.json({
        success: true,
        provider: 'Render + Supabase Cloud Backend',
        renderUrl: `${req.protocol}://${req.get('host')}`,
        supabaseUrl: SUPABASE_URL,
        status: 'online'
    });
});

// --------------------------------------------------------------------------
// 1. Colleges List API Endpoint
// --------------------------------------------------------------------------
app.get('/api/colleges', async (req, res) => {
    const users = readUsersDB();
    const adminUsers = users.filter(u => u.role === 'admin');
    
    const collegesMap = new Map();
    collegesMap.set('COLLEGE001', 'Apex Institute of Technology');

    adminUsers.forEach(admin => {
        const cId = admin.collegeId || admin.username;
        const cName = admin.collegeName || `${cId} College`;
        collegesMap.set(cId.toUpperCase(), cName);
    });

    const list = Array.from(collegesMap.entries()).map(([collegeId, collegeName]) => ({
        collegeId,
        collegeName
    }));

    res.json({
        success: true,
        supabaseUrl: SUPABASE_URL,
        colleges: list
    });
});

// --------------------------------------------------------------------------
// 2. Auth & Registration APIs
// --------------------------------------------------------------------------
app.post('/api/auth/register', async (req, res) => {
    const { role, name, username, password, collegeId, collegeName, collegeKey } = req.body;

    if (!role || !name || !username || !password) {
        return res.status(400).json({
            success: false,
            message: 'Role, Name, Username/ID, and Password are required.'
        });
    }

    const cleanUsername = username.trim().toUpperCase();
    const cleanName = name.trim();
    const users = readUsersDB();

    const assignedCollegeId = (role === 'admin' ? cleanUsername : (collegeId ? collegeId.trim().toUpperCase() : 'COLLEGE001'));
    const assignedCollegeName = (role === 'admin' ? (collegeName ? collegeName.trim() : `${cleanUsername} College Board`) : '');

    // For student registration: Verify College Admin Security Key to protect college information
    if (role === 'student') {
        const adminProfile = users.find(u => u.role === 'admin' && (u.collegeId === assignedCollegeId || u.username === assignedCollegeId));
        if (adminProfile && collegeKey !== adminProfile.password) {
            return res.status(403).json({
                success: false,
                message: `Security Key Error: Incorrect College Security Key for (${assignedCollegeId}). College information is protected.`
            });
        }
    }

    // Check duplicate
    const existingUser = users.find(u => u.username.toUpperCase() === cleanUsername && u.role === role);
    if (existingUser) {
        const idLabel = role === 'admin' ? 'College ID' : 'Roll Number';
        return res.status(409).json({
            success: false,
            message: `An account with this ${idLabel} (${cleanUsername}) already exists.`
        });
    }

    const newUser = {
        id: `usr-${role}-${Date.now()}`,
        role: role,
        name: cleanName,
        username: cleanUsername,
        collegeId: assignedCollegeId,
        collegeName: assignedCollegeName,
        password: password,
        createdAt: new Date().toISOString()
    };

    users.push(newUser);
    writeUsersDB(users);

    res.status(201).json({
        success: true,
        supabaseUrl: SUPABASE_URL,
        message: `${role === 'admin' ? 'College Admin' : 'Student'} account registered successfully! You can now log in.`,
        user: {
            role: newUser.role,
            name: newUser.name,
            username: newUser.username,
            collegeId: newUser.collegeId,
            collegeName: newUser.collegeName
        }
    });
});

app.post('/api/auth/login', (req, res) => {
    const { role, username, password, collegeId, collegeKey } = req.body;

    if (!role || !username || !password) {
        return res.status(400).json({
            success: false,
            message: 'Please provide role, username/ID, and password.'
        });
    }

    const cleanUsername = username.trim().toUpperCase();
    const users = readUsersDB();

    const matchedUser = users.find(u => 
        u.role === role && 
        u.username.toUpperCase() === cleanUsername && 
        u.password === password
    );

    if (matchedUser) {
        const targetCollegeId = matchedUser.collegeId || collegeId || 'COLLEGE001';
        
        // For student login: Verify College Admin Security Key to protect college information
        if (role === 'student') {
            const adminProfile = users.find(u => u.role === 'admin' && (u.collegeId === targetCollegeId || u.username === targetCollegeId));
            if (adminProfile && collegeKey !== adminProfile.password) {
                return res.status(403).json({
                    success: false,
                    message: `Security Key Error: Incorrect College Security Key for (${targetCollegeId}). College information is protected.`
                });
            }
        }

        const adminProfile = users.find(u => u.role === 'admin' && (u.collegeId === targetCollegeId || u.username === targetCollegeId));
        const resolvedCollegeName = matchedUser.collegeName || (adminProfile ? adminProfile.collegeName : `${targetCollegeId} Notice Portal`);

        return res.json({
            success: true,
            supabaseUrl: SUPABASE_URL,
            message: `${role === 'admin' ? 'College Admin' : 'Student'} login successful.`,
            user: {
                role: matchedUser.role,
                id: matchedUser.username,
                roll: matchedUser.username,
                name: matchedUser.name,
                collegeId: targetCollegeId,
                collegeName: resolvedCollegeName,
                token: `${matchedUser.role}-token-${Date.now()}`
            }
        });
    }

    const idLabel = role === 'admin' ? 'College ID' : 'Roll Number';
    return res.status(401).json({
        success: false,
        message: `Invalid ${idLabel} or Password.`
    });
});

// --------------------------------------------------------------------------
// 3. GET Notices (Multi-Tenant College Isolation)
// --------------------------------------------------------------------------
app.get('/api/notices', (req, res) => {
    let notices = readNoticesDB();
    const { collegeId, category, search } = req.query;

    if (collegeId) {
        const cId = collegeId.trim().toUpperCase();
        notices = notices.filter(n => (n.collegeId ? n.collegeId.toUpperCase() === cId : cId === 'COLLEGE001'));
    }

    if (category && category.toLowerCase() !== 'all') {
        notices = notices.filter(n => n.category.toLowerCase() === category.toLowerCase());
    }

    if (search) {
        const query = search.toLowerCase().trim();
        notices = notices.filter(n => 
            n.title.toLowerCase().includes(query) ||
            n.description.toLowerCase().includes(query) ||
            n.category.toLowerCase().includes(query)
        );
    }

    res.json({
        success: true,
        supabaseUrl: SUPABASE_URL,
        count: notices.length,
        notices: notices
    });
});
// --------------------------------------------------------------------------
// Push Notification Subscribe Endpoint
// --------------------------------------------------------------------------
app.post('/api/push/subscribe', async (req, res) => {
    const { collegeId, rollNumber, subscription } = req.body;

    if (!collegeId || !subscription || !subscription.endpoint) {
        return res.status(400).json({ success: false, message: 'Missing collegeId or subscription' });
    }

    if (!supabase) {
        return res.status(500).json({ success: false, message: 'Push storage not configured' });
    }

    try {
        const { error } = await supabase
            .from('push_subscriptions')
            .upsert(
                {
                    college_id: collegeId.toUpperCase(),
                    roll_number: rollNumber || null,
                    endpoint: subscription.endpoint,
                    subscription: subscription
                },
                { onConflict: 'endpoint' }
            );

        if (error) throw error;
        res.status(201).json({ success: true });
    } catch (err) {
        console.error('Error saving push subscription:', err);
        res.status(500).json({ success: false, message: 'Failed to save subscription' });
    }
});
// --------------------------------------------------------------------------
// 4. POST Create Notice
// --------------------------------------------------------------------------
app.post('/api/notices', upload.single('attachment'), async (req, res) => {
    const { title, category, publishDate, expiryDate, description, collegeId } = req.body;

    if (!title || !category || !publishDate || !description) {
        return res.status(400).json({
            success: false,
            message: 'Title, category, publish date, and description are required.'
        });
    }

    const notices = readNoticesDB();
    let attachmentObj = null;

    if (req.file) {
        const fileSizeMB = (req.file.size / (1024 * 1024)).toFixed(2);
        const fileSizeKB = (req.file.size / 1024).toFixed(0);
        attachmentObj = {
            name: req.file.originalname,
            filename: req.file.filename,
            size: req.file.size > 1024 * 1024 ? `${fileSizeMB} MB` : `${fileSizeKB} KB`,
            type: req.file.mimetype,
            url: `/uploads/${req.file.filename}`
        };
    } else if (req.body.attachmentName) {
        attachmentObj = {
            name: req.body.attachmentName,
            size: req.body.attachmentSize || 'Attachment',
            type: req.body.attachmentType || 'application/octet-stream',
            url: req.body.attachmentDataUrl || null
        };
    }

    const assignedCollegeId = (collegeId ? collegeId.trim().toUpperCase() : 'COLLEGE001');

    const newNotice = {
        id: 'notice-' + Date.now(),
        collegeId: assignedCollegeId,
        title: title.trim(),
        category: category.trim(),
        publishDate: publishDate,
        expiryDate: expiryDate || null,
        description: description.trim(),
        attachment: attachmentObj,
        createdAt: new Date().toISOString()
    };

    notices.unshift(newNotice);
    writeNoticesDB(notices);

    // Emit realtime event
    try { io.emit('notice_created', { notice: newNotice }); } catch (err) { console.warn('Socket emit failed:', err.message); }
// Send push notifications to students of this college
    sendPushToCollege(assignedCollegeId, newNotice);
    res.status(201).json({
        success: true,
        supabaseUrl: SUPABASE_URL,
        message: 'Notice published successfully!',
        notice: newNotice
    });
});

// --------------------------------------------------------------------------
// 5. PUT Update Notice
// --------------------------------------------------------------------------
app.put('/api/notices/:id', upload.single('attachment'), (req, res) => {
    const { id } = req.params;
    const { title, category, publishDate, expiryDate, description } = req.body;

    const notices = readNoticesDB();
    const index = notices.findIndex(n => n.id === id);

    if (index === -1) {
        return res.status(404).json({ success: false, message: 'Notice not found.' });
    }

    let existingNotice = notices[index];
    let attachmentObj = existingNotice.attachment;

    if (req.file) {
        if (existingNotice.attachment && existingNotice.attachment.filename) {
            const oldPath = path.join(UPLOADS_DIR, existingNotice.attachment.filename);
            if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
        }

        const fileSizeMB = (req.file.size / (1024 * 1024)).toFixed(2);
        const fileSizeKB = (req.file.size / 1024).toFixed(0);
        attachmentObj = {
            name: req.file.originalname,
            filename: req.file.filename,
            size: req.file.size > 1024 * 1024 ? `${fileSizeMB} MB` : `${fileSizeKB} KB`,
            type: req.file.mimetype,
            url: `/uploads/${req.file.filename}`
        };
    }

    const updatedNotice = {
        ...existingNotice,
        title: title ? title.trim() : existingNotice.title,
        category: category ? category.trim() : existingNotice.category,
        publishDate: publishDate || existingNotice.publishDate,
        expiryDate: expiryDate !== undefined ? expiryDate : existingNotice.expiryDate,
        description: description ? description.trim() : existingNotice.description,
        attachment: attachmentObj
    };

    notices[index] = updatedNotice;
    writeNoticesDB(notices);

    // Emit realtime update
    try { io.emit('notice_updated', { notice: updatedNotice }); } catch (err) { console.warn('Socket emit failed:', err.message); }

    res.json({
        success: true,
        supabaseUrl: SUPABASE_URL,
        message: 'Notice updated successfully.',
        notice: updatedNotice
    });
});

// --------------------------------------------------------------------------
// 6. DELETE Notice
// --------------------------------------------------------------------------
app.delete('/api/notices/:id', (req, res) => {
    const { id } = req.params;
    const notices = readNoticesDB();
    const noticeToDelete = notices.find(n => n.id === id);

    if (!noticeToDelete) {
        return res.status(404).json({ success: false, message: 'Notice not found.' });
    }

    if (noticeToDelete.attachment && noticeToDelete.attachment.filename) {
        const filePath = path.join(UPLOADS_DIR, noticeToDelete.attachment.filename);
        if (fs.existsSync(filePath)) {
            try { fs.unlinkSync(filePath); } catch (err) {}
        }
    }

    const updatedNotices = notices.filter(n => n.id !== id);
    writeNoticesDB(updatedNotices);

    // Emit realtime delete
    try { io.emit('notice_deleted', { id }); } catch (err) { console.warn('Socket emit failed:', err.message); }

    res.json({
        success: true,
        supabaseUrl: SUPABASE_URL,
        message: 'Notice deleted successfully.'
    });
});

// --------------------------------------------------------------------------
// 7. GET Analytics / Stats
// --------------------------------------------------------------------------
app.get('/api/stats', (req, res) => {
    let notices = readNoticesDB();
    const { collegeId } = req.query;

    if (collegeId) {
        const cId = collegeId.trim().toUpperCase();
        notices = notices.filter(n => (n.collegeId ? n.collegeId.toUpperCase() === cId : cId === 'COLLEGE001'));
    }

    const total = notices.length;
    const exams = notices.filter(n => n.category === 'Exams').length;
    const events = notices.filter(n => n.category === 'Events').length;

    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const recent = notices.filter(n => new Date(n.publishDate) >= sevenDaysAgo).length;

    res.json({
        success: true,
        supabaseUrl: SUPABASE_URL,
        stats: { total, exams, events, recent }
    });
});

// Start Server
server.listen(PORT, () => {
    console.log(`====================================================`);
    console.log(`Digital Notice Board Online Production Server`);
    console.log(`Frontend:               http://localhost:${PORT}`);
    console.log(`Supabase configured:    ${Boolean(SUPABASE_URL && SUPABASE_ANON_KEY)}`);
    console.log(`Server Listening Port:  ${PORT}`);
    console.log(`Socket.IO ready for realtime updates`);
    console.log(`====================================================`);
});
