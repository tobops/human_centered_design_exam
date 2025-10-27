// components/utils/flags.ts
export function flagFor(code: string) {
  const map: Record<string, string> = {
    en: "🇬🇧", es: "🇪🇸", pl: "🇵🇱", it: "🇮🇹", fr: "🇫🇷", de: "🇩🇪",
    uk: "🇺🇦", hi: "🇮🇳", ur: "🇵🇰", lt: "🇱🇹", zh: "🇨🇳", pt: "🇵🇹",
    ru: "🇷🇺", ar: "🇸🇦", ja: "🇯🇵", ko: "🇰🇷", tr: "🇹🇷", nl: "🇳🇱",
    sv: "🇸🇪", da: "🇩🇰", fi: "🇫🇮", el: "🇬🇷", th: "🇹🇭", vi: "🇻🇳",
  };
  return map[code] ?? "🏳️";
}
