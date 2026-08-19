/*
=========================================================================
  DATABASE CONNECTION  (MongoDB Atlas + Mongoose)
=========================================================================
  "mongoose" is the library that lets our Node.js code talk to MongoDB.
  This file exports one function -> connectDB()
  We call it one time when the server starts (see index.js).
=========================================================================
*/

import mongoose from "mongoose";

const connectDB = async () => {
  try {
    // mongoose.connect() opens the connection using the URL from .env
    await mongoose.connect(process.env.MONGO_URL);

    console.log("MongoDB connected successfully");
  } catch (error) {
    // If the database is not reachable the app cannot work at all,
    // so we print the reason and stop the process.
    console.error("Error in Database Connection", error);
    console.error("Check MONGO_URL in .env and whitelist your IP in Atlas");
    process.exit(1);
  }
};

export default connectDB;
