import { requireRole, requireUser } from "../lib/auth.js";
import { parseBody, sendJson } from "../lib/response.js";
import { supabaseAdmin, supabaseAnon } from "../lib/supabase.js";

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
}

function pathMatch(pathname, regex) {
  const match = pathname.match(regex);
  return match ? match.slice(1) : null;
}

function toArray(value) {
  if (!value) {
    return [];
  }
  if (Array.isArray(value)) {
    return value;
  }
  return String(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function handleError(res, error, fallback = "Unexpected server error") {
  const message = error?.message || fallback;
  sendJson(res, 500, { error: message });
}

async function getCompanyProfileId(userId) {
  const { data } = await supabaseAdmin.from("company_profiles").select("id").eq("user_id", userId).single();
  return data?.id || null;
}

async function getFreelancerProfileId(userId) {
  const { data } = await supabaseAdmin.from("freelancer_profiles").select("id").eq("user_id", userId).single();
  return data?.id || null;
}

export default async function handler(req, res) {
  setCors(res);

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  const url = new URL(req.url, "http://localhost");
  const pathname = url.pathname.replace(/^\/api/, "") || "/";

  try {
    if (req.method === "GET" && pathname === "/health") {
      sendJson(res, 200, { ok: true, service: "freelaunch-api" });
      return;
    }

    if (req.method === "POST" && pathname === "/auth/register") {
      const body = parseBody(req);
      const role = body.role;
      const email = String(body.email || "").trim().toLowerCase();
      const password = String(body.password || "");

      if (!["company", "freelancer"].includes(role)) {
        sendJson(res, 400, { error: "Role must be company or freelancer" });
        return;
      }

      if (!email || !password || password.length < 8) {
        sendJson(res, 400, { error: "Valid email and password (min 8 chars) are required" });
        return;
      }

      const { data: createdUser, error: authError } = await supabaseAdmin.auth.admin.createUser({
        email,
        password,
        email_confirm: true
      });

      if (authError) {
        sendJson(res, 400, { error: authError.message });
        return;
      }

      const newUserId = createdUser.user?.id;
      const { error: userInsertError } = await supabaseAdmin.from("users").insert({
        id: newUserId,
        email,
        role
      });

      if (userInsertError) {
        if (newUserId) {
          await supabaseAdmin.auth.admin.deleteUser(newUserId);
        }
        sendJson(res, 400, { error: userInsertError.message });
        return;
      }

      if (role === "company") {
        const { error: companyProfileError } = await supabaseAdmin.from("company_profiles").insert({
          user_id: newUserId,
          company_name: body.company_name || email.split("@")[0]
        });

        if (companyProfileError) {
          await supabaseAdmin.from("users").delete().eq("id", newUserId);
          await supabaseAdmin.auth.admin.deleteUser(newUserId);
          sendJson(res, 400, { error: companyProfileError.message });
          return;
        }
      }

      if (role === "freelancer") {
        const { error: freelancerProfileError } = await supabaseAdmin.from("freelancer_profiles").insert({
          user_id: newUserId,
          full_name: body.full_name || "New Freelancer",
          skills: toArray(body.skills)
        });

        if (freelancerProfileError) {
          await supabaseAdmin.from("users").delete().eq("id", newUserId);
          await supabaseAdmin.auth.admin.deleteUser(newUserId);
          sendJson(res, 400, { error: freelancerProfileError.message });
          return;
        }
      }

      sendJson(res, 201, {
        message: "User registered successfully",
        user: { id: newUserId, email, role }
      });
      return;
    }

    if (req.method === "POST" && pathname === "/auth/login") {
      const body = parseBody(req);
      const { data, error } = await supabaseAnon.auth.signInWithPassword({
        email: body.email,
        password: body.password
      });

      if (error || !data.session) {
        sendJson(res, 401, { error: error?.message || "Invalid credentials" });
        return;
      }

      const { data: userRole } = await supabaseAdmin
        .from("users")
        .select("role, suspended")
        .eq("id", data.user.id)
        .single();

      if (userRole?.suspended) {
        sendJson(res, 403, { error: "Account is suspended" });
        return;
      }

      sendJson(res, 200, {
        token: data.session.access_token,
        user: {
          id: data.user.id,
          email: data.user.email,
          role: userRole?.role || "freelancer"
        }
      });
      return;
    }

    if (req.method === "POST" && pathname === "/auth/logout") {
      sendJson(res, 200, { message: "Logout on client by removing token" });
      return;
    }

    if (req.method === "GET" && pathname === "/auth/me") {
      const user = await requireUser(req, res);
      if (!user) {
        return;
      }

      const { data, error } = await supabaseAdmin
        .from("users")
        .select("id, email, role, suspended")
        .eq("id", user.id)
        .single();

      if (error) {
        sendJson(res, 404, { error: error.message });
        return;
      }

      sendJson(res, 200, { user: data });
      return;
    }

    if (req.method === "GET" && pathname === "/company/projects") {
      const actingUser = await requireRole(req, res, ["company", "admin"]);
      if (!actingUser) {
        return;
      }

      let companyProfileId = url.searchParams.get("company_id") || null;
      const statusParam = url.searchParams.get("status") || "";
      const statuses = statusParam
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);

      if (actingUser.role === "company") {
        companyProfileId = await getCompanyProfileId(actingUser.id);
      }

      if (!companyProfileId) {
        sendJson(res, 400, { error: "Company profile is required" });
        return;
      }

      let query = supabaseAdmin
        .from("projects")
        .select("*")
        .eq("company_id", companyProfileId)
        .order("created_at", { ascending: false });

      if (statuses.length === 1) {
        query = query.eq("status", statuses[0]);
      } else if (statuses.length > 1) {
        query = query.in("status", statuses);
      }

      const { data, error } = await query;
      if (error) {
        sendJson(res, 400, { error: error.message });
        return;
      }

      sendJson(res, 200, { projects: data });
      return;
    }

    if (req.method === "GET" && pathname === "/projects") {
      const status = url.searchParams.get("status") || "open";
      const skills = toArray(url.searchParams.get("skills"));

      let query = supabaseAdmin
        .from("projects")
        .select("*")
        .eq("status", status)
        .order("created_at", { ascending: false });

      if (skills.length > 0) {
        query = query.overlaps("skills_required", skills);
      }

      const { data, error } = await query;

      if (error) {
        sendJson(res, 400, { error: error.message });
        return;
      }

      sendJson(res, 200, { projects: data });
      return;
    }

    if (req.method === "POST" && pathname === "/projects") {
      const actingUser = await requireRole(req, res, ["company", "admin"]);
      if (!actingUser) {
        return;
      }

      const body = parseBody(req);

      let companyProfileId = body.company_id;
      if (actingUser.role === "company") {
        companyProfileId = await getCompanyProfileId(actingUser.id);
      }

      if (!companyProfileId) {
        sendJson(res, 400, { error: "Company profile is required to create a project" });
        return;
      }

      const { data, error } = await supabaseAdmin
        .from("projects")
        .insert({
          company_id: companyProfileId,
          title: body.title,
          description: body.description,
          budget_min: body.budget_min,
          budget_max: body.budget_max,
          skills_required: toArray(body.skills_required),
          deadline: body.deadline,
          status: "open"
        })
        .select("*")
        .single();

      if (error) {
        sendJson(res, 400, { error: error.message });
        return;
      }

      sendJson(res, 201, { project: data });
      return;
    }

    const projectIdMatch = pathMatch(pathname, /^\/projects\/([\w-]+)$/);
    if (projectIdMatch && req.method === "GET") {
      const [projectId] = projectIdMatch;
      const { data, error } = await supabaseAdmin.from("projects").select("*").eq("id", projectId).single();

      if (error) {
        sendJson(res, 404, { error: error.message });
        return;
      }

      sendJson(res, 200, { project: data });
      return;
    }

    if (projectIdMatch && req.method === "PUT") {
      const [projectId] = projectIdMatch;
      const actingUser = await requireRole(req, res, ["company", "admin"]);
      if (!actingUser) {
        return;
      }
      const body = parseBody(req);

      const { data: targetProject, error: projectLoadError } = await supabaseAdmin
        .from("projects")
        .select("id, company_id")
        .eq("id", projectId)
        .single();

      if (projectLoadError || !targetProject) {
        sendJson(res, 404, { error: "Project not found" });
        return;
      }

      if (actingUser.role === "company") {
        const { data: profile } = await supabaseAdmin
          .from("company_profiles")
          .select("id")
          .eq("user_id", actingUser.id)
          .single();

        if (!profile || profile.id !== targetProject.company_id) {
          sendJson(res, 403, { error: "You can only edit your own projects" });
          return;
        }
      }

      const { data, error } = await supabaseAdmin
        .from("projects")
        .update({
          title: body.title,
          description: body.description,
          budget_min: body.budget_min,
          budget_max: body.budget_max,
          skills_required: toArray(body.skills_required),
          deadline: body.deadline,
          status: body.status
        })
        .eq("id", projectId)
        .select("*")
        .single();

      if (error) {
        sendJson(res, 400, { error: error.message });
        return;
      }

      sendJson(res, 200, { project: data });
      return;
    }

    if (projectIdMatch && req.method === "DELETE") {
      const [projectId] = projectIdMatch;
      const actingUser = await requireRole(req, res, ["company", "admin"]);
      if (!actingUser) {
        return;
      }

      if (actingUser.role === "company") {
        const { data: profile } = await supabaseAdmin
          .from("company_profiles")
          .select("id")
          .eq("user_id", actingUser.id)
          .single();

        const { data: targetProject } = await supabaseAdmin
          .from("projects")
          .select("company_id")
          .eq("id", projectId)
          .single();

        if (!profile || !targetProject || profile.id !== targetProject.company_id) {
          sendJson(res, 403, { error: "You can only delete your own projects" });
          return;
        }
      }

      const { error } = await supabaseAdmin.from("projects").delete().eq("id", projectId);
      if (error) {
        sendJson(res, 400, { error: error.message });
        return;
      }

      sendJson(res, 200, { message: "Project deleted" });
      return;
    }

    const projectBidsMatch = pathMatch(pathname, /^\/projects\/([\w-]+)\/bids$/);
    if (projectBidsMatch && req.method === "GET") {
      const [projectId] = projectBidsMatch;
      const actingUser = await requireRole(req, res, ["company", "admin"]);
      if (!actingUser) {
        return;
      }

      if (actingUser.role === "company") {
        const { data: profile } = await supabaseAdmin
          .from("company_profiles")
          .select("id")
          .eq("user_id", actingUser.id)
          .single();
        const { data: project } = await supabaseAdmin
          .from("projects")
          .select("company_id")
          .eq("id", projectId)
          .single();

        if (!profile || !project || profile.id !== project.company_id) {
          sendJson(res, 403, { error: "You can only view bids for your own projects" });
          return;
        }
      }

      const { data, error } = await supabaseAdmin
        .from("bids")
        .select("*")
        .eq("project_id", projectId)
        .order("created_at", { ascending: false });

      if (error) {
        sendJson(res, 400, { error: error.message });
        return;
      }

      sendJson(res, 200, { bids: data });
      return;
    }

    if (projectBidsMatch && req.method === "POST") {
      const actingUser = await requireRole(req, res, ["freelancer", "admin"]);
      if (!actingUser) {
        return;
      }

      const [projectId] = projectBidsMatch;
      const body = parseBody(req);

      const { data: project } = await supabaseAdmin
        .from("projects")
        .select("id, status")
        .eq("id", projectId)
        .single();

      if (!project) {
        sendJson(res, 404, { error: "Project not found" });
        return;
      }

      if (project.status !== "open") {
        sendJson(res, 400, { error: "Bids can only be submitted to open projects" });
        return;
      }

      let freelancerProfileId = body.freelancer_id;
      if (actingUser.role === "freelancer") {
        freelancerProfileId = await getFreelancerProfileId(actingUser.id);
      }

      if (!freelancerProfileId) {
        sendJson(res, 400, { error: "Freelancer profile is required before submitting bids" });
        return;
      }

      const { data: existingBid } = await supabaseAdmin
        .from("bids")
        .select("id, status")
        .eq("project_id", projectId)
        .eq("freelancer_id", freelancerProfileId)
        .maybeSingle();

      if (existingBid) {
        if (existingBid.status === "accepted") {
          sendJson(res, 409, { error: "Your bid has already been accepted for this project" });
          return;
        }

        const { data: updatedBid, error: updateError } = await supabaseAdmin
          .from("bids")
          .update({
            bid_amount: body.bid_amount,
            cover_letter: body.cover_letter,
            estimated_days: body.estimated_days,
            status: "pending"
          })
          .eq("id", existingBid.id)
          .select("*")
          .single();

        if (updateError) {
          sendJson(res, 400, { error: updateError.message });
          return;
        }

        sendJson(res, 200, {
          message: "Existing bid updated",
          bid: updatedBid,
          updated: true
        });
        return;
      }

      const { data, error } = await supabaseAdmin
        .from("bids")
        .insert({
          project_id: projectId,
          freelancer_id: freelancerProfileId,
          bid_amount: body.bid_amount,
          cover_letter: body.cover_letter,
          estimated_days: body.estimated_days,
          status: "pending"
        })
        .select("*")
        .single();

      if (error) {
        if (error.code === "23505") {
          sendJson(res, 409, { error: "You already submitted a bid for this project. Edit your existing bid instead." });
          return;
        }
        sendJson(res, 400, { error: error.message });
        return;
      }

      sendJson(res, 201, { bid: data });
      return;
    }

    const acceptBidMatch = pathMatch(pathname, /^\/bids\/([\w-]+)\/accept$/);
    if (acceptBidMatch && req.method === "PUT") {
      const actingUser = await requireRole(req, res, ["company", "admin"]);
      if (!actingUser) {
        return;
      }

      const [bidId] = acceptBidMatch;
      const { data: bid, error: bidError } = await supabaseAdmin
        .from("bids")
        .select("*")
        .eq("id", bidId)
        .single();

      if (bidError || !bid) {
        sendJson(res, 404, { error: "Bid not found" });
        return;
      }

      if (bid.status !== "pending") {
        sendJson(res, 400, { error: "Only pending bids can be accepted" });
        return;
      }

      const { data: project } = await supabaseAdmin
        .from("projects")
        .select("id, company_id, status")
        .eq("id", bid.project_id)
        .single();

      if (!project) {
        sendJson(res, 404, { error: "Project not found for this bid" });
        return;
      }

      if (actingUser.role === "company") {
        const companyProfileId = await getCompanyProfileId(actingUser.id);
        if (!companyProfileId || companyProfileId !== project.company_id) {
          sendJson(res, 403, { error: "You can only accept bids on your own projects" });
          return;
        }
      }

      if (!["open", "in_progress"].includes(project.status)) {
        sendJson(res, 400, { error: "Project is not accepting bid updates" });
        return;
      }

      await supabaseAdmin.from("bids").update({ status: "rejected" }).eq("project_id", bid.project_id).neq("id", bidId);
      await supabaseAdmin.from("bids").update({ status: "accepted" }).eq("id", bidId);
      await supabaseAdmin
        .from("projects")
        .update({ status: "in_progress", awarded_to: bid.freelancer_id })
        .eq("id", bid.project_id);

      sendJson(res, 200, { message: "Bid accepted and project updated" });
      return;
    }

    const rejectBidMatch = pathMatch(pathname, /^\/bids\/([\w-]+)\/reject$/);
    if (rejectBidMatch && req.method === "PUT") {
      const actingUser = await requireRole(req, res, ["company", "admin"]);
      if (!actingUser) {
        return;
      }

      const [bidId] = rejectBidMatch;
      const { data: targetBid } = await supabaseAdmin.from("bids").select("*").eq("id", bidId).single();
      if (!targetBid) {
        sendJson(res, 404, { error: "Bid not found" });
        return;
      }

      if (actingUser.role === "company") {
        const companyProfileId = await getCompanyProfileId(actingUser.id);
        const { data: project } = await supabaseAdmin
          .from("projects")
          .select("company_id")
          .eq("id", targetBid.project_id)
          .single();

        if (!companyProfileId || !project || companyProfileId !== project.company_id) {
          sendJson(res, 403, { error: "You can only reject bids on your own projects" });
          return;
        }
      }

      if (targetBid.status !== "pending") {
        sendJson(res, 400, { error: "Only pending bids can be rejected" });
        return;
      }

      const { data, error } = await supabaseAdmin.from("bids").update({ status: "rejected" }).eq("id", bidId).select("*").single();

      if (error) {
        sendJson(res, 400, { error: error.message });
        return;
      }

      sendJson(res, 200, { bid: data });
      return;
    }

    const bidDeleteMatch = pathMatch(pathname, /^\/bids\/([\w-]+)$/);
    if (bidDeleteMatch && req.method === "DELETE") {
      const actingUser = await requireRole(req, res, ["freelancer", "admin"]);
      if (!actingUser) {
        return;
      }
      const [bidId] = bidDeleteMatch;

      const { data: targetBid } = await supabaseAdmin.from("bids").select("*").eq("id", bidId).single();

      if (!targetBid) {
        sendJson(res, 404, { error: "Bid not found" });
        return;
      }

      if (actingUser.role === "freelancer") {
        const freelancerProfileId = await getFreelancerProfileId(actingUser.id);
        if (!freelancerProfileId || freelancerProfileId !== targetBid.freelancer_id) {
          sendJson(res, 403, { error: "You can only withdraw your own bids" });
          return;
        }
      }

      if (targetBid.status !== "pending") {
        sendJson(res, 400, { error: "Only pending bids can be withdrawn" });
        return;
      }

      const { error } = await supabaseAdmin.from("bids").update({ status: "withdrawn" }).eq("id", bidId);

      if (error) {
        sendJson(res, 400, { error: error.message });
        return;
      }

      sendJson(res, 200, { message: "Bid withdrawn" });
      return;
    }

    const projectMilestonesMatch = pathMatch(pathname, /^\/projects\/([\w-]+)\/milestones$/);
    if (projectMilestonesMatch && req.method === "GET") {
      const [projectId] = projectMilestonesMatch;
      const { data, error } = await supabaseAdmin
        .from("milestones")
        .select("*")
        .eq("project_id", projectId)
        .order("created_at", { ascending: true });

      if (error) {
        sendJson(res, 400, { error: error.message });
        return;
      }

      sendJson(res, 200, { milestones: data });
      return;
    }

    if (projectMilestonesMatch && req.method === "POST") {
      const actingUser = await requireRole(req, res, ["company", "admin"]);
      if (!actingUser) {
        return;
      }
      const [projectId] = projectMilestonesMatch;
      const body = parseBody(req);

      const { data: project } = await supabaseAdmin
        .from("projects")
        .select("id, company_id")
        .eq("id", projectId)
        .single();

      if (!project) {
        sendJson(res, 404, { error: "Project not found" });
        return;
      }

      if (actingUser.role === "company") {
        const companyProfileId = await getCompanyProfileId(actingUser.id);
        if (!companyProfileId || companyProfileId !== project.company_id) {
          sendJson(res, 403, { error: "You can only create milestones for your own projects" });
          return;
        }
      }

      const { data, error } = await supabaseAdmin
        .from("milestones")
        .insert({
          project_id: projectId,
          title: body.title,
          description: body.description,
          amount: body.amount,
          due_date: body.due_date,
          status: "pending"
        })
        .select("*")
        .single();

      if (error) {
        sendJson(res, 400, { error: error.message });
        return;
      }

      sendJson(res, 201, { milestone: data });
      return;
    }

    const submitMilestoneMatch = pathMatch(pathname, /^\/milestones\/([\w-]+)\/submit$/);
    if (submitMilestoneMatch && req.method === "PUT") {
      const actingUser = await requireRole(req, res, ["freelancer", "admin"]);
      if (!actingUser) {
        return;
      }
      const [milestoneId] = submitMilestoneMatch;
      const body = parseBody(req);

      const { data: milestone } = await supabaseAdmin
        .from("milestones")
        .select("id, project_id, status")
        .eq("id", milestoneId)
        .single();

      if (!milestone) {
        sendJson(res, 404, { error: "Milestone not found" });
        return;
      }

      if (actingUser.role === "freelancer") {
        const freelancerProfileId = await getFreelancerProfileId(actingUser.id);
        const { data: project } = await supabaseAdmin
          .from("projects")
          .select("awarded_to")
          .eq("id", milestone.project_id)
          .single();

        if (!freelancerProfileId || !project || project.awarded_to !== freelancerProfileId) {
          sendJson(res, 403, { error: "You can only submit milestones for your awarded projects" });
          return;
        }
      }

      if (!["pending", "in_progress", "rejected"].includes(milestone.status)) {
        sendJson(res, 400, { error: "This milestone cannot be submitted in its current status" });
        return;
      }

      const { data, error } = await supabaseAdmin
        .from("milestones")
        .update({
          status: "submitted",
          deliverable_url: body.deliverable_url,
          submitted_at: new Date().toISOString()
        })
        .eq("id", milestoneId)
        .select("*")
        .single();

      if (error) {
        sendJson(res, 400, { error: error.message });
        return;
      }

      sendJson(res, 200, { milestone: data });
      return;
    }

    const approveMilestoneMatch = pathMatch(pathname, /^\/milestones\/([\w-]+)\/approve$/);
    if (approveMilestoneMatch && req.method === "PUT") {
      const actingUser = await requireRole(req, res, ["company", "admin"]);
      if (!actingUser) {
        return;
      }
      const [milestoneId] = approveMilestoneMatch;

      const { data: milestone } = await supabaseAdmin
        .from("milestones")
        .select("id, project_id, status")
        .eq("id", milestoneId)
        .single();

      if (!milestone) {
        sendJson(res, 404, { error: "Milestone not found" });
        return;
      }

      if (milestone.status !== "submitted") {
        sendJson(res, 400, { error: "Only submitted milestones can be approved" });
        return;
      }

      if (actingUser.role === "company") {
        const companyProfileId = await getCompanyProfileId(actingUser.id);
        const { data: project } = await supabaseAdmin
          .from("projects")
          .select("company_id")
          .eq("id", milestone.project_id)
          .single();

        if (!companyProfileId || !project || companyProfileId !== project.company_id) {
          sendJson(res, 403, { error: "You can only approve milestones for your own projects" });
          return;
        }
      }

      const { data, error } = await supabaseAdmin
        .from("milestones")
        .update({
          status: "approved",
          approved_at: new Date().toISOString()
        })
        .eq("id", milestoneId)
        .select("*")
        .single();

      if (error) {
        sendJson(res, 400, { error: error.message });
        return;
      }

      sendJson(res, 200, { milestone: data });
      return;
    }

    const rejectMilestoneMatch = pathMatch(pathname, /^\/milestones\/([\w-]+)\/reject$/);
    if (rejectMilestoneMatch && req.method === "PUT") {
      const actingUser = await requireRole(req, res, ["company", "admin"]);
      if (!actingUser) {
        return;
      }
      const [milestoneId] = rejectMilestoneMatch;

      const { data: milestone } = await supabaseAdmin
        .from("milestones")
        .select("id, project_id, status")
        .eq("id", milestoneId)
        .single();

      if (!milestone) {
        sendJson(res, 404, { error: "Milestone not found" });
        return;
      }

      if (milestone.status !== "submitted") {
        sendJson(res, 400, { error: "Only submitted milestones can be rejected" });
        return;
      }

      if (actingUser.role === "company") {
        const companyProfileId = await getCompanyProfileId(actingUser.id);
        const { data: project } = await supabaseAdmin
          .from("projects")
          .select("company_id")
          .eq("id", milestone.project_id)
          .single();

        if (!companyProfileId || !project || companyProfileId !== project.company_id) {
          sendJson(res, 403, { error: "You can only reject milestones for your own projects" });
          return;
        }
      }

      const { data, error } = await supabaseAdmin
        .from("milestones")
        .update({
          status: "rejected"
        })
        .eq("id", milestoneId)
        .select("*")
        .single();

      if (error) {
        sendJson(res, 400, { error: error.message });
        return;
      }

      sendJson(res, 200, { milestone: data });
      return;
    }

    if (req.method === "POST" && pathname === "/reviews") {
      const current = await requireRole(req, res, ["company", "freelancer", "admin"]);
      if (!current) {
        return;
      }

      const body = parseBody(req);
      if (!body.project_id || !body.reviewee_id || !body.rating) {
        sendJson(res, 400, { error: "project_id, reviewee_id and rating are required" });
        return;
      }

      const numericRating = Number(body.rating);
      if (!Number.isInteger(numericRating) || numericRating < 1 || numericRating > 5) {
        sendJson(res, 400, { error: "Rating must be an integer between 1 and 5" });
        return;
      }

      if (body.reviewee_id === current.id) {
        sendJson(res, 400, { error: "You cannot review yourself" });
        return;
      }

      const { data: project } = await supabaseAdmin
        .from("projects")
        .select("id, status, company_id, awarded_to")
        .eq("id", body.project_id)
        .single();

      if (!project) {
        sendJson(res, 404, { error: "Project not found" });
        return;
      }

      if (project.status !== "completed") {
        sendJson(res, 400, { error: "Reviews are allowed only after project completion" });
        return;
      }

      if (current.role === "company") {
        const companyProfileId = await getCompanyProfileId(current.id);
        if (!companyProfileId || companyProfileId !== project.company_id) {
          sendJson(res, 403, { error: "You can only review projects owned by your company" });
          return;
        }
      }

      if (current.role === "freelancer") {
        const freelancerProfileId = await getFreelancerProfileId(current.id);
        if (!freelancerProfileId || freelancerProfileId !== project.awarded_to) {
          sendJson(res, 403, { error: "You can only review projects awarded to you" });
          return;
        }
      }

      const { data, error } = await supabaseAdmin
        .from("reviews")
        .insert({
          project_id: body.project_id,
          reviewer_id: current.id,
          reviewee_id: body.reviewee_id,
          rating: numericRating,
          comment: body.comment,
          reviewer_role: current.role
        })
        .select("*")
        .single();

      if (error) {
        sendJson(res, 400, { error: error.message });
        return;
      }

      sendJson(res, 201, { review: data });
      return;
    }

    const freelancerReviewsMatch = pathMatch(pathname, /^\/freelancers\/([\w-]+)\/reviews$/);
    if (freelancerReviewsMatch && req.method === "GET") {
      const [freelancerProfileId] = freelancerReviewsMatch;
      const { data: profile } = await supabaseAdmin
        .from("freelancer_profiles")
        .select("user_id")
        .eq("id", freelancerProfileId)
        .single();

      const { data, error } = await supabaseAdmin
        .from("reviews")
        .select("*")
        .eq("reviewee_id", profile?.user_id)
        .order("created_at", { ascending: false });

      if (error) {
        sendJson(res, 400, { error: error.message });
        return;
      }

      sendJson(res, 200, { reviews: data });
      return;
    }

    const companyReviewsMatch = pathMatch(pathname, /^\/companies\/([\w-]+)\/reviews$/);
    if (companyReviewsMatch && req.method === "GET") {
      const [companyProfileId] = companyReviewsMatch;
      const { data: profile } = await supabaseAdmin
        .from("company_profiles")
        .select("user_id")
        .eq("id", companyProfileId)
        .single();

      const { data, error } = await supabaseAdmin
        .from("reviews")
        .select("*")
        .eq("reviewee_id", profile?.user_id)
        .order("created_at", { ascending: false });

      if (error) {
        sendJson(res, 400, { error: error.message });
        return;
      }

      sendJson(res, 200, { reviews: data });
      return;
    }

    if (req.method === "POST" && pathname === "/disputes") {
      const current = await requireRole(req, res, ["company", "freelancer", "admin"]);
      if (!current) {
        return;
      }
      const body = parseBody(req);

      if (!body.project_id || !body.reason) {
        sendJson(res, 400, { error: "project_id and reason are required" });
        return;
      }

      const { data: project } = await supabaseAdmin
        .from("projects")
        .select("id, company_id, awarded_to")
        .eq("id", body.project_id)
        .single();

      if (!project) {
        sendJson(res, 404, { error: "Project not found" });
        return;
      }

      if (current.role === "company") {
        const companyProfileId = await getCompanyProfileId(current.id);
        if (!companyProfileId || companyProfileId !== project.company_id) {
          sendJson(res, 403, { error: "You can only raise disputes for your own projects" });
          return;
        }
      }

      if (current.role === "freelancer") {
        const freelancerProfileId = await getFreelancerProfileId(current.id);
        if (!freelancerProfileId || freelancerProfileId !== project.awarded_to) {
          sendJson(res, 403, { error: "You can only raise disputes for projects awarded to you" });
          return;
        }
      }

      const { data, error } = await supabaseAdmin
        .from("disputes")
        .insert({
          project_id: body.project_id,
          raised_by: current.id,
          reason: body.reason,
          status: "open"
        })
        .select("*")
        .single();

      if (error) {
        sendJson(res, 400, { error: error.message });
        return;
      }

      sendJson(res, 201, { dispute: data });
      return;
    }

    if (req.method === "GET" && pathname === "/disputes") {
      const current = await requireRole(req, res, ["admin"]);
      if (!current) {
        return;
      }

      const { data, error } = await supabaseAdmin
        .from("disputes")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) {
        sendJson(res, 400, { error: error.message });
        return;
      }

      sendJson(res, 200, { disputes: data });
      return;
    }

    const resolveDisputeMatch = pathMatch(pathname, /^\/disputes\/([\w-]+)\/resolve$/);
    if (resolveDisputeMatch && req.method === "PUT") {
      const current = await requireRole(req, res, ["admin"]);
      if (!current) {
        return;
      }

      const [disputeId] = resolveDisputeMatch;
      const body = parseBody(req);
      const { data, error } = await supabaseAdmin
        .from("disputes")
        .update({
          status: "resolved",
          resolution: body.resolution,
          resolved_by: current.id,
          resolved_at: new Date().toISOString()
        })
        .eq("id", disputeId)
        .select("*")
        .single();

      if (error) {
        sendJson(res, 400, { error: error.message });
        return;
      }

      sendJson(res, 200, { dispute: data });
      return;
    }

    if (req.method === "GET" && pathname === "/admin/users") {
      const current = await requireRole(req, res, ["admin"]);
      if (!current) {
        return;
      }

      const { data, error } = await supabaseAdmin.from("users").select("id, email, role, suspended, created_at");
      if (error) {
        sendJson(res, 400, { error: error.message });
        return;
      }

      sendJson(res, 200, { users: data });
      return;
    }

    const adminSuspendUserMatch = pathMatch(pathname, /^\/admin\/users\/([\w-]+)\/suspend$/);
    if (adminSuspendUserMatch && req.method === "PUT") {
      const current = await requireRole(req, res, ["admin"]);
      if (!current) {
        return;
      }

      const [userId] = adminSuspendUserMatch;
      const { data, error } = await supabaseAdmin
        .from("users")
        .update({ suspended: true })
        .eq("id", userId)
        .select("id, email, role, suspended")
        .single();

      if (error) {
        sendJson(res, 400, { error: error.message });
        return;
      }

      sendJson(res, 200, { user: data });
      return;
    }

    const adminDeleteUserMatch = pathMatch(pathname, /^\/admin\/users\/([\w-]+)$/);
    if (adminDeleteUserMatch && req.method === "DELETE") {
      const current = await requireRole(req, res, ["admin"]);
      if (!current) {
        return;
      }

      const [userId] = adminDeleteUserMatch;
      await supabaseAdmin.auth.admin.deleteUser(userId);
      const { error } = await supabaseAdmin.from("users").delete().eq("id", userId);

      if (error) {
        sendJson(res, 400, { error: error.message });
        return;
      }

      sendJson(res, 200, { message: "User deleted" });
      return;
    }

    if (req.method === "GET" && pathname === "/admin/stats") {
      const current = await requireRole(req, res, ["admin"]);
      if (!current) {
        return;
      }

      const usersResult = await supabaseAdmin.from("users").select("id", { count: "exact", head: true });
      const projectsResult = await supabaseAdmin
        .from("projects")
        .select("id", { count: "exact", head: true })
        .in("status", ["open", "in_progress"]);
      const disputesResult = await supabaseAdmin
        .from("disputes")
        .select("id", { count: "exact", head: true })
        .in("status", ["open", "under_review"]);

      sendJson(res, 200, {
        stats: {
          total_users: usersResult.count || 0,
          active_projects: projectsResult.count || 0,
          open_disputes: disputesResult.count || 0
        }
      });
      return;
    }

    sendJson(res, 404, { error: `Route not found: ${req.method} ${pathname}` });
  } catch (error) {
    handleError(res, error);
  }
}
