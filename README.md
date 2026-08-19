# FlowDesk — Module 1: Authentication & User Management

A full-stack employee management system.
**Backend:** Node.js + Express + MongoDB (Mongoose)
**Frontend:** React (Vite) + Tailwind CSS + Redux Toolkit

---

## 1. What is built in this module

### Authentication
| Feature | Endpoint |
|---|---|
| Login | `POST /api/auth/login` |
| Logout | `POST /api/auth/logout` |
| JWT authentication | access token in an httpOnly cookie (15 min) |
| Refresh token | `POST /api/auth/refresh` (7 days, rotated on every use) |
| Forgot password | `POST /api/auth/forgot-password` |
| Reset password | `POST /api/auth/reset-password/:token` |
| Email verification | `POST /api/auth/verify-email/:token` |
| Resend verification | `POST /api/auth/resend-verify-email` |
| Change password | `POST /api/auth/change-password` |
| Who am I | `GET /api/auth/me` |

### User Management
| Feature | Endpoint | Permission |
|---|---|---|
| Create user | `POST /api/user/create` | `user:create` |
| List users (search, filter, pagination) | `GET /api/user/all` | `user:read` |
| Get one user | `GET /api/user/:id` | `user:read` |
| Update user | `PUT /api/user/:id` | `user:update` |
| Delete user (soft delete) | `DELETE /api/user/:id` | `user:delete` |
| Activate / Deactivate | `PATCH /api/user/:id/status` | `user:status` |
| Assign role | `PATCH /api/user/:id/role` | `user:assign-role` |

### Employee Profile
| Feature | Endpoint |
|---|---|
| My profile | `GET /api/user/profile/me` |
| Update my profile | `PUT /api/user/profile/me` |
| Upload profile photo | `POST /api/user/profile/photo` |

### Role Management (RBAC)
| Feature | Endpoint | Permission |
|---|---|---|
| All permissions | `GET /api/role/permissions` | `role:read` |
| Create role | `POST /api/role/create` | `role:create` |
| List roles | `GET /api/role/all` | `role:read` |
| Get one role | `GET /api/role/:id` | `role:read` |
| Update role | `PUT /api/role/:id` | `role:update` |
| Delete role | `DELETE /api/role/:id` | `role:delete` |

### Department Management
| Feature | Endpoint | Permission |
|---|---|---|
| Create department | `POST /api/department/create` | `department:create` |
| List departments | `GET /api/department/all` | `department:read` |
| Get one department + its staff | `GET /api/department/:id` | `department:read` |
| Update department | `PUT /api/department/:id` | `department:update` |
| Delete department | `DELETE /api/department/:id` | `department:delete` |
| Assign manager | `PATCH /api/department/:id/manager` | `department:assign-manager` |

### Role-Based Navigation
The sidebar only shows the menu items the logged-in user is allowed to open,
and `<PermissionRoute>` blocks the URL if it is typed by hand.

---

## 2. Folder structure (MVC)

```
FlowDesk/
│
├── backend/
│   ├── index.js                 ← entry file: middleware, routes, server start
│   │
│   ├── config/                  ← setup + helpers
│   │   ├── database.js          MongoDB connection
│   │   ├── token.js             JWT + random tokens + cookie options
│   │   ├── nodemailer.js        the 3 emails we send
│   │   ├── permissions.js       every permission + the 4 default roles
│   │   └── validation.js        email / password checks
│   │
│   ├── model/                   ← M — the shape of the data
│   │   ├── userModel.js
│   │   ├── roleModel.js
│   │   ├── departmentModel.js
│   │   └── refreshTokenModel.js
│   │
│   ├── controllers/             ← C — the logic
│   │   ├── authController.js
│   │   ├── userController.js
│   │   ├── roleController.js
│   │   └── departmentController.js
│   │
│   ├── routes/                  ← which URL runs which controller
│   │   ├── authRoute.js
│   │   ├── userRoute.js
│   │   ├── roleRoute.js
│   │   └── departmentRoute.js
│   │
│   ├── middleware/              ← runs before the controller
│   │   ├── isAuth.js            "who are you?"
│   │   ├── checkPermission.js   "are you allowed?"
│   │   └── multer.js            file uploads
│   │
│   ├── seed/seed.js             creates roles + first admin
│   └── public/uploads/          the uploaded profile photos
│
└── frontend/                    ← V — what the user sees
    └── src/
        ├── App.jsx              all the routes
        ├── main.jsx             entry file
        ├── pages/               Login, Dashboard, Users, Roles, ...
        ├── components/          Layout, Sidebar, Navbar, Modal, guards
        ├── redux/               store.js + userSlice.js
        ├── CustomHooks/         getCurrentUser.js
        └── utils/               api.js (axios + auto refresh), permissions.js
```

