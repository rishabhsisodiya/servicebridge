/* eslint-disable no-console -- command-line tool: console output is the interface */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { createInterface } from 'node:readline';
import { parseArgs } from 'node:util';
import { AppModule } from '../app.module';
import { PASSWORD_MIN_LENGTH, passwordProblems } from '../core/security/password';
import { UsersService } from '../users/users.service';

const USAGE = `Create an administrator account.

  npm run admin:create -- --email you@company.com --name "Your Name"

The password is asked for without echoing it. For automated installs, set
ADMIN_PASSWORD instead (never pass passwords as command-line arguments).`;

/** Reads a line from the terminal without echoing what is typed. */
function askHidden(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const output = rl as unknown as {
      _writeToOutput: (text: string) => void;
      output: NodeJS.WriteStream;
    };
    let prompted = false;
    output._writeToOutput = (text: string) => {
      if (!prompted) {
        output.output.write(text);
        prompted = true;
      }
    };
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    });
  });
}

async function readPassword(email: string): Promise<string> {
  const fromEnv = process.env.ADMIN_PASSWORD;
  if (fromEnv) return fromEnv;
  if (!process.stdin.isTTY)
    throw new Error('No terminal to ask for a password. Set ADMIN_PASSWORD instead.');

  for (;;) {
    const password = await askHidden(
      `Password (at least ${PASSWORD_MIN_LENGTH} characters, a letter and a number): `,
    );
    const problems = passwordProblems(password, { email });
    if (problems.length) {
      console.log(`  ${problems.join(' ')}`);
      continue;
    }
    if ((await askHidden('Type it again: ')) !== password) {
      console.log("  The passwords didn't match. Try again.");
      continue;
    }
    return password;
  }
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: { email: { type: 'string' }, name: { type: 'string' }, help: { type: 'boolean' } },
  });
  if (values.help || !values.email || !values.name) {
    console.log(USAGE);
    process.exitCode = values.help ? 0 : 1;
    return;
  }

  const password = await readPassword(values.email);
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  try {
    const user = await app
      .get(UsersService)
      .createActiveAdmin({ email: values.email, name: values.name, password });
    console.log(
      `\nAdministrator created: ${user.name} <${user.email}>. Sign in at your ServiceBridge address.`,
    );
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  console.error(
    `\nCould not create the administrator: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
});
