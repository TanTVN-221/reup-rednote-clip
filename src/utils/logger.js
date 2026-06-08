import chalk from 'chalk';

const LOG_LEVELS = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

let currentLevel = LOG_LEVELS.info;

function timestamp() {
  return new Date().toISOString().replace('T', ' ').substring(0, 19);
}

function formatMessage(level, emoji, color, ...args) {
  const ts = chalk.gray(timestamp());
  const tag = color(`[${level.toUpperCase()}]`);
  const message = args.map(a => (typeof a === 'object' ? JSON.stringify(a, null, 2) : a)).join(' ');
  return `${ts} ${emoji} ${tag} ${message}`;
}

const logger = {
  setLevel(level) {
    if (LOG_LEVELS[level] !== undefined) {
      currentLevel = LOG_LEVELS[level];
    }
  },

  debug(...args) {
    if (currentLevel <= LOG_LEVELS.debug) {
      console.log(formatMessage('debug', '🔍', chalk.gray, ...args));
    }
  },

  info(...args) {
    if (currentLevel <= LOG_LEVELS.info) {
      console.log(formatMessage('info', '📋', chalk.blue, ...args));
    }
  },

  success(...args) {
    if (currentLevel <= LOG_LEVELS.info) {
      console.log(formatMessage('done', '✅', chalk.green, ...args));
    }
  },

  warn(...args) {
    if (currentLevel <= LOG_LEVELS.warn) {
      console.warn(formatMessage('warn', '⚠️', chalk.yellow, ...args));
    }
  },

  error(...args) {
    if (currentLevel <= LOG_LEVELS.error) {
      console.error(formatMessage('error', '❌', chalk.red, ...args));
    }
  },

  step(stepNum, total, message) {
    const progress = chalk.cyan(`[${stepNum}/${total}]`);
    console.log(`${chalk.gray(timestamp())} 🔄 ${progress} ${message}`);
  },

  divider(title = '') {
    const line = '─'.repeat(50);
    if (title) {
      console.log(chalk.gray(`\n${'─'.repeat(10)} ${title} ${'─'.repeat(Math.max(0, 38 - title.length))}\n`));
    } else {
      console.log(chalk.gray(line));
    }
  },
};

export default logger;
