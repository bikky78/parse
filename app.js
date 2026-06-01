// app.js
require("dotenv").config();
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
  CandidateCustomFormConfig,
} = require("./db");
const { sendTemplatedEmail, sendRawEmail } = require("./email.js");
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

let UserPoolId = process.env.USER_POOL_ID;
let ClientId = process.env.CLIENT_ID;
let region = process.env.REGION;
let providerClient = new CognitoIdentityProviderClient({ region: region });
const EmailTemplate = {
  TASK_ASSIGNED_INVITATION_TO_EMPLOYEE:
    "TaskAssignedInvitationToEmployeeTemplate",
  LOGIN_LINK: "https://hcm.veytan.com/signin-new?",
  ADDRESS_REMINDER: "AddressReminderTemplate",
};

async function checkUserExistsByEmail(email) {
  try {
    const command = new ListUsersCommand({
      UserPoolId: UserPoolId,
      Filter: `email = "${email}"`,
      Limit: 1,
    });

    const response = await providerClient.send(command);

    if (response.Users && response.Users.length > 0) {
      console.log("User found:", response.Users[0].Username);
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
    const skipCognitoEmails = new Set();

    for (const row of rows) {
      let email = row["email"];
      let existsInDB = userData.find(
        (da) => da.email.toLowerCase() === email.toLowerCase(),
      );
      let bulkexists = bulkCreate.find((d) => d.email === email);

      const existsInCognito = await checkUserExistsByEmail(email);
      if (existsInCognito) {
        skipCognitoEmails.add(email.toLowerCase());
      }

      if (existsInDB || bulkexists) {
        console.log(`duplicate email:${email}`);
        continue;
      }

      bulkCreate.push({
        name: row["name"],
        email: row["email"],
        mobile_number: `+91${row["Contact Number"]}`,
        designation: "RM",
        role_id: [],
        corporation_id: 1460,
        is_active: true,
        is_first_time_login: true,
        is_external: true,
      });
    }

    await User.bulkCreate(bulkCreate, { ignoreDuplicates: true });

    for (const user of bulkCreate) {
      if (skipCognitoEmails.has(user.email.toLowerCase())) {
        console.log(
          `email already in Cognito, skipping Cognito creation:${user.email}`,
        );
        continue;
      }
      try {
        const createParams = {
          UserPoolId: UserPoolId,
          Username: user.email,
          UserAttributes: [
            { Name: "email", Value: user.email },
            { Name: "phone_number", Value: user.mobile_number },
            { Name: "email_verified", Value: "true" },
            { Name: "phone_number_verified", Value: "true" },
          ],
          MessageAction: MessageActionType.SUPPRESS,
        };
        const createUserCommand = new AdminCreateUserCommand(createParams);
        await providerClient.send(createUserCommand);

        const setPasswordParams = {
          UserPoolId: UserPoolId,
          Username: user.email,
          Password: "Buzzworks@123",
          Permanent: true,
        };
        const setPasswordCommand = new AdminSetUserPasswordCommand(
          setPasswordParams,
        );
        await providerClient.send(setPasswordCommand);
      } catch (cognitoErr) {
        console.error(
          `Failed to create Cognito user for ${user.email}:`,
          cognitoErr,
        );
      }
    }

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

app.post("/invite-user", upload.single("file"), async (req, res) => {
  const emailNotSend = [];
  const successEmails = [];
  const skippedEmails = [];

  try {
    // 1. Validate file exists
    if (!req.file || !req.file.buffer) {
      return res.status(400).json({
        error: "No file uploaded",
        message: "Please upload an Excel file",
      });
    }

    // 2. Validate file type (optional but recommended)
    const allowedTypes = [
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.ms-excel",
    ];
    if (!allowedTypes.includes(req.file.mimetype)) {
      return res.status(400).json({
        error: "Invalid file type",
        message: "Please upload a valid Excel file (.xlsx, .xls)",
      });
    }

    // 3. Parse Excel file
    const workbook = xlsx.read(req.file.buffer, { type: "buffer" });

    if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
      return res.status(400).json({
        error: "Invalid Excel file",
        message: "The Excel file does not contain any sheets",
      });
    }

    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const rows = xlsx.utils.sheet_to_json(sheet);

    // 4. Validate rows and email column
    if (rows.length === 0) {
      return res.status(400).json({
        error: "Empty file",
        message: "The Excel file does not contain any data",
      });
    }

    // Check if Email column exists
    const firstRow = rows[0];
    if (!firstRow.hasOwnProperty("Email")) {
      return res.status(400).json({
        error: "Missing column",
        message: "The Excel file must contain an 'Email' column",
      });
    }

    // 5. Extract and validate emails
    const emailSet = new Set();

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNumber = i + 2; // +2 because Excel is 1-indexed and header is row 1

      // Check if Email field exists and is valid
      if (!row["Email"] || typeof row["Email"] !== "string") {
        emailNotSend.push({
          email: `Row ${rowNumber}: ${row["Email"] || "No email"}`,
          reason: "Invalid or missing email value",
        });
        continue;
      }

      let email = row["Email"].trim();

      // Skip empty emails
      if (!email) {
        emailNotSend.push({
          email: `Row ${rowNumber}: Empty`,
          reason: "Empty email address",
        });
        continue;
      }

      // Basic email validation
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        emailNotSend.push({
          email: `Row ${rowNumber}: ${email}`,
          reason: "Invalid email format",
        });
        continue;
      }

      // Check for duplicates in the file
      if (emailSet.has(email.toLowerCase())) {
        skippedEmails.push({
          email: email,
          reason: "Duplicate email in file",
          row: rowNumber,
        });
        continue;
      }

      emailSet.add(email.toLowerCase());

      // 6. Find user in database
      let userData;
      try {
        userData = await User.findOne({
          where: {
            email: {
              [Op.iLike]: email,
            },
          },
        });
      } catch (dbError) {
        console.error(`Database error for email ${email}:`, dbError);
        emailNotSend.push({
          email: email,
          reason: "Database error",
        });
        continue;
      }

      if (!userData) {
        emailNotSend.push({
          email: email,
          reason: "User not found in database",
        });
        continue;
      }

      // 7. Send invitation email
      try {
        let template = "EmployeeMigrationInvitationTemplate";
        let sendData = {
          candidate_name: userData.name || "User",
          login_link: "https://hcm.veytan.com/signin-new?",
          company_name: "IDFC",
        };

        // Add timeout for email sending
        await Promise.race([
          sendTemplatedEmail(
            userData.email,
            template,
            sendData,
            ["yuvaraj@buzzworks.com"],
            ["yuvaraj@buzzworks.com"],
          ),
          new Promise(
            (_, reject) =>
              setTimeout(
                () => reject(new Error("Email sending timeout")),
                30000,
              ), // 30-second timeout
          ),
        ]);

        successEmails.push(email);

        // Optional: Rate limiting delay
        if (rows.length > 10) {
          await sleep(50);
        }
      } catch (emailError) {
        console.error(`Failed to send email to ${email}:`, emailError);
        emailNotSend.push({
          email: email,
          reason: `Email sending failed: ${emailError.message}`,
        });
      }
    }

    // 8. Prepare response
    const response = {
      message: "Invitation process completed",
      summary: {
        totalRows: rows.length,
        uniqueEmailsProcessed: emailSet.size,
        invitationsSent: successEmails.length,
        failedToSend: emailNotSend.length,
        skippedDuplicates: skippedEmails.length,
      },
      details: {
        successfulEmails: successEmails,
        failedEmails: emailNotSend,
        skippedEmails: skippedEmails,
      },
    };

    // 9. Log the result (optional)
    console.log(
      `Invitation process completed: ${successEmails.length} sent, ${emailNotSend.length} failed`,
    );

    res.json(response);
  } catch (err) {
    console.error("Upload error:", err);

    // Provide more specific error messages
    let errorMessage = "Something went wrong";
    let statusCode = 500;

    if (err instanceof xlsx.error) {
      errorMessage = "Invalid Excel file format";
      statusCode = 400;
    } else if (err.code === "LIMIT_FILE_SIZE") {
      errorMessage = "File too large. Maximum size is 5MB";
      statusCode = 400;
    }

    res.status(statusCode).json({
      error: errorMessage,
      details: process.env.NODE_ENV === "development" ? err.message : undefined,
    });
  }
});

