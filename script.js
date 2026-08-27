// ==========================================
// 📍 1. กำหนดพิกัดสนามแบดมินตัน และระบบตรวจเช็กระยะทาง (Geofencing)
// ==========================================
const COURT_LOCATION = {
    lat: 7.203006610774002,   // พิกัดละติจูดสนามของคุณ
    lng: 100.60069610167278,  // พิกัดลองจิจูดสนามของคุณ
    radiusMeters: 100         // << กำหนดระยะรัศมีที่อนุญาตให้จองได้ (หน่วย: เมตร)
};

// ฟังก์ชันคำนวณระยะห่างระหว่าง 2 จุดบนโลก (Haversine Formula) คืนค่าเป็นเมตร
function getDistanceInMeters(lat1, lon1, lat2, lon2) {
    const R = 6371e3; // รัศมีของโลก (เมตร)
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c; 
}

// ฟังก์ชันดึงพิกัดจริงจากอุปกรณ์ผ่าน HTML5 Geolocation API
function getUserLocation() {
    return new Promise((resolve, reject) => {
        if (!navigator.geolocation) {
            reject(new Error("อุปกรณ์หรือเบราว์เซอร์ของคุณไม่รองรับการดึงพิกัดตำแหน่ง (Geolocation API)"));
            return;
        }

        navigator.geolocation.getCurrentPosition(
            (position) => {
                resolve({
                    lat: position.coords.latitude,
                    lng: position.coords.longitude
                });
            },
            (error) => {
                switch(error.code) {
                    case error.PERMISSION_DENIED:
                        reject(new Error("กรุณาเปิดการอนุญาตเข้าถึงตำแหน่ง (Location Access) ในเบราว์เซอร์ก่อนทำการจอง"));
                        break;
                    case error.POSITION_UNAVAILABLE:
                        reject(new Error("ไม่สามารถค้นหาตำแหน่งของคุณได้"));
                        break;
                    case error.TIMEOUT:
                        reject(new Error("หมดเวลาในการดึงตำแหน่ง"));
                        break;
                    default:
                        reject(new Error("เกิดข้อผิดพลาดในการดึงตำแหน่ง"));
                }
            },
            {
                enableHighAccuracy: true, // ใช้ GPS ความแม่นยำสูง
                timeout: 10000,           // หมดเวลาใน 10 วินาที
                maximumAge: 0
            }
        );
    });
}

// ==========================================
// ⚙️ 2. ส่วนตั้งค่า Firebase และตัวแปรระบบเดิม
// ==========================================
const firebaseConfig = {
  apiKey: "AIzaSyCD0a9pLD1_1h1umN6vUBgArBHe8aO4Bwg",
  authDomain: "jongcourt-42aeb.firebaseapp.com",
  databaseURL: "https://jongcourt-42aeb-default-rtdb.firebaseio.com",
  projectId: "jongcourt-42aeb",
  storageBucket: "jongcourt-42aeb.firebasestorage.app",
  messagingSenderId: "785155114918",
  appId: "1:785155114918:web:f3184642d8843aa99c3167",
  measurementId: "G-T4654QMTYR"
};

let db = null;
let useFirebase = false;

try {
    if (typeof firebase !== 'undefined') {
        if (!firebase.apps.length) {
            firebase.initializeApp(firebaseConfig);
        }
        db = firebase.database();
        useFirebase = true;
    }
} catch (e) {
    console.error("Firebase Initialization Error:", e);
}

let currentUser = null;
let currentSelectedCourt = '';
let courtData = {
    'คอร์ท 1': createEmptyQueues(),
    'คอร์ท 2': createEmptyQueues(),
    'คอร์ท 3': createEmptyQueues(),
    'คอร์ท 4': createEmptyQueues(),
};
let activeUsersData = {};
let timerIntervals = {};
let isFirstLoad = true;

window.addEventListener('DOMContentLoaded', () => {
    const savedUser = localStorage.getItem('badminton_user');
    if (savedUser) {
        currentUser = JSON.parse(savedUser);
        document.getElementById('loginPage').classList.add('hidden');
        document.getElementById('userPage').classList.remove('hidden');
        document.getElementById('currentUserDisplay').innerText = currentUser.username;

        if (currentUser.isAdmin) {
            document.getElementById('adminNavBtn').classList.remove('hidden');
        } else {
            document.getElementById('adminNavBtn').classList.add('hidden');
        }
    }
});

