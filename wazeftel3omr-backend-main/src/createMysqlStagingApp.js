const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const hpp = require('hpp');
const morgan = require('morgan');
const { getMysqlPool } = require('./config/mysql');
const { apiLimiter, writeLimiter } = require('./middleware/rateLimiter');
const { createMysqlUserRepository } = require('./db/mysqlUserRepository');
const { createMysqlStagingRoutes } = require('./routes/mysqlStagingRoutes');

const createMysqlStagingApp = (options = {}) => {
  if (process.env.VERCEL || process.env.NODE_ENV === 'production') {
    throw new Error('The local MySQL app cannot run in production or Vercel');
  }

  const pool = options.pool || getMysqlPool();
  const app = express();
  const users = createMysqlUserRepository(pool);
  const {
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
  } = createMysqlStagingRoutes(users, {
    sendEmail: options.sendEmail,
    sendJobStatusEmail: options.sendJobStatusEmail,
    applications: options.applications,
    jobs: options.jobs,
    communication: options.communication,
    adminRepository: options.adminRepository,
    aiService: options.aiService,
    pool,
  });

  app.set('trust proxy', 1);
  app.use(helmet());
  app.use(hpp());

  const allowedOrigins = [
    process.env.CLIENT_URL,
    'http://localhost:5173',
    'http://localhost:3000',
  ].filter(Boolean);

  app.use(cors({
    origin: (origin, callback) => {
      if (!origin
        || allowedOrigins.some((allowed) => origin.startsWith(allowed))
        || origin.includes('vercel.app')
        || origin.startsWith('http://localhost:')
        || origin.startsWith('http://127.0.0.1:')) {
        return callback(null, true);
      }
      return callback(new Error(`CORS: Origin is not allowed: ${origin}`), false);
    },
    credentials: true,
  }));
  if (process.env.NODE_ENV === 'development') {
    app.use(morgan('dev'));
  }
  app.use('/api', apiLimiter);
  app.use('/api', writeLimiter);
  app.use(express.json({ limit: '20mb' }));
  app.use(express.urlencoded({ limit: '20mb', extended: true }));

  app.use('/api/auth', authRouter);
  app.use('/api/users', userRouter);
  app.use('/api/seeker/profile', userRouter);
  app.use('/api/jobs', jobRouter);
  app.use('/api/employer/jobs', jobRouter);
  app.use('/api/applications', applicationRouter);
  app.use('/api/seeker/applications', applicationRouter);
  app.use('/api/employer/applicants', applicationRouter);
  app.use('/api/notifications', notificationRouter);
  app.use('/api/seeker/notifications', notificationRouter);
  app.use('/api/messages', messageRouter);
  app.use('/api/reports', reportRouter);
  app.use('/api/admin', adminRouter);
  app.use('/api/employer/gmail', companyGmailRouter);
  app.use('/api/ai', aiRouter);
  app.get('/', (req, res) => {
    res.json({
      success: true,
      message: 'Wazeft El3omr Backend API is running on the local MySQL database.',
      timestamp: new Date().toISOString(),
    });
  });
  app.use((error, req, res, next) => {
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({
        success: false,
        message: 'البريد الإلكتروني مسجل وموجود بالفعل في النظام!',
      });
    }
    if (error.name === 'TypeError') {
      return res.status(400).json({ success: false, message: error.message });
    }
    console.error('[MySQL staging API error]', error.message);
    return res.status(500).json({
      success: false,
      message: 'حدث خطأ مؤقت أثناء معالجة الطلب، يرجى المحاولة مرة أخرى بعد لحظات',
    });
  });
  return app;
};

module.exports = { createMysqlStagingApp };
