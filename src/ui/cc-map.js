export function buildCcMapTable(ccMap, targetLabels) {
  const body = document.getElementById("cc-map-body");
  if (!body) return;

  const rows = Object.entries(ccMap)
    .map(([cc, config]) => ({ cc: Number(cc), ...config }))
    .sort((a, b) => a.cc - b.cc);

  body.innerHTML = "";
  rows.forEach((row) => {
    const tr = document.createElement("tr");
    const ccCell = document.createElement("td");
    const nameCell = document.createElement("td");
    const targetCell = document.createElement("td");
    ccCell.textContent = String(row.cc);
    nameCell.textContent = row.name;
    targetCell.textContent = targetLabels[row.target] || row.target;
    tr.appendChild(ccCell);
    tr.appendChild(nameCell);
    tr.appendChild(targetCell);
    body.appendChild(tr);
  });
}

export function bindCcDialog() {
  const dialog = document.getElementById("cc-map-dialog");
  const openBtn = document.getElementById("open-cc-map");
  const closeBtn = document.getElementById("close-cc-map");
  openBtn.addEventListener("click", () => dialog.setAttribute("aria-hidden", "false"));
  closeBtn.addEventListener("click", () => dialog.setAttribute("aria-hidden", "true"));
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.setAttribute("aria-hidden", "true");
  });
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && dialog.getAttribute("aria-hidden") === "false") {
      dialog.setAttribute("aria-hidden", "true");
    }
  });
}
