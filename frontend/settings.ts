/**
 * Settings panel: provider auth status, OAuth login flows, and API keys.
 */
import { escapeHtml } from "./renderer";
import type { ClientMessage, LoginEvent, ProviderStatus } from "./protocol";

type SendFn = (msg: ClientMessage) => void;

// ---------------------------------------------------------------------------
// DOM refs
// ---------------------------------------------------------------------------
const $settingsOverlay  = document.getElementById("settings-overlay")!;
const $providersList    = document.getElementById("providers-list")!;
const $btnSettings      = document.getElementById("btn-settings")!;
const $btnCloseSettings = document.getElementById("btn-close-settings")!;
const $loginModal       = document.getElementById("login-modal")!;
const $loginModalTitle  = document.getElementById("login-modal-title")!;
const $loginModalBody   = document.getElementById("login-modal-body")!;
const $btnCancelLogin   = document.getElementById("btn-cancel-login")!;

let sendFn: SendFn = () => {};
let providers: ProviderStatus[] = [];

// ---------------------------------------------------------------------------
// Public API (called from app.ts)
// ---------------------------------------------------------------------------

export function initSettings(send: SendFn) {
  sendFn = send;

  $btnSettings.addEventListener("click", () => {
    send({ type: "get_auth_status" });
    $settingsOverlay.classList.remove("hidden");
  });
  $btnCloseSettings.addEventListener("click", closeSettings);
  $settingsOverlay.addEventListener("click", (e) => {
    if (e.target === $settingsOverlay) closeSettings();
  });

  $btnCancelLogin.addEventListener("click", () => {
    send({ type: "login_abort" });
    closeLoginModal();
  });
}

export function handleAuthStatus(newProviders: ProviderStatus[]) {
  providers = newProviders;
  renderProviders();
  updateHeaderStatus();
}

export function handleLoginEvent(event: LoginEvent) {
  const provider = providers.find((p) => p.id === event.provider);
  const name = provider?.name ?? String(event.provider);

  switch (event.type) {
    case "login_device_flow":
      renderDeviceFlow(name, event.url, event.code);
      break;

    case "login_open_url":
      renderOpenUrl(name, event.url);
      break;

    case "login_progress":
      updateProgress(event.message);
      break;

    case "login_prompt":
      renderPrompt(
        event.promptId,
        event.message,
        event.placeholder
      );
      break;

    case "login_complete":
      renderSuccess(name);
      setTimeout(closeLoginModal, 1800);
      break;

    case "login_error":
      renderLoginError(event.message);
      break;
  }
}

// ---------------------------------------------------------------------------
// Provider list rendering
// ---------------------------------------------------------------------------

function renderProviders() {
  $providersList.innerHTML = "";
  if (!providers.length) {
    $providersList.innerHTML = `<div style="padding:16px;color:var(--text-dim)">No providers found.</div>`;
    return;
  }

  const oauthProviders = providers.filter((p) => p.isOAuth);
  const apiProviders = providers.filter((p) => !p.isOAuth);

  if (oauthProviders.length) {
    $providersList.appendChild(renderProviderSection("OAuth providers", oauthProviders, renderOAuthProviderRow));
  }

  if (apiProviders.length) {
    $providersList.appendChild(renderProviderSection("API key providers", apiProviders, renderApiKeyProviderRow));
  }
}

function renderProviderSection(
  title: string,
  providerList: ProviderStatus[],
  renderRow: (provider: ProviderStatus) => HTMLElement
): HTMLElement {
  const section = document.createElement("section");
  section.className = "provider-section";

  const heading = document.createElement("h3");
  heading.className = "provider-section-title";
  heading.textContent = title;
  section.appendChild(heading);

  for (const provider of providerList) {
    section.appendChild(renderRow(provider));
  }

  return section;
}

function renderOAuthProviderRow(provider: ProviderStatus): HTMLElement {
  const connected = provider.auth.configured;
  const row = document.createElement("div");
  row.className = "provider-row";
  row.innerHTML = `
    <div class="provider-info">
      <div class="provider-name">${escapeHtml(provider.name)}</div>
      <div class="provider-status">
        <span class="status-dot ${connected ? "connected" : "disconnected"}"></span>
        <span>${escapeHtml(getAuthStatusLabel(provider.auth))}</span>
      </div>
    </div>
    <button class="provider-btn ${connected ? "disconnect" : "connect"}"
            data-id="${escapeHtml(provider.id)}"
            data-action="${connected ? "logout" : "login"}">
      ${connected ? "Disconnect" : "Connect"}
    </button>
  `;
  row.querySelector("button")!.addEventListener("click", (e) => {
    const btn = e.currentTarget as HTMLButtonElement;
    if (btn.dataset.action === "login") {
      startLoginFlow(provider);
    } else {
      sendFn({ type: "logout", provider: btn.dataset.id! });
    }
  });
  return row;
}

