import { apiRequest, clearToken, getRole, setRole, setToken } from "./api.js";

function roleToDashboard(role) {
  if (role === "company") return "/company/dashboard.html";
  if (role === "freelancer") return "/freelancer/dashboard.html";
  if (role === "admin") return "/admin/dashboard.html";
  return "/";
}

const loginForm = document.getElementById("login-form");
if (loginForm) {
  loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const formData = new FormData(loginForm);
    const payload = Object.fromEntries(formData.entries());

    try {
      const data = await apiRequest("/auth/login", {
        method: "POST",
        body: JSON.stringify(payload)
      });
      setToken(data.token);
      setRole(data.user.role);
      window.location.href = roleToDashboard(data.user.role);
    } catch (error) {
      document.getElementById("auth-message").textContent = error.message;
    }
  });
}

const registerForm = document.getElementById("register-form");
if (registerForm) {
  registerForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const formData = new FormData(registerForm);
    const payload = Object.fromEntries(formData.entries());

    try {
      await apiRequest("/auth/register", {
        method: "POST",
        body: JSON.stringify(payload)
      });
      window.location.href = "/login.html";
    } catch (error) {
      document.getElementById("auth-message").textContent = error.message;
    }
  });
}

const logoutBtn = document.getElementById("logout-btn");
if (logoutBtn) {
  logoutBtn.addEventListener("click", () => {
    clearToken();
    window.location.href = "/login.html";
  });
}

const roleBadge = document.getElementById("role-badge");
if (roleBadge) {
  roleBadge.textContent = getRole() || "visitor";
}
