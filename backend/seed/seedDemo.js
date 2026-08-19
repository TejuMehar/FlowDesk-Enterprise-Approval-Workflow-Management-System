/*
=========================================================================
  DEMO SEED SCRIPT   ->   run it with:   npm run seed:demo
=========================================================================
  seed.js gives a brand new database the bare minimum: four roles, two
  departments, the request types, the settings row and ONE Super Admin.
  That is enough to log in, and not enough to see the application work.

  An approval application only shows what it is once there are people in
  it. A workflow stage that says "the requester's manager" needs a
  department that HAS a manager. A stage that says "anyone with the
  Finance Manager role" needs somebody holding that role. With three
  accounts in the database every route dead-ends, and "there is no
  approver at the moment" is the only thing the app can say.

  So this script builds a small company:

    1. three extra roles   Finance Manager, HR Manager, Director
    2. twelve departments, EVERY ONE with a real manager
    3. ~78 employees       e2.. / m2.. / f1.. / h1.. / d1..
    4. eight workflows     one live route per request type

  It is SAFE to run more than once. Nothing is deleted and nothing is
  overwritten by accident: a user is created only when their email is
  free, a department only when its code is free. Only the workflows and
  the three custom roles are refreshed in place, because those are the
  parts this script OWNS.

  RUN "npm run seed" FIRST. This script builds on top of the four system
  roles, the request types and the settings row that one creates.
=========================================================================
*/

import mongoose from "mongoose";
import dotenv from "dotenv";

import Role from "../model/roleModel.js";
import User from "../model/userModel.js";
import Department from "../model/departmentModel.js";
import Workflow from "../model/workflowModel.js";
import { PERMISSIONS } from "../config/permissions.js";

dotenv.config();

/* =====================================================================
   THE ONE PASSWORD
   ---------------------------------------------------------------------
   Every account below shares it, because the point of this data is to
   let somebody log in as anybody and watch a request travel. The model
   hashes it on save, so it is never stored as text.

   IT IS A DEMO PASSWORD. Do not run this script against a database that
   real people use.
   ===================================================================== */
const DEMO_PASSWORD = "Admin123";

/* =====================================================================
   1) THE THREE EXTRA ROLES
   ---------------------------------------------------------------------
   The four system roles cover "runs the company", "runs the app",
   "runs a team" and "does the work". A workflow needs a fourth kind of
   answer: somebody who reviews a KIND of thing rather than a team -
   money, people, or the size of the decision.

   All three get the request / approval / comment permissions for the
   reason config/permissions.js explains: a workflow stage may land on
   anybody, so everybody must be able to answer one.
   ===================================================================== */

const EVERYONE_PERMISSIONS = [
  PERMISSIONS.REQUEST_CREATE,
  PERMISSIONS.REQUEST_READ,
  PERMISSIONS.REQUEST_UPDATE,
  PERMISSIONS.REQUEST_DELETE,
  PERMISSIONS.REQUEST_SUBMIT,
  PERMISSIONS.APPROVAL_READ,
  PERMISSIONS.APPROVAL_APPROVE,
  PERMISSIONS.APPROVAL_REJECT,
  PERMISSIONS.APPROVAL_RETURN,
  PERMISSIONS.COMMENT_CREATE,
  PERMISSIONS.COMMENT_READ,
  PERMISSIONS.COMMENT_DELETE,
];

