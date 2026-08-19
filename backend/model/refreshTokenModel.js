/*
=========================================================================
  MODEL: RefreshToken                             ( the "M" of MVC )
=========================================================================
  WHY DO WE SAVE REFRESH TOKENS IN THE DATABASE?

  A JWT cannot be "cancelled". Once created it stays valid until it
  expires. That is a problem for LOGOUT - we need a way to say
  "this token is dead now".

  So we keep one row for every refresh token we hand out:
     LOGOUT           -> mark that row as revoked
     CHANGE PASSWORD  -> revoke ALL rows of that user (logout everywhere)
     REFRESH          -> revoke the old row, create a new one (rotation)

  We store only the SHA-256 HASH of the token, exactly like a password,
  so a stolen database is useless to an attacker.
=========================================================================
*/

import mongoose from "mongoose";

const refreshTokenSchema = new mongoose.Schema(
  {
    // which user this token belongs to
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    // the SHA-256 hash of the refresh token (never the token itself)
    tokenHash: {
      type: String,
      required: true,
      index: true,
    },

    // when this token stops working
    expiresAt: {
      type: Date,
      required: true,
    },

    // becomes true on logout, on password change, or after rotation
    isRevoked: {
      type: Boolean,
      default: false,
    },

    // extra info, useful later for an "active sessions" page
    userAgent: { type: String, default: "" },
    ipAddress: { type: String, default: "" },
  },
  {
    timestamps: true,
  }
);

/*
  TTL INDEX ("Time To Live")
  MongoDB automatically DELETES a document once "expiresAt" is in the
  past, so this collection cleans itself. expireAfterSeconds: 0 means
  "delete as soon as that date is reached".
*/
refreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// makes "revoke all tokens of this user" fast
refreshTokenSchema.index({ user: 1, isRevoked: 1 });

const RefreshToken = mongoose.model("RefreshToken", refreshTokenSchema);

export default RefreshToken;
