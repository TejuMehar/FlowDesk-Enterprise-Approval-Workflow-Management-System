/*
=========================================================================
  FLOWDESK BACKEND - MAIN ENTRY FILE
=========================================================================
  This is the file node runs first ( npm run dev ).

  What happens here, in order:
    1. read the .env file
    2. create the express app
    3. add the global middleware (security, cors, json, cookies, static)
    4. connect every route file
    5. add the "not found" and "error" handlers
    6. connect to MongoDB, start listening, and arrange to stop cleanly
=========================================================================
*/

import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import cookieParser from "cookie-parser";
import multer from "multer";
import mongoose from "mongoose";

import connectDB from "./config/database.js";
import authRouter from "./routes/authRoute.js";
import userRouter from "./routes/userRoute.js";
import roleRouter from "./routes/roleRoute.js";
import departmentRouter from "./routes/departmentRoute.js";
import requestRouter from "./routes/requestRoute.js";
import workflowRouter from "./routes/workflowRoute.js";
import approvalRouter from "./routes/approvalRoute.js";
import dashboardRouter from "./routes/dashboardRoute.js";
import settingsRouter from "./routes/settingsRoute.js";
import notificationRouter from "./routes/notificationRoute.js";
import commentRouter from "./routes/commentRoute.js";
import auditRouter from "./routes/auditRoute.js";
import reportRouter from "./routes/reportRoute.js";
import searchRouter from "./routes/searchRoute.js";
import requestTypeRouter from "./routes/requestTypeRoute.js";
import fileRouter from "./routes/fileRoute.js";
import attendanceRouter from "./routes/attendanceRoute.js";
import salaryRouter from "./routes/salaryRoute.js";
import { startReminderEngine, stopReminderEngine } from "./config/reminderEngine.js";
import { securityHeaders, sanitizeRequest } from "./middleware/security.js";
import { globalLimiter } from "./middleware/rateLimit.js";
import { ATTACHMENT_RULES } from "./config/fileConstants.js";
import { formatFileSize } from "./config/fileService.js";

// loads every line of the .env file into process.env
dotenv.config();

const app = express();
const port = process.env.PORT || 8000;
const isProduction = process.env.NODE_ENV === "production";

/* =====================================================================
   MODULE 10 - CHECK THE ENVIRONMENT BEFORE DOING ANYTHING
   ---------------------------------------------------------------------
   A missing MONGO_URL used to show up as a connection error, and a
   missing JWT_SECRET showed up far worse: jsonwebtoken would throw on
   the first login, in production, an hour after the deploy.

   Failing HERE, loudly, at startup, is the whole idea. A deployment
   that cannot work should never reach the point of accepting traffic -
   a health check that goes red immediately is a much better Monday
   morning than an application that looks fine and cannot log anybody in.
   ===================================================================== */
const REQUIRED_ENV = ["MONGO_URL", "JWT_SECRET", "JWT_REFRESH_SECRET"];

const missingEnv = REQUIRED_ENV.filter((name) => !process.env[name]);

if (missingEnv.length > 0) {
  console.error(
    `Cannot start: these are missing from .env -> ${missingEnv.join(", ")}`
  );
  console.error("Copy .env.example to .env and fill it in.");
  process.exit(1);
}

/*
  The two secrets must not be the SAME string. If they were, a refresh
  token would verify as an access token, and the 15 minute limit on the
  access token would quietly become 7 days.
*/
if (process.env.JWT_SECRET === process.env.JWT_REFRESH_SECRET) {
  console.error(
    "Cannot start: JWT_SECRET and JWT_REFRESH_SECRET must be DIFFERENT values"
  );
  process.exit(1);
}

/* =====================================================================
   GLOBAL MIDDLEWARE
   ---------------------------------------------------------------------
   These run for EVERY request, before any route. The ORDER below is
   the order they run in, and it is not arbitrary - see the notes.
   ===================================================================== */

/*
  MODULE 10 - "trust proxy".

  In production FlowDesk sits behind somebody else's web server (Render,
  Railway, Nginx). Every request then arrives from THAT machine, so
  without this line:

    req.ip      is the proxy's address, the same for every user, which
                would make the rate limiter count the whole world as one
                caller and lock everybody out together
    req.secure  is false even over https, so the "secure" flag on our
                cookies would never be set

  The value 1 means "there is exactly ONE proxy in front of me, believe
  the last entry it added to X-Forwarded-For". It is a number and not
  `true` on purpose: `true` trusts the whole header, which anybody can
  write, so a caller could invent an address and dodge the limiter.
*/
if (isProduction) {
  app.set("trust proxy", 1);
}

