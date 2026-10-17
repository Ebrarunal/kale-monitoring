const { hashPassword, validatePasswordPolicy } = require('../src/auth/password');
const { normalizeEmail, isValidEmail } = require('../src/auth/email');

// Sistemde hic admin yoksa env'deki bilgilerle ilk admini olusturur.
// Tekrar calistirilabilir: admin varsa hicbir sey yapmaz, mevcut kullanicilari asla silmez.
exports.seed = async function (knex) {
  const existingAdmin = await knex('users').where({ role: 'ADMIN' }).first('id');
  if (existingAdmin) {
    console.log('[seed] Admin kullanici zaten mevcut, atlandi.');
    return;
  }

  const email = normalizeEmail(process.env.ADMIN_EMAIL);
  const password = process.env.ADMIN_PASSWORD || '';
  const fullName = (process.env.ADMIN_FULL_NAME || '').trim();

  if (!isValidEmail(email) || !fullName) {
    throw new Error('ADMIN_EMAIL ve ADMIN_FULL_NAME gecerli sekilde tanimlanmalidir.');
  }

  const policyError = validatePasswordPolicy(password);
  if (policyError) {
    throw new Error(`ADMIN_PASSWORD gecersiz: ${policyError}`);
  }

  await knex('users').insert({
    email,
    password_hash: await hashPassword(password),
    must_change_password: true,
    full_name: fullName,
    role: 'ADMIN'
  });

  console.log(`[seed] Ilk admin olusturuldu: ${email}`);
};
