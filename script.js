/* ==========================================================================
   DIGITAL NOTICE BOARD - JAVASCRIPT ENGINE (MULTI-TENANT EDITION)
   Includes: Multi-Tenant College Notice Scoping, REST API Client, Offline localStorage,
   SPA View Routing, Auth & Registration Engine, Notice CRUD, Search & Filters, Toasts.
   ========================================================================== */

// --------------------------------------------------------------------------
// 1. Constants & Application State
// --------------------------------------------------------------------------
const LOCAL_API_URL = 'http://localhost:5000/api';

const currentOrigin = (typeof window !== 'undefined' && window.location && window.location.origin && window.location.origin.startsWith('http'))
    ? window.location.origin
    : 'https://digital-notice-board-yggk.onrender.com';

let API_BASE_URL = currentOrigin.includes('localhost') ? LOCAL_API_URL : `${currentOrigin}/api`;
let SERVER_ORIGIN = currentOrigin.includes('localhost') ? 'http://localhost:5000' : currentOrigin;

const STORAGE_KEY = 'dnb_notices_v3';
const SESSION_KEY = 'dnb_user_session_v3';
const REGISTERED_USERS_KEY = 'dnb_registered_users_v2';

let state = {
    currentUser: null, // { role: 'admin'|'student', id: string, name: string, collegeId: string, collegeName: string }
    notices: [],
    registeredColleges: [],
    isBackendConnected: false,
    adminFilter: { category: 'all', search: '' },
    studentFilter: { category: 'all', search: '' },
    currentViewNotice: null,
    noticeToDeleteId: null,
    currentSelectedFile: null
};

// Realtime socket reference
let socket = null;

// --------------------------------------------------------------------------
// 2. Default Seed Notices (Fallback Sample Data for COLLEGE001)
// --------------------------------------------------------------------------
const INITIAL_SEED_NOTICES = [
    {
        id: 'notice-101',
        collegeId: 'COLLEGE001',
        title: 'Mid Semester Examination Schedule - Spring 2026',
        category: 'Exams',
        description: 'The Mid-Semester Examinations for B.Tech II & III Year students will commence from 25th August 2026. All students are instructed to report 15 minutes before the exam start time with valid identity cards. Detailed timetable is attached below.',
        publishDate: '2026-08-10',
        expiryDate: '2026-08-30',
        attachment: {
            name: 'Mid_Sem_Exam_Schedule_2026.pdf',
            size: '1.2 MB',
            type: 'application/pdf'
        },
        createdAt: new Date('2026-08-10T10:00:00').toISOString()
    },
    {
        id: 'notice-102',
        collegeId: 'COLLEGE001',
        title: 'Updated Class Time Table (Semester IV & VI)',
        category: 'Time Table',
        description: 'Please note that the revised class schedules for Computer Science, Electrical, and Mechanical departments have been updated for the upcoming semester. Please check the new room allocations and lab slots.',
        publishDate: '2026-08-08',
        expiryDate: '2026-09-15',
        attachment: {
            name: 'Updated_Class_TimeTable.pdf',
            size: '850 KB',
            type: 'application/pdf'
        },
        createdAt: new Date('2026-08-08T09:30:00').toISOString()
    },
    {
        id: 'notice-103',
        collegeId: 'COLLEGE001',
        title: 'Independence Day Celebration & Holiday Announcement',
        category: 'Holidays',
        description: 'The College will remain closed on 15th August 2026 on account of Independence Day. Flag hoisting ceremony will take place at 8:00 AM at the main sports campus. All students and faculty members are cordially invited.',
        publishDate: '2026-08-05',
        expiryDate: '2026-08-16',
        attachment: {
            name: 'Independence_Day_Circular.png',
            size: '420 KB',
            type: 'image/png'
        },
        createdAt: new Date('2026-08-05T14:15:00').toISOString()
    },
    {
        id: 'notice-104',
        collegeId: 'COLLEGE001',
        title: 'Annual College Fest 2026 - "Sparkle 2026" Registration',
        category: 'Festivals',
        description: 'Registrations are now open for "Sparkle 2026" Inter-College Cultural Fest! Events include Battle of the Bands, Hackathon, Dance Competition, and Fashion Show. Cash prizes worth $5,000 to be won!',
        publishDate: '2026-08-01',
        expiryDate: '2026-09-01',
        attachment: {
            name: 'Fest_Event_Brochure.pdf',
            size: '2.4 MB',
            type: 'application/pdf'
        },
        createdAt: new Date('2026-08-01T11:00:00').toISOString()
    }
];

// --------------------------------------------------------------------------
// 3. Application Initialization & REST API Sync Engine
// --------------------------------------------------------------------------
document.addEventListener('DOMContentLoaded', () => {
    fetchColleges();
    checkExistingSession();
    initNoticeData();
    setupEventListeners();
});

async function fetchColleges() {
    const endpoints = [API_BASE_URL, LOCAL_API_URL].filter((url, index, list) => list.indexOf(url) === index);
    for (const url of endpoints) {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 4000);
            const response = await fetch(`${url}/colleges`, { signal: controller.signal });
            clearTimeout(timeoutId);
            if (response.ok) {
                const data = await response.json();
                if (data.success && Array.isArray(data.colleges)) {
                    API_BASE_URL = url;
                    SERVER_ORIGIN = url.replace('/api', '');
                    state.registeredColleges = data.colleges;
                    populateCollegeDropdowns(data.colleges);
                    return;
                }
            }
        } catch (err) {}
    }

    // Offline local fallback for registered colleges
    const offlineUsers = getOfflineRegisteredUsers();
    const collegesMap = new Map();
    collegesMap.set('COLLEGE001', 'Apex Institute of Technology');

    offlineUsers.filter(u => u.role === 'admin').forEach(a => {
        const cId = (a.collegeId || a.username).toUpperCase();
        const cName = a.collegeName || `${cId} College Board`;
        collegesMap.set(cId, cName);
    });

    const list = Array.from(collegesMap.entries()).map(([collegeId, collegeName]) => ({ collegeId, collegeName }));
    state.registeredColleges = list;
    populateCollegeDropdowns(list);
}

