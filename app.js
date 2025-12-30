// app.js
const express = require("express");
const multer = require("multer");
const xlsx = require("xlsx");
const unzipper = require("unzipper");
const {
  sequelize,
  User,
  Employee,
  PFOnboarding,
  PFProfile,
  EmployeeTasksOnboarding,
  EmailLogs,
  LegalEntityMaster,
  TaskEntitiesConfig,
  TaskMasterOnboarding,
  LeaveAccrual,
  EmployeeExitDetails,
} = require("./db");
const { sendTemplatedEmail } = require("./util");
const app = express();
//const upload = multer({ dest: "uploads/" });
const upload = multer({ storage: multer.memoryStorage() });
const { Op } = require("sequelize");
const { uploadToS3, getPresignedURL } = require("./util.js");
const pLimit = require("p-limit").default;
const { v4: uuidv4 } = require("uuid");
const fs = require("fs");
const path = require("path");
const mime = require("mime-types");

const {
  AdminConfirmSignUpCommand,
  AdminCreateUserCommand,
  AdminSetUserPasswordCommand,
  AdminUpdateUserAttributesCommand,
  AuthFlowType,
  CognitoIdentityProviderClient,
  GetUserCommand,
  InitiateAuthCommand,
  MessageActionType,
  RevokeTokenCommand,
  AdminDeleteUserCommand,
  AdminGetUserCommand,
  ListUsersCommand,
} = require("@aws-sdk/client-cognito-identity-provider");

// let UserPoolId = process.env.USER_POOL_ID;
// let ClientId = process.env.CLIENT_ID;
// let region = process.env.REGION;
// let userPool = new CognitoUserPool({UserPoolId: this.UserPoolId,ClientId: this.ClientId});
// let providerClient = new CognitoIdentityProviderClient({region: this.region});
const EmailTemplate = {
  TASK_ASSIGNED_INVITATION_TO_EMPLOYEE:
    "TaskAssignedInvitationToEmployeeTemplate",
  LOGIN_LINK: "https://hcm.veytan.com/signin-new?",
  ADDRESS_REMINDER: "AddressReminderTemplate",
};

async function checkUserExistsByEmail(email) {
  try {
    const command = new ListUsersCommand({
      UserPoolId: userPoolId,
      Filter: `email = "${email}"`,
      Limit: 1,
    });

    const response = await client.send(command);

    if (response.Users && response.Users.length > 0) {
      console.log("✅ User found:", response.Users[0].Username);
      return true;
    }

    console.log("User not found");
    return false;
  } catch (error) {
    console.error("Error checking user:", error);
    throw error;
  }
}

app.post("/create_user_excel", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }
    let userData = await User.findAll({});
    const workbook = xlsx.read(req.file.buffer, { type: "buffer" });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const rows = xlsx.utils.sheet_to_json(sheet);

    let bulkCreate = [];
    rows.map((row) => {
      let email = row["email"];
      let exists = userData.find(
        (da) => da.email.toLowerCase() === email.toLowerCase()
      );
      let bulkexists = bulkCreate.find((d) => d.email === email);
      if (!exists && !bulkexists) {
        bulkCreate.push({
          name: row["name"],
          email: row["email"],
          mobile_number: `+91${row["Contact Number"]}`,
          designation: "RM",
          role_id: [],
          corporation_id: 3,
          is_active: false,
          is_first_time_login: true,
          is_external: true,
        });
      } else {
        console.log(`duplicate email:${email}`);
      }
    });

    await User.bulkCreate(bulkCreate);

    // const createParams = {
    //   UserPoolId: this.UserPoolId,
    //   Username: email,
    //   TemporaryPassword: password,
    //   UserAttributes: [
    //     {
    //       Name: 'email',
    //       Value: email,
    //     },
    //     {
    //       Name: 'phone_number',
    //       Value: phone_number,
    //     },
    //     {
    //       Name: 'email_verified',
    //       Value: 'true',
    //     },
    //     {
    //       Name: 'phone_number_verified',
    //       Value: 'true'
    //     }
    //   ],
    //   MessageAction: MessageActionType.SUPPRESS,
    // };
    // const createUserCommand = new AdminCreateUserCommand(createParams);
    // const createUserResult = await this.providerClient.send(createUserCommand);
    // const setPasswordParams = {
    //   UserPoolId: this.UserPoolId,
    //   Username: email,
    //   Password: password,
    //   Permanent: true,
    // };

    // const setPasswordCommand = new AdminSetUserPasswordCommand(setPasswordParams);
    // await this.providerClient.send(setPasswordCommand);

    res.json({
      message: "Users inserted successfully",
      count: bulkCreate.length,
    });
  } catch (err) {
    console.error("Upload error:", err);
    res.status(500).json({ error: "Something went wrong" });
  }
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

