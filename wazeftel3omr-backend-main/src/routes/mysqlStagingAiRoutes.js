const express = require('express');
const {
  generateJobDetails,
  screenCandidate,
  generateCoverLetter,
  careerCoachChat,
} = require('../services/aiService');

const createMysqlStagingAiRouter = (protect, aiService = {}) => {
  const router = express.Router();
  const service = {
    generateJobDetails: aiService.generateJobDetails || generateJobDetails,
    screenCandidate: aiService.screenCandidate || screenCandidate,
    generateCoverLetter: aiService.generateCoverLetter || generateCoverLetter,
    careerCoachChat: aiService.careerCoachChat || careerCoachChat,
  };

  router.post('/generate-job', protect, async (req, res, next) => {
    try {
      const result = await service.generateJobDetails(req.body);
      return res.status(200).json({ success: true, data: result });
    } catch (error) {
      return next(error);
    }
  });

  router.post('/screen-candidate', protect, async (req, res, next) => {
    try {
      const result = await service.screenCandidate(req.body);
      return res.status(200).json({ success: true, data: result });
    } catch (error) {
      return next(error);
    }
  });

  router.post('/generate-cover-letter', protect, async (req, res, next) => {
    try {
      const coverLetter = await service.generateCoverLetter(req.body);
      return res.status(200).json({ success: true, coverLetter });
    } catch (error) {
      return next(error);
    }
  });

  router.post('/career-coach', protect, async (req, res, next) => {
    try {
      const result = await service.careerCoachChat({
        message: req.body.message,
        role: req.user?.role,
        userName: req.user?.name,
      });
      return res.status(200).json({ success: true, ...result });
    } catch (error) {
      return next(error);
    }
  });

  return router;
};

module.exports = { createMysqlStagingAiRouter };
