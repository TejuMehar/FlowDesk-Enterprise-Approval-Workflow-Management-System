/*
=========================================================================
  SECRET STORAGE  (Module 9 - System Configuration)
=========================================================================
  ONE job: turn a password we have to keep into text that is useless to
  anybody reading the database, and turn it back when we need to use it.

  WHY THIS EXISTS AT ALL
  ----------------------
  Every other secret in FlowDesk is HASHED, which is stronger: a
  password hashed with bcrypt (userModel.js) can never be turned back
  into the original, and it does not need to be - to check a login we
  hash what was typed and compare.

  The SMTP password is the one secret that cannot work that way. We do
  not compare it against anything, we HAND IT TO THE MAIL SERVER, so we
  must be able to read it back. Hashing it would make it unusable.

  So it is ENCRYPTED instead: reversible, but only with the key.

  BE HONEST ABOUT WHAT THIS BUYS
  ------------------------------
  The key is JWT_SECRET, which lives in the same .env as everything
  else. Somebody who steals the server steals both, and this stops
  nothing.

  What it does stop is the realistic accident: a database dump, an Atlas
  snapshot, a screenshot of a collection, a backup on somebody's laptop.
  In all of those the SMTP password travels WITHOUT the .env file, and
  encryption is the difference between a leaked mailbox and a leaked
  blob. A real deployment would put the key in a secret manager; the
  shape of the code would not change.

  AES-256-GCM is used rather than plain AES because GCM also
  AUTHENTICATES: if a single byte of the stored value is edited,
  decryption FAILS instead of quietly returning rubbish that we would
  then send to a mail server as a password.
=========================================================================
*/

import crypto from "crypto";

/*
  Everything encrypted here is stored as three parts joined by ":".

      enc:<iv>:<authTag>:<cipherText>

  The "enc:" marker at the front is what lets decryptSecret() below tell
  an encrypted value from a plain one, which matters exactly once: the
  first time this code meets a database written before Module 9.
*/
const PREFIX = "enc";
const ALGORITHM = "aes-256-gcm";

/*
  AES-256 needs a key of exactly 32 bytes, and JWT_SECRET is a hex
  string of whatever length the developer generated. sha256 turns any
  text into exactly 32 bytes, so it is used as a KEY DERIVATION step,
  not as a hash of anything secret in its own right.

  This is a FUNCTION and not a constant on purpose - the same reason
  getReminderConfig() is a function in notificationConstants.js. In ESM
  every import runs before dotenv.config(), so a top-level
  process.env.JWT_SECRET would be undefined.
*/
const getKey = () => {
  const secret = process.env.JWT_SECRET;

  if (!secret) {
    return null;
  }

  return crypto.createHash("sha256").update(String(secret)).digest();
};

/* =====================================================================
   ENCRYPT
   ---------------------------------------------------------------------
   Returns the storable text, or the value untouched when there is no
   key to encrypt with (a half-configured .env must not silently destroy
   the password the admin just typed).
   ===================================================================== */
export const encryptSecret = (plainText) => {
  if (!plainText) {
    return "";
  }

  const key = getKey();

  if (!key) {
    console.warn("JWT_SECRET is missing - the SMTP password is stored as-is");
    return String(plainText);
  }

  /*
    The IV ("initialisation vector") is a fresh 12 random bytes for
    every single encryption. It is not secret and is stored next to the
    result - its whole job is to make sure that encrypting the SAME
    password twice never produces the same text, so nobody can tell
    from the database that two settings share a password.
  */
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  const encrypted = Buffer.concat([
    cipher.update(String(plainText), "utf8"),
    cipher.final(),
  ]);

  // the tag GCM produces, which proves later that nothing was edited
  const authTag = cipher.getAuthTag();

  return [
    PREFIX,
    iv.toString("hex"),
    authTag.toString("hex"),
    encrypted.toString("hex"),
  ].join(":");
};

/* =====================================================================
   DECRYPT
   ---------------------------------------------------------------------
   The opposite. Never throws: a password that cannot be read is treated
   as no password at all, and nodemailer.js then falls back to the .env
   credentials instead of the whole application dying because somebody
   rotated JWT_SECRET.
   ===================================================================== */
export const decryptSecret = (storedValue) => {
  if (!storedValue) {
    return "";
  }

  const text = String(storedValue);

  // written before Module 9, or by a server with no key - use it as it is
  if (!text.startsWith(`${PREFIX}:`)) {
    return text;
  }

  const key = getKey();

  if (!key) {
    return "";
  }

  try {
    const [, ivHex, tagHex, dataHex] = text.split(":");

    const decipher = crypto.createDecipheriv(
      ALGORITHM,
      key,
      Buffer.from(ivHex, "hex")
    );

    // this is what makes an edited value FAIL instead of decoding to rubbish
    decipher.setAuthTag(Buffer.from(tagHex, "hex"));

    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(dataHex, "hex")),
      decipher.final(),
    ]);

    return decrypted.toString("utf8");
  } catch (error) {
    /*
      Three things land here, and all of them mean the same thing to a
      caller: JWT_SECRET was changed, the row was edited by hand, or
      the value was never really encrypted.
    */
    console.error(`Decrypt Secret Error ${error}`);
    return "";
  }
};

/*
  "Is there a password saved?" - the only thing the frontend is ever
  told about it. The password itself never leaves the server (see
  sanitizeSettings() in settingsController.js).
*/
export const hasSecret = (storedValue) => Boolean(storedValue);