// app.post("/invite-user", async (req, res) => {
//   let email = "sudharanie@bbspl.in";
//   let userData;
//   try {
//     userData = await User.findOne({
//       where: {
//         email: {
//           [Op.iLike]: email,
//         },
//       },
//     });
//   } catch (dbError) {
//     console.error(`Database error for email ${email}:`, dbError);
//   }

//   // 7. Send invitation email
//   try {
//     let template = "SignUpTemplate";
//     let sendData = {
//       candidate_name: userData.name || "User",
//       login_link: "https://hcm.veytan.com/signin-new?",
//       company_name: "RBL BANK LIMITED",
//     };

//     // Add timeout for email sending
//     await Promise.race([
//       sendTemplatedEmail(
//         userData.email,
//         template,
//         sendData,
//         ["hema@buzzworks.com"],
//         ["hema@buzzworks.com"],
//       ),
//       new Promise((_, reject) =>
//         setTimeout(() => reject(new Error("Email sending timeout")), 30000),
//       ),
//     ]);
//     res.status(200).json({ message: "Invitation Send Successfully" });
//   } catch (emailError) {
//     console.error(`Failed to send email to ${email}:`, emailError);
//   }
// });

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
        { where: { candidate_id: da.candidate_id } },
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
      row["employee_code"].toString().trim(),
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
                    config.sub_entity_id === emp.sub_entity_id))),
          );
          return entityMatch;
        });

        const alreadyAssignedTasks = new Set(
          taskMap.get(emp.candidate_id) || [],
        );

        let newTasksToAssign = tasksToAssign.filter((t) => t.id === 736);

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
                due_date: "2026-05-31",
              });
              taskTemplate.push({
                name: task.name,
                due_date: "2026-05-31",
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

          try {
            await sendTemplatedEmail(
              emp.work_email || emp.personal_email,
              EmailTemplate.TASK_ASSIGNED_INVITATION_TO_EMPLOYEE,
              {
                employee_name: emp.first_name,
                company_name: legalEntityName,
                tasks: taskTemplate,
                login_link: `${EmailTemplate.LOGIN_LINK}${Buffer.from(
                  emp.work_email,
                ).toString("base64")}`,
              },
            );

            await EmailLogs.create({
              employee_id: emp.employee_id,
              email_template:
                EmailTemplate.TASK_ASSIGNED_INVITATION_TO_EMPLOYEE,
              sent_at: today,
              status: "sent",
            });
          } catch (err) {
            console.error(`Failed to send email to ${emp.first_name}`, err);
            await EmailLogs.create({
              employee_id: emp.employee_id,
              email_template:
                EmailTemplate.TASK_ASSIGNED_INVITATION_TO_EMPLOYEE,
              sent_at: today,
              status: "failed",
            });
          }
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
      }),
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
      attributes: [
        "employee_id",
        "employee_code",
        "candidate_id",
        "legal_entity_id",
        "corporation_id",
      ],
    });

    const workbook = xlsx.read(req.file.buffer, { type: "buffer" });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const rowData = xlsx.utils.sheet_to_json(sheet);

    let bulkCreate = [];
    const baseUrl = "https://apis.veytan.com/prod";
    for (let row in rowData) {
      let employee_code = row["employee_code"];
      let exists = employeeData.find(
        (da) => da.employee_code === employee_code.toString().trim(),
      );
      const last_working_date = new Date(row["last_working_day"]);
      const exit_initiated_date = new Date(row["exit_initiated_day"]);
      const formatted = last_working_date.toISOString().split("T")[0];
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
      (await Employee.update(
        {
          status: "Inactive",
        },
        {
          where: {
            employee_code: employee_code,
          },
        },
      ),
        await User.update(
          {
            is_active: false,
          },
          {
            where: {
              candidate_id: exists.candidate_id,
            },
          },
        ));

      await axios.post(`${baseUrl}/api/payroll/inputs/exits/create`, {
        employees: [
          {
            client_id: 0,
            le_id: exists.legal_entity_id,
            emp_id: exists.employee_id,
            org_id: exists.corporation_id,
            dol: formatted,
          },
        ],
      });
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

app.post("/send-raw-email", upload.single("file"), async (req, res) => {
  try {
    await sendRawEmail({
      to: ["bikky.kumar@buzzworks.com"],
      cc: ["bikky.kumar@buzzworks.com"],
      replyTo: ["bikky.kumar@buzzworks.com"],
      subject: "Welcome to Veytan",
      htmlBody: `
    <h2>Hello Bikky</h2>
    <p>Your account has been created successfully.</p>
  `,
      attachments: [
        {
          path: "./AboliBallal_CV.pdf",
          mimeType: "application/pdf",
        },
      ],
    });
    res.json({
      message: "Email Sent",
    });
  } catch (err) {
    throw new Error(`Error while Sending Email: ${err}`);
  }
});

app.post("/update-branch-details", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    const workbook = xlsx.read(req.file.buffer, { type: "buffer" });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const rows = xlsx.utils.sheet_to_json(sheet);

    const updated = [];
    const skipped = [];
    const notFound = [];

    for (const row of rows) {
      const candidateId = row["Candidate ID"];
      const branchName = row["Branch Name"];
      const branchAddress = row["Branch Address"];

      if (!candidateId) {
        skipped.push({ row, reason: "Missing Candidate ID" });
        continue;
      }

      const record = await CandidateCustomFormConfig.findOne({
        where: { candidate_id: candidateId, form_id: 199 },
      });

      if (!record) {
        await CandidateCustomFormConfig.create({
          candidate_id: candidateId,
          form_id: 199,
          data: [
            {
              type: "singleSelect",
              label: "Branch Name",
              value: branchName,
              uniqueName: "branch_name",
            },
            {
              type: "dropdown",
              label: "Branch Address",
              value: branchAddress,
              uniqueName: "branch_address",
            },
          ],
        });
        updated.push({ candidateId, action: "created" });
        continue;
      }

      const data = record.data;
      if (!Array.isArray(data)) {
        skipped.push({ candidateId, reason: "data is not an array" });
        continue;
      }

      let changed = false;
      const updatedData = data.map((field) => {
        if (field.uniqueName === "branch_name" && !field.value && branchName) {
          changed = true;
          return { ...field, value: branchName };
        }
        if (
          field.uniqueName === "branch_address" &&
          !field.value &&
          branchAddress
        ) {
          changed = true;
          return { ...field, value: branchAddress };
        }
        return field;
      });

      if (changed) {
        await CandidateCustomFormConfig.update(
          { data: updatedData },
          { where: { id: record.id } },
        );
        updated.push({ candidateId, recordId: record.id });
      } else {
        skipped.push({
          candidateId,
          recordId: record.id,
          reason: "values already set or fields not found",
        });
      }
    }

    res.json({
      message: "Branch details update completed",
      summary: {
        totalRows: rows.length,
        updated: updated.length,
        skipped: skipped.length,
        notFound: notFound.length,
      },
      details: { updated, skipped, notFound },
    });
  } catch (err) {
    console.error("Error updating branch details:", err);
    res
      .status(500)
      .json({ error: "Something went wrong", details: err.message });
  }
});

