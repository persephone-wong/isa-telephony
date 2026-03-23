const express = require('express');
const mysql = require('mysql2/promise');
const bcrypt = require('bcrypt');
const cors = require('cors');
const path = require('path');
const twilio = require('twilio');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const app = express();
app.use(express.json());
app.use(cors());
const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const phone = twilio(accountSid, authToken);


const appDatabaseUrl = process.env.DATABASE_URL || process.env.APP_DATABASE_URL;
const adminDatabaseUrl = process.env.DATABASE_URL || process.env.ADMIN_DATABASE_URL;


if (!appDatabaseUrl || !adminDatabaseUrl) {
  throw new Error('Missing database URL. Set APP_DATABASE_URL/ADMIN_DATABASE_URL or DATABASE_URL in .env');
}

// Regular app operations pool
const appPool = mysql.createPool({
  uri: appDatabaseUrl
});

// Admin operations pool
const adminPool = mysql.createPool({
  uri: adminDatabaseUrl
});

// ==================
// AUTH ROUTES
// ==================

app.post('/register', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  const hash = await bcrypt.hash(password, 10);

  try {
    await appPool.query(
      'INSERT INTO users (email, password_hash) VALUES (?, ?)',
      [email, hash]
    );
    res.json({ success: true });
  } catch (err) {
    if (err && err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'Email already exists' });
    }

    console.error('Register error:', err);
    res.status(500).json({ error: 'Registration failed' });
  }
});

app.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const [rows] = await appPool.query(
      'SELECT id, email, password_hash FROM users WHERE email = ?',
      [email]
    );
    const user = rows[0];

    if (user && await bcrypt.compare(password, user.password_hash)) {
      res.json({ success: true, message: 'Login successful' });
    } else {
      res.status(401).json({ error: 'Invalid credentials' });
    }
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

app.post('/receive-call', (req, res) => {
    const VoiceResponse = twilio.twiml.VoiceResponse; // Import VoiceResponse correctly
    const twiml = new VoiceResponse();
    twiml.say('This is ISA Telephony. Your call has been received and confirmed. Thank you for using our service!');
    res.type('text/xml');
    res.send(twiml.toString());
});

// ==================
// ADMIN ROUTES
// ==================

// Middleware to protect admin routes
function requireAdmin(req, res, next) {
  const adminKey = req.headers['x-admin-key'];
  if (adminKey !== process.env.ADMIN_SECRET_KEY) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  next();
}

// Get all users
app.get('/admin/users', requireAdmin, async (req, res) => {
  const [rows] = await adminPool.query(
    'SELECT id, email, api_calls_consumed, created_at FROM users'
  );
  res.json(rows);
});

// Delete a user
app.delete('/admin/delete-user', requireAdmin, async (req, res) => {
  await adminPool.query('DELETE FROM users WHERE id = ?', [req.body.id]);
  res.json({ success: true });
});

// Update api_calls_consumed for a user
app.put('/admin/update-api-calls', requireAdmin, async (req, res) => {
  const { id, api_calls_consumed } = req.body;
  await adminPool.query(
    'UPDATE users SET api_calls_consumed = ? WHERE id = ?',
    [api_calls_consumed, id]
  );
  res.json({ success: true });
});

app.listen(process.env.PORT || 3000, () => {
  console.log('Server running');
  phone.incomingPhoneNumbers(process.env.PHONE_NUMBER_SID).update({voiceUrl: 'https://isa-telephony.onrender.com/receive-call'})
.then(number => console.log(number.friendlyName))
.catch(err => console.error('Error updating Twilio phone number:', err));
});