// the headers that tell a browser what it may do with our answers
app.use(securityHeaders);

/*
  CORS = Cross Origin Resource Sharing.
  The React app runs on http://localhost:5173 and the backend on
  http://localhost:8000. Those are two different "origins", and browsers
  block that by default. This tells the browser our frontend is allowed.

  credentials: true is REQUIRED, otherwise the browser would refuse to
  send our httpOnly cookies.

  MODULE 10 MADE IT A LIST rather than a single address, because a real
  deployment has more than one legitimate frontend: the production site,
  the preview build a reviewer is looking at, and localhost for whoever
  is debugging against the live API. Set CLIENT_URLS to a comma
  separated list; CLIENT_URL still works on its own for one address.

  A request with NO Origin header (curl, Postman, a health check, a
  server calling us) is allowed through - the header is something
  BROWSERS add, and CORS is a rule browsers enforce on each other. It is
  not, and has never been, a way to keep programs out; that is what
  isAuth is for.
*/
const allowedOrigins = (
  process.env.CLIENT_URLS ||
  process.env.CLIENT_URL ||
  "http://localhost:5173"
)
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      return callback(new Error(`This origin is not allowed: ${origin}`));
    },
    credentials: true,
    /*
      The rate limit headers are not on the default list a browser lets
      JavaScript read, so without this the React app can see the 429 but
      not how long to wait.
    */
    exposedHeaders: ["Retry-After", "X-RateLimit-Remaining", "X-RateLimit-Reset"],
  })
);

/*
  Reads a JSON body and puts it in req.body.

  The 5mb limit is itself a security setting: without one, a single
  request could hand us a body big enough to fill the server's memory.
  Files do not go through here - they are multipart, and multer has its
  own limits (config/fileConstants.js).
*/
app.use(express.json({ limit: "5mb" }));

// reads a normal HTML form body (key=value&key=value)
app.use(express.urlencoded({ extended: true, limit: "5mb" }));

// reads the cookies of the request and puts them in req.cookies
app.use(cookieParser());

/*
  MODULE 10 - strip mongodb operators out of everything that arrived.

  It runs AFTER the body parsers, because it cleans what they produced,
  and BEFORE every route, because a controller that has to remember to
  sanitise is a controller that will one day forget. See the worked
  example at the top of middleware/security.js.
*/
app.use(sanitizeRequest);

/*
  MODULE 10 - THE ATTACHMENT FOLDER IS NO LONGER PUBLIC.

  This block must sit ABOVE express.static, because express runs
  middleware in order and the first one to answer wins.

  Until now every file under public/uploads was served to anybody who
  asked for its URL - including the medical certificates and invoices
  employees attach to requests. Those are now served by
  routes/fileRoute.js, which checks who is asking. This closes the old
  door, and answers 404 rather than 403 so the folder does not advertise
  that there is something behind it.

  PROFILE PHOTOS AND THE COMPANY LOGO STAY PUBLIC, one line below. A
  photo is drawn in the navbar of every page and the logo is on the
  login screen before anybody has logged in - see the note in
  config/fileConstants.js.
*/
app.use("/uploads/requests", (req, res) => {
  return res.status(404).json({
    message:
      "Request attachments are not public. Use GET /api/file/request/:requestId/:attachmentId",
  });
});

app.use(
  "/uploads",
  express.static("public/uploads", {
    /*
      A photo keeps its random name for as long as it exists (a new
      upload gets a new name), so a browser may keep it for a week
      instead of asking again on every page.
    */
    maxAge: isProduction ? "7d" : 0,
    // do not serve dotfiles, and do not fall through to the 404 handler
    dotfiles: "ignore",
  })
);

/* =====================================================================
   ROUTES
   ---------------------------------------------------------------------
   Each router file handles one part of the application.

   globalLimiter is mounted on /api rather than on the app, so it counts
   real API calls and not the static photos a single page view fetches
   twenty of.
   ===================================================================== */

app.use("/api", globalLimiter);

