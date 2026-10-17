const fs = require('fs');
const path = require('path');

function writeLog(level, message) {
  const logLine = `${new Date().toISOString()} [${level}] ${message}\n`;

  const logPath = path.join(__dirname, '..', 'logs', 'application.log');

  fs.appendFileSync(logPath, logLine);
}

module.exports = { writeLog };
