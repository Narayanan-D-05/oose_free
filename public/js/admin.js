import { apiRequest } from "./api.js";

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatDate(value) {
  if (!value) {
    return "-";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }

  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric"
  });
}

function renderError(target, message) {
  target.innerHTML = `<p class="inline-feedback error">${escapeHtml(message)}</p>`;
}

async function loadStats() {
  const out = document.getElementById("stats-output");
  if (!out) return;

  try {
    const data = await apiRequest("/admin/stats");
    const stats = data.stats || {};
    out.innerHTML = `
      <div class="stats-grid">
        <article class="metric-card">
          <h3>Total Users</h3>
          <p>${Number(stats.total_users || 0)}</p>
        </article>
        <article class="metric-card">
          <h3>Active Projects</h3>
          <p>${Number(stats.active_projects || 0)}</p>
        </article>
        <article class="metric-card">
          <h3>Open Disputes</h3>
          <p>${Number(stats.open_disputes || 0)}</p>
        </article>
      </div>
    `;
  } catch (error) {
    renderError(out, error.message);
  }
}

async function loadUsers() {
  const out = document.getElementById("users-output");
  if (!out) return;

  try {
    const data = await apiRequest("/admin/users");
    const users = Array.isArray(data.users) ? data.users : [];
    if (users.length === 0) {
      out.innerHTML = '<div class="empty-state">No users found.</div>';
      return;
    }

    out.innerHTML = `
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>Email</th>
              <th>Role</th>
              <th>Status</th>
              <th>Joined</th>
            </tr>
          </thead>
          <tbody>
            ${users
              .map(
                (user) => `
                  <tr>
                    <td>${escapeHtml(user.email || "-")}</td>
                    <td><span class="status-badge status-neutral">${escapeHtml(user.role || "-")}</span></td>
                    <td><span class="status-badge ${user.suspended ? "status-resolved" : "status-open"}">${
                      user.suspended ? "Suspended" : "Active"
                    }</span></td>
                    <td>${formatDate(user.created_at)}</td>
                  </tr>
                `
              )
              .join("")}
          </tbody>
        </table>
      </div>
    `;
  } catch (error) {
    renderError(out, error.message);
  }
}

async function loadDisputes() {
  const out = document.getElementById("disputes-output");
  if (!out) return;

  try {
    const data = await apiRequest("/disputes");
    const disputes = Array.isArray(data.disputes) ? data.disputes : [];
    if (disputes.length === 0) {
      out.innerHTML = '<div class="empty-state">No disputes raised.</div>';
      return;
    }

    out.innerHTML = `
      <div class="project-list">
        ${disputes
          .map(
            (dispute) => `
              <article class="project-card">
                <div class="dashboard-row">
                  <h3>Dispute ${escapeHtml(dispute.id || "")}</h3>
                  <span class="status-badge ${dispute.status === "resolved" ? "status-resolved" : "status-open"}">${escapeHtml(
                    dispute.status || "open"
                  )}</span>
                </div>
                <p>${escapeHtml(dispute.reason || "No reason provided.")}</p>
                <div class="project-meta">
                  <span>Project: ${escapeHtml(dispute.project_id || "-")}</span>
                  <span>Raised by: ${escapeHtml(dispute.raised_by || "-")}</span>
                  <span>Created: ${formatDate(dispute.created_at)}</span>
                </div>
              </article>
            `
          )
          .join("")}
      </div>
    `;
  } catch (error) {
    renderError(out, error.message);
  }
}

loadStats();
loadUsers();
loadDisputes();
