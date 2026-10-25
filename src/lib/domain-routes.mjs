// These paths have real handlers in BACH; a manifest declaration alone cannot enable a link.
// /domains/<slug> has no workbench handler. /foerderplaner currently falls back to an unrelated page.
export const DOMAIN_WORKBENCH_ROUTES = Object.freeze(['/financial','/steuer','/gesundheit','/ati','/anonymizer']);
export function domainWorkbenchRoute(value) {
  return typeof value==='string'&&DOMAIN_WORKBENCH_ROUTES.includes(value)?value:null;
}
export function domainAnonymizationRoute(domainId) {
  return domainId==='foerderplaner'?'/inbox':null;
}
if(typeof window!=='undefined')window.BachDomainRoutes={domainWorkbenchRoute,domainAnonymizationRoute};
