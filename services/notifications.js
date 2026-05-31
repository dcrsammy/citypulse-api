const db = require('../db');
const { sendEmail, templates } = require('./email');

// Notify vendor: New order (EMAIL)
async function notifyNewOrder(venueId, orderId, customerName, totalAmount) {
  try {
    const result = await db.query(
      `SELECT v.id, v.business_name, v.owner_full_name, u.email 
       FROM vendors v
       JOIN users u ON v.id = u.id
       WHERE v.id = (SELECT vendor_id FROM venues WHERE id = $1)`,
      [venueId]
    );
    
    const vendor = result.rows[0];
    if (!vendor) return;

    const html = templates.newOrder(vendor.owner_full_name, customerName, totalAmount, orderId);
    await sendEmail(vendor.email, '🍽️ New Order Received!', html);
    console.log('✅ New order email sent to:', vendor.email);
  } catch (err) {
    console.error('❌ New order notification error:', err.message);
  }
}

// Notify vendor: KYC approved
async function notifyKYCApproved(vendorId) {
  try {
    const result = await db.query(
      'SELECT owner_full_name, business_name, email FROM vendors WHERE id=$1',
      [vendorId]
    );
    const vendor = result.rows[0];
    if (!vendor) return;

    const html = templates.kycApproved(vendor.owner_full_name, vendor.business_name);
    await sendEmail(vendor.email, '✅ KYC Verification Approved!', html);
    console.log('✅ KYC approved email sent to:', vendor.email);
  } catch (err) {
    console.error('❌ KYC notification error:', err.message);
  }
}

// Notify vendor: Venue approved
async function notifyVenueApproved(venueId) {
  try {
    const result = await db.query(
      `SELECT v.name, vn.owner_full_name, u.email
       FROM venues v
       JOIN vendors vn ON v.vendor_id = vn.id
       JOIN users u ON vn.id = u.id
       WHERE v.id = $1`,
      [venueId]
    );
    const venue = result.rows[0];
    if (!venue) return;

    const html = templates.venueApproved(venue.owner_full_name, venue.name);
    await sendEmail(venue.email, '🎉 Venue is Now Live!', html);
    console.log('✅ Venue approved email sent to:', venue.email);
  } catch (err) {
    console.error('❌ Venue notification error:', err.message);
  }
}

// Send Expo push notification
async function sendPushNotification(expoPushToken, title, body, data = {}) {
  try {
    const message = {
      to: expoPushToken,
      sound: 'default',
      title,
      body,
      data,
    };
    const res = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(message),
    });
    const result = await res.json();
    console.log('✅ Push sent:', result);
    return result;
  } catch (err) {
    console.error('❌ Push error:', err.message);
  }
}

// Notify customer: Order status changed
async function notifyOrderStatus(orderId, status) {
  try {
    const result = await db.query(
      'SELECT u.fcm_token, u.full_name, u.email FROM food_orders fo JOIN users u ON fo.user_id = u.id WHERE fo.id=$1',
      [orderId]
    );
    const user = result.rows[0];
    if (!user) return;

    const statusMessages = {
      confirmed:  { title: '✅ Order Confirmed!',    body: 'Your order has been accepted by the restaurant.' },
      preparing:  { title: '👨‍🍳 Being Prepared!',    body: 'The kitchen is working on your order.' },
      ready:      { title: '🔔 Order Ready!',         body: 'Your order is ready for pickup/collection!' },
      on_the_way: { title: '🛵 On The Way!',          body: 'Your order is heading to you!' },
      completed:  { title: '🎉 Order Completed!',     body: 'Enjoy your meal! Leave a review?' },
      cancelled:  { title: '❌ Order Cancelled',      body: 'Your order has been cancelled.' },
    };

    const msg = statusMessages[status];
    if (!msg) return;

    // Send push notification
    if (user.fcm_token && user.fcm_token.startsWith('ExponentPushToken')) {
      await sendPushNotification(user.fcm_token, msg.title, msg.body, { orderId, status });
    }

    // Send email as backup
    const emailHtml = templates.orderStatus(user.full_name, status, orderId);
    await sendEmail(user.email, msg.title, emailHtml);
  } catch (err) {
    console.error('❌ Order status notification error:', err.message);
  }
}

module.exports = {
  notifyNewOrder,
  notifyKYCApproved,
  notifyVenueApproved,
  notifyOrderStatus,
  sendPushNotification
};
