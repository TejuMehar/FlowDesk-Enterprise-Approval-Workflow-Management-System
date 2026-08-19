import mongoose from "mongoose";
import dotenv from "dotenv";

dotenv.config();

const run = async () => {
  await mongoose.connect(process.env.MONGO_URL);

  const workflows = mongoose.connection.collection("workflows");
  const roles = mongoose.connection.collection("roles");
  const departments = mongoose.connection.collection("departments");
  const users = mongoose.connection.collection("users");

  const wf = await workflows.findOne({ name: "Purchase Approval" });

  if (!wf) {
    console.log("No workflow named 'Purchase Approval' found");
    await mongoose.disconnect();
    return;
  }

  console.log("Workflow:", wf.name, "| requestType:", wf.requestType, "| isActive:", wf.isActive, "| isDeleted:", wf.isDeleted);
  console.log("Stages:");

  for (const stage of wf.stages) {
    console.log(`\n- [${stage.order}] ${stage.name}`);
    console.log(`  approverType: ${stage.approverType}`);
    console.log(`  approverRole: ${stage.approverRole}`);
    console.log(`  approverDepartment: ${stage.approverDepartment}`);
    console.log(`  approverUser: ${stage.approverUser}`);

    if (stage.name === "Finance Review") {
      if (stage.approverType === "Role") {
        const role = stage.approverRole ? await roles.findOne({ _id: stage.approverRole }) : null;
        console.log(`  -> Role doc:`, role ? role.name : "NOT SET / NOT FOUND");
        if (role) {
          const matchingUsers = await users.find({ role: role._id, isActive: true, isDeleted: false }).toArray();
          console.log(`  -> active users with this role: ${matchingUsers.length}`);
          matchingUsers.forEach(u => console.log(`     - ${u.name || u.email}`));
        }
      } else if (stage.approverType === "Department") {
        const dept = stage.approverDepartment ? await departments.findOne({ _id: stage.approverDepartment }) : null;
        console.log(`  -> Department doc:`, dept ? `${dept.name} (isDeleted=${dept.isDeleted}, manager=${dept.manager})` : "NOT SET / NOT FOUND");
      } else if (stage.approverType === "User") {
        const user = stage.approverUser ? await users.findOne({ _id: stage.approverUser }) : null;
        console.log(`  -> User doc:`, user ? `${user.name || user.email} (isActive=${user.isActive}, isDeleted=${user.isDeleted})` : "NOT SET / NOT FOUND");
      }
    }
  }

  await mongoose.disconnect();
};

run().catch((err) => {
  console.error("ERROR", err);
  process.exit(1);
});
