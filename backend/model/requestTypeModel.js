/*
=========================================================================
  MODEL: RequestType                              ( the "M" of MVC )
=========================================================================
  Module 9 - System Configuration.

  "Leave", "Purchase", "Laptop" ... every kind of request an employee
  can raise. Until Module 9 this was an eight-item array in
  config/requestConstants.js, which meant a company that also wanted
  "Overtime" needed a developer, a deploy and a restart.

  Now it is a collection, and an admin owns it.

  WHAT CHANGED EVERYWHERE ELSE
  ----------------------------
  requestModel.type and workflowModel.requestType used to be `enum`
  fields pointing at that array. A mongoose enum is fixed the moment the
  file is imported, so it CANNOT check against a collection - the list
  would be a snapshot from server start-up, and a type added at 10am
  would be rejected until somebody restarted the process.

  So both enums are gone, and the check moved one layer up into the
  controllers, which ask config/requestTypeService.js. That file is the
  single place that answers "which types exist?" for the whole backend.

  DELETING A TYPE
  ---------------
  A type that requests or workflows already point at is NOT deletable,
  the same rule roleController.js applies to a role somebody is using.
  Deleting it would leave REQ-0042 saying it is a "Laptop" request with
  nothing behind the word.

  `isActive` is the answer for a type a company has stopped using:
  switched off it disappears from the "raise a request" dropdown, while
  every request that already carries it keeps working, keeps showing up
  in reports and keeps travelling through its workflow.
=========================================================================
*/

import mongoose from "mongoose";

const requestTypeSchema = new mongoose.Schema(
  {
    /*
      The name IS the link. requestModel stores the text "Leave", not an
      ObjectId pointing here.

      That looks like the wrong choice for about ten seconds, and it is
      the deliberate one: a request is a HISTORICAL RECORD. Storing a
      reference would mean renaming this row rewrites what every request
      ever raised claims to be, including ones approved two years ago.
      The name is copied the way auditModel.js copies actorName - so
      history stays true.

      That is also why renaming a type is handled carefully in the
      controller instead of being a plain field update.
    */
    name: {
      type: String,
      required: [true, "Request type name is required"],
      unique: true,
      trim: true,
      minlength: [2, "Name must be at least 2 characters"],
      maxlength: [40, "Name cannot be more than 40 characters"],
    },

    description: {
      type: String,
      trim: true,
      default: "",
      maxlength: [200, "Description cannot be more than 200 characters"],
    },

    /*
      The suggestions that fill the "Category" dropdown when an employee
      picks this type. They were REQUEST_CATEGORY_SUGGESTIONS before.

      Still only SUGGESTIONS - request.category is free text, so an
      employee can always type something nobody listed.
    */
    categories: {
      type: [String],
      default: [],
    },

    /*
      Which extra fields the request form should show. These two replace
      REQUEST_TYPES_WITH_AMOUNT and REQUEST_TYPES_WITH_DATES, and moving
      them next to the type is the point: a new "Overtime" type can now
      declare that it needs dates, which a hard-coded list could not.
    */
    needsAmount: {
      type: Boolean,
      default: false,
    },

    needsDates: {
      type: Boolean,
      default: false,
    },

    /*
      An inactive type cannot be chosen for a NEW request or a NEW
      workflow. Everything that already carries it is untouched - see
      the long note at the top of this file.
    */
    isActive: {
      type: Boolean,
      default: true,
    },

    // where it sits in the dropdown. Lower comes first.
    order: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
  }
);

/*
  The dropdown order, asked for on nearly every page: by `order`, then
  alphabetically for the ones an admin never bothered to sort.
*/
requestTypeSchema.index({ order: 1, name: 1 });

const RequestType = mongoose.model("RequestType", requestTypeSchema);

export default RequestType;
