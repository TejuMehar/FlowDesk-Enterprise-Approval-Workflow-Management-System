# FlowDesk — Deployment Guide

Module 10. Everything needed to put FlowDesk somewhere other than a laptop.

The stack is two separate deployments that talk over HTTPS:

```
   Browser
      │
      ├── https://flowdesk.vercel.app      ← the React app (static files)
      │
      └── https://flowdesk-api.onrender.com ← the Express API + MongoDB Atlas
```

They are separate because they are different kinds of thing. The frontend is a
folder of files that never changes between requests, so it belongs on a CDN. The
backend is a process that has to keep running, hold a database connection and
wake up every half hour for the reminder engine.

---

## 1. Before anything else: the checklist

| Thing | Why it matters |
|---|---|
| `JWT_SECRET` and `JWT_REFRESH_SECRET` are long, random, and **different** | The server refuses to start if either is missing or if they are equal — a shared secret would make a 7-day refresh token pass as a 15-minute access token |
| `NODE_ENV=production` on the API | Switches on `trust proxy` (so rate limiting sees real client IPs), HSTS, and browser caching of photos |
| `CLIENT_URLS` lists the real frontend address | Otherwise every request from the deployed React app is blocked by CORS |
| MongoDB Atlas network access allows the API host | Atlas blocks everything by default |
| The first Super Admin exists (`npm run seed`) | There is no self-registration in FlowDesk — someone has to be let in first |
| A **persistent disk** is attached, or you accept losing uploads | See section 5, this is the one that surprises people |

---

## 2. The database — MongoDB Atlas

The Module 10 brief lists *PostgreSQL*. FlowDesk is built on **MongoDB with
Mongoose**, and every model, aggregation and report in Modules 1–9 is written
against it. Moving to PostgreSQL is not a deployment task — it is a rewrite of
the data layer — so this guide deploys the database the application actually
has. Atlas is the managed, hosted, backed-up version of it, which is what the
brief is really asking for.

1. Create a free **M0** cluster (or M10+ for real use — M0 has no backups).
2. **Database Access** → create a user with a strong password.
3. **Network Access** → add the IP of the API host. Render and Railway do not
   publish a fixed egress IP on their free tiers, so `0.0.0.0/0` is the
   practical answer there; the database user's password is then the only thing
   protecting it, so make it long.
4. Copy the connection string into `MONGO_URL`, with `/flowdesk` before the `?`:

   ```
   mongodb+srv://user:pass@cluster.mongodb.net/flowdesk?retryWrites=true&w=majority
   ```

**Indexes** are created by Mongoose on startup from the `schema.index()` calls
in `backend/model/`. Nothing to run by hand. On a large existing collection the
first boot after a deploy may be slow while they build.

---

## 3. The backend — Render / Railway / any Node host

**Settings**

| | |
|---|---|
| Root directory | `backend` |
| Build command | `npm install` |
| Start command | `npm start` |
| Health check path | `/api/health` |

**Environment variables** — everything in `backend/.env.example`, plus:

```env
NODE_ENV=production
CLIENT_URLS=https://flowdesk.vercel.app
MONGO_URL=<the Atlas string>
JWT_SECRET=<48 random bytes>
JWT_REFRESH_SECRET=<48 different random bytes>
```

Generate a secret:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

**Seed the first admin, once.** Open the host's shell and run `npm run seed`.

> ⚠️ `npm run seed` **overwrites the four system roles** with the permission
> lists in `config/permissions.js`. That is what you want after adding a module
> (a new permission does not exist for anybody until it is re-seeded), and it is
> not what you want if an admin has hand-edited those roles in the UI — those
> edits are lost. Custom roles are untouched.

### What `/api/health` is for

`GET /api/health` answers `200 {"status":"ok"}` when MongoDB is connected and
**503** when it is not. Point the platform's health check at it rather than at
`/`. A node process that is up but cannot reach the database will fail every
single request, and the platform should hold traffic back or restart it rather
than serve errors to employees.

### Shutting down

The backend handles `SIGTERM`: it stops accepting new connections, lets the ones
in flight finish, stops the reminder engine and closes MongoDB — with a 10
second ceiling. This matters more than it sounds. Submitting a request writes an
Approval and then a Request, and FlowDesk has no transactions to undo half of
it; a process killed between the two leaves a request that cannot be edited or
decided.

---

## 4. The frontend — Vercel / Netlify

| | |
|---|---|
| Root directory | `frontend` |
| Build command | `npm run build` |
| Output directory | `dist` |

One environment variable:

```env
VITE_SERVER_URL=https://flowdesk-api.onrender.com
```

**Vite bakes environment variables in at build time.** Changing
`VITE_SERVER_URL` does nothing until the site is rebuilt — there is no runtime
config to edit.

