const state = {
  transactions: [],
  nextTransactionCode: "001",
};

const contentGrid = document.getElementById("contentGrid");
const form = document.getElementById("transactionForm");
const detailsPanel = document.getElementById("detailsPanel");
const formTitle = document.getElementById("formTitle");
const formMessage = document.getElementById("formMessage");
const pageMessage = document.getElementById("pageMessage");
const editTransactionId = document.getElementById("editTransactionId");
const transactionType = document.getElementById("transactionType");
const transactionDisplayId = document.getElementById("transactionDisplayId");
const description = document.getElementById("description");
const amount = document.getElementById("amount");
const updatedBy = document.getElementById("updatedBy");
const receipt = document.getElementById("receipt");
const notes = document.getElementById("notes");
const submitButton = document.getElementById("submitButton");
const cancelEditButton = document.getElementById("cancelEdit");
const newTransactionButton = document.getElementById("newTransactionButton");
const totalCashInHand = document.getElementById("totalCashInHand");
const amountSpent = document.getElementById("amountSpent");
const transactionsTableBody = document.getElementById("transactionsTableBody");
const emptyStateTemplate = document.getElementById("emptyStateTemplate");
const updatedByOptions = document.getElementById("updatedByOptions");

form.addEventListener("submit", onSubmit);
cancelEditButton.addEventListener("click", resetForm);
newTransactionButton.addEventListener("click", startNewTransaction);
transactionsTableBody.addEventListener("click", onTableAction);

initialize().catch((error) => {
  showPageMessage(error.message, true);
});

async function initialize() {
  await refreshData();
  resetForm();
}

async function refreshData() {
  const response = await fetch("/api/bootstrap");
  const payload = await parseResponse(response);
  state.transactions = payload.transactions;
  state.nextTransactionCode = payload.nextTransactionCode;
  renderSummary(payload.summary);
  renderTable();
  renderUpdatedByOptions();
}

function renderSummary(summary) {
  totalCashInHand.textContent = formatCurrency(summary.totalCashInHand);
  amountSpent.textContent = formatCurrency(summary.amountSpent);
}

