/**
 * Typed, validated access to build-time environment variables.
 * Every import.meta.env read goes through here so missing config is caught in one place.
 */
const readOptional = (value: string | undefined): string | null => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
};

export const env = {
  web3FormsAccessKey: readOptional(import.meta.env.VITE_WEB3FORMS_ACCESS_KEY),
  isDev: import.meta.env.DEV,
} as const;
