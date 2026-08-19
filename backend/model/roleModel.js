/*
=========================================================================
  MODEL: Role                                     ( the "M" of MVC )
=========================================================================
  A MODEL describes the shape of one collection (table) in MongoDB.
  It knows nothing about req / res - it only knows about data.

  A Role is a named bundle of permissions:
     { name: "Manager", permissions: ["user:read", "department:read"] }

  Every user points to exactly one Role.
=========================================================================
*/

import mongoose from "mongoose";
import { ALL_PERMISSIONS } from "../config/permissions.js";

const roleSchema = new mongoose.Schema(
  {
    // Role name, for example "Admin". Must be unique.
    name: {
      type: String,
      required: [true, "Role name is required"],
      unique: true,
      trim: true, // removes spaces before and after
      minlength: [2, "Role name must be at least 2 characters"],
      maxlength: [50, "Role name cannot be more than 50 characters"],
    },

    description: {
      type: String,
      trim: true,
      maxlength: [200, "Description cannot be more than 200 characters"],
      default: "",
    },

    /*
      The list of permission strings.
      "enum" tells MongoDB to REJECT any value that is not in our master
      list, so a typo like "user:crate" can never be saved.
    */
    permissions: {
      type: [String],
      enum: {
        values: ALL_PERMISSIONS,
        message: "{VALUE} is not a valid permission",
      },
      default: [],
    },

    /*
      System roles (Super Admin, Admin, Manager, Employee) are created by
      the seed script and can NEVER be deleted. This stops an admin from
      deleting the role they themselves are using.
    */
    isSystem: {
      type: Boolean,
      default: false,
    },
  },
  {
    // mongoose adds "createdAt" and "updatedAt" automatically
    timestamps: true,
  }
);

// mongoose.model("Role", ...) creates the "roles" collection in MongoDB
const Role = mongoose.model("Role", roleSchema);

export default Role;
