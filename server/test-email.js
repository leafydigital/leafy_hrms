
import "dotenv/config";
import nodemailer from "nodemailer";

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT || 587),
  secure: String(process.env.SMTP_SECURE || "false") === "true",
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

try {
  await transporter.verify();
  console.log("SMTP connection successful!");

  const info = await transporter.sendMail({
    from: `Leafy Digital HRMS <${process.env.MAIL_FROM}>`,
    to: "vimal@leafydigital.in",
    subject: "HRMS Email Test",
    text: "Test successful! Leafy Digital HRMS can send email notifications.",
  });

  console.log("Email accepted by SMTP server:", info.messageId);
} catch (error) {
  console.error("Email test failed:", error.message);
}