function populateCollegeDropdowns(collegesList) {
    const loginSelect = document.getElementById('student-login-college');
    const regSelect = document.getElementById('student-reg-college');
    if (!loginSelect || !regSelect) return;

    const optionsHTML = collegesList.map(c => 
        `<option value="${c.collegeId}">${escapeHTML(c.collegeName)} (${c.collegeId})</option>`
    ).join('');

    loginSelect.innerHTML = optionsHTML;
    regSelect.innerHTML = optionsHTML;
}

function updateConnectionStatus(isOnline) {
    state.isBackendConnected = isOnline;
    const adminBadge = document.getElementById('backend-status-badge-admin');
    const studentBadge = document.getElementById('backend-status-badge-student');

    [adminBadge, studentBadge].forEach(badge => {
        if (!badge) return;
        if (isOnline) {
            badge.className = 'server-status-badge online';
            badge.querySelector('.status-text').textContent = 'Render API Online';
            badge.title = `Connected to ${API_BASE_URL}`;
        } else {
            badge.className = 'server-status-badge offline';
            badge.querySelector('.status-text').textContent = 'Offline Mode';
            badge.title = 'API server offline. Using persistent localStorage mode.';
        }
    });
}

async function initNoticeData() {
    const activeCollegeId = state.currentUser ? (state.currentUser.collegeId || 'COLLEGE001') : 'COLLEGE001';
    const endpoints = [API_BASE_URL, LOCAL_API_URL].filter((url, index, list) => list.indexOf(url) === index);

    for (const baseUrl of endpoints) {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 4000);

            const response = await fetch(`${baseUrl}/notices?collegeId=${activeCollegeId}`, { signal: controller.signal });
            clearTimeout(timeoutId);

            if (response.ok) {
                const data = await response.json();
                if (data.success && Array.isArray(data.notices)) {
                    API_BASE_URL = baseUrl;
                    SERVER_ORIGIN = baseUrl.replace('/api', '');
                    state.notices = data.notices;
                    updateConnectionStatus(true);
                    setupRealtime();
                    console.log(`✅ Connected to Production REST API (${baseUrl}) for College: ${activeCollegeId}`);
                    saveNoticesToStorage();
                    refreshCurrentDashboardView();
                    return;
                }
            }
        } catch (err) {
            console.warn(`⚠️ Connection attempt to ${baseUrl} failed. Trying next endpoint...`);
        }
    }

    updateConnectionStatus(false);
    loadNoticesFromStorage();
    refreshCurrentDashboardView();
}

function setupRealtime() {
    if (typeof io === 'undefined') return;
    try {
        if (socket && socket.connected) socket.disconnect();
        socket = io(SERVER_ORIGIN, { transports: ['websocket', 'polling'] });

        socket.on('connect', () => {
            console.log('Realtime: connected', socket.id);
        });

        socket.on('notice_created', (payload) => {
            if (!payload || !payload.notice) return;
            const notice = payload.notice;
            const exists = state.notices.find(n => n.id === notice.id);
            if (!exists) state.notices.unshift(notice);
            saveNoticesToStorage();
            refreshCurrentDashboardView();
            showToast('New notice published', 'info');
        });

        socket.on('notice_updated', (payload) => {
            if (!payload || !payload.notice) return;
            const notice = payload.notice;
            const idx = state.notices.findIndex(n => n.id === notice.id);
            if (idx !== -1) state.notices[idx] = notice;
            else state.notices.unshift(notice);
            saveNoticesToStorage();
            refreshCurrentDashboardView();
            showToast('Notice updated', 'info');
        });

        socket.on('notice_deleted', (payload) => {
            if (!payload || !payload.id) return;
            state.notices = state.notices.filter(n => n.id !== payload.id);
            saveNoticesToStorage();
            refreshCurrentDashboardView();
            showToast('Notice removed', 'info');
        });

        socket.on('disconnect', () => console.log('Realtime: disconnected'));
    } catch (err) {
        console.warn('Realtime initialization failed', err);
    }
}

function loadNoticesFromStorage() {
    const storedData = localStorage.getItem(STORAGE_KEY);
    if (storedData) {
        try {
            state.notices = JSON.parse(storedData);
        } catch (e) {
            state.notices = INITIAL_SEED_NOTICES;
            saveNoticesToStorage();
        }
    } else {
        state.notices = INITIAL_SEED_NOTICES;
        saveNoticesToStorage();
    }
}

function saveNoticesToStorage() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.notices));
}

function refreshCurrentDashboardView() {
    if (state.currentUser) {
        if (state.currentUser.role === 'admin') renderAdminDashboard();
        if (state.currentUser.role === 'student') renderStudentDashboard();
    }
}

function checkExistingSession() {
    const sessionData = localStorage.getItem(SESSION_KEY);
    if (sessionData) {
        try {
            state.currentUser = JSON.parse(sessionData);
            if (state.currentUser.role === 'admin') {
                switchView('admin-dashboard-view');
                renderAdminDashboard();
            } else if (state.currentUser.role === 'student') {
                switchView('student-dashboard-view');
                renderStudentDashboard();
            } else {
                switchView('welcome-view');
            }
        } catch (e) {
            switchView('welcome-view');
        }
    } else {
        switchView('welcome-view');
    }
}

function saveSession(userObj) {
    state.currentUser = userObj;
    localStorage.setItem(SESSION_KEY, JSON.stringify(userObj));
}

function clearSession() {
    state.currentUser = null;
    localStorage.removeItem(SESSION_KEY);
}

// --------------------------------------------------------------------------
// 4. View Router & Screen Switching
// --------------------------------------------------------------------------
function switchView(viewId) {
    const views = document.querySelectorAll('.view-section');
    views.forEach(v => v.classList.remove('active'));

    const targetView = document.getElementById(viewId);
    if (targetView) {
        targetView.classList.add('active');
        window.scrollTo(0, 0);
    }
}

// --------------------------------------------------------------------------
// 5. Authentication & Registration Handlers
// --------------------------------------------------------------------------
function getOfflineRegisteredUsers() {
    const raw = localStorage.getItem(REGISTERED_USERS_KEY);
    if (!raw) return [];
    try { return JSON.parse(raw); } catch(e) { return []; }
}

function saveOfflineRegisteredUser(userObj) {
    const users = getOfflineRegisteredUsers();
    users.push(userObj);
    localStorage.setItem(REGISTERED_USERS_KEY, JSON.stringify(users));
}

