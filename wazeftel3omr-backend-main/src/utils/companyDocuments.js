const MAX_COMPANY_DOCUMENT_BYTES = 3 * 1024 * 1024;
const ALLOWED_DOCUMENT_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png']);

const validateCompanyDocument = (payload = {}) => {
  const { dataUrl, fileName, mimeType } = payload || {};
  if (typeof dataUrl !== 'string' || typeof fileName !== 'string' || typeof mimeType !== 'string') {
    return { error: 'بيانات المستند غير مكتملة' };
  }
  if (dataUrl.length > Math.ceil(MAX_COMPANY_DOCUMENT_BYTES / 3) * 4 + 64) {
    return { error: 'حجم الملف يتجاوز الحد الأقصى 3 ميجابايت' };
  }

  const match = dataUrl.match(/^data:(application\/pdf|image\/jpeg|image\/png);base64,([A-Za-z0-9+/]+={0,2})$/);
  if (!match || match[1] !== mimeType || !ALLOWED_DOCUMENT_TYPES.has(mimeType)) {
    return { error: 'صيغة الملف غير مدعومة. ارفع PDF أو صورة JPG/PNG' };
  }

  const base64 = match[2];
  const buffer = Buffer.from(base64, 'base64');
  if (buffer.length === 0 || buffer.length > MAX_COMPANY_DOCUMENT_BYTES
    || buffer.toString('base64').replace(/=+$/, '') !== base64.replace(/=+$/, '')) {
    return { error: 'حجم الملف غير صالح أو يتجاوز الحد الأقصى 3 ميجابايت' };
  }

  const hasValidSignature = mimeType === 'application/pdf'
    ? buffer.subarray(0, 5).toString('ascii') === '%PDF-'
    : mimeType === 'image/png'
      ? buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      : buffer.subarray(0, 3).equals(Buffer.from([255, 216, 255]));

  if (!hasValidSignature) {
    return { error: 'محتوى الملف لا يطابق نوعه' };
  }

  const cleanFileName = fileName.trim().replace(/[\\/\u0000-\u001f\u007f]/g, '_').slice(0, 160);
  if (!cleanFileName) return { error: 'اسم الملف مطلوب' };

  return {
    document: {
      fileName: cleanFileName,
      mimeType,
      dataUrl,
      uploadedAt: new Date(),
    },
  };
};

const getCompanyDocumentMetadata = (document) => {
  if (!document?.fileName) return null;
  return {
    fileName: document.fileName,
    mimeType: document.mimeType,
    uploadedAt: document.uploadedAt,
  };
};

module.exports = {
  getCompanyDocumentMetadata,
  validateCompanyDocument,
};
