export const AID_CODE_PLACEHOLDER = "[Code]";
export const PERSON_NAME_PLACEHOLDER = "[PersonName]";

export const MESSAGE_TEMPLATES = [
  {
    id: "food-name-code",
    title: "Greeting + food aid + code",
    titleAr: "تحية + حصة + كود",
    needsName: true,
    needsCode: true,
    body: `[Greeting] [PersonName]،
نود إعلامكم بأن حصص المساعدات الغذائية جاهزة للاستلام.
يرجى إبراز هذا الكود عند الاستلام: [Code]`,
  },
  {
    id: "food-code",
    title: "Food aid + code",
    titleAr: "حصص غذائية + كود",
    needsName: false,
    needsCode: true,
    body: `نود إعلامكم بأن حصص المساعدات الغذائية جاهزة للاستلام.
يرجى إبراز هذا الكود عند الاستلام: [Code]`,
  },
  {
    id: "pickup-code",
    title: "Pickup reminder + code",
    titleAr: "موعد الاستلام + كود",
    needsName: false,
    needsCode: true,
    body: `تذكير: يمكنكم استلام حصصكم في الموعد المحدد.
كود الاستلام الخاص بكم: [Code]
يرجى إحضاره معكم.`,
  },
  {
    id: "hygiene-code",
    title: "Aid kit + code",
    titleAr: "مساعدات + كود",
    needsName: false,
    needsCode: true,
    body: `أصبحت المساعدات جاهزة للاستلام.
لاستلام حصتك استخدم الكود التالي:
[Code]`,
  },
  {
    id: "code-only",
    title: "Code line",
    titleAr: "سطر الكود فقط",
    needsName: false,
    needsCode: true,
    body: `كود الاستلام: [Code]`,
  },
  {
    id: "hello-name",
    title: "Greeting + announcement",
    titleAr: "تحية بالاسم",
    needsName: true,
    needsCode: false,
    body: `مرحبا [PersonName]،
أهلاً بكم، نود إعلامكم ببدء توزيع الحصص. يرجى الحضور في الموعد المحدد.`,
  },
  {
    id: "announce",
    title: "Announcement",
    titleAr: "إعلان عام",
    needsName: false,
    needsCode: false,
    body: `أهلاً بكم، نود إعلامكم ببدء توزيع الحصص. يرجى الحضور في الموعد المحدد.`,
  },
];

export function isTemplateAvailable(template, columns = {}) {
  if (template?.needsCode && !columns.hasCodes) return false;
  if (template?.needsName && !columns.hasNames) return false;
  return true;
}

export function constrainMessageToColumns(text, columns = {}) {
  let next = String(text || "");
  if (!columns.hasCodes) {
    next = next.replace(/\[(?:Aid)?Code\]|\[كود\]/gi, "");
  }
  if (!columns.hasNames) {
    next = next.replace(/\[PersonName\]/gi, "");
  }
  return next;
}
