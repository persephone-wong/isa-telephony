class TranscriptPage {
  constructor() {
    this.container = document.getElementById("transcript");
    this.callSid = this.getCallSid();
    this.API_BASE = "https://isa-phone-service.onrender.com"; // TwilioService
  }

  getCallSid() {
    const params = new URLSearchParams(window.location.search);
    return params.get("callSid");
  }

  init() {
    if (!this.callSid) {
      this.container.textContent = "Missing callSid.";
      return;
    }

    const eventSource = new EventSource(
      `${this.API_BASE}/transcript-stream/${this.callSid}`,
    );

    eventSource.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.logs) {
        this.renderLogs(data.logs);
      }
    };

    eventSource.onerror = () => {
      console.error("Transcript stream error");
      eventSource.close();
    };
  }

  renderLogs(logs) {
    logs.forEach((log) => {
      const wrapper = document.createElement("div");
      wrapper.className = "entry";

      const user = document.createElement("div");
      user.className = "user";
      user.textContent = `User: ${log.user}`;

      const ai = document.createElement("div");
      ai.className = "ai";
      ai.textContent = `AI: ${log.ai}`;

      wrapper.appendChild(user);
      wrapper.appendChild(ai);

      this.container.appendChild(wrapper);
    });

    // auto scroll
    window.scrollTo(0, document.body.scrollHeight);
  }
}

const page = new TranscriptPage();
page.init();
