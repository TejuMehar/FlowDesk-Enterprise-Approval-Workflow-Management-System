/*
=========================================================================
  SEED: Attendance                (Module 11 - Attendance Management)
=========================================================================
  Gives the existing roles the four new attendance permissions, and
  creates the company-wide working pattern if there is not one yet.

  WHY THIS EXISTS INSTEAD OF "JUST RUN npm run seed"
  --------------------------------------------------
  seed.js REPLACES a system role's permission array with the one in
  config/permissions.js:

      existingRole.permissions = roleData.permissions;

  That is exactly right on a fresh database and exactly wrong on a live
  one. Any permission an admin has added to a role by hand since the
  last seed - or any they have deliberately taken away - is silently
  thrown out and reset to whatever the code says.

  This script only ever ADDS, and only the four permissions Module 11
  introduced. Running it twice does nothing the second time.

      npm run seed:attendance

  WHICH ROLE GETS WHAT
  --------------------
  The grants below mirror config/permissions.js and seed/seedDemo.js,
  and the reasoning for each one is written down there rather than
  repeated here. In one line each:

    Super Admin      everything
    Admin            everything - attendance is operational work
    Manager          correct + export, but NOT read-all: their own
                     department is unlocked by the data, not a grant
    HR Manager       everything - this is the role the module is for
    Director         read-all + export, and nothing that writes
    Finance Manager  nothing, on purpose
    Employee         nothing, on purpose - clocking in needs no
                     permission at all

  A ROLE THIS SCRIPT HAS NEVER HEARD OF IS LEFT ALONE. A custom role an
  admin built themselves is their business, and a seed script that
  guesses at one is a seed script that hands somebody a permission
  nobody chose to give them.
=========================================================================
*/

import mongoose from "mongoose";
import dotenv from "dotenv";

import Role from "../model/roleModel.js";
import AttendancePolicy from "../model/attendancePolicyModel.js";
import { PERMISSIONS } from "../config/permissions.js";
import { DEFAULT_ATTENDANCE_POLICY } from "../config/attendanceConstants.js";

dotenv.config();

const ALL = [
  PERMISSIONS.ATTENDANCE_READ_ALL,
  PERMISSIONS.ATTENDANCE_CORRECT,
  PERMISSIONS.ATTENDANCE_POLICY,
  PERMISSIONS.ATTENDANCE_EXPORT,
];

const GRANTS = {
  "Super Admin": ALL,
  Admin: ALL,
  "HR Manager": ALL,

  // their own department is unlocked by the data - see config/attendanceScope.js
  Manager: [PERMISSIONS.ATTENDANCE_CORRECT, PERMISSIONS.ATTENDANCE_EXPORT],

  // read-only seniority: sees everything, changes nothing
  Director: [PERMISSIONS.ATTENDANCE_READ_ALL, PERMISSIONS.ATTENDANCE_EXPORT],
};

const seedAttendance = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URL);
    console.log("MongoDB connected successfully");
    console.log("--------------------------------------------------");

    /* ---------------- 1) the permissions ---------------- */
    console.log("Granting attendance permissions...");

    for (const [roleName, permissions] of Object.entries(GRANTS)) {
      const role = await Role.findOne({ name: roleName });

      if (!role) {
        console.log(`  skipped : ${roleName} (no such role in this database)`);
        continue;
      }

      // only the ones that are really missing, so a second run is quiet
      const missing = permissions.filter(
        (permission) => !role.permissions.includes(permission)
      );

      if (missing.length === 0) {
        console.log(`  already : ${roleName}`);
        continue;
      }

      role.permissions = [...role.permissions, ...missing];
      await role.save();

      console.log(`  granted : ${roleName} -> ${missing.join(", ")}`);
    }

    /* ---------------- 2) the company working pattern ----------------
       Created so the Settings-style screen has something real to show
       and to edit. Every department inherits it until its own manager
       sets something different (config/attendancePolicyService.js), so
       this one row is the whole company's default shift. */
    console.log("\nCreating the company working pattern...");

    const existing = await AttendancePolicy.findOne({ department: null });

    if (existing) {
      console.log("  already : the company pattern exists, leaving it alone");
    } else {
      await AttendancePolicy.create({
        department: null,
        ...DEFAULT_ATTENDANCE_POLICY,
      });

      console.log(
        `  created : ${DEFAULT_ATTENDANCE_POLICY.shiftStartMinutes / 60}:00 - ${
          DEFAULT_ATTENDANCE_POLICY.shiftEndMinutes / 60
        }:00, ${DEFAULT_ATTENDANCE_POLICY.breakAllowanceMinutes} minutes of break`
      );
    }

    console.log("\n--------------------------------------------------");
    console.log("Attendance is ready.");
    console.log("Everybody can now clock in and out from the dashboard.");
    console.log("--------------------------------------------------");

    await mongoose.disconnect();
    process.exit(0);
  } catch (error) {
    console.error(`Attendance Seed Error ${error}`);
    process.exit(1);
  }
};

seedAttendance();
