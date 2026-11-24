import { describe, expect, it, vi } from 'vitest';
import { AppError, toUserMessage } from '@/utils/errors';
import { sendContactMessage } from './contactService';

const values = { name: 'דנה', email: 'dana@example.com', subject: 'שאלה', message: 'שלום' };

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const expectCode = async (promise: Promise<unknown>, code: AppError['code']) => {
  const err = await promise.catch((e: unknown) => e);
  expect(err).toBeInstanceOf(AppError);
  expect((err as AppError).code).toBe(code);
};

describe('sendContactMessage', () => {
  it('posts the form with the access key and a reply-to address', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ success: true }));
    await sendContactMessage(values, { accessKey: 'key-123', fetchImpl });

    expect(fetchImpl).toHaveBeenCalledOnce();
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({ access_key: 'key-123', replyto: 'dana@example.com', name: 'דנה' });
    expect(body.subject).toContain('שאלה');
  });

  it('fails with NOT_CONFIGURED and makes no request when the key is missing', async () => {
    const fetchImpl = vi.fn();
    await expectCode(sendContactMessage(values, { accessKey: null, fetchImpl }), 'NOT_CONFIGURED');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('fails with NETWORK when the request cannot be sent', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    await expectCode(sendContactMessage(values, { accessKey: 'k', fetchImpl }), 'NETWORK');
  });

  it('fails with TIMEOUT when the server is too slow', async () => {
    const fetchImpl = vi.fn(
      (_url: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
        }),
    );
    await expectCode(sendContactMessage(values, { accessKey: 'k', fetchImpl, timeoutMs: 10 }), 'TIMEOUT');
  });

  it('fails with TIMEOUT when the response body stalls after the headers arrive', async () => {
    const fetchImpl = vi.fn(
      async (_url: RequestInfo | URL, init?: RequestInit) =>
        new Response(
          new ReadableStream({
            start(controller) {
              init?.signal?.addEventListener('abort', () => controller.error(new DOMException('Aborted', 'AbortError')));
            },
          }),
        ),
    );
    await expectCode(sendContactMessage(values, { accessKey: 'k', fetchImpl, timeoutMs: 10 }), 'TIMEOUT');
  });

  it.each([
    ['an HTTP error', jsonResponse({ success: false, message: 'bad key' }, 400)],
    ['a 200 with success=false', jsonResponse({ success: false })],
    ['a non-JSON body', new Response('<html>oops</html>', { status: 502 })],
  ])('fails with SERVER on %s', async (_label, response) => {
    await expectCode(sendContactMessage(values, { accessKey: 'k', fetchImpl: async () => response }), 'SERVER');
  });
});

describe('toUserMessage', () => {
  it('maps known errors to Hebrew messages and unknown ones to a generic message', () => {
    expect(toUserMessage(new AppError('TIMEOUT', 'x'))).toMatch(/יותר מדי זמן/);
    expect(toUserMessage(new Error('anything'))).toBe(toUserMessage(new AppError('SERVER', 'x')));
  });
});
