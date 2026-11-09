// Pure decision logic for BackButton.astro (PB-23 / G4)

function parseUrlSafe(value, base) {
  if (!value || typeof value !== "string") return null;
  try {
    return base ? new URL(value, base) : new URL(value);
  } catch {
    return null;
  }
}

function isCompanionActive(companion, currentUrl) {
  if (companion === true || companion === 1 || companion === "1") return true;
  if (companion === false || companion === 0 || companion === "0") return false;
  if (currentUrl) {
    return currentUrl.searchParams.get("companion") === "1";
  }
  return false;
}

/**
 * Decides the back-navigation action and button label for Sensation and Talk pages.
 *
 * @param {object} [input]
 * @param {string} [input.referrer] - document.referrer
 * @param {string} [input.href] - location.href
 * @param {boolean|string|number} [input.companion] - explicit companion flag or read from href ?companion=1
 * @returns {{ mode: "back" | "fallback" | "close", label: string }}
 */
export function decideBackAction({ referrer = "", href = "", companion } = {}) {
  const currentUrl = parseUrlSafe(href);

  if (isCompanionActive(companion, currentUrl)) {
    return { mode: "close", label: "Fenster schließen" };
  }

  const refUrl = parseUrlSafe(referrer);
  if (currentUrl && refUrl && currentUrl.origin === refUrl.origin && currentUrl.origin !== "null") {
    const samePage =
      currentUrl.pathname === refUrl.pathname &&
      currentUrl.search === refUrl.search;
    if (!samePage) {
      return { mode: "back", label: "Zurück" };
    }
  }

  return { mode: "fallback", label: "Zur Startseite" };
}
