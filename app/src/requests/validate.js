// Talep formu icin temel kontrol: zorunlu alanlar ve veritabani sutun sinirlari.
// Telefon formati, talep tipi listesi gibi kurallar Faz 1'de eklenecek.
const FIELDS = {
  full_name: { required: true, max: 255 },
  phone: { required: true, max: 50 },
  request_type: { required: true, max: 100 },
  description: { required: false, max: 5000 }
};

// Gecerliyse { value }, degilse { invalidFields } doner.
function validateServiceRequest(body) {
  const input = body && typeof body === 'object' ? body : {};
  const value = {};
  const invalidFields = [];

  for (const [name, rule] of Object.entries(FIELDS)) {
    const raw = input[name];

    if (raw === undefined || raw === null || raw === '') {
      if (rule.required) invalidFields.push(name);
      else value[name] = null;
      continue;
    }

    if (typeof raw !== 'string') {
      invalidFields.push(name);
      continue;
    }

    const trimmed = raw.trim();
    if ((rule.required && trimmed === '') || trimmed.length > rule.max) {
      invalidFields.push(name);
      continue;
    }
    value[name] = trimmed === '' ? null : trimmed;
  }

  return invalidFields.length ? { invalidFields } : { value };
}

module.exports = { validateServiceRequest };
