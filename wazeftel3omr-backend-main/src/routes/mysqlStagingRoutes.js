const express = require('express');
const {
  validateLogin,
  validateRegister,
  validateResetPassword,
  validateUpdateProfile,
  validateCreateJob,
  validateUpdateJob,
} = require('../middleware/validationMiddleware');
const { authLimiter } = require('../middleware/rateLimiter');
const { createMysqlStagingAuthMiddleware } = require('../middleware/mysqlStagingAuthMiddleware');
const { createMysqlStagingAuthController } = require('../controllers/mysqlStagingAuthController');
const { createMysqlStagingUserController } = require('../controllers/mysqlStagingUserController');
const { createMysqlStagingJobController } = require('../controllers/mysqlStagingJobController');
const { MysqlJobRepository } = require('../db/mysqlJobRepository');
const { createMysqlStagingApplicationController } = require('../controllers/mysqlStagingApplicationController');
const { MysqlApplicationRepository } = require('../db/mysqlApplicationRepository');
const { createMysqlStagingCommunicationController } = require('../controllers/mysqlStagingCommunicationController');
const { MysqlCommunicationRepository } = require('../db/mysqlCommunicationRepository');
const { createMysqlStagingAdminController } = require('../controllers/mysqlStagingAdminController');
const { validateApplyForJob, validateUpdateStatus } = require('../middleware/validationMiddleware');
const { MysqlAdminRepository } = require('../db/mysqlAdminRepository');
const { createMysqlStagingAdminFeaturesController } = require('../controllers/mysqlStagingAdminFeaturesController');
const { createMysqlStagingCompanyGmailController } = require('../controllers/mysqlStagingCompanyGmailController');
const { createMysqlStagingAiRouter } = require('./mysqlStagingAiRoutes');