app.post("/invite-user", async (req, res) => {
  try {
    let data = await User.findAll({
      where: {
        id: {
          [Op.in]: [
            176869, 176877, 176879, 176883, 177557, 186420, 190306, 170389,
            196602, 197086, 197408, 172016, 171147, 179987, 194305, 194640,
            196604, 199268, 326961, 183354, 201432, 201701, 327261, 327294,
            327444, 339801, 339804, 339805, 340262, 339897, 339875, 338657,
            341580,
          ],
        },
      },
    });

    for (const da of data) {
      let template = "SignUpTemplate";
      let encodedEmail = Buffer.from(da.email).toString("base64");

      let sendData = {
        candidate_name: da.name,
        login_link: "https://hcm.veytan.com/signin-new?", //"https://q.me-qr.com/pVIxCeN3",
        company_name: "Imagimake",
      };

      await sendTemplatedEmail(da.email, template, sendData);
      await sleep(50);
    }

    res.json({
      message: "Users invited successfully",
    });
  } catch (err) {
    console.error("Upload error:", err);
    res.status(500).json({ error: "Something went wrong" });
  }
});

app.post("/upload-documents", upload.single("file"), async (req, res) => {
  try {
    // if (!req.file) {
    //   return res.status(400).json({ message: "ZIP file is required" });
    // }
    // const zipPath = req.file.path;
    // const directory = await unzipper.Open.file(zipPath);
    // const limit = pLimit(20);

    // console.log(`Found ${directory.files.length} files in ZIP`);
    let pfData = await PFOnboarding.findAll();
    let uploadedCount = 0;
    let skippedCount = [];
    let failed = [];

    for (const da of pfData) {
      await PFProfile.update(
        { esic_documents: da.esic_documents },
        { where: { candidate_id: da.candidate_id } }
      );
    }
    // await Promise.all(
    //   directory.files.map((entry) =>
    //     limit(async () => {
    //       if (entry.path.endsWith("/")) return;

    //       const fileId = uuidv4();
    //       const filename = path.basename(entry.path);
    //       const ext = path.extname(filename);

    //       const parts = filename.split("-");
    //       const employeeCode = parts[0]?.trim();

    //       if (!employeeCode) {
    //         skippedCount.push({
    //           error: `No employee code found in ${filename}`,
    //         });
    //         console.warn(`No employee code found in ${filename}`);
    //         return;
    //       }

    //       const employee = await Employee.findOne({
    //         where: { employee_code: employeeCode },
    //       });

    //       if (!employee) {
    //         skippedCount.push({
    //           error: `Employee not found for code: ${employeeCode} -> ${filename} `,
    //         });
    //         console.warn(`Employee not found for code: ${employeeCode}`);
    //         return;
    //       }

    //       const buffer = await entry.buffer();
    //       const s3Key = `Employee_Document/Personal_Documents/ESIC_Documents/${fileId}${ext}`;
    //       const mimeType = mime.lookup(entry.path);
    //       const fileSizeBytes = buffer.length;
    //       const fileSizeKB = fileSizeBytes / 1024;
    //       try {
    //         const fileUrl = await uploadToS3(buffer, s3Key);
    //         const presigned_url = await getPresignedURL(s3Key);
    //         const fileDetails = {
    //           file_url: fileUrl,
    //           file_id: fileId,
    //           file_path: s3Key,
    //           file_name: filename,
    //           file_size: fileSizeKB,
    //           file_type: mimeType,
    //           file_size_in_bytes: fileSizeBytes,
    //           presigned_url: presigned_url,
    //         };

    //         let existspf = await PFProfile.findOne({
    //           where: {
    //             candidate_id: employee.candidate_id,
    //           },
    //         });
    //         let existspfOn = await PFOnboarding.findOne({
    //           where: {
    //             candidate_id: employee.candidate_id,
    //           },
    //         });

    //         if (!existspf) {
    //           await PFProfile.create({
    //             candidate_id: employee.candidate_id,
    //             esic_documents: [fileDetails],
    //           });
    //         } else {
    //           let newesic = existspf.esic_documents
    //             ? existspf.esic_documents
    //             : [];
    //           newesic.push(fileDetails);
    //           await PFProfile.update(
    //             {
    //               esic_documents: newesic,
    //             },
    //             {
    //               where: {
    //                 candidate_id: employee.candidate_id,
    //               },
    //             }
    //           );
    //         }

    //         if (!existspfOn) {
    //           await PFOnboarding.create({
    //             candidate_id: employee.candidate_id,
    //             esic_documents: [fileDetails],
    //           });
    //         } else {
    //           let newesic = existspfOn.esic_documents
    //             ? existspfOn.esic_documents
    //             : [];
    //           newesic.push(fileDetails);
    //           await PFOnboarding.update(
    //             {
    //               esic_documents: newesic,
    //             },
    //             {
    //               where: {
    //                 candidate_id: employee.candidate_id,
    //               },
    //             }
    //           );
    //         }

    //         uploadedCount++;
    //         console.log(`Uploaded: ${filename} → ${employeeCode}`);
    //       } catch (err) {
    //         failed.push(filename);
    //         console.error(`Failed: ${filename} -> ${employeeCode}`, err);
    //       }
    //     })
    //   )
    // );

    //fs.unlinkSync(zipPath);
    res.json({
      message: "Documents processed successfully",
      uploadedCount,
      skippedCount,
      failedCount: failed.length,
      failedFiles: failed,
    });
  } catch (error) {
    console.error("Error in upload-documents:", error);
    res
      .status(500)
      .json({ message: "Internal Server Error", error: error.message });
  }
});

