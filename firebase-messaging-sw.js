// นำเข้า Firebase SDK สำหรับ Service Worker
importScripts('https://www.gstatic.com/firebasejs/8.10.1/firebase-app.js');
importScripts('https://www.gstatic.com/firebasejs/8.10.1/firebase-messaging.js');

// ตั้งค่า Firebase (ก็อปปี้มาจากหน้าเว็บคุณได้เลย)
const firebaseConfig = {
  apiKey: "AIzaSyCD0a9pLD1_1h1umN6vUBgArBHe8aO4Bwg",
  authDomain: "jongcourt-42aeb.firebaseapp.com",
  projectId: "jongcourt-42aeb",
  storageBucket: "jongcourt-42aeb.firebasestorage.app",
  messagingSenderId: "785155114918",
  appId: "1:785155114918:web:f3184642d8843aa99c3167"
};

firebase.initializeApp(firebaseConfig);
const messaging = firebase.messaging();

// ฟังก์ชันรับข้อความตอนที่แอปถูกพับจอ (Background)
messaging.onBackgroundMessage((payload) => {
  const notificationTitle = payload.notification.title;
  const notificationOptions = {
    body: payload.notification.body,
    icon: "https://cdn-icons-png.flaticon.com/512/889/889518.png",
    vibrate: [200, 100, 200]
  };

  self.registration.showNotification(notificationTitle, notificationOptions);
});