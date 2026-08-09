import chalk from 'chalk';

export const ok = (msg: string) => console.log(chalk.green('✓'), msg);
export const info = (msg: string) => console.log(chalk.cyan('→'), msg);
export const warn = (msg: string) => console.log(chalk.yellow('!'), msg);
export const fail = (msg: string) => console.error(chalk.red('✗'), msg);

export function maskToken(token: string | undefined | null): string {
  if (!token) return '(empty)';
  if (token.length < 8) return '****';
  return `${token.slice(0, 4)}…${token.slice(-4)}`;
}

export function heading(title: string): void {
  console.log();
  console.log(chalk.bold(title));
  console.log(chalk.dim('─'.repeat(Math.min(48, title.length + 8))));
}