app.post("/task_assign", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }
    const workbook = xlsx.read(req.file.buffer, { type: "buffer" });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const rows = xlsx.utils.sheet_to_json(sheet);
    const employeeCodes = rows.map((row) =>
      row["employee_code"].toString().trim()
    );
    const employees = await Employee.findAll({
      where: {
        corporation_id: 3,
        employee_code: employeeCodes,
      },
      attributes: [
        "employee_code",
        "candidate_id",
        "employee_id",
        "first_name",
        "joining_date",
        "legal_entity_id",
        "sub_entity_id",
        "corporation_id",
        "personal_email",
        "work_email",
      ],
      raw: true,
    });

    const employeeMap = new Map();
    for (const emp of employees) {
      employeeMap.set(emp.employee_code, emp);
    }

    const candidateIds = employees.map((emp) => emp.candidate_id);
    const employeeTasks = await EmployeeTasksOnboarding.findAll({
      where: { assigned_to: candidateIds },
      attributes: ["assigned_to", "task_id"],
      raw: true,
    });

    const taskMap = new Map();
    for (const task of employeeTasks) {
      if (!taskMap.has(task.assigned_to)) {
        taskMap.set(task.assigned_to, []);
      }
      taskMap.get(task.assigned_to).push(task.task_id);
    }
    const BATCH_SIZE = 1000;

    const allOnboardingTasks = await TaskMasterOnboarding.findAll({
      where: {
        group: "onboarding",
        task_for: "Employee",
        corporation_id: 3,
        is_active: true,
      },
      raw: true,
    });

    const onboardingTaskIds = allOnboardingTasks.map((t) => t.id);

    const allEntitiesConfig = await TaskEntitiesConfig.findAll({
      where: { task_id: onboardingTaskIds },
      attributes: [
        "task_id",
        "legal_entity_id",
        "sub_entity_id",
        "all_entities",
      ],
      raw: true,
    });

    const legalEntities = await LegalEntityMaster.findAll({
      where: {},
      attributes: ["id", "name"],
      raw: true,
    });
    const legalEntityMap = new Map(legalEntities.map((e) => [e.id, e]));
    const today = new Date().toISOString().slice(0, 10);
    const emailLogs = await EmailLogs.findAll({
      where: {
        email_template: EmailTemplate.ADDRESS_REMINDER,
        sent_at: today,
      },
      attributes: ["employee_id"],
      raw: true,
    });
    let notprocessed = [];
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch = rows.slice(i, i + BATCH_SIZE);

      const promises = batch.map(async (row) => {
        const emp = employeeMap.get(row["employee_code"].toString().trim());
        if (!emp) {
          notprocessed.push({
            error: "employee data not found",
            employee_code: row["employee_code"],
          });
          return;
        }

        const sentEmailSet = new Set(emailLogs.map((e) => e.employee_id));

        const tasksToAssign = allOnboardingTasks.filter((t) => {
          const entityMatch = allEntitiesConfig.find(
            (config) =>
              config.task_id === t.id &&
              (config.all_entities ||
                (config.legal_entity_id === emp.legal_entity_id &&
                  (!config.sub_entity_id ||
                    config.sub_entity_id === emp.sub_entity_id)))
          );
          return entityMatch;
        });

        const alreadyAssignedTasks = new Set(
          taskMap.get(emp.candidate_id) || []
        );

        let newTasksToAssign = tasksToAssign.filter((t) => t.id === 241);

        if (tasksToAssign.length === 0) return;

        const bulkInsertTasks = [];
        const taskTemplate = [];

        for (const task of newTasksToAssign) {
          if (task.due_date.includes("joining")) {
            const [days] = task.due_date.split(" ");
            const joinDate = new Date(emp.joining_date);
            const dueDate = new Date(joinDate);
            dueDate.setDate(joinDate.getDate() + parseInt(days));

            const cutoff = new Date();
            cutoff.setDate(cutoff.getDate() + 14);

            if (dueDate <= cutoff) {
              bulkInsertTasks.push({
                task_id: task.id,
                assigned_to: emp.candidate_id,
                due_date: "2025-12-24",
              });
              taskTemplate.push({
                name: task.name,
                due_date: "2025-12-24",
              });
            }
          }
        }

        if (bulkInsertTasks.length > 0) {
          await EmployeeTasksOnboarding.bulkCreate(bulkInsertTasks);
        }

        // Send email per employee
        if (!sentEmailSet.has(emp.employee_id)) {
          const legalEntityName = legalEntityMap.get(emp.legal_entity_id)?.name;

          // try {
          //   await sendTemplatedEmail(
          //     emp.work_email || emp.personal_email,
          //     EmailTemplate.TASK_ASSIGNED_INVITATION_TO_EMPLOYEE,
          //     {
          //       employee_name: emp.first_name,
          //       company_name: legalEntityName,
          //       tasks: taskTemplate,
          //       login_link: `${EmailTemplate.LOGIN_LINK}${Buffer.from(
          //         emp.work_email
          //       ).toString("base64")}`,
          //     }
          //   );

          //   await EmailLogs.create({
          //     employee_id: emp.employee_id,
          //     email_template:
          //       EmailTemplate.TASK_ASSIGNED_INVITATION_TO_EMPLOYEE,
          //     sent_at: today,
          //     status: "sent",
          //   });
          // } catch (err) {
          //   console.error(`Failed to send email to ${emp.first_name}`, err);
          //   await EmailLogs.create({
          //     employee_id: emp.employee_id,
          //     email_template:
          //       EmailTemplate.TASK_ASSIGNED_INVITATION_TO_EMPLOYEE,
          //     sent_at: today,
          //     status: "failed",
          //   });
          // }
        }
      });

      await Promise.all(promises);
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }

    res.json({
      message: "Data Processed Successfully",
      notProcessed: notprocessed,
    });
  } catch (err) {
    console.error("Error while processing task assignments:", err);
    throw new Error(`Failed To Assign Tasks: ${err}`);
  }
});

