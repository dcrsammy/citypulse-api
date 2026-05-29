const db = require('../db');
const admin = require('firebase-admin');

// Initialize Firebase (if credentials available)
let firebaseReady = false;
try {
  if (process.env.FIREBASE_PRIVATE_KEY && process.env.FIREBASE_PROJECT_ID) {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      }),
    });
    firebaseReady = true;
    console.log('✅ Firebase initialized');
  } else {
    console.warn('⚠️ Firebase credentials not configured');
  }
} catch (err) {
  console.warn('Firebase init error:', err.message);
}

// Send push notification via FCM
async function sendPush(userId, title, body, data = {}) {
  try {
    if (!firebaseReady) {
      console.log('Firebase not ready, skipping push');
      return;
    }

    const result = await db.query('SELECT fcm_token FROM users WHERE id=$1', [userId]);
    const user = result.rows[0];
    
    if (!user || !user.fcm_token) {
      console.log('No FCM token for user:', userId);
      return;
    }

    await admin.messaging().send({
      token: user.fcm_token,
      notification: { title, body },
      data,
      webpush: {
        notification: { title, body, icon: '/logo.png' }
      }
    });

    console.log('✅ Push sent:', userId, title);
  } catch (err) {
    console.error('Push error:', err.message);
  }
}

// Notify vendor of new order
async function notifyVendorNewOrder(venueId, orderId, customerName, amount) {
  try {
    const vendor = await db.query('SELECT user_id FROM vendors WHERE id=(SELECT vendor_id FROM venues WHERE id=$1)', [venueId]);
    if (!vendor.rows[0]) return;

    const vendorUserId = vendor.rows[0].user_id;
    await sendPush(
      vendorUserId,
      `🍽️ New Order #${orderId.slice(-6)}`,
      `${customerName} ordered ₦${Number(amount).toLocaleString()}`,
      { type: 'new_order', order_id: orderId }
    );
  } catch (err) {
    console.error('Vendor notification error:', err.message);
  }
}

module.exports = {
  sendPush,
  notifyVendorNewOrder
};
