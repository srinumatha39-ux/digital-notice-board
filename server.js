/* ========================================================================
   DIGITAL NOTICE BOARD - RENDER + SUPABASE BACKEND (CORRECTED)
   All data now persists in real Supabase tables / Storage, not local disk.
   ======================================================================== */

const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const http = require('http');
const { Server } = require('socket.io');
const { createClient } = require('@supabase/supabase-js');
const webpush = require('web-push');

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

// --------------------------------------------------------------------------
// Supabase Client — uses the SERVICE ROLE key (server-side only).
// This is safe here because the browser never talks to Supabase directly;
// it only talks to this Express server. The service role key bypasses RLS,
// so you don't need to write any RLS policies for this app to work.
// --------------------------------------------------------------------------
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars. Data will NOT persist.');
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false }
});

const ATTACHMENTS_BUCKET = 'attachments';

// Web Push (VAPID) Configuration
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

// Directories (frontend static files only — no data lives on disk anymore)
const FRONTEND_DIR = __dirname;

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

// Multer: hold uploads in memory, then push the buffer to Supabase Storage
// (Render's disk is wiped on every restart, so we never write files to disk)
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 }
});

async function uploadAttachmentToSupabase(file) {
    const ext = path.extname(file.originalname);
    const base = path.basename(file.originalname, ext).replace(/[^a-zA-Z0-9_\-]/g, '_');
    const storagePath = `${Date.now()}-${Math.round(Math.random() * 1e9)}-${base}${ext}`;

    const { error } = await supabase.storage
        .from(ATTACHMENTS_BUCKET)
        .upload(storagePath, file.buffer, { contentType: file.mimetype });

    if (error) throw error;

    const { data: publicUrlData } = supabase.storage
        .from(ATTACHMENTS_BUCKET)
        .getPublicUrl(storagePath);

    const fileSizeMB = (file.size / (1024 * 1024)).toFixed(2);
    const fileSizeKB = (file.size / 1024).toFixed(0);

    return {
        name: file.originalname,
        path: storagePath,
        size: file.size > 1024 * 1024 ? `${fileSizeMB} MB` : `${fileSizeKB} KB`,
        type: file.mimetype,
        url: publicUrlData.publicUrl
    };
}

async function deleteAttachmentFromSupabase(storagePath) {
    if (!storagePath) return;
    try {
        await supabase.storage.from(ATTACHMENTS_BUCKET).remove([storagePath]);
    } catch (err) {
        console.warn('Failed to delete old attachment:', err.message);
    }
}

// Frontend root
app.get('/', (req, res) => {
    res.sendFile(path.join(FRONTEND_DIR, 'index.html'));
});

