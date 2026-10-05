const express = require('express');
require('dotenv').config();

const db = require('./db');

const client = require('prom-client');

const fs = require('fs');
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

client.collectDefaultMetrics();

function writeLog(level, message) {
  const logLine = `${new Date().toISOString()} [${level}] ${message}\n`;

  const logPath = path.join(__dirname, '..', 'logs', 'application.log');

  fs.appendFileSync(logPath, logLine);
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

app.get('/health', async (req, res) => {
  try {
    await db.query('SELECT 1');

    res.json({
      status: 'UP',
      database: 'UP',
      uptime: process.uptime()
    });
  } catch (err) {
  writeLog('ERROR', `Database connection failed: ${err.message}`);

  res.status(503).json({
    status: 'DEGRADED',
    database: 'DOWN',
    uptime: process.uptime()
});
}});

app.get('/api/status', async (req, res) => {
  let database = 'UP';

  try {
    await db.query('SELECT 1');
  } catch (err) {
    database = 'DOWN';
    writeLog('ERROR', `Database connection failed: ${err.message}`);
  }

  const errorRate = requestStats.total
    ? (requestStats.errors / requestStats.total) * 100
    : 0;

  res.status(database === 'UP' ? 200 : 503).json({
    application: 'UP',
    api: 'UP',
    database,
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
  try {
    const { full_name, phone, request_type, description } = req.body;

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

app.listen(PORT, () => {
  console.log(`Server http://localhost:${PORT} adresinde calisiyor.`);
  writeLog('INFO', `Server ${PORT} portunda baslatildi`);
});