function renderTable() {
  transactionsTableBody.innerHTML = "";

  if (state.transactions.length === 0) {
    transactionsTableBody.appendChild(emptyStateTemplate.content.cloneNode(true));
    return;
  }

  state.transactions.forEach((transaction) => {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td data-label="ID">${transaction.id}</td>
      <td data-label="Type"><span class="badge ${transaction.type}">${capitalize(transaction.type)}</span></td>
      <td data-label="Description">${escapeHtml(transaction.description)}</td>
      <td data-label="Amount">${formatCurrency(transaction.amount)}</td>
      <td data-label="Updated By">${escapeHtml(transaction.updatedBy)}</td>
      <td data-label="Receipt">${renderReceiptCell(transaction)}</td>
      <td data-label="Notes">${escapeHtml(transaction.notes || "-")}</td>
      <td data-label="Actions">
        <div class="table-actions">
          <button type="button" class="edit-btn" data-action="edit" data-id="${transaction.dbId}">Edit</button>
          <button type="button" class="delete-btn" data-action="delete" data-id="${transaction.dbId}">Delete</button>
        </div>
      </td>
    `;
    transactionsTableBody.appendChild(row);
  });
}

function renderReceiptCell(transaction) {
  if (!transaction.receiptName || !transaction.receiptUrl) {
    return "-";
  }

  return `<a class="receipt-link" href="${escapeAttribute(transaction.receiptUrl)}" target="_blank" rel="noreferrer">${escapeHtml(transaction.receiptName)}</a>`;
}

function renderUpdatedByOptions() {
  const uniqueNames = [...new Set(state.transactions.map((transaction) => transaction.updatedBy.trim()).filter(Boolean))];
  updatedByOptions.innerHTML = uniqueNames
    .sort((a, b) => a.localeCompare(b))
    .map((name) => `<option value="${escapeAttribute(name)}"></option>`)
    .join("");
}

async function onSubmit(event) {
  event.preventDefault();
  setFormBusy(true);
  clearMessages();

  try {
    const formData = new FormData();
    formData.set("type", transactionType.value);
    formData.set("description", description.value.trim());
    formData.set("amount", amount.value);
    formData.set("updatedBy", updatedBy.value.trim());
    formData.set("notes", notes.value.trim());

    if (receipt.files[0]) {
      formData.set("receipt", receipt.files[0]);
    }

    const editingId = editTransactionId.value;
    const response = await fetch(editingId ? `/api/transactions/${editingId}` : "/api/transactions", {
      method: editingId ? "PUT" : "POST",
      body: formData,
    });

    const payload = await parseResponse(response);
    upsertTransaction(payload.transaction);
    state.nextTransactionCode = payload.nextTransactionCode;
    renderSummary(payload.summary);
    renderTable();
    renderUpdatedByOptions();
    resetForm();
  } catch (error) {
    showFormMessage(error.message, true);
  } finally {
    setFormBusy(false);
  }
}

async function onTableAction(event) {
  const button = event.target.closest("button[data-action]");
  if (!button) {
    return;
  }

  const transactionId = Number(button.dataset.id);
  const transaction = state.transactions.find((item) => item.dbId === transactionId);
  if (!transaction) {
    return;
  }

  if (button.dataset.action === "edit") {
    populateForm(transaction);
    return;
  }

  clearMessages();

  try {
    const response = await fetch(`/api/transactions/${transactionId}`, {
      method: "DELETE",
    });

    const payload = await parseResponse(response);
    state.transactions = state.transactions.filter((item) => item.dbId !== transactionId);
    state.nextTransactionCode = payload.nextTransactionCode;
    renderSummary(payload.summary);
    renderTable();
    renderUpdatedByOptions();

    if (editTransactionId.value === String(transactionId)) {
      resetForm();
    }
  } catch (error) {
    showPageMessage(error.message, true);
  }
}

function populateForm(transaction) {
  clearMessages();
  showDetailsPanel();
  formTitle.textContent = `Edit Transaction ${transaction.id}`;
  submitButton.textContent = "Update Transaction";
  cancelEditButton.classList.remove("hidden");
  editTransactionId.value = transaction.dbId;
  transactionDisplayId.value = transaction.id;
  transactionType.value = transaction.type;
  description.value = transaction.description;
  amount.value = transaction.amount;
  updatedBy.value = transaction.updatedBy;
  notes.value = transaction.notes;
  receipt.value = "";
}

function resetForm() {
  form.reset();
  editTransactionId.value = "";
  formTitle.textContent = "Add New Transaction";
  submitButton.textContent = "Save Transaction";
  cancelEditButton.classList.add("hidden");
  transactionType.value = "credit";
  transactionDisplayId.value = state.nextTransactionCode || "Generated on save";
  hideDetailsPanel();
  clearMessages();
}

function startNewTransaction() {
  form.reset();
  editTransactionId.value = "";
  formTitle.textContent = "Add New Transaction";
  submitButton.textContent = "Save Transaction";
  cancelEditButton.classList.add("hidden");
  transactionType.value = "credit";
  transactionDisplayId.value = state.nextTransactionCode || "Generated on save";
  showDetailsPanel();
  description.focus();
  clearMessages();
}

function setFormBusy(isBusy) {
  submitButton.disabled = isBusy;
  submitButton.textContent = isBusy ? "Saving..." : editTransactionId.value ? "Update Transaction" : "Save Transaction";
}

function upsertTransaction(transaction) {
  const index = state.transactions.findIndex((item) => item.dbId === transaction.dbId);
  if (index >= 0) {
    state.transactions[index] = transaction;
  } else {
    state.transactions.unshift(transaction);
  }
}

function showDetailsPanel() {
  detailsPanel.classList.remove("hidden");
  contentGrid.classList.remove("list-only");
}

function hideDetailsPanel() {
  detailsPanel.classList.add("hidden");
  contentGrid.classList.add("list-only");
}

function showFormMessage(message, isError = false) {
  formMessage.textContent = message;
  formMessage.classList.remove("hidden");
  formMessage.style.background = isError ? "rgba(247, 223, 214, 0.95)" : "rgba(220, 239, 227, 0.95)";
}

function showPageMessage(message, isError = false) {
  pageMessage.textContent = message;
  pageMessage.classList.remove("hidden");
  pageMessage.style.background = isError ? "rgba(247, 223, 214, 0.95)" : "rgba(220, 239, 227, 0.95)";
}

function clearMessages() {
  formMessage.classList.add("hidden");
  pageMessage.classList.add("hidden");
}

async function parseResponse(response) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.message || "Request failed.");
  }
  return payload;
}

function formatCurrency(value) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 2,
  }).format(Number(value) || 0);
}

function capitalize(value) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeAttribute(value) {
  return escapeHtml(value);
}
