// SPDX-License-Identifier: MIT
// World Language Pack runtime store & DOM translator for ellmos-system-gui
import worldPack from "../i18n/world.json";

const STORAGE_KEY = "bach-lang";
const VALID_CODES = new Set(worldPack.supported_locales.map((l) => l.code));

export function normalizeLocale(code) {
  if (!code || typeof code !== "string") return worldPack.default_locale;
  const short = code.trim().toLowerCase().split(/[-_]/)[0];
  return VALID_CODES.has(short) ? short : worldPack.default_locale;
}

export function getActiveLocale() {
  if (typeof window === "undefined") return worldPack.default_locale;
  return normalizeLocale(
    localStorage.getItem(STORAGE_KEY) ||
      document.documentElement.getAttribute("lang") ||
      navigator.language
  );
}

export function translate(key, locale = getActiveLocale(), fallback = "") {
  const loc = normalizeLocale(locale);
  const dict = worldPack.translations[loc] || {};
  const deDict = worldPack.translations.de || {};
  const enDict = worldPack.translations.en || {};
  return dict[key] || enDict[key] || deDict[key] || fallback || key;
}

export function applyLocaleToDocument(code, persist = true) {
  if (typeof document === "undefined") return worldPack.default_locale;
  const locale = normalizeLocale(code);
  document.documentElement.setAttribute("lang", locale);
  document.documentElement.setAttribute("dir", locale === "ar" ? "rtl" : "ltr");
  if (persist && typeof localStorage !== "undefined") {
    localStorage.setItem(STORAGE_KEY, locale);
  }

  const switcher = document.getElementById("lang-switcher");
  if (switcher && switcher.value !== locale) {
    switcher.value = locale;
  }

  // Translate sidebar navigation items by data-nav-id
  document.querySelectorAll("[data-nav-id]").forEach((link) => {
    const navId = link.getAttribute("data-nav-id");
    const labelEl = link.querySelector(".nav-label");
    if (!navId || !labelEl) return;
    if (!labelEl.dataset.originalLabel) {
      labelEl.dataset.originalLabel = labelEl.textContent || "";
    }
    const key = `nav.${navId}`;
    const dict = worldPack.translations[locale] || {};
    if (locale === "de") {
      labelEl.textContent = labelEl.dataset.originalLabel;
    } else if (dict[key] || worldPack.translations.en?.[key]) {
      labelEl.textContent = dict[key] || worldPack.translations.en[key];
    }
  });

  // Translate elements with explicit data-i18n attributes
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    const key = el.getAttribute("data-i18n");
    if (!key) return;
    if (!el.dataset.originalText) {
      el.dataset.originalText = el.textContent || "";
    }
    if (locale === "de" && !worldPack.translations.de?.[key]) {
      el.textContent = el.dataset.originalText;
    } else {
      el.textContent = translate(key, locale, el.dataset.originalText);
    }
  });

  window.dispatchEvent(new CustomEvent("bach-locale-change", { detail: { locale } }));
  return locale;
}

export function initializeWorldI18n() {
  if (typeof window === "undefined") return;
  const initial = getActiveLocale();
  applyLocaleToDocument(initial, false);

  const switcher = document.getElementById("lang-switcher");
  if (switcher) {
    switcher.value = initial;
    switcher.addEventListener("change", (ev) => {
      applyLocaleToDocument(ev.target.value, true);
    });
  }

  window.bachI18n = {
    getLocale: getActiveLocale,
    setLocale: (code, persist = true) => applyLocaleToDocument(code, persist),
    t: translate,
    supportedLocales: worldPack.supported_locales,
  };
}
