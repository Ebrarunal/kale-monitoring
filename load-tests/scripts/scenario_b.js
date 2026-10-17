import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE_URL = __ENV.TARGET_URL || 'http://kale-app:3000'\;

export const options = {
  stages: [
    { duration: '20s', target: 250 },    // Isınma (Ramp-up)
    { duration: '40s', target: 1000 },   // 1.000 VU zirve
    { duration: '1m30s', target: 1000 }, // 1.000 VU ile sabit oturum baskısı
    { duration: '20s', target: 0 },      // Soğuma (Ramp-down)
  ],
  thresholds: {
    http_req_failed: ['rate<0.01'],              // Hata oranı %1'in altında kalmalı
    http_req_duration: ['p(95)<50', 'p(99)<100'], // Redis devredeyken agresif hedef: < 50ms
  },
};

export default function () {
  // 1. Adım: Login (Oturum açma ve token üretimi)
  const loginPayload = JSON.stringify({
    username: 'user_' + ((__VU % 100) + 1),
    password: 'Password123!',
  });

  const loginRes = http.post(BASE_URL + '/api/auth/login', loginPayload, {
    headers: { 'Content-Type': 'application/json' },
    tags: { name: 'AuthLogin' },
  });

  const loginOk = check(loginRes, {
    'login status is 200': (r) => r.status === 200,
  });

  if (!loginOk) {
    sleep(1);
    return;
  }

  const token = loginRes.json('token');

  // 2. Adım: Session Doğrulama (Redis üzerinden oturum okuma)
  const authHeaders = {
    headers: {
      'Authorization': 'Bearer ' + token,
      'Content-Type': 'application/json',
    },
    tags: { name: 'ValidateSession' },
  };

  const sessionRes = http.get(BASE_URL + '/api/auth/session', authHeaders);

  check(sessionRes, {
    'session valid is 200': (r) => r.status === 200,
  });

  sleep(0.3);
}