const DEMO_ROLES = [
  {
    name: "Finance Manager",
    description:
      "Reviews the money side of a request - purchases, expenses, travel and budgets.",
    /*
      analytics:read is deliberate and is the only permission here that
      reaches outside their own team. Finance is asked "what did the
      company spend last quarter", and config/reportScope.js reads this
      exact permission to decide whether a report covers the company or
      only a department. Without it their Reports page would be about
      the Finance team alone, which is not the job.
    */
    permissions: [
      PERMISSIONS.USER_READ,
      PERMISSIONS.DEPARTMENT_READ,
      PERMISSIONS.ANALYTICS_READ,
      PERMISSIONS.REPORT_READ,
      PERMISSIONS.REPORT_EXPORT,
      ...EVERYONE_PERMISSIONS,
    ],
  },
  {
    name: "HR Manager",
    description:
      "Owns people - joiners, leavers, leave approvals and employee records.",
    /*
      The only role besides Admin that may CREATE a user, which is the
      whole point of an HR account: onboarding a joiner is their job,
      not the system administrator's. They still cannot touch roles,
      workflows or settings.
    */
    permissions: [
      PERMISSIONS.USER_CREATE,
      PERMISSIONS.USER_READ,
      PERMISSIONS.USER_UPDATE,
      PERMISSIONS.USER_STATUS,
      PERMISSIONS.DEPARTMENT_READ,
      PERMISSIONS.ANALYTICS_READ,
      PERMISSIONS.REPORT_READ,
      PERMISSIONS.REPORT_EXPORT,
      /*
        MODULE 11. HR is the role attendance was really built for, and
        it is the only demo role that gets all four permissions: chasing
        missing clock outs, fixing the day somebody's laptop died,
        setting the company working pattern and sending the month's
        attendance to payroll IS the job description.

        Note the Finance Manager above does NOT get any of them, even
        with analytics:read. Seeing what the company spent and seeing
        when every employee took lunch are different things, which is
        exactly why attendance:read-all is its own permission rather
        than a reuse of analytics:read.
      */
      PERMISSIONS.ATTENDANCE_READ_ALL,
      PERMISSIONS.ATTENDANCE_CORRECT,
      PERMISSIONS.ATTENDANCE_POLICY,
      PERMISSIONS.ATTENDANCE_EXPORT,
      ...EVERYONE_PERMISSIONS,
    ],
  },
  {
    name: "Director",
    description:
      "The last signature on anything large. Sees the company, changes nothing.",
    /*
      A READ-ONLY senior role, and the shape is intentional: a Director
      can see every number, every workflow and the audit log, and can
      create nothing and edit nobody. The authority they have is the
      authority to say yes, which is the approval permissions - not the
      authority to change how the company is set up.
    */
    permissions: [
      PERMISSIONS.USER_READ,
      PERMISSIONS.DEPARTMENT_READ,
      PERMISSIONS.WORKFLOW_READ,
      PERMISSIONS.ANALYTICS_READ,
      PERMISSIONS.REPORT_READ,
      PERMISSIONS.REPORT_EXPORT,
      PERMISSIONS.AUDIT_READ,
      /*
        MODULE 11, and it keeps the read-only shape of the role exactly.

        A Director sees every department's attendance and can check any
        single employee - which is the whole point of the level - and
        can take the numbers away as a file. What they cannot do is
        change anybody's hours or anybody's shift: no
        attendance:correct, no attendance:policy. The authority they
        have is the authority to look and to say yes, not the authority
        to rewrite what happened.
      */
      PERMISSIONS.ATTENDANCE_READ_ALL,
      PERMISSIONS.ATTENDANCE_EXPORT,
      ...EVERYONE_PERMISSIONS,
    ],
  },
];

/* =====================================================================
   2) THE DEPARTMENTS
   ---------------------------------------------------------------------
   `managerEmail` is the account that ENDS UP owning the department, and
   it is the most important column in this file.

   Two workflow approver types resolve through it and nothing else:
   "RequesterManager" walks from an employee to their department's
   manager, and "Department" walks straight to one. A department with a
   null manager makes every stage pointing at it unanswerable, which is
   exactly the state this database was in before the script ran.
   ===================================================================== */
const DEPARTMENTS = [
  {
    name: "Human Resources",
    code: "HR",
    description: "Hiring, payroll and employee welfare.",
    // the m1 account that already exists - so it keeps a real team
    managerEmail: "m1@gmail.com",
  },
  {
    name: "Engineering",
    code: "ENG",
    description: "Builds and maintains the product.",
    managerEmail: "m2@gmail.com",
  },
  {
    name: "Finance",
    code: "FIN",
    description: "Budgets, payments, payroll and audit.",
    managerEmail: "f1@gmail.com",
  },
  {
    name: "Sales",
    code: "SALES",
    description: "Wins and keeps customers.",
    managerEmail: "m3@gmail.com",
  },
  {
    name: "Marketing",
    code: "MKT",
    description: "Brand, campaigns and demand generation.",
    managerEmail: "m4@gmail.com",
  },
  {
    name: "Operations",
    code: "OPS",
    description: "Keeps the day to day running.",
    managerEmail: "m5@gmail.com",
  },
  {
    name: "IT Support",
    code: "IT",
    description: "Laptops, accounts, networks and software licences.",
    managerEmail: "m6@gmail.com",
  },
  {
    name: "Legal",
    code: "LEGAL",
    description: "Contracts, compliance and risk.",
    managerEmail: "m7@gmail.com",
  },
  {
    name: "Design",
    code: "DSGN",
    description: "Product design and visual identity.",
    managerEmail: "m8@gmail.com",
  },
  {
    name: "Customer Support",
    code: "CS",
    description: "Answers customers after they have bought.",
    managerEmail: "m9@gmail.com",
  },
  {
    name: "Procurement",
    code: "PROC",
    description: "Vendors, purchase orders and supplier contracts.",
    managerEmail: "m10@gmail.com",
  },
  {
    name: "Research and Development",
    code: "RND",
    description: "Prototypes, data science and new ideas.",
    managerEmail: "m11@gmail.com",
  },
];

/* =====================================================================
   3) THE PEOPLE
   ---------------------------------------------------------------------
   Written out one line each instead of generated in a loop, on purpose.
   "Employee 37" tells you nothing when it appears in an approval queue,
   and a demo is only useful if the screen looks like a company.

   `dept` is a department CODE from the list above.
   ===================================================================== */

