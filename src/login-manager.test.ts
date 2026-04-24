import { describe, it, expect, vi } from "vitest";
import { LoginManager } from "./login-manager";
import type { AuthStorage } from "@mariozechner/pi-coding-agent";

function makeAuthStorage(overrides: Partial<Record<keyof AuthStorage, unknown>> = {}) {
  return {
    getOAuthProviders: vi.fn().mockReturnValue([]),
    getAuthStatus: vi.fn().mockReturnValue({ configured: false }),
    login: vi.fn(),
    logout: vi.fn(),
    ...overrides,
  } as unknown as AuthStorage;
}

// ---------------------------------------------------------------------------
// getProviders
// ---------------------------------------------------------------------------

describe("LoginManager.getProviders", () => {
  it("returns an empty array when there are no OAuth providers", () => {
    const manager = new LoginManager(makeAuthStorage());
    expect(manager.getProviders()).toEqual([]);
  });

  it("maps provider fields correctly", () => {
    const auth = makeAuthStorage({
      getOAuthProviders: vi.fn().mockReturnValue([
        { id: "github", name: "GitHub Copilot", usesCallbackServer: false },
      ]),
      getAuthStatus: vi.fn().mockReturnValue({ configured: true, label: "Authenticated" }),
    });
    const manager = new LoginManager(auth);
    const providers = manager.getProviders();

    expect(providers).toHaveLength(1);
    expect(providers[0]).toMatchObject({
      id: "github",
      name: "GitHub Copilot",
      isOAuth: true,
      usesCallbackServer: false,
      auth: { configured: true, label: "Authenticated" },
    });
  });

  it("defaults usesCallbackServer to false when absent from the provider", () => {
    const auth = makeAuthStorage({
      getOAuthProviders: vi.fn().mockReturnValue([
        { id: "x", name: "X", /* usesCallbackServer intentionally absent */ },
      ]),
    });
    const [provider] = new LoginManager(auth).getProviders();
    expect(provider.usesCallbackServer).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// abortLogin
// ---------------------------------------------------------------------------

describe("LoginManager.abortLogin", () => {
  it("does not throw when no login is in progress", () => {
    const manager = new LoginManager(makeAuthStorage());
    expect(() => manager.abortLogin()).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// respondToPrompt
// ---------------------------------------------------------------------------

describe("LoginManager.respondToPrompt", () => {
  it("calls the resolve function for a known promptId", () => {
    const manager = new LoginManager(makeAuthStorage());
    const resolve = vi.fn();
    // Inject directly into the private map
    (manager as any).pendingPrompts.set("p-1", resolve);

    manager.respondToPrompt("p-1", "secret-code");

    expect(resolve).toHaveBeenCalledOnce();
    expect(resolve).toHaveBeenCalledWith("secret-code");
  });

  it("removes the entry from the map after resolving", () => {
    const manager = new LoginManager(makeAuthStorage());
    (manager as any).pendingPrompts.set("p-2", vi.fn());

    manager.respondToPrompt("p-2", "value");

    expect((manager as any).pendingPrompts.has("p-2")).toBe(false);
  });

  it("does not throw for an unknown promptId", () => {
    const manager = new LoginManager(makeAuthStorage());
    expect(() => manager.respondToPrompt("unknown", "value")).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// logout
// ---------------------------------------------------------------------------

describe("LoginManager.logout", () => {
  it("delegates to authStorage.logout", () => {
    const auth = makeAuthStorage();
    const manager = new LoginManager(auth);
    manager.logout("github");
    expect(auth.logout).toHaveBeenCalledWith("github");
  });
});
