const db = require("../db");

// Send FCM push notification via Firebase HTTP v1 API
async function sendPush(userId, title, body, data = {}) {
  try {
    const userRes = await db.query("SELECT fcm_token FROM users WHERE id=$1", [userId]);
    const fcmToken = userRes.rows[0]?.fcm_token;
    if (!fcmToken) return;

    // Store in notifications table regardless of FCM success
    await db.query(
      `INSERT INTO notifications (user_id, title, body, type, data)
       VALUES ($1, $2, $3, $4, $5)`,
      [userId, title, body, data.type || "general", JSON.stringify(data)]
    );

    // Only attempt FCM if credentials available
    if (!process.env.FIREBASE_PROJECT_ID || !process.env.FIREBASE_CLIENT_EMAIL) return;

    const axios = require("axios");
    const jwt   = require("jsonwebtoken");

    // Create service account JWT for FCM
    const now = Math.floor(Date.now() / 1000);
    const payload = {
      iss: process.env.FIREBASE_CLIENT_EMAIL,
      sub: process.env.FIREBASE_CLIENT_EMAIL,
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
      scope: "https://www.googleapis.com/auth/firebase.messaging",
    };

    const privateKey = (process.env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\n");
    if (!privateKey) return;

    const signedJwt = jwt.sign(payload, privateKey, { algorithm: "RS256" });

    // Exchange for access token
    const tokenRes = await axios.post("https://oauth2.googleapis.com/token", {
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: signedJwt,
    });
    const accessToken = tokenRes.data.access_token;

    // Send FCM message
    await axios.post(
      `https://fcm.googleapis.com/v1/projects/${process.env.FIREBASE_PROJECT_ID}/messages:send`,
      {
        message: {
          token: fcmToken,
          notification: { title, body },
          data: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v)])),
        }
      },
      { headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("Push notification error:", err.message);
  }
}

module.exports = { sendPush };