if (useFirebase && db) {
    db.ref('courts').on('value', (snapshot) => {
        const data = snapshot.val();
        if (data && Object.keys(data).length > 0) {
            courtData = data;
            
            Object.keys(courtData).forEach(cName => {
                const q1 = courtData[cName][0];
                const pCount = (q1.players || []).filter(p => p !== '').length;
                if (pCount === 0 || pCount === 4) {
                    clearTimer(cName, 0);
                }
            });
        } else {
            db.ref('courts').set(courtData);
        }

        if (!document.getElementById('courtModal').classList.contains('hidden')) {
            renderQueues();
        }
        if (!document.getElementById('adminPage').classList.contains('hidden')) {
            renderAdminPanel();
        }
    });

    db.ref('active_users').on('value', (snapshot) => {
        activeUsersData = snapshot.val() || {};
        if (!document.getElementById('adminPage').classList.contains('hidden')) {
            renderAdminPanel();
        }
    });

    // ดักฟังการถูกเตะออกจากระบบ Real-time
    db.ref('kicked_user').on('value', (snapshot) => {
        const kickedName = snapshot.val();
        if (kickedName && currentUser && !currentUser.isAdmin) {
            if (currentUser.username.toLowerCase() === kickedName.toLowerCase()) {
                alert('คุณถูกผู้ดูแลระบบ (Admin) เตะออกจากระบบ');
                forceClientLogout();
            }
        }
    });

    db.ref('lastFinishedCourt').on('value', (snapshot) => {
        const finishedInfo = snapshot.val();
        if (finishedInfo && !isFirstLoad) {
            alert(`${finishedInfo.courtName} คิว 1 เล่นจบแมตช์แล้ว ระบบทำการเลื่อนคิวให้อัตโนมัติ`);
        }
        isFirstLoad = false;
    });
}

function createEmptyQueues() {
    return Array.from({ length: 5 }, () => ({
        owner: null,
        players: ['', '', '', ''],
        timeLeft: 120,
        doneVotes: []
    }));
}

async function isUserOnline(username) {
    if (!username || username.toLowerCase() === 'admin') return false;
    const target = username.trim().toLowerCase();

    if (useFirebase && db) {
        try {
            const snapshot = await db.ref(`active_users/${target}`).once('value');
            return snapshot.exists();
        } catch (e) {
            console.error("Check active user failed:", e);
        }
    }
    return false;
}

async function handleLogin() {
    const userVal = document.getElementById('loginUsername').value.trim();
    const passVal = document.getElementById('loginPassword').value.trim();

    if (!userVal) {
        alert('กรุณากรอกชื่อผู้ใช้งาน');
        return;
    }

    if (userVal.toLowerCase() !== 'admin') {
        if (passVal !== '1234') {
            alert('รหัสผ่านไม่ถูกต้อง! (ผู้ใช้ทั่วไปใช้ 1234)');
            return;
        }

        const online = await isUserOnline(userVal);
        if (online) {
            alert(`ชื่อผู้ใช้ "${userVal}" มีคนกำลังใช้งานอยู่ในระบบแล้ว กรุณาใช้ชื่ออื่น หรือต่อท้ายด้วยตัวเลข`);
            return;
        }

        currentUser = { username: userVal, isAdmin: false };

        if (useFirebase && db) {
            db.ref(`active_users/${userVal.toLowerCase()}`).set(userVal);
        }
    } else {
        if (passVal === 'admin') {
            currentUser = { username: 'Admin', isAdmin: true };
        } else {
            alert('รหัสผ่าน Admin ไม่ถูกต้อง!');
            return;
        }
    }

    localStorage.setItem('badminton_user', JSON.stringify(currentUser));

    document.getElementById('loginPage').classList.add('hidden');
    document.getElementById('userPage').classList.remove('hidden');
    document.getElementById('currentUserDisplay').innerText = currentUser.username;

    if (currentUser.isAdmin) {
        document.getElementById('adminNavBtn').classList.remove('hidden');
    } else {
        document.getElementById('adminNavBtn').classList.add('hidden');
    }
}

function clearUserBookingOnLogout(username) {
    if (!username || username.toLowerCase() === 'admin') return;
    const targetUser = username.trim().toLowerCase();

    for (const courtName in courtData) {
        const queues = courtData[courtName] || [];
        for (let i = 0; i < queues.length; i++) {
            const players = queues[i].players || [];
            for (let j = 0; j < players.length; j++) {
                if (players[j] && players[j].trim().toLowerCase() === targetUser) {
                    removeSinglePlayer(courtName, i, j);
                }
            }
        }
    }
}

