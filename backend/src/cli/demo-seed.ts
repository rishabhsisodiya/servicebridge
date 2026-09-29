/* eslint-disable no-console -- command-line tool: console output is the interface */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { DemoService } from '../demo/demo.service';

/** Loads (or reloads) the fictional demo company. Safe to run again: it replaces only demo data. */
async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  try {
    // Running this command is itself the explicit confirmation: the CLI
    // operator may seed a non-empty install on purpose.
    const result = await app.get(DemoService).load(
      { id: null, name: 'Command line' },
      null,
      { confirmed: true },
    );
    const c = result.counts;
    console.log(
      `\nDemo data loaded: ${c.customers} customers, ${c.sites} sites, ${c.contacts} contacts, ${c.machines} machines, ${c.items} items, ${c.users} demo users.`,
    );
    console.log(`\nDemo logins (all use the password below; shown only now):`);
    for (const login of result.logins) console.log(`  ${login.email.padEnd(40)} ${login.role}`);
    console.log(`\n  Password: ${result.password}\n`);
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  console.error(
    `Could not load demo data: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
});
