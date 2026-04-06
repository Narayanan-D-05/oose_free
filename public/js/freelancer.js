import { apiRequest } from "./api.js";

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");
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

function removeDuplicateProjects(projects) {
  const seen = new Set();
  return (projects || []).filter((project) => {
    const fingerprint = [
      project?.company_id || "",
      String(project?.title || "").trim().toLowerCase(),
      String(project?.description || "").trim().toLowerCase(),
      Number(project?.budget_min || 0),
      Number(project?.budget_max || 0),
      project?.deadline || ""
    ].join("|");

    if (seen.has(fingerprint)) {
      return false;
    }
    seen.add(fingerprint);
    return true;
  });
}

function renderProjects(projects) {
  const uniqueProjects = removeDuplicateProjects(projects);

  if (!uniqueProjects || uniqueProjects.length === 0) {
    return '<div class="empty-state">No open projects yet. Check back soon.</div>';
  }

  return uniqueProjects
    .map((project) => {
      const skills = (project.skills_required || [])
        .map((skill) => `<span class="skill-tag">${escapeHtml(skill)}</span>`)
        .join("");

      return `
        <article class="project-card">
          <div class="header">
            <h3>${escapeHtml(project.title)}</h3>
            <span class="badge">${escapeHtml(project.status)}</span>
          </div>
          <p>${escapeHtml(project.description || "No description")}</p>
          <div class="project-meta">
            <span>Budget: ${formatCurrency(project.budget_min)} - ${formatCurrency(project.budget_max)}</span>
            <span>Deadline: ${formatDate(project.deadline)}</span>
          </div>
          <div class="skill-wrap">${skills || '<span class="skill-tag">General</span>'}</div>
          <div class="project-actions">
            <a href="/freelancer/bid.html?project_id=${encodeURIComponent(project.id)}">
              <button class="secondary" type="button">Bid Now</button>
            </a>
          </div>
        </article>
      `;
    })
    .join("");
}

async function loadOpenProjects() {
  const out = document.getElementById("open-projects");
  if (!out) return;

  try {
    const data = await apiRequest("/projects?status=open");
    out.innerHTML = renderProjects(data.projects);
  } catch (error) {
    out.innerHTML = `<div class="empty-state error">${escapeHtml(error.message)}</div>`;
  }
}

const bidForm = document.getElementById("bid-form");
if (bidForm) {
  const projectIdField = bidForm.querySelector('input[name="project_id"]');
  const selectedProject = document.getElementById("selected-project");
  const preselectedProjectId = new URLSearchParams(window.location.search).get("project_id");

  if (preselectedProjectId && projectIdField) {
    projectIdField.value = preselectedProjectId;
    if (selectedProject) {
      selectedProject.textContent = `Selected project: ${preselectedProjectId}`;
    }
  }

  bidForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const payload = Object.fromEntries(new FormData(bidForm).entries());
    payload.bid_amount = Number(payload.bid_amount);
    payload.estimated_days = payload.estimated_days ? Number(payload.estimated_days) : null;

    try {
      const data = await apiRequest(`/projects/${payload.project_id}/bids`, {
        method: "POST",
        body: JSON.stringify(payload)
      });
      const actionText = data.updated ? "Bid updated successfully." : "Bid submitted successfully.";
      document.getElementById("result").textContent = `${actionText}\n\n${JSON.stringify(data.bid, null, 2)}`;
    } catch (error) {
      document.getElementById("result").textContent = error.message;
    }
  });
}

const profileForm = document.getElementById("profile-form");
if (profileForm) {
  profileForm.addEventListener("submit", (event) => {
    event.preventDefault();
    document.getElementById("result").textContent = "Profile updates are handled via Supabase table editor in this starter.";
  });
}

loadOpenProjects();
