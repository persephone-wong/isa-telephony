# ISA Telephony

> [!IMPORTANT]
> This README is subject to change and can be modified as needed.

This project is split into three parts:

- `client/` for frontend pages (login, register, dashboard, admin)
- `server/` for the main Express API, authentication, and MySQL access
- `aiServer/` for the AI chat service (Hugging Face LLM integration)

## Folder Structure

```text
isa-telephony/
├── .env
├── client/
│   ├── login.html
│   ├── register.html
│   ├── dashboard.html
│   ├── admin.html
│   ├── client.js
│   └── styles.css
├── server/
│   ├── package.json
│   ├── package-lock.json
│   └── server.js
└── aiServer/
    ├── package.json
    ├── package-lock.json
    └── server.js
```

## Local Testing Setup

1. Get `.env` file and login credentials from Michael

2. Place `.env` file in root of the project

3. Install and start the AI server from the `aiServer` folder:

```bash
cd aiServer
npm install
npm start
```

4. In a new terminal, install and start the main server from the `server` folder:

```bash
cd server
npm install
npm start
```

5. Confirm both servers are running:
   - Main server: `Server running` message
   - AI server: `AI server running on port 8000` message

6. Access the application at `https://localhost:3000` (or your deployed URL)

7. Log in with test credentials to verify the server is working

## Architecture

This project follows a **microservice architecture** pattern:

- **Main Server** (`server/`) handles authentication, user management, admin endpoints, and Twilio integration
- **AI Server** (`aiServer/`) provides chat/NLP capabilities via Hugging Face LLM
- **Client** communicates with the main server via REST API with JWT authentication

## API Endpoints

### Authentication
- `POST /register` — Create a new user account
- `POST /login` — Authenticate and receive JWT token

### User
- `GET /me` — Get current user stats and API usage (requires auth)

### Admin
- `GET /admin/users` — List all users (requires admin key)
- `DELETE /admin/delete-user` — Remove a user
- `PUT /admin/update-api-calls` — Update user API call count

### Telephony
- `POST /receive-call` — Twilio webhook for incoming calls
- `POST /process-speech` — Process speech input and return AI response

### AI Service
- `POST /chat` — Send text to AI and receive reply
