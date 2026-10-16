const argon2 = require('argon2');

const MIN_LENGTH = 12;
const MAX_LENGTH = 128;

// OWASP onerisi: argon2id, 19 MiB bellek, 2 iterasyon, 1 paralellik.
const HASH_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1
};

// Kurala uymayan sifre icin hata mesaji, uyan sifre icin null doner.
function validatePasswordPolicy(plain) {
  if (typeof plain !== 'string') return 'Sifre metin olmalidir.';
  if (plain.length < MIN_LENGTH) return `Sifre en az ${MIN_LENGTH} karakter olmalidir.`;
  if (plain.length > MAX_LENGTH) return `Sifre en fazla ${MAX_LENGTH} karakter olabilir.`;
  return null;
}

async function hashPassword(plain) {
  const policyError = validatePasswordPolicy(plain);
  if (policyError) throw new Error(policyError);
  return argon2.hash(plain, HASH_OPTIONS);
}

async function verifyPassword(hash, plain) {
  if (typeof plain !== 'string' || plain.length > MAX_LENGTH) return false;
  try {
    return await argon2.verify(hash, plain);
  } catch {
    return false;
  }
}

// Kullanici bulunamadiginda da ayni sure harcanir; boylece cevap suresinden
// hangi e-postanin kayitli oldugu anlasilamaz (user enumeration).
let dummyHashPromise;
async function verifyDummyPassword(plain) {
  dummyHashPromise ??= argon2.hash('kale-dummy-password-for-timing', HASH_OPTIONS);
  await verifyPassword(await dummyHashPromise, typeof plain === 'string' ? plain : '');
  return false;
}

module.exports = {
  validatePasswordPolicy,
  hashPassword,
  verifyPassword,
  verifyDummyPassword
};
