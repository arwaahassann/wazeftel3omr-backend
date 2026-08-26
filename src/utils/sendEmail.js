const nodemailer = require('nodemailer');

/**
 * 📧 دالة إرسال بريد إلكتروني حقيقي للمستخدم عبر Nodemailer / SMTP
 * @param {Object} options - { email, subject, message, html }
 */
const sendEmail = async (options) => {
  // التحقق من وجود بيانات SMTP في ملف .env
  const emailUser = process.env.EMAIL_USER;
  const emailPass = process.env.EMAIL_PASS;

  if (!emailUser || !emailPass) {
    console.log('⚠️ [Email Service]: لم يتم ضبط EMAIL_USER و EMAIL_PASS في ملف .env. سيتم تسجيل الرمز في الكونسول فقط.');
    return { sent: false, reason: 'NO_CREDENTIALS' };
  }

  // 1. إعداد الـ Transporter الخاص بـ Nodemailer
  const transporter = nodemailer.createTransport({
    service: process.env.EMAIL_SERVICE || 'gmail',
    host: process.env.EMAIL_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.EMAIL_PORT || '587'),
    secure: process.env.EMAIL_SECURE === 'true', // true for 465, false for 587
    auth: {
      user: emailUser,
      pass: emailPass, // كلمة سر التطبيقات App Password من حساب Google
    },
  });

  // 2. إعداد تفاصيل البريد الإكتروني
  const mailOptions = {
    from: `وظيفة العمر <${process.env.EMAIL_FROM || emailUser}>`,
    to: options.email,
    subject: options.subject,
    text: options.message,
    html: options.html || `
      <div dir="rtl" style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f8fafc; padding: 40px 20px; text-align: center;">
        <div style="max-width: 500px; margin: 0 auto; background-color: #ffffff; border-radius: 16px; padding: 32px; box-shadow: 0 4px 12px rgba(0,0,0,0.05); border: 1px solid #e2e8f0;">
          <h2 style="color: #1D3557; margin-bottom: 8px; font-size: 24px;">وظيفة العمر 💼</h2>
          <p style="color: #64748b; font-size: 14px; margin-bottom: 24px;">رمز التحقق الخاص بك لإعادة تعيين كلمة المرور</p>
          
          <div style="background-color: #f0fdfa; border: 2px dashed #00D2B4; border-radius: 12px; padding: 20px; margin-bottom: 24px;">
            <span style="font-size: 32px; font-weight: 800; letter-spacing: 8px; color: #00D2B4; display: block;">${options.otpCode || ''}</span>
          </div>

          <p style="color: #475569; font-size: 13px; line-height: 1.6; margin-bottom: 16px;">
            هذا الرمز صالِح لمدة <strong>10 دقائق</strong> فقط. يرجى عدم مشاركة هذا الرمز مع أي شخص.
          </p>
          <hr style="border: none; border-top: 1px solid #f1f5f9; margin: 24px 0;" />
          <p style="color: #94a3b8; font-size: 11px;">إذا لم تطلب هذا الرمز، يمكنك تجاهل هذا البريد الإلكتروني بأمان.</p>
        </div>
      </div>
    `,
  };

  // 3. إرسال البريد فعلياً
  const info = await transporter.sendMail(mailOptions);
  console.log('✅ [Email Service]: تم إرسال البريد بنجاح! Message ID:', info.messageId);
  return { sent: true, messageId: info.messageId };
};

module.exports = sendEmail;
