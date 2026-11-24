const yearFormatter = new Intl.DateTimeFormat('he-IL', { year: 'numeric' });

export const formatYear = (date: Date = new Date()): string => yearFormatter.format(date);
