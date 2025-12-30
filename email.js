import { SESClient, SendTemplatedEmailCommand } from "@aws-sdk/client-ses";

const sesClient = new SESClient({ region: "ap-south-1" });

async function sendTemplatedEmail(
  recipientEmail,
  templateName,
  templateData,
){
  const params = {
    Source: "apps@veytan.com",
    Destination: {
      ToAddresses: Array.isArray(recipientEmail) ? recipientEmail : [recipientEmail],
    },
    Template: templateName,
    TemplateData: JSON.stringify(templateData),
  };

  try {
    const command = new SendTemplatedEmailCommand(params);
    const result = await sesClient.send(command);
    console.log(`Email sent successfully to ${recipientEmail}. SES response:`, result);
  } catch (error) {
    console.error(`Failed to send templated email to ${recipientEmail}:`, error);
    throw error;
  }
}

export { sendTemplatedEmail };
