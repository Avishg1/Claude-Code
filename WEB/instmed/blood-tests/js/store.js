// Imported (confirmed) rows live only in this browser's localStorage.
// The PDF file itself is never stored — only the rows the user confirmed.

const KEY = 'bloodTests.imported.v1';

export function loadImported() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const data = JSON.parse(raw);
    return Array.isArray(data.records) ? data.records : [];
  } catch {
    return [];
  }
}

function save(records) {
  localStorage.setItem(KEY, JSON.stringify({ version: 1, records }));
}

export function addImported(newRecords) {
  const all = loadImported().concat(newRecords);
  save(all);
  return all;
}

export function deleteImportBatch(batchId) {
  const all = loadImported().filter((r) => r.batchId !== batchId);
  save(all);
  return all;
}

export function deleteAllImported() {
  localStorage.removeItem(KEY);
  return [];
}

/** Manual export: a JSON file built in the browser and saved by the user. Nothing is sent anywhere. */
export function exportImported() {
  const records = loadImported();
  const blob = new Blob([JSON.stringify({
    exportedAt: new Date().toISOString(),
    note: 'נתונים שיובאו מקובצי PDF ואושרו ידנית. טווחי הייחוס כפי שהודפסו בכל דוח.',
    records,
  }, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `imported-blood-tests-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
