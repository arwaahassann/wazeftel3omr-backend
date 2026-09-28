const getRoleLabel = (role) => {
  if (role === 'employer') return 'صاحب شركة / ناشر وظائف';
  if (role === 'admin') return 'مشرف المنصة';
  return 'باحث عن عمل';
};

const normalizePhoneInput = (phone) => String(phone || '')
  .replace(/[٠-٩]/g, digit => String(digit.charCodeAt(0) - 0x0660))
  .replace(/[۰-۹]/g, digit => String(digit.charCodeAt(0) - 0x06f0))
  .trim();

const buildPhoneMatch = (phone) => {
  const digits = normalizePhoneInput(phone).replace(/\D/g, '');
  if (!digits) return null;

  const variants = new Set([digits]);
  // Match Egyptian mobile numbers whether stored locally or with the +20 country code.
  if (/^0\d{10}$/.test(digits)) {
    variants.add(`20${digits.slice(1)}`);
    variants.add(`0020${digits.slice(1)}`);
  } else if (/^20\d{10}$/.test(digits)) {
    variants.add(`0${digits.slice(2)}`);
    variants.add(`0020${digits.slice(2)}`);
  } else if (/^0020\d{10}$/.test(digits)) {
    variants.add(`0${digits.slice(4)}`);
    variants.add(`20${digits.slice(4)}`);
  }

  const patterns = Array.from(variants, (variant) => {
    const formattedDigits = variant.split('').join('[\\s().-]*');
    return `\\+?[\\s().-]*${formattedDigits}`;
  });
  return new RegExp(`^(?:${patterns.join('|')})$`);
};

module.exports = { getRoleLabel, buildPhoneMatch, normalizePhoneInput };
