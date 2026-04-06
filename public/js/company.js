import { apiRequest } from "./api.js";

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatCurrency(value) {
  const numericValue = Number(value);
  if (Number.isNaN(numericValue)) {
    return "Not specified";
  }

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0
  }).format(numericValue);
}

function formatDate(value) {
  if (!value) {
    return "No deadline";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "No deadline";
  }

  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric"
  });
}

function renderProjects(target, projects) {
  if (!Array.isArray(projects) || projects.length === 0) {
    target.innerHTML = '<div class="empty-state">No open projects yet. Post a project to start receiving bids.</div>';
    return;
  }

  target.innerHTML = `
    <div class="project-list">
      ${projects
        .map((project) => {
          const skillTags = Array.isArray(project.skills_required)
            ? project.skills_required
                .map((skill) => `<span class="skill-tag">${escapeHtml(skill)}</span>`)
                .join("")
            : "";

          return `
            <article class="project-card">
              <div class="dashboard-row">
                <h3>${escapeHtml(project.title || "Untitled Project")}</h3>
                <span class="status-badge status-${escapeHtml(project.status || "open")}">${escapeHtml(project.status || "open")}</span>
              </div>
              <p>${escapeHtml(project.description || "No description provided.")}</p>
              <div class="project-meta">
                <span>Budget: ${formatCurrency(project.budget_min)} - ${formatCurrency(project.budget_max)}</span>
                <span>Deadline: ${formatDate(project.deadline)}</span>
                <span>Posted: ${formatDate(project.created_at)}</span>
              </div>
              ${skillTags ? `<div class="skill-wrap">${skillTags}</div>` : ""}
            </article>
          `;
        })
        .join("")}
    </div>
  `;
}

async function loadCompanyDashboard() {
  const out = document.getElementById("projects-output");
  if (!out) return;

  try {
    const data = await apiRequest("/projects?status=open");
    renderProjects(out, data.projects);
  } catch (error) {
    out.innerHTML = `<p class="inline-feedback error">${escapeHtml(error.message)}</p>`;
  }
}

const postForm = document.getElementById("post-project-form");
if (postForm) {
  postForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const payload = Object.fromEntries(new FormData(postForm).entries());
    payload.skills_required = payload.skills_required?.split(",").map((v) => v.trim());

    try {
      const data = await apiRequest("/projects", {
        method: "POST",
        body: JSON.stringify(payload)
      });
      const resultNode = document.getElementById("result");
      if (resultNode) {
        resultNode.innerHTML = `<p class="inline-feedback success">Project \"${escapeHtml(data.project?.title || "Untitled Project")}\" published successfully.</p>`;
      }
      postForm.reset();
      await loadCompanyDashboard();
    } catch (error) {
      const resultNode = document.getElementById("result");
      if (resultNode) {
        resultNode.innerHTML = `<p class="inline-feedback error">${escapeHtml(error.message)}</p>`;
      }
    }
  });
}

loadCompanyDashboard();