---

## 3. How to run it

### Backend

```bash
cd backend
npm install
```

Copy `.env.example` to `.env` and fill it in:

```env
PORT=8000
NODE_ENV=development
MONGO_URL=<your MongoDB Atlas connection string>/flowdesk
JWT_SECRET=<long random string>
JWT_REFRESH_SECRET=<a different long random string>
CLIENT_URL=http://localhost:5173
USER_EMAIL=<gmail address>            # optional
USER_PASSWORD=<gmail app password>    # optional
ADMIN_EMAIL=admin@flowdesk.com
ADMIN_PASSWORD=Admin@12345
```

Generate a secret with:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Create the roles and the first admin, then start the server:

```bash
npm run seed
npm run dev
```

The API runs on `http://localhost:8000`.

### Frontend

```bash
cd frontend
npm install
```

Copy `.env.example` to `.env`:

```env
VITE_SERVER_URL=http://localhost:8000
```

```bash
npm run dev
```

The app opens on `http://localhost:5173`.

### First login

```
email    : admin@flowdesk.com
password : Admin@12345
```
(or whatever you put in `ADMIN_EMAIL` / `ADMIN_PASSWORD` before running the seed)

---

## 4. The four default roles

| Role | Permissions |
|---|---|
| **Super Admin** | everything (15 permissions) — always keeps all of them |
| **Admin** | all user + department permissions, can only *read* roles |
| **Manager** | read/update users, read departments |
| **Employee** | none — can only manage their own profile |

All four are **system roles**: they cannot be deleted, and they cannot be renamed.

---

## 5. How the login actually works

1. **Login** → the backend checks the password with bcrypt and sends back two cookies:
   * `accessToken` — 15 minutes, sent with every request
   * `refreshToken` — 7 days, only used to get a new access token

   Both are `httpOnly`, so JavaScript in the browser cannot read them (protects against XSS).

2. **Every request** → `isAuth` opens the access token, loads the user fresh from
   MongoDB, and checks the account is not deleted, not deactivated, and that the
   password was not changed after the token was issued.

3. **Access token expires** → the axios interceptor in `utils/api.js` quietly calls
   `/api/auth/refresh` and repeats the failed request. The user notices nothing.

4. **Refresh token rotation** → every refresh revokes the old token and issues a new
   one. If an old (already revoked) token is used again, *all* of that user's tokens
   are revoked, because it probably means the token was stolen.

5. **Logout / change password / deactivate / delete** → the refresh tokens are revoked
   in the database, so those sessions die immediately.

---

## 6. Email

Emails are sent with nodemailer through Gmail.

If `USER_EMAIL` / `USER_PASSWORD` are **empty** the app still works — the verification
and reset links are printed in the backend terminal instead:

```
---------------- EMAIL (console mode) ----------------
To      : riya@flowdesk.com
Subject : FlowDesk - Verify your email address
Link    : http://localhost:5173/verify-email/eb2ee83a...
------------------------------------------------------
```

For a real Gmail account you must use an **App Password**
(Google Account → Security → 2-Step Verification → App passwords), not your normal password.

---

## 7. Security notes

* Passwords are hashed with **bcrypt** (10 salt rounds) inside a `pre("save")` hook.
* Email-verification and password-reset tokens are stored **hashed (SHA-256)**, never in plain text — and each one works only once.
* Refresh tokens are stored hashed too, with a TTL index so MongoDB deletes them automatically.
* Login never says whether an email exists — a wrong email and a wrong password give the same message.
* "Forgot password" always gives the same neutral answer for the same reason.
* An admin cannot delete, deactivate, or change the role of **their own** account.
* System roles cannot be deleted; the Super Admin role cannot lose permissions.
* A role still used by a user cannot be deleted, and a department with employees cannot be deleted.
* Hiding a button in React is **not** security — every route is checked again by `checkPermission` on the backend.

