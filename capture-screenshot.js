#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');
const TOML = require('@iarna/toml');
const dotenv = require('dotenv');

const HELP_TEXT = `
Usage: node capture-screenshot.js [--input <path-or-url>] [--output <file-or-dir>] [options]

Optional:
  --input, -i     HTML file or directory. Default: current directory (自动扫描 *.html/*.htm).
  --output, -o    Output file or directory. Default: ./screenshots
  --config        Path to the config file (.json/.toml/.env). Default: screenshot.config.toml
  --width, -w     Viewport width in CSS pixels. Default: 1440
  --height, -h    Viewport height in CSS pixels. Default: 900
  --wait, -t      Extra wait time in ms after load/network idle. Default: 1500
  --timeout       Navigation timeout in ms. Default: 60000
  --follow-iframe Follow iframe content. true/false/auto (default auto).
  --iframe-selector CSS selector used when following iframe. Default: iframe
  --iframe-index Which match (0-based) to follow when not in auto mode. Default: 0
  --hide-selectors Comma-separated CSS selectors to hide before capturing.
  --remove-selectors Comma-separated CSS selectors to remove from DOM before capture.
  --no-sandbox    Launch Chromium without the sandbox (if your OS requires it).
  --help          Show this message.
`;

const DEFAULT_CONFIG_FILE = 'screenshot.config.toml';
const DEFAULT_OUTPUT_DIR = 'screenshots';

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token.startsWith('--')) {
      const [key, inlineValue] = token.slice(2).split('=');
      if (inlineValue !== undefined) {
        args[key] = inlineValue;
        continue;
      }
      if (key === 'help') {
        args.help = true;
        continue;
      }
      const next = argv[i + 1];
      if (!next || next.startsWith('-')) {
        args[key] = true;
      } else {
        args[key] = next;
        i += 1;
      }
    } else if (token.startsWith('-')) {
      const key = token.slice(1);
      const aliasMap = { i: 'input', o: 'output', w: 'width', h: 'height', t: 'wait' };
      const mappedKey = aliasMap[key] || key;
      const next = argv[i + 1];
      if (!next || next.startsWith('-')) {
        args[mappedKey] = true;
      } else {
        args[mappedKey] = next;
        i += 1;
      }
    } else {
      (args._ ??= []).push(token);
    }
  }
  return args;
}

function ensureNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const toSelectorList = (value) => {
  if (Array.isArray(value)) {
    return value.map((token) => String(token).trim()).filter(Boolean);
  }
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((token) => token.trim())
      .filter(Boolean);
  }
  return [];
};
const resolveBoolean = (value, fallback = false) => {
  if (value === undefined) {
    return fallback;
  }
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    const lowered = value.toLowerCase();
    if (lowered === 'true') {
      return true;
    }
    if (lowered === 'false') {
      return false;
    }
  }
  return Boolean(value);
};
const resolveFollowIframeMode = (value) => {
  if (value === undefined || value === null) {
    return 'auto';
  }
  if (typeof value === 'string') {
    const lowered = value.toLowerCase();
    if (lowered === 'auto' || lowered === 'true' || lowered === 'false') {
      if (lowered === 'true') return true;
      if (lowered === 'false') return false;
      return 'auto';
    }
  }
  if (typeof value === 'boolean') {
    return value;
  }
  return value;
};
const parseConfigContent = (filePath, content) => {
  const ext = (path.extname(filePath) || '').toLowerCase();
  if (ext === '.toml') {
    return TOML.parse(content);
  }
  if (ext === '.env') {
    return dotenv.parse(content);
  }
  if (ext === '.json' || !ext) {
    return JSON.parse(content);
  }
  try {
    return JSON.parse(content);
  } catch (jsonErr) {
    throw new Error(`不支持的配置格式 ${ext || '未知'}，且无法按 JSON 解析：${jsonErr.message}`);
  }
};

const loadConfig = (configPathArg) => {
  const resolvedPath = path.resolve(configPathArg || DEFAULT_CONFIG_FILE);
  try {
    const content = fs.readFileSync(resolvedPath, 'utf8');
    const parsed = parseConfigContent(resolvedPath, content);
    const sanitized = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (key.startsWith('_')) {
        continue;
      }
      sanitized[key] = value;
    }
    return { path: resolvedPath, values: sanitized };
  } catch (error) {
    if (error.code === 'ENOENT') {
      if (configPathArg) {
        throw new Error(`未找到配置文件：${resolvedPath}`);
      }
      return { path: resolvedPath, values: {} };
    }
    throw new Error(`无法解析配置文件 ${resolvedPath}: ${error.message}`);
  }
};

