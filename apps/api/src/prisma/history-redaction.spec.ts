import { redactDeep, scalarsOnly } from './prisma.service';

describe('history capture redaction', () => {
  it('drops relation objects pulled in by include', () => {
    const row = { id: 'e1', firstName: 'x', organizationId: 'o', manager: { id: 'u', userId: 'h' }, journeys: [{ id: 'j' }] };
    expect(scalarsOnly('Employee', row)).toEqual({ id: 'e1', firstName: 'x', organizationId: 'o' });
  });

  it('removes secret keys at any depth of Json values', () => {
    expect(redactDeep({ a: { publicToken: 't', keep: 1 }, list: [{ hotToken: 'h', v: 2 }] })).toEqual({
      a: { keep: 1 },
      list: [{ v: 2 }],
    });
  });
});
