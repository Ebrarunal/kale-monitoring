const express = require('express');
const { writeLog } = require('../logger');
const { normalizeEmail, isValidEmail, maskEmail } = require('./email');
const {
  hashPassword,
  verifyPassword,
  verifyDummyPassword,
  validatePasswordPolicy
} = require('./password');
const users = require('./users');
const { requireAuth } = require('./middleware');
const {
  regenerateSession,
  saveSession,
  destroySession,
  clearSessionCookie
} = require('../session');

const MAX_PASSWORD_INPUT_LENGTH = 128;
const GENERIC_LOGIN_ERROR = 'E-posta veya sifre hatali.';

// Yollar tam haliyle tanimlanir (router mount edilmez); boylece istek log'u ve
// metrikler /api/auth/login gibi gercek yolu gorur.
// JSON zorunlulugu merkezi olarak uygulanir (middleware.js: requireJsonForStaffWrites).
const router = express.Router();

// /me ve sifre degistirme: gecerli oturum ve aktif hesap ister,
// sadece zorunlu sifre degistirme engelinden muaftir.
const requireAuthAllowingPasswordChange = requireAuth({ allowPasswordChangeRequired: true });

function isPasswordInput(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_PASSWORD_INPUT_LENGTH;
}

function logLoginFailure(reason, email, req) {
  const emailPart = email ? ` email=${maskEmail(email)}` : '';
  writeLog('INFO', `Login basarisiz: neden=${reason}${emailPart} ip=${req.ip}`);
}

async function endSession(req, res) {
  await destroySession(req);
  clearSessionCookie(res);
}

router.post('/api/auth/login', async (req, res, next) => {
  try {
    const { email: rawEmail, password } = req.body ?? {};
    const email = normalizeEmail(rawEmail);

    if (!isValidEmail(email) || !isPasswordInput(password)) {
      logLoginFailure('INVALID_INPUT', null, req);
      return res.status(400).json({ error: 'Gecerli bir e-posta ve sifre giriniz.' });
    }

    const user = await users.findUserByEmail(email);
    if (!user) {
      // Kullanici yokken de ayni sure harcanir; cevap suresinden e-posta tahmin edilemez.
      await verifyDummyPassword(password);
      logLoginFailure('USER_NOT_FOUND', email, req);
      return res.status(401).json({ error: GENERIC_LOGIN_ERROR });
    }

    if (!(await verifyPassword(user.password_hash, password))) {
      logLoginFailure('WRONG_PASSWORD', email, req);
      return res.status(401).json({ error: GENERIC_LOGIN_ERROR });
    }

    // Sifre kontrolunden sonra: pasif hesap icin de cevap suresi ve mesaj ayni kalir.
    if (!user.is_active) {
      logLoginFailure('INACTIVE', email, req);
      return res.status(401).json({ error: GENERIC_LOGIN_ERROR });
    }

    // Session fixation korumasi: giriste session kimligi yenilenir.
    await regenerateSession(req);
    req.session.userId = user.id;
    req.session.role = user.role;
    req.session.mustChangePassword = Boolean(user.must_change_password);
    req.session.loginAt = Date.now();
    // Cevaptan once kaydedilir; Redis hatasinda kullanici "girdi" sanilmaz, 503 alir.
    await saveSession(req);

    await users.updateLastLogin(user.id);
    writeLog('INFO', `Login basarili: userId=${user.id} ip=${req.ip}`);

    return res.json({ user: users.toPublicUser(user) });
  } catch (err) {
    return next(err);
  }
});

router.post('/api/auth/logout', async (req, res, next) => {
  try {
    const { userId } = req.session;
    if (userId) {
      await endSession(req, res);
      writeLog('INFO', `Logout: userId=${userId}`);
    } else {
      clearSessionCookie(res);
    }
    return res.status(204).end();
  } catch (err) {
    return next(err);
  }
});

// Arayuz bu endpoint'i "giris yapmis miyim?" diye sik cagirir; oturumsuz cagri loglanmaz.
router.get('/api/auth/me', requireAuth({ allowPasswordChangeRequired: true, logUnauthenticated: false }), (req, res) => {
  return res.json({ user: users.toPublicUser(req.user) });
});

router.post('/api/auth/change-password', requireAuthAllowingPasswordChange, async (req, res, next) => {
  try {
    const user = req.user;
    const userId = user.id;
    const { loginAt } = req.session;

    const { currentPassword, newPassword } = req.body ?? {};
    if (!isPasswordInput(currentPassword) || typeof newPassword !== 'string') {
      return res.status(400).json({ error: 'Mevcut ve yeni sifre gereklidir.' });
    }

    const policyError = validatePasswordPolicy(newPassword);
    if (policyError) {
      return res.status(400).json({ error: policyError });
    }
    if (newPassword === currentPassword) {
      return res.status(400).json({ error: 'Yeni sifre mevcut sifreden farkli olmalidir.' });
    }

    if (!(await verifyPassword(user.password_hash, currentPassword))) {
      writeLog('INFO', `Sifre degistirme basarisiz: userId=${userId} neden=WRONG_PASSWORD ip=${req.ip}`);
      return res.status(401).json({ error: 'Mevcut sifre hatali.' });
    }

    await users.updatePassword(userId, await hashPassword(newPassword));

    // Sifre degisince session kimligi de yenilenir; giris zamani korunur.
    await regenerateSession(req);
    req.session.userId = userId;
    req.session.role = user.role;
    req.session.mustChangePassword = false;
    req.session.loginAt = loginAt;
    await saveSession(req);

    writeLog('INFO', `Sifre degistirildi: userId=${userId}`);
    return res.status(204).end();
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