const statSafe = (targetPath) => fs.promises.stat(targetPath).catch(() => null);
const isHttpUrl = (value) => /^https?:\/\//i.test(value);
const isHtmlFile = (value) => /\.(x?html?)$/i.test(value);
const collectHtmlTargets = async (inputValue) => {
  if (isHttpUrl(inputValue)) {
    return [inputValue];
  }
  const stats = await statSafe(inputValue);
  if (!stats) {
    throw new Error(`输入路径不存在：${inputValue}`);
  }
  if (stats.isDirectory()) {
    const entries = await fs.promises.readdir(inputValue, { withFileTypes: true });
    const htmlFiles = entries
      .filter((entry) => entry.isFile() && isHtmlFile(entry.name))
      .map((entry) => path.join(inputValue, entry.name));
    if (htmlFiles.length === 0) {
      throw new Error(`目录 ${inputValue} 中未找到 HTML 文件`);
    }
    return htmlFiles;
  }
  if (!isHtmlFile(inputValue)) {
    throw new Error(`输入文件不是 HTML：${inputValue}`);
  }
  return [inputValue];
};

const resolveOutputPath = async (outputHint, targetCount) => {
  const resolved = path.resolve(outputHint);
  const stats = await statSafe(resolved);
  const hasExt = Boolean(path.extname(resolved));

  if (targetCount > 1 && stats && !stats.isDirectory()) {
    throw new Error('--output 指向的已存在路径为文件，但当前有多个 HTML 输入，请改为目录');
  }
  if (targetCount > 1 && !stats && hasExt) {
    throw new Error('当输入目录中存在多个 HTML 时，--output 必须是目录');
  }

  const treatAsDir = stats ? stats.isDirectory() : !hasExt || targetCount > 1;
  if (treatAsDir) {
    await fs.promises.mkdir(resolved, { recursive: true });
    return { isDir: true, dir: resolved };
  }
  await fs.promises.mkdir(path.dirname(resolved), { recursive: true });
  return { isDir: false, file: resolved };
};

const buildOutputFilePath = (outputInfo, inputPath) => {
  if (!outputInfo.isDir) {
    return outputInfo.file;
  }
  const base = path.basename(inputPath);
  const name = base.replace(/\.(x?html?)$/i, '') || base;
  return path.join(outputInfo.dir, `${name}.png`);
};

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(HELP_TEXT);
    return;
  }
  const { values: configValues } = loadConfig(args.config);
  const inputValue = args.input ?? configValues.input ?? '.';
  const outputValue = args.output ?? configValues.output ?? DEFAULT_OUTPUT_DIR;

  const viewportWidth = ensureNumber(args.width ?? configValues.width, 1440);
  const viewportHeight = ensureNumber(args.height ?? configValues.height, 900);
  const waitAfterLoad = ensureNumber(args.wait ?? configValues.wait, 1500);
  const navigationTimeout = ensureNumber(args.timeout ?? configValues.timeout, 60000);
  const followIframeRaw = Object.prototype.hasOwnProperty.call(args, 'follow-iframe')
    ? args['follow-iframe']
    : configValues.followIframe;
  const followIframeMode = resolveFollowIframeMode(followIframeRaw);
  const iframeSelector = args['iframe-selector'] ?? configValues.iframeSelector ?? 'iframe';
  const iframeIndex = ensureNumber(args['iframe-index'] ?? configValues.iframeIndex, 0);
  const hideSelectors = toSelectorList(args['hide-selectors'] ?? configValues.hideSelectors);
  const removeSelectors = toSelectorList(args['remove-selectors'] ?? configValues.removeSelectors);
  const noSandbox = resolveBoolean(
    Object.prototype.hasOwnProperty.call(args, 'no-sandbox') ? args['no-sandbox'] : configValues.noSandbox,
    false,
  );
  const inputHint = isHttpUrl(inputValue) ? inputValue : path.resolve(inputValue);
  const targets = await collectHtmlTargets(inputHint);
  const outputInfo = await resolveOutputPath(outputValue, targets.length);

  const launchOptions = {
    headless: 'new',
    defaultViewport: { width: viewportWidth, height: viewportHeight, deviceScaleFactor: 2 },
  };
  if (noSandbox) {
    launchOptions.args = ['--no-sandbox', '--disable-setuid-sandbox'];
  }

  const browser = await puppeteer.launch(launchOptions);
  try {
    for (const target of targets) {
      const outputPath = buildOutputFilePath(outputInfo, target);
      await captureSinglePage({
        browser,
        resource: target,
        outputPath,
        navigationTimeout,
        followIframeMode,
        iframeSelector,
        iframeIndex,
        removeSelectors,
        hideSelectors,
        waitAfterLoad,
      });
      process.stdout.write(`Screenshot saved to ${outputPath}\n`);
    }
  } finally {
    await browser.close();
  }
}

