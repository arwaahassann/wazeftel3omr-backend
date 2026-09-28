const User = require('../models/User');
const jwt = require('jsonwebtoken');
const { isStrongPassword, PASSWORD_RULE_MSG } = require('../middleware/validationMiddleware');
const { getRoleLabel, buildPhoneMatch, normalizePhoneInput } = require('../utils/accountIdentity');

// 🔑 دالة مساعدة لإنشاء تذكرة JWT
const generateToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET, {
    expiresIn: '7d', // تنتهي صلاحية التذكرة بعد 7 أيام
  });
};

// @desc    إنشاء حساب جديد
// @route   POST /api/auth/register
// @access  Public
const registerUser = async (req, res, next) => {
  try {
    const { name, email, password, role, phone, jobTitle, company } = req.body;
    const accountRole = role || 'job_seeker';

    if (accountRole === 'employer') {
      const normalizedPhone = normalizePhoneInput(phone);
      const phoneDigits = normalizedPhone.replace(/\D/g, '');
      if (!/^[+\d\s().-]+$/.test(normalizedPhone) || phoneDigits.length < 8 || phoneDigits.length > 15) {
        return res.status(400).json({
          success: false,
          message: 'رقم التواصل الأساسي للشركة مطلوب ويجب أن يحتوي على 8 إلى 15 رقماً',
        });
      }
    }

    // 1. التحقق من قوة كلمة المرور
    if (!isStrongPassword(password)) {
      return res.status(400).json({
        success: false,
        message: PASSWORD_RULE_MSG,
      });
    }

    // 2. التحقق مما إذا كان الإيميل مستخدماً من قبل
    const userExists = await User.findOne({ email: String(email).toLowerCase().trim() })
      .select('role')
      .lean();
    if (userExists) {
      return res.status(400).json({
        success: false,
        message: userExists.role !== accountRole
          ? `هذا البريد الإلكتروني مسجل بالفعل كـ (${getRoleLabel(userExists.role)}) ولا يمكن استخدامه لإنشاء حساب من نوع (${getRoleLabel(accountRole)}). يرجى تسجيل الدخول بحسابك الحالي أو استخدام إيميل آخر.`
          : 'البريد الإلكتروني مستخدم بالفعل! يرجى استخدام إيميل آخر أو تسجيل الدخول.',
      });
    }

    // منع استخدام رقم مسجل لدور مختلف، حتى لو اختلف تنسيق المسافات أو الشرطات.
    const phoneMatch = buildPhoneMatch(phone);
    if (phoneMatch) {
      const phoneConflict = await User.findOne({
        phone: phoneMatch,
        role: { $ne: role || 'job_seeker' },
      }).select('role').lean();
      if (phoneConflict) {
        return res.status(400).json({
          success: false,
          message: `رقم الهاتف هذا مسجل بالفعل كـ (${getRoleLabel(phoneConflict.role)}) على المنصة. لا يمكن استخدام نفس الرقم للتسجيل كـ (${getRoleLabel(accountRole)}). يرجى استخدام رقم آخر أو تسجيل الدخول بحسابك الحالي.`,
        });
      }
    }

    // 2. إنشاء المستخدم الجديد (التشفير يتم تلقائياً في model pre-save hook)
    const user = await User.create({
      name,
      email: cleanEmail,
      password,
      role: accountRole,
      phone: phone || '',
      jobTitle: jobTitle || (accountRole === 'employer' ? 'مدير توظيف' : 'باحث عن عمل'),
      company: company || '',
      accountStatus: accountRole === 'employer' ? 'reviewing' : 'active',
    });

    // 3. تحديث تاريخ آخر دخول
    user.lastLogin = Date.now();
    await user.save({ validateBeforeSave: false });

    // 4. إنشاء التذكرة وإرجاع الاستجابة
    const token = generateToken(user._id);

    res.status(201).json({
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
        phone: user.phone || '',
      },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    تسجيل الدخول
// @route   POST /api/auth/login
// @access  Public
const loginUser = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    // 1. البحث عن المستخدم وجلب كلمة المرور المشفرة معه صراحة
    const user = await User.findOne({ email: String(email).toLowerCase().trim() })
      .select('name email role accountStatus jobTitle company avatar location phone +password');

    // 2. التحقق من وجود المستخدم وصحة كلمة المرور
    if (!user || !(await user.matchPassword(password))) {
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

    // 3. تحديث تاريخ آخر دخول
    await User.updateOne(
      { _id: user._id },
      { $set: { lastLogin: new Date() } }
    );

    // 4. إنشاء التذكرة وإرجاع البيانات
    const token = generateToken(user._id);

    res.status(200).json({
      success: true,
      message: 'تم تسجيل الدخول بنجاح',
      token,
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
    next(error);
  }
};

// @desc    جلب بيانات المستخدم الحالي
// @route   GET /api/auth/me
// @access  Private (يتطلب protect)
const getMe = async (req, res) => {
  res.status(200).json({
    success: true,
    user: req.user,
  });
};

// @desc    تسجيل الخروج
// @route   POST /api/auth/logout
// @access  Public / Private
const logoutUser = async (req, res) => {
  res.status(200).json({
    success: true,
    message: 'تم تسجيل الخروج بنجاح',
  });
};

// @desc    تسجيل الدخول / إنشاء حساب بواسطة Google
// @route   POST /api/auth/google
// @access  Public
const googleLogin = async (req, res, next) => {
  try {
    const { credential, access_token, role } = req.body;

    if (!credential && !access_token) {
      return res.status(400).json({
        success: false,
        message: 'تذكرة Google مطلوبة',
      });
    }

    let googleData;
    if (access_token) {
      const userinfoRes = await fetch(`https://www.googleapis.com/oauth2/v3/userinfo?access_token=${access_token}`);
      googleData = await userinfoRes.json();
    } else if (credential) {
      try {
        const { OAuth2Client } = require('google-auth-library');
        const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
        const ticket = await client.verifyIdToken({
          idToken: credential,
          audience: process.env.GOOGLE_CLIENT_ID,
        });
        googleData = ticket.getPayload();
      } catch (verifyError) {
        googleData = jwt.decode(credential);
      }
    }

    if (!googleData || !googleData.email) {
      return res.status(400).json({
        success: false,
        message: 'تعذر التحقق من بيانات Google الخاصة بك',
      });
    }

    const { email, name, picture, sub: googleId } = googleData;
    const cleanEmail = String(email).toLowerCase().trim();
    const requestedRole = role || 'job_seeker';
    if (!['job_seeker', 'employer'].includes(requestedRole)) {
      return res.status(400).json({
        success: false,
        message: 'نوع الحساب غير صالح',
      });
    }

    // البحث عن المستخدم في الداتا بيز
    let user = await User.findOne({ email: cleanEmail });
    if (user && user.role !== 'admin' && user.role !== requestedRole) {
      return res.status(409).json({
        success: false,
        message: `هذا البريد الإلكتروني مسجل بالفعل كـ (${getRoleLabel(user.role)}). لا يمكن استخدامه كـ (${getRoleLabel(requestedRole)}). يرجى تسجيل الدخول بنوع حسابك الحالي.`,
      });
    }

    if (!user) {
      const randomPassword = `G_${googleId || Date.now()}_${Math.random().toString(36).slice(-8)}!A`;
      user = await User.create({
        name: name || cleanEmail.split('@')[0],
        email: cleanEmail,
        password: randomPassword,
        role: requestedRole,
        googleId: googleId || '',
        avatar: picture || '',
        jobTitle: requestedRole === 'employer' ? 'مدير توظيف' : 'باحث عن عمل',
        company: requestedRole === 'employer' ? `شركة ${name || cleanEmail.split('@')[0]}` : '',
        accountStatus: requestedRole === 'employer' ? 'reviewing' : 'active',
        isVerified: true,
      });
    } else {
      if (picture && !user.avatar) user.avatar = picture;
      if (googleId && !user.googleId) user.googleId = googleId;
      user.lastLogin = Date.now();
      await user.save({ validateBeforeSave: false });
    }

    const token = generateToken(user._id);

    res.status(200).json({
      success: true,
      message: 'تم تسجيل الدخول بواسطة Google بنجاح',
      token,
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
    next(error);
  }
};

// @desc    إرسال رمز تحقق OTP إلى البريد الإلكتروني
// @route   POST /api/auth/send-otp
// @access  Public
const sendOtp = async (req, res, next) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ success: false, message: 'البريد الإلكتروني مطلوب' });

    const cleanEmail = String(email).toLowerCase().trim();
    let user = await User.findOne({ email: cleanEmail });
    if (!user) return res.status(404).json({ success: false, message: 'المستخدم غير موجود بهذا البريد الإلكتروني' });

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    user.otpCode = otp;
    user.otpExpire = Date.now() + 15 * 60 * 1000; // صالِح لمدة 15 دقيقة
    await user.save({ validateBeforeSave: false });

    console.log(`[OTP] ${cleanEmail} => ${otp}`);

    const isLocal = !process.env.VERCEL;
    let emailSent = false;
    try {
      const sendEmail = require('../utils/sendEmail');
      const emailResult = await sendEmail({
        email: cleanEmail,
        subject: 'رمز التحقق (OTP) - وظيفة العمر 💼',
        otpCode: otp,
      });
      emailSent = Boolean(emailResult?.sent);
    } catch (mailErr) {
      console.error('[OTP] فشل إرسال الإيميل:', mailErr.message);
    }

    if (emailSent || isLocal) {
      return res.status(200).json({
        success: true,
        message: emailSent
          ? `تم إرسال رمز التحقق (OTP) بنجاح إلى إيميلك: ${cleanEmail}`
          : 'تم إنشاء رمز التحقق. في التيست المحلي يظهر الرمز في الشاشة وفي كونسول الباكند.',
        otpCode: isLocal ? otp : undefined,
      });
    }

    return res.status(500).json({
      success: false,
      message: 'فشل إرسال البريد الإلكتروني، يرجى المحاولة لاحقاً أو التحقق من صحة البريد.',
    });
  } catch (error) {
    next(error);
  }
};

// @desc    التحقق من صحة رمز OTP
// @route   POST /api/auth/verify-otp
// @access  Public
const verifyOtp = async (req, res, next) => {
  try {
    const { email, otp } = req.body;
    if (!email || !otp) return res.status(400).json({ success: false, message: 'البريد ورمز التحقق مطلوبان' });

    const cleanEmail = String(email).toLowerCase().trim();
    const cleanOtp = String(otp).trim();

    const user = await User.findOne({ email: cleanEmail });
    if (!user) return res.status(404).json({ success: false, message: 'المستخدم غير موجود' });

    if (!user.otpCode || user.otpCode.toString().trim() !== cleanOtp) {
      return res.status(400).json({ success: false, message: 'رمز التحقق (OTP) غير صحيح! يرجى التأكد من الرمز المرسل لإيميلك.' });
    }

    if (user.otpExpire && user.otpExpire < Date.now()) {
      return res.status(400).json({ success: false, message: 'انتهت صلاحية رمز التحقق! يرجى طلب رمز جديد.' });
    }

    user.isVerified = true;
    user.otpCode = undefined;
    user.otpExpire = undefined;
    user.lastLogin = Date.now();
    await user.save({ validateBeforeSave: false });

    const token = generateToken(user._id);

    res.status(200).json({
      success: true,
      message: 'تم التحقق من الحساب بنجاح!',
      token,
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
    next(error);
  }
};

// @desc    إعادة تعيين كلمة المرور باستخدام رمز OTP
// @route   POST /api/auth/reset-password-otp
// @access  Public
const resetPasswordWithOtp = async (req, res, next) => {
  try {
    const { email, otp, newPassword, confirmPassword } = req.body;
    if (!email || !otp || !newPassword) {
      return res.status(400).json({ success: false, message: 'جميع الحقول مطلوبة' });
    }

    const cleanEmail = String(email).toLowerCase().trim();
    const cleanOtp = String(otp).trim();

    if (!isStrongPassword(newPassword)) {
      return res.status(400).json({ success: false, message: PASSWORD_RULE_MSG });
    }

    if (confirmPassword && newPassword !== confirmPassword) {
      return res.status(400).json({ success: false, message: 'كلمة المرور وتأكيد كلمة المرور غير متطابقتين' });
    }

    const user = await User.findOne({ email: cleanEmail });
    if (!user) return res.status(404).json({ success: false, message: 'المستخدم غير موجود' });

    if (!user.otpCode || user.otpCode.toString().trim() !== cleanOtp) {
      return res.status(400).json({ success: false, message: 'رمز التحقق (OTP) غير صحيح! تأكد من الرمز المرسل إلى بريدك.' });
    }
    if (user.otpExpire && user.otpExpire < Date.now()) {
      return res.status(400).json({ success: false, message: 'انتهت صلاحية رمز التحقق! يرجى طلب رمز جديد.' });
    }

    user.password = newPassword;
    user.otpCode = undefined;
    user.otpExpire = undefined;
    user.isVerified = true;
    user.lastLogin = Date.now();
    await user.save();

    const token = generateToken(user._id);

    res.status(200).json({
      success: true,
      message: 'تم إعادة تعيين كلمة المرور وتسجيل الدخول بنجاح!',
      token,
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
    next(error);
  }
};

module.exports = {
  registerUser,
  loginUser,
  googleLogin,
  sendOtp,
  verifyOtp,
  resetPasswordWithOtp,
  getMe,
  logoutUser,
};
