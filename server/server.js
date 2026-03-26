const express = require('express');
const mysql = require('mysql2/promise');
const bcrypt = require('bcrypt');
const cors = require('cors');
const path = require('path');
const twilio = require('twilio');
const jwt = require("jsonwebtoken");
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

class ServerApp {
  constructor() {
    this.app = express();
    this.clientDir = path.join(__dirname, '..', 'client');

    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    this.phone = twilio(accountSid, authToken);
    this.JWT_SECRET = process.env.JWT_SECRET;
    if (!this.JWT_SECRET) throw new Error("Missing JWT_SECRET in .env");

    const appDatabaseUrl = process.env.DATABASE_URL || process.env.APP_DATABASE_URL;
    const adminDatabaseUrl = process.env.DATABASE_URL || process.env.ADMIN_DATABASE_URL;

    if (!appDatabaseUrl || !adminDatabaseUrl) {
      throw new Error(
        "Missing database URL. Set APP_DATABASE_URL/ADMIN_DATABASE_URL or DATABASE_URL in .env",
      );
    }

    this.appPool = mysql.createPool({ uri: appDatabaseUrl });
    this.adminPool = mysql.createPool({ uri: adminDatabaseUrl });
    this.FREE_CALL_LIMIT = 20;
  }

  setupMiddleware() {
    this.app.use(express.static(this.clientDir, { index: false }));
    this.app.use(express.json());
    this.app.use(express.urlencoded({ extended: true }));
    this.app.use(cors());
    this.app.use(express.urlencoded({ extended: false }))
  }

  setupStaticRoutes() {
    this.app.get(['/', '/index.html'], (req, res) => {
      res.redirect('/login.html');
    });
  }

  // ==================
  // MIDDLEWARE
  // ==================

