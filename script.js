// 📍 ตั้งค่าพิกัดสนามและรัศมีที่อนุญาต (60 เมตร)
const COURT_LOCATION = {
  lat: 7.203006610774002,
  lng: 100.60069610167278,
  radiusMeters: 60,
};

const ACCURACY_LIMIT_METERS = 300;

let currentUser = null;
let isRegisterMode = false;
let currentSelectedCourt = "";
let activeUsersData = {};
let timerIntervals = {};
let isFirstLoad = true;
let isRegistering = false; // ตัวแปรเช็คสถานะการสมัครเพื่อกันหน้าเว็บกระพริบ
let notifiedForCourt = null; // ตัวแปรป้องกันการแจ้งเตือนซ้ำกะพริบรัวๆ

// ==========================================
// ส่วนของการแจ้งเตือน (Web Notifications API)
// ==========================================

// ขอสิทธิ์การแจ้งเตือนจากเบราว์เซอร์
function requestNotificationPermission() {
  if ("Notification" in window && Notification.permission === "default") {
    Notification.requestPermission();
  }
}

// ฟังก์ชันสั่งยิงแจ้งเตือน
function sendTurnNotification(courtName, targetUserFcmToken) {
  const title = "ถึงคิวของคุณแล้ว! 🏸";
  const body = `เชิญเตรียมตัวที่ ${courtName} คิวที่ 1 ได้เลยครับ`;

  // สำรองไว้กรณีเขาเล่นบนเว็บปกติที่เปิดจออยู่
  if ("Notification" in window && Notification.permission === "granted") {
    new Notification(title, {
      body: body,
      icon: "https://cdn-icons-png.flaticon.com/512/889/889518.png",
    });
  }

  // ถ้าระบบมี FCM Token ของเขา (ได้มาจากข้อ 3 ในคำตอบที่แล้ว) ให้ยิงแจ้งเตือนมือถือ
  if (targetUserFcmToken) {
    const gasUrl = "https://script.google.com/macros/s/YOUR_WEB_APP_ID/exec"; // เอา URL จาก Apps Script มาใส่ตรงนี้

    fetch(gasUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        to: targetUserFcmToken,
        title: title,
        body: body,
      }),
    })
      .then((response) => response.json())
      .then((data) => console.log("ยิงแจ้งเตือนผ่าน GAS สำเร็จ:", data))
      .catch((error) => console.error("แจ้งเตือน Error:", error));
  }
}

// ==========================================

function createEmptyQueues() {
  return [
    { owner: null, players: ["", "", "", ""], timeLeft: 60, doneVotes: [] },
    { owner: null, players: ["", "", "", ""], timeLeft: 60, doneVotes: [] },
    { owner: null, players: ["", "", "", ""], timeLeft: 60, doneVotes: [] },
    { owner: null, players: ["", "", "", ""], timeLeft: 60, doneVotes: [] },
    { owner: null, players: ["", "", "", ""], timeLeft: 60, doneVotes: [] },
  ];
}

let courtData = {
  "คอร์ท 1": createEmptyQueues(),
  "คอร์ท 2": createEmptyQueues(),
  "คอร์ท 3": createEmptyQueues(),
  "คอร์ท 4": createEmptyQueues(),
};

function getDistanceInMeters(lat1, lon1, lat2, lon2) {
  const R = 6371e3;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function getUserLocation() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("อุปกรณ์ของคุณไม่รองรับการดึงพิกัดตำแหน่ง"));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          accuracy: position.coords.accuracy,
        });
      },
      (error) => {
        reject(
          new Error(
            "กรุณาเปิด/อนุญาตสิทธิ์การเข้าถึงตำแหน่ง (Location Access)",
          ),
        );
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
    );
  });
}

const firebaseConfig = {
  apiKey: "AIzaSyCD0a9pLD1_1h1umN6vUBgArBHe8aO4Bwg",
  authDomain: "jongcourt-42aeb.firebaseapp.com",
  databaseURL: "https://jongcourt-42aeb-default-rtdb.firebaseio.com",
  projectId: "jongcourt-42aeb",
  storageBucket: "jongcourt-42aeb.firebasestorage.app",
  messagingSenderId: "785155114918",
  appId: "1:785155114918:web:f3184642d8843aa99c3167",
  measurementId: "G-T4654QMTYR",
};

