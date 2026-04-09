class TranscriptPage {
  constructor() {
    this.container = document.getElementById("transcript");
    this.callSid = this.getCallSid();
    this.API_BASE = "https://isa-phone-service.onrender.com";

    this.renderedCount = 0; // prevents duplicate rendering
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

    const token = localStorage.getItem("token");

    const eventSource = new EventSource(
      `${this.API_BASE}/transcript-stream/${this.callSid}?token=${token}`,
    );

    eventSource.onmessage = (event) => {
      const data = JSON.parse(event.data);

      if (data.logs) {
        this.appendLogs(data.logs);
      }
    };

    eventSource.onerror = () => {
      console.error("SSE connection error");
      eventSource.close();
    };
  }

  appendLogs(logs) {
    logs.forEach((log) => {
      const bubble = document.createElement("div");
      bubble.className = "message";

      if (log.user) {
        const user = document.createElement("div");
        user.className = "user";
        user.textContent = log.user;
        bubble.appendChild(user);
      }

      if (log.ai) {
        const ai = document.createElement("div");
        ai.className = "ai";
        ai.textContent = log.ai;
        bubble.appendChild(ai);
      }

      this.container.appendChild(bubble);
    });

    // auto-scroll
    this.container.scrollTop = this.container.scrollHeight;
  }
}

const app = new TranscriptPage();
app.init();
