import { SESClient, SendTemplatedEmailCommand } from "@aws-sdk/client-ses";
import AWS from "aws-sdk";
import dotenv from "dotenv";

// Load .env variables
dotenv.config();
export async function sendTemplatedEmail(
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

AWS.config.update({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_KEY,
  region: process.env.REGION,
});

export const s3 = new AWS.S3();

export const uploadToS3 = async (
  buffer,
  key,
  contentType = "application/pdf",
) => {
  const params = {
    Bucket: process.env.S3_BUCKET,
    Key: key,
    Body: buffer,
    ContentType: contentType,
  };
  const { Location } = await s3.upload(params).promise();
  return Location;
};

export const getPresignedURL = async (key, expiresIn = 900) => {
  const params = {
    Bucket: process.env.S3_BUCKET,
    Key: key,
    Expires: expiresIn,
  };
  const url = await s3.getSignedUrlPromise("getObject", params);
  return url;
};
