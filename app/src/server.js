const express = require('express');
require('dotenv').config();

const db = require('./db');
const { writeLog } = require('./logger');
const { pingRedis } = require('./redis');
const { createStaffSessionMiddleware, sessionErrorHandler } = require('./session');
const { withTimeout } = require('./timeout');
const authRoutes = require('./auth/routes');
const staffRoutes = require('./staff/routes');
const { requireJsonForStaffWrites, requireTrustedOriginForStaffWrites } = require('./auth/middleware');
const { validateServiceRequest } = require('./requests/validate');

const client = require('prom-client');

const path = require('path');

const app = express();
app.use(express.json());

const httpRequestDuration = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'route', 'status'],
  buckets: [0.1, 0.3, 0.5, 1, 2, 3, 5]
});

const httpRequestCounter = new client.Counter({
  name: 'http_requests_total',
  help: 'Toplam HTTP istek sayisi',
  labelNames: ['method', 'route', 'status']
});

const serviceRequestCounter = new client.Counter({
  name: 'service_requests_created_total',
  help: 'Basariyla olusturulan toplam servis talebi sayisi'
});

const requestStats = {
  total: 0,
  errors: 0,
  totalDurationMs: 0,
  currentDurationMs: null
};

app.use((req, res, next) => {
  const start = process.hrtime.bigint();

  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
    requestStats.total += 1;
    requestStats.totalDurationMs += durationMs;
    requestStats.currentDurationMs = durationMs;
    if (res.statusCode >= 500) requestStats.errors += 1;

    httpRequestCounter.inc({
      method: req.method,
      route: req.path,
      status: res.statusCode
    });
    httpRequestDuration.observe(
      { method: req.method, route: req.path, status: res.statusCode },
      durationMs / 1000
    );
    const level = res.statusCode >= 500 ? 'ERROR' : 'INFO';

    writeLog(
      level,
      `${req.method} ${req.path} ${res.statusCode} ${durationMs.toFixed(2)}ms`
    ); 
  });

  next();
});

app.use(express.static('public'));

// Sadece personel yollarinda (/api/auth, /api/staff) calisir; musteri talepleri Redis'e bagli degildir.
// Session'dan once: kurala uymayan istek Redis'e hic ugramadan reddedilir.
app.use(requireJsonForStaffWrites);
app.use(requireTrustedOriginForStaffWrites);
app.use(createStaffSessionMiddleware());

app.use(authRoutes);
app.use(staffRoutes);

client.collectDefaultMetrics();

const HEALTH_CHECK_TIMEOUT_MS = 2000;

async function checkDatabase() {
  try {
    await withTimeout(() => db.query('SELECT 1'), HEALTH_CHECK_TIMEOUT_MS, 'MySQL');
    return 'UP';
  } catch (err) {
    writeLog('ERROR', `Database connection failed: ${err.message}`);
    return 'DOWN';
  }
}

async function checkRedis() {
  try {
    await pingRedis();
    return 'UP';
  } catch {
    return 'DOWN';
  }
}

const PORT = process.env.PORT || 3000;

app.get('/test/error', (req, res) => {
  writeLog('ERROR', 'Test error endpoint called');
  res.status(500).json({
    error: 'Test HTTP 500 endpoint'
  });
});

app.get('/test/slow', (req, res) => {
  setTimeout(() => {
    res.json({
      message: 'Test slow endpoint response',
      delay: 3000
    });
  }, 3000);
});

app.get('/status', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'status.html'));
});

// Liveness: sadece surecin ayakta oldugunu soyler, bagimliliklara bakmaz.
// Redis/MySQL kesintisinde container'in gereksiz yere yeniden baslatilmasini onler.
app.get('/health/live', (req, res) => {
  res.json({
    status: 'UP',
    uptime: process.uptime()
  });
});

// Bagimlilik durumu (izleme/alarm icin): biri DOWN ise 503 doner.
app.get('/health', async (req, res) => {
  const [database, redis] = await Promise.all([checkDatabase(), checkRedis()]);
  const healthy = database === 'UP' && redis === 'UP';

  res.status(healthy ? 200 : 503).json({
    status: healthy ? 'UP' : 'DEGRADED',
    database,
    redis,
    uptime: process.uptime()
  });
});

app.get('/api/status', async (req, res) => {
  const [database, redis] = await Promise.all([checkDatabase(), checkRedis()]);

  const errorRate = requestStats.total
    ? (requestStats.errors / requestStats.total) * 100
    : 0;

  res.status(database === 'UP' && redis === 'UP' ? 200 : 503).json({
    application: 'UP',
    api: 'UP',
    database,
    redis,
    uptime: process.uptime(),
    requests: requestStats.total,
    errors: requestStats.errors,
    errorRate,
    responseTimeCurrentMs: requestStats.currentDurationMs,
    responseTimeAverageMs: requestStats.total
      ? requestStats.totalDurationMs / requestStats.total
      : null
  });
});

app.get('/api/requests', async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT * FROM service_requests ORDER BY id DESC LIMIT 10'
    );

    res.json(rows);
  } catch (err) {
  writeLog(
    'ERROR',
    `GET /api/requests failed: ${err.message}`
  );

  res.status(500).json({
    error: 'Talepler alinamadi.'
  });
}
});

app.post('/api/requests', async (req, res) => {
  const { value, invalidFields } = validateServiceRequest(req.body);
  if (invalidFields) {
    writeLog('INFO', `Talep reddedildi: neden=VALIDATION alanlar=${invalidFields.join(',')}`);
    return res.status(400).json({
      error: 'Eksik veya hatali alanlar var.',
      fields: invalidFields
    });
  }

  try {
    const { full_name, phone, request_type, description } = value;

    const [result] = await db.query(
      `INSERT INTO service_requests
       (full_name, phone, request_type, description)
       VALUES (?, ?, ?, ?)`,
      [full_name, phone, request_type, description]
    );

    serviceRequestCounter.inc();

writeLog(
  'INFO',
  `Service request created successfully. ID: ${result.insertId}`
);

    res.status(201).json({
      message: 'Talep basariyla olusturuldu.',
      id: result.insertId
    });
  } catch (err) {
  writeLog('ERROR', `POST /api/requests failed: ${err.message}`);

  res.status(500).json({
    error: 'Talep olusturulamadi.'
  });
}});

app.get('/metrics', async (req, res) => {
  res.set('Content-Type', client.register.contentType);
  res.end(await client.register.metrics());
});

// Tum route'lardan sonra: session deposu hatalarini 503'e cevirir, digerlerini Express'e birakir.
app.use(sessionErrorHandler);

// Son hata yakalayici: bozuk JSON icin 400, digerleri icin 500 doner.
// Hata ayrintisi (stack trace) kullaniciya gosterilmez, sadece log'a yazilir.
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);

  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Istek govdesi gecerli bir JSON degil.' });
  }
  if (err.status >= 400 && err.status < 500) {
    return res.status(err.status).json({ error: 'Gecersiz istek.' });
  }

  writeLog('ERROR', `Beklenmeyen hata: ${req.method} ${req.path} ${err.message}`);
  return res.status(500).json({ error: 'Beklenmeyen bir hata olustu.' });
});

app.listen(PORT, () => {
  console.log(`Server http://localhost:${PORT} adresinde calisiyor.`);
  writeLog('INFO', `Server ${PORT} portunda baslatildi`);
});