app.post(
  "/update-employee-dept-desig",
  upload.single("file"),
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No file uploaded" });
      }

      const workbook = xlsx.read(req.file.buffer, { type: "buffer" });
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      const rows = xlsx.utils.sheet_to_json(sheet);

      const updatePayload = [];
      const skipped = [];

      for (const row of rows) {
        const employeeCode = row["employee_code"]?.toString().trim();
        const corporationId = parseInt(row["corporation_id"]);
        const legalEntityId = parseInt(row["legal_entity_id"]);
        const designationId = parseInt(row["designation_id"]);

        if (
          !employeeCode ||
          isNaN(corporationId) ||
          isNaN(legalEntityId) ||
          isNaN(designationId)
        ) {
          skipped.push({
            employeeCode,
            reason: "Missing or invalid column value",
          });
          continue;
        }

        updatePayload.push({
          employeeCode,
          designationId,
          corporationId,
          legalEntityId,
        });
      }

      // Bulk update using VALUES list — one query per chunk of 1000 rows
      const CHUNK_SIZE = 1000;
      let totalUpdated = 0;

      for (let i = 0; i < updatePayload.length; i += CHUNK_SIZE) {
        const chunk = updatePayload.slice(i, i + CHUNK_SIZE);

        const values = chunk
          .map(
            (_, idx) =>
              `($${idx * 4 + 1}, $${idx * 4 + 2}::int, $${idx * 4 + 3}::int, $${idx * 4 + 4}::int)`,
          )
          .join(", ");

        const params = chunk.flatMap((r) => [
          r.employeeCode,
          r.designationId,
          r.corporationId,
          r.legalEntityId,
        ]);

        const sql = `
        UPDATE employee.employee AS e
        SET designation_id = v.designation_id
        FROM (VALUES ${values}) AS v(employee_code, designation_id, corporation_id, legal_entity_id)
        WHERE e.employee_code   = v.employee_code
          AND e.corporation_id  = v.corporation_id
          AND e.legal_entity_id = v.legal_entity_id
      `;

        const [, meta] = await sequelize.query(sql, { bind: params });
        totalUpdated += meta?.rowCount ?? 0;
      }

      // Find unmatched rows — check each condition separately to surface the reason
      const notUpdated = [];
      if (totalUpdated < updatePayload.length) {
        const allCodes = updatePayload.map((r) => r.employeeCode);
        const found = await Employee.findAll({
          where: { employee_code: { [Op.in]: allCodes } },
          attributes: [
            "employee_code",
            "corporation_id",
            "legal_entity_id",
            "status",
          ],
          raw: true,
        });

        const foundMap = new Map();
        for (const e of found) {
          const key = `${e.employee_code}_${e.corporation_id}_${e.legal_entity_id}`;
          foundMap.set(key, e);
        }

        for (const r of updatePayload) {
          const key = `${r.employeeCode}_${r.corporationId}_${r.legalEntityId}`;
          const emp = foundMap.get(key);
          if (!emp) {
            const codeExists = found.find(
              (e) => e.employee_code === r.employeeCode,
            );
            notUpdated.push({
              employeeCode: r.employeeCode,
              reason: codeExists
                ? `corp/legal mismatch — DB has corporation_id:${codeExists.corporation_id} legal_entity_id:${codeExists.legal_entity_id}`
                : "employee_code not found in DB",
            });
          }
        }
      }

      res.json({
        message: "Employee designation update completed",
        summary: {
          totalRows: rows.length,
          totalUpdated,
          notUpdated: notUpdated.length,
          skipped: skipped.length,
        },
        notUpdatedDetails: notUpdated,
        skippedDetails: skipped,
      });
    } catch (err) {
      console.error("Error updating employee dept/desig:", err);
      res
        .status(500)
        .json({ error: "Something went wrong", details: err.message });
    }
  },
);

