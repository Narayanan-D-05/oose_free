import { apiRequest } from "./api.js";

async function loadStats() {
  const out = document.getElementById("stats-output");
  if (!out) return;

  try {
    const data = await apiRequest("/admin/stats");
    out.textContent = JSON.stringify(data.stats, null, 2);
  } catch (error) {
    out.textContent = error.message;
  }
}

async function loadUsers() {
  const out = document.getElementById("users-output");
  if (!out) return;

  try {
    const data = await apiRequest("/admin/users");
    out.textContent = JSON.stringify(data.users, null, 2);
  } catch (error) {
    out.textContent = error.message;
  }
}

async function loadDisputes() {
  const out = document.getElementById("disputes-output");
  if (!out) return;

  try {
    const data = await apiRequest("/disputes");
    out.textContent = JSON.stringify(data.disputes, null, 2);
  } catch (error) {
    out.textContent = error.message;
  }
}

loadStats();
loadUsers();
loadDisputes();
