const { Resend } = require('resend');
const resend = new Resend(process.env.RESEND_API_KEY);

async function sendVerificationEmail(email, code, name) {
  try {
    await resend.emails.send({
      from: 'CityPulse <onboarding@resend.dev>',
      to:   email,
      subject: `${code} is your CityPulse verification code`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; background: #0E0E10; color: #F2F0EC; padding: 40px; border-radius: 16px;">
          <h1 style="color: #E8A83E; font-size: 28px; margin-bottom: 4px;">CityPulse</h1>
          <p style="color: #A8A5A0; margin-bottom: 32px;">Discover the best of Lagos</p>
          <p style="font-size: 16px; margin-bottom: 8px;">Hi ${name || 'there'},</p>
          <p style="color: #A8A5A0; margin-bottom: 32px;">Your verification code is:</p>
          <div style="background: #222228; border: 2px solid #E8A83E; border-radius: 12px; padding: 24px; text-align: center; margin-bottom: 32px;">
            <span style="font-size: 42px; font-weight: 800; letter-spacing: 12px; color: #E8A83E;">${code}</span>
          </div>
          <p style="color: #A8A5A0; font-size: 13px;">This code expires in 10 minutes. If you did not create a CityPulse account, ignore this email.</p>
          <hr style="border-color: rgba(255,255,255,0.07); margin: 24px 0;">
          <p style="color: #5E5C5A; font-size: 11px;">CityPulse · Lagos, Nigeria</p>
        </div>
      `,
    });
    return true;
  } catch (err) {
    console.error('Email error:', err);
    return false;
  }
}

module.exports = { sendVerificationEmail };
