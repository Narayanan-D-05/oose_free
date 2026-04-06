import { apiRequest } from "./api.js";

async function loadOpenProjects() {
  const out = document.getElementById("open-projects");
  if (!out) return;

  try {
    const data = await apiRequest("/projects?status=open");
    out.textContent = JSON.stringify(data.projects, null, 2);
  } catch (error) {
    out.textContent = error.message;
  }
}

const bidForm = document.getElementById("bid-form");
if (bidForm) {
  bidForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const payload = Object.fromEntries(new FormData(bidForm).entries());

    try {
      const data = await apiRequest(`/projects/${payload.project_id}/bids`, {
        method: "POST",
        body: JSON.stringify(payload)
      });
      document.getElementById("result").textContent = JSON.stringify(data.bid, null, 2);
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
