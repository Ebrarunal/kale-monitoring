const express = require('express');
const { writeLog } = require('../logger');
const users = require('../auth/users');
const { requireAuth, requireRole, boundedDb, sendServiceUnavailable } = require('../auth/middleware');

// Yollar tam haliyle tanimlanir (router mount edilmez); istek log'u gercek yolu gorur.
const router = express.Router();

router.get('/api/staff/users', requireAuth(), requireRole('ADMIN'), async (req, res) => {
  try {
    const list = await boundedDb(() => users.listUsers());
    return res.json({ users: list });
  } catch (err) {
    writeLog('ERROR', `Personel listesi alinamadi: ${err.message}`);
    return sendServiceUnavailable(res);
  }
});

module.exports = router;