let db = null;
let auth = null;
let useFirebase = false;

try {
  if (typeof firebase !== "undefined") {
    if (!firebase.apps.length) {
      firebase.initializeApp(firebaseConfig);
    }
    db = firebase.database();
    auth = firebase.auth();
    useFirebase = true;
  }
} catch (e) {
  console.error("Firebase Initialization Error:", e);
}

function toggleAuthMode() {
  isRegisterMode = !isRegisterMode;
  const title = document.getElementById("authTitle");
  const submitBtn = document.getElementById("authSubmitBtn");
  const switchText = document.getElementById("switchText");
  const usernameGroup = document.getElementById("usernameGroup");
  const identifierLabel = document.getElementById("inputIdentifierLabel");
  const identifierInput = document.getElementById("loginIdentifier");

  if (isRegisterMode) {
    title.innerText = "สมัครสมาชิกใหม่ (สำหรับ Users ทั่วไป)";
    submitBtn.innerText = "สมัครสมาชิก";
    switchText.innerText = "มีบัญชีอยู่แล้ว? เข้าสู่ระบบที่นี่";
    identifierLabel.innerText = "อีเมลสำหรับสมัครสมาชิก (Email)";
    identifierInput.placeholder = "กรอกอีเมลจริงของคุณ";
    usernameGroup.classList.remove("hidden");
  } else {
    title.innerText = "เข้าสู่ระบบจองคอร์ท";
    submitBtn.innerText = "เข้าสู่ระบบ";
    switchText.innerText = "ยังไม่มีบัญชีใช่ไหม? สมัครสมาชิกที่นี่";
    identifierLabel.innerText = "ชื่อผู้ใช้งาน หรือ อีเมล (Username / Email)";
    identifierInput.placeholder = "กรอก Username หรือ Email ของคุณ";
    usernameGroup.classList.add("hidden");
  }
}

window.addEventListener("DOMContentLoaded", () => {
  if (useFirebase && auth) {
    auth.onAuthStateChanged(async (user) => {
      // ✅ ดักไว้ไม่ให้เปลี่ยนหน้าเว็บ หากกำลังอยู่ในขั้นตอนการสมัครสมาชิก
      if (isRegistering) return;

      if (user) {
        let userData = null;
        try {
          const userSnapshot = await db.ref(`users/${user.uid}`).once("value");
          userData = userSnapshot.val();
        } catch (err) {
          console.error("ดึงข้อมูลผู้ใช้จาก Database ไม่สำเร็จ:", err);
        }

        const isAdminAccount = userData
          ? userData.isAdmin
          : user.email === "admin@admin.com";

        currentUser = {
          uid: user.uid,
          email: user.email,
          username: userData ? userData.username : "Admin",
          isAdmin: isAdminAccount,
        };

        document.getElementById("loginPage").classList.add("hidden");
        document.getElementById("userPage").classList.remove("hidden");
        document.getElementById("currentUserDisplay").innerText =
          currentUser.username;

        // ขออนุญาตแจ้งเตือนเมื่อล็อกอินสำเร็จ
        requestNotificationPermission();

        if (currentUser.isAdmin) {
          document.getElementById("adminNavBtn").classList.remove("hidden");
        } else {
          document.getElementById("adminNavBtn").classList.add("hidden");
          // จัดการสถานะออนไลน์ และ ตั้งค่า onDisconnect ให้ลบอัตโนมัติหากหลุดการเชื่อมต่อ
          const activeUserRef = db.ref(`active_users/${currentUser.uid}`);
          activeUserRef.set(currentUser.username);
          activeUserRef.onDisconnect().remove();
        }
      } else {
        forceClientLogoutUI();
      }
    });
  }
});

