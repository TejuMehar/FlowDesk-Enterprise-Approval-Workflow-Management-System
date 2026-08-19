/*
=========================================================================
  SEED SCRIPT   ->   run it with:   npm run seed
=========================================================================
  A brand new database is completely empty, so there is no user to log in
  with and no role to give anybody. This script fills the database with
  the data the application needs to start:

    1. the 4 system roles (Super Admin, Admin, Manager, Employee)
    2. two example departments
    3. the 8 starting request types          (Module 9)
    4. the single settings document          (Module 9)
    5. the first Super Admin account

  It is SAFE to run more than once: everything is created only if it does
  not exist yet.

  RUN IT AGAIN AFTER ADDING A PERMISSION. Step 1 refreshes the
  permissions of the four system roles, which is the only way a
  permission added in code reaches the roles already in the database.
  Until it is run, a brand new permission is held by nobody and its
  routes answer 403 to everybody - including the Super Admin.
=========================================================================
*/

import mongoose from "mongoose";
import dotenv from "dotenv";

import Role from "../model/roleModel.js";
import User from "../model/userModel.js";
import Department from "../model/departmentModel.js";
import RequestType from "../model/requestTypeModel.js";
import Settings from "../model/settingsModel.js";
import { DEFAULT_ROLES } from "../config/permissions.js";
import { DEFAULT_REQUEST_TYPES } from "../config/settingsConstants.js";

dotenv.config();

const seedDatabase = async () => {
  try {
    /* ---------------- connect ---------------- */
    await mongoose.connect(process.env.MONGO_URL);
    console.log("MongoDB connected successfully");
    console.log("--------------------------------------------------");

    /* ---------------- 1) the system roles ---------------- */
    console.log("Creating roles...");

    for (const roleData of DEFAULT_ROLES) {
      const existingRole = await Role.findOne({ name: roleData.name });

      if (existingRole) {
        /*
          The role already exists, so we only refresh its permissions.
          This is useful when you add a NEW permission to the project and
          want the Super Admin to receive it.
        */
        existingRole.permissions = roleData.permissions;
        existingRole.isSystem = true;
        await existingRole.save();

        console.log(`  updated : ${roleData.name}`);
      } else {
        await Role.create(roleData);
        console.log(`  created : ${roleData.name}`);
      }
    }

    /* ---------------- 2) example departments ---------------- */
    console.log("\nCreating departments...");

    const sampleDepartments = [
      {
        name: "Human Resources",
        code: "HR",
        description: "Hiring, payroll and employee welfare.",
      },
      {
        name: "Engineering",
        code: "ENG",
        description: "Builds and maintains the product.",
      },
    ];

    for (const departmentData of sampleDepartments) {
      const exists = await Department.findOne({ code: departmentData.code });

      if (exists) {
        console.log(`  skipped : ${departmentData.name} (already exists)`);
      } else {
        await Department.create(departmentData);
        console.log(`  created : ${departmentData.name}`);
      }
    }

    /* ---------------- 3) the request types (Module 9) ----------------
       Only a STARTING POINT. From here on the collection is the truth
       and an administrator owns it, so an existing type is left exactly
       as it is - a company that renamed "Laptop" to "Hardware" or
       switched "Budget" off must not have that undone by running the
       seed again.                                                    */
    console.log("\nCreating request types...");

    for (const [index, typeData] of DEFAULT_REQUEST_TYPES.entries()) {
      const exists = await RequestType.findOne({ name: typeData.name });

      if (exists) {
        console.log(`  skipped : ${typeData.name} (already exists)`);
      } else {
        await RequestType.create({ ...typeData, order: index, isActive: true });
        console.log(`  created : ${typeData.name}`);
      }
    }

    /* ---------------- 4) the settings document (Module 9) ----------------
       getSettings() creates the single row with its defaults if it is
       not there yet, and returns the existing one untouched if it is -
       so this line is safe to run over a configured installation.   */
    console.log("\nChecking system settings...");

    const settings = await Settings.getSettings();

    console.log(`  company  : ${settings.companyName}`);
    console.log(`  timezone : ${settings.timezone}`);

    /* ---------------- 5) the first Super Admin ---------------- */
    console.log("\nCreating the Super Admin account...");

    const superAdminRole = await Role.findOne({ name: "Super Admin" });

    const adminEmail = (process.env.ADMIN_EMAIL || "admin@flowdesk.com")
      .toLowerCase()
      .trim();
    const adminPassword = process.env.ADMIN_PASSWORD || "Admin@12345";

    const existingAdmin = await User.findOne({ email: adminEmail });

    if (existingAdmin) {
      console.log(`  skipped : ${adminEmail} already exists`);
    } else {
      await User.create({
        firstName: "Super",
        lastName: "Admin",
        email: adminEmail,
        password: adminPassword, // the model hashes it automatically
        role: superAdminRole._id,
        designation: "System Administrator",
        isActive: true,
        isEmailVerified: true, // the first admin does not need to verify
      });

      console.log(`  created : ${adminEmail}`);
    }

    /* ---------------- done ---------------- */
    console.log("\n--------------------------------------------------");
    console.log("Seeding finished. You can now login with:");
    console.log(`  email    : ${adminEmail}`);
    console.log(`  password : ${adminPassword}`);
    console.log("--------------------------------------------------\n");

    // close the connection so the script stops instead of hanging
    await mongoose.disconnect();
    process.exit(0);
  } catch (error) {
    console.error("Seed Error", error);
    await mongoose.disconnect();
    process.exit(1);
  }
};

seedDatabase();