async function captureSinglePage({
  browser,
  resource,
  outputPath,
  navigationTimeout,
  followIframeMode,
  iframeSelector,
  iframeIndex,
  removeSelectors,
  hideSelectors,
  waitAfterLoad,
}) {
  const page = await browser.newPage();
  try {
    page.setDefaultNavigationTimeout(navigationTimeout);
    const isHttp = isHttpUrl(resource);
    const targetUrl = isHttp ? resource : new URL(`file://${path.resolve(resource)}`).href;
    await page.goto(targetUrl, { waitUntil: ['load', 'networkidle2'] });
    await maybeFollowIframe({
      page,
      mode: followIframeMode,
      iframeSelector,
      iframeIndex,
    });
    if (removeSelectors.length > 0) {
      await page.evaluate((selectors) => {
        selectors.forEach((selector) => {
          document.querySelectorAll(selector).forEach((node) => node.remove());
        });
      }, removeSelectors);
    }
    if (hideSelectors.length > 0) {
      const css = hideSelectors.map((selector) => `${selector} { display: none !important; visibility: hidden !important; }`).join('\n');
      await page.addStyleTag({ content: css });
    }
    if (waitAfterLoad > 0) {
      await delay(waitAfterLoad);
    }
    await page.screenshot({ path: outputPath, fullPage: true });
  } finally {
    await page.close();
  }
}

async function maybeFollowIframe({ page, mode, iframeSelector, iframeIndex }) {
  if (mode === false) {
    return;
  }
  const info = await page.evaluate(
    ({ selector }) => {
      const nodes = Array.from(document.querySelectorAll(selector));
      const total = nodes.length;
      if (total === 0) {
        return { total };
      }
      const frames = nodes.map((node) => {
        const rect = node.getBoundingClientRect();
        const src = node.getAttribute('src') || '';
        const coversViewport = rect.width > 0 && rect.height > 0 && rect.top <= 5 && rect.left <= 5;
        return { src, coversViewport };
      });
      return { total, frames };
    },
    { selector: iframeSelector },
  );

  if (info.total === 0) {
    if (mode === true) {
      throw new Error(`未找到匹配的 iframe（selector: ${iframeSelector}, index: ${iframeIndex}）`);
    }
    return;
  }

  let targetIndex = iframeIndex;
  if (info.total === 1 && mode === 'auto') {
    targetIndex = 0;
  } else if (mode === 'auto') {
    const candidate = info.frames.findIndex((frame) => frame.coversViewport);
    targetIndex = candidate >= 0 ? candidate : 0;
  }

  const iframeSrc = await page.evaluate(
    ({ selector, index }) => {
      const nodes = Array.from(document.querySelectorAll(selector));
      const target = nodes[index];
      return target ? target.getAttribute('src') : null;
    },
    { selector: iframeSelector, index: targetIndex },
  );
  if (!iframeSrc) {
    if (mode === true) {
      throw new Error(`未找到匹配的 iframe（selector: ${iframeSelector}, index: ${targetIndex}）`);
    }
    return;
  }
  const resolvedIframeUrl = new URL(iframeSrc, page.url()).href;
  await page.goto(resolvedIframeUrl, { waitUntil: ['load', 'networkidle2'] });
}

main().catch((err) => {
  process.stderr.write(`Failed to capture screenshot: ${err.message}\n`);
  process.exitCode = 1;
});
