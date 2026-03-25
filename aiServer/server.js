import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = process.env.PORT || 8000;
const HF_API_TOKEN = process.env.HF_API_TOKEN;

dotenv.config({ path: path.join(__dirname, '..', '.env') });

class AIServerApp {
  constructor() {
    this.app = express();
  }

  setupMiddleware() {
    this.app.use(cors());
    this.app.use(express.json());
  }

  setupRoutes() {
    this.app.post('/chat', async (req, res) => {
      const { text } = req.body;

      if (!text) {
        return res.status(400).json({ error: 'text field is required' });
      }

      if (!HF_API_TOKEN) {
        return res.status(500).json({ error: 'Missing HF_API_TOKEN in .env' });
      }

      try {
        const response = await fetch(
          'https://router.huggingface.co/v1/chat/completions',
          {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${HF_API_TOKEN}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              model: 'meta-llama/Llama-3.1-8B-Instruct',
              messages: [{ role: 'user', content: text }],
              max_tokens: 200
            }),
          }
        );

        const data = await response.json();
        res.json({ reply: data.choices[0].message.content });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });
  }

  start() {
    this.app.listen(PORT, () => {
      console.log(`AI server running on port ${PORT}`);
    });
  }

  init() {
    this.setupMiddleware();
    this.setupRoutes();
    this.start();
  }
}

const aiServerApp = new AIServerApp();
aiServerApp.init();