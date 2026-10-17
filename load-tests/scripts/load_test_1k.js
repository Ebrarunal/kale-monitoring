import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE_URL = __ENV.TARGET_URL || 'http://localhost:3001';

export const options = {
  stages: [
    { duration: '20s', target: 100 },   // Isınma (Ramp-up)
    { duration: '40s', target: 500 },   // 500 Sanal Kullanıcı
    { duration: '1m', target: 1000 },   // 1.000 Sanal Kullanıcı (Zirve)
    { duration: '30s', target: 0 },     // Soğuma (Ramp-down)
  ],
  thresholds: {
    http_req_failed: ['rate<0.05'],               // Hata oranı %5 altında kalmalı
    http_req_duration: ['p(95)<500', 'p(99)<1000'], // p95 < 500ms, p99 < 1s
  },
};

export default function () {
  const res = http.get(`${BASE_URL}/api/requests`, {
    tags: { name: 'GetRequests' },
  });

  check(res, {
    'status is 200': (r) => r.status === 200,
  });

  sleep(1);
}