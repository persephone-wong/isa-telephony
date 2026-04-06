const express = require("express");
const cors = require("cors");
const twilio = require("twilio");
const path = require("path");
const VoiceResponse = require("twilio/lib/twiml/VoiceResponse");

require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

class TwilioService {
  constructor() {
    this.app = express();
    this.clientDir = path.join(__dirname, "..", "client");

    this.callLogs = {};

    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    this.phone = twilio(accountSid, authToken);

    this.setupMiddleware();
    this.setupRoutes();
  }

  setupMiddleware() {
    this.app.use(express.static(this.clientDir, { index: false }));
    this.app.use(express.json());
    this.app.use(express.urlencoded({ extended: false }));
    this.app.use(cors());
  }

  setupRoutes() {
    this.app.post("/call", async (req, res) => {
      await this.call(req, res);
    });

    this.app.post("/start", async (req, res) => {
      await this.startCall(req, res);
    });

    this.app.post("/receive-call", async (req, res) => {
      await this.recieveCall(req, res);
    });

    this.app.post("/listen", async (req, res) => {
      this.listen(req, res);
    });

    this.app.post("/process_speech", async (req, res) => {
      this.processCall(req, res);
    });

    this.app.get("/call-logs/:callSid", (req, res) => {
      const { callSid } = req.params;
      const logs = this.callLogs[callSid];
      if (!logs) {
        return res.status(404).json({ error: "No logs found for this call" });
      }
      res.json({ callSid, logs });
    });

    // Gurveer Raith: Added this endpoint
    this.app.get("/transcript-stream/:callSid", (req, res) => {
      const { callSid } = req.params;

      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.flushHeaders();

      // Send any existing logs immediately on connect
      const existingLogs = this.callLogs[callSid] || [];
      if (existingLogs.length > 0) {
        res.write(`data: ${JSON.stringify({ logs: existingLogs })}\n\n`);
      }

      // Poll internal state and push new entries every second
      let lastSentCount = existingLogs.length;
      const interval = setInterval(() => {
        const logs = this.callLogs[callSid] || [];
        if (logs.length > lastSentCount) {
          const newEntries = logs.slice(lastSentCount);
          res.write(`data: ${JSON.stringify({ logs: newEntries })}\n\n`);
          lastSentCount = logs.length;
        }
      }, 1000);

      req.on("close", () => clearInterval(interval));
    });
  }

  async call(req, res) {
    const { prompt, phoneNumber } = req.body;
    if (!prompt || !phoneNumber) {
      return res
        .status(400)
        .json({ error: "prompt and phoneNumber are required" });
    }
    try {
      const call = await this.phone.calls.create({
        to: phoneNumber,
        from: process.env.TWILIO_PHONE_NUMBER,
        url: `https://isa-phone-service.onrender.com/start?prompt=${encodeURIComponent(prompt)}`,
        method: "POST",
      });
      res.json({ message: "Call initiated", callSid: call.sid });
    } catch (error) {
      console.error("Error initiating call:", error);
      return res.status(500).json({ error: "Failed to initiate call" });
    }
  }

  async startCall(req, res) {
    const prompt =
      req.query.prompt ||
      "Hello! This is a call from ISA. How can I assist you today?";

    const aiReply = await this.callAI(prompt);

    const response = new VoiceResponse();
    const gather = response.gather({
      input: "speech",
      action: "/process_speech",
      method: "POST",
      speechTimeout: "auto",
      speechModel: "phone_call",
    });
    gather.say(aiReply);

    res.type("text/xml");
    res.send(response.toString());
  }
  async recieveCall(req, res) {
    const response = new VoiceResponse();
    const gather = response.gather({
      input: "speech",
      action: "/process_speech",
      method: "POST",
      speechTimeout: "auto",
    });
    gather.say(
      "Welcome to the Virtual Call Assistant! What query do you have?",
    );

    res.type("text/xml");
    res.send(response.toString());
  }

  listen(req, res) {
    const response = new VoiceResponse();
    response.say("Listening for your query");
    response.gather({
      input: "speech",
      action: "/process_speech",
      method: "POST",
      speechTimeout: "auto",
      speechModel: "phone_call",
    });
    res.type("text/xml");
    res.send(response.toString());
  }

  // Gurveer Raith: Updated Process call
  async processCall(req, res) {
    const speechResult = req.body.SpeechResult || "";
    const callSid = req.body.CallSid || "unknown";

    if (!callSid) return;
    if (!this.callLogs[callSid]) {
      this.callLogs[callSid] = [];
    }

    if (!speechResult) {
      const response = new VoiceResponse();
      const gather = response.gather({
        input: "speech",
        action: "/process_speech",
        method: "POST",
        speechTimeout: "auto",
        speechModel: "phone_call",
      });
      gather.say("Sorry, I didn't catch that. Please try again.");
      res.type("text/xml");
      return res.send(response.toString());
    }

    const aiReply = await this.callAI(speechResult, this.callLogs[callSid]);

    this.callLogs[callSid].push({
      timestamp: new Date().toISOString(),
      user: speechResult,
      ai: aiReply,
    });

    const response = new VoiceResponse();

    //user speech interrupts the AI mid sentence using gather
    const gather = response.gather({
      input: "speech",
      action: "/process_speech",
      method: "POST",
      speechTimeout: "auto",
      speechModel: "phone_call",
    });
    gather.say(aiReply);

    // Fallback if user never speaks after AI finishes
    response.redirect({ method: "POST" }, "/listen");

    res.type("text/xml");
    res.send(response.toString());
  }

  async callAI(speechText, history = []) {
    try {
      const messages = [
        {
          role: "system",
          content:
            "You are a helpful voice call assistant for ISA. Keep responses concise and conversational, suitable for being read aloud over the phone. Avoid using bullet points, markdown, or lists.",
        },
        ...history.flatMap((turn) => [
          { role: "user", content: turn.user },
          { role: "assistant", content: turn.ai },
        ]),
        { role: "user", content: speechText },
      ];

      const response = await fetch(
        "https://isa-telephony-gglp.onrender.com/chat",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messages }),
        },
      );

      if (!response.ok) {
        console.error("AI API error:", await response.text());
        return "Sorry, there was an error connecting to the AI.";
      }

      const aiResponse = await response.json();
      if (!aiResponse.reply) {
        console.error("AI API invalid response:", aiResponse);
        return "Sorry, I didn't understand the response from the AI.";
      }

      return aiResponse.reply;
    } catch (error) {
      console.error("AI API request failed:", error);
      return "Sorry, I had trouble reaching the AI service.";
    }
  }

  start() {
    this.app.listen(process.env.PORT || 3000, () => {
      console.log("Server running");

      const phoneNumberSid = process.env.PHONE_NUMBER_SID;
      if (!phoneNumberSid) {
        console.warn(
          "PHONE_NUMBER_SID is missing; skipping Twilio voice URL update.",
        );
        return;
      }

      this.phone
        .incomingPhoneNumbers(phoneNumberSid)
        .update({
          voiceUrl: "https://isa-phone-service.onrender.com/receive-call",
        })
        .then((number) => console.log(number.friendlyName))
        .catch((err) =>
          console.error("Error updating Twilio phone number:", err),
        );
    });
  }
}

const twilioServiceInstance = new TwilioService();
twilioServiceInstance.start();
