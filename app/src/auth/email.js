// Login ve seed ayni kurali kullanir; boylece kayit ve giris birbirinden ayrismaz.
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_EMAIL_LENGTH = 255;

function normalizeEmail(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function isValidEmail(email) {
  return email.length > 0 && email.length <= MAX_EMAIL_LENGTH && EMAIL_REGEX.test(email);
}

// Log'larda kisisel veriyi azaltmak icin: ayse@kale.test -> a***@kale.test
function maskEmail(email) {
  const at = email.lastIndexOf('@');
  if (at < 1) return '***';
  return `${email[0]}***${email.slice(at)}`;
}

module.exports = { normalizeEmail, isValidEmail, maskEmail, MAX_EMAIL_LENGTH };
