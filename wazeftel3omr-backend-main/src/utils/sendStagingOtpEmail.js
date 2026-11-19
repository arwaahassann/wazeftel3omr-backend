const dns = require('node:dns/promises');
const net = require('node:net');
const nodemailer = require('nodemailer');

const sendStagingOtpEmail = async ({ email, subject, otpCode }) => {
  const emailUser = process.env.EMAIL_USER;
  const emailPass = process.env.EMAIL_PASS;
  if (!emailUser || !emailPass) {
    return { sent: false, reason: 'NO_CREDENTIALS' };
  }

  const configuredHost = process.env.EMAIL_HOST || 'smtp.gmail.com';
  const address = net.isIP(configuredHost)
    ? { address: configuredHost }
    : await dns.lookup(configuredHost, { family: 4 });
  const port = Number.parseInt(process.env.EMAIL_PORT || '465', 10);
  const transporter = nodemailer.createTransport({
    host: address.address,
    port,
    secure: process.env.EMAIL_SECURE === 'true' || port === 465,
    ...(!net.isIP(configuredHost) ? { tls: { servername: configuredHost } } : {}),
    auth: { user: emailUser, pass: emailPass },
  });
  const safeCode = String(otpCode).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character]);
  const info = await transporter.sendMail({
    from: `"وظيفة العمر" <${process.env.EMAIL_FROM || emailUser}>`,
    to: email,
    subject,
    text: `رمز التحقق الخاص بك هو ${otpCode}. الرمز صالح لمدة 15 دقيقة.`,
    html: `<div dir="rtl"><h2>وظيفة العمر</h2><p>رمز التحقق الخاص بك:</p><strong>${safeCode}</strong><p>الرمز صالح لمدة 15 دقيقة.</p></div>`,
  });

  if (!info.accepted?.length) {
    return { sent: false, reason: 'RECIPIENT_REJECTED' };
  }
  return { sent: true, messageId: info.messageId };
};

module.exports = sendStagingOtpEmail;