**SPA rewrites.** React Router owns the URLs, so the host must send every
unknown path to `index.html` or a refresh on `/requests` returns 404. Vercel
does this by default for Vite projects. On Netlify, add `frontend/public/_redirects`:

```
/*  /index.html  200
```

---

## 5. Uploaded files — the ephemeral disk problem

**Read this one even if you skip the rest.**

FlowDesk stores uploads on the server's own disk, under `backend/public/uploads`.
On Render, Railway, Heroku and most container hosts, that disk is **ephemeral**:
it is wiped on every deploy, every restart and every crash. The database keeps
the attachment rows, so after a redeploy the files are listed in the UI and
every one of them answers:

> *This file is no longer on the server. It may have been removed during a
> deployment.*

That message exists because this happens, and a silent broken link is worse.

**Three ways out, in order of effort:**

1. **Attach a persistent disk** (Render "Disks", Railway volumes, a real VM).
   Mount it at `backend/public/uploads`. Nothing in the code changes. This is
   the right answer for a single-instance deployment, which is what FlowDesk is.
2. **Accept it** for a demo. Profile photos and attachments are cosmetic in a
   portfolio deployment; everything else survives in Atlas.
3. **Move to object storage** (Cloudinary, S3) — the Module 10 brief's
   suggestion, and the right answer the day FlowDesk runs on more than one
   instance, because a local disk cannot be shared between them.

### What a Cloudinary move would actually touch

Module 10 deliberately put every file operation behind one module, so this is a
contained change rather than a hunt:

| File | Change |
|---|---|
| `config/fileService.js` | `createUploader` writes to Cloudinary instead of disk; `resolveStoredFile` / `deleteStoredFile` call their API |
| `controllers/fileController.js` | streams from a URL instead of `fs.createReadStream` |
| everything else | **nothing** — the routes, the permission checks and the whole React side already talk in `requestId + attachmentId`, never in file paths |

That last row is the point. The React app has not known where a file physically
lives since Module 10 — it asks the API for attachment *n* of request *m* and
gets bytes back.

---

## 6. Email

Two ways to configure SMTP, and the second one wins:

1. **`.env`** — `USER_EMAIL` / `USER_PASSWORD` (a Gmail **App Password**, not the
   account password).
2. **The Settings page** — Module 9's SMTP block, saved in the database with the
   password encrypted (`config/secrets.js`).

If neither is set, FlowDesk still works: emails are printed to the server log
instead of sent, so verification and reset links can be copied from there. That
is fine for a demo and not fine in production — password reset stops being
self-service.

Use the **Send test email** button after configuring. It is rate limited (10 per
15 minutes) because it sends a real email to a typed address.

---

## 7. What Module 10 turned on, and what it costs you

| Feature | Effect you will notice |
|---|---|
| **Rate limiting** | 10 login attempts per 15 min per IP+email; 40 reports per 5 min; 30 uploads per 15 min; 300 API calls per minute overall. Counters are per-process and reset on restart — see the honest note in `middleware/rateLimit.js` |
| **Attachments are private** | `/uploads/requests/...` now answers 404. Old links in old emails are dead by design |
| **Security headers** | `nosniff`, `X-Frame-Options: DENY`, a strict CSP, HSTS in production |
| **Input sanitising** | `$`-prefixed and dotted keys are stripped from every body, query and param |
| **Startup validation** | The server refuses to boot with missing or duplicated secrets |
| **Lazy loading** | The first page load is much smaller; each page costs one small extra fetch the first time it is opened |

---

## 8. Roadmap — what is deliberately not built

The Module 10 brief lists these as *future ready*. They are listed here with
what each would actually touch, because "future ready" is a claim worth being
able to check:

| Idea | The real work |
|---|---|
| **Multi-tenant SaaS** | A `tenant` field on every model and every query, chosen from the subdomain. The permission layer is already central (`checkPermission`), so it would be the *queries* that change, not the auth |
| **AI suggestions** | "This looks like the 14 purchase requests that were auto-approved" — needs the request history that Modules 2–8 already store, and an approval-rule suggestion endpoint |
| **Mobile app** | The API is already token-based and CORS-configurable; `isAuth` already accepts `Authorization: Bearer` as well as the cookie, which is exactly what a mobile client needs |
| **Slack / Teams** | A fifth channel in `config/notificationService.js`, next to the bell and the email. That file already decides *who* is told what — only the *how* would be new |
| **Public REST API** | Long-lived API keys as a third thing `isAuth` accepts, plus a per-key rate limit tier |
| **Webhooks** | An outbound counterpart to the notification service, fired from the same places, with a signed payload and a retry queue |
