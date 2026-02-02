import { SESClient, SendTemplatedEmailCommand } from "@aws-sdk/client-ses";

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

export { sendTemplatedEmail };
