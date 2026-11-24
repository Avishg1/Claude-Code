const dateTimeFmt = new Intl.DateTimeFormat('he-IL', { dateStyle: 'short', timeStyle: 'medium' });
const numberFmt = new Intl.NumberFormat('he-IL');

export function formatDateTime(msOrIso: number | string | undefined): string {
  if (msOrIso === undefined) return '';
  const d = typeof msOrIso === 'number' ? new Date(msOrIso) : new Date(msOrIso);
  return Number.isNaN(d.getTime()) ? '' : dateTimeFmt.format(d);
}

export function formatNumber(n: number): string {
  return numberFmt.format(n);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${numberFmt.format(bytes)} B`;
  const units = ['KB', 'MB', 'GB'];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toLocaleString('he-IL', { maximumFractionDigits: v < 10 ? 1 : 0 })} ${units[i]}`;
}
