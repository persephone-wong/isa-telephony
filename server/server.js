const express = require('express');
const mysql = require('mysql2/promise');
const bcrypt = require('bcrypt');
const cors = require('cors');
const path = require('path');
const twilio = require('twilio');
const jwt = require("jsonwebtoken");
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const app = express();
app.use(express.json());
app.use(cors());
const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const phone = twilio(accountSid, authToken);
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) throw new Error("Missing JWT_SECRET in .env");

const appDatabaseUrl = process.env.DATABASE_URL || process.env.APP_DATABASE_URL;
const adminDatabaseUrl = process.env.DATABASE_URL || process.env.ADMIN_DATABASE_URL;


if (!appDatabaseUrl || !adminDatabaseUrl) {
  throw new Error(
    "Missing database URL. Set APP_DATABASE_URL/ADMIN_DATABASE_URL or DATABASE_URL in .env",
  );
}

const appPool = mysql.createPool({ uri: appDatabaseUrl });
const adminPool = mysql.createPool({ uri: adminDatabaseUrl });

const FREE_CALL_LIMIT = 20;

// ==================
// HELPERS
// ==================

// escapes a string for safe HTML insertion — used server-side if ever templating,
// and mirrored client-side (prevents xss).
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ==================
// MIDDLEWARE
// ==================

// verifies JWT and attaches decoded user to req.user.
// Also increments api_calls_consumed and sets limit headers.
async function requireAuth(req, res, next) {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1]; // "Bearer <token>"

  if (!token) return res.status(401).json({ error: "No token provided" });

  let decoded;
  try {
    decoded = jwt.verify(token, JWT_SECRET);
  } catch {
    return res.status(403).json({ error: "Invalid or expired token" });
  }

  try {
    const [rows] = await appPool.query(
      "SELECT id, email, api_calls_consumed, is_admin FROM users WHERE id = ?",
      [decoded.userId],
    );
    const user = rows[0];
    if (!user) return res.status(401).json({ error: "User not found" });

    const calls = user.api_calls_consumed || 0;

    await appPool.query(
      "UPDATE users SET api_calls_consumed = api_calls_consumed + 1 WHERE id = ?",
      [user.id],
    );

    res.setHeader("X-Api-Calls-Used", calls + 1);
    res.setHeader("X-Api-Calls-Limit", FREE_CALL_LIMIT);
    if (calls + 1 >= FREE_CALL_LIMIT) {
      res.setHeader("X-Api-Limit-Reached", "true");
    }

    req.user = {
      ...decoded,
      api_calls_consumed: calls + 1,
      is_admin: user.is_admin,
    };
    next();
  } catch (err) {
    console.error("Auth middleware error:", err);
    res.status(500).json({ error: "Authentication check failed" });
  }
}

// verifies the static admin key for admin-only routes
function requireAdmin(req, res, next) {
  const adminKey = req.headers["x-admin-key"];
  if (adminKey !== process.env.ADMIN_SECRET_KEY) {
    return res.status(403).json({ error: "Forbidden" });
  }
  next();
}

// ==================
// AUTH ROUTES
// ==================

app.post("/register", async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: "Email and password are required" });
  }

  const hash = await bcrypt.hash(password, 10);

  try {
    const [result] = await appPool.query(
      "INSERT INTO users (email, password_hash) VALUES (?, ?)",
      [email, hash], // parameterized — safe from SQL injection
    );
    const token = jwt.sign({ userId: result.insertId, email }, JWT_SECRET, {
      expiresIn: "7d",
    });
    res.json({ success: true, token, isAdmin: false });
  } catch (err) {
    if (err?.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ error: "Email already exists" });
    }
    console.error("Register error:", err);
    res.status(500).json({ error: "Registration failed" });
  }
});

