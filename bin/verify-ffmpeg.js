'use strict';

/**
 * verify-ffmpeg.js — Validates and repairs the FFmpeg binary.
 * Prevents "spawn EFTYPE" / "spawn ENOENT" errors caused by corrupt,
 * 0-byte, incomplete, or missing FFmpeg executables.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');
const http = require('http');
const zlib = require('zlib');
const { execFileSync } = require('child_process');

const PROJECT_ROOT = path.join(__dirname, '..');
const STATIC_DIR = path.join(PROJECT_ROOT, 'node_modules', 'ffmpeg-static');
const STATIC_EXE_NAME = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
const STATIC_EXE_PATH = path.join(STATIC_DIR, STATIC_EXE_NAME);
const LOCAL_BIN_PATH = path.join(__dirname, STATIC_EXE_NAME);

/**
 * Test whether a path points to a functioning FFmpeg executable.
 */
function testFfmpegExecutable(binPath) {
  if (!binPath || typeof binPath !== 'string') return false;

  // If testing a full path, verify existence and non-trivial file size (> 1MB)
  if (path.isAbsolute(binPath)) {
    try {
      if (!fs.existsSync(binPath)) return false;
      const stat = fs.statSync(binPath);
      if (!stat.isFile() || stat.size < 1000000) {
        return false;
      }
    } catch {
      return false;
    }
  }

  // Attempt to execute -version
  try {
    const out = execFileSync(binPath, ['-version'], {
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 4000,
      encoding: 'utf8'
    });
    return out && out.includes('ffmpeg version');
  } catch {
    return false;
  }
}

/**
 * Scan for any valid FFmpeg executable on the system.
 */
function findWorkingFfmpeg() {
  const candidates = [];

  // 1. ffmpeg-static inside node_modules
  candidates.push(STATIC_EXE_PATH);

  // 2. Local fallback inside bin/
  candidates.push(LOCAL_BIN_PATH);

  // 3. require('ffmpeg-static') resolution if different
  try {
    const reqPath = require('ffmpeg-static');
    if (reqPath && !candidates.includes(reqPath)) {
      candidates.push(reqPath);
    }
  } catch {}

  // 4. System PATH
  candidates.push('ffmpeg');

  // 5. Common OS paths
  if (process.platform === 'win32') {
    const localApp = process.env.LOCALAPPDATA || '';
    const progFiles = process.env.ProgramFiles || 'C:\\Program Files';
    candidates.push('C:\\ffmpeg\\bin\\ffmpeg.exe');
    candidates.push(path.join(progFiles, 'ffmpeg', 'bin', 'ffmpeg.exe'));
    candidates.push(path.join(localApp, 'Programs', 'ffmpeg', 'bin', 'ffmpeg.exe'));
    candidates.push('C:\\ProgramData\\chocolatey\\bin\\ffmpeg.exe');
  } else if (process.platform === 'darwin') {
    candidates.push('/opt/homebrew/bin/ffmpeg');
    candidates.push('/usr/local/bin/ffmpeg');
  } else {
    candidates.push('/usr/bin/ffmpeg');
    candidates.push('/usr/local/bin/ffmpeg');
  }

  for (const c of candidates) {
    if (testFfmpegExecutable(c)) {
      return c;
    }
  }

  return null;
}

/**
 * Clean up a corrupt/0-byte binary file if found.
 */
function purgeCorruptFile(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      const stat = fs.statSync(filePath);
      // Remove if 0 bytes or cannot run
      if (stat.size < 1000000 || !testFfmpegExecutable(filePath)) {
        fs.unlinkSync(filePath);
        return true;
      }
    }
  } catch {}
  return false;
}

/**
 * Download a file with automatic redirect following and streaming decompression.
 */