app.use("/api/auth", authRouter);
app.use("/api/user", userRouter);
app.use("/api/role", roleRouter);
app.use("/api/department", departmentRouter);
app.use("/api/request", requestRouter);
app.use("/api/workflow", workflowRouter);
app.use("/api/approval", approvalRouter);
app.use("/api/dashboard", dashboardRouter);
app.use("/api/settings", settingsRouter);
app.use("/api/notification", notificationRouter);
app.use("/api/comment", commentRouter);
app.use("/api/audit", auditRouter);
app.use("/api/report", reportRouter);
app.use("/api/search", searchRouter);
app.use("/api/request-type", requestTypeRouter);
app.use("/api/file", fileRouter);
app.use("/api/attendance", attendanceRouter);
app.use("/api/salary", salaryRouter);

// a simple health check, useful to test that the server is alive
app.get("/", (req, res) => {
  return res.status(200).json({
    message: "FlowDesk API is running",
    modules: [
      "Module 1 - Authentication & User Management",
      "Module 2 - Request Management",
      "Module 3 - Workflow Builder",
      "Module 4 - Approval Engine",
      "Module 5 - Dashboard & Analytics",
      "Module 6 - Notification & Communication",
      "Module 7 - Audit Logs & Activity Tracking",
      "Module 8 - Reports & Search",
      "Module 9 - System Configuration",
      "Module 10 - Enterprise Features & Deployment",
      "Module 11 - Attendance Management",
      "Module 12 - Payroll & Salary",
    ],
  });
});

/* =====================================================================
   MODULE 10 - THE REAL HEALTH CHECK
   ---------------------------------------------------------------------
   GET /api/health

   The "/" route above says the process is running. That is not the
   question a hosting platform asks. Render, Railway and every uptime
   monitor want to know "should traffic be sent here?", and a node
   process that is up but cannot reach MongoDB should answer NO - it
   will 500 on every single request.

   So this one reports the DATABASE state and answers 503 when it is
   not connected, which is what makes a platform hold traffic back or
   restart the instance instead of serving errors to employees.

   It is deliberately outside the auth check (a monitor has no login)
   and deliberately says almost nothing: up, database, uptime, version.
   No environment values, no counts, no addresses - a health endpoint is
   a public endpoint, and public endpoints have been used to enumerate
   an application more than once.
   ===================================================================== */
app.get("/api/health", (req, res) => {
  /*
    mongoose.connection.readyState:
      0 disconnected   1 connected   2 connecting   3 disconnecting
  */
  const isDatabaseUp = mongoose.connection.readyState === 1;

  return res.status(isDatabaseUp ? 200 : 503).json({
    status: isDatabaseUp ? "ok" : "degraded",
    database: isDatabaseUp ? "connected" : "disconnected",
    uptimeSeconds: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
  });
});

/* =====================================================================
   404 HANDLER
   ---------------------------------------------------------------------
   If no route above matched the URL, we land here.
   "*" means "any address".
   ===================================================================== */
app.use("*", (req, res) => {
  return res
    .status(404)
    .json({ message: `Route ${req.originalUrl} was not found` });
});

/* =====================================================================
   GLOBAL ERROR HANDLER
   ---------------------------------------------------------------------
   An express error handler is recognised by having FOUR arguments
   (err, req, res, next).

   Our controllers already catch their own errors, so this is a safety
   net. It mainly catches multer upload errors (file too big / wrong
   type) and CORS refusals, which both happen BEFORE the controller runs.
   ===================================================================== */
app.use((err, req, res, next) => {
  // ---- upload errors from multer ----
  if (err instanceof multer.MulterError) {
    if (err.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({
        message: `That file is too large. The limit is ${formatFileSize(
          ATTACHMENT_RULES.maxBytes
        )} per file.`,
      });
    }

    if (err.code === "LIMIT_FILE_COUNT" || err.code === "LIMIT_UNEXPECTED_FILE") {
      return res.status(400).json({
        message: `You can upload at most ${ATTACHMENT_RULES.maxFiles} files at a time.`,
      });
    }

    return res.status(400).json({ message: `Upload Error ${err.message}` });
  }

  // ---- a body that was not valid JSON ----
  if (err instanceof SyntaxError && "body" in err) {
    return res.status(400).json({ message: "That request body is not valid JSON" });
  }

  // ---- a body larger than the 5mb limit set above ----
  if (err.type === "entity.too.large") {
    return res.status(413).json({ message: "That request is too large" });
  }

  // ---- our own errors: the file filter, and the CORS check ----
  if (err && err.message) {
    return res.status(400).json({ message: err.message });
  }

  /*
    MODULE 10 - anything that reaches here is a BUG, and the caller is
    told so in four words.

    The full error goes to the server log, where the developer can read
    it. It does not go in the response: a stack trace names our files,
    our folder layout, our package versions and sometimes the query that
    failed - a free map of the application for whoever provoked it.
  */
  console.error("Unexpected Error", err);
  return res.status(500).json({ message: "Something went wrong on the server" });
});