app.post("/leave_accrual", async (req, res) => {
  try {
    let employeeData = await Employee.findAll({
      where: {
        employee_id: {
          [Op.in]: [
            366685, 366684, 366683, 366682, 366681, 366680, 366679, 366678,
            366677, 366676, 366675, 366674, 366673, 366672, 366671, 366670,
            366669, 366668, 366667, 366666, 366665, 366664, 366663, 366662,
            366653, 366652, 366651, 366650, 366649, 366648, 366647, 366646,
            366645, 366644, 366643, 366642, 366641, 366640, 366639, 366638,
            366637, 366636, 366635, 366634, 366633, 366632, 366631, 366630,
          ],
        },
      },
      attributes: ["employee_id", "corporation_id", "legal_entity_id"],
    });
    await Promise.all(
      employeeData.map(async (da) => {
        let bulk = [
          {
            employee_id: da.employee_id,
            corporation_id: da.corporation_id,
            legal_entity_id: da.legal_entity_id,
            leave_plan_id: 34,
            leave_type_id: 4,
            month: 11,
            year: 2025,
            leave_accrued_count: 15,
            total_accrued_count: 15,
            accrual_type: "yearly",
            limit: 15,
            leave_type_start_from: "2025-11-01 18:30:00.000 +00:00",
            is_active: true,
          },
          {
            employee_id: da.employee_id,
            corporation_id: da.corporation_id,
            legal_entity_id: da.legal_entity_id,
            leave_plan_id: 34,
            leave_type_id: 3,
            month: 11,
            year: 2025,
            leave_accrued_count: 3,
            total_accrued_count: 3,
            accrual_type: "quarterly",
            limit: 15,
            leave_type_start_from: "2025-11-01 18:30:00.000 +00:00",
            is_active: true,
          },
          {
            employee_id: da.employee_id,
            corporation_id: da.corporation_id,
            legal_entity_id: da.legal_entity_id,
            leave_plan_id: 34,
            leave_type_id: 1,
            month: 11,
            year: 2025,
            leave_accrued_count: 1,
            total_accrued_count: 1,
            accrual_type: "monthly",
            limit: 12,
            leave_type_start_from: "2025-11-01 18:30:00.000 +00:00",
            is_active: true,
          },
        ];
        await LeaveAccrual.bulkCreate(bulk);
      })
    );

    res.json({
      message: "Data Processed Successfully",
    });
  } catch (err) {
    console.error("Error while processing task assignments:", err);
    throw new Error(`Failed To Assign Tasks: ${err}`);
  }
});

