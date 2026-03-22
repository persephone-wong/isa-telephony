const loginForm = document.getElementById("login-form");
const registerForm = document.getElementById("register-form");
const message = document.getElementById("form-message");
const API_BASE_URL = "https://isa-telephony.onrender.com";

function showMessage(text, type) {
	message.textContent = text;
	message.className = `message ${type}`;
}

function isValidEmail(email) {
	return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function validateEmailAndPassword(email, password) {
	if (!email || !password) {
		return "Please enter both email and password.";
	}

	if (!isValidEmail(email)) {
		return "Please enter a valid email address.";
	}

	if (password.length < 6) {
		return "Password must be at least 6 characters.";
	}

	return "";
}

async function postJson(path, payload) {
	const response = await fetch(`${API_BASE_URL}${path}`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json"
		},
		body: JSON.stringify(payload)
	});

	const data = await response.json().catch(() => ({}));

	if (!response.ok) {
		throw new Error(data.error || "Request failed.");
	}

	return data;
}

if (loginForm) {
	loginForm.addEventListener("submit", async (event) => {
		event.preventDefault();

		const email = document.getElementById("email").value.trim();
		const password = document.getElementById("password").value;
		const validationError = validateEmailAndPassword(email, password);

		if (validationError) {
			showMessage(validationError, "error");
			return;
		}

		try {
			const result = await postJson("/login", { email, password });
			showMessage(result.message || "Login successful!", "success");
			window.location.href = "index.html";
		} catch (error) {
			showMessage(error.message, "error");
		}
	});
}

if (registerForm) {
	registerForm.addEventListener("submit", async (event) => {
		event.preventDefault();

		const email = document.getElementById("register-email").value.trim();
		const password = document.getElementById("register-password").value;
		const validationError = validateEmailAndPassword(email, password);

		if (validationError) {
			showMessage(validationError, "error");
			return;
		}

		try {
			await postJson("/register", { email, password });
			showMessage("Registration successful! You can now log in.", "success");
			window.location.href = "index.html";
		} catch (error) {
			showMessage(error.message, "error");
		}
	});
}