function forceClientLogout() {
    localStorage.removeItem('badminton_user');
    currentUser = null;
    closePopup();
    document.getElementById('userPage').classList.add('hidden');
    document.getElementById('adminPage').classList.add('hidden');
    document.getElementById('loginPage').classList.remove('hidden');
    document.getElementById('loginUsername').value = '';
    document.getElementById('loginPassword').value = '';
}

function handleLogout() {
    if (currentUser && currentUser.username) {
        clearUserBookingOnLogout(currentUser.username);

        if (!currentUser.isAdmin && useFirebase && db) {
            db.ref(`active_users/${currentUser.username.toLowerCase()}`).remove();
        }
    }
    
    forceClientLogout();
}

function kickSingleActiveUser(usernameKey, displayName) {
    if (confirm(`คุณต้องการเตะผู้ใช้ "${displayName}" ออกจากระบบใช่หรือไม่?`)) {
        clearUserBookingOnLogout(displayName);

        if (useFirebase && db) {
            db.ref(`active_users/${usernameKey}`).remove();
            db.ref('kicked_user').set(displayName);
        }

        alert(`เตะผู้ใช้ "${displayName}" ออกเรียบร้อยแล้ว`);
    }
}

function openPopup(courtName) {
    currentSelectedCourt = courtName;
    document.getElementById('modalTitle').innerText = courtName;
    renderQueues();
    document.getElementById('courtModal').classList.remove('hidden');
}

function closePopup() {
    document.getElementById('courtModal').classList.add('hidden');
}

function renderQueues() {
    const container = document.getElementById('queueListContainer');
    container.innerHTML = '';

    const queues = courtData[currentSelectedCourt] || [];

    queues.forEach((q, queueIndex) => {
        const item = document.createElement('div');
        item.className = 'queue-item';

        const players = q.players || ['', '', '', ''];
        const playerCount = players.filter(p => p !== '').length;
        const doneVotes = q.doneVotes || [];
        let timerText = '';
        let finishBtnHTML = '';

        if (queueIndex === 0 && playerCount > 0 && playerCount < 4) {
            const mins = Math.floor(q.timeLeft / 60);
            const secs = q.timeLeft % 60;
            const formattedSecs = secs < 10 ? '0' + secs : secs;
            const formattedMins = mins < 10 ? '0' + mins : mins;
            timerText = `
                <span class="timer-badge">
                    ตัดคิวใน <span class="time-num">${formattedMins}:${formattedSecs}</span>
                </span>`;
        }

        if (queueIndex === 0 && playerCount === 4) {
            const isVoted = currentUser && doneVotes.includes(currentUser.username);
            const votedClass = isVoted ? 'voted' : '';
            const btnText = isVoted ? 'คุณโหวตแล้ว' : 'เล่นเสร็จแล้ว';
            
            finishBtnHTML = `
                <button class="finish-game-btn ${votedClass}" onclick="voteFinishGame('${currentSelectedCourt}')">
                    ${btnText} (${doneVotes.length}/3)
                </button>`;
        }

        const ownerTag = q.owner ? `<small style="opacity: 0.75;">(เจ้าของ: ${q.owner})</small>` : '';

        const renderPlayerBox = (slotIdx, defaultText) => {
            const pName = players[slotIdx];
            if (!pName) {
                return `<div class="player empty" onclick="slotClick(${queueIndex}, ${slotIdx})">${defaultText}</div>`;
            }
            
            const isMe = currentUser && (pName.toLowerCase() === currentUser.username.toLowerCase());
            
            if (isMe) {
                return `<div class="player my-slot" title="คลิกเพื่อออกจากคิว" onclick="slotClick(${queueIndex}, ${slotIdx})">
                            ${pName} <span class="player-leave-icon">(ออก)</span>
                        </div>`;
            }
            
            return `<div class="player occupied" onclick="slotClick(${queueIndex}, ${slotIdx})">${pName}</div>`;
        };

        item.innerHTML = `
            <div class="queue-header">
                <span class="queue-label">คิว ${queueIndex + 1} ${ownerTag}</span>
                <div style="display:flex; align-items:center;">
                    ${timerText}
                    ${finishBtnHTML}
                </div>
            </div>
            <div class="match-row">
                ${renderPlayerBox(0, '+ จองเปิดคิว')}
                ${renderPlayerBox(1, '+ จองร่วม')}
                <span class="colon">:</span>
                ${renderPlayerBox(2, '+ จองท้าชน')}
                ${renderPlayerBox(3, '+ จองท้าชน')}
            </div>
        `;
        container.appendChild(item);
    });
}