/* ---- 55 employees: e2 .. e56 ---- */
const EMPLOYEES = [
  // Engineering
  { n: 2, first: "Aarav", last: "Sharma", dept: "ENG", designation: "Software Engineer", gender: "male" },
  { n: 3, first: "Vivaan", last: "Patel", dept: "ENG", designation: "Software Engineer", gender: "male" },
  { n: 4, first: "Aditya", last: "Nair", dept: "ENG", designation: "Senior Software Engineer", gender: "male" },
  { n: 5, first: "Ananya", last: "Iyer", dept: "ENG", designation: "Frontend Developer", gender: "female" },
  { n: 6, first: "Diya", last: "Menon", dept: "ENG", designation: "Backend Developer", gender: "female" },
  { n: 7, first: "Kabir", last: "Joshi", dept: "ENG", designation: "Full Stack Developer", gender: "male" },
  { n: 8, first: "Ishaan", last: "Rao", dept: "ENG", designation: "DevOps Engineer", gender: "male" },
  { n: 9, first: "Meera", last: "Pillai", dept: "ENG", designation: "QA Engineer", gender: "female" },
  { n: 10, first: "Rohan", last: "Desai", dept: "ENG", designation: "QA Engineer", gender: "male" },
  { n: 11, first: "Saanvi", last: "Kulkarni", dept: "ENG", designation: "Mobile Developer", gender: "female" },
  { n: 12, first: "Arjun", last: "Bhat", dept: "ENG", designation: "Site Reliability Engineer", gender: "male" },
  { n: 13, first: "Nisha", last: "Reddy", dept: "ENG", designation: "Software Engineer", gender: "female" },

  // IT Support
  { n: 14, first: "Karan", last: "Malhotra", dept: "IT", designation: "IT Support Engineer", gender: "male" },
  { n: 15, first: "Pooja", last: "Deshmukh", dept: "IT", designation: "System Administrator", gender: "female" },
  { n: 16, first: "Rahul", last: "Chawla", dept: "IT", designation: "Network Engineer", gender: "male" },
  { n: 17, first: "Sneha", last: "Bansal", dept: "IT", designation: "Helpdesk Analyst", gender: "female" },
  { n: 18, first: "Manish", last: "Tiwari", dept: "IT", designation: "IT Asset Coordinator", gender: "male" },
  { n: 19, first: "Ritu", last: "Saxena", dept: "IT", designation: "Information Security Analyst", gender: "female" },

  // Sales
  { n: 20, first: "Siddharth", last: "Gupta", dept: "SALES", designation: "Sales Executive", gender: "male" },
  { n: 21, first: "Neha", last: "Kapoor", dept: "SALES", designation: "Sales Executive", gender: "female" },
  { n: 22, first: "Amit", last: "Verma", dept: "SALES", designation: "Account Manager", gender: "male" },
  { n: 23, first: "Priya", last: "Chopra", dept: "SALES", designation: "Inside Sales Representative", gender: "female" },
  { n: 24, first: "Varun", last: "Sinha", dept: "SALES", designation: "Business Development Executive", gender: "male" },
  { n: 25, first: "Tanvi", last: "Shetty", dept: "SALES", designation: "Key Account Executive", gender: "female" },
  { n: 26, first: "Harsh", last: "Agarwal", dept: "SALES", designation: "Sales Operations Analyst", gender: "male" },

  // Marketing
  { n: 27, first: "Riya", last: "Sengupta", dept: "MKT", designation: "Marketing Executive", gender: "female" },
  { n: 28, first: "Devansh", last: "Mehta", dept: "MKT", designation: "Content Strategist", gender: "male" },
  { n: 29, first: "Ayesha", last: "Khan", dept: "MKT", designation: "Digital Marketing Specialist", gender: "female" },
  { n: 30, first: "Nikhil", last: "Rane", dept: "MKT", designation: "SEO Analyst", gender: "male" },
  { n: 31, first: "Kavya", last: "Prasad", dept: "MKT", designation: "Brand Executive", gender: "female" },

  // Operations
  { n: 32, first: "Rajat", last: "Kulkarni", dept: "OPS", designation: "Operations Executive", gender: "male" },
  { n: 33, first: "Shruti", last: "Barve", dept: "OPS", designation: "Operations Analyst", gender: "female" },
  { n: 34, first: "Yash", last: "Thakur", dept: "OPS", designation: "Logistics Coordinator", gender: "male" },
  { n: 35, first: "Anjali", last: "Naik", dept: "OPS", designation: "Process Associate", gender: "female" },
  { n: 36, first: "Gaurav", last: "Salunke", dept: "OPS", designation: "Facilities Executive", gender: "male" },

  // Design
  { n: 37, first: "Isha", last: "Ghosh", dept: "DSGN", designation: "UI Designer", gender: "female" },
  { n: 38, first: "Aryan", last: "Bose", dept: "DSGN", designation: "UX Designer", gender: "male" },
  { n: 39, first: "Sanjana", last: "Roy", dept: "DSGN", designation: "Product Designer", gender: "female" },
  { n: 40, first: "Kunal", last: "Dutta", dept: "DSGN", designation: "Motion Designer", gender: "male" },

  // Customer Support
  { n: 41, first: "Pallavi", last: "Rane", dept: "CS", designation: "Customer Support Executive", gender: "female" },
  { n: 42, first: "Sameer", last: "Qureshi", dept: "CS", designation: "Customer Support Executive", gender: "male" },
  { n: 43, first: "Divya", last: "Krishnan", dept: "CS", designation: "Escalation Specialist", gender: "female" },
  { n: 44, first: "Abhishek", last: "Jadhav", dept: "CS", designation: "Customer Success Associate", gender: "male" },
  { n: 45, first: "Farah", last: "Sheikh", dept: "CS", designation: "Support Analyst", gender: "female" },

  // Legal
  { n: 46, first: "Nandini", last: "Rao", dept: "LEGAL", designation: "Legal Associate", gender: "female" },
  { n: 47, first: "Vikram", last: "Chauhan", dept: "LEGAL", designation: "Contracts Executive", gender: "male" },
  { n: 48, first: "Sara", last: "Fernandes", dept: "LEGAL", designation: "Compliance Analyst", gender: "female" },

  // Procurement
  { n: 49, first: "Ajay", last: "Pawar", dept: "PROC", designation: "Procurement Executive", gender: "male" },
  { n: 50, first: "Swati", last: "Mishra", dept: "PROC", designation: "Vendor Coordinator", gender: "female" },
  { n: 51, first: "Imran", last: "Ansari", dept: "PROC", designation: "Purchase Assistant", gender: "male" },

  // Research and Development
  { n: 52, first: "Rhea", last: "Kamath", dept: "RND", designation: "Research Associate", gender: "female" },
  { n: 53, first: "Tarun", last: "Bhatia", dept: "RND", designation: "Data Scientist", gender: "male" },
  { n: 54, first: "Megha", last: "Solanki", dept: "RND", designation: "Machine Learning Engineer", gender: "female" },
  { n: 55, first: "Omkar", last: "Bhosale", dept: "RND", designation: "Research Engineer", gender: "male" },
  { n: 56, first: "Lavanya", last: "Suresh", dept: "RND", designation: "Innovation Analyst", gender: "female" },
];

