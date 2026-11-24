import { env } from '@/config/env';
import { AppError } from '@/utils/errors';
import type { ContactFormValues } from '@/utils/validation';

// Web3Forms (https://web3forms.com) forwards submissions to the email the access key was created for.
const FORM_ENDPOINT = 'https://api.web3forms.com/submit';
const REQUEST_TIMEOUT_MS = 15_000;

interface Web3FormsResponse {
  success?: boolean | string;
  message?: string;
}

export interface SendContactOptions {
  accessKey?: string | null;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export const sendContactMessage = async (
  values: ContactFormValues,
  { accessKey = env.web3FormsAccessKey, fetchImpl = fetch, timeoutMs = REQUEST_TIMEOUT_MS }: SendContactOptions = {},
): Promise<void> => {
  if (!accessKey) {
    throw new AppError('NOT_CONFIGURED', 'VITE_WEB3FORMS_ACCESS_KEY is not set');
  }

  const payload = {
    ...values,
    access_key: accessKey,
    subject: `פנייה מהאתר: ${values.subject} (${values.name})`,
    from_name: 'האתר שלי',
    replyto: values.email,
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  // The timeout covers the whole exchange, including reading the response body,
  // so a server that sends headers and then stalls can't leave the form stuck on "sending".
  try {
    let res: Response;
    try {
      res = await fetchImpl(FORM_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
    } catch (err) {
      if (controller.signal.aborted) throw new AppError('TIMEOUT', 'Contact request timed out', { cause: err });
      throw new AppError('NETWORK', 'Contact request failed to reach the server', { cause: err });
    }

    const json = (await res.json().catch((err: unknown) => {
      if (controller.signal.aborted) throw new AppError('TIMEOUT', 'Contact response timed out', { cause: err });
      return {};
    })) as Web3FormsResponse;
    if (!res.ok || String(json.success) !== 'true') {
      throw new AppError('SERVER', `Web3Forms rejected the request: ${json.message ?? res.status}`);
    }
  } finally {
    clearTimeout(timer);
  }
};
