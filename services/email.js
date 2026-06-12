const { Resend } = require('resend');

const resend = new Resend(process.env.RESEND_API_KEY);

async function sendEmail(to, subject, html) {
  try {
    const result = await resend.emails.send({
      from: 'noreply@city-pulse.live',
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


  verification: (email, code) => `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#080810;">
      <div style="background:#080810;padding:32px;text-align:center;border-bottom:1px solid #222;">
        <h1 style="color:#FF3366;margin:0;font-size:28px;letter-spacing:-1px;">CityPulse</h1>
        <p style="color:#666;margin:4px 0 0;font-size:12px;">Nigeria at your fingertips</p>
      </div>
      <div style="padding:40px 32px;">
        <h2 style="color:#fff;font-size:22px;margin:0 0 8px;">Verify your email</h2>
        <p style="color:#A8A5A0;font-size:14px;line-height:22px;margin:0 0 32px;">Enter this code in the app to verify <strong style="color:#fff">${email}</strong></p>
        <div style="background:#0F0F1A;border:1px solid #FF3366;border-radius:16px;padding:32px;text-align:center;margin:0 0 32px;">
          <p style="color:#A8A5A0;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:2px;margin:0 0 12px;">Your verification code</p>
          <p style="color:#FF3366;font-size:48px;font-weight:800;margin:0;letter-spacing:12px;">${code}</p>
          <p style="color:#5E5C5A;font-size:12px;margin:12px 0 0;">Expires in 10 minutes</p>
        </div>
        <p style="color:#5E5C5A;font-size:12px;line-height:20px;">If you did not create a CityPulse account, ignore this email.</p>
      </div>
      <div style="background:#0F0F1A;padding:20px;text-align:center;border-top:1px solid #222;">
        <p style="margin:0;color:#5E5C5A;font-size:12px;">CityPulse · Nigeria · city-pulse.live</p>
      </div>
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

templates.reservationConfirmation = (customerName, venueName, date, time, partySize, pin) => `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #fff;">
      <div style="background: #000; padding: 24px; text-align: center;">
        <h1 style="color: #FF8C42; margin: 0;">CityPulse</h1>
      </div>
      <div style="padding: 32px;">
        <h2 style="color: #000;">🎉 Reservation Confirmed!</h2>
        <p>Hi ${customerName},</p>
        <p>Your table at <strong>${venueName}</strong> is confirmed!</p>
        <div style="background: #f9f9f9; border: 1px solid #E5E5E5; border-radius: 12px; padding: 24px; margin: 24px 0;">
          <p style="margin: 0 0 8px 0;"><strong>📅 Date:</strong> ${date}</p>
          <p style="margin: 0 0 8px 0;"><strong>🕐 Time:</strong> ${time}</p>
          <p style="margin: 0 0 8px 0;"><strong>👥 Party:</strong> ${partySize === 1 ? 'Solo' : 'Group of ' + partySize}</p>
          <p style="margin: 0;"><strong>📍 Venue:</strong> ${venueName}</p>
        </div>
        <div style="background: #000; border-radius: 12px; padding: 24px; text-align: center; margin: 24px 0;">
          <p style="color: #FF8C42; margin: 0 0 8px 0; font-size: 12px; font-weight: 700; text-transform: uppercase;">Your Verification PIN</p>
          <p style="color: #FFF; font-size: 36px; font-weight: 800; margin: 0; letter-spacing: 8px;">${pin}</p>
          <p style="color: #999; font-size: 12px; margin: 8px 0 0 0;">Show this PIN or your QR code at the restaurant</p>
        </div>
        <p style="color: #666; font-size: 13px;">Need to cancel? Please do so at least 2 hours before your reservation.</p>
      </div>
      <div style="background: #f5f5f5; padding: 16px; text-align: center;">
        <p style="margin: 0; color: #999; font-size: 12px;">CityPulse · Lagos Never Sleeps</p>
      </div>
    </div>
  `;

module.exports = {
  sendEmail,
  templates
};