// Health check endpoint
app.get('/health', async (req, res) => {
    let dbConnected = false;
    try {
        const { error } = await supabase.from('notices').select('id').limit(1);
        dbConnected = !error;
    } catch (err) {
        dbConnected = false;
    }

    res.json({
        status: 'online',
        service: 'Digital Notice Board Production REST API',
        renderUrl: `${req.protocol}://${req.get('host')}`,
        supabaseUrl: SUPABASE_URL,
        supabaseConnected: dbConnected,
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
    try {
        const { data: admins, error } = await supabase
            .from('users')
            .select('college_id, college_name')
            .eq('role', 'admin');

        if (error) throw error;

        const collegesMap = new Map();
        collegesMap.set('COLLEGE001', 'Apex Institute of Technology');

        (admins || []).forEach(admin => {
            const cId = (admin.college_id || '').toUpperCase();
            if (!cId) return;
            collegesMap.set(cId, admin.college_name || `${cId} College`);
        });

        const list = Array.from(collegesMap.entries()).map(([collegeId, collegeName]) => ({
            collegeId,
            collegeName
        }));

        res.json({ success: true, supabaseUrl: SUPABASE_URL, colleges: list });
    } catch (err) {
        console.error('GET /api/colleges failed:', err);
        res.status(500).json({ success: false, message: 'Failed to load colleges.' });
    }
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

    try {
        const assignedCollegeId = (role === 'admin' ? cleanUsername : (collegeId ? collegeId.trim().toUpperCase() : 'COLLEGE001'));
        const assignedCollegeName = (role === 'admin' ? (collegeName ? collegeName.trim() : `${cleanUsername} College Board`) : null);

        if (role === 'student') {
            const { data: adminProfile } = await supabase
                .from('users')
                .select('*')
                .eq('role', 'admin')
                .or(`college_id.eq.${assignedCollegeId},username.eq.${assignedCollegeId}`)
                .maybeSingle();

            if (adminProfile && collegeKey !== adminProfile.password) {
                return res.status(403).json({
                    success: false,
                    message: `Security Key Error: Incorrect College Security Key for (${assignedCollegeId}). College information is protected.`
                });
            }
        }

        const { data: existingUser } = await supabase
            .from('users')
            .select('id')
            .eq('username', cleanUsername)
            .eq('role', role)
            .maybeSingle();

        if (existingUser) {
            const idLabel = role === 'admin' ? 'College ID' : 'Roll Number';
            return res.status(409).json({
                success: false,
                message: `An account with this ${idLabel} (${cleanUsername}) already exists.`
            });
        }

        const newUser = {
            id: `usr-${role}-${Date.now()}`,
            role,
            name: cleanName,
            username: cleanUsername,
            college_id: assignedCollegeId,
            college_name: assignedCollegeName,
            password
        };

        const { error: insertError } = await supabase.from('users').insert(newUser);
        if (insertError) throw insertError;

        res.status(201).json({
            success: true,
            supabaseUrl: SUPABASE_URL,
            message: `${role === 'admin' ? 'College Admin' : 'Student'} account registered successfully! You can now log in.`,
            user: {
                role: newUser.role,
                name: newUser.name,
                username: newUser.username,
                collegeId: newUser.college_id,
                collegeName: newUser.college_name
            }
        });
    } catch (err) {
        console.error('POST /api/auth/register failed:', err);
        res.status(500).json({ success: false, message: 'Registration failed. Please try again.' });
    }
});

app.post('/api/auth/login', async (req, res) => {
    const { role, username, password, collegeId, collegeKey } = req.body;

    if (!role || !username || !password) {
        return res.status(400).json({
            success: false,
            message: 'Please provide role, username/ID, and password.'
        });
    }

    const cleanUsername = username.trim().toUpperCase();

    try {
        const { data: matchedUser } = await supabase
            .from('users')
            .select('*')
            .eq('role', role)
            .eq('username', cleanUsername)
            .eq('password', password)
            .maybeSingle();

        if (matchedUser) {
            const targetCollegeId = matchedUser.college_id || collegeId || 'COLLEGE001';

            if (role === 'student') {
                const { data: adminProfile } = await supabase
                    .from('users')
                    .select('*')
                    .eq('role', 'admin')
                    .or(`college_id.eq.${targetCollegeId},username.eq.${targetCollegeId}`)
                    .maybeSingle();

                if (adminProfile && collegeKey !== adminProfile.password) {
                    return res.status(403).json({
                        success: false,
                        message: `Security Key Error: Incorrect College Security Key for (${targetCollegeId}). College information is protected.`
                    });
                }
            }

            const { data: adminProfile2 } = await supabase
                .from('users')
                .select('*')
                .eq('role', 'admin')
                .or(`college_id.eq.${targetCollegeId},username.eq.${targetCollegeId}`)
                .maybeSingle();

            const resolvedCollegeName = matchedUser.college_name || (adminProfile2 ? adminProfile2.college_name : `${targetCollegeId} Notice Portal`);

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
    } catch (err) {
        console.error('POST /api/auth/login failed:', err);
        res.status(500).json({ success: false, message: 'Login failed. Please try again.' });
    }
});

// --------------------------------------------------------------------------
// 3. GET Notices (Multi-Tenant College Isolation)
// --------------------------------------------------------------------------
app.get('/api/notices', async (req, res) => {
    const { collegeId, category, search } = req.query;

    try {
        let query = supabase.from('notices').select('*').order('created_at', { ascending: false });

        if (collegeId) {
            query = query.eq('college_id', collegeId.trim().toUpperCase());
        }
        if (category && category.toLowerCase() !== 'all') {
            query = query.ilike('category', category);
        }
        if (search) {
            const q = search.trim();
            query = query.or(`title.ilike.%${q}%,description.ilike.%${q}%,category.ilike.%${q}%`);
        }

        const { data: notices, error } = await query;
        if (error) throw error;

        res.json({
            success: true,
            supabaseUrl: SUPABASE_URL,
            count: notices.length,
            notices: notices.map(rowToNotice)
        });
    } catch (err) {
        console.error('GET /api/notices failed:', err);
        res.status(500).json({ success: false, message: 'Failed to load notices.' });
    }
});

function rowToNotice(row) {
    return {
        id: row.id,
        collegeId: row.college_id,
        title: row.title,
        category: row.category,
        publishDate: row.publish_date,
        expiryDate: row.expiry_date,
        description: row.description,
        attachment: row.attachment,
        createdAt: row.created_at
    };
}

// --------------------------------------------------------------------------
// Push Notification Subscribe Endpoint
// --------------------------------------------------------------------------
app.post('/api/push/subscribe', async (req, res) => {
    const { collegeId, rollNumber, subscription } = req.body;

    if (!collegeId || !subscription || !subscription.endpoint) {
        return res.status(400).json({ success: false, message: 'Missing collegeId or subscription' });
    }

    try {
        const { error } = await supabase
            .from('push_subscriptions')
            .upsert(
                {
                    college_id: collegeId.toUpperCase(),
                    roll_number: rollNumber || null,
                    endpoint: subscription.endpoint,
                    subscription
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

    try {
        let attachmentObj = null;
        if (req.file) {
            attachmentObj = await uploadAttachmentToSupabase(req.file);
        } else if (req.body.attachmentName) {
            attachmentObj = {
                name: req.body.attachmentName,
                size: req.body.attachmentSize || 'Attachment',
                type: req.body.attachmentType || 'application/octet-stream',
                url: req.body.attachmentDataUrl || null
            };
        }

        const assignedCollegeId = (collegeId ? collegeId.trim().toUpperCase() : 'COLLEGE001');

        const newNoticeRow = {
            id: 'notice-' + Date.now(),
            college_id: assignedCollegeId,
            title: title.trim(),
            category: category.trim(),
            publish_date: publishDate,
            expiry_date: expiryDate || null,
            description: description.trim(),
            attachment: attachmentObj
        };

        const { data: inserted, error } = await supabase
            .from('notices')
            .insert(newNoticeRow)
            .select()
            .single();

        if (error) throw error;

        const newNotice = rowToNotice(inserted);

        try { io.emit('notice_created', { notice: newNotice }); } catch (err) { console.warn('Socket emit failed:', err.message); }
        sendPushToCollege(assignedCollegeId, newNotice);

        res.status(201).json({
            success: true,
            supabaseUrl: SUPABASE_URL,
            message: 'Notice published successfully!',
            notice: newNotice
        });
    } catch (err) {
        console.error('POST /api/notices failed:', err);
        res.status(500).json({ success: false, message: 'Failed to save notice.' });
    }
});

// --------------------------------------------------------------------------
// 5. PUT Update Notice
// --------------------------------------------------------------------------
app.put('/api/notices/:id', upload.single('attachment'), async (req, res) => {
    const { id } = req.params;
    const { title, category, publishDate, expiryDate, description } = req.body;

    try {
        const { data: existing, error: fetchError } = await supabase
            .from('notices')
            .select('*')
            .eq('id', id)
            .maybeSingle();

        if (fetchError) throw fetchError;
        if (!existing) {
            return res.status(404).json({ success: false, message: 'Notice not found.' });
        }

        let attachmentObj = existing.attachment;

        if (req.file) {
            if (existing.attachment && existing.attachment.path) {
                await deleteAttachmentFromSupabase(existing.attachment.path);
            }
            attachmentObj = await uploadAttachmentToSupabase(req.file);
        }

        const updateRow = {
            title: title ? title.trim() : existing.title,
            category: category ? category.trim() : existing.category,
            publish_date: publishDate || existing.publish_date,
            expiry_date: expiryDate !== undefined ? expiryDate : existing.expiry_date,
            description: description ? description.trim() : existing.description,
            attachment: attachmentObj
        };

        const { data: updated, error: updateError } = await supabase
            .from('notices')
            .update(updateRow)
            .eq('id', id)
            .select()
            .single();

        if (updateError) throw updateError;

        const updatedNotice = rowToNotice(updated);
        try { io.emit('notice_updated', { notice: updatedNotice }); } catch (err) { console.warn('Socket emit failed:', err.message); }

        res.json({
            success: true,
            supabaseUrl: SUPABASE_URL,
            message: 'Notice updated successfully.',
            notice: updatedNotice
        });
    } catch (err) {
        console.error('PUT /api/notices/:id failed:', err);
        res.status(500).json({ success: false, message: 'Failed to update notice.' });
    }
});

// --------------------------------------------------------------------------
// 6. DELETE Notice
// --------------------------------------------------------------------------
app.delete('/api/notices/:id', async (req, res) => {
    const { id } = req.params;

    try {
        const { data: existing } = await supabase
            .from('notices')
            .select('*')
            .eq('id', id)
            .maybeSingle();

        if (!existing) {
            return res.status(404).json({ success: false, message: 'Notice not found.' });
        }

        if (existing.attachment && existing.attachment.path) {
            await deleteAttachmentFromSupabase(existing.attachment.path);
        }

        const { error } = await supabase.from('notices').delete().eq('id', id);
        if (error) throw error;

        try { io.emit('notice_deleted', { id }); } catch (err) { console.warn('Socket emit failed:', err.message); }

        res.json({ success: true, supabaseUrl: SUPABASE_URL, message: 'Notice deleted successfully.' });
    } catch (err) {
        console.error('DELETE /api/notices/:id failed:', err);
        res.status(500).json({ success: false, message: 'Failed to delete notice.' });
    }
});

// --------------------------------------------------------------------------
// 7. GET Analytics / Stats
// --------------------------------------------------------------------------
app.get('/api/stats', async (req, res) => {
    const { collegeId } = req.query;

    try {
        let query = supabase.from('notices').select('*');
        if (collegeId) {
            query = query.eq('college_id', collegeId.trim().toUpperCase());
        }

        const { data: notices, error } = await query;
        if (error) throw error;

        const total = notices.length;
        const exams = notices.filter(n => n.category === 'Exams').length;
        const events = notices.filter(n => n.category === 'Events').length;

        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
        const recent = notices.filter(n => new Date(n.publish_date) >= sevenDaysAgo).length;

        res.json({
            success: true,
            supabaseUrl: SUPABASE_URL,
            stats: { total, exams, events, recent }
        });
    } catch (err) {
        console.error('GET /api/stats failed:', err);
        res.status(500).json({ success: false, message: 'Failed to load stats.' });
    }
});

// Start Render server
server.listen(PORT, '0.0.0.0', () => {
    console.log(`====================================================`);
    console.log(`🚀 Digital Notice Board running on port ${PORT}`);
    console.log(`Supabase configured: ${Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY)}`);
    console.log(`Socket.IO ready for realtime updates`);
    console.log(`====================================================`);
});