function voteFinishGame(courtName) {
    if (currentUser && currentUser.isAdmin) {
        alert('Admin ไม่สามารถกดโหวตได้ครับ');
        return;
    }

    const queue1 = courtData[courtName][0];
    const players = queue1.players || [];

    if (!players.includes(currentUser.username)) {
        alert('เฉพาะผู้เล่นที่อยู่ในคิว 1 เท่านั้นที่จะสามารถกดเล่นเสร็จแล้วได้ครับ');
        return;
    }

    if (!queue1.doneVotes) queue1.doneVotes = [];

    const voteIndex = queue1.doneVotes.indexOf(currentUser.username);
    if (voteIndex > -1) {
        queue1.doneVotes.splice(voteIndex, 1);
    } else {
        queue1.doneVotes.push(currentUser.username);
    }

    if (queue1.doneVotes.length >= 3) {
        shiftQueues(courtName);
        if (useFirebase && db) {
            db.ref('lastFinishedCourt').set({
                courtName: courtName,
                timestamp: Date.now()
            });
        }
        return;
    }

    updateCourtToDatabase(courtName);
}

function clearAllTimersForCourt(courtName) {
    for (let i = 0; i < 5; i++) {
        clearTimer(courtName, i);
    }
}

function shiftQueues(courtName) {
    clearAllTimersForCourt(courtName);

    const queues = courtData[courtName];

    queues.shift();

    let readyIndex = -1;
    for (let i = 0; i < queues.length; i++) {
        const pCount = (queues[i].players || []).filter(p => p !== '').length;
        if (pCount === 4) {
            readyIndex = i;
            break;
        }
    }

    if (readyIndex > 0) {
        const readyQueue = queues.splice(readyIndex, 1)[0];
        queues.unshift(readyQueue);
    }

    queues.push({
        owner: null,
        players: ['', '', '', ''],
        timeLeft: 120,
        doneVotes: []
    });

    queues[0].timeLeft = 120;

    const newQueue1Players = (queues[0].players || []).filter(p => p !== '').length;
    if (newQueue1Players > 0 && newQueue1Players < 4) {
        startTimer(courtName, 0);
    }

    updateCourtToDatabase(courtName);
}

function getUserExistingBooking(username) {
    if (!username || username.toLowerCase() === 'admin') return null;
    const targetUser = username.trim().toLowerCase();

    const courtNameArr = Object.keys(courtData);
    for (let c = 0; c < courtNameArr.length; c++) {
        const cName = courtNameArr[c];
        const queues = courtData[cName] || [];
        for (let i = 0; i < queues.length; i++) {
            const players = queues[i].players || [];
            for (let j = 0; j < players.length; j++) {
                if (players[j] && players[j].trim().toLowerCase() === targetUser) {
                    return { courtName: cName, queueIndex: i + 1 };
                }
            }
        }
    }
    return null;
}

