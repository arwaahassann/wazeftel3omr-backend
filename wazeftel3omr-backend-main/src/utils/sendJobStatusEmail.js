const sendEmail = require('./sendEmail');

const escapeHtml = (value) => String(value || '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

const sendJobStatusEmail = async ({ email, title, status, rejectionReason = '' }) => {
  if (!email) {
    console.error(`Job status email not sent: poster email is missing (status: ${status}).`);
    return { sent: false, reason: 'MISSING_RECIPIENT' };
  }

  let subject;
  let message;
  let heading;
  let details;

  if (status === 'reviewing') {
    subject = `تم استلام إعلان وظيفتك: ${title}`;
    heading = 'تم استلام إعلانك';
    message = `تم استلام إعلان الوظيفة "${title}" وهو الآن قيد مراجعة إدارة المنصة. سنرسل لك بريدًا إلكترونيًا آخر فور صدور قرار المراجعة.`;
    details = 'الإعلان قيد المراجعة حاليًا.';
  } else if (status === 'active') {
    subject = `تمت الموافقة على إعلان وظيفتك: ${title}`;
    heading = 'تمت الموافقة على إعلانك';
    message = `تمت الموافقة على إعلان الوظيفة "${title}" وأصبح متاحًا للباحثين عن عمل.`;
    details = 'أصبح إعلانك متاحًا للباحثين عن عمل.';
  } else if (status === 'rejected') {
    const reason = rejectionReason.trim() || 'لم يتم توضيح سبب الرفض.';
    subject = `تحديث بخصوص إعلان وظيفتك: ${title}`;
    heading = 'لم تتم الموافقة على إعلانك';
    message = `تم رفض إعلان الوظيفة "${title}". سبب الرفض: ${reason}`;
    details = `سبب الرفض: ${reason}`;
  } else {
    throw new Error(`Unsupported job email status: ${status}`);
  }

  const result = await sendEmail({
    email,
    subject,
    message,
    html: `
      <div dir="rtl" style="font-family: Tahoma, Arial, sans-serif; background:#f8fafc; padding:32px 16px; color:#1e293b;">
        <div style="max-width:560px; margin:0 auto; background:#fff; border:1px solid #e2e8f0; border-radius:16px; padding:28px;">
          <h1 style="font-size:22px; margin:0 0 18px; color:#1d3557;">وظيفة العمر</h1>
          <h2 style="font-size:19px; margin:0 0 12px;">${escapeHtml(heading)}</h2>
          <p style="font-size:15px; line-height:1.9; margin:0 0 12px;">${escapeHtml(message)}</p>
          <p style="font-size:14px; line-height:1.8; color:#475569; margin:0;">${escapeHtml(details)}</p>
        </div>
      </div>
    `,
  });

  if (!result.sent) {
    console.error(`Job status email delivery failed (status: ${status}, reason: ${result.reason}).`);
  }
  return result;
};

module.exports = sendJobStatusEmail;
