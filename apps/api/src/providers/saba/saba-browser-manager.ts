import { PlaywrightCmdBrowserManager } from "../cmd/cmd-browser-manager.js";

/**
 * The observed SABA white-label runtime uses the structural extractor that
 * predates provider identity correction. Keep the browser lifecycle shared
 * while exposing the verified provider boundary explicitly.
 */
export class PlaywrightSabaBrowserManager extends PlaywrightCmdBrowserManager {}