function togglePasswordVisibility(inputId, btn) {
    const input = document.getElementById(inputId);
    const icon = btn.querySelector('i');
    if (input.type === 'password') {
        input.type = 'text';
        icon.className = 'fa-solid fa-eye-slash';
    } else {
        input.type = 'password';
        icon.className = 'fa-solid fa-eye';
    }
}

async function handleCollegeLogin(e) {
    e.preventDefault();
    const collegeId = document.getElementById('college-id').value.trim().toUpperCase();
    const password = document.getElementById('college-password').value.trim();
    const errorBox = document.getElementById('college-login-error');

    if (!collegeId || !password) {
        showLoginError('college', 'Please fill in all required credentials.');
        return;
    }

    try {
        const response = await fetch(`${API_BASE_URL}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ role: 'admin', username: collegeId, password: password })
        });

        const data = await response.json();
        if (response.ok && data.success && data.user) {
            errorBox.classList.add('hidden');
            saveSession(data.user);
            showToast(`Login successful! Welcome Admin of ${data.user.collegeName || collegeId}.`, 'success');
            switchView('admin-dashboard-view');
            await initNoticeData();
            document.getElementById('college-login-form').reset();
            return;
        } else if (response.status === 401) {
            showLoginError('college', data.message || 'Invalid College ID or Password.');
            showToast('Invalid login credentials', 'error');
            return;
        }
    } catch (err) {
        console.warn('API auth unavailable. Testing credentials offline.');
    }

    // Offline Credential Fallback
    const offlineUsers = getOfflineRegisteredUsers();
    const matchedUser = (collegeId === 'COLLEGE001' && password === 'admin123')
        ? { role: 'admin', id: 'COLLEGE001', username: 'COLLEGE001', name: 'College Administrator', collegeId: 'COLLEGE001', collegeName: 'Apex Institute of Technology' }
        : offlineUsers.find(u => u.role === 'admin' && u.username === collegeId && u.password === password);

    if (matchedUser) {
        errorBox.classList.add('hidden');
        saveSession({
            role: 'admin',
            id: matchedUser.username,
            name: matchedUser.name,
            collegeId: matchedUser.collegeId || collegeId,
            collegeName: matchedUser.collegeName || `${collegeId} Admin Board`,
            loginTime: new Date().toISOString()
        });
        showToast(`Login successful! Welcome ${matchedUser.name}.`, 'success');
        switchView('admin-dashboard-view');
        await initNoticeData();
        document.getElementById('college-login-form').reset();
    } else {
        showLoginError('college', 'Invalid College ID or Password. Register a new account if needed.');
        showToast('Invalid login credentials', 'error');
    }
}

async function handleCollegeRegister(e) {
    e.preventDefault();
    const name = document.getElementById('college-reg-name').value.trim();
    const collegeName = document.getElementById('college-reg-college-name').value.trim();
    const collegeId = document.getElementById('college-reg-id').value.trim().toUpperCase();
    const password = document.getElementById('college-reg-password').value;
    const confirm = document.getElementById('college-reg-confirm').value;
    const errorBox = document.getElementById('college-reg-error');
    const errorMsg = document.getElementById('college-reg-error-msg');

    if (!name || !collegeName || !collegeId || !password || !confirm) {
        errorMsg.textContent = 'Please fill in all required fields.';
        errorBox.classList.remove('hidden');
        return;
    }

    if (password.length < 6) {
        errorMsg.textContent = 'Password must be at least 6 characters long.';
        errorBox.classList.remove('hidden');
        return;
    }

    if (password !== confirm) {
        errorMsg.textContent = 'Passwords do not match.';
        errorBox.classList.remove('hidden');
        return;
    }

    errorBox.classList.add('hidden');

    try {
        const response = await fetch(`${API_BASE_URL}/auth/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                role: 'admin',
                name: name,
                collegeName: collegeName,
                username: collegeId,
                collegeId: collegeId,
                password: password
            })
        });

        const data = await response.json();

        if (response.ok && data.success) {
            showToast(`College Admin registered! New empty dashboard created for ${collegeId}.`, 'success');
            document.getElementById('college-register-form').reset();
            await fetchColleges();
            switchView('college-login-view');
            document.getElementById('college-id').value = collegeId;
            return;
        } else {
            errorMsg.textContent = data.message || 'Registration failed.';
            errorBox.classList.remove('hidden');
            return;
        }
    } catch (err) {
        console.warn('API registration unavailable. Registering offline.');
    }

    // Offline Registration Fallback
    const offlineUsers = getOfflineRegisteredUsers();
    const exists = offlineUsers.find(u => u.username === collegeId && u.role === 'admin') || (collegeId === 'COLLEGE001');
    if (exists) {
        errorMsg.textContent = `Account with College ID (${collegeId}) already exists.`;
        errorBox.classList.remove('hidden');
        return;
    }

    saveOfflineRegisteredUser({
        role: 'admin',
        name: name,
        collegeName: collegeName,
        collegeId: collegeId,
        username: collegeId,
        password: password,
        createdAt: new Date().toISOString()
    });

    showToast(`College Admin account registered! Log in to ${collegeId}.`, 'success');
    document.getElementById('college-register-form').reset();
    await fetchColleges();
    switchView('college-login-view');
    document.getElementById('college-id').value = collegeId;
}

