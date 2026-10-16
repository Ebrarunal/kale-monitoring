const db = require('../db');

const USER_COLUMNS = 'id, email, password_hash, full_name, role, is_active, must_change_password';

async function findUserByEmail(email) {
  const [rows] = await db.query(`SELECT ${USER_COLUMNS} FROM users WHERE email = ? LIMIT 1`, [email]);
  return rows[0] || null;
}

async function findUserById(id) {
  const [rows] = await db.query(`SELECT ${USER_COLUMNS} FROM users WHERE id = ? LIMIT 1`, [id]);
  return rows[0] || null;
}

async function updateLastLogin(id) {
  await db.query('UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = ?', [id]);
}

async function updatePassword(id, passwordHash) {
  await db.query(
    'UPDATE users SET password_hash = ?, must_change_password = FALSE WHERE id = ?',
    [passwordHash, id]
  );
}

// Admin personel listesi: sadece gereken alanlar secilir, password_hash sorguya hic girmez.
async function listUsers() {
  const [rows] = await db.query(
    'SELECT id, email, full_name, role, is_active, last_login_at FROM users ORDER BY id LIMIT 500'
  );
  return rows.map((row) => ({
    id: row.id,
    email: row.email,
    fullName: row.full_name,
    role: row.role,
    isActive: Boolean(row.is_active),
    lastLoginAt: row.last_login_at
  }));
}

// API cevabinda gosterilecek alanlar; password_hash asla disari cikmaz.
function toPublicUser(user) {
  return {
    id: user.id,
    email: user.email,
    fullName: user.full_name,
    role: user.role,
    mustChangePassword: Boolean(user.must_change_password)
  };
}

module.exports = { findUserByEmail, findUserById, updateLastLogin, updatePassword, listUsers, toPublicUser };
