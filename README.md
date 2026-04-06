# 🚀 FreeLaunch — Freelancer Project Marketplace

> A full-stack freelance marketplace built with **Node.js**, **HTML/CSS/JS**, and **Supabase** — connecting companies with top freelancers through a transparent, milestone-driven workflow.

---

## 📋 Table of Contents

- [Overview](#overview)
- [Features](#features)
- [Tech Stack](#tech-stack)
- [Database Schema (Supabase)](#database-schema-supabase)
- [Project Structure](#project-structure)
- [Modules](#modules)
  - [Authentication & Roles](#authentication--roles)
  - [Freelancer Profiles](#freelancer-profiles)
  - [Project Bidding](#project-bidding)
  - [Milestone Tracking](#milestone-tracking)
  - [Reviews & Ratings](#reviews--ratings)
  - [Admin Panel](#admin-panel)
- [Getting Started](#getting-started)
- [Environment Variables](#environment-variables)
- [API Routes](#api-routes)
- [Supabase Setup](#supabase-setup)
- [User Flows](#user-flows)
- [Screenshots / UI Notes](#screenshots--ui-notes)
- [Contributing](#contributing)
- [License](#license)

---

## Overview

**FreeLaunch** is a two-sided marketplace where:

- **Companies** post projects, review bids, award contracts, and track deliverables.
- **Freelancers** build profiles, bid on projects, deliver milestones, and grow their reputation.
- **Admins** oversee disputes, manage users, and maintain platform integrity.

All built with vanilla Node.js (no heavy frameworks), plain HTML/CSS/JS on the frontend, and Supabase as the backend (PostgreSQL + Auth + Storage).

---

## Features

| Feature | Company | Freelancer | Admin |
|---|---|---|---|
| Post & manage projects | ✅ | ❌ | ✅ |
| Browse & bid on projects | ❌ | ✅ | ✅ |
| Accept / reject bids | ✅ | ❌ | ✅ |
| Milestone creation & tracking | ✅ | ✅ | ✅ |
| Mark milestones complete | ✅ | ✅ | ✅ |
| Leave reviews & ratings | ✅ | ✅ | ✅ |
| Dispute resolution | ❌ | ❌ | ✅ |
| User management | ❌ | ❌ | ✅ |
| Dashboard analytics | ✅ | ✅ | ✅ |

---

## Tech Stack

```
Frontend     →  HTML5 · CSS3 · Vanilla JavaScript (ES6+)
Backend      →  Node.js · Express.js
Database     →  Supabase (PostgreSQL)
Auth         →  Supabase Auth (JWT)
Storage      →  Supabase Storage (profile images, deliverables)
Hosting      →  Node.js HTTP server (can deploy to Railway / Render / VPS)
```

---

## Database Schema (Supabase)

### Tables

#### `users`
```sql
CREATE TABLE users (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email       TEXT UNIQUE NOT NULL,
  role        TEXT CHECK (role IN ('company', 'freelancer', 'admin')) NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
```

#### `freelancer_profiles`
```sql
CREATE TABLE freelancer_profiles (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID REFERENCES users(id) ON DELETE CASCADE,
  full_name    TEXT NOT NULL,
  bio          TEXT,
  skills       TEXT[],          -- e.g. ARRAY['React', 'Node.js', 'UI/UX']
  hourly_rate  NUMERIC(10,2),
  portfolio_url TEXT,
  avatar_url   TEXT,
  avg_rating   NUMERIC(3,2) DEFAULT 0,
  total_reviews INT DEFAULT 0,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);
```

#### `company_profiles`
```sql
CREATE TABLE company_profiles (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID REFERENCES users(id) ON DELETE CASCADE,
  company_name TEXT NOT NULL,
  industry     TEXT,
  website      TEXT,
  logo_url     TEXT,
  description  TEXT,
  avg_rating   NUMERIC(3,2) DEFAULT 0,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);
```

#### `projects`
```sql
CREATE TABLE projects (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      UUID REFERENCES company_profiles(id) ON DELETE CASCADE,
  title           TEXT NOT NULL,
  description     TEXT NOT NULL,
  budget_min      NUMERIC(12,2),
  budget_max      NUMERIC(12,2),
  skills_required TEXT[],
  deadline        DATE,
  status          TEXT CHECK (status IN ('open','in_progress','completed','disputed','cancelled'))
                  DEFAULT 'open',
  awarded_to      UUID REFERENCES freelancer_profiles(id),
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
```

#### `bids`
```sql
CREATE TABLE bids (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      UUID REFERENCES projects(id) ON DELETE CASCADE,
  freelancer_id   UUID REFERENCES freelancer_profiles(id) ON DELETE CASCADE,
  bid_amount      NUMERIC(12,2) NOT NULL,
  cover_letter    TEXT,
  estimated_days  INT,
  status          TEXT CHECK (status IN ('pending','accepted','rejected','withdrawn'))
                  DEFAULT 'pending',
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
```

#### `milestones`
```sql
CREATE TABLE milestones (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      UUID REFERENCES projects(id) ON DELETE CASCADE,
  title           TEXT NOT NULL,
  description     TEXT,
  amount          NUMERIC(12,2),
  due_date        DATE,
  status          TEXT CHECK (status IN ('pending','in_progress','submitted','approved','rejected'))
                  DEFAULT 'pending',
  deliverable_url TEXT,         -- Supabase Storage link
  submitted_at    TIMESTAMPTZ,
  approved_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
```

#### `reviews`
```sql
CREATE TABLE reviews (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    UUID REFERENCES projects(id) ON DELETE CASCADE,
  reviewer_id   UUID REFERENCES users(id),
  reviewee_id   UUID REFERENCES users(id),
  rating        INT CHECK (rating BETWEEN 1 AND 5) NOT NULL,
  comment       TEXT,
  reviewer_role TEXT CHECK (reviewer_role IN ('company', 'freelancer')) NOT NULL,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);
```

#### `disputes`
```sql
CREATE TABLE disputes (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   UUID REFERENCES projects(id) ON DELETE CASCADE,
  raised_by    UUID REFERENCES users(id),
  reason       TEXT NOT NULL,
  status       TEXT CHECK (status IN ('open','under_review','resolved','closed'))
               DEFAULT 'open',
  resolution   TEXT,
  resolved_by  UUID REFERENCES users(id),
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  resolved_at  TIMESTAMPTZ
);
```

### Row Level Security (RLS) — Key Policies

```sql
-- Freelancers can only update their own profile
ALTER TABLE freelancer_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Freelancer owns profile" ON freelancer_profiles
  USING (user_id = auth.uid());

-- Companies can only update their own profile
ALTER TABLE company_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Company owns profile" ON company_profiles
  USING (user_id = auth.uid());

-- Anyone can read open projects
CREATE POLICY "Public can view open projects" ON projects
  FOR SELECT USING (status = 'open');

-- Only companies can insert projects
CREATE POLICY "Companies post projects" ON projects
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM company_profiles WHERE user_id = auth.uid())
  );
```

---

## Project Structure

```
freelaunch/
├── server/
│   ├── index.js              # Entry point — Express app
│   ├── routes/
│   │   ├── auth.js           # Login / register
│   │   ├── projects.js       # CRUD for projects
│   │   ├── bids.js           # Bid submission & management
│   │   ├── milestones.js     # Milestone CRUD & status updates
│   │   ├── reviews.js        # Post & fetch reviews
│   │   ├── disputes.js       # Raise & resolve disputes
│   │   └── admin.js          # Admin-only routes
│   ├── middleware/
│   │   ├── auth.js           # JWT verification middleware
│   │   └── role.js           # Role-based access guard
│   └── supabase.js           # Supabase client initialization
│
├── public/
│   ├── index.html            # Landing page
│   ├── login.html            # Unified login (company / freelancer / admin)
│   ├── register.html         # Registration with role selection
│   │
│   ├── company/
│   │   ├── dashboard.html    # Company dashboard
│   │   ├── post-project.html # Post a new project
│   │   ├── bids.html         # View bids for a project
│   │   └── milestones.html   # Track project milestones
│   │
│   ├── freelancer/
│   │   ├── dashboard.html    # Freelancer dashboard
│   │   ├── profile.html      # Edit freelancer profile
│   │   ├── browse.html       # Browse open projects
│   │   ├── bid.html          # Submit a bid
│   │   └── milestones.html   # Submit milestone deliverables
│   │
│   ├── admin/
│   │   ├── dashboard.html    # Admin overview
│   │   ├── users.html        # User management
│   │   ├── disputes.html     # Dispute resolution
│   │   └── projects.html     # All projects monitor
│   │
│   ├── css/
│   │   ├── main.css          # Global styles
│   │   ├── company.css       # Company portal styles
│   │   ├── freelancer.css    # Freelancer portal styles
│   │   └── admin.css         # Admin panel styles
│   │
│   └── js/
│       ├── api.js            # Fetch wrapper for API calls
│       ├── auth.js           # Login / logout / token handling
│       ├── company.js        # Company-specific JS
│       ├── freelancer.js     # Freelancer-specific JS
│       └── admin.js          # Admin-specific JS
│
├── .env                      # Environment variables (never commit)
├── .env.example              # Template for env setup
├── package.json
└── README.md
```

---

## Modules

### Authentication & Roles

Three distinct login portals share a single login page with a **role selector toggle**:

- **Company** — email + password via Supabase Auth → redirects to `/company/dashboard.html`
- **Freelancer** — email + password via Supabase Auth → redirects to `/freelancer/dashboard.html`
- **Admin** — email + password (admin role enforced server-side) → redirects to `/admin/dashboard.html`

JWT tokens are stored in `localStorage` and sent as `Authorization: Bearer <token>` headers on every API call.

---

### Freelancer Profiles

Each freelancer has a public profile displaying:

- Full name, avatar, bio
- Skills (tag list)
- Hourly rate
- Portfolio URL
- Average rating + total reviews
- Active and completed project history

**Freelancers manage their own profile** from `/freelancer/profile.html`.

---

### Project Bidding

**Company side:**
1. Post a project with title, description, budget range, required skills, and deadline
2. View all received bids on a project
3. Accept one bid (automatically rejects others and sets project status to `in_progress`)
4. View the winning freelancer's profile

**Freelancer side:**
1. Browse all `open` projects with filters (skills, budget, deadline)
2. Submit a bid with: bid amount, cover letter, and estimated days
3. Track bid statuses: `pending` → `accepted` / `rejected`
4. Withdraw a pending bid at any time

---

### Milestone Tracking

Milestones are created by the **company** after a bid is accepted and are visible to both parties.

**Milestone lifecycle:**
```
pending → in_progress → submitted → approved
                                 ↘ rejected → in_progress (resubmit)
```

| Action | Who |
|---|---|
| Create milestones | Company |
| Mark milestone as in_progress | Freelancer |
| Submit deliverable (file/link) | Freelancer |
| Approve or reject submission | Company |
| View all milestone statuses | Both + Admin |

A visual **progress tracker** on both dashboards shows overall project completion percentage based on approved milestones.

---

### Reviews & Ratings

Reviews are unlocked only after a project reaches `completed` status.

- **Company reviews Freelancer** → stored against the freelancer's profile
- **Freelancer reviews Company** → stored against the company's profile
- Rating: 1–5 stars + optional written comment
- Average ratings are recalculated and stored on each profile after every new review
- Reviews are **one-time per project per party** (enforced by unique constraint)

---

### Admin Panel

The admin has elevated access to:

- **User Management** — view, suspend, or delete any user account
- **Project Monitor** — view all projects regardless of status
- **Dispute Resolution** — view disputes raised by either party, add a resolution note, and mark resolved
- **Reviews Moderation** — flag or remove abusive reviews
- **Dashboard Analytics** — total users, active projects, open disputes, revenue overview

Disputes can be raised by either a company or freelancer from their respective dashboards when there is a disagreement on milestone approval or payment.

---

## Getting Started

### Prerequisites

- Node.js v18+
- npm v9+
- A [Supabase](https://supabase.com) account (free tier works)

### Installation

```bash
# 1. Clone the repository
git clone https://github.com/your-username/freelaunch.git
cd freelaunch

# 2. Install dependencies
npm install

# 3. Copy environment template
cp .env.example .env

# 4. Fill in your Supabase credentials (see below)
nano .env

# 5. Start the server
npm run dev
```

The app will be live at `http://localhost:3000`

### Deploy to Vercel (Serverless)

This project is configured for Vercel serverless deployment:

- API routes are handled by `api/index.js`
- Static frontend pages are served from `public/`
- Rewrites are defined in `vercel.json`

Deploy steps:

```bash
# Install Vercel CLI (optional if not installed)
npm i -g vercel

# Login and link project
vercel login
vercel

# Add production environment variables in Vercel
vercel env add SUPABASE_URL
vercel env add SUPABASE_ANON_KEY
vercel env add SUPABASE_SERVICE_ROLE_KEY
vercel env add JWT_SECRET

# Deploy to production
vercel --prod
```

After deploying, set your Supabase Auth site URL to your Vercel domain.

---

## Environment Variables

Create a `.env` file in the root directory:

```env
# Supabase
SUPABASE_URL=https://your-project-id.supabase.co
SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# Server
PORT=3000
NODE_ENV=development

# JWT Secret (for session validation)
JWT_SECRET=your-super-secret-key-here

# Admin credentials (used only for first-time admin creation)
ADMIN_EMAIL=admin@freelaunch.com
ADMIN_PASSWORD=StrongAdminPassword123!
```

> ⚠️ **Never commit `.env` to version control.** The `.env.example` file is safe to commit.

---

## API Routes

### Auth
```
POST   /api/auth/register          Register a new user (company or freelancer)
POST   /api/auth/login             Login and receive JWT
POST   /api/auth/logout            Invalidate session
GET    /api/auth/me                Get current user info
```

### Projects
```
GET    /api/projects               List all open projects (with filters)
POST   /api/projects               Create a new project (company only)
GET    /api/projects/:id           Get project details
PUT    /api/projects/:id           Update project (company only)
DELETE /api/projects/:id           Delete project (company only)
```

### Bids
```
GET    /api/projects/:id/bids      Get all bids for a project (company only)
POST   /api/projects/:id/bids      Submit a bid (freelancer only)
PUT    /api/bids/:id/accept        Accept a bid (company only)
PUT    /api/bids/:id/reject        Reject a bid (company only)
DELETE /api/bids/:id               Withdraw a bid (freelancer only)
```

### Milestones
```
GET    /api/projects/:id/milestones         Get milestones for a project
POST   /api/projects/:id/milestones         Create milestone (company only)
PUT    /api/milestones/:id/submit           Freelancer submits deliverable
PUT    /api/milestones/:id/approve          Company approves milestone
PUT    /api/milestones/:id/reject           Company rejects milestone
```

### Reviews
```
POST   /api/reviews                Submit a review (after project completed)
GET    /api/freelancers/:id/reviews  Get reviews for a freelancer
GET    /api/companies/:id/reviews    Get reviews for a company
```

### Disputes
```
POST   /api/disputes               Raise a dispute
GET    /api/disputes               List all disputes (admin only)
PUT    /api/disputes/:id/resolve   Resolve a dispute (admin only)
```

### Admin
```
GET    /api/admin/users            List all users
PUT    /api/admin/users/:id/suspend  Suspend a user
DELETE /api/admin/users/:id        Delete a user
GET    /api/admin/stats            Dashboard statistics
```

---

## Supabase Setup

1. Create a new project at [supabase.com](https://supabase.com)
2. Go to **SQL Editor** and run the schema SQL from the [Database Schema](#database-schema-supabase) section above
3. Enable **Row Level Security** on all tables and apply the policies
4. Go to **Authentication → Settings** and configure:
   - Enable email confirmations (optional for dev)
   - Set site URL to `http://localhost:3000`
5. Go to **Storage** and create two buckets:
   - `avatars` (public) — for profile images
   - `deliverables` (private) — for milestone file uploads
6. Copy your **Project URL** and **API keys** into `.env`

---

## User Flows

### Company Flow
```
Register (company role)
  → Complete company profile
    → Post a project
      → Review incoming bids
        → Accept best bid
          → Create milestones
            → Review submitted deliverables
              → Approve milestones
                → Mark project complete
                  → Leave review for freelancer
```

### Freelancer Flow
```
Register (freelancer role)
  → Build profile (skills, rate, portfolio)
    → Browse open projects
      → Submit bid with cover letter
        → Bid accepted → project starts
          → Work on milestones
            → Submit deliverables
              → All milestones approved
                → Leave review for company
```

### Dispute Flow
```
Either party raises a dispute
  → Admin notified
    → Admin reviews both sides
      → Admin adds resolution note
        → Dispute marked resolved
          → Project status updated
```

---

## Screenshots / UI Notes

The UI features two distinct portal themes:

- **Company Portal** — Clean, corporate aesthetic with blue-grey tones, data tables, and project management dashboards
- **Freelancer Portal** — Warmer, creative aesthetic with profile cards, skill tags, and bid tracking boards
- **Admin Panel** — High-density dark dashboard with data tables, status badges, and quick-action controls

The login page includes a **role toggle** (Company / Freelancer) with distinct visual states. Admin login is accessible via a separate subtle link.

---

## Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/your-feature-name`
3. Commit your changes: `git commit -m "feat: add your feature"`
4. Push to your fork: `git push origin feature/your-feature-name`
5. Open a Pull Request

Please follow the existing code style and include comments for any complex logic.

---

## License

MIT License — see [LICENSE](LICENSE) for details.

---

<div align="center">

Built with ❤️ using Node.js + Supabase

</div>