async function handleStudentLogin(e) {
    e.preventDefault();
    const selectedCollegeId = document.getElementById('student-login-college').value;
    const collegeKey = document.getElementById('student-college-key').value.trim();
    const roll = document.getElementById('student-roll').value.trim().toUpperCase();
    const password = document.getElementById('student-password').value.trim();
    const errorBox = document.getElementById('student-login-error');

    if (!roll || !password || !selectedCollegeId || !collegeKey) {
        showLoginError('student', 'Please fill in all fields including College Security Key.');
        return;
    }

    try {
        const response = await fetch(`${API_BASE_URL}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                role: 'student',
                username: roll,
                password: password,
                collegeId: selectedCollegeId,
                collegeKey: collegeKey
            })
        });

        const data = await response.json();
        if (response.ok && data.success && data.user) {
            errorBox.classList.add('hidden');
            saveSession(data.user);
            showToast(`Login successful! Connected to ${data.user.collegeName || selectedCollegeId}.`, 'success');
            switchView('student-dashboard-view');
            await initNoticeData();
            document.getElementById('student-login-form').reset();
            return;
        } else if (response.status === 403 || response.status === 401) {
            showLoginError('student', data.message || 'Invalid Security Key, Roll Number, or Password.');
            showToast(data.message || 'Login verification failed', 'error');
            return;
        }
    } catch (err) {
        console.warn('API auth unavailable. Testing credentials offline.');
    }

    // Offline Credential & Security Key Fallback
    const offlineUsers = getOfflineRegisteredUsers();
    const adminUser = offlineUsers.find(u => u.role === 'admin' && (u.collegeId === selectedCollegeId || u.username === selectedCollegeId));
    const expectedCollegeKey = adminUser ? adminUser.password : (selectedCollegeId === 'COLLEGE001' ? 'admin123' : null);

    if (expectedCollegeKey && collegeKey !== expectedCollegeKey) {
        showLoginError('student', `Security Key Error: Incorrect College Security Key for (${selectedCollegeId}). College information is protected.`);
        showToast('Incorrect College Security Key', 'error');
        return;
    }

    const matchedUser = (roll === '23A81A0501' && password === 'student123')
        ? { role: 'student', roll: '23A81A0501', username: '23A81A0501', name: 'Student Account', collegeId: selectedCollegeId }
        : offlineUsers.find(u => u.role === 'student' && u.username === roll && u.password === password);

    if (matchedUser) {
        const cName = getCollegeNameById(selectedCollegeId);
        errorBox.classList.add('hidden');
        saveSession({
            role: 'student',
            roll: matchedUser.username,
            name: matchedUser.name,
            collegeId: selectedCollegeId,
            collegeName: cName,
            loginTime: new Date().toISOString()
        });
        showToast(`Login successful! Welcome ${matchedUser.name}.`, 'success');
        switchView('student-dashboard-view');
        await initNoticeData();
        document.getElementById('student-login-form').reset();
    } else {
        showLoginError('student', 'Invalid Roll Number or Password. Check credentials or register.');
        showToast('Invalid login credentials', 'error');
    }
}

async function handleStudentRegister(e) {
    e.preventDefault();
    const selectedCollegeId = document.getElementById('student-reg-college').value;
    const collegeKey = document.getElementById('student-reg-college-key').value.trim();
    const name = document.getElementById('student-reg-name').value.trim();
    const roll = document.getElementById('student-reg-roll').value.trim().toUpperCase();
    const password = document.getElementById('student-reg-password').value;
    const confirm = document.getElementById('student-reg-confirm').value;
    const errorBox = document.getElementById('student-reg-error');
    const errorMsg = document.getElementById('student-reg-error-msg');

    if (!name || !roll || !password || !confirm || !selectedCollegeId || !collegeKey) {
        errorMsg.textContent = 'Please fill in all required fields including College Security Key.';
        errorBox.classList.remove('hidden');
        return;
    }

    if (password.length < 6) {
        errorMsg.textContent = 'Password must be at least 6 characters long.';
        errorBox.classList.remove('hidden');
        return;
    }

    if (password !== confirm) {
        errorMsg.textContent = 'Passwords do not match.';
        errorBox.classList.remove('hidden');
        return;
    }

    errorBox.classList.add('hidden');

    try {
        const response = await fetch(`${API_BASE_URL}/auth/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                role: 'student',
                name: name,
                username: roll,
                collegeId: selectedCollegeId,
                collegeKey: collegeKey,
                password: password
            })
        });

        const data = await response.json();

        if (response.ok && data.success) {
            showToast('Student account registered! You can now log in.', 'success');
            document.getElementById('student-register-form').reset();
            switchView('student-login-view');
            document.getElementById('student-roll').value = roll;
            document.getElementById('student-login-college').value = selectedCollegeId;
            document.getElementById('student-college-key').value = collegeKey;
            return;
        } else {
            errorMsg.textContent = data.message || 'Registration failed.';
            errorBox.classList.remove('hidden');
            return;
        }
    } catch (err) {
        console.warn('API registration unavailable. Registering offline.');
    }

    // Offline Registration Fallback
    const offlineUsers = getOfflineRegisteredUsers();
    const adminUser = offlineUsers.find(u => u.role === 'admin' && (u.collegeId === selectedCollegeId || u.username === selectedCollegeId));
    const expectedCollegeKey = adminUser ? adminUser.password : (selectedCollegeId === 'COLLEGE001' ? 'admin123' : null);

    if (expectedCollegeKey && collegeKey !== expectedCollegeKey) {
        errorMsg.textContent = `Security Key Error: Incorrect College Security Key for (${selectedCollegeId}). College information is protected.`;
        errorBox.classList.remove('hidden');
        return;
    }

    const exists = offlineUsers.find(u => u.username === roll && u.role === 'student') || (roll === '23A81A0501');
    if (exists) {
        errorMsg.textContent = `Account with Roll Number (${roll}) already exists.`;
        errorBox.classList.remove('hidden');
        return;
    }

    saveOfflineRegisteredUser({
        role: 'student',
        name: name,
        username: roll,
        collegeId: selectedCollegeId,
        password: password,
        createdAt: new Date().toISOString()
    });

    showToast('Student account registered! Log in now.', 'success');
    document.getElementById('student-register-form').reset();
    switchView('student-login-view');
    document.getElementById('student-roll').value = roll;
    document.getElementById('student-login-college').value = selectedCollegeId;
    document.getElementById('student-college-key').value = collegeKey;
}

function getCollegeNameById(cId) {
    const found = state.registeredColleges.find(c => c.collegeId === cId);
    return found ? found.collegeName : `${cId} College Notice Board`;
}

function showLoginError(type, msg) {
    const errorBox = document.getElementById(`${type}-login-error`);
    const msgSpan = document.getElementById(`${type}-error-msg`);
    msgSpan.textContent = msg;
    errorBox.classList.remove('hidden');
}

function handleLogout() {
    clearSession();
    showToast('Logged out successfully.', 'info');
    switchView('welcome-view');
}