---

# Module 3 — Workflow Builder

Lets an Admin design the **approval route** a request travels before it is
finished. For a purchase request that route might be:

```
Employee  →  Manager  →  Finance  →  Director  →  Completed
```

`Employee` (whoever raised the request) and `Completed` are always the first and
last step, so a workflow only stores the middle part — the **stages**.

> This module **designs** the route. Actually sending a request down it
> (Approve / Reject buttons, the request moving from stage to stage) belongs to
> a later module, the same way Module 2 left approve/reject for later.

## 1. Endpoints

| Feature | Endpoint | Permission |
|---|---|---|
| Create workflow | `POST /api/workflow/create` | `workflow:create` |
| List workflows (search + filters) | `GET /api/workflow/all` | `workflow:read` |
| Get one workflow | `GET /api/workflow/:id` | `workflow:read` |
| Rename / re-type workflow | `PUT /api/workflow/:id` | `workflow:update` |
| Delete workflow (soft delete) | `DELETE /api/workflow/:id` | `workflow:delete` |
| **Save all stages** (the builder's Save button) | `PUT /api/workflow/:id/stages` | `workflow:update` |
| Activate / Deactivate | `PATCH /api/workflow/:id/active` | `workflow:update` |

The four new permissions go to **Super Admin** and **Admin** only — designing
approval routes is an admin job. Run `npm run seed` again after pulling this
module, otherwise the existing roles will not have them and the Workflows menu
stays hidden.

## 2. How a workflow is shaped

```
Workflow
├── name          "Purchase Approval"
├── requestType   "Purchase"      ← one of the 8 request types
├── isActive      true / false
└── stages[]      the ordered chain

    stage
    ├── order          1, 2, 3 ...   (set by the backend, never sent by the UI)
    ├── name           "Finance Review"
    ├── approverType   RequesterManager | Role | Department | User
    ├── approvalRule   AnyOne | Everyone | Majority
    ├── escalation     what happens when nobody answers in time
    └── autoApproval   conditions that skip the stage completely
```

**Who approves a stage** — `approverType` picks one of four ways:

| Type | Means |
|---|---|
| `RequesterManager` | the manager of the department the requester belongs to — works for any employee, so nobody has to be named |
| `Role` | anybody holding that role, e.g. *Director* |
| `Department` | that department's manager, e.g. *Finance* |
| `User` | one exact named employee |

**Approval rule** only matters when a stage can have more than one approver
(for example "anyone with the Director role"): `AnyOne` lets the first answer
decide, `Everyone` needs them all, `Majority` needs more than half.

**Escalation rule** — after *N* hours with no answer, the stage can *Notify*
somebody, *AutoApprove* itself, or *Reassign* to somebody else.

**Auto approval rule** — a stage is skipped entirely when every condition is
true, e.g. `amount <= 5000`. Conditions read fields that already exist on a
request (`amount`, `priority`, `category`).

## 3. Two rules worth knowing

1. **One active workflow per request type.** Switching a workflow on
   automatically switches off any other workflow for the same type, so a
   request can never match two routes. An active workflow also cannot be
   deleted or moved to another request type — switch it off first.

2. **A workflow starts empty and inactive**, like a draft request. It cannot be
   activated until it has at least one stage, so a half-finished route never
   catches a real request.

## 4. The builder screen

`/workflows` lists the workflows; **Open Builder** goes to `/workflows/:id`.

The builder draws the whole chain top to bottom, with fixed *Employee* and
*Completed* cards at the ends so the picture matches the diagram above. Each
stage is a collapsible card with ▲ / ▼ buttons to move it.

Everything you do there only changes the page — **nothing is saved until you
press "Save Workflow"**, which sends the whole stage list in one call. Because
the backend numbers the stages from their position in that list, moving a stage
up or down needs no extra code on either side.
