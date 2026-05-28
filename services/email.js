const { Resend } = require('resend');

async function sendVerificationEmail(email, code, name) {
  try {
    const resend = new Resend(process.env.RESEND_API_KEY);
    const result = await resend.emails.send({
      from: 'CityPulse <onboarding@resend.dev>',
      to: email,
      subject: `${code} is your CityPulse verification code`,
      html: `<div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:40px;background:#0E0E10;color:#F2F0EC;border-radius:16px"><h1 style="color:#E8A83E">CityPulse</h1><p style="color:#A8A5A0">Hi ${name || 'there'},</p><p style="color:#A8A5A0">Your verification code is:</p><div style="background:#222228;border:2px solid #E8A83E;border-radius:12px;padding:24px;text-align:center;margin:24px 0"><span style="font-size:42px;font-weight:800;letter-spacing:12px;color:#E8A83E">${code}</span></div><p style="color:#A8A5A0;font-size:13px">This code expires in 10 minutes.</p></div>`,
    });
    console.log('Email sent:', result.data?.id);
    return true;
  } catch (err) {
    console.error('Email error:', err.message);
    return false;
  }
}

module.exports = { sendVerificationEmail };
