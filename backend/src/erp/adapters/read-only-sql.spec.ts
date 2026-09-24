import { assertReadOnlySql, assessGrants } from './read-only-sql';

describe('assertReadOnlySql', () => {
  it.each([
    'SELECT name FROM `tabCustomer` WHERE modified > ?',
    'select 1',
    '  WITH x AS (SELECT 1) SELECT * FROM x;',
    "SELECT name FROM `tabItem` WHERE description LIKE '%update%'",
    'SELECT `update_date` FROM `tabSales Order`', // column names containing keywords are fine
    'SELECT 1 -- delete this later',
    'SELECT name FROM `tabUpdate Log` LIMIT 0',
  ])('allows %p', (sql) => {
    expect(() => assertReadOnlySql(sql)).not.toThrow();
  });

  it.each([
    ['DELETE FROM `tabCustomer`', /must start with SELECT/],
    ['UPDATE `tabItem` SET disabled = 1', /must start with SELECT/],
    ['SELECT 1; DROP TABLE `tabCustomer`', /one statement/],
    ['SELECT * FROM `tabCustomer` FOR UPDATE', /for update/i],
    ["SELECT * INTO OUTFILE '/tmp/x' FROM `tabCustomer`", /into outfile/i],
    ['SELECT SLEEP(10)', /sleep/i],
    ['/* innocent */ INSERT INTO t VALUES (1)', /must start with SELECT/],
    ['SELECT 1 /* ; */ ; SET GLOBAL read_only = 0', /one statement|set/i],
    ['WITH d AS (DELETE FROM t RETURNING *) SELECT * FROM d', /delete/i],
  ])('refuses %p', (sql, reason) => {
    expect(() => assertReadOnlySql(sql)).toThrow(reason);
  });
});

describe('assessGrants', () => {
  it('recognises a SELECT-only user', () => {
    expect(
      assessGrants([
        'GRANT USAGE ON *.* TO `sb_read`@`%`',
        'GRANT SELECT, SHOW VIEW ON `_1bd3e0294da19198`.* TO `sb_read`@`%`',
      ]),
    ).toEqual({ verdict: 'SELECT_ONLY', extra: [] });
  });

  it('flags write privileges by name', () => {
    expect(assessGrants(['GRANT SELECT, INSERT, UPDATE ON `erp`.* TO `app`@`%`'])).toEqual({
      verdict: 'HAS_WRITE_GRANTS',
      extra: ['INSERT', 'UPDATE'],
    });
    expect(
      assessGrants(['GRANT ALL PRIVILEGES ON *.* TO `root`@`%` WITH GRANT OPTION']).extra,
    ).toEqual(['ALL PRIVILEGES', 'GRANT OPTION']);
  });

  it('cannot verify privileges that come from a role', () => {
    expect(assessGrants(['GRANT `reporting` TO `sb_read`@`%`']).verdict).toBe('UNVERIFIED');
  });
});
