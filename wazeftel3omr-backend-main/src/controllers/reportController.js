const Report = require('../models/Report');

const createReport = async (req, res, next) => {
  try {
    const { type, subject, message, relatedJob } = req.body;

    if (!['complaint', 'suggestion'].includes(type)) {
      return res.status(400).json({ success: false, message: 'نوع البلاغ غير صالح' });
    }
    if (!subject || String(subject).trim().length < 3) {
      return res.status(400).json({ success: false, message: 'العنوان يجب أن يكون 3 أحرف على الأقل' });
    }
    if (!message || String(message).trim().length < 10) {
      return res.status(400).json({ success: false, message: 'التفاصيل يجب أن تكون 10 أحرف على الأقل' });
    }

    const report = await Report.create({
      user: req.user._id,
      type,
      subject: String(subject).trim(),
      message: String(message).trim(),
      relatedJob: relatedJob || undefined,
    });

    res.status(201).json({
      success: true,
      message: type === 'suggestion' ? 'تم إرسال مقترحك بنجاح' : 'تم إرسال شكواك بنجاح',
      report,
    });
  } catch (error) {
    next(error);
  }
};

const getMyReports = async (req, res, next) => {
  try {
    const reports = await Report.find({ user: req.user._id })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();

    res.status(200).json({ success: true, count: reports.length, reports });
  } catch (error) {
    next(error);
  }
};

module.exports = { createReport, getMyReports };