app.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required" });
    }

    const [rows] = await appPool.query(
      "SELECT id, email, password_hash, is_admin FROM users WHERE email = ?",
      [email], // parameterized — safe from SQL injection
    );
    const user = rows[0];

    if (user && (await bcrypt.compare(password, user.password_hash))) {
      const token = jwt.sign(
        { userId: user.id, email: user.email, isAdmin: user.is_admin },
        JWT_SECRET,
        { expiresIn: "7d" },
      );
      res.json({ success: true, token, isAdmin: !!user.is_admin });
    } else {
      res.status(401).json({ error: "Invalid credentials" });
    }
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ error: "Login failed" });
  }
});

// ==================
// DASHBOARD ROUTES
// ==================

// Returns the logged-in user's own stats — used by dashboard.html
app.get("/me", requireAuth, async (req, res) => {
  try {
    const [rows] = await appPool.query(
      "SELECT id, email, api_calls_consumed, is_admin FROM users WHERE id = ?",
      [req.user.userId],
    );
    const user = rows[0];
    if (!user) return res.status(404).json({ error: "User not found" });

    res.json({
      id: user.id,
      email: user.email,
      apiCallsConsumed: user.api_calls_consumed,
      apiCallsLimit: FREE_CALL_LIMIT,
      isAdmin: !!user.is_admin,
    });
  } catch (err) {
    console.error("Me error:", err);
    res.status(500).json({ error: "Failed to fetch user data" });
  }
});

// ==================
// DASHBOARD ROUTES
// ==================

// Returns the logged-in user's own stats — used by dashboard.html
app.get("/me", requireAuth, async (req, res) => {
  try {
    const [rows] = await appPool.query(
      "SELECT id, email, api_calls_consumed, is_admin FROM users WHERE id = ?",
      [req.user.userId],
    );
    const user = rows[0];
    if (!user) return res.status(404).json({ error: "User not found" });

    res.json({
      id: user.id,
      email: user.email,
      apiCallsConsumed: user.api_calls_consumed,
      apiCallsLimit: FREE_CALL_LIMIT,
      isAdmin: !!user.is_admin,
    });
  } catch (err) {
    console.error("Me error:", err);
    res.status(500).json({ error: "Failed to fetch user data" });
  }
});

app.post('/receive-call', (req, res) => {
    const VoiceResponse = twilio.twiml.VoiceResponse;
    const response = new VoiceResponse();
    const gather = response.gather({
    input: 'speech',
    action: '/process_speech',
    method: 'POST'
});
    gather.say('This is ISA Telephony. Your call has been received and confirmed. Say something now');

    res.type('text/xml');
    res.send(response.toString());
});

app.post('/process_speech', (req, res) => {
    const speechResult = req.body.SpeechResult; // what the caller said
    const VoiceResponse = twilio.twiml.VoiceResponse;
    const response = new VoiceResponse();
    response.say(`You said: ${speechResult}. Thank you for calling ISA Telephony. Goodbye!`);
    res.type('text/xml');
    res.send(response.toString());
});




// ==================
// ADMIN ROUTES
// ==================

app.get("/admin/users", requireAdmin, async (req, res) => {
  const [rows] = await adminPool.query(
    "SELECT id, email, api_calls_consumed, is_admin, created_at FROM users",
  );
  res.json(rows);
});

app.delete("/admin/delete-user", requireAdmin, async (req, res) => {
  await adminPool.query("DELETE FROM users WHERE id = ?", [req.body.id]);
  res.json({ success: true });
});

app.put("/admin/update-api-calls", requireAdmin, async (req, res) => {
  const { id, api_calls_consumed } = req.body;
  await adminPool.query(
    "UPDATE users SET api_calls_consumed = ? WHERE id = ?",
    [api_calls_consumed, id],
  );
  res.json({ success: true });
});

app.listen(process.env.PORT || 3000, () => {
  console.log('Server running');
  phone.incomingPhoneNumbers(process.env.PHONE_NUMBER_SID).update({voiceUrl: 'https://isa-telephony.onrender.com/receive-call'})
.then(number => console.log(number.friendlyName))
.catch(err => console.error('Error updating Twilio phone number:', err));
});


