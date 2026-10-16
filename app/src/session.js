const session = require('express-session');
const { RedisStore } = require('connect-redis');
const { redisClient, isRedisReady, boundedRedis } = require('./redis');
const { writeLog } = require('./logger');

// Islem yapilmazsa oturumun dusecegi sure; her istekte yenilenir (rolling).
const IDLE_TIMEOUT_MS = 15 * 60 * 1000;
const MIN_SECRET_LENGTH = 32;

// Session SADECE bu yollarda calisir. Herkese acik sayfalar ve musteri talep API'si
// Redis'e hic dokunmaz; Redis kesilse de talep almaya devam eder.
const STAFF_PATH_PREFIXES = ['/api/auth', '/api/staff'];

function isStaffPath(requestPath) {
  return STAFF_PATH_PREFIXES.some(
    (prefix) => requestPath === prefix || requestPath.startsWith(`${prefix}/`)
  );
}

class SessionStoreError extends Error {
  constructor(cause) {
    super(`Session deposu hatasi: ${cause?.message || cause}`);
    this.name = 'SessionStoreError';
    this.cause = cause;
  }
}

function bounded(operation) {
  return boundedRedis(operation).catch((err) => {
    throw new SessionStoreError(err);
  });
}

// connect-redis'in kullandigi komutlar, suresi sinirli ve hatalari isaretlenmis halde.
const boundedSessionClient = {
  get: (key) => bounded(() => redisClient.get(key)),
  set: (key, value, options) => bounded(() => redisClient.set(key, value, options)),
  expire: (key, seconds) => bounded(() => redisClient.expire(key, seconds)),
  del: (keys) => bounded(() => redisClient.del(keys)),
  mGet: (keys) => bounded(() => redisClient.mGet(keys)),
  // Sadece toplu listeleme (aktif oturumlar) icin; istek akisinda kullanilmaz.
  scanIterator: (options) => redisClient.scanIterator(options)
};

function sendSessionUnavailable(res) {
  res.set('Retry-After', '30');
  res.status(503).json({
    error: 'Personel oturum servisi gecici olarak kullanilamiyor. Lutfen daha sonra tekrar deneyin.'
  });
}

function createStaffSessionMiddleware() {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < MIN_SECRET_LENGTH) {
    throw new Error(`SESSION_SECRET en az ${MIN_SECRET_LENGTH} karakter olmalidir.`);
  }

  const sessionMiddleware = session({
    name: 'kale.sid',
    store: new RedisStore({ client: boundedSessionClient, prefix: 'sess:' }),
    secret,
    resave: false,
    // Giris yapmayan ziyaretciler icin Redis'te kayit acilmaz.
    saveUninitialized: false,
    rolling: true,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: IDLE_TIMEOUT_MS
    }
  });

  return function staffSession(req, res, next) {
    if (!isStaffPath(req.path)) return next();

    // Redis yoksa personel istegi beklemeden ve guvenli sekilde reddedilir (fail-closed).
    if (!isRedisReady()) {
      writeLog('ERROR', `Session deposu hazir degil, personel istegi reddedildi: ${req.method} ${req.path}`);
      return sendSessionUnavailable(res);
    }

    return sessionMiddleware(req, res, next);
  };
}

// Redis bagli gorunurken komut hata verir ya da sure asimina ugrarsa devreye girer.
function sessionErrorHandler(err, req, res, next) {
  if (!(err instanceof SessionStoreError) || res.headersSent) return next(err);

  writeLog('ERROR', `${err.message}, personel istegi reddedildi: ${req.method} ${req.path}`);
  return sendSessionUnavailable(res);
}

module.exports = {
  createStaffSessionMiddleware,
  sessionErrorHandler,
  isStaffPath,
  IDLE_TIMEOUT_MS,
  STAFF_PATH_PREFIXES
};
