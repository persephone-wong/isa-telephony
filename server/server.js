const express = require("express");
const mysql = require("mysql2/promise");
const bcrypt = require("bcrypt");
const cors = require("cors");
const path = require("path");
const jwt = require("jsonwebtoken");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

class ServerApp {
  constructor() {
    this.app = express();
    this.clientDir = path.join(__dirname, "..", "client");

    this.JWT_SECRET = process.env.JWT_SECRET;
    if (!this.JWT_SECRET) throw new Error("Missing JWT_SECRET in .env");

    const appDatabaseUrl =
      process.env.DATABASE_URL || process.env.APP_DATABASE_URL;
    const adminDatabaseUrl =
      process.env.DATABASE_URL || process.env.ADMIN_DATABASE_URL;

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
    this.app.use(cors());
    this.app.use(express.urlencoded({ extended: false }));
  }

  setupStaticRoutes() {
    this.app.get(["/", "/index.html"], (req, res) => {
      res.redirect("/login.html");
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

  setupRoutes() {
    // ==================
    // AUTH ROUTES
    // ==================

    this.app.post("/register", async (req, res) => {
      const { email, password } = req.body || {};

      if (!email || !password) {
        return res
          .status(400)
          .json({ error: "Email and password are required" });
      }

      const hash = await bcrypt.hash(password, 10);

      try {
        const [result] = await this.appPool.query(
          "INSERT INTO users (email, password_hash) VALUES (?, ?)",
          [email, hash], // parameterized — safe from SQL injection
        );
        const token = jwt.sign(
          { userId: result.insertId, email },
          this.JWT_SECRET,
          {
            expiresIn: "7d",
          },
        );
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
          return res
            .status(400)
            .json({ error: "Email and password are required" });
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

    // Endpoint to request a call — called by dashboard when user submits the form
    this.app.post(
      "/request-call",
      this.requireAuth.bind(this),
      async (req, res) => {
        const { phone, reason } = req.body;

        if (!phone || !reason) {
          return res
            .status(400)
            .json({ error: "phone and reason are required" });
        }

        const phoneRegex = /^\+?[1-9]\d{7,14}$/;
        if (!phoneRegex.test(phone)) {
          return res.status(400).json({ error: "Invalid phone number format" });
        }

        try {
          const response = await fetch(
            "https://isa-phone-service.onrender.com/call", // TwilioService URL
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                phoneNumber: phone,
                prompt: reason,
              }),
            },
          );

          const data = await response.json();

          if (!response.ok) {
            return res.status(500).json({ error: data.error || "Call failed" });
          }

          // OPTIONAL: increment API usage here
          await this.appPool.query(
            "UPDATE users SET api_calls_consumed = api_calls_consumed + 1 WHERE id = ?",
            [req.user.userId],
          );

          res.json({
            success: true,
            callSid: data.callSid,
          });
        } catch (err) {
          console.error("Request call error:", err);
          res.status(500).json({ error: "Failed to request call" });
        }
      },
    );

    this.app.get(
      "/transcript-stream/:callSid",
      this.requireAuth.bind(this),
      async (req, res) => {
        const { callSid } = req.params;

        try {
          const response = await fetch(
            `https://isa-phone-service.onrender.com/transcript-stream/${callSid}`,
          );

          if (!response.ok) {
            return res
              .status(500)
              .send("Failed to connect to transcript stream");
          }

          // Forward headers
          res.setHeader("Content-Type", "text/event-stream");
          res.setHeader("Cache-Control", "no-cache");
          res.setHeader("Connection", "keep-alive");

          // Pipe the stream directly
          response.body.pipe(res);

          req.on("close", () => {
            response.body.destroy();
          });
        } catch (err) {
          console.error("Transcript proxy error:", err);
          res.status(500).send("Streaming error");
        }
      },
    );

    // ==================
    // ADMIN ROUTES
    // ==================

    this.app.get("/admin/users", this.requireAdmin, async (req, res) => {
      const [rows] = await this.adminPool.query(
        "SELECT id, email, api_calls_consumed, is_admin, created_at FROM users",
      );
      res.json(rows);
    });

    this.app.delete(
      "/admin/delete-user",
      this.requireAdmin,
      async (req, res) => {
        await this.adminPool.query("DELETE FROM users WHERE id = ?", [
          req.body.id,
        ]);
        res.json({ success: true });
      },
    );

    this.app.put(
      "/admin/update-api-calls",
      this.requireAdmin,
      async (req, res) => {
        const { id, api_calls_consumed } = req.body;
        await this.adminPool.query(
          "UPDATE users SET api_calls_consumed = ? WHERE id = ?",
          [api_calls_consumed, id],
        );
        res.json({ success: true });
      },
    );
  }

  start() {
    this.app.listen(process.env.PORT || 3000, () => {
      console.log("Server running");
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
