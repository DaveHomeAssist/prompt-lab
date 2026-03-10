const keyInput = document.getElementById("key");
const saveBtn = document.getElementById("saveBtn");
const status = document.getElementById("status");

function setStatus(message, color) {
  status.textContent = message;
  status.style.color = color;
}

function save() {
  const val = keyInput.value.trim();
  if (!val.startsWith("sk-ant-")) {
    setStatus("Key should start with sk-ant-", "#f87171");
    return;
  }
  chrome.storage.local.set({ apiKey: val }, () => {
    if (chrome.runtime.lastError) {
      setStatus("Save failed. Reload extension and try again.", "#f87171");
      return;
    }
    setStatus("Saved", "#4ade80");
    keyInput.value = "";
    keyInput.placeholder = "sk-ant-********" + val.slice(-4);
  });
}

chrome.storage.local.get("apiKey", ({ apiKey }) => {
  if (apiKey) keyInput.placeholder = "sk-ant-********" + apiKey.slice(-4);
});

saveBtn.addEventListener("click", save);
keyInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    save();
  }
});
