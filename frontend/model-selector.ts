import { escapeHtml } from "./renderer";
import type { AvailableModelSummary, ClientMessage } from "./protocol";

type SendFn = (msg: ClientMessage) => void;

interface ModelSelectorRefs {
  overlay: HTMLElement;
  openButton: HTMLButtonElement;
  closeButton: HTMLButtonElement;
  prevButton: HTMLButtonElement;
  nextButton: HTMLButtonElement;
  searchInput: HTMLInputElement;
  currentModelLabel: HTMLElement;
  list: HTMLElement;
  emptyState: HTMLElement;
}

let sendFn: SendFn = () => {};
let refs: ModelSelectorRefs | null = null;
let availableModels: AvailableModelSummary[] = [];
let currentModelKey = "";
let searchQuery = "";
let selectedIndex = 0;
let open = false;
let loading = false;

export function modelKey(model: Pick<AvailableModelSummary, "provider" | "id">): string {
  return `${model.provider}/${model.id}`;
}

export function sortAndFilterModels(
  models: AvailableModelSummary[],
  query: string,
  currentKey: string
): AvailableModelSummary[] {
  const tokens = query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);

  const filtered = models.filter((model) => {
    if (!tokens.length) return true;
    const haystack = [model.provider, model.id, model.name, modelKey(model)]
      .join(" ")
      .toLowerCase();
    return tokens.every((token) => haystack.includes(token));
  });

  return filtered.sort((a, b) => {
    const aCurrent = modelKey(a) === currentKey;
    const bCurrent = modelKey(b) === currentKey;
    if (aCurrent !== bCurrent) return aCurrent ? -1 : 1;
    return modelKey(a).localeCompare(modelKey(b));
  });
}

export function initModelSelector(send: SendFn) {
  sendFn = send;

  refs = {
    overlay: document.getElementById("model-selector-overlay")!,
    openButton: document.getElementById("btn-models") as HTMLButtonElement,
    closeButton: document.getElementById("btn-close-model-selector") as HTMLButtonElement,
    prevButton: document.getElementById("btn-cycle-model-prev") as HTMLButtonElement,
    nextButton: document.getElementById("btn-cycle-model-next") as HTMLButtonElement,
    searchInput: document.getElementById("model-selector-search") as HTMLInputElement,
    currentModelLabel: document.getElementById("model-selector-current")!,
    list: document.getElementById("model-selector-list")!,
    emptyState: document.getElementById("model-selector-empty")!,
  };

  refs.openButton.addEventListener("click", openModelSelector);
  refs.closeButton.addEventListener("click", closeModelSelector);
  refs.overlay.addEventListener("click", (e) => {
    if (e.target === refs?.overlay) closeModelSelector();
  });
  refs.prevButton.addEventListener("click", () => sendFn({ type: "cycle_model", direction: "backward" }));
  refs.nextButton.addEventListener("click", () => sendFn({ type: "cycle_model", direction: "forward" }));
  refs.searchInput.addEventListener("input", () => {
    searchQuery = refs?.searchInput.value ?? "";
    selectedIndex = 0;
    render();
  });
  refs.searchInput.addEventListener("keydown", (e) => {
    if (!refs) return;
    if (e.key === "Escape") {
      e.preventDefault();
      closeModelSelector();
      return;
    }
    const filtered = getVisibleModels();
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (filtered.length) {
        selectedIndex = (selectedIndex + 1) % filtered.length;
        render();
      }
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (filtered.length) {
        selectedIndex = (selectedIndex - 1 + filtered.length) % filtered.length;
        render();
      }
    } else if (e.key === "Enter") {
      e.preventDefault();
      selectVisibleModel(selectedIndex);
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && open) {
      closeModelSelector();
    }
  });

  render();
}

export function openModelSelector() {
  if (!refs) return;
  open = true;
  loading = true;
  refs.overlay.classList.remove("hidden");
  refs.searchInput.value = searchQuery;
  refs.searchInput.focus();
  refs.searchInput.select();
  sendFn({ type: "get_available_models" });
  syncSelectionToCurrent();
  render();
}

export function closeModelSelector() {
  if (!refs) return;
  open = false;
  refs.overlay.classList.add("hidden");
}

export function handleAvailableModels(models: AvailableModelSummary[]) {
  availableModels = models;
  loading = false;
  syncSelectionToCurrent();
  render();
}

export function handleCurrentModel(model: string | null) {
  currentModelKey = model ?? "";
  syncSelectionToCurrent();
  render();
}

export function setSearchQuery(query: string) {
  searchQuery = query;
  selectedIndex = 0;
  render();
}

function syncSelectionToCurrent() {
  const filtered = getVisibleModels();
  if (!filtered.length) {
    selectedIndex = 0;
    return;
  }
  const currentIndex = currentModelKey
    ? filtered.findIndex((model) => modelKey(model) === currentModelKey)
    : -1;
  selectedIndex = currentIndex >= 0 ? currentIndex : Math.min(selectedIndex, filtered.length - 1);
}

function getVisibleModels() {
  return sortAndFilterModels(availableModels, searchQuery, currentModelKey);
}

function selectVisibleModel(index: number) {
  const model = getVisibleModels()[index];
  if (!model) return;
  sendFn({ type: "set_model", provider: model.provider, modelId: model.id });
  closeModelSelector();
}

function render() {
  if (!refs) return;

  const models = getVisibleModels();
  refs.currentModelLabel.textContent = currentModelKey || "none";

  if (!models.length) {
    refs.list.innerHTML = "";
    if (loading) {
      refs.emptyState.textContent = "Loading available models…";
    } else if (availableModels.length === 0) {
      refs.emptyState.textContent = "No available models. Connect a provider first.";
    } else {
      refs.emptyState.textContent = "No matching models.";
    }
    refs.emptyState.classList.remove("hidden");
    refs.prevButton.disabled = loading || availableModels.length <= 1;
    refs.nextButton.disabled = loading || availableModels.length <= 1;
    return;
  }

  refs.emptyState.classList.add("hidden");
  refs.prevButton.disabled = models.length <= 1;
  refs.nextButton.disabled = models.length <= 1;

  selectedIndex = Math.max(0, Math.min(selectedIndex, models.length - 1));
  refs.list.innerHTML = models
    .map((model, index) => {
      const isCurrent = modelKey(model) === currentModelKey;
      const isSelected = index === selectedIndex;
      return `
        <button type="button" class="model-row ${isSelected ? "selected" : ""} ${isCurrent ? "current" : ""}" data-provider="${escapeHtml(model.provider)}" data-model-id="${escapeHtml(model.id)}">
          <div class="model-row-top">
            <span class="model-provider">${escapeHtml(model.provider)}</span>
            <span class="model-id">${escapeHtml(model.id)}</span>
            ${isCurrent ? '<span class="model-current-badge">Current</span>' : ""}
          </div>
          <div class="model-row-name">${escapeHtml(model.name)}</div>
        </button>
      `;
    })
    .join("");

  const buttonEls = Array.from(refs.list.querySelectorAll<HTMLButtonElement>("button[data-provider]"));
  buttonEls.forEach((button, index) => {
    button.addEventListener("click", () => selectVisibleModel(index));
  });

  const selectedButton = buttonEls[selectedIndex];
  selectedButton?.scrollIntoView({ block: "nearest" });
}