/* =====================================================================
   START THE SERVER
   ---------------------------------------------------------------------
   MODULE 10 CHANGED THE ORDER HERE: the database is connected BEFORE
   the port is opened.

   It used to be the other way round, which meant that during the second
   or two it took Atlas to answer, the server was already accepting
   requests it could only fail. It is a small window on a laptop and a
   real one on a cold start in production, where a platform sends its
   first health check the moment the port opens.
   ===================================================================== */
const startServer = async () => {
  await connectDB();

  const server = app.listen(port, () => {
    console.log(`Server is running on http://localhost:${port}`);

    /*
      MODULE 6 - THE REMINDER ENGINE.

      The only part of FlowDesk that does something without a user
      clicking: every half hour it nudges approvers who are sitting on a
      request, escalates the ones that have been stuck for days, and once
      a day sends everybody a summary of what is on their plate.

      It is started here, AFTER dotenv.config() has run, because that is
      where it reads its timings from (see getReminderConfig()). Set
      REMINDERS_ENABLED=false in .env to switch it off.
    */
    startReminderEngine();
  });

  /* ===================================================================
     MODULE 10 - SHUTTING DOWN ON PURPOSE
     -------------------------------------------------------------------
     Every hosting platform stops an application the same way: it sends
     SIGTERM and waits a few seconds before killing the process.

     Without a handler, node dies instantly on that signal - in the
     middle of whatever it was doing. A request being answered is cut
     off; worse, an approval that had written its Approval document but
     not yet its Request is left half finished, and FlowDesk has no
     transactions to undo it (see the note in submitRequest()).

     So we do it in order: stop taking NEW connections, let the ones in
     flight finish, stop the reminder engine, close MongoDB, exit.

     THE 10 SECOND TIMER IS THE IMPORTANT PART. If a request hangs, the
     graceful shutdown hangs with it, and the platform's own kill would
     land right back where we started. Ten seconds is longer than any
     honest request in this application and shorter than every platform's
     patience.
     =================================================================== */
  const shutdown = async (signal) => {
    console.log(`${signal} received - shutting down`);

    const killTimer = setTimeout(() => {
      console.error("Shutdown took too long - forcing exit");
      process.exit(1);
    }, 10 * 1000);

    // do not let the timer itself keep the process alive
    killTimer.unref();

    try {
      // 1) stop accepting new connections, wait for the current ones
      await new Promise((resolve) => server.close(resolve));

      // 2) stop the only thing that runs on its own (Module 6)
      stopReminderEngine();

      // 3) close the database connection cleanly
      await mongoose.connection.close();

      console.log("Shutdown complete");
      process.exit(0);
    } catch (error) {
      console.error("Shutdown Error", error);
      process.exit(1);
    }
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT")); // Ctrl+C

  /* ===================================================================
     THE TWO CRASHES NODE WOULD OTHERWISE SWALLOW
     -------------------------------------------------------------------
     An error thrown outside every try/catch - a bug in a callback, a
     promise nobody awaited - leaves the process in a state nobody
     designed: some of it works, some of it does not, and it stays that
     way until somebody notices.

     Logging and EXITING is the safer answer, because every platform
     restarts a process that exits, and a fresh process is a known
     state. The log line is what makes it debuggable rather than
     mysterious.
     =================================================================== */
  process.on("unhandledRejection", (reason) => {
    console.error("Unhandled promise rejection:", reason);
    shutdown("unhandledRejection");
  });

  process.on("uncaughtException", (error) => {
    console.error("Uncaught exception:", error);
    shutdown("uncaughtException");
  });
};

startServer();
