const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');
const {
  isStrongPassword,
  PASSWORD_RULE_MSG,
} = require('../middleware/validationMiddleware');
const { getRoleLabel, buildPhoneMatch, normalizePhoneInput } = require('../utils/accountIdentity');
const sendStagingOtpEmail = require('../utils/sendStagingOtpEmail');

const generateToken = (id) => jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: '7d' });
const cleanEmail = (email) => String(email).toLowerCase().trim();

const createMysqlStagingAuthController = (users, { sendEmail = sendStagingOtpEmail } = {}) => {
  const registerUser = async (req, res, next) => {
    try {
      const {
        name,
        email,
        password,
        role,
        phone,
        jobTitle,
        company,
        location,
        detailedAddress,
      } = req.body;
      const accountRole = role || 'job_seeker';

      if (accountRole === 'employer') {
        const normalizedPhone = normalizePhoneInput(phone);
        const digits = normalizedPhone.replace(/\D/g, '');
        if (!/^[+\d\s().-]+$/.test(normalizedPhone) || digits.length < 8 || digits.length > 15) {
          return res.status(400).json({
            success: false,
            message: 'رقم التواصل الأساسي للشركة مطلوب ويجب أن يحتوي على 8 إلى 15 رقماً',
          });
        }
      }
      if (!isStrongPassword(password)) {
        return res.status(400).json({ success: false, message: PASSWORD_RULE_MSG });
      }

      const normalizedEmail = cleanEmail(email);
      const existing = await users.findByEmail(normalizedEmail);
      if (existing) {
        return res.status(400).json({
          success: false,
          message: existing.role !== accountRole
            ? `هذا البريد الإلكتروني مسجل بالفعل كـ (${getRoleLabel(existing.role)}) ولا يمكن استخدامه لإنشاء حساب من نوع (${getRoleLabel(accountRole)}). يرجى تسجيل الدخول بحسابك الحالي أو استخدام إيميل آخر.`
            : 'البريد الإلكتروني مستخدم بالفعل! يرجى استخدام إيميل آخر أو تسجيل الدخول.',
        });
      }

      const phoneMatch = buildPhoneMatch(phone);
      const phoneConflict = await users.findPhoneConflict(phoneMatch, accountRole);
      if (phoneConflict) {
        return res.status(400).json({
          success: false,
          message: `رقم الهاتف هذا مسجل بالفعل كـ (${getRoleLabel(phoneConflict.role)}) على المنصة. لا يمكن استخدام نفس الرقم للتسجيل كـ (${getRoleLabel(accountRole)}). يرجى استخدام رقم آخر أو تسجيل الدخول بحسابك الحالي.`,
        });
      }

      const user = await users.create({
        name,
        email: normalizedEmail,
        password,
        role: accountRole,
        phone: phone || '',
        jobTitle: jobTitle || (accountRole === 'employer' ? 'مدير توظيف' : 'باحث عن عمل'),
        company: company || '',
        location: location || '',
        detailedAddress: detailedAddress.trim(),
        accountStatus: accountRole === 'employer' ? 'reviewing' : 'active',
        lastLogin: new Date(),
      });
      const token = generateToken(user._id);

      return res.status(201).json({
        success: true,
        message: 'تم إنشاء الحساب بنجاح! مرحباً بك.',
        token,
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          role: user.role,
          accountStatus: user.accountStatus,
          jobTitle: user.jobTitle,
          company: user.company || '',
          avatar: user.avatar || '',
          location: user.location || '',
          detailedAddress: user.detailedAddress || '',
          phone: user.phone || '',
        },
      });
    } catch (error) {
      return next(error);
    }
  };

  const loginUser = async (req, res, next) => {
    try {
      const user = await users.findByEmail(cleanEmail(req.body.email));
      const hash = user?.password;
      const isBcryptHash = typeof hash === 'string' && /^\$2[aby]\$/.test(hash);
      const passwordMatches = isBcryptHash
        ? await bcrypt.compare(String(req.body.password), hash)
        : Boolean(user && hash === String(req.body.password));
      if (!user || !passwordMatches) {
        return res.status(401).json({
          success: false,
          message: 'البريد الإلكتروني أو كلمة المرور غير صحيحة!',
        });
      }
      if (user.accountStatus === 'suspended') {
        return res.status(403).json({
          success: false,
          message: 'تم إيقاف هذا الحساب. تواصلي مع إدارة المنصة.',
        });
      }
      if (!isBcryptHash) await users.updatePassword(user._id, req.body.password);
      await users.update(user._id, { lastLogin: new Date() });

      return res.status(200).json({
        success: true,
        message: 'تم تسجيل الدخول بنجاح',
        token: generateToken(user._id),
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          role: user.role,
          accountStatus: user.accountStatus,
          jobTitle: user.role === 'admin' ? 'مشرف المنصة' : user.jobTitle,
          company: user.company || '',
          avatar: user.avatar || '',
          location: user.location || '',
          phone: user.phone || '',
        },
      });
    } catch (error) {
      return next(error);
    }
  };

  const googleLogin = async (req, res, next) => {
    try {
      const { credential, access_token: accessToken, role } = req.body;
      if (!credential && !accessToken) {
        return res.status(400).json({ success: false, message: 'تذكرة Google مطلوبة' });
      }
      let googleData;
      if (accessToken) {
        const response = await fetch(
          `https://www.googleapis.com/oauth2/v3/userinfo?access_token=${encodeURIComponent(accessToken)}`,
        );
        if (!response.ok) {
          return res.status(401).json({ success: false, message: 'تعذر التحقق من بيانات Google الخاصة بك' });
        }
        googleData = await response.json();
      } else {
        const ticket = await new OAuth2Client(process.env.GOOGLE_CLIENT_ID).verifyIdToken({
          idToken: credential,
          audience: process.env.GOOGLE_CLIENT_ID,
        });
        googleData = ticket.getPayload();
      }
      if (!googleData?.email) {
        return res.status(400).json({ success: false, message: 'تعذر التحقق من بيانات Google الخاصة بك' });
      }

      const normalizedEmail = cleanEmail(googleData.email);
      const requestedRole = role || 'job_seeker';
      if (!['job_seeker', 'employer'].includes(requestedRole)) {
        return res.status(400).json({ success: false, message: 'نوع الحساب غير صالح' });
      }
      let user = await users.findByEmail(normalizedEmail);
      if (user && user.role !== 'admin' && user.role !== requestedRole) {
        return res.status(409).json({
          success: false,
          message: `هذا البريد الإلكتروني مسجل بالفعل كـ (${getRoleLabel(user.role)}). لا يمكن استخدامه كـ (${getRoleLabel(requestedRole)}). يرجى تسجيل الدخول بنوع حسابك الحالي.`,
        });
      }
      if (!user) {
        const displayName = googleData.name || normalizedEmail.split('@')[0];
        user = await users.create({
          name: displayName,
          email: normalizedEmail,
          password: `G_${googleData.sub || Date.now()}_${crypto.randomBytes(8).toString('hex')}!A`,
          role: requestedRole,
          googleId: googleData.sub || '',
          avatar: googleData.picture || '',
          jobTitle: requestedRole === 'employer' ? 'مدير توظيف' : 'باحث عن عمل',
          company: requestedRole === 'employer' ? `شركة ${displayName}` : '',
          accountStatus: requestedRole === 'employer' ? 'reviewing' : 'active',
          isVerified: true,
          lastLogin: new Date(),
        });
      } else {
        const updates = { lastLogin: new Date() };
        if (googleData.picture && !user.avatar) updates.avatar = googleData.picture;
        if (googleData.sub && !user.googleId) updates.googleId = googleData.sub;
        user = await users.update(user._id, updates);
      }

      return res.status(200).json({
        success: true,
        message: 'تم تسجيل الدخول بواسطة Google بنجاح',
        token: generateToken(user._id),
        user: {
          id: user._id,
          _id: user._id,
          name: user.name,
          email: user.email,
          role: user.role,
          accountStatus: user.accountStatus,
          jobTitle: user.jobTitle,
          company: user.company || '',
          avatar: user.avatar || '',
          location: user.location || '',
          phone: user.phone || '',
        },
      });
    } catch (error) {
      if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
        return res.status(401).json({
          success: false,
          message: 'تعذر التحقق من بيانات Google الخاصة بك',
        });
      }
      return next(error);
    }
  };

  const sendOtp = async (req, res, next) => {
    try {
      if (!req.body.email) {
        return res.status(400).json({ success: false, message: 'البريد الإلكتروني مطلوب' });
      }
      const email = cleanEmail(req.body.email);
      const user = await users.findByEmail(email);
      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'المستخدم غير موجود بهذا البريد الإلكتروني',
        });
      }

      const otp = crypto.randomInt(100000, 1000000).toString();
      await users.update(user._id, {
        otpCode: otp,
        otpExpire: new Date(Date.now() + 15 * 60 * 1000),
      });

      let delivery;
      try {
        delivery = await sendEmail({
          email,
          subject: 'رمز التحقق (OTP) - وظيفة العمر 💼',
          otpCode: otp,
        });
      } catch (error) {
        console.error('[Staging OTP] Email send failed:', error.message);
        await users.update(user._id, { otpCode: null, otpExpire: null });
        return res.status(500).json({
          success: false,
          message: 'فشل إرسال البريد الإلكتروني، يرجى المحاولة لاحقاً أو التحقق من صحة البريد.',
        });
      }

      if (!delivery?.sent) {
        await users.update(user._id, { otpCode: null, otpExpire: null });
        return res.status(500).json({
          success: false,
          message: 'فشل إرسال البريد الإلكتروني، يرجى المحاولة لاحقاً أو التحقق من صحة البريد.',
        });
      }
      return res.status(200).json({
        success: true,
        message: `تم إرسال رمز التحقق (OTP) بنجاح إلى إيميلك: ${email}`,
      });
    } catch (error) {
      return next(error);
    }
  };

  const verifyOtp = async (req, res, next) => {
    try {
      const { email, otp } = req.body;
      if (!email || !otp) {
        return res.status(400).json({
          success: false,
          message: 'البريد ورمز التحقق مطلوبان',
        });
      }
      const user = await users.findByEmail(cleanEmail(email));
      if (!user) return res.status(404).json({ success: false, message: 'المستخدم غير موجود' });
      if (!user.otpCode || String(user.otpCode).trim() !== String(otp).trim()) {
        return res.status(400).json({
          success: false,
          message: 'رمز التحقق (OTP) غير صحيح! يرجى التأكد من الرمز المرسل لإيميلك.',
        });
      }
      if (!user.otpExpire || new Date(user.otpExpire).getTime() < Date.now()) {
        return res.status(400).json({
          success: false,
          message: 'انتهت صلاحية رمز التحقق! يرجى طلب رمز جديد.',
        });
      }
      const verified = await users.consumeOtp(user._id, String(otp).trim(), {
        isVerified: true,
        lastLogin: new Date(),
      });
      if (!verified) {
        const latest = await users.findByEmail(cleanEmail(email));
        return res.status(400).json({
          success: false,
          message: latest?.otpCode && latest.otpExpire
            && new Date(latest.otpExpire).getTime() >= Date.now()
            ? 'رمز التحقق (OTP) غير صحيح! يرجى التأكد من الرمز المرسل لإيميلك.'
            : 'انتهت صلاحية رمز التحقق! يرجى طلب رمز جديد.',
        });
      }

      return res.status(200).json({
        success: true,
        message: 'تم التحقق من الحساب بنجاح!',
        token: generateToken(user._id),
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          role: user.role,
          accountStatus: user.accountStatus,
          jobTitle: user.jobTitle,
          company: user.company,
          isVerified: true,
        },
      });
    } catch (error) {
      return next(error);
    }
  };

  const resetPasswordWithOtp = async (req, res, next) => {
    try {
      const { email, otp, newPassword, confirmPassword } = req.body;
      if (!email || !otp || !newPassword) {
        return res.status(400).json({ success: false, message: 'جميع الحقول مطلوبة' });
      }
      if (!isStrongPassword(newPassword)) {
        return res.status(400).json({ success: false, message: PASSWORD_RULE_MSG });
      }
      if (confirmPassword && newPassword !== confirmPassword) {
        return res.status(400).json({
          success: false,
          message: 'كلمة المرور وتأكيد كلمة المرور غير متطابقتين',
        });
      }
      const user = await users.findByEmail(cleanEmail(email));
      if (!user) return res.status(404).json({ success: false, message: 'المستخدم غير موجود' });
      if (!user.otpCode || String(user.otpCode).trim() !== String(otp).trim()) {
        return res.status(400).json({
          success: false,
          message: 'رمز التحقق (OTP) غير صحيح! تأكد من الرمز المرسل إلى بريدك.',
        });
      }
      if (!user.otpExpire || new Date(user.otpExpire).getTime() < Date.now()) {
        return res.status(400).json({
          success: false,
          message: 'انتهت صلاحية رمز التحقق! يرجى طلب رمز جديد.',
        });
      }

      const passwordHash = await bcrypt.hash(newPassword, await bcrypt.genSalt(12));
      const reset = await users.consumeOtp(user._id, String(otp).trim(), {
        password: passwordHash,
        isVerified: true,
        lastLogin: new Date(),
      });
      if (!reset) {
        const latest = await users.findByEmail(cleanEmail(email));
        return res.status(400).json({
          success: false,
          message: latest?.otpCode && latest.otpExpire
            && new Date(latest.otpExpire).getTime() >= Date.now()
            ? 'رمز التحقق (OTP) غير صحيح! تأكد من الرمز المرسل إلى بريدك.'
            : 'انتهت صلاحية رمز التحقق! يرجى طلب رمز جديد.',
        });
      }
      return res.status(200).json({
        success: true,
        message: 'تم إعادة تعيين كلمة المرور وتسجيل الدخول بنجاح!',
        token: generateToken(user._id),
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          role: user.role,
          jobTitle: user.jobTitle,
          company: user.company,
        },
      });
    } catch (error) {
      return next(error);
    }
  };

  const getMe = (req, res) => {
    const { _id, name, email, phone, role, accountStatus, company, jobTitle, location, avatar } = req.user;
    return res.status(200).json({
      success: true,
      user: { _id, name, email, phone, role, accountStatus, company, jobTitle, location, avatar },
    });
  };
  const logoutUser = (req, res) => res.status(200).json({
    success: true,
    message: 'تم تسجيل الخروج بنجاح',
  });

  return {
    registerUser,
    loginUser,
    googleLogin,
    sendOtp,
    verifyOtp,
    resetPasswordWithOtp,
    getMe,
    logoutUser,
  };
};

module.exports = { createMysqlStagingAuthController };