// ---------------------------------------------------------------------------
// POST /update-employee-pf-uan
// Excel columns: email, corporation_id, pf_id, uan
// Resolves candidate_id from employee.employee using personal_email + corporation_id,
// then bulk-updates both:
//   cs_in.pf_master_onboarding  (pf_id, uan)
//   cs_in.pf_master_profile     (pf_id, uan, corporation_id, personal_email)
// ---------------------------------------------------------------------------
app.post("/update-employee-pf-uan", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    const workbook = xlsx.read(req.file.buffer, { type: "buffer" });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const rows = xlsx.utils.sheet_to_json(sheet);

    const inputPayload = [];
    const skipped = [];

    for (const row of rows) {
      const email = row["email"]?.toString().trim().toLowerCase();
      const corporationId = parseInt(row["corporation_id"]);
      const pfId = row["pf_id"]?.toString().trim() || null;
      const uan = row["uan"]?.toString().trim() || null;

      if (!email || isNaN(corporationId) || (!pfId && !uan)) {
        skipped.push({
          email,
          reason:
            !email || isNaN(corporationId)
              ? "Missing or invalid email / corporation_id"
              : "Both pf_id and uan are empty — nothing to update",
        });
        continue;
      }

      inputPayload.push({ email, corporationId, pfId, uan });
    }

    if (inputPayload.length === 0) {
      return res.json({
        message: "No valid rows to process",
        summary: {
          totalRows: rows.length,
          totalUpdated: 0,
          notUpdated: 0,
          skipped: skipped.length,
        },
        skippedDetails: skipped,
      });
    }

    // ── Step 1: resolve candidate_id via personal_email + corporation_id ──
    const allEmails = inputPayload.map((r) => r.email); // already trimmed + lowercased

    const employees = await Employee.findAll({
      where: {
        [Op.and]: [
          // TRIM + LOWER on DB side handles trailing spaces & mixed case in DB
          sequelize.where(
            sequelize.fn(
              "LOWER",
              sequelize.fn("TRIM", sequelize.col("personal_email")),
            ),
            { [Op.in]: allEmails },
          ),
          { status: "Active" },
        ],
      },
      attributes: [
        "personal_email",
        "corporation_id",
        "candidate_id",
        "status",
      ],
      raw: true,
    });

    // Normalise DB emails (trim + lowercase) for consistent keying
    const empMap = new Map();
    const foundEmailSet = new Set();
    for (const e of employees) {
      const normEmail = e.personal_email?.trim().toLowerCase();
      foundEmailSet.add(normEmail);
      const key = `${normEmail}_${e.corporation_id}`;
      empMap.set(key, { ...e, personal_email: normEmail });
    }

    const updatePayload = []; // rows with resolved candidate_id
    const notResolved = []; // all failure reasons collected here

    // 1. Flag every input email that had zero DB match upfront
    for (const r of inputPayload) {
      if (!foundEmailSet.has(r.email)) {
        notResolved.push({
          email: r.email,
          reason: "email not found in DB (or employee not Active)",
        });
      }
    }

    // 2. For emails that were found, check corp match & candidate_id
    for (const r of inputPayload) {
      if (!foundEmailSet.has(r.email)) continue; // already captured above

      const key = `${r.email}_${r.corporationId}`;
      const emp = empMap.get(key);

      if (!emp) {
        // Email exists in DB but corporation_id doesn't match
        const anyMatch = employees.find(
          (e) => e.personal_email?.trim().toLowerCase() === r.email,
        );
        notResolved.push({
          email: r.email,
          reason: `corporation mismatch — DB has corporation_id:${anyMatch?.corporation_id}`,
        });
        continue;
      }

      if (!emp.candidate_id) {
        notResolved.push({
          email: r.email,
          reason: "employee has no candidate_id",
        });
        continue;
      }

      updatePayload.push({
        ...r,
        candidateId: emp.candidate_id,
        personalEmail: emp.personal_email,
      });
    }

    // ── Step 2: bulk-update both PF tables in chunks of 1000 ─────────────
    const CHUNK_SIZE = 1000;
    let totalUpdatedOnboarding = 0;
    let totalUpdatedProfile = 0;

    for (let i = 0; i < updatePayload.length; i += CHUNK_SIZE) {
      const chunk = updatePayload.slice(i, i + CHUNK_SIZE);

      // pf_master_onboarding — updates pf_id & uan (3 cols)
      const valuesOn = chunk
        .map(
          (_, idx) =>
            `($${idx * 3 + 1}::int, $${idx * 3 + 2}, $${idx * 3 + 3})`,
        )
        .join(", ");

      const paramsOn = chunk.flatMap((r) => [r.candidateId, r.pfId, r.uan]);

      const sqlOnboarding = `
          UPDATE cs_in.pf_master_onboarding AS t
          SET pf_id  = v.pf_id,
              uan = v.uan
          FROM (VALUES ${valuesOn}) AS v(candidate_id, pf_id, uan)
          WHERE t.candidate_id = v.candidate_id
        `;
      const [, metaOn] = await sequelize.query(sqlOnboarding, {
        bind: paramsOn,
      });
      totalUpdatedOnboarding += metaOn?.rowCount ?? 0;

      // pf_master_profile — updates pf_id, uan only (3 cols)
      const valuesPr = chunk
        .map(
          (_, idx) =>
            `($${idx * 3 + 1}::int, $${idx * 3 + 2}, $${idx * 3 + 3})`,
        )
        .join(", ");

      const paramsPr = chunk.flatMap((r) => [r.candidateId, r.pfId, r.uan]);

      const sqlProfile = `
          UPDATE cs_in.pf_master_profile AS t
          SET pf_id      = v.pf_id,
              uan = v.uan
          FROM (VALUES ${valuesPr}) AS v(candidate_id, pf_id, uan)
          WHERE t.candidate_id = v.candidate_id
        `;
      const [, metaPr] = await sequelize.query(sqlProfile, {
        bind: paramsPr,
      });
      totalUpdatedProfile += metaPr?.rowCount ?? 0;
    }

    const notFoundInDB = notResolved.filter((r) =>
      r.reason.startsWith("email not found"),
    );
    const corpMismatch = notResolved.filter((r) =>
      r.reason.startsWith("corporation mismatch"),
    );
    const noCandidate = notResolved.filter((r) =>
      r.reason.startsWith("employee has no candidate_id"),
    );

    res.json({
      message: "Employee PF / UAN update completed",
      summary: {
        totalRows: rows.length,
        validRows: updatePayload.length,
        updatedInOnboarding: totalUpdatedOnboarding,
        updatedInProfile: totalUpdatedProfile,
        notFoundInDB: notFoundInDB.length,
        corporationMismatch: corpMismatch.length,
        noCandidate: noCandidate.length,
        skipped: skipped.length,
      },
      notFoundInDB,
      corporationMismatchDetails: corpMismatch,
      noCandidateDetails: noCandidate,
      skippedDetails: skipped,
    });
  } catch (err) {
    console.error("Error updating employee PF/UAN:", err);
    res
      .status(500)
      .json({ error: "Something went wrong", details: err.message });
  }
});

