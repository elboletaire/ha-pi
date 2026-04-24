import { describe, it, expect, vi, afterEach } from "vitest";
import { parseServerArgs, setLogLevel, log } from "./options";

// ---------------------------------------------------------------------------
// parseServerArgs
// ---------------------------------------------------------------------------

describe("parseServerArgs", () => {
  const originalArgv = process.argv;

  afterEach(() => {
    process.argv = originalArgv;
  });

  it("returns defaults when no flags are provided", () => {
    process.argv = ["node", "server.js"];
    const opts = parseServerArgs();
    expect(opts.provider).toBe("anthropic");
    expect(opts.model).toBe("claude-sonnet-4-5-20250929");
    expect(opts.logLevel).toBe("info");
  });

  it("parses --provider", () => {
    process.argv = ["node", "server.js", "--provider", "openai"];
    expect(parseServerArgs().provider).toBe("openai");
  });

  it("parses --model", () => {
    process.argv = ["node", "server.js", "--model", "gpt-4o"];
    expect(parseServerArgs().model).toBe("gpt-4o");
  });

  it("parses --log-level", () => {
    process.argv = ["node", "server.js", "--log-level", "debug"];
    expect(parseServerArgs().logLevel).toBe("debug");
  });

  it("falls back to 'info' for an unrecognised log level", () => {
    process.argv = ["node", "server.js", "--log-level", "verbose"];
    expect(parseServerArgs().logLevel).toBe("info");
  });

  it("parses multiple flags together", () => {
    process.argv = ["node", "server.js", "--provider", "google", "--model", "gemini-2.0", "--log-level", "warn"];
    const opts = parseServerArgs();
    expect(opts.provider).toBe("google");
    expect(opts.model).toBe("gemini-2.0");
    expect(opts.logLevel).toBe("warn");
  });
});

// ---------------------------------------------------------------------------
// log + setLogLevel
// ---------------------------------------------------------------------------

describe("log", () => {
  afterEach(() => {
    setLogLevel("info"); // restore default between tests
    vi.restoreAllMocks();
  });

  it("suppresses debug messages at info level", () => {
    const spy = vi.spyOn(console, "debug").mockImplementation(() => {});
    setLogLevel("info");
    log.debug("msg");
    expect(spy).not.toHaveBeenCalled();
  });

  it("emits info messages at info level", () => {
    const spy = vi.spyOn(console, "info").mockImplementation(() => {});
    setLogLevel("info");
    log.info("msg");
    expect(spy).toHaveBeenCalled();
  });

  it("suppresses info messages at warn level", () => {
    const spy = vi.spyOn(console, "info").mockImplementation(() => {});
    setLogLevel("warn");
    log.info("msg");
    expect(spy).not.toHaveBeenCalled();
  });

  it("emits warn messages at warn level", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    setLogLevel("warn");
    log.warn("msg");
    expect(spy).toHaveBeenCalled();
  });

  it("emits all levels at debug level", () => {
    const spyDebug = vi.spyOn(console, "debug").mockImplementation(() => {});
    const spyInfo  = vi.spyOn(console, "info").mockImplementation(() => {});
    const spyWarn  = vi.spyOn(console, "warn").mockImplementation(() => {});
    const spyError = vi.spyOn(console, "error").mockImplementation(() => {});
    setLogLevel("debug");
    log.debug("d"); log.info("i"); log.warn("w"); log.error("e");
    expect(spyDebug).toHaveBeenCalledOnce();
    expect(spyInfo).toHaveBeenCalledOnce();
    expect(spyWarn).toHaveBeenCalledOnce();
    expect(spyError).toHaveBeenCalledOnce();
  });

  it("suppresses everything below error at error level", () => {
    const spyDebug = vi.spyOn(console, "debug").mockImplementation(() => {});
    const spyInfo  = vi.spyOn(console, "info").mockImplementation(() => {});
    const spyWarn  = vi.spyOn(console, "warn").mockImplementation(() => {});
    setLogLevel("error");
    log.debug("d"); log.info("i"); log.warn("w");
    expect(spyDebug).not.toHaveBeenCalled();
    expect(spyInfo).not.toHaveBeenCalled();
    expect(spyWarn).not.toHaveBeenCalled();
  });
});
