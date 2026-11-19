const dns = require('node:dns/promises');
const net = require('node:net');
const nodemailer = require('nodemailer');

const sendStagingEmail = async ({
  email,
  fromName = 'وظيفة العمر',
  subject,
  message,
  html,
  replyTo,
}) => {
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
  const info = await transporter.sendMail({
    from: `"${String(fromName).replace(/["\r\n]/g, '')}" <${process.env.EMAIL_FROM || emailUser}>`,
    to: email,
    ...(replyTo ? { replyTo } : {}),
    subject,
    text: message,
    ...(html ? { html } : {}),
  });

  if (!info.accepted?.length) {
    return { sent: false, reason: 'RECIPIENT_REJECTED' };
  }
  return {
    sent: true,
    messageId: info.messageId,
    sender: process.env.EMAIL_FROM || emailUser,
  };
};

module.exports = sendStagingEmail;