// --------------------------------------------------------------------------
// 6. Admin Dashboard Engine (Scoped by College ID)
// --------------------------------------------------------------------------
function renderAdminDashboard() {
    const activeCollegeId = state.currentUser ? (state.currentUser.collegeId || 'COLLEGE001') : 'COLLEGE001';
    const activeCollegeName = state.currentUser ? (state.currentUser.collegeName || `${activeCollegeId} Notice Board`) : 'Apex Institute of Technology';

    const userNameEl = document.getElementById('admin-user-name');
    const userIdEl = document.getElementById('admin-user-id');
    const brandNameEl = document.getElementById('admin-brand-name');
    const headerSubEl = document.getElementById('admin-header-subtitle');

    if (userNameEl) userNameEl.textContent = state.currentUser ? state.currentUser.name : 'College Administrator';
    if (userIdEl) userIdEl.textContent = `ID: ${activeCollegeId}`;
    if (brandNameEl) brandNameEl.textContent = activeCollegeId;
    if (headerSubEl) headerSubEl.textContent = `${activeCollegeName} (${activeCollegeId}) • Management Dashboard`;

    updateAdminStats(activeCollegeId);
    updateSidebarBadges(activeCollegeId);
    renderAdminNotices(activeCollegeId);
}

function getCollegeScopedNotices(cId) {
    if (!cId) return state.notices;
    const cleanId = cId.toUpperCase();
    return state.notices.filter(n => (n.collegeId ? n.collegeId.toUpperCase() === cleanId : cleanId === 'COLLEGE001'));
}

function updateAdminStats(cId) {
    const collegeNotices = getCollegeScopedNotices(cId);
    const total = collegeNotices.length;
    const exams = collegeNotices.filter(n => n.category === 'Exams').length;
    const events = collegeNotices.filter(n => n.category === 'Events').length;

    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const recent = collegeNotices.filter(n => new Date(n.publishDate) >= sevenDaysAgo).length;

    document.getElementById('stat-total-notices').textContent = total;
    document.getElementById('stat-exam-notices').textContent = exams;
    document.getElementById('stat-event-notices').textContent = events;
    document.getElementById('stat-recent-notices').textContent = recent;
}

function updateSidebarBadges(cId) {
    const collegeNotices = getCollegeScopedNotices(cId);
    document.getElementById('admin-badge-all').textContent = collegeNotices.length;
    document.getElementById('admin-badge-exams').textContent = collegeNotices.filter(n => n.category === 'Exams').length;
    document.getElementById('admin-badge-timetable').textContent = collegeNotices.filter(n => n.category === 'Time Table').length;
    document.getElementById('admin-badge-holidays').textContent = collegeNotices.filter(n => n.category === 'Holidays').length;
    document.getElementById('admin-badge-festivals').textContent = collegeNotices.filter(n => n.category === 'Festivals').length;
    document.getElementById('admin-badge-events').textContent = collegeNotices.filter(n => n.category === 'Events').length;
}

function filterNotices(noticesArray, filterObj) {
    return noticesArray.filter(notice => {
        const categoryMatch = (filterObj.category === 'all') || (notice.category.toLowerCase() === filterObj.category.toLowerCase());
        const search = filterObj.search.toLowerCase().trim();
        const searchMatch = !search || 
            notice.title.toLowerCase().includes(search) || 
            notice.description.toLowerCase().includes(search) || 
            notice.category.toLowerCase().includes(search);

        return categoryMatch && searchMatch;
    });
}

function renderAdminNotices(cId) {
    const container = document.getElementById('admin-notices-container');
    const collegeNotices = getCollegeScopedNotices(cId);
    const filtered = filterNotices(collegeNotices, state.adminFilter);

    document.getElementById('admin-filtered-count').textContent = `${filtered.length} Notice${filtered.length === 1 ? '' : 's'}`;

    if (filtered.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <i class="fa-solid fa-folder-open"></i>
                <h4>No Notices Found</h4>
                <p>There are no published notices for college (${cId || 'Default'}). Click "Add Notice" above to publish your first announcement!</p>
            </div>
        `;
        return;
    }

    container.innerHTML = filtered.map(notice => createNoticeCardHTML(notice, true)).join('');
}

function handleAdminSearch() {
    state.adminFilter.search = document.getElementById('admin-search-input').value;
    const activeCollegeId = state.currentUser ? state.currentUser.collegeId : 'COLLEGE001';
    renderAdminNotices(activeCollegeId);
}

function filterAdminCategory(category, element) {
    state.adminFilter.category = category;
    
    const pills = document.querySelectorAll('#admin-category-pills .pill');
    pills.forEach(p => p.classList.remove('active'));
    if (element) element.classList.add('active');

    document.getElementById('admin-section-heading').textContent = 
        category === 'all' ? 'All Published Notices' : `${category} Notices`;

    const activeCollegeId = state.currentUser ? state.currentUser.collegeId : 'COLLEGE001';
    renderAdminNotices(activeCollegeId);
}

function navigateAdminSection(section, element) {
    const menuItems = document.querySelectorAll('#admin-sidebar .menu-item');
    menuItems.forEach(item => item.classList.remove('active'));
    if (element) element.classList.add('active');

    if (section === 'dashboard' || section === 'all') {
        filterAdminCategory('all');
    } else {
        filterAdminCategory(section);
    }

    closeMobileSidebar('admin-sidebar');
}

// --------------------------------------------------------------------------
// 7. Student Dashboard Engine (Scoped by Selected College ID)
// --------------------------------------------------------------------------
function renderStudentDashboard() {
    const studentName = state.currentUser ? state.currentUser.name : 'Student';
    const roll = state.currentUser ? (state.currentUser.roll || state.currentUser.username) : '23A81A0501';
    const activeCollegeId = state.currentUser ? (state.currentUser.collegeId || 'COLLEGE001') : 'COLLEGE001';
    const activeCollegeName = state.currentUser ? (state.currentUser.collegeName || `${activeCollegeId} Notice Portal`) : 'Apex Institute of Technology';

    const nameEl = document.getElementById('student-display-name');
    const rollEl = document.getElementById('student-display-roll');
    const headerNameEl = document.getElementById('student-header-name');
    const brandNameEl = document.getElementById('student-brand-name');
    const headerSubEl = document.getElementById('student-header-subtitle');

    if (nameEl) nameEl.textContent = studentName;
    if (rollEl) rollEl.textContent = `Roll: ${roll}`;
    if (headerNameEl) headerNameEl.textContent = `Roll: ${roll} • ${activeCollegeId}`;
    if (brandNameEl) brandNameEl.textContent = activeCollegeId;
    if (headerSubEl) headerSubEl.textContent = `${activeCollegeName} (${activeCollegeId}) • Student Notice Portal`;

    renderStudentNotices(activeCollegeId);
}

function renderStudentNotices(cId) {
    const container = document.getElementById('student-notices-container');
    const collegeNotices = getCollegeScopedNotices(cId);
    const filtered = filterNotices(collegeNotices, state.studentFilter);

    document.getElementById('student-filtered-count').textContent = `${filtered.length} Notice${filtered.length === 1 ? '' : 's'}`;

    if (filtered.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <i class="fa-solid fa-scroll"></i>
                <h4>No Notices Available</h4>
                <p>No notices available for ${cId || 'selected college'}. Check back soon for official college announcements.</p>
            </div>
        `;
        return;
    }

    container.innerHTML = filtered.map(notice => createNoticeCardHTML(notice, false)).join('');
}

