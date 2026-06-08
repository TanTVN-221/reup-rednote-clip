import ora from 'ora';
import chalk from 'chalk';

/**
 * Create a spinner for a long-running operation.
 */
export function createSpinner(text) {
  return ora({
    text,
    color: 'cyan',
    spinner: 'dots12',
  });
}

/**
 * Run a function with a spinner, showing success/failure on completion.
 */
export async function withSpinner(text, fn) {
  const spinner = createSpinner(text);
  spinner.start();
  try {
    const result = await fn(spinner);
    spinner.succeed(chalk.green(text + ' — done'));
    return result;
  } catch (err) {
    spinner.fail(chalk.red(text + ' — failed'));
    throw err;
  }
}

/**
 * Display a pipeline progress header.
 */
export function pipelineHeader(videoTitle, step, totalSteps) {
  const progress = `${step}/${totalSteps}`;
  const bar = '█'.repeat(step) + '░'.repeat(totalSteps - step);
  console.log(
    chalk.cyan(`\n┌─ Video: ${chalk.white.bold(videoTitle)}`)
  );
  console.log(
    chalk.cyan(`├─ Progress: [${bar}] ${progress}`)
  );
  console.log(
    chalk.cyan(`└${'─'.repeat(50)}`)
  );
}

import { writeFileSync } from 'fs';
import { join } from 'path';
import config from '../../config/default.js';

/**
 * Display a summary table for processed videos and save a markdown report.
 */
export function printSummary(results) {
  console.log(chalk.cyan('\n═══════════════════════════════════════════════════'));
  console.log(chalk.cyan.bold('  📊 Processing Summary'));
  console.log(chalk.cyan('═══════════════════════════════════════════════════'));

  const succeeded = results.filter(r => r.success);
  const failed = results.filter(r => !r.success);

  console.log(chalk.green(`  ✅ Succeeded: ${succeeded.length}`));
  if (failed.length > 0) {
    console.log(chalk.red(`  ❌ Failed: ${failed.length}`));
    for (const f of failed) {
      console.log(chalk.red(`     • ${f.title}: ${f.error}`));
    }
  }
  console.log(chalk.cyan('═══════════════════════════════════════════════════\n'));

  // Generate Markdown Report
  try {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const reportPath = join(config.outputDir || './data/output', `summary_report_${timestamp}.md`);
    
    let mdContent = `# Pipeline Summary Report\n\n`;
    mdContent += `**Date:** ${new Date().toLocaleString()}\n`;
    mdContent += `**Total Videos Processed:** ${results.length}\n`;
    mdContent += `**Succeeded:** ${succeeded.length} ✅\n`;
    mdContent += `**Failed:** ${failed.length} ❌\n\n`;

    if (succeeded.length > 0) {
      mdContent += `## ✅ Successful Videos\n\n`;
      succeeded.forEach((r, i) => {
        mdContent += `${i + 1}. **${r.title || r.noteId}**\n`;
        if (r.output) mdContent += `   - Output: \`${r.output}\`\n`;
      });
      mdContent += `\n`;
    }

    if (failed.length > 0) {
      mdContent += `## ❌ Failed Videos\n\n`;
      failed.forEach((r, i) => {
        mdContent += `${i + 1}. **${r.title || r.noteId}**\n`;
        mdContent += `   - Error: \`${r.error}\`\n`;
      });
    }

    writeFileSync(reportPath, mdContent, 'utf-8');
    console.log(chalk.green(`📄 Summary report saved to: ${reportPath}\n`));
  } catch (err) {
    console.error(chalk.red(`Failed to save summary report: ${err.message}`));
  }
}
