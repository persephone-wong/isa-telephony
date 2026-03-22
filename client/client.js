const form = document.getElementById("login-form");
const emailInput = document.getElementById("email");
const passwordInput = document.getElementById("password");
const message = document.getElementById("form-message");

function showMessage(text, type) {
	message.textContent = text;
	message.className = `message ${type}`;
}

function isValidEmail(email) {
	return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

form.addEventListener("submit", (event) => {
	event.preventDefault();

	const email = emailInput.value.trim();
	const password = passwordInput.value;

	if (!email || !password) {
		showMessage("Please enter both email and password.", "error");
		return;
	}

	if (!isValidEmail(email)) {
		showMessage("Please enter a valid email address.", "error");
		return;
	}

	if (password.length < 6) {
		showMessage("Password must be at least 6 characters.", "error");
		return;
	}

	showMessage("Login successful!", "success");
	form.reset();
});
