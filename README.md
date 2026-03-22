# ISA Telephony

> [!IMPORTANT]
> This README is subject to change and can be modified as needed.

This project is split into two parts:

- `client/` for frontend pages (login, register, landing page)
- `server/` for the Express API and MySQL access

## Folder Structure

```text
isa-telephony/
├── .env
├── client/
│   ├── index.html
│   ├── login.html
│   ├── register.html
│   ├── client.js
│   └── styles.css
└── server/
	├── package.json
	├── package-lock.json
	└── server.js
```

## Local Testing Setup

1. Get env file and login info from Michael

2. Place env file in root of the project

3. Use the terminal to install and start the server from the server folder root:

```bash
cd server
npm install
npm start
```

3. Confirm the server is running by checking for `Server running` in the terminal.

4. Login with dummy user info to check if server is working.
