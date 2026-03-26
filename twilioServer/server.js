const express = require('express');
const cors = require('cors');
const twilio = require('twilio');
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

class TwilioService {
  constructor() {
    this.app = express();
    this.clientDir = path.join(__dirname, '..', 'client');

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
    this.app.post('/receive-call', (req, res) => {
      const VoiceResponse = twilio.twiml.VoiceResponse;
      const response = new VoiceResponse();

      response.say('Welcome to the ISA Virtual Call Assistant! Please talk after the beep.');
      response.gather({
        input: 'speech',
        action: '/process_speech',
        method: 'POST',
        speechTimeout: 'auto',
      });

      res.type('text/xml');
      res.send(response.toString());
    });

    this.app.post('/process_speech', async (req, res) => {
      const speechResult = req.body.SpeechResult || '';
      const aiReply = await this.callAI(speechResult);

      const VoiceResponse = twilio.twiml.VoiceResponse;
      const response = new VoiceResponse();
      response.say(aiReply);

      res.type('text/xml');
      res.send(response.toString());
    });
  }

  async callAI(speechText) {
    try {
      const response = await fetch('https://isa-telephony-gglp.onrender.com/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: speechText }),
      });

      if (!response.ok) {
        console.error('AI API error:', await response.text());
        return 'Sorry, there was an error connecting to the AI.';
      }

      const aiResponse = await response.json();
      if (!aiResponse.reply) {
        console.error('AI API invalid response:', aiResponse);
        return "Sorry, I didn't understand the response from the AI.";
      }

      return aiResponse.reply;
    } catch (error) {
      console.error('AI API request failed:', error);
      return 'Sorry, I had trouble reaching the AI service.';
    }
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
}

const twilioServiceInstance = new TwilioService();
twilioServiceInstance.start();
