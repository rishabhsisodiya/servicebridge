import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { PartnerCreateTicketDto } from './dto';

const base = {
  customerErpName: 'Acme Industries',
  serviceTypeName: 'Breakdown',
  title: 'Compressor not starting',
};

const errorsFor = async (externalRef: unknown) => {
  const dto = plainToInstance(PartnerCreateTicketDto, { ...base, externalRef });
  return validate(dto);
};

describe('PartnerCreateTicketDto', () => {
  it('accepts a normal externalRef', async () => {
    expect(await errorsFor('ACME-1001')).toHaveLength(0);
  });

  it('SB-L10: rejects an empty externalRef', async () => {
    const errors = await errorsFor('');
    expect(errors.map((e) => e.property)).toContain('externalRef');
  });

  it('SB-L10: rejects a whitespace-only externalRef (trimmed to empty)', async () => {
    const errors = await errorsFor('   ');
    expect(errors.map((e) => e.property)).toContain('externalRef');
  });
});