  // verifies JWT and attaches decoded user to req.user.
  async requireAuth(req, res, next) {
    const authHeader = req.headers["authorization"];
    const token = authHeader && authHeader.split(" ")[1]; // "Bearer <token>"

    if (!token) return res.status(401).json({ error: "No token provided" });

    let decoded;
    try {
      decoded = jwt.verify(token, this.JWT_SECRET);
    } catch {
      return res.status(403).json({ error: "Invalid or expired token" });
    }

    try {
      const [rows] = await this.appPool.query(
        "SELECT id, email, api_calls_consumed, is_admin FROM users WHERE id = ?",
        [decoded.userId],
      );
      const user = rows[0];
      if (!user) return res.status(401).json({ error: "User not found" });

      const calls = user.api_calls_consumed || 0;

      // ToDo: Move below query to increment api_calls_consumed only when a call has been made
      // await this.appPool.query(
      //   "UPDATE users SET api_calls_consumed = api_calls_consumed + 1 WHERE id = ?",
      //   [user.id],
      // );

      res.setHeader("X-Api-Calls-Used", calls + 1);
      res.setHeader("X-Api-Calls-Limit", this.FREE_CALL_LIMIT);
      if (calls + 1 >= this.FREE_CALL_LIMIT) {
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
  requireAdmin(req, res, next) {
    const adminKey = req.headers["x-admin-key"];
    if (adminKey !== process.env.ADMIN_SECRET_KEY) {
      return res.status(403).json({ error: "Forbidden" });
    }
    next();
  }

  async callAI(speechText) {
    const response = await fetch("https://isa-telephony-gglp.onrender.com/chat",
      {
        method: 'POST',
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({text: speechText})
      }
    )

    if (!response.ok) {
      console.error("AI API error:", await response.text());
      return "Sorry, there was an error connecting to the AI.";
    }

    const aiResponse =await response.json();
    if (!aiResponse.reply) {
      console.error("AI API invalid response:", aiResponse);
      return "Sorry, I didn't understand the response from the AI.";
    }
    return aiResponse.reply;
  }

  setupRoutes() {
    // ==================
    // AUTH ROUTES
    // ==================

    this.app.post("/register", async (req, res) => {
      const { email, password } = req.body || {};

      if (!email || !password) {
        return res.status(400).json({ error: "Email and password are required" });
      }

      const hash = await bcrypt.hash(password, 10);

      try {
        const [result] = await this.appPool.query(
          "INSERT INTO users (email, password_hash) VALUES (?, ?)",
          [email, hash], // parameterized — safe from SQL injection
        );
        const token = jwt.sign({ userId: result.insertId, email }, this.JWT_SECRET, {
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

    this.app.post("/login", async (req, res) => {
      try {
        const { email, password } = req.body || {};

        if (!email || !password) {
          return res.status(400).json({ error: "Email and password are required" });
        }

        const [rows] = await this.appPool.query(
          "SELECT id, email, password_hash, is_admin FROM users WHERE email = ?",
          [email], // parameterized — safe from SQL injection
        );
        const user = rows[0];

        if (user && (await bcrypt.compare(password, user.password_hash))) {
          const token = jwt.sign(
            { userId: user.id, email: user.email, isAdmin: user.is_admin },
            this.JWT_SECRET,
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
    this.app.get("/me", this.requireAuth.bind(this), async (req, res) => {
      try {
        const [rows] = await this.appPool.query(
          "SELECT id, email, api_calls_consumed, is_admin FROM users WHERE id = ?",
          [req.user.userId],
        );
        const user = rows[0];
        if (!user) return res.status(404).json({ error: "User not found" });

        res.json({
          id: user.id,
          email: user.email,
          apiCallsConsumed: user.api_calls_consumed,
          apiCallsLimit: this.FREE_CALL_LIMIT,
          isAdmin: !!user.is_admin,
        });
      } catch (err) {
        console.error("Me error:", err);
        res.status(500).json({ error: "Failed to fetch user data" });
      }
    });

    this.app.post('/receive-call', (req, res) => {
        const VoiceResponse = twilio.twiml.VoiceResponse;
        const response = new VoiceResponse();
        response.say('Welcome to the ISA Virtual Call Assistant! Please talk after the beep.');
        const gather = response.gather({
        input: 'speech',
        action: '/process_speech',
        method: 'POST',
        playBeep: true
    });

        res.type('text/xml');
        res.send(response.toString());
    });

    this.app.post('/process_speech', async (req, res) => {
        const speechResult = req.body.SpeechResult;

        const aiReply = await this.callAI(speechResult);

        const VoiceResponse = twilio.twiml.VoiceResponse;
        const response = new VoiceResponse();
        response.say(`${aiReply}`);

        res.type('text/xml');
        res.send(response.toString());
    });

    // ==================
    // ADMIN ROUTES
    // ==================

    this.app.get("/admin/users", this.requireAdmin, async (req, res) => {
      const [rows] = await this.adminPool.query(
        "SELECT id, email, api_calls_consumed, is_admin, created_at FROM users",
      );
      res.json(rows);
    });

    this.app.delete("/admin/delete-user", this.requireAdmin, async (req, res) => {
      await this.adminPool.query("DELETE FROM users WHERE id = ?", [req.body.id]);
      res.json({ success: true });
    });

    this.app.put("/admin/update-api-calls", this.requireAdmin, async (req, res) => {
      const { id, api_calls_consumed } = req.body;
      await this.adminPool.query(
        "UPDATE users SET api_calls_consumed = ? WHERE id = ?",
        [api_calls_consumed, id],
      );
      res.json({ success: true });
    });
  }

  start() {
    this.app.listen(process.env.PORT || 3000, () => {
      console.log('Server running');

      const phoneNumberSid = process.env.PHONE_NUMBER_SID;
      if (!phoneNumberSid) {
        console.warn('PHONE_NUMBER_SID is missing; skipping Twilio voice URL update.');
        return;
      }

      this.phone
        .incomingPhoneNumbers(phoneNumberSid)
        .update({ voiceUrl: 'https://isa-telephony.onrender.com/receive-call' })
        .then((number) => console.log(number.friendlyName))
        .catch((err) => console.error('Error updating Twilio phone number:', err));
    });
  }

  init() {
    this.setupMiddleware();
    this.setupStaticRoutes();
    this.setupRoutes();
    this.start();
  }
}

const serverApp = new ServerApp();
serverApp.init();