function downloadAndDecompress(url, destPath) {
  return new Promise((resolve, reject) => {
    const tempPath = `${destPath}.tmp_${Date.now()}`;
    const client = url.startsWith('https') ? https : http;

    function handleRequest(reqUrl, redirectCount = 0) {
      if (redirectCount > 5) {
        return reject(new Error('Too many redirects while downloading FFmpeg.'));
      }

      const req = client.get(reqUrl, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return handleRequest(res.headers.location, redirectCount + 1);
        }

        if (res.statusCode !== 200) {
          return reject(new Error(`Download failed with HTTP ${res.statusCode}`));
        }

        const outStream = fs.createWriteStream(tempPath);
        const isGz = reqUrl.endsWith('.gz') || (res.headers['content-type'] && res.headers['content-type'].includes('gzip'));
        const gunzip = zlib.createGunzip();

        let receivedBytes = 0;
        res.on('data', chunk => {
          receivedBytes += chunk.length;
        });

        const streamPipeline = isGz ? res.pipe(gunzip).pipe(outStream) : res.pipe(outStream);

        streamPipeline.on('finish', () => {
          outStream.close(() => {
            try {
              const stat = fs.statSync(tempPath);
              if (stat.size < 5000000) { // FFmpeg should be at least 5MB
                try { fs.unlinkSync(tempPath); } catch {}
                return reject(new Error(`Downloaded file too small (${stat.size} bytes). Download incomplete.`));
              }

              // Make executable
              try { fs.chmodSync(tempPath, 0o755); } catch {}

              // Atomic replace
              if (fs.existsSync(destPath)) {
                try { fs.unlinkSync(destPath); } catch {}
              }
              fs.renameSync(tempPath, destPath);
              resolve(destPath);
            } catch (err) {
              try { if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath); } catch {}
              reject(err);
            }
          });
        });

        streamPipeline.on('error', (err) => {
          try { outStream.close(); } catch {}
          try { if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath); } catch {}
          reject(err);
        });
      });

      req.on('error', (err) => {
        try { if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath); } catch {}
        reject(err);
      });
      req.setTimeout(60000, () => {
        req.destroy();
        reject(new Error('Download timed out after 60 seconds.'));
      });
    }

    handleRequest(url);
  });
}

/**
 * Repair or download a valid FFmpeg binary for the current system.
 */
async function repairFfmpeg() {
  // Purge known corrupt locations first
  purgeCorruptFile(STATIC_EXE_PATH);
  purgeCorruptFile(LOCAL_BIN_PATH);

  // Check if system has a working alternative before downloading
  const working = findWorkingFfmpeg();
  if (working) {
    return working;
  }

  // Determine target platform & arch
  let platform = os.platform();
  let arch = os.arch();

  // Windows ARM64 (Surface / Snapdragon) runs x64 binary under emulation
  if (platform === 'win32' && arch === 'arm64') {
    arch = 'x64';
  }

  const release = 'b6.1.1';
  const url = `https://github.com/eugeneware/ffmpeg-static/releases/download/${release}/ffmpeg-${platform}-${arch}.gz`;

  // Destination folder: prefer node_modules/ffmpeg-static, fallback to bin/
  let destDir = STATIC_DIR;
  if (!fs.existsSync(destDir)) {
    try {
      fs.mkdirSync(destDir, { recursive: true });
    } catch {
      destDir = path.join(__dirname);
    }
  }
  const destPath = path.join(destDir, STATIC_EXE_NAME);

  console.log(`[FFmpeg] Downloading static binary for ${platform}-${arch} from:`);
  console.log(`         ${url}`);

  await downloadAndDecompress(url, destPath);

  if (testFfmpegExecutable(destPath)) {
    console.log(`[FFmpeg] Verified and ready at ${destPath}`);
    return destPath;
  }

  throw new Error(`Downloaded FFmpeg binary at ${destPath} failed execution check.`);
}

/**
 * Main verification routine.
 */
async function verifyFfmpeg(autoRepair = false) {
  // Clean corrupt files first
  purgeCorruptFile(STATIC_EXE_PATH);
  purgeCorruptFile(LOCAL_BIN_PATH);

  const existing = findWorkingFfmpeg();
  if (existing) {
    return existing;
  }

  if (autoRepair) {
    console.log('[FFmpeg] No functioning FFmpeg executable found. Initializing repair...');
    return await repairFfmpeg();
  }

  return null;
}

// CLI entry point
if (require.main === module) {
  const shouldRepair = process.argv.includes('--repair') || process.argv.includes('-r');

  verifyFfmpeg(shouldRepair)
    .then((binaryPath) => {
      if (binaryPath) {
        console.log(`[OK] FFmpeg is operational: ${binaryPath}`);
        process.exit(0);
      } else {
        console.error('[ERROR] FFmpeg is missing, empty, or corrupt. Run with --repair to fix.');
        process.exit(1);
      }
    })
    .catch((err) => {
      console.error(`[ERROR] FFmpeg repair failed: ${err.message}`);
      process.exit(1);
    });
}

module.exports = {
  testFfmpegExecutable,
  findWorkingFfmpeg,
  repairFfmpeg,
  verifyFfmpeg,
  STATIC_EXE_PATH,
  LOCAL_BIN_PATH
};
