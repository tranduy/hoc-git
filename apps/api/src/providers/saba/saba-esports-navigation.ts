export function exactSabaLolUrl(value: string): string {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error("SABA_ESPORTS_URL_INVALID"); }
  if (url.protocol !== "https:" || url.hostname !== "esports.estorb.com" || url.username || url.password ||
    !/\/ESports\/43\/(?:ALL|LOL)$/u.test(url.pathname)) throw new Error("SABA_ESPORTS_URL_INVALID");
  url.pathname = url.pathname.replace(/\/(?:ALL|LOL)$/u, "/LOL");
  url.search = "";
  url.hash = "";
  return url.toString();
}

