/*
=========================================================================
  SEED: Salary                    (Module 12 - Payroll & Salary)
=========================================================================
  Gives the existing roles the four new salary permissions, and - if
  asked - gives every employee who has none a starting salary structure
  so the module has something real to show.

      npm run seed:salary              just the permissions
      npm run seed:salary -- --demo    permissions + a structure for
                                       everybody who has none

  WHY THIS EXISTS INSTEAD OF "JUST RUN npm run seed"
  --------------------------------------------------
  seed.js REPLACES a system role's permission array with the one in
  config/permissions.js. That is right on a fresh database and wrong on
  a live one: any permission an admin has added or deliberately removed
  since the last seed is silently reset.

  This script only ever ADDS, and only the four permissions Module 12
  introduced. Running it twice does nothing the second time. The same
  contract seed/seedAttendance.js keeps.

  WHICH ROLE GETS WHAT
  --------------------
    Super Admin      everything
    Finance Manager  everything - this is the role the module is for
    HR Manager       everything except salary:process. HR decides what
                     somebody is paid; finance pays it, and keeping the
                     two apart is the point of splitting the two
                     permissions in the first place.
    Director         read-all + export, and nothing that writes
    Admin            NOTHING, on purpose - see config/permissions.js.
                     Managing accounts and departments never requires
                     knowing what anybody earns.
    Manager          nothing, and this is the module's sharpest line: a
                     department manager sees their team's attendance
                     because a department points at them, and sees
                     nothing at all of their pay.
    Employee         nothing - their own payslips need no permission.

  A ROLE THIS SCRIPT HAS NEVER HEARD OF IS LEFT ALONE. A custom role an
  admin built is their business, and a seed that guesses at one hands
  somebody a permission nobody chose to give them.
=========================================================================
*/

import mongoose from "mongoose";
import dotenv from "dotenv";

import Role from "../model/roleModel.js";
import User from "../model/userModel.js";
import SalaryStructure from "../model/salaryStructureModel.js";
import { PERMISSIONS } from "../config/permissions.js";
import { shiftMonthKey } from "../config/salaryConstants.js";

dotenv.config();

const ALL = [
  PERMISSIONS.SALARY_READ_ALL,
  PERMISSIONS.SALARY_STRUCTURE,
  PERMISSIONS.SALARY_PROCESS,
  PERMISSIONS.SALARY_EXPORT,
];

const GRANTS = {
  "Super Admin": ALL,
  "Finance Manager": ALL,

  // HR sets pay; finance pays it - see the note at the top
  "HR Manager": [
    PERMISSIONS.SALARY_READ_ALL,
    PERMISSIONS.SALARY_STRUCTURE,
    PERMISSIONS.SALARY_EXPORT,
  ],

  // read-only seniority: sees everything, changes nothing
  Director: [PERMISSIONS.SALARY_READ_ALL, PERMISSIONS.SALARY_EXPORT],
};

/* =====================================================================
   THE DEMO STRUCTURES
   ---------------------------------------------------------------------
   Only written with --demo, and only for people who have NONE. An
   existing structure is somebody's real pay, and a seed script that
   overwrote one would be rewriting a salary.

   The split below is the ordinary Indian shape - basic is half of the
   gross, HRA is 40% of basic - so the numbers on screen look like
   numbers somebody would recognise rather than like test data. PF is
   12% of basic, which is the statutory rate.

   The MONTHLY gross is derived from a seniority guess made off the
   designation, because a demo where every employee earns exactly the
   same makes every chart in the module a flat line.
   ===================================================================== */
const guessMonthlyGross = (designation = "") => {
  const title = designation.toLowerCase();

  if (title.includes("director") || title.includes("head") || title.includes("chief")) {
    return 250000;
  }

  if (title.includes("manager") || title.includes("lead")) {
    return 130000;
  }

  if (title.includes("senior")) {
    return 95000;
  }

  if (title.includes("assistant") || title.includes("junior") || title.includes("intern")) {
    return 42000;
  }

  return 65000;
};

const buildDemoStructure = (user, effectiveFrom) => {
  const gross = guessMonthlyGross(user.designation);

  const basic = Math.round(gross * 0.5);
  const hra = Math.round(basic * 0.4);
  const conveyance = 1600;
  const medical = 1250;

  // whatever is left over, so the components really do add up to the gross
  const special = Math.max(0, gross - basic - hra - conveyance - medical);

  const providentFund = Math.round(basic * 0.12);

  return {
    user: user._id,
    earnings: {
      basic,
      hra,
      conveyance,
      medical,
      specialAllowance: special,
      otherEarning: 0,
    },
    deductions: {
      providentFund,
      professionalTax: 200,
      // a rough slab: nothing under 5 lakh a year, 10% of the rest
      incomeTax: gross * 12 > 500000 ? Math.round(gross * 0.1) : 0,
      insurance: 500,
      otherDeduction: 0,
    },
    effectiveFrom,
    isActive: true,
  };
};

const seedSalary = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URL);
    console.log("MongoDB connected successfully");
    console.log("--------------------------------------------------");

    /* ---------------- 1) the permissions ---------------- */
    console.log("Granting salary permissions...");

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

    /* ---------------- 2) the demo structures ---------------- */
    if (process.argv.includes("--demo")) {
      console.log("\nCreating salary structures for employees who have none...");

      const users = await User.find({ isDeleted: false })
        .select("firstName lastName designation")
        .lean();

      const existing = await SalaryStructure.find({}).select("user").lean();
      const covered = new Set(existing.map((structure) => String(structure.user)));

      /*
        Effective from six months ago, so the first payroll run any
        demo does is not refused for a structure that starts in the
        future - see the effectiveFrom guard in
        config/salaryService.js.
      */
      const effectiveFrom = shiftMonthKey(
        new Date().toISOString().slice(0, 7),
        -6
      );

      const missing = users.filter((user) => !covered.has(String(user._id)));

      if (missing.length === 0) {
        console.log("  already : everybody has a salary structure");
      } else {
        await SalaryStructure.insertMany(
          missing.map((user) => buildDemoStructure(user, effectiveFrom))
        );

        console.log(`  created : ${missing.length} salary structure(s)`);
        console.log(`  covered : ${covered.size} were already set up`);
      }
    } else {
      console.log("\nNo structures were created.");
      console.log("Run  npm run seed:salary -- --demo  to give everybody one.");
    }

    console.log("\n--------------------------------------------------");
    console.log("Payroll is ready.");
    console.log("Finance can now run a month from the Payroll page,");
    console.log("and every employee has a My Salary page of their own.");
    console.log("--------------------------------------------------");

    await mongoose.disconnect();
    process.exit(0);
  } catch (error) {
    console.error(`Salary Seed Error ${error}`);
    process.exit(1);
  }
};

seedSalary();
