import { MetaCloudApiProvider } from './whatsapp-providers';

/** Builds a fake fetch whose behaviour the test controls. Never the real API. */
function fakeFetch(handler: (url: string, init: RequestInit) => Promise<Response>) {
  return jest.fn(async (url: string, init: RequestInit) => handler(url, init));
}

const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

describe('MetaCloudApiProvider', () => {
  it('POSTs a template message and returns the provider message id', async () => {
    const fetchMock = fakeFetch(async () =>
      jsonResponse(200, { messages: [{ id: 'wamid.test123' }] }),
    );
    const provider = new MetaCloudApiProvider({
      phoneNumberId: '12345',
      accessToken: 'token',
      fetchImpl: fetchMock as typeof fetch,
    });
    const result = await provider.sendTemplate('+919876543210', 'ticket_assigned', 'en', [
      'Mira',
      'SB-26-000101',
    ]);
    expect(result).toEqual({ providerMessageId: 'wamid.test123' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://graph.facebook.com/v22.0/12345/messages');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer token');
    expect(JSON.parse(init.body as string)).toEqual({
      messaging_product: 'whatsapp',
      to: '+919876543210',
      type: 'template',
      template: {
        name: 'ticket_assigned',
        language: { code: 'en' },
        components: [
          {
            type: 'body',
            parameters: [
              { type: 'text', text: 'Mira' },
              { type: 'text', text: 'SB-26-000101' },
            ],
          },
        ],
      },
    });
  });

  it('throws a storable error when Meta rejects the message', async () => {
    const fetchMock = fakeFetch(async () =>
      jsonResponse(400, { error: { message: '(#131030) Recipient phone number not in allowed list', code: 131030 } }),
    );
    const provider = new MetaCloudApiProvider({
      phoneNumberId: '12345',
      accessToken: 'token',
      fetchImpl: fetchMock as typeof fetch,
    });
    await expect(
      provider.sendTemplate('+919876543210', 'ticket_assigned', 'en', []),
    ).rejects.toThrow('Meta WhatsApp API rejected the message: (#131030)');
  });

  it('throws when Meta returns no message id', async () => {
    const fetchMock = fakeFetch(async () => jsonResponse(200, { messages: [] }));
    const provider = new MetaCloudApiProvider({
      phoneNumberId: '12345',
      accessToken: 'token',
      fetchImpl: fetchMock as typeof fetch,
    });
    await expect(
      provider.sendTemplate('+919876543210', 'ticket_assigned', 'en', []),
    ).rejects.toThrow('returned no message id');
  });

  it('aborts the request after the timeout', async () => {
    const fetchMock = fakeFetch((_url, init) => {
      expect(init.signal).toBeDefined();
      const error = new Error('The operation was aborted.');
      error.name = 'AbortError';
      return Promise.reject(error);
    });
    const provider = new MetaCloudApiProvider({
      phoneNumberId: '12345',
      accessToken: 'token',
      fetchImpl: fetchMock as typeof fetch,
    });
    await expect(
      provider.sendTemplate('+919876543210', 'ticket_assigned', 'en', []),
    ).rejects.toThrow('timed out');
  });
});
