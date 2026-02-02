import {
  SESClient,
  SendTemplatedEmailCommand,
  SendRawEmailCommand,
} from "@aws-sdk/client-ses";
import fs from "fs";
import path from "path";
import crypto from "crypto";

const sesClient = new SESClient({ region: "ap-south-1" });

async function sendTemplatedEmail(
  recipientEmail,
  templateName,
  templateData,
  ccEmails = [], // optional
  replyToEmails = [], // optional
) {
  const params = {
    Source: "apps@veytan.com",

    Destination: {
      ToAddresses: Array.isArray(recipientEmail)
        ? recipientEmail
        : [recipientEmail],

      CcAddresses: Array.isArray(ccEmails) ? ccEmails : [ccEmails],
    },

    ReplyToAddresses: Array.isArray(replyToEmails)
      ? replyToEmails
      : [replyToEmails],

    Template: templateName,
    TemplateData: JSON.stringify(templateData),
  };

  try {
    const client = new SESClient({ region: "ap-south-1" });
    const command = new SendTemplatedEmailCommand(params);
    const result = await client.send(command);

    console.log(`Email sent successfully to ${recipientEmail}`, result);
  } catch (error) {
    console.error(`Failed to send email to ${recipientEmail}`, error);
    throw error;
  }
}

/**
 * Send email with attachments using AWS SES Raw Email
 */
async function sendRawEmail({
  from = "apps@veytan.com",
  to = [],
  cc = [],
  replyTo = [],
  subject,
  htmlBody,
  attachments = [],
}) {
  const boundary = crypto.randomBytes(16).toString("hex");

  let raw = "";

  raw += `From: ${from}\n`;
  raw += `To: ${to.join(", ")}\n`;
  if (cc.length) raw += `Cc: ${cc.join(", ")}\n`;
  if (replyTo.length) raw += `Reply-To: ${replyTo.join(", ")}\n`;
  raw += `Subject: ${subject}\n`;
  raw += `MIME-Version: 1.0\n`;
  raw += `Content-Type: multipart/mixed; boundary="${boundary}"\n\n`;

  raw += `--${boundary}\n`;
  raw += `Content-Type: text/html; charset="UTF-8"\n`;
  raw += `Content-Transfer-Encoding: 7bit\n\n`;
  raw += `${htmlBody}\n\n`;

  for (const file of attachments) {
    const absolutePath = path.resolve(file.path);

    if (!fs.existsSync(absolutePath)) {
      throw new Error(`Attachment not found: ${absolutePath}`);
    }

    const fileContent = fs.readFileSync(absolutePath).toString("base64");
    const filename = path.basename(absolutePath);

    raw += `--${boundary}\n`;
    raw += `Content-Type: ${file.mimeType}; name="${filename}"\n`;
    raw += `Content-Disposition: attachment; filename="${filename}"\n`;
    raw += `Content-Transfer-Encoding: base64\n\n`;
    raw += `${fileContent}\n\n`;
  }

  raw += `--${boundary}--`;

  const command = new SendRawEmailCommand({
    RawMessage: {
      Data: Buffer.from(raw),
    },
  });

  return sesClient.send(command);
}

export { sendTemplatedEmail, sendRawEmail };