// ==========================================
// 📍 3. ฟังก์ชันคลิกจองช่อง (เพิ่มระบบตรวจเช็กพิกัดแล้ว)
// ==========================================
async function slotClick(queueIndex, slotIndex) {
    if (currentUser && currentUser.isAdmin) {
        alert('บัญชี Admin มีไว้สำหรับดูแลและตรวจสอบระบบเท่านั้น ไม่สามารถลงจองเล่นได้');
        return;
    }

    const queue = courtData[currentSelectedCourt][queueIndex];
    if (!queue.players) queue.players = ['', '', '', ''];

    const currentPlayerInSlot = queue.players[slotIndex];

    // ถ้ากดที่ช่องตัวเอง ให้กดออกจากคิวได้เลย (ไม่ต้องเช็ก GPS)
    if (currentPlayerInSlot && currentPlayerInSlot.toLowerCase() === currentUser.username.toLowerCase()) {
        if (confirm(`คุณต้องการออกจากคิวที่ ${queueIndex + 1} ใช่หรือไม่?`)) {
            removeSinglePlayer(currentSelectedCourt, queueIndex, slotIndex);
        }
        return;
    }

    // ถ้าเป็นช่องของผู้อื่น ไม่ให้ทำอะไร
    if (currentPlayerInSlot !== '') {
        return;
    }

    // 🔒 [เช็กพิกัด GPS] ก่อนทำการกดจองคิวใหม่
    try {
        const userLoc = await getUserLocation();
        const distance = getDistanceInMeters(userLoc.lat, userLoc.lng, COURT_LOCATION.lat, COURT_LOCATION.lng);
        const distanceRounded = Math.round(distance);

        if (distance > COURT_LOCATION.radiusMeters) {
            alert(`❌ คุณไม่อยู่ในบริเวณสนาม!\n\nตำแหน่งของคุณอยู่ห่างออกไปประมาณ ${distanceRounded} เมตร\n(ต้องอยู่ในระยะไม่เกิน ${COURT_LOCATION.radiusMeters} เมตร เท่านั้นจึงจะจองคิวได้)`);
            return;
        }
    } catch (error) {
        alert(`❌ ไม่สามารถตรวจสอบตำแหน่งของคุณได้:\n${error.message}`);
        return;
    }

    const existingBooking = getUserExistingBooking(currentUser.username);
    if (existingBooking) {
        alert(`คุณมีคิวการเล่นติดอยู่ที่ "${existingBooking.courtName} คิว ${existingBooking.queueIndex}" แล้ว ไม่สามารถจองเพิ่มได้!`);
        return;
    }

    const prevPlayerCount = queue.players.filter(p => p !== '').length;

    queue.players[slotIndex] = currentUser.username;

    if (!queue.owner) {
        queue.owner = currentUser.username;
    }

    const newPlayerCount = queue.players.filter(p => p !== '').length;

    if (queueIndex === 0) {
        if (prevPlayerCount === 0 && newPlayerCount === 1) {
            queue.timeLeft = 120;
            startTimer(currentSelectedCourt, 0);
        } else if (newPlayerCount === 4) {
            clearTimer(currentSelectedCourt, 0);
        }
    }

    updateCourtToDatabase(currentSelectedCourt);
}

function removeSinglePlayer(court, queueIndex, slotIndex) {
    const queue = courtData[court][queueIndex];
    if (!queue || !queue.players) return;

    queue.players[slotIndex] = '';

    if (queue.doneVotes) {
        const voteIdx = queue.doneVotes.indexOf(currentUser ? currentUser.username : '');
        if (voteIdx > -1) queue.doneVotes.splice(voteIdx, 1);
    }

    const remainingPlayers = queue.players.filter(p => p !== '');
    if (remainingPlayers.length > 0) {
        queue.owner = remainingPlayers[0];
    } else {
        queue.owner = null;
        queue.timeLeft = 120;
        queue.doneVotes = [];
        if (queueIndex === 0) clearTimer(court, 0);
    }

    updateCourtToDatabase(court);
}

function updateCourtToDatabase(court) {
    if (useFirebase && db) {
        db.ref(`courts/${court}`).set(courtData[court]);
    } else {
        renderQueues();
    }
}

function startTimer(court, index) {
    const timerKey = `${court}_${index}`;
    const queue = courtData[court][index];

    clearTimer(court, index);

    timerIntervals[timerKey] = setInterval(() => {
        const currentQ = (courtData[court] && courtData[court][index]) ? courtData[court][index] : null;
        if (!currentQ) {
            clearTimer(court, index);
            return;
        }

        const currentPCount = (currentQ.players || []).filter(p => p !== '').length;
        
        if (currentPCount === 0 || currentPCount === 4) {
            clearTimer(court, index);
            return;
        }

        currentQ.timeLeft--;

        if (useFirebase && db) {
            db.ref(`courts/${court}/${index}/timeLeft`).set(currentQ.timeLeft);
        } else {
            if (currentSelectedCourt === court && !document.getElementById('courtModal').classList.contains('hidden')) {
                renderQueues();
            }
        }

        if (currentQ.timeLeft <= 0) {
            clearTimer(court, index);
            const emptyQueue = { owner: null, players: ['', '', '', ''], timeLeft: 120, doneVotes: [] };
            if (useFirebase && db) {
                db.ref(`courts/${court}/${index}`).set(emptyQueue);
            } else {
                courtData[court][index] = emptyQueue;
                if (currentSelectedCourt === court) renderQueues();
            }
            alert(`เวลาครบ 2 นาทีแล้ว คิว 1 ของ ${court} ถูกตัดออกเนื่องจากสมาชิกไม่ครบ 4 คน`);
        }
    }, 1000);
}