/* ---- 11 managers: m2 .. m12 ----
   m2 to m11 each own the department they sit in. m12 does not own one
   on purpose: it is the account to log in as when you want to see what
   a manager WITHOUT a team sees, which is a real state the dashboards
   have to survive.                                                    */
const MANAGERS = [
  { n: 2, first: "Rajesh", last: "Kulkarni", dept: "ENG", designation: "Engineering Manager", gender: "male" },
  { n: 3, first: "Sunita", last: "Deshpande", dept: "SALES", designation: "Sales Manager", gender: "female" },
  { n: 4, first: "Anil", last: "Wagh", dept: "MKT", designation: "Marketing Manager", gender: "male" },
  { n: 5, first: "Deepa", last: "Menon", dept: "OPS", designation: "Operations Manager", gender: "female" },
  { n: 6, first: "Suresh", last: "Iyer", dept: "IT", designation: "IT Manager", gender: "male" },
  { n: 7, first: "Meenakshi", last: "Nair", dept: "LEGAL", designation: "Legal Manager", gender: "female" },
  { n: 8, first: "Pankaj", last: "Sethi", dept: "DSGN", designation: "Design Manager", gender: "male" },
  { n: 9, first: "Kavita", last: "Joshi", dept: "CS", designation: "Customer Support Manager", gender: "female" },
  { n: 10, first: "Naveen", last: "Rathore", dept: "PROC", designation: "Procurement Manager", gender: "male" },
  { n: 11, first: "Shalini", last: "Bhatt", dept: "RND", designation: "R&D Manager", gender: "female" },
  { n: 12, first: "Prakash", last: "Shinde", dept: "ENG", designation: "Deputy Engineering Manager", gender: "male" },
];

/* ---- 6 finance managers: f1 .. f6 ---- */
const FINANCE_MANAGERS = [
  { n: 1, first: "Ramesh", last: "Agarwal", dept: "FIN", designation: "Head of Finance", gender: "male" },
  { n: 2, first: "Sudha", last: "Krishnan", dept: "FIN", designation: "Assistant Finance Manager", gender: "female" },
  { n: 3, first: "Vinod", last: "Malhotra", dept: "FIN", designation: "Accounts Payable Manager", gender: "male" },
  { n: 4, first: "Priyanka", last: "Ghosh", dept: "FIN", designation: "Payroll Manager", gender: "female" },
  { n: 5, first: "Sanjay", last: "Dixit", dept: "FIN", designation: "Budget Controller", gender: "male" },
  { n: 6, first: "Nutan", last: "Palkar", dept: "FIN", designation: "Audit and Compliance Manager", gender: "female" },
];