async function handleAuthAction() {
  const identifier = document.getElementById("loginIdentifier").value.trim();
  const password = document.getElementById("loginPassword").value.trim();
  const usernameInput = document.getElementById("loginUsername").value.trim();

  if (!identifier || !password) {
    alert("กรุณากรอกข้อมูลและรหัสผ่านให้ครบถ้วน");
    return;
  }

  try {
    let targetEmail = identifier;

    // ถ้าไม่ใช่ Admin และไม่ใช่ Email ให้หา Email จาก Username ใน Database ก่อน
    const isAdminAttempt =
      identifier.toLowerCase() === "admin" ||
      identifier.toLowerCase() === "admin@admin.com";

    if (!isAdminAttempt && !identifier.includes("@")) {
      const usersRef = db.ref("users");
      const snapshot = await usersRef.once("value");
      let foundEmail = null;

      snapshot.forEach((childSnapshot) => {
        const uData = childSnapshot.val();
        if (
          uData.username &&
          uData.username.toLowerCase() === identifier.toLowerCase()
        ) {
          foundEmail = uData.email;
        }
      });

      if (!foundEmail) {
        alert(
          `ไม่พบชื่อผู้ใช้งาน "${identifier}" ในระบบ กรุณาใช้อีเมลในการเข้าสู่ระบบแทน`,
        );
        return;
      }
      targetEmail = foundEmail;
    }

    if (isRegisterMode) {
      if (!usernameInput) {
        alert("กรุณากรอกชื่อที่ใช้แสดงในคอร์ทด้วยครับ");
        return;
      }

      // ✅ 1. เปิดสถานะกำลังสมัคร เพื่อระงับการเปลี่ยนหน้าเว็บ
      isRegistering = true;

      const userCredential = await auth.createUserWithEmailAndPassword(
        identifier,
        password,
      );
      const uid = userCredential.user.uid;

      await db.ref(`users/${uid}`).set({
        username: usernameInput,
        email: identifier,
        isAdmin: false,
      });

      // ✅ 2. สั่งออกจากระบบทันที โดยที่หน้าเว็บจะไม่กระพริบไปหน้าจองคอร์ทแล้ว
      await auth.signOut();

      // ✅ 3. ปิดสถานะกำลังสมัคร
      isRegistering = false;

      alert("สมัครสมาชิกสำเร็จ! กรุณาเข้าสู่ระบบอีกครั้ง");
      toggleAuthMode();
    } else {
      // ==========================================
      // ปิดคำสั่งเช็ค GPS สำหรับการทดสอบชั่วคราว
      // ==========================================
      /*
      if (!isAdminAttempt) {
        // แสดงหน้าต่างโหลดพิกัด GPS เพื่อไม่ให้ผู้ใช้คิดว่าเว็บค้าง
        document.getElementById("loadingModal").classList.remove("hidden");

        try {
          const userLoc = await getUserLocation();
          const distance = getDistanceInMeters(
            userLoc.lat,
            userLoc.lng,
            COURT_LOCATION.lat,
            COURT_LOCATION.lng
          );
          const distanceRounded = Math.round(distance);
          const accuracyRounded = Math.round(userLoc.accuracy);

          document.getElementById("loadingModal").classList.add("hidden");

          if (userLoc.accuracy > ACCURACY_LIMIT_METERS) {
            alert(
              `⚠️ ไม่สามารถยืนยันตำแหน่งได้แม่นยำพอ (ความคลาดเคลื่อน ±${accuracyRounded} เมตร)\nกรุณาเปิด GPS หรือเชื่อมต่อเน็ตมือถือแล้วลองใหม่`
            );
            return;
          }

          const effectiveDistance = Math.max(0, distance - userLoc.accuracy);
          if (effectiveDistance > COURT_LOCATION.radiusMeters) {
            alert(
              `❌ เข้าสู่ระบบไม่ได้!\nคุณอยู่ห่างจากสนามประมาณ ${distanceRounded} เมตร (ต้องอยู่ในระยะไม่เกิน ${COURT_LOCATION.radiusMeters} เมตร)`
            );
            return;
          }
        } catch (gpsErr) {
          document.getElementById("loadingModal").classList.add("hidden");
          alert(gpsErr.message);
          return;
        }
      }
      */
      // ==========================================

      await auth.signInWithEmailAndPassword(targetEmail, password);
    }
  } catch (error) {
    // ✅ เผื่อกรณีเกิด Error ตอนสมัครสมาชิก (เช่น อีเมลซ้ำ) ต้องเคลียร์สถานะคืน
    isRegistering = false;
    document.getElementById("loadingModal").classList.add("hidden");
    alert("ดำเนินการไม่สำเร็จ: " + error.message);
  }
}

