export function initShortcutsLegend() {
  const overlay = document.getElementById("shortcuts-overlay")!;
  const openButton = document.getElementById("btn-shortcuts")!;
  const closeButton = document.getElementById("btn-close-shortcuts")!;

  const open = () => overlay.classList.remove("hidden");
  const close = () => overlay.classList.add("hidden");

  openButton.addEventListener("click", open);
  closeButton.addEventListener("click", close);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) close();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !overlay.classList.contains("hidden")) {
      close();
    }
  });
}