function clearTimer(court, index) {
    const timerKey = `${court}_${index}`;
    if (timerIntervals[timerKey]) {
        clearInterval(timerIntervals[timerKey]);
        delete timerIntervals[timerKey];
    }
}

function goToAdmin() {
    closePopup();
    renderAdminPanel();
    document.getElementById('userPage').classList.add('hidden');
    document.getElementById('adminPage').classList.remove('hidden');
}

function goToUser() {
    document.getElementById('adminPage').classList.add('hidden');
    document.getElementById('userPage').classList.remove('hidden');
}

function renderAdminPanel() {
    const container = document.getElementById('adminPanelContainer');
    container.innerHTML = '';

    let activeUsersHTML = '';
    const activeKeys = Object.keys(activeUsersData);

    if (activeKeys.length > 0) {
        activeKeys.forEach(key => {
            const name = activeUsersData[key];
            activeUsersHTML += `
                <span style="display:inline-flex; align-items:center; background:#E0F2FE; color:#0369A1; padding:4px 10px; border-radius:16px; margin:4px; font-size:13px; font-weight:600;">
                    ${name} 
                    <button class="delete-btn" style="padding:2px 6px; font-size:11px; margin-left:8px;" onclick="kickSingleActiveUser('${key}', '${name}')">เตะออก</button>
                </span>`;
        });
    } else {
        activeUsersHTML = '<p style="color:#888; font-size:13px;">ไม่มีผู้ใช้ออนไลน์ในขณะนี้</p>';
    }

    const activeUserSection = `
        <div style="margin-bottom: 24px; padding: 16px; background-color: #F8FAFC; border-radius: 12px; border: 1px solid #E2E8F0;">
            <h3 style="color: var(--brand-teal); font-size: 16px; margin-bottom: 10px;">รายชื่อผู้ใช้งานที่ออนไลน์อยู่ในขณะนี้ (${activeKeys.length} คน)</h3>
            <div style="display:flex; flex-wrap:wrap; gap:4px;">
                ${activeUsersHTML}
            </div>
        </div>`;

    container.innerHTML = activeUserSection;

    Object.keys(courtData).forEach(courtName => {
        const courtBox = document.createElement('div');
        courtBox.className = 'admin-court-item';
        
        let queuesHTML = '';
        const queues = courtData[courtName] || [];
        
        queues.forEach((q, idx) => {
            const p = q.players || ['', '', '', ''];
            const playerCount = p.filter(x => x !== '').length;

            if (playerCount > 0) {
                const renderPlayerAdmin = (pName, slotIdx) => {
                    if (!pName) return '<span style="color:#aaa;">-</span>';
                    return `<span style="background:#f0f0f0; padding:2px 6px; border-radius:4px; margin:0 2px; font-weight:bold;">
                                ${pName} 
                                <button class="delete-btn" style="padding:1px 4px; font-size:10px;" onclick="removeSinglePlayer('${courtName}', ${idx}, ${slotIdx})">ออก</button>
                            </span>`;
                };

                const forceShiftBtn = (idx === 0) 
                    ? `<button class="delete-btn" style="background:#10B981; margin-left:10px;" onclick="shiftQueues('${courtName}')">บังคับจบแมตช์ (เลื่อนคิว)</button>` 
                    : '';

                queuesHTML += `
                    <div class="admin-queue-row" style="margin-bottom:12px; padding-bottom:8px; border-bottom:1px dashed #eee;">
                        <div>
                            <strong>คิว ${idx + 1} (เจ้าของ: ${q.owner || '-'}):</strong> ${forceShiftBtn} <br>
                            ฝั่ง A: ${renderPlayerAdmin(p[0], 0)} , ${renderPlayerAdmin(p[1], 1)} 
                            <strong style="margin:0 8px;">:</strong> 
                            ฝั่ง B: ${renderPlayerAdmin(p[2], 2)} , ${renderPlayerAdmin(p[3], 3)}
                        </div>
                    </div>`;
            }
        });

        courtBox.innerHTML = `
            <h3>${courtName}</h3>
            ${queuesHTML || '<p style="color:#888; font-size:13px;">ยังไม่มีการจอง</p>'}
        `;
        container.appendChild(courtBox);
    });
}