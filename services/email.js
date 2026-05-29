const { Resend } = require('resend');

const resend = new Resend(process.env.RESEND_API_KEY);

async function sendEmail(to, subject, html) {
  try {
    const result = await resend.emails.send({
      from: 'noreply@citypulse.ng',
      to,
      subject,
      html
    });
    console.log('✅ Email sent to:', to);
    return result;
  } catch (err) {
    console.error('❌ Email error:', err.message);
    throw err;
  }
}

// Email templates
const templates = {
  newOrder: (vendorName, customerName, amount, orderId) => `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #FFA500;">🍽️ New Order Received!</h2>
      <p>Hi ${vendorName},</p>
      <p>You have a new order!</p>
      <div style="background: #f5f5f5; padding: 20px; border-radius: 8px; margin: 20px 0;">
        <p><strong>Customer:</strong> ${customerName}</p>
        <p><strong>Order ID:</strong> ${orderId.slice(-6)}</p>
        <p><strong>Amount:</strong> ₦${Number(amount).toLocaleString()}</p>
      </div>
      <p><a href="https://citypulse-vendor.netlify.app/#/dashboard" style="background: #FFA500; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; display: inline-block;">View Order</a></p>
      <p style="margin-top: 30px; color: #999; font-size: 12px;">CityPulse - Local Food Marketplace</p>
    </div>
  `,

  kycApproved: (vendorName, businessName) => `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #28a745;">✅ KYC Verification Approved!</h2>
      <p>Hi ${vendorName},</p>
      <p><strong>${businessName}</strong> has been verified and approved!</p>
      <p>You can now:</p>
      <ul>
        <li>Go live on CityPulse</li>
        <li>Receive customer orders</li>
        <li>Earn money from food sales</li>
      </ul>
      <p><a href="https://citypulse-vendor.netlify.app/#/dashboard" style="background: #28a745; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; display: inline-block;">Go to Dashboard</a></p>
      <p style="margin-top: 30px; color: #999; font-size: 12px;">CityPulse - Local Food Marketplace</p>
    </div>
  `,

  venueApproved: (vendorName, venueName) => `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #28a745;">🎉 Venue is Now Live!</h2>
      <p>Hi ${vendorName},</p>
      <p><strong>${venueName}</strong> is now visible to all CityPulse customers!</p>
      <p>Start receiving orders and earn money today! 🚀</p>
      <p><a href="https://citypulse-vendor.netlify.app/#/dashboard" style="background: #FFA500; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; display: inline-block;">View Dashboard</a></p>
      <p style="margin-top: 30px; color: #999; font-size: 12px;">CityPulse - Local Food Marketplace</p>
    </div>
  `,

  orderStatus: (customerName, status, orderId) => `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #FFA500;">📦 Order Update</h2>
      <p>Hi ${customerName},</p>
      <p>Your order <strong>#${orderId.slice(-6)}</strong> is: <strong>${status.toUpperCase()}</strong></p>
      <p><a href="https://citypulse.ng/orders" style="background: #FFA500; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; display: inline-block;">Track Order</a></p>
      <p style="margin-top: 30px; color: #999; font-size: 12px;">CityPulse - Local Food Marketplace</p>
    </div>
  `
};

module.exports = {
  sendEmail,
  templates
};
