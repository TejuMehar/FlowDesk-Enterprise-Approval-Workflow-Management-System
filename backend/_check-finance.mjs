import mongoose from "mongoose";
import dotenv from "dotenv";

dotenv.config();

const run = async () => {
  await mongoose.connect(process.env.MONGO_URL);

  const departments = mongoose.connection.collection("departments");
  const users = mongoose.connection.collection("users");
  const roles = mongoose.connection.collection("roles");

  const dept = await departments.findOne({ name: "Finance" });
  console.log("Finance department:", dept);

  const members = await users.find({ department: dept._id, isDeleted: false }).toArray();
  console.log(`\nUsers in Finance department: ${members.length}`);

  for (const u of members) {
    const role = await roles.findOne({ _id: u.role });
    console.log(`- ${u.name || u.email} | role: ${role?.name} | isActive: ${u.isActive}`);
  }

  await mongoose.disconnect();
};

run().catch((err) => {
  console.error("ERROR", err);
  process.exit(1);
});
