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

      if (!["company", "freelancer"].includes(role)) {
        sendJson(res, 400, { error: "Role must be company or freelancer" });
        return;
      }

      const { data: createdUser, error: authError } = await supabaseAdmin.auth.admin.createUser({
        email: body.email,
        password: body.password,
        email_confirm: true
      });

      if (authError) {
        sendJson(res, 400, { error: authError.message });
        return;
      }

      const newUserId = createdUser.user?.id;
      const { error: userInsertError } = await supabaseAdmin.from("users").insert({
        id: newUserId,
        email: body.email,
        role
      });

      if (userInsertError) {
        sendJson(res, 400, { error: userInsertError.message });
        return;
      }

      if (role === "company") {
        await supabaseAdmin.from("company_profiles").insert({
          user_id: newUserId,
          company_name: body.company_name || body.email.split("@")[0]
        });
      }

      if (role === "freelancer") {
        await supabaseAdmin.from("freelancer_profiles").insert({
          user_id: newUserId,
          full_name: body.full_name || "New Freelancer",
          skills: toArray(body.skills)
        });
      }

      sendJson(res, 201, {
        message: "User registered successfully",
        user: { id: newUserId, email: body.email, role }
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
        .select("role")
        .eq("id", data.user.id)
        .single();

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
        const { data: profile } = await supabaseAdmin
          .from("company_profiles")
          .select("id")
          .eq("user_id", actingUser.id)
          .single();
        companyProfileId = profile?.id;
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

      let freelancerProfileId = body.freelancer_id;
      if (actingUser.role === "freelancer") {
        const { data: profile } = await supabaseAdmin
          .from("freelancer_profiles")
          .select("id")
          .eq("user_id", actingUser.id)
          .single();
        freelancerProfileId = profile?.id;
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
      const { error } = await supabaseAdmin.from("bids").delete().eq("id", bidId);

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
      const { data, error } = await supabaseAdmin
        .from("reviews")
        .insert({
          project_id: body.project_id,
          reviewer_id: current.id,
          reviewee_id: body.reviewee_id,
          rating: body.rating,
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
