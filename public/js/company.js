import { apiRequest } from "./api.js";

async function loadCompanyDashboard() {
  const out = document.getElementById("projects-output");
  if (!out) return;

  try {
    const data = await apiRequest("/projects?status=open");
    out.textContent = JSON.stringify(data.projects, null, 2);
  } catch (error) {
    out.textContent = error.message;
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
      document.getElementById("result").textContent = JSON.stringify(data.project, null, 2);
      postForm.reset();
    } catch (error) {
      document.getElementById("result").textContent = error.message;
    }
  });
}

loadCompanyDashboard();
