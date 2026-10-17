const { writeLog } = require('../logger');
const { withTimeout } = require('../timeout');
const users = require('./users');
const { isStaffPath, destroySession, clearSessionCookie } = require('../session');

// Personel isteginde veritabani en fazla bu kadar beklenir.
const DB_TIMEOUT_MS = 2000;
const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function parseOrigin(value) {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

// Ornek: ALLOWED_ORIGINS=https://kale.example.com,https://panel.kale.example.com
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((item) => parseOrigin(item.trim()))
  .filter(Boolean);

// Production'da Host basligina (proxy arkasinda degisebilir) guvenilmez; liste zorunludur.
if (process.env.NODE_ENV === 'production' && ALLOWED_ORIGINS.length === 0) {
  throw new Error('Production ortaminda ALLOWED_ORIGINS tanimlanmalidir.');
}

function sendAuthError(res, status, code, error) {
  return res.status(status).json({ error, code });
}

function sendServiceUnavailable(res) {
  res.set('Retry-After', '30');
  return res.status(503).json({
    error: 'Servis gecici olarak kullanilamiyor. Lutfen daha sonra tekrar deneyin.',
    code: 'SERVICE_UNAVAILABLE'
  });
}

function logDenied(reason, req, detail = '') {
  writeLog('INFO', `Yetkisiz erisim: neden=${reason}${detail} ${req.method} ${req.path} ip=${req.ip}`);
}

function boundedDb(operation) {
  return withTimeout(operation, DB_TIMEOUT_MS, 'MySQL');
}

// Personel yollarinda veri degistiren istekler sadece JSON kabul eder.
// Bu bir CSRF korumasi DEGILDIR; yalnizca ek bir katmandir. Asil CSRF korumasi
// (Origin kontrolu / CSRF token) ayrica gereklidir.
function requireJsonForStaffWrites(req, res, next) {
  if (!isStaffPath(req.path) || !WRITE_METHODS.has(req.method)) return next();
  if (!/^application\/json\b/i.test(req.get('content-type') || '')) {
    return res.status(415).json({ error: 'Istek govdesi application/json olmalidir.', code: 'UNSUPPORTED_MEDIA_TYPE' });
  }
  return next();
}

function isTrustedOrigin(origin, req) {
  if (ALLOWED_ORIGINS.length > 0) return ALLOWED_ORIGINS.includes(origin);
  // Liste yoksa (gelistirme): sadece ayni adresten gelen istekler kabul edilir.
  return new URL(origin).host === req.get('host');
}

// CSRF korumasi: personel yollarinda veri degistiren istegin baska bir siteden
// gelmedigini Origin (yoksa Referer) basligiyla dogrular.
function requireTrustedOriginForStaffWrites(req, res, next) {
  if (!isStaffPath(req.path) || !WRITE_METHODS.has(req.method)) return next();

  const originHeader = req.get('origin');
  const refererHeader = req.get('referer');

  // Bu basliklari yalnizca tarayicilar gonderir; CSRF de ancak tarayicidan yapilabilir.
  // Tarayici disi istemciler (curl, sunucudan sunucuya) bu yuzden engellenmez.
  if (!originHeader && !refererHeader) return next();

  const origin = originHeader === 'null' ? null : parseOrigin(originHeader || refererHeader);
  if (origin && isTrustedOrigin(origin, req)) return next();

  const shown = String(originHeader || refererHeader).replace(/[^\x21-\x7e]/g, '?').slice(0, 100);
  const source = originHeader ? 'origin' : 'referer';
  writeLog('INFO', `CSRF engellendi: neden=UNTRUSTED_ORIGIN ${source}=${shown} ${req.method} ${req.path} ip=${req.ip}`);
  return res.status(403).json({ error: 'Istek kaynagi dogrulanamadi.', code: 'UNTRUSTED_ORIGIN' });
}

// Gecerli oturum + veritabaninda var olan ve aktif hesap ister.
// Kullanici her istekte veritabanindan okunur; session'daki rol bilgisine guvenilmez.
// Kosul saglanmazsa cevabi kendisi gonderir ve null doner.
async function loadCurrentUser(req, res, { logUnauthenticated = true } = {}) {
  const userId = req.session?.userId;
  if (!userId) {
    if (logUnauthenticated) logDenied('NOT_AUTHENTICATED', req);
    sendAuthError(res, 401, 'NOT_AUTHENTICATED', 'Oturum acilmamis.');
    return null;
  }

  let user;
  try {
    user = await boundedDb(() => users.findUserById(userId));
  } catch (err) {
    writeLog('ERROR', `Kullanici bilgisi okunamadi, personel istegi reddedildi: userId=${userId} ${req.method} ${req.path} ${err.message}`);
    sendServiceUnavailable(res);
    return null;
  }

  if (!user || !user.is_active) {
    await destroySession(req);
    clearSessionCookie(res);
    writeLog('INFO', `Oturum sonlandirildi: userId=${userId} neden=${user ? 'INACTIVE' : 'USER_NOT_FOUND'}`);
    sendAuthError(res, 401, 'NOT_AUTHENTICATED', 'Oturum acilmamis.');
    return null;
  }

  return user;
}

// allowPasswordChangeRequired: sadece /me ve sifre degistirme icin; bu yollar
// zorunlu sifre degistirme engelinden muaftir, diger kontrollerden degil.
function requireAuth({ allowPasswordChangeRequired = false, logUnauthenticated = true } = {}) {
  return async function authGuard(req, res, next) {
    try {
      const user = await loadCurrentUser(req, res, { logUnauthenticated });
      if (!user) return undefined;

      if (user.must_change_password && !allowPasswordChangeRequired) {
        logDenied('PASSWORD_CHANGE_REQUIRED', req, ` userId=${user.id}`);
        return sendAuthError(res, 403, 'PASSWORD_CHANGE_REQUIRED', 'Devam etmeden once sifrenizi degistirmelisiniz.');
      }

      req.user = user;
      return next();
    } catch (err) {
      return next(err);
    }
  };
}

function requireRole(...roles) {
  return function roleGuard(req, res, next) {
    // requireAuth olmadan kullanilirsa erisim verilmez (fail-closed).
    if (!req.user) return next(new Error('requireRole, requireAuth olmadan kullanildi'));

    if (!roles.includes(req.user.role)) {
      logDenied('FORBIDDEN', req, ` userId=${req.user.id} rol=${req.user.role} gerekli=${roles.join('|')}`);
      return sendAuthError(res, 403, 'FORBIDDEN', 'Bu islem icin yetkiniz yok.');
    }
    return next();
  };
}

module.exports = {
  requireJsonForStaffWrites,
  requireTrustedOriginForStaffWrites,
  requireAuth,
  requireRole,
  boundedDb,
  sendServiceUnavailable
};
