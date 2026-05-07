// keepAlive.js

const BACKEND_URL = 'https://electraguard-backend.onrender.com'; // ← apna Render URL lagao

const pingServer = async () => {
  try {
    const response = await fetch(BACKEND_URL);
    console.log(`✅ Keep-alive ping: ${response.status} - ${new Date().toLocaleTimeString()}`);
  } catch (err) {
    console.error('❌ Keep-alive error:', err.message);
  }
};

// Har 10 minute mein ping
setInterval(pingServer, 10 * 60 * 1000);

console.log('🔄 Keep-alive started');