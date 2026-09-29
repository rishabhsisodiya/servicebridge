import { stripUrlCredentials } from '../core/logging/redact';

/**
 * A WhatsApp Business API that can send a pre-approved template message.
 * Templates are positional on the wire: `parameters[i]` fills `{{i+1}}` in
 * the approved template body.
 */
export interface WhatsAppProvider {
  sendTemplate(
    to: string,
    providerTemplateName: string,
    languageCode: string,
    parameters: string[],
  ): Promise<{ providerMessageId: string }>;
}

export interface MetaCloudApiConfig {
  phoneNumberId: string;
  accessToken: string;
  /** Defaults to 15 s. Tests pass a fake fetch instead of shortening this. */
  timeoutMs?: number;
  /**
   * Swappable so tests mock the HTTP layer. The production instance uses the
   * global fetch; unit tests must never hit the real Meta API.
   */
  fetchImpl?: typeof fetch;
}

const META_API_VERSION = 'v22.0';
const DEFAULT_TIMEOUT_MS = 15_000;

/**
 * Sends through Meta's WhatsApp Cloud API. The access token only ever leaves
 * this class in the Authorization header; failures throw plain Errors whose
 * messages are safe to store in the log row (URL credentials stripped).
 */
export class MetaCloudApiProvider implements WhatsAppProvider {
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(private readonly config: MetaCloudApiConfig) {
    this.fetchImpl = config.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async sendTemplate(
    to: string,
    providerTemplateName: string,
    languageCode: string,
    parameters: string[],
  ): Promise<{ providerMessageId: string }> {
    const url = `https://graph.facebook.com/${META_API_VERSION}/${this.config.phoneNumberId}/messages`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.config.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to,
          type: 'template',
          template: {
            name: providerTemplateName,
            language: { code: languageCode },
            components: [
              {
                type: 'body',
                parameters: parameters.map((text) => ({ type: 'text', text })),
              },
            ],
          },
        }),
        signal: controller.signal,
      });
      const payload = (await response.json().catch(() => null)) as {
        messages?: { id: string }[];
        error?: { message?: string };
      } | null;
      if (!response.ok) {
        const detail = payload?.error?.message ?? `HTTP ${response.status}`;
        throw new Error(
          `Meta WhatsApp API rejected the message: ${stripUrlCredentials(detail)}`,
        );
      }
      const id = payload?.messages?.[0]?.id;
      if (!id) throw new Error('Meta WhatsApp API returned no message id.');
      return { providerMessageId: id };
    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        throw new Error('Meta WhatsApp API timed out after 15 seconds.');
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}