/* ---- 4 HR managers: h1 .. h4 ---- */
const HR_MANAGERS = [
  { n: 1, first: "Sneha", last: "Kulkarni", dept: "HR", designation: "HR Manager", gender: "female" },
  { n: 2, first: "Vikas", last: "Chandran", dept: "HR", designation: "HR Business Partner", gender: "male" },
  { n: 3, first: "Ritika", last: "Malhotra", dept: "HR", designation: "Recruitment Manager", gender: "female" },
  { n: 4, first: "Alok", last: "Pandey", dept: "HR", designation: "Employee Relations Manager", gender: "male" },
];

/* ---- 2 directors: d1 .. d2 ---- */
const DIRECTORS = [
  { n: 1, first: "Vikram", last: "Mehra", dept: "OPS", designation: "Director of Operations", gender: "male" },
  { n: 2, first: "Anita", last: "Raghavan", dept: "FIN", designation: "Director of Finance", gender: "female" },
];

/*
  Ties each block above to the email letter it uses and the role every
  account in it gets. Keeping it in one table means the create loop can
  be written once instead of five times.
*/
const USER_GROUPS = [
  { people: EMPLOYEES, prefix: "e", roleName: "Employee" },
  { people: MANAGERS, prefix: "m", roleName: "Manager" },
  { people: FINANCE_MANAGERS, prefix: "f", roleName: "Finance Manager" },
  { people: HR_MANAGERS, prefix: "h", roleName: "HR Manager" },
  { people: DIRECTORS, prefix: "d", roleName: "Director" },
];

/* =====================================================================
   4) THE WORKFLOWS
   ---------------------------------------------------------------------
   One live route for every one of the eight request types, because a
   request type with no active workflow cannot be submitted at all -
   startApprovalWorkflow() refuses it with "there is no active approval
   workflow for X requests yet".

   Built as a FUNCTION rather than a constant because a stage has to
   carry the real ObjectId of a role or a department, and those only
   exist once the steps above have run.

   Nearly every route starts at "RequesterManager". That is the one
   approver type that works for all 78 people without naming anybody:
   it walks from whoever submitted to the manager of their department.
   ===================================================================== */