function clearUserBookingOnLogout(username) {
  if (!username || username.toLowerCase() === "admin") return;
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

async function handleLogout() {
  if (currentUser) {
    clearUserBookingOnLogout(currentUser.username);
    if (!currentUser.isAdmin && db) {
      await db.ref(`active_users/${currentUser.uid}`).remove();
    }
  }
  if (auth) {
    await auth.signOut();
  }
}

function forceClientLogoutUI() {
  currentUser = null;
  notifiedForCourt = null; // รีเซ็ตการแจ้งเตือน
  closePopup();
  document.getElementById("userPage").classList.add("hidden");
  document.getElementById("adminPage").classList.add("hidden");
  document.getElementById("loginPage").classList.remove("hidden");
  document.getElementById("loginIdentifier").value = "";
  document.getElementById("loginPassword").value = "";
  if (document.getElementById("loginUsername")) {
    document.getElementById("loginUsername").value = "";
  }
}

function kickSingleActiveUser(uidKey, displayName) {
  if (confirm(`คุณต้องการเตะผู้ใช้ "${displayName}" ออกจากระบบใช่หรือไม่?`)) {
    clearUserBookingOnLogout(displayName);
    if (useFirebase && db) {
      db.ref(`active_users/${uidKey}`).remove();
      db.ref("kicked_user").set(displayName);
    }
    alert(`เตะผู้ใช้ "${displayName}" ออกเรียบร้อยแล้ว`);
  }
}

function openPopup(courtName) {
  currentSelectedCourt = courtName;
  document.getElementById("modalTitle").innerText = courtName;
  renderQueues();
  document.getElementById("courtModal").classList.remove("hidden");
}

function closePopup() {
  document.getElementById("courtModal").classList.add("hidden");
}

function renderQueues() {
  const container = document.getElementById("queueListContainer");
  container.innerHTML = "";
  const queues = courtData[currentSelectedCourt] || [];

  queues.forEach((q, queueIndex) => {
    const item = document.createElement("div");
    item.className = "queue-item";

    const players = q.players || ["", "", "", ""];
    const playerCount = players.filter((p) => p !== "").length;
    const doneVotes = q.doneVotes || [];
    let timerText = "";
    let finishBtnHTML = "";

    if (queueIndex === 0 && playerCount > 0 && playerCount < 4) {
      const mins = Math.floor(q.timeLeft / 60);
      const secs = q.timeLeft % 60;
      const formattedSecs = secs < 10 ? "0" + secs : secs;
      const formattedMins = mins < 10 ? "0" + mins : mins;
      timerText = `<span class="timer-badge">ตัดคิวใน <span class="time-num">${formattedMins}:${formattedSecs}</span></span>`;
    }

    if (queueIndex === 0 && playerCount === 4) {
      const isVoted = currentUser && doneVotes.includes(currentUser.username);
      const votedClass = isVoted ? "voted" : "";
      const btnText = isVoted ? "คุณโหวตแล้ว" : "เล่นเสร็จแล้ว";
      finishBtnHTML = `<button class="finish-game-btn ${votedClass}" onclick="voteFinishGame('${currentSelectedCourt}')">${btnText} (${doneVotes.length}/3)</button>`;
    }

    const ownerTag = q.owner
      ? `<small style="opacity: 0.75;">(เจ้าของ: ${q.owner})</small>`
      : "";

    const renderPlayerBox = (slotIdx, defaultText) => {
      const pName = players[slotIdx];
      if (!pName)
        return `<div class="player empty" onclick="slotClick(${queueIndex}, ${slotIdx})">${defaultText}</div>`;
      const isMe =
        currentUser &&
        pName.toLowerCase() === currentUser.username.toLowerCase();
      if (isMe) {
        return `<div class="player my-slot" title="คลิกเพื่อออกจากคิว" onclick="slotClick(${queueIndex}, ${slotIdx})">${pName} <span class="player-leave-icon">(ออก)</span></div>`;
      }
      return `<div class="player occupied" onclick="slotClick(${queueIndex}, ${slotIdx})">${pName}</div>`;
    };

    item.innerHTML = `
            <div class="queue-header">
                <span class="queue-label">คิว ${queueIndex + 1} ${ownerTag}</span>
                <div style="display:flex; align-items:center;">${timerText}${finishBtnHTML}</div>
            </div>
            <div class="match-row">
                ${renderPlayerBox(0, "+ จองเปิดคิว")}
                ${renderPlayerBox(1, "+ จองร่วม")}
                <span class="colon">:</span>
                ${renderPlayerBox(2, "+ จองท้าชน")}
                ${renderPlayerBox(3, "+ จองท้าชน")}
            </div>
        `;
    container.appendChild(item);
  });
}

function voteFinishGame(courtName) {
  if (currentUser && currentUser.isAdmin) {
    alert("Admin ไม่สามารถกดโหวตได้ครับ");
    return;
  }
  const queue1 = courtData[courtName][0];
  const players = queue1.players || [];
  if (!players.includes(currentUser.username)) {
    alert(
      "เฉพาะผู้เล่นที่อยู่ในคิว 1 เท่านั้นที่จะสามารถกดเล่นเสร็จแล้วได้ครับ",
    );
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
      db.ref("lastFinishedCourt").set({
        courtName: courtName,
        timestamp: Date.now(),
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
    const pCount = (queues[i].players || []).filter((p) => p !== "").length;
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
    players: ["", "", "", ""],
    timeLeft: 60, // เปลี่ยนเป็น 60
    doneVotes: [],
  });
  queues[0].timeLeft = 60; // เปลี่ยนเป็น 60

  const newQueue1Players = (queues[0].players || []).filter(
    (p) => p !== "",
  ).length;
  if (newQueue1Players > 0 && newQueue1Players < 4) {
    startTimer(courtName, 0);
  }
  updateCourtToDatabase(courtName);
}

function getUserExistingBooking(username) {
  if (!username || username.toLowerCase() === "admin") return null;
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

function slotClick(queueIndex, slotIndex) {
  if (currentUser && currentUser.isAdmin) {
    alert(
      "บัญชี Admin มีไว้สำหรับดูแลและตรวจสอบระบบเท่านั้น ไม่สามารถลงจองเล่นได้",
    );
    return;
  }
  const queue = courtData[currentSelectedCourt][queueIndex];
  if (!queue.players) queue.players = ["", "", "", ""];
  const currentPlayerInSlot = queue.players[slotIndex];

  if (
    currentPlayerInSlot &&
    currentPlayerInSlot.toLowerCase() === currentUser.username.toLowerCase()
  ) {
    if (confirm(`คุณต้องการออกจากคิวที่ ${queueIndex + 1} ใช่หรือไม่?`)) {
      removeSinglePlayer(currentSelectedCourt, queueIndex, slotIndex);
    }
    return;
  }
  if (currentPlayerInSlot !== "") return;

  const existingBooking = getUserExistingBooking(currentUser.username);
  if (existingBooking) {
    alert(
      `คุณมีคิวการเล่นติดอยู่ที่ "${existingBooking.courtName} คิว ${existingBooking.queueIndex}" แล้ว ไม่สามารถจองเพิ่มได้!`,
    );
    return;
  }

  const prevPlayerCount = queue.players.filter((p) => p !== "").length;
  queue.players[slotIndex] = currentUser.username;
  if (!queue.owner) queue.owner = currentUser.username;
  const newPlayerCount = queue.players.filter((p) => p !== "").length;

  if (queueIndex === 0) {
    if (prevPlayerCount === 0 && newPlayerCount === 1) {
      queue.timeLeft = 60; // เปลี่ยนจาก 120 เป็น 60
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
  queue.players[slotIndex] = "";

  if (queue.doneVotes) {
    const voteIdx = queue.doneVotes.indexOf(
      currentUser ? currentUser.username : "",
    );
    if (voteIdx > -1) queue.doneVotes.splice(voteIdx, 1);
  }

  const remainingPlayers = queue.players.filter((p) => p !== "");
  if (remainingPlayers.length > 0) {
    queue.owner = remainingPlayers[0];
    updateCourtToDatabase(court);
  } else {
    // --- จุดที่แก้ไข: เมื่อคิวว่างเปล่า (คนออกจนหมด) ---

    if (queueIndex === 0) {
      // กรณีที่ 1: ถ้าเป็นคิว 1 ยกเลิกจนว่าง ให้รัน shiftQueues เพื่อดันคิวข้างล่างขึ้นมาแทนที่ทันที
      shiftQueues(court);
    } else {
      // กรณีที่ 2: ถ้าเป็นคิวอื่นๆ ว่าง (เช่น คิว 2 หรือ 3 คนออกหมด)
      // ให้ตัดคิวที่เป็นช่องโหว่ตรงกลางทิ้ง ดันคิวที่เหลือขึ้น และเติมคิวว่างไปต่อท้ายสุด
      courtData[court].splice(queueIndex, 1);
      courtData[court].push({
        owner: null,
        players: ["", "", "", ""],
        timeLeft: 60,
        doneVotes: [],
      });
      updateCourtToDatabase(court);
    }
  }
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
    const currentQ =
      courtData[court] && courtData[court][index]
        ? courtData[court][index]
        : null;
    if (!currentQ) {
      clearTimer(court, index);
      return;
    }

    const currentPCount = (currentQ.players || []).filter(
      (p) => p !== "",
    ).length;
    if (currentPCount === 0 || currentPCount === 4) {
      clearTimer(court, index);
      return;
    }

    currentQ.timeLeft--;
    if (useFirebase && db) {
      db.ref(`courts/${court}/${index}/timeLeft`).set(currentQ.timeLeft);
    }

    if (currentQ.timeLeft <= 0) {
      clearTimer(court, index);
      alert(
        `เวลาครบ 1 นาทีแล้ว คิว 1 ของ ${court} ถูกตัดออกเนื่องจากสมาชิกไม่ครบ 4 คน`,
      );

      // เรียกใช้ shiftQueues เพื่อเตะคิว 1 ออก และดึงคิว 2 (หรือคิวถัดไปที่เต็ม 4 คน) ขึ้นมาแทนที่อัตโนมัติ
      shiftQueues(court);
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
  document.getElementById("userPage").classList.add("hidden");
  document.getElementById("adminPage").classList.remove("hidden");
}

function goToUser() {
  document.getElementById("adminPage").classList.add("hidden");
  document.getElementById("userPage").classList.remove("hidden");
}

function renderAdminPanel() {
  const container = document.getElementById("adminPanelContainer");
  container.innerHTML = "";

  let activeUsersHTML = "";
  const activeKeys = Object.keys(activeUsersData);

  if (activeKeys.length > 0) {
    activeKeys.forEach((uidKey) => {
      const name = activeUsersData[uidKey];
      activeUsersHTML += `
                <span style="display:inline-flex; align-items:center; background:#E0F2FE; color:#0369A1; padding:4px 10px; border-radius:16px; margin:4px; font-size:13px; font-weight:600;">
                    ${name} 
                    <button class="delete-btn" style="padding:2px 6px; font-size:11px; margin-left:8px;" onclick="kickSingleActiveUser('${uidKey}', '${name}')">เตะออก</button>
                </span>`;
    });
  } else {
    activeUsersHTML =
      '<p style="color:#888; font-size:13px;">ไม่มีผู้ใช้ออนไลน์ในขณะนี้</p>';
  }

  const activeUserSection = `
        <div style="margin-bottom: 24px; padding: 16px; background-color: #F8FAFC; border-radius: 12px; border: 1px solid #E2E8F0;">
            <h3 style="color: var(--brand-teal); font-size: 16px; margin-bottom: 10px;">รายชื่อผู้ใช้งานที่ออนไลน์ (${activeKeys.length} คน)</h3>
            <div style="display:flex; flex-wrap:wrap; gap:4px;">${activeUsersHTML}</div>
        </div>`;

  container.innerHTML = activeUserSection;

  Object.keys(courtData).forEach((courtName) => {
    const courtBox = document.createElement("div");
    courtBox.className = "admin-court-item";
    let queuesHTML = "";
    const queues = courtData[courtName] || [];

    queues.forEach((q, idx) => {
      const p = q.players || ["", "", "", ""];
      const playerCount = p.filter((x) => x !== "").length;
      if (playerCount > 0) {
        const renderPlayerAdmin = (pName, slotIdx) => {
          if (!pName) return '<span style="color:#aaa;">-</span>';
          return `<span style="background:#f0f0f0; padding:2px 6px; border-radius:4px; margin:0 2px; font-weight:bold;">${pName} <button class="delete-btn" style="padding:1px 4px; font-size:10px;" onclick="removeSinglePlayer('${courtName}', ${idx}, ${slotIdx})">ออก</button></span>`;
        };
        const forceShiftBtn =
          idx === 0
            ? `<button class="delete-btn" style="background:#10B981; margin-left:10px;" onclick="shiftQueues('${courtName}')">บังคับจบแมตช์</button>`
            : "";
        queuesHTML += `
                    <div class="admin-queue-row" style="margin-bottom:12px; padding-bottom:8px; border-bottom:1px dashed #eee;">
                        <div>
                            <strong>คิว ${idx + 1} (เจ้าของ: ${q.owner || "-"}):</strong> ${forceShiftBtn} <br>
                            ฝั่ง A: ${renderPlayerAdmin(p[0], 0)} , ${renderPlayerAdmin(p[1], 1)} <strong style="margin:0 8px;">:</strong> ฝั่ง B: ${renderPlayerAdmin(p[2], 2)} , ${renderPlayerAdmin(p[3], 3)}
                        </div>
                    </div>`;
      }
    });

    courtBox.innerHTML = `<h3>${courtName}</h3>${queuesHTML || '<p style="color:#888; font-size:13px;">ยังไม่มีการจอง</p>'}`;
    container.appendChild(courtBox);
  });
}

if (useFirebase && db) {
  db.ref("courts").on("value", (snapshot) => {
    const data = snapshot.val();
    if (data && Object.keys(data).length > 0) {
      courtData = data;

      let isMyTurn = false;
      let myCourtTurn = "";

      Object.keys(courtData).forEach((cName) => {
        const q1 = courtData[cName][0];
        const pCount = (q1.players || []).filter((p) => p !== "").length;

        if (pCount === 0 || pCount === 4) {
          clearTimer(cName, 0);
        }

        // เช็คว่าผู้ใช้ล็อกอินอยู่ และไม่ใช่แอดมิน แล้วดูว่าชื่ออยู่ในคิว 1 ของคอร์ทนี้หรือไม่
        if (currentUser && !currentUser.isAdmin) {
          if ((q1.players || []).includes(currentUser.username)) {
            isMyTurn = true;
            myCourtTurn = cName;
          }
        }
      });

      // ในส่วนของ Firebase real-time listener (if (useFirebase && db))
      if (isMyTurn) {
        if (notifiedForCourt !== myCourtTurn) {
          sendTurnNotification(myCourtTurn); // แจ้งเตือนบนหน้าเว็บ (ถ้าเปิดอยู่)

          // 🚨 สั่งยิงข้อความเข้ากลุ่ม LINE อัตโนมัติทันทีที่ขึ้นคิว 1
          const currentQueuePlayers = courtData[myCourtTurn][0].players;
          triggerLineGroupAlert(myCourtTurn, currentQueuePlayers);

          notifiedForCourt = myCourtTurn;
        }
      } else {
        notifiedForCourt = null;
      }
    } else {
      db.ref("courts").set(courtData);
    }

    if (!document.getElementById("courtModal").classList.contains("hidden")) {
      renderQueues();
    }
    if (!document.getElementById("adminPage").classList.contains("hidden")) {
      renderAdminPanel();
    }
  });

  db.ref("active_users").on("value", (snapshot) => {
    activeUsersData = snapshot.val() || {};
    if (!document.getElementById("adminPage").classList.contains("hidden")) {
      renderAdminPanel();
    }
  });

  db.ref("kicked_user").on("value", (snapshot) => {
    const kickedName = snapshot.val();
    if (kickedName && currentUser && !currentUser.isAdmin) {
      if (currentUser.username.toLowerCase() === kickedName.toLowerCase()) {
        alert("คุณถูกผู้ดูแลระบบ (Admin) เตะออกจากระบบ");
        auth.signOut();
        forceClientLogoutUI();
      }
    }
  });

  db.ref("lastFinishedCourt").on("value", (snapshot) => {
    const finishedInfo = snapshot.val();
    if (finishedInfo && !isFirstLoad) {
      alert(
        `${finishedInfo.courtName} คิว 1 เล่นจบแมตช์แล้ว ระบบทำการเลื่อนคิวให้อัตโนมัติ`,
      );
    }
    isFirstLoad = false;
  });
}

function triggerLineGroupAlert(courtName, playersArray) {
    const gasWebAppUrl = "https://script.google.com/macros/s/AKfycbxHHGT4juH2rYMEiIYKXp_1mZTZe3soKpb26Ok0PEBakwTcZ3a0D_kT1TQ24_RgPNCf5A/exec"; // 🔑 ใส่ลิงก์ /exec ตัวล่าสุด

    fetch(gasWebAppUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            courtName: courtName,
            players: playersArray
        })
    })
    .catch(err => console.error("LINE Notify Error:", err));
}