// ---------------------------------------------------------------------------
// POST /update-employee-bank-details
// Excel columns: email, corporation_id, account_number, ifsc_code, bank_name, account_type
// Resolves candidate_id from employee.employee using personal_email + corporation_id,
// then bulk-updates both:
//   cs_in.bank_master_onboarding  (account_number, ifsc_code, bank_name, account_type)
//   cs_in.bank_master_profile     (account_number, ifsc_code, bank_name, account_type)
// ---------------------------------------------------------------------------
app.post(
  "/update-employee-bank-details",
  upload.single("file"),
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No file uploaded" });
      }

      const workbook = xlsx.read(req.file.buffer, { type: "buffer" });
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      const rows = xlsx.utils.sheet_to_json(sheet);

      const inputPayload = [];
      const skipped = [];

      for (const row of rows) {
        const email = row["email"]?.toString().trim().toLowerCase();
        const corporationId = 714; //parseInt(row["corporation_id"]);
        const bankAccountNumber =
          row["bank_account_number"]?.toString().trim() || null;
        const ifscCode = row["ifsc_code"]?.toString().trim() || null;
        const bankName = row["bank_name"]?.toString().trim() || null;

        if (
          !email ||
          isNaN(corporationId) ||
          (!bankAccountNumber && !ifscCode && !bankName)
        ) {
          skipped.push({
            email,
            reason:
              !email || isNaN(corporationId)
                ? "Missing or invalid email / corporation_id"
                : "All bank fields are empty — nothing to update",
          });
          continue;
        }

        inputPayload.push({
          email,
          corporationId,
          bankAccountNumber,
          ifscCode,
          bankName,
        });
      }

      if (inputPayload.length === 0) {
        return res.json({
          message: "No valid rows to process",
          summary: {
            totalRows: rows.length,
            totalUpdated: 0,
            skipped: skipped.length,
          },
          skippedDetails: skipped,
        });
      }

      // ── Step 1: resolve candidate_id via personal_email + corporation_id ──
      const allEmails = inputPayload.map((r) => r.email);

      const employees = await Employee.findAll({
        where: {
          [Op.and]: [
            sequelize.where(
              sequelize.fn(
                "LOWER",
                sequelize.fn("TRIM", sequelize.col("personal_email")),
              ),
              { [Op.in]: allEmails },
            ),
            { status: "Active" },
          ],
        },
        attributes: [
          "personal_email",
          "corporation_id",
          "candidate_id",
          "status",
        ],
        raw: true,
      });

      const empMap = new Map();
      const foundEmailSet = new Set();
      for (const e of employees) {
        const normEmail = e.personal_email?.trim().toLowerCase();
        foundEmailSet.add(normEmail);
        const key = `${normEmail}_${e.corporation_id}`;
        empMap.set(key, { ...e, personal_email: normEmail });
      }

      const updatePayload = [];
      const notResolved = [];

      for (const r of inputPayload) {
        if (!foundEmailSet.has(r.email)) {
          notResolved.push({
            email: r.email,
            reason: "email not found in DB (or employee not Active)",
          });
        }
      }

      for (const r of inputPayload) {
        if (!foundEmailSet.has(r.email)) continue;

        const key = `${r.email}_${r.corporationId}`;
        const emp = empMap.get(key);

        if (!emp) {
          const anyMatch = employees.find(
            (e) => e.personal_email?.trim().toLowerCase() === r.email,
          );
          notResolved.push({
            email: r.email,
            reason: `corporation mismatch — DB has corporation_id:${anyMatch?.corporation_id}`,
          });
          continue;
        }

        if (!emp.candidate_id) {
          notResolved.push({
            email: r.email,
            reason: "employee has no candidate_id",
          });
          continue;
        }

        updatePayload.push({ ...r, candidateId: emp.candidate_id });
      }

      // ── Step 2: bulk-update both bank tables via unnest (one query each) ───
      let totalUpdatedOnboarding = 0;
      let totalUpdatedProfile = 0;

      if (updatePayload.length > 0) {
        const bindParams = [
          updatePayload.map((r) => r.candidateId), // $1 int[]
          updatePayload.map((r) => r.bankAccountNumber), // $2 text[]
          updatePayload.map((r) => r.ifscCode), // $3 text[]
          updatePayload.map((r) => r.bankName), // $4 text[]
        ];

        const sqlOnboarding = `
          UPDATE cs_in.bank_master_onboarding AS t
          SET bank_account_number = v.bank_account_number,
              bank_ifsc_code      = v.bank_ifsc_code,
              bank_name           = v.bank_name
          FROM unnest($1::int[], $2::text[], $3::text[], $4::text[])
            AS v(candidate_id, bank_account_number, bank_ifsc_code, bank_name)
          WHERE t.candidate_id = v.candidate_id
        `;
        const [, metaOn] = await sequelize.query(sqlOnboarding, {
          bind: bindParams,
        });
        totalUpdatedOnboarding = metaOn?.rowCount ?? 0;

        const sqlProfile = `
          UPDATE cs_in.bank_master_profile AS t
          SET bank_account_number = v.bank_account_number,
              bank_ifsc_code      = v.bank_ifsc_code,
              bank_name           = v.bank_name
          FROM unnest($1::int[], $2::text[], $3::text[], $4::text[])
            AS v(candidate_id, bank_account_number, bank_ifsc_code, bank_name)
          WHERE t.candidate_id = v.candidate_id
        `;
        const [, metaPr] = await sequelize.query(sqlProfile, {
          bind: bindParams,
        });
        totalUpdatedProfile = metaPr?.rowCount ?? 0;
      }

      const notFoundInDB = notResolved.filter((r) =>
        r.reason.startsWith("email not found"),
      );
      const corpMismatch = notResolved.filter((r) =>
        r.reason.startsWith("corporation mismatch"),
      );
      const noCandidate = notResolved.filter((r) =>
        r.reason.startsWith("employee has no candidate_id"),
      );

      res.json({
        message: "Employee bank details update completed",
        summary: {
          totalRows: rows.length,
          validRows: updatePayload.length,
          updatedInOnboarding: totalUpdatedOnboarding,
          updatedInProfile: totalUpdatedProfile,
          notFoundInDB: notFoundInDB.length,
          corporationMismatch: corpMismatch.length,
          noCandidate: noCandidate.length,
          skipped: skipped.length,
        },
        notFoundInDB,
        corporationMismatchDetails: corpMismatch,
        noCandidateDetails: noCandidate,
        skippedDetails: skipped,
      });
    } catch (err) {
      console.error("Error updating employee bank details:", err);
      res
        .status(500)
        .json({ error: "Something went wrong", details: err.message });
    }
  },
);

app.listen(3020, async () => {
  try {
    await sequelize.authenticate();
    console.log("Connected to Database");
  } catch (err) {
    console.error("DB Connection failed:", err);
  }
  console.log("Server running on port 3020");
});
