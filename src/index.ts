#!/usr/bin/env node

import { Command } from 'commander';
import { runScan, runTopicScan } from './commands/scan.js';
import { runOrgScan } from './commands/scan-org.js';
import { runEvidence } from './commands/evidence.js';
import { runTrending } from './commands/trending.js';

const program = new Command();

program
  .name('ghscout')
  .description('Evidence engine for product discovery from GitHub issues')
  .version('0.1.0');

// scan command
program
  .command('scan')
  .description('Scan a repo, org, or topic for opportunity clusters')
  .argument('[repo]', 'Repository in owner/repo format (e.g., vercel/next.js)')
  .option('--org <org>', 'Scan top repos of a GitHub organization')
  .option('--topic <topic>', 'Scan trending repos in a GitHub topic')
  .option('--lang <language>', 'Filter repos by programming language (used with --topic)')
  .option('--output <format>', 'Output format: json | table | pretty', 'pretty')
  .option('--limit <n>', 'Max issues to fetch per repo', '200')
  .option('--period <duration>', 'Time window: 7d, 30d, 90d (default: all open)')
  .option('--min-stars <n>', 'Min repo stars to include', '100')
  .option('--verbose', 'Show API calls and rate limit status', false)
  .option('--no-cache', 'Skip cache, fetch fresh data')
  .option('--top <n>', 'Show only top N clusters', '0')
  .option('--min-reactions <n>', 'Minimum total reactions per cluster', '0')
  .option('--json', 'Shorthand for --output json', false)
  .option('--ai-score', 'Score opportunities using AI via Claude Code CLI', false)
  .action(async (repo: string | undefined, cmdOpts: Record<string, string | boolean>) => {
    const scanOpts = {
      output: cmdOpts.json === true ? 'json' : cmdOpts.output as string,
      limit: parseInt(cmdOpts.limit as string, 10),
      period: (cmdOpts.period as string) || "",
      minStars: parseInt(cmdOpts.minStars as string, 10),
      verbose: cmdOpts.verbose === true,
      noCache: cmdOpts.cache === false,
      top: parseInt(cmdOpts.top as string, 10) || 0,
      minReactions: parseInt(cmdOpts.minReactions as string, 10) || 0,
      aiScore: cmdOpts.aiScore === true,
    };

    const org = cmdOpts.org as string | undefined;
    const topic = cmdOpts.topic as string | undefined;
    const lang = cmdOpts.lang as string | undefined;

    // Validate conflicting flags
    const modes = [repo, org, topic].filter(Boolean);
    if (modes.length > 1) {
      console.error('Error: Cannot combine repo, --org, and --topic. Use only one.');
      process.exit(1);
    }

    if (lang && !topic) {
      console.error('Error: --lang can only be used with --topic.');
      process.exit(1);
    }

    if (topic) {
      await runTopicScan({
        topic,
        lang,
        ...scanOpts,
      });
    } else if (org) {
      await runOrgScan(org, scanOpts);
    } else if (repo) {
      await runScan(repo, scanOpts);
    } else {
      console.error('Error: Provide a repo (owner/repo), --org <org>, or --topic <topic>.');
      process.exit(1);
    }
  });

// evidence command
program
  .command('evidence')
  .description('Deep-dive on a specific pain topic with hard numbers')
  .argument('<repo>', 'Repository in owner/repo format (e.g., vercel/next.js)')
  .argument('<query>', 'Search query (e.g., "auth middleware")')
  .option('--output <format>', 'Output format: json | table | pretty', 'pretty')
  .option('--sort <sort>', 'Sort by: reactions | recent | comments', 'reactions')
  .option('--limit <n>', 'Max issues to return', '20')
  .option('--verbose', 'Show API calls and rate limit status', false)
  .option('--no-cache', 'Skip cache, fetch fresh data')
  .option('--json', 'Shorthand for --output json', false)
  .action(async (repo: string, query: string, cmdOpts: Record<string, string | boolean>) => {
    await runEvidence(repo, query, {
      output: cmdOpts.json === true ? 'json' : cmdOpts.output as string,
      sort: cmdOpts.sort as string,
      limit: parseInt(cmdOpts.limit as string, 10),
      verbose: cmdOpts.verbose === true,
      noCache: cmdOpts.cache === false,
    });
  });

// trending command
program
  .command('trending')
  .description('Top pain clusters across GitHub right now')
  .option('--output <format>', 'Output format: json | table | pretty', 'pretty')
  .option('--top <n>', 'Show only top N clusters', '10')
  .option('--topic <topic>', 'Filter by GitHub topic')
  .option('--lang <language>', 'Filter by programming language')
  .option('--verbose', 'Show API calls and rate limit status', false)
  .option('--no-cache', 'Skip cache, fetch fresh data')
  .option('--json', 'Shorthand for --output json', false)
  .action(async (cmdOpts: Record<string, string | boolean>) => {
    await runTrending({
      output: cmdOpts.json === true ? 'json' : cmdOpts.output as string,
      top: parseInt(cmdOpts.top as string, 10) || 10,
      topic: cmdOpts.topic as string | undefined,
      lang: cmdOpts.lang as string | undefined,
      verbose: cmdOpts.verbose === true,
      noCache: cmdOpts.cache === false,
    });
  });

program.parse(process.argv);
