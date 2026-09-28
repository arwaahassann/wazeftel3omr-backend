const express = require('express');
const router = express.Router();
const {
  generateJobDetails,
  screenCandidate,
  generateCoverLetter,
  careerCoachChat,
} = require('../services/aiService');
const { protect } = require('../middleware/authMiddleware');

// 1. توليد تفاصيل الوظيفة بالذكاء الاصطناعي (متاح لصاحب العمل)
router.post('/generate-job', protect, async (req, res, next) => {
  try {
    const result = await generateJobDetails(req.body);
    res.status(200).json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
});

// 2. الفحص والتحليل الذكي لملف المتقدم
router.post('/screen-candidate', protect, async (req, res, next) => {
  try {
    const result = await screenCandidate(req.body);
    res.status(200).json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
});

// 3. كتابة رسالة تقديم بالذكاء الاصطناعي (Cover Letter)
router.post('/generate-cover-letter', protect, async (req, res, next) => {
  try {
    const coverLetter = await generateCoverLetter(req.body);
    res.status(200).json({ success: true, coverLetter });
  } catch (error) {
    next(error);
  }
});

// 4. المستشار المهني الذكي (Chatbot)
router.post('/career-coach', protect, async (req, res, next) => {
  try {
    const { message } = req.body;
    const result = await careerCoachChat({
      message,
      role: req.user?.role,
      userName: req.user?.name,
    });
    res.status(200).json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