function renderApiKeyProviderRow(provider: ProviderStatus): HTMLElement {
  const row = document.createElement("div");
  row.className = "provider-row provider-row-api";

  const info = document.createElement("div");
  info.className = "provider-info";
  info.innerHTML = `
    <div class="provider-name">${escapeHtml(provider.name)}</div>
    <div class="provider-status">
      <span class="status-dot ${provider.auth.configured ? "connected" : "disconnected"}"></span>
      <span>${escapeHtml(getAuthStatusLabel(provider.auth))}</span>
    </div>
  `;

  const form = document.createElement("form");
  form.className = "provider-api-form";

  const input = document.createElement("input");
  input.type = "password";
  input.autocomplete = "off";
  input.spellcheck = false;
  input.placeholder = `Enter ${provider.name} API key`;
  input.setAttribute("aria-label", `${provider.name} API key`);

  const buttons = document.createElement("div");
  buttons.className = "provider-api-actions";

  const saveBtn = document.createElement("button");
  saveBtn.type = "submit";
  saveBtn.className = "provider-btn connect";
  saveBtn.textContent = "Save";

  const clearBtn = document.createElement("button");
  clearBtn.type = "button";
  clearBtn.className = "provider-btn disconnect";
  clearBtn.textContent = "Clear";
  clearBtn.disabled = !provider.auth.configured;

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const key = input.value.trim();
    if (!key) return;
    sendFn({ type: "set_api_key", provider: provider.id, key });
    input.value = "";
  });

  clearBtn.addEventListener("click", () => {
    sendFn({ type: "clear_api_key", provider: provider.id });
    input.value = "";
  });

  buttons.appendChild(saveBtn);
  buttons.appendChild(clearBtn);
  form.appendChild(input);
  form.appendChild(buttons);
  row.appendChild(info);
  row.appendChild(form);

  return row;
}

function getAuthStatusLabel(auth: ProviderStatus["auth"]): string {
  if (!auth.configured) return "Not configured";
  if (auth.label) return auth.label;
  switch (auth.source) {
    case "stored":
      return "Saved in auth.json";
    case "environment":
      return "Configured via environment";
    case "runtime":
      return "Runtime API key";
    case "fallback":
      return "Custom provider key";
    default:
      return "Configured";
  }
}

function updateHeaderStatus() {
  const connected = providers.filter((p) => p.auth.configured);
  const badge = document.getElementById("model-badge")!;
  // Append connected provider count hint if any
  const existing = badge.dataset.model ?? badge.textContent ?? "";
  if (connected.length) {
    badge.title = "Connected: " + connected.map((p) => p.name).join(", ");
  }
}

// ---------------------------------------------------------------------------
// Login modal helpers
// ---------------------------------------------------------------------------

function startLoginFlow(provider: ProviderStatus) {
  $loginModalTitle.textContent = `Connecting to ${provider.name}…`;
  $loginModalBody.innerHTML = `<div class="login-progress">Starting authorization flow…</div>`;
  $loginModal.classList.remove("hidden");
  sendFn({ type: "login_start", provider: provider.id });
}

function renderDeviceFlow(name: string, url: string, code: string) {
  $loginModalTitle.textContent = `Connect ${name}`;
  $loginModalBody.innerHTML = `
    <div class="login-step">
      Visit the link below and enter this code to authorize:
    </div>
    <div class="device-code" id="device-code-display">${escapeHtml(code)}</div>
    <div class="login-actions">
      <a class="btn-open-url" href="${escapeHtml(url)}" target="_blank" rel="noopener">
        Open ${escapeHtml(new URL(url).hostname)} →
      </a>
      <button class="btn-copy-code" id="btn-copy-code">Copy code</button>
    </div>
    <div class="login-progress" id="login-progress">Waiting for authorization…</div>
  `;
  document.getElementById("btn-copy-code")!.addEventListener("click", () => {
    navigator.clipboard.writeText(code).then(() => {
      const btn = document.getElementById("btn-copy-code")!;
      btn.textContent = "Copied ✓";
      btn.classList.add("copied");
    });
  });
}

function renderOpenUrl(name: string, url: string) {
  $loginModalTitle.textContent = `Connect ${name}`;
  $loginModalBody.innerHTML = `
    <div class="login-step">
      Click the button below to open the authorization page in your browser.
      After authorizing, return here — the connection will complete automatically.
    </div>
    <div class="login-actions">
      <a class="btn-open-url" href="${escapeHtml(url)}" target="_blank" rel="noopener">
        Authorize ${escapeHtml(name)} →
      </a>
    </div>
    <div class="login-progress" id="login-progress">Waiting for authorization…</div>
  `;
}

function updateProgress(message: string) {
  const el = document.getElementById("login-progress");
  if (el) el.textContent = message;
}

function renderPrompt(promptId: string, message: string, placeholder?: string) {
  const existing = document.getElementById("login-prompt-form");
  if (existing) existing.remove();

  const form = document.createElement("div");
  form.className = "login-prompt-form";
  form.id = "login-prompt-form";
  form.innerHTML = `
    <input type="text" placeholder="${placeholder ? escapeHtml(placeholder) : ""}"
           aria-label="${escapeHtml(message)}" id="login-prompt-input" />
    <button type="button">Submit</button>
  `;

  const label = document.createElement("div");
  label.className = "login-step";
  label.style.marginTop = "12px";
  label.textContent = message;
  $loginModalBody.appendChild(label);
  $loginModalBody.appendChild(form);

  const input = form.querySelector("input")!;
  const submitBtn = form.querySelector("button")!;
  input.focus();

  const submit = () => {
    const value = input.value.trim();
    if (!value) return;
    form.remove();
    label.remove();
    sendFn({ type: "login_prompt_response", promptId, value });
  };
  submitBtn.addEventListener("click", submit);
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") submit(); });
}

function renderSuccess(name: string) {
  $loginModalTitle.textContent = `Connected`;
  $loginModalBody.innerHTML = `
    <div class="login-success">✓ Connected to ${escapeHtml(name)}</div>
  `;
}

function renderLoginError(message: string) {
  const progress = document.getElementById("login-progress");
  if (progress) {
    progress.style.color = "var(--danger)";
    progress.textContent = `Error: ${message}`;
  } else {
    $loginModalBody.innerHTML += `
      <div class="login-progress" style="color:var(--danger)">Error: ${escapeHtml(message)}</div>
    `;
  }
}

function closeSettings() {
  $settingsOverlay.classList.add("hidden");
}

function closeLoginModal() {
  $loginModal.classList.add("hidden");
  renderProviders(); // refresh the list
}