function handleStudentSearch() {
    state.studentFilter.search = document.getElementById('student-search-input').value;
    const activeCollegeId = state.currentUser ? state.currentUser.collegeId : 'COLLEGE001';
    renderStudentNotices(activeCollegeId);
}

function filterStudentCategory(category, element) {
    state.studentFilter.category = category;
    
    const pills = document.querySelectorAll('#student-category-pills .pill');
    pills.forEach(p => p.classList.remove('active'));
    if (element) element.classList.add('active');

    document.getElementById('student-section-heading').textContent = 
        category === 'all' ? 'Latest Notices' : `${category} Notices`;

    const activeCollegeId = state.currentUser ? state.currentUser.collegeId : 'COLLEGE001';
    renderStudentNotices(activeCollegeId);
}

function navigateStudentSection(section, element) {
    const menuItems = document.querySelectorAll('#student-sidebar .menu-item');
    menuItems.forEach(item => item.classList.remove('active'));
    if (element) element.classList.add('active');

    filterStudentCategory(section);
    closeMobileSidebar('student-sidebar');
}

// --------------------------------------------------------------------------
// 8. Notice Card Component Builder
// --------------------------------------------------------------------------
function createNoticeCardHTML(notice, isAdmin) {
    const categoryClass = getCategoryBadgeClass(notice.category);
    const categoryIcon = getCategoryIcon(notice.category);
    const formattedDate = formatDate(notice.publishDate);
    const attachmentHTML = notice.attachment ? `
        <div class="notice-attachment-tag" title="${notice.attachment.name}">
            <i class="fa-solid fa-paperclip"></i>
            <span>${escapeHTML(notice.attachment.name)}</span>
        </div>
    ` : '';

    const actionsHTML = isAdmin ? `
        <div class="admin-actions">
            <button class="btn btn-sm btn-outline-primary" onclick="openNoticeViewModal('${notice.id}')" title="View Notice">
                <i class="fa-solid fa-eye"></i> View
            </button>
            <button class="btn btn-sm btn-outline" onclick="openEditNoticeModal('${notice.id}')" title="Edit Notice">
                <i class="fa-solid fa-pen-to-square"></i> Edit
            </button>
            <button class="btn btn-sm btn-danger" onclick="openDeleteModal('${notice.id}')" title="Delete Notice">
                <i class="fa-solid fa-trash-can"></i> Delete
            </button>
        </div>
    ` : `
        <div class="student-actions">
            <button class="btn btn-sm btn-primary btn-block" onclick="openNoticeViewModal('${notice.id}')">
                <i class="fa-solid fa-eye"></i> View Notice
            </button>
            ${notice.attachment ? `
                <button class="btn btn-sm btn-outline-primary" onclick="downloadAttachmentFromNotice('${notice.id}')" title="Download Attachment">
                    <i class="fa-solid fa-download"></i>
                </button>
            ` : ''}
        </div>
    `;

    return `
        <div class="notice-card" id="card-${notice.id}">
            <div class="notice-card-header">
                <div>
                    <span class="badge ${categoryClass}">
                        <i class="${categoryIcon}"></i> ${escapeHTML(notice.category)}
                    </span>
                    <h4 class="notice-title" style="margin-top: 10px;">${escapeHTML(notice.title)}</h4>
                </div>
            </div>

            <div class="notice-card-body">
                <p class="notice-description-preview">${escapeHTML(notice.description)}</p>
                ${attachmentHTML}
                <div class="notice-meta">
                    <div class="notice-meta-item">
                        <i class="fa-regular fa-calendar-check"></i> Published: ${formattedDate}
                    </div>
                </div>
            </div>

            <div class="notice-card-footer">
                ${actionsHTML}
            </div>
        </div>
    `;
}

function getCategoryBadgeClass(cat) {
    switch (cat.toLowerCase()) {
        case 'exams': return 'badge-exams';
        case 'time table': return 'badge-timetable';
        case 'holidays': return 'badge-holidays';
        case 'festivals': return 'badge-festivals';
        case 'events': return 'badge-events';
        default: return 'badge-general';
    }
}

function getCategoryIcon(cat) {
    switch (cat.toLowerCase()) {
        case 'exams': return 'fa-solid fa-file-pen';
        case 'time table': return 'fa-solid fa-calendar-days';
        case 'holidays': return 'fa-solid fa-umbrella-beach';
        case 'festivals': return 'fa-solid fa-compact-disc';
        case 'events': return 'fa-solid fa-champagne-glasses';
        default: return 'fa-solid fa-circle-info';
    }
}

function formatDate(dateStr) {
    if (!dateStr) return 'N/A';
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function escapeHTML(str) {
    if (!str) return '';
    return str.replace(/[&<>'"]/g, 
        tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag)
    );
}

// --------------------------------------------------------------------------
// 9. Modal Management & Add / Edit Notice Form Engine
// --------------------------------------------------------------------------
function showModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.classList.remove('hidden');
        document.body.classList.add('modal-open');
    }
}

function hideModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.classList.add('hidden');
    }
    const openModals = document.querySelectorAll('.modal-overlay:not(.hidden)');
    if (openModals.length === 0) {
        document.body.classList.remove('modal-open');
    }
}

function openAddNoticeModal() {
    document.getElementById('notice-edit-id').value = '';
    document.getElementById('notice-form').reset();
    state.currentSelectedFile = null;
    resetFileDisplay();

    const today = new Date().toISOString().split('T')[0];
    document.getElementById('notice-publish-date').value = today;

    document.getElementById('modal-form-title').innerHTML = '<i class="fa-solid fa-circle-plus"></i> Add New Notice';
    document.getElementById('btn-submit-notice').innerHTML = '<i class="fa-solid fa-paper-plane"></i> <span>Publish Notice</span>';

    showModal('notice-modal');
}

function openEditNoticeModal(noticeId) {
    const notice = state.notices.find(n => n.id === noticeId);
    if (!notice) return;

    document.getElementById('notice-edit-id').value = notice.id;
    document.getElementById('notice-title').value = notice.title;
    document.getElementById('notice-category').value = notice.category;
    document.getElementById('notice-publish-date').value = notice.publishDate;
    document.getElementById('notice-expiry-date').value = notice.expiryDate || '';
    document.getElementById('notice-description').value = notice.description;

    if (notice.attachment) {
        state.currentSelectedFile = notice.attachment;
        showFileDisplay(notice.attachment.name);
    } else {
        state.currentSelectedFile = null;
        resetFileDisplay();
    }

    document.getElementById('modal-form-title').innerHTML = '<i class="fa-solid fa-pen-to-square"></i> Edit Notice';
    document.getElementById('btn-submit-notice').innerHTML = '<i class="fa-solid fa-floppy-disk"></i> <span>Save Changes</span>';

    showModal('notice-modal');
}

function closeNoticeModal() {
    hideModal('notice-modal');
}

function handleFileSelected(input) {
    if (input.files && input.files[0]) {
        const file = input.files[0];
        state.currentSelectedFile = file;
        
        const reader = new FileReader();
        reader.onload = function(e) {
            state.currentSelectedFileMeta = {
                name: file.name,
                size: (file.size / 1024 > 1024) ? `${(file.size / (1024*1024)).toFixed(1)} MB` : `${(file.size / 1024).toFixed(0)} KB`,
                type: file.type,
                dataUrl: e.target.result
            };
            showFileDisplay(file.name);
        };
        reader.readAsDataURL(file);
    }
}

function showFileDisplay(filename) {
    document.getElementById('upload-placeholder').classList.add('hidden');
    const infoBox = document.getElementById('selected-file-info');
    document.getElementById('file-name-display').textContent = filename;
    infoBox.classList.remove('hidden');
}

function removeSelectedFile(e) {
    e.stopPropagation();
    state.currentSelectedFile = null;
    state.currentSelectedFileMeta = null;
    document.getElementById('notice-attachment').value = '';
    resetFileDisplay();
}

function resetFileDisplay() {
    document.getElementById('upload-placeholder').classList.remove('hidden');
    document.getElementById('selected-file-info').classList.add('hidden');
}

async function handleNoticeFormSubmit(e) {
    e.preventDefault();

    const editId = document.getElementById('notice-edit-id').value;
    const title = document.getElementById('notice-title').value.trim();
    const category = document.getElementById('notice-category').value;
    const publishDate = document.getElementById('notice-publish-date').value;
    const expiryDate = document.getElementById('notice-expiry-date').value;
    const description = document.getElementById('notice-description').value.trim();
    const activeCollegeId = state.currentUser ? (state.currentUser.collegeId || 'COLLEGE001') : 'COLLEGE001';

    if (!title || !category || !publishDate || !description) {
        showToast('Please fill in all required fields.', 'error');
        return;
    }

    const fileInput = document.getElementById('notice-attachment');
    const actualFile = (fileInput.files && fileInput.files[0]) ? fileInput.files[0] : (state.currentSelectedFile instanceof File ? state.currentSelectedFile : null);

    try {
        const formData = new FormData();
        formData.append('title', title);
        formData.append('category', category);
        formData.append('publishDate', publishDate);
        formData.append('expiryDate', expiryDate);
        formData.append('description', description);
        formData.append('collegeId', activeCollegeId);

        if (actualFile) {
            formData.append('attachment', actualFile);
        } else if (state.currentSelectedFileMeta) {
            formData.append('attachmentName', state.currentSelectedFileMeta.name);
            formData.append('attachmentSize', state.currentSelectedFileMeta.size);
            formData.append('attachmentType', state.currentSelectedFileMeta.type);
            formData.append('attachmentDataUrl', state.currentSelectedFileMeta.dataUrl);
        }

        const endpoint = editId ? `${API_BASE_URL}/notices/${editId}` : `${API_BASE_URL}/notices`;
        const method = editId ? 'PUT' : 'POST';

        const response = await fetch(endpoint, {
            method: method,
            body: formData
        });

        if (response.ok) {
            const data = await response.json();
            if (data.success && data.notice) {
                showToast(editId ? 'Notice updated.' : 'Notice published to college notice board!', 'success');
                closeNoticeModal();
                await initNoticeData();
                return;
            }
        }
    } catch (err) {
        console.warn('API error during notice save. Falling back to localStorage.', err);
    }

    // Offline localStorage Fallback
    const fileAttachmentInfo = state.currentSelectedFileMeta || state.currentSelectedFile;

    if (editId) {
        const noticeIndex = state.notices.findIndex(n => n.id === editId);
        if (noticeIndex !== -1) {
            state.notices[noticeIndex] = {
                ...state.notices[noticeIndex],
                title,
                category,
                publishDate,
                expiryDate,
                description,
                attachment: fileAttachmentInfo || state.notices[noticeIndex].attachment
            };
            saveNoticesToStorage();
            showToast('Notice updated successfully.', 'success');
        }
    } else {
        const newNotice = {
            id: 'notice-' + Date.now(),
            collegeId: activeCollegeId,
            title,
            category,
            publishDate,
            expiryDate,
            description,
            attachment: fileAttachmentInfo,
            createdAt: new Date().toISOString()
        };
        state.notices.unshift(newNotice);
        saveNoticesToStorage();
        showToast('Notice published successfully!', 'success');
    }

    closeNoticeModal();
    renderAdminDashboard();
}