const buildWorkflows = ({ roleId, departmentId }) => [
  {
    name: "Leave Approval",
    requestType: "Leave",
    description: "Manager first, then HR records it.",
    stages: [
      {
        order: 1,
        name: "Manager Approval",
        approverType: "RequesterManager",
        approvalRule: "AnyOne",
        /*
          The only escalation in this file that fires at the manager's
          own boss. Leave is time-critical in a way a laptop request is
          not - a week of silence on a leave request is an answer, and
          the wrong one.
        */
        escalation: {
          enabled: true,
          afterHours: 24,
          escalateTo: "Role",
          escalateToRole: roleId("HR Manager"),
          action: "Notify",
        },
      },
      {
        order: 2,
        name: "HR Approval",
        approverType: "Role",
        approverRole: roleId("HR Manager"),
        // four HR accounts hold this role, and the first to answer decides
        approvalRule: "AnyOne",
      },
    ],
  },
  {
    name: "Purchase Approval",
    requestType: "Purchase",
    description: "Manager, then Finance, and a Director for anything large.",
    stages: [
      {
        order: 1,
        name: "Manager Approval",
        approverType: "RequesterManager",
        approvalRule: "AnyOne",
        /*
          Small purchases skip the manager completely. This is the
          clearest demonstration of Module 3's auto approval: raise a
          1,000 purchase and watch the timeline say "AutoApproved -
          rule matched" without anybody touching it.
        */
        autoApproval: {
          enabled: true,
          conditions: [{ field: "amount", operator: "<=", value: 5000 }],
        },
      },
      {
        order: 2,
        name: "Finance Review",
        approverType: "Role",
        approverRole: roleId("Finance Manager"),
        approvalRule: "AnyOne",
        escalation: {
          enabled: true,
          afterHours: 48,
          escalateTo: "Department",
          escalateToDepartment: departmentId("FIN"),
          action: "Notify",
        },
      },
      {
        order: 3,
        name: "Director Sign-off",
        approverType: "Role",
        approverRole: roleId("Director"),
        approvalRule: "AnyOne",
        // only genuinely big spend reaches a director
        autoApproval: {
          enabled: true,
          conditions: [{ field: "amount", operator: "<=", value: 50000 }],
        },
      },
    ],
  },
  {
    name: "Expense Reimbursement",
    requestType: "Expense",
    description: "Manager signs it off, Finance pays it.",
    stages: [
      {
        order: 1,
        name: "Manager Approval",
        approverType: "RequesterManager",
        approvalRule: "AnyOne",
        autoApproval: {
          enabled: true,
          conditions: [{ field: "amount", operator: "<=", value: 2000 }],
        },
      },
      {
        order: 2,
        name: "Finance Reimbursement",
        approverType: "Role",
        approverRole: roleId("Finance Manager"),
        approvalRule: "AnyOne",
      },
    ],
  },
  {
    name: "Travel Approval",
    requestType: "Travel",
    description: "Manager, Finance, and a Director for international trips.",
    stages: [
      {
        order: 1,
        name: "Manager Approval",
        approverType: "RequesterManager",
        approvalRule: "AnyOne",
      },
      {
        order: 2,
        name: "Finance Review",
        approverType: "Role",
        approverRole: roleId("Finance Manager"),
        approvalRule: "AnyOne",
      },
      {
        order: 3,
        name: "Director Sign-off",
        approverType: "Role",
        approverRole: roleId("Director"),
        approvalRule: "AnyOne",
        /*
          The one place a CATEGORY drives the auto approval instead of
          an amount: a domestic trip stops at Finance, an international
          one carries on to a Director. Travel has no amount field at
          all, so a number could not have expressed this.
        */
        autoApproval: {
          enabled: true,
          conditions: [
            { field: "category", operator: "==", value: "Domestic Travel" },
          ],
        },
      },
    ],
  },
  {
    name: "Laptop Request",
    requestType: "Laptop",
    description: "Manager agrees it is needed, IT finds the machine.",
    stages: [
      {
        order: 1,
        name: "Manager Approval",
        approverType: "RequesterManager",
        approvalRule: "AnyOne",
      },
      {
        order: 2,
        name: "IT Fulfilment",
        // "Department" resolves to the MANAGER of IT Support, not the team
        approverType: "Department",
        approverDepartment: departmentId("IT"),
        approvalRule: "AnyOne",
      },
    ],
  },
  {
    name: "Software Licence Request",
    requestType: "Software",
    description: "Manager, then IT checks the licence and the security of it.",
    stages: [
      {
        order: 1,
        name: "Manager Approval",
        approverType: "RequesterManager",
        approvalRule: "AnyOne",
      },
      {
        order: 2,
        name: "IT Security Review",
        approverType: "Department",
        approverDepartment: departmentId("IT"),
        approvalRule: "AnyOne",
      },
      {
        order: 3,
        name: "Finance Sign-off",
        approverType: "Role",
        approverRole: roleId("Finance Manager"),
        approvalRule: "AnyOne",
      },
    ],
  },
  {
    name: "Budget Approval",
    requestType: "Budget",
    description: "The heaviest route: manager, all of Finance, then a Director.",
    stages: [
      {
        order: 1,
        name: "Manager Approval",
        approverType: "RequesterManager",
        approvalRule: "AnyOne",
      },
      {
        order: 2,
        name: "Finance Committee",
        approverType: "Role",
        approverRole: roleId("Finance Manager"),
        /*
          The only "Majority" stage in the file, and the reason the rule
          exists. Setting aside money for a year is a decision the
          finance team takes together, so four of the six have to agree
          before it moves - one signature is not enough.
        */
        approvalRule: "Majority",
      },
      {
        order: 3,
        name: "Director Sign-off",
        approverType: "Role",
        approverRole: roleId("Director"),
        // both directors must agree - no auto approval anywhere on this route
        approvalRule: "Everyone",
      },
    ],
  },
  {
    name: "General Request Approval",
    requestType: "Custom",
    description: "The catch-all route for anything that fits no other type.",
    stages: [
      {
        order: 1,
        name: "Manager Approval",
        approverType: "RequesterManager",
        approvalRule: "AnyOne",
      },
      {
        order: 2,
        name: "Director Review",
        approverType: "Role",
        approverRole: roleId("Director"),
        approvalRule: "AnyOne",
      },
    ],
  },
];

/* =====================================================================
   THE SCRIPT ITSELF
   ===================================================================== */