const createMysqlStagingRoutes = (users, options = {}) => {
  const { protect, authorize } = createMysqlStagingAuthMiddleware(users);
  const auth = createMysqlStagingAuthController(users, options);
  const profile = createMysqlStagingUserController(users);
  const jobsRepository = options.jobs || new MysqlJobRepository(options.pool);
  const jobs = createMysqlStagingJobController(jobsRepository, options);
  const applications = createMysqlStagingApplicationController(
    options.applications || new MysqlApplicationRepository(options.pool),
    jobsRepository,
    options,
  );
  const communication = createMysqlStagingCommunicationController(
    options.communication || new MysqlCommunicationRepository(options.pool),
  );
  const admin = createMysqlStagingAdminController(users);
  const adminFeatures = createMysqlStagingAdminFeaturesController(
    options.adminRepository || new MysqlAdminRepository(options.pool),
    options,
  );
  const companyGmail = createMysqlStagingCompanyGmailController(users);
  const aiRouter = createMysqlStagingAiRouter(protect, options.aiService);
  const companyGmailRouter = express.Router();
  companyGmailRouter.get('/oauth/callback', companyGmail.gmailOAuthCallback);
  companyGmailRouter.use(protect, authorize('employer'));
  companyGmailRouter.get('/status', companyGmail.getConnectionStatus);
  companyGmailRouter.get('/connect-url', companyGmail.getConnectUrl);
  companyGmailRouter.delete('/connection', companyGmail.disconnectGmail);
  const authRouter = express.Router();
  const userRouter = express.Router();
  const jobRouter = express.Router();
  const applicationRouter = express.Router();
  const notificationRouter = express.Router();
  const messageRouter = express.Router();
  const reportRouter = express.Router();
  const adminRouter = express.Router();

  authRouter.post('/register', authLimiter, validateRegister, auth.registerUser);
  authRouter.post('/login', authLimiter, validateLogin, auth.loginUser);
  authRouter.post('/google', authLimiter, auth.googleLogin);
  authRouter.post('/send-otp', authLimiter, auth.sendOtp);
  authRouter.post('/verify-otp', authLimiter, auth.verifyOtp);
  authRouter.post('/reset-password-otp', authLimiter, validateResetPassword, auth.resetPasswordWithOtp);
  authRouter.get('/me', protect, auth.getMe);
  authRouter.post('/logout', auth.logoutUser);

  userRouter.use(protect);
  userRouter.get('/', profile.getUserProfile);
  userRouter.get('/profile', profile.getUserProfile);
  userRouter.put('/', validateUpdateProfile, profile.updateUserProfile);
  userRouter.put('/profile', validateUpdateProfile, profile.updateUserProfile);
  userRouter.put('/company-documents/:documentType', profile.uploadCompanyDocument);
  userRouter.get('/company-documents/:documentType', profile.getCompanyDocument);
  userRouter.put('/change-password', profile.changePassword);
  userRouter.get('/saved', jobs.getSavedJobs);
  userRouter.post('/saved/:jobId', jobs.toggleSaveJob);

  jobRouter.get('/expire', jobs.expireJobsFromCron);
  jobRouter.get('/', jobs.getAllJobs);
  jobRouter.get('/mine', protect, authorize('employer', 'admin'), jobs.getMyJobs);
  jobRouter.get('/:id', jobs.getJobById);
  jobRouter.post('/', protect, authorize('employer', 'admin'), validateCreateJob, jobs.createJob);
  jobRouter.put('/:id', protect, authorize('employer', 'admin'), validateUpdateJob, jobs.updateJob);
  jobRouter.delete('/:id', protect, authorize('employer', 'admin'), jobs.deleteJob);

  applicationRouter.use(protect);
  applicationRouter.get('/stats', authorize('job_seeker'), applications.getApplicationStats);
  applicationRouter.get('/', authorize('job_seeker'), applications.getMyApplications);
  applicationRouter.get('/employer/stats', authorize('employer', 'admin'), applications.getEmployerApplicantStats);
  applicationRouter.get('/all', authorize('employer', 'admin'), applications.getAllEmployerApplicants);
  applicationRouter.get('/employer/all', authorize('employer', 'admin'), applications.getAllEmployerApplicants);
  applicationRouter.get('/job/:jobId', authorize('employer', 'admin'), applications.getJobApplications);
  applicationRouter.get('/:id/details', authorize('employer', 'admin'), applications.getEmployerApplicationDetails);
  applicationRouter.put('/:id/status', authorize('employer', 'admin'), validateUpdateStatus, applications.updateApplicationStatus);
  applicationRouter.post('/:jobId', authorize('job_seeker'), validateApplyForJob, applications.applyForJob);

  notificationRouter.use(protect);
  notificationRouter.get('/', communication.getMyNotifications);
  notificationRouter.put('/read-all', communication.markAllNotificationsRead);
  notificationRouter.post('/bulk-delete', communication.deleteMultipleNotifications);
  notificationRouter.put('/:id/read', communication.markNotificationRead);
  notificationRouter.delete('/:id', communication.deleteNotification);

  messageRouter.use(protect);
  messageRouter.get('/:applicationId', communication.getApplicationMessages);
  messageRouter.post('/:applicationId', communication.sendMessage);

  reportRouter.use(protect);
  reportRouter.post('/', communication.createReport);
  reportRouter.get('/mine', communication.getMyReports);

  adminRouter.use(protect, authorize('admin'));
  adminRouter.get('/stats', applications.getAdminDashboardStats);
  adminRouter.get('/account-search', admin.searchAdminAccounts);
  adminRouter.get('/applications', applications.getAdminAllApplications);
  adminRouter.get('/applications/stats', applications.getAdminApplicationStats);
  adminRouter.get('/reports', communication.getAdminReports);
  adminRouter.put('/reports/:id/status', communication.updateAdminReportStatus);
  adminRouter.get('/notifications/count', communication.getAdminNotificationCount);
  adminRouter.get('/notifications', communication.getAdminNotifications);
  adminRouter.put('/notifications/state', communication.updateAdminNotificationStates);
  adminRouter.get('/companies', adminFeatures.getAllCompanies);
  adminRouter.get('/companies/:id/documents/:documentType', adminFeatures.getAdminCompanyDocument);
  adminRouter.put('/companies/:id/status', adminFeatures.updateCompanyStatus);
  adminRouter.get('/seekers', adminFeatures.getAdminSeekers);
  adminRouter.put('/seekers/:id/status', adminFeatures.updateAdminSeekerStatus);
  adminRouter.get('/jobs', adminFeatures.getAdminAllJobs);
  adminRouter.get('/jobs/:id', adminFeatures.getAdminJobDetails);
  adminRouter.put('/jobs/:id/status', adminFeatures.updateAdminJobStatus);
  adminRouter.delete('/jobs/:id', adminFeatures.deleteAdminJob);

  return {
    authRouter,
    userRouter,
    jobRouter,
    applicationRouter,
    notificationRouter,
    messageRouter,
    reportRouter,
    adminRouter,
    companyGmailRouter,
    aiRouter,
  };
};

module.exports = { createMysqlStagingRoutes };
