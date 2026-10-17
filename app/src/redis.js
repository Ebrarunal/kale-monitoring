const { createClient } = require('redis');
const { writeLog } = require('./logger');
const { withTimeout } = require('./timeout');

// Uygulama tarafindan beklenen en uzun Redis cevap suresi.
// node-redis'in kendi komut timeout'u komut gonderildikten sonra gecerli olmadigi icin
// sinir burada (withTimeout ile) uygulanir.
const REDIS_COMMAND_TIMEOUT_MS = 1000;

const redisClient = createClient({
  socket: {
    host: process.env.REDIS_HOST,
    port: Number(process.env.REDIS_PORT) || 6379,
    connectTimeout: 3000,
    // Redis bagli gorunup cevap vermiyorsa soket 10 sn sonra kapatilir ve yeniden baglanilir.
    socketTimeout: 10000,
    // Baglanti koparsa artan surelerle (en fazla 5 sn) yeniden dener; uygulama cokmez.
    reconnectStrategy: (retries) => Math.min(retries * 200, 5000)
  },
  password: process.env.REDIS_PASSWORD || undefined,
  // Bos baglantida socketTimeout tetiklenmesin diye duzenli PING atilir.
  pingInterval: 3000,
  // Redis yokken komutlar kuyrukta beklemez, hemen hata verir; istekler asili kalmaz.
  disableOfflineQueue: true,
  // Redis takilirsa bekleyen komut sayisi sinirsiz buyumez.
  commandsQueueMaxLength: 1000
});

// Yeniden baglanma denemeleri sirasinda log'u doldurmamak icin
// sadece durum degisikliklerini (UP -> DOWN, DOWN -> UP) loglar.
let isUp = false;
let downLogged = false;

redisClient.on('ready', () => {
  isUp = true;
  downLogged = false;
  writeLog('INFO', 'Redis baglantisi kuruldu');
});

// Bu dinleyici zorunlu: tanimlanmazsa ilk baglanti hatasi uygulamayi cokertir.
redisClient.on('error', (err) => {
  if (isUp || !downLogged) {
    writeLog('ERROR', `Redis baglanti hatasi: ${err.message || err.code || err}`);
    downLogged = true;
  }
  isUp = false;
});

redisClient.connect().catch((err) => {
  writeLog('ERROR', `Redis ilk baglanti basarisiz: ${err.message || err.code || err}`);
});

function isRedisReady() {
  return redisClient.isReady;
}

// Redis komutunu suresi sinirli calistirir.
function boundedRedis(operation) {
  return withTimeout(operation, REDIS_COMMAND_TIMEOUT_MS, 'Redis');
}

async function pingRedis() {
  if (!redisClient.isReady) throw new Error('Redis hazir degil');
  await boundedRedis(() => redisClient.ping());
}

module.exports = { redisClient, isRedisReady, boundedRedis, pingRedis, REDIS_COMMAND_TIMEOUT_MS };