// --------------------------------------------------------------------------
// 10. Delete Notice Engine
// --------------------------------------------------------------------------
function openDeleteModal(noticeId) {
    const notice = state.notices.find(n => n.id === noticeId);
    if (!notice) return;

    state.noticeToDeleteId = noticeId;
    document.getElementById('delete-notice-title').textContent = `"${notice.title}"`;
    showModal('delete-modal');
}

function closeDeleteModal() {
    state.noticeToDeleteId = null;
    hideModal('delete-modal');
}

async function confirmDeleteNotice() {
    if (!state.noticeToDeleteId) return;
    const noticeId = state.noticeToDeleteId;

    try {
        const response = await fetch(`${API_BASE_URL}/notices/${noticeId}`, { method: 'DELETE' });
        if (response.ok) {
            showToast('Notice deleted from server.', 'info');
            closeDeleteModal();
            await initNoticeData();
            return;
        }
    } catch (err) {
        console.warn('API delete failed. Performing offline deletion.');
    }

    state.notices = state.notices.filter(n => n.id !== noticeId);
    saveNoticesToStorage();
    closeDeleteModal();
    renderAdminDashboard();
    showToast('Notice deleted successfully.', 'info');
}

// --------------------------------------------------------------------------
// 11. View Notice Detail Modal
// --------------------------------------------------------------------------
function openNoticeViewModal(noticeId) {
    const notice = state.notices.find(n => n.id === noticeId);
    if (!notice) return;

    state.currentViewNotice = notice;

    const badge = document.getElementById('view-category-badge');
    badge.className = `badge ${getCategoryBadgeClass(notice.category)}`;
    badge.innerHTML = `<i class="${getCategoryIcon(notice.category)}"></i> ${escapeHTML(notice.category)}`;

    document.getElementById('view-notice-title').textContent = notice.title;
    document.getElementById('view-publish-date').textContent = formatDate(notice.publishDate);
    document.getElementById('view-expiry-date').textContent = notice.expiryDate ? formatDate(notice.expiryDate) : 'None';
    document.getElementById('view-notice-description').textContent = notice.description;

    const attachmentSection = document.getElementById('view-attachment-section');
    if (notice.attachment) {
        document.getElementById('view-attachment-name').textContent = `${notice.attachment.name} (${notice.attachment.size || 'Attachment'})`;
        attachmentSection.classList.remove('hidden');
    } else {
        attachmentSection.classList.add('hidden');
    }

    showModal('view-notice-modal');
}

function closeViewNoticeModal() {
    state.currentViewNotice = null;
    hideModal('view-notice-modal');
}

function downloadAttachmentFromNotice(noticeId) {
    const notice = state.notices.find(n => n.id === noticeId);
    if (notice && notice.attachment) {
        state.currentViewNotice = notice;
        triggerAttachmentDownload();
    }
}

function triggerAttachmentDownload() {
    if (!state.currentViewNotice || !state.currentViewNotice.attachment) return;

    const attachment = state.currentViewNotice.attachment;

    if (attachment.url) {
        const downloadUrl = attachment.url.startsWith('http') ? attachment.url : `${SERVER_ORIGIN}${attachment.url}`;
        const a = document.createElement('a');
        a.href = downloadUrl;
        a.download = attachment.name;
        a.target = '_blank';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    } else if (attachment.dataUrl) {
        const a = document.createElement('a');
        a.href = attachment.dataUrl;
        a.download = attachment.name;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    } else {
        const sampleContent = `Digital Notice Board Document\nNotice: ${state.currentViewNotice.title}\nCategory: ${state.currentViewNotice.category}\nDate: ${state.currentViewNotice.publishDate}\n\n${state.currentViewNotice.description}`;
        const blob = new Blob([sampleContent], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = attachment.name;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    showToast(`Notice attachment downloaded: ${attachment.name}`, 'info');
}

// --------------------------------------------------------------------------
// 12. Toast Notification System
// --------------------------------------------------------------------------
function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;

    let iconClass = 'fa-solid fa-circle-info';
    if (type === 'success') iconClass = 'fa-solid fa-circle-check';
    if (type === 'error') iconClass = 'fa-solid fa-circle-exclamation';

    toast.innerHTML = `
        <i class="${iconClass}"></i>
        <span>${escapeHTML(message)}</span>
    `;

    container.appendChild(toast);

    setTimeout(() => {
        toast.style.animation = 'toastOut 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards';
        setTimeout(() => {
            if (toast.parentNode) {
                toast.parentNode.removeChild(toast);
            }
        }, 300);
    }, 3200);
}

// --------------------------------------------------------------------------
// 13. Mobile Drawer Controls & Event Listeners
// --------------------------------------------------------------------------
function toggleMobileSidebar(sidebarId = 'admin-sidebar') {
    const sidebar = document.getElementById(sidebarId);
    if (sidebar) sidebar.classList.toggle('open');
}

function closeMobileSidebar(sidebarId = 'admin-sidebar') {
    const sidebar = document.getElementById(sidebarId);
    if (sidebar) sidebar.classList.remove('open');
}

function setupEventListeners() {
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closeNoticeModal();
            closeViewNoticeModal();
            closeDeleteModal();
        }
    });

    document.querySelectorAll('.modal-overlay').forEach(overlay => {
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) hideModal(overlay.id);
        });
    });

    const dropZone = document.getElementById('file-drop-zone');
    if (dropZone) {
        ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
            dropZone.addEventListener(eventName, preventDefaults, false);
        });

        function preventDefaults(e) {
            e.preventDefault();
            e.stopPropagation();
        }

        ['dragenter', 'dragover'].forEach(eventName => {
            dropZone.addEventListener(eventName, () => dropZone.classList.add('highlight'), false);
        });

        ['dragleave', 'drop'].forEach(eventName => {
            dropZone.addEventListener(eventName, () => dropZone.classList.remove('highlight'), false);
        });

        dropZone.addEventListener('drop', (e) => {
            const dt = e.dataTransfer;
            const files = dt.files;
            if (files && files[0]) {
                const fileInput = document.getElementById('notice-attachment');
                fileInput.files = files;
                handleFileSelected(fileInput);
            }
        });
    }
}
