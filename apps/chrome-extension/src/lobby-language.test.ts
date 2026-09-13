import { describe, expect, it } from "vitest";
import { lobbyLanguageUrl } from "./lobby-language.js";

describe("lobbyLanguageUrl", () => {
  it("rewrites only the parameter that names the language, never the token", () => {
    const saba = lobbyLanguageUrl("SABA",
      "https://c0z0oa.bpd3a3fn.com/(S(abc123))/NewIndex?lang=vn&webskintype=3&scmt=tab02", "en");
    // The session segment is what a book dies of when it is re-requested, so it
    // has to come through untouched.
    expect(saba).toBe("https://c0z0oa.bpd3a3fn.com/(S(abc123))/NewIndex?lang=en&webskintype=3&scmt=tab02");

    expect(lobbyLanguageUrl("TSPORT", "https://pacific.agenate.com/?agentId=4&token=T9&lng=vi&t=1", "en"))
      .toBe("https://pacific.agenate.com/?agentId=4&token=T9&lng=en&t=1");
    expect(lobbyLanguageUrl("IM", "https://imsports.directsb.net/?languageCode=vi&token=T9", "en"))
      .toBe("https://imsports.directsb.net/?languageCode=en&token=T9");
  });

  it("moves BTI's language and the day segment together, because both are named in it", () => {
    expect(lobbyLanguageUrl("BTI",
      "https://prod20091.fxf774.com/vi/asian-view/today/B%C3%B3ng-%C4%91%C3%A1?operatorToken=T9", "en"))
      .toBe("https://prod20091.fxf774.com/en/asian-view/today/Football?operatorToken=T9");
    expect(lobbyLanguageUrl("BTI",
      "https://prod20091.fxf774.com/en/asian-view/today/Football?operatorToken=T9", "vi"))
      .toBe("https://prod20091.fxf774.com/vi/asian-view/today/B%C3%B3ng-%C4%91%C3%A1?operatorToken=T9");
  });

  it("returns nothing when the page already reads that language", () => {
    // Navigating a page for no reason costs a subscription and buys nothing.
    expect(lobbyLanguageUrl("SABA", "https://c0z0oa.bpd3a3fn.com/(S(a))/NewIndex?lang=en", "en")).toBeNull();
    expect(lobbyLanguageUrl("TSPORT", "https://pacific.agenate.com/?lng=vi", "vi")).toBeNull();
    expect(lobbyLanguageUrl("BTI", "https://prod20091.fxf774.com/en/asian-view/today/Football", "en")).toBeNull();
  });

  it("refuses a URL it cannot place", () => {
    expect(lobbyLanguageUrl("SABA", "http://c0z0oa.bpd3a3fn.com/(S(a))/NewIndex?lang=vn", "en")).toBeNull();
    expect(lobbyLanguageUrl("SABA", "not-a-url", "en")).toBeNull();
    // No language parameter to move means this is not the page we think it is.
    expect(lobbyLanguageUrl("TSPORT", "https://pacific.agenate.com/?agentId=4", "en")).toBeNull();
    expect(lobbyLanguageUrl("BTI", "https://prod20091.fxf774.com/asian-view/today", "en")).toBeNull();
  });
});
