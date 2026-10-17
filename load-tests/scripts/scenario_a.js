import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE_URL = __ENV.TARGET_URL || 'http://kale-app:3000';

export const options = {
  stages: [
    { duration: '20s', target: 100 },   // Isınma (Ramp-up)
    { duration: '40s', target: 500 },   // Yük artışı
    { duration: '1m', target: 1000 },   // 1.000 VU zirve
    { duration: '30s', target: 0 },     // Soğuma (Ramp-down)
  ],
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<200', 'p(99)<400'],
  },
};

export default function () {
  const payload = JSON.stringify({
    full_name: 'Test User ' + __VU + '_' + __ITER,
    phone: '0532' + Math.floor(1000000 + Math.random() * 9000000),
    request_type: 'ARIZA',
    description: 'Redis kapali durum Fail-Open MySQL yuk testi',
  });

  const params = {
    headers: {
      'Content-Type': 'application/json',
    },
    tags: { name: 'CreateServiceRequest' },
  };

  const res = http.post(BASE_URL + '/api/requests', payload, params);

  check(res, {
    'Talep olusturuldu (status 201)': (r) => r.status === 201,
  });

  sleep(0.5);
}