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

function removeDuplicateProjects(projects) {
  const seen = new Set();
  return (projects || []).filter((project) => {
    const fingerprint = [
      project?.company_id || "",
      String(project?.title || "").trim().toLowerCase(),
      String(project?.description || "").trim().toLowerCase(),
      Number(project?.budget_min || 0),
      Number(project?.budget_max || 0),
      project?.deadline || "",
      project?.status || ""
    ].join("|");

    if (seen.has(fingerprint)) {
      return false;
    }
    seen.add(fingerprint);
    return true;
  });
}

function renderProjects(target, projects) {
  const uniqueProjects = removeDuplicateProjects(projects);

  if (!Array.isArray(uniqueProjects) || uniqueProjects.length === 0) {
    target.innerHTML = '<div class="empty-state">No open projects yet. Post a project to start receiving bids.</div>';
    return;
  }

  target.innerHTML = `
    <div class="project-list">
      ${uniqueProjects
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
              <div class="project-actions">
                <a href="/company/bids.html?project_id=${encodeURIComponent(project.id)}">
                  <button class="secondary" type="button">View Bids</button>
                </a>
              </div>
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
    const data = await apiRequest("/company/projects?status=open");
    renderProjects(out, data.projects);
  } catch (error) {
    out.innerHTML = `<p class="inline-feedback error">${escapeHtml(error.message)}</p>`;
  }
}

function renderCompanyBids(target, bids) {
  if (!Array.isArray(bids) || bids.length === 0) {
    target.innerHTML = '<div class="empty-state">No bids found for this project yet.</div>';
    return;
  }

  target.innerHTML = `
    <div class="project-list">
      ${bids
        .map((bid) => {
          const canReview = bid.status === "pending";
          return `
            <article class="project-card">
              <div class="dashboard-row">
                <h3>${formatCurrency(bid.bid_amount)} in ${escapeHtml(bid.estimated_days || "-")} days</h3>
                <span class="status-badge status-${escapeHtml(bid.status || "pending")}">${escapeHtml(bid.status || "pending")}</span>
              </div>
              <p>${escapeHtml(bid.cover_letter || "No cover letter provided.")}</p>
              <div class="project-meta">
                <span>Freelancer Profile: ${escapeHtml(bid.freelancer_id || "-")}</span>
                <span>Submitted: ${formatDate(bid.created_at)}</span>
              </div>
              <div class="project-actions bid-action-row">
                <button type="button" class="secondary bid-action" data-action="accept" data-bid-id="${escapeHtml(bid.id)}" ${
                  canReview ? "" : "disabled"
                }>Accept</button>
                <button type="button" class="ghost bid-action" data-action="reject" data-bid-id="${escapeHtml(bid.id)}" ${
                  canReview ? "" : "disabled"
                }>Reject</button>
              </div>
            </article>
          `;
        })
        .join("")}
    </div>
  `;
}

function setBidsFeedback(message, type = "success") {
  const feedback = document.getElementById("bids-feedback");
  if (!feedback) return;

  if (!message) {
    feedback.hidden = true;
    feedback.textContent = "";
    feedback.className = "inline-feedback";
    return;
  }

  feedback.hidden = false;
  feedback.textContent = message;
  feedback.className = `inline-feedback ${type}`;
}

async function loadCompanyProjectsForBids() {
  const projectSelect = document.getElementById("project-select");
  if (!projectSelect) return null;

  const params = new URLSearchParams(window.location.search);
  const selectedProjectFromQuery = params.get("project_id");
  const data = await apiRequest("/company/projects?status=open,in_progress");
  const projects = removeDuplicateProjects(Array.isArray(data.projects) ? data.projects : []);

  if (projects.length === 0) {
    projectSelect.innerHTML = "";
    return null;
  }

  projectSelect.innerHTML = projects
    .map(
      (project) =>
        `<option value="${escapeHtml(project.id)}">${escapeHtml(project.title || "Untitled Project")} (${escapeHtml(
          project.status
        )})</option>`
    )
    .join("");

  if (selectedProjectFromQuery && projects.some((project) => project.id === selectedProjectFromQuery)) {
    projectSelect.value = selectedProjectFromQuery;
  }

  return projectSelect.value;
}

async function loadBidsForProject(projectId) {
  const out = document.getElementById("bids-output");
  if (!out || !projectId) return;

  out.innerHTML = "Loading bids...";
  try {
    const data = await apiRequest(`/projects/${projectId}/bids`);
    renderCompanyBids(out, data.bids);
  } catch (error) {
    out.innerHTML = `<p class="inline-feedback error">${escapeHtml(error.message)}</p>`;
  }
}

async function initCompanyBidsPage() {
  const projectSelect = document.getElementById("project-select");
  const bidsOutput = document.getElementById("bids-output");
  const reloadBtn = document.getElementById("reload-bids-btn");

  if (!projectSelect || !bidsOutput || !reloadBtn) {
    return;
  }

  try {
    const initialProjectId = await loadCompanyProjectsForBids();
    if (!initialProjectId) {
      bidsOutput.innerHTML = '<div class="empty-state">No active projects found. Post a project first.</div>';
      return;
    }

    await loadBidsForProject(initialProjectId);
  } catch (error) {
    bidsOutput.innerHTML = `<p class="inline-feedback error">${escapeHtml(error.message)}</p>`;
    return;
  }

  projectSelect.addEventListener("change", async () => {
    setBidsFeedback("");
    await loadBidsForProject(projectSelect.value);
  });

  reloadBtn.addEventListener("click", async () => {
    setBidsFeedback("");
    await loadBidsForProject(projectSelect.value);
  });

  bidsOutput.addEventListener("click", async (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement) || !target.classList.contains("bid-action")) {
      return;
    }

    const action = target.dataset.action;
    const bidId = target.dataset.bidId;
    if (!action || !bidId) {
      return;
    }

    target.disabled = true;
    setBidsFeedback("");
    try {
      if (action === "accept") {
        await apiRequest(`/bids/${bidId}/accept`, { method: "PUT" });
        setBidsFeedback("Bid accepted. Project moved to in-progress.", "success");
      } else if (action === "reject") {
        await apiRequest(`/bids/${bidId}/reject`, { method: "PUT" });
        setBidsFeedback("Bid rejected.", "success");
      }

      await loadBidsForProject(projectSelect.value);
      await loadCompanyDashboard();
    } catch (error) {
      setBidsFeedback(error.message, "error");
      target.disabled = false;
    }
  });
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
initCompanyBidsPage();