const seedDemoData = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URL);
    console.log("MongoDB connected successfully");
    console.log("--------------------------------------------------");

    /* ============================================================
       STEP 1 - the three extra roles
       ============================================================ */
    console.log("\n1) Roles");

    for (const roleData of DEMO_ROLES) {
      const existing = await Role.findOne({ name: roleData.name });

      if (existing) {
        /*
          Refreshed in place, the same way seed.js refreshes the system
          roles: a permission added to the list above has to be able to
          reach a role that already exists, or the only way to hand it
          out would be by hand in the UI.
        */
        existing.description = roleData.description;
        existing.permissions = roleData.permissions;
        await existing.save();

        console.log(`   updated : ${roleData.name} (${roleData.permissions.length} permissions)`);
      } else {
        await Role.create(roleData);
        console.log(`   created : ${roleData.name} (${roleData.permissions.length} permissions)`);
      }
    }

    /*
      Look every role up ONCE and keep them in a Map. Without this the
      user loop below would ask the database for the same four roles
      seventy-eight times.
    */
    const allRoles = await Role.find({}).select("name").lean();
    const roleIdByName = new Map(allRoles.map((role) => [role.name, role._id]));

    const roleId = (name) => {
      const id = roleIdByName.get(name);

      // a workflow stage pointing at a role that is not there would be
      // saved happily and then resolve to nobody, so we stop instead
      if (!id) {
        throw new Error(`Role "${name}" is missing. Run "npm run seed" first.`);
      }

      return id;
    };

    /* ============================================================
       STEP 2 - the departments (without managers yet)
       ------------------------------------------------------------
       The manager cannot be set here: they are one of the users the
       NEXT step creates, and a department cannot point at somebody
       who does not exist. So departments are made first, users
       second, and step 4 goes back and joins them up.
       ============================================================ */
    console.log("\n2) Departments");

    for (const departmentData of DEPARTMENTS) {
      const exists = await Department.findOne({ code: departmentData.code });

      if (exists) {
        console.log(`   skipped : ${departmentData.name} (already exists)`);
      } else {
        await Department.create({
          name: departmentData.name,
          code: departmentData.code,
          description: departmentData.description,
        });

        console.log(`   created : ${departmentData.name} (${departmentData.code})`);
      }
    }

    const allDepartments = await Department.find({ isDeleted: false })
      .select("code")
      .lean();

    const departmentIdByCode = new Map(
      allDepartments.map((department) => [department.code, department._id])
    );

    const departmentId = (code) => {
      const id = departmentIdByCode.get(code);

      if (!id) {
        throw new Error(`Department "${code}" is missing.`);
      }

      return id;
    };

    /* ============================================================
       STEP 3 - the people
       ------------------------------------------------------------
       Created ONE AT A TIME, and that is not an oversight.

       userModel's pre-save hook works out the next employeeId by
       finding the highest one that exists and adding 1. Creating
       users in parallel would let several of them read the same
       "highest" value and all decide they are EMP-0042, and only one
       of those saves can win - employeeId is unique.
       ============================================================ */
    console.log("\n3) Users");

    let createdCount = 0;
    let skippedCount = 0;

    for (const group of USER_GROUPS) {
      for (const person of group.people) {
        const email = `${group.prefix}${person.n}@gmail.com`;

        const exists = await User.findOne({ email });

        if (exists) {
          skippedCount += 1;
          continue;
        }

        await User.create({
          firstName: person.first,
          lastName: person.last,
          email,
          password: DEMO_PASSWORD, // the model hashes it
          role: roleId(group.roleName),
          department: departmentId(person.dept),
          designation: person.designation,
          gender: person.gender,
          isActive: true,
          /*
            Marked verified so every one of these accounts can log in
            straight away. A demo where 78 people have to click a link
            in an inbox nobody owns is not a demo.
          */
          isEmailVerified: true,
        });

        createdCount += 1;
      }

      console.log(`   ${group.roleName.padEnd(16)} -> ${group.prefix}1..${group.prefix}n  (${group.people.length} accounts)`);
    }

    console.log(`   created : ${createdCount}   already existed : ${skippedCount}`);

    /* ============================================================
       STEP 4 - give every department its manager
       ------------------------------------------------------------
       THE STEP THAT MAKES THE WORKFLOWS WORK. Before it runs, every
       department in this database has manager: null, so
       "RequesterManager" resolves to an empty list and every request
       is refused at submit time with "this stage has no approver".
       ============================================================ */
    console.log("\n4) Department managers");

    for (const departmentData of DEPARTMENTS) {
      const department = await Department.findOne({
        code: departmentData.code,
        isDeleted: false,
      });

      const manager = await User.findOne({
        email: departmentData.managerEmail,
        isDeleted: false,
      })
        .select("firstName lastName")
        .lean();

      if (!manager) {
        console.log(`   WARNING : ${departmentData.name} - ${departmentData.managerEmail} does not exist`);
        continue;
      }

      // an existing manager is left alone - somebody may have chosen them
      if (department.manager) {
        console.log(`   skipped : ${departmentData.name} (already has a manager)`);
        continue;
      }

      department.manager = manager._id;
      await department.save();

      console.log(`   ${departmentData.name.padEnd(26)} -> ${manager.firstName} ${manager.lastName} (${departmentData.managerEmail})`);
    }

    /* ============================================================
       STEP 5 - the workflows
       ------------------------------------------------------------
       Matched BY NAME so running this twice edits the same eight
       routes instead of failing on the unique name.
       ============================================================ */
    console.log("\n5) Workflows");

    const workflows = buildWorkflows({ roleId, departmentId });

    for (const workflowData of workflows) {
      /*
        Only ONE workflow per request type may be active - the rule
        workflowController.js enforces when an admin switches one on.
        This script writes straight to the model and bypasses that
        controller, so it has to keep the rule itself: everything else
        of this type is switched off BEFORE ours is switched on.

        Without this the "Purchase Approval" route that is already
        active in the database would sit alongside a second active
        Purchase route, and which one caught a request would come down
        to whichever findOne() happened to reach first.
      */
      await Workflow.updateMany(
        { requestType: workflowData.requestType, name: { $ne: workflowData.name } },
        { $set: { isActive: false } }
      );

      const existing = await Workflow.findOne({ name: workflowData.name });

      if (existing) {
        existing.description = workflowData.description;
        existing.requestType = workflowData.requestType;
        existing.stages = workflowData.stages;
        existing.isActive = true;
        existing.isDeleted = false;
        await existing.save();

        console.log(`   updated : ${workflowData.name.padEnd(28)} ${workflowData.requestType} (${workflowData.stages.length} stages)`);
      } else {
        await Workflow.create({ ...workflowData, isActive: true });

        console.log(`   created : ${workflowData.name.padEnd(28)} ${workflowData.requestType} (${workflowData.stages.length} stages)`);
      }
    }

    /* ============================================================
       STEP 6 - prove it, instead of claiming it
       ------------------------------------------------------------
       Everything above can succeed and still leave a database where
       nothing can be submitted, because "saved a workflow" and "that
       workflow has somebody to ask" are different facts.

       So we walk every stage of every live route and count the real
       people behind it, the same way approvalEngine.resolveApprovers
       will at submit time.
       ============================================================ */
    console.log("\n6) Checking every stage resolves to a real person");

    const liveWorkflows = await Workflow.find({ isActive: true, isDeleted: false })
      .select("name requestType stages")
      .lean();

    let problems = 0;

    for (const workflow of liveWorkflows) {
      for (const stage of workflow.stages) {
        let approverCount = 0;
        let describedAs = "";

        if (stage.approverType === "Role") {
          approverCount = await User.countDocuments({
            role: stage.approverRole,
            isActive: true,
            isDeleted: false,
          });
          describedAs = "anyone with the role";
        } else if (stage.approverType === "Department") {
          const department = await Department.findOne({
            _id: stage.approverDepartment,
            isDeleted: false,
          })
            .select("manager")
            .lean();

          approverCount = department?.manager ? 1 : 0;
          describedAs = "that department's manager";
        } else if (stage.approverType === "RequesterManager") {
          /*
            This one cannot be counted in advance - it depends on who
            submits. The question that CAN be answered now is whether
            every department has a manager, because that is what it
            walks through.
          */
          const headlessCount = await Department.countDocuments({
            isDeleted: false,
            manager: null,
          });

          if (headlessCount > 0) {
            console.log(`   WARNING : ${workflow.name} / ${stage.name} - ${headlessCount} department(s) still have no manager`);
            problems += 1;
          }

          continue;
        } else {
          approverCount = 1;
          describedAs = "one named person";
        }

        if (approverCount === 0) {
          console.log(`   BROKEN  : ${workflow.name} / ${stage.name} - nobody is ${describedAs}`);
          problems += 1;
        }
      }
    }

    if (problems === 0) {
      console.log(`   OK      : all ${liveWorkflows.length} live workflows have a real approver at every stage`);
    }

    /* ============================================================
       DONE
       ============================================================ */
    const userCount = await User.countDocuments({ isDeleted: false });
    const departmentCount = await Department.countDocuments({ isDeleted: false });

    console.log("\n--------------------------------------------------");
    console.log("Demo data ready.");
    console.log(`  users        : ${userCount}`);
    console.log(`  departments  : ${departmentCount}`);
    console.log(`  workflows    : ${liveWorkflows.length} active`);
    console.log("");
    console.log("Log in with any of these - the password is the same for all:");
    console.log(`  employee        e2@gmail.com  .. e56@gmail.com`);
    console.log(`  manager         m2@gmail.com  .. m12@gmail.com`);
    console.log(`  finance manager f1@gmail.com  .. f6@gmail.com`);
    console.log(`  hr manager      h1@gmail.com  .. h4@gmail.com`);
    console.log(`  director        d1@gmail.com  .. d2@gmail.com`);
    console.log(`  password        ${DEMO_PASSWORD}`);
    console.log("--------------------------------------------------\n");

    await mongoose.disconnect();
    process.exit(0);
  } catch (error) {
    console.error("Demo Seed Error", error);
    await mongoose.disconnect();
    process.exit(1);
  }
};

seedDemoData();
