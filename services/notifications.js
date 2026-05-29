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

module.exports = {
  notifyNewOrder,
  notifyKYCApproved,
  notifyVenueApproved
};
