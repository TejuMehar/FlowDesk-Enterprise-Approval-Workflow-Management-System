/*
=========================================================================
  MODEL: Department                               ( the "M" of MVC )
=========================================================================
  A Department is a team inside the company, e.g. "Engineering", "HR".
  Each department can have ONE manager, and that manager is a User.
=========================================================================
*/

import mongoose from "mongoose";

const departmentSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Department name is required"],
      unique: true,
      trim: true,
      minlength: [2, "Department name must be at least 2 characters"],
      maxlength: [80, "Department name cannot be more than 80 characters"],
    },

    // A short code like "HR" or "ENG"
    code: {
      type: String,
      required: [true, "Department code is required"],
      unique: true,
      trim: true,
      uppercase: true, // mongoose turns "hr" into "HR" by itself
      maxlength: [10, "Department code cannot be more than 10 characters"],
    },

    description: {
      type: String,
      trim: true,
      maxlength: [300, "Description cannot be more than 300 characters"],
      default: "",
    },

    /*
      THE MANAGER OF THIS DEPARTMENT

      "type: ObjectId" + "ref: User" means we store only the ID of a user
      here. Later we can write .populate("manager") and mongoose will
      fetch the full user document for us automatically.

      It can be null because a new department may not have a manager yet.
    */
    manager: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    /*
      SOFT DELETE
      Instead of really removing the row we just set this to true.
      The department disappears from every list, but the history of which
      employee worked where stays safe.
    */
    isDeleted: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  }
);

// Makes "show me all departments that are not deleted" fast
departmentSchema.index({ isDeleted: 1 });

const Department = mongoose.model("Department", departmentSchema);

export default Department;