app.post("/bulk_exit", upload.single("file"), async (req, res) => {
  try {
    let employeeData = await Employee.findAll({
      where: {
        corporation_id: 36,
      },
      attributes: ["employee_id", "employee_code","candidate_id",'legal_entity_id','corporation_id'],
    });

    const workbook = xlsx.read(req.file.buffer, { type: "buffer" });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const rowData = xlsx.utils.sheet_to_json(sheet);

    let bulkCreate = [];
    const baseUrl = 'https://apis.veytan.com/prod'
    for (let row in rowData) {
      let employee_code = row["employee_code"];
      let exists = employeeData.find(
        (da) => da.employee_code === employee_code.toString().trim()
      );
      const last_working_date = new Date(row["last_working_day"]);
      const exit_initiated_date = new Date(row["exit_initiated_day"]);
      const formatted = last_working_date.toISOString().split('T')[0];
      if (exists) {
        bulkCreate.push({
          mode_of_exit: "EXIT_RESIGNATION",
          advance_notice_provided: false,
          employee_id: exists.employee_id,
          exit_reason_id: 1,
          last_working_date: last_working_date,
          comment: "exit",
          status: "approved",
          is_approver_changed_last_working_date: true,
          notice_by_policy_last_working_date: last_working_date,
          action_by: 6,
          action_by_type: "user",
          exit_initiated_date: exit_initiated_date,
        });
      }
      await Employee.update({
        status: 'Inactive'
      },{
        where:{
          employee_code: employee_code
        }
      }),
      await User.update({
        is_active: false
      },{
        where:{
          candidate_id: exists.candidate_id
        }
      })

      await axios.post(
        `${baseUrl}/api/payroll/inputs/exits/create`,
        {
          employees: [
            {
              client_id: 0,
              le_id: exists.legal_entity_id,
              emp_id: exists.employee_id,
              org_id: exists.corporation_id,
              dol: formatted,
            },
          ],
        },
      );
    }
    await EmployeeExitDetails.bulkCreate(bulkCreate);
    res.json({
      message: "Bulk Exit Processed Successfully",
    });
  } catch (err) {
    console.error("Error while processing bulk exit:", err);
    throw new Error(`Error while processing bulk exit: ${err}`);
  }
});

app.listen(3020, async () => {
  try {
    await sequelize.authenticate();
    console.log("Connected to Database");
  } catch (err) {
    console.error("DB Connection failed:", err);
  }
  console.log("Server running on port 3020");
});
