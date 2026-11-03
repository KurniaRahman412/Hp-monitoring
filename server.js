const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { exec } = require('child_process');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// Helper untuk menjalankan perintah ADB
function runAdbCommand(cmd) {
  return new Promise((resolve, reject) => {
    exec(`.\\adb\\adb.exe shell ${cmd}`, (error, stdout, stderr) => {
      if (error) resolve(null);
      else resolve(stdout.trim());
    });
  });
}

// Fungsi mengambil daftar aplikasi pihak ketiga yang berjalan
async function getRunningApps() {
  try {
    const raw = await runAdbCommand('pm list packages -3'); // List package pihak ketiga
    if (!raw) return [];
    
    const packages = raw.split('\n')
      .map(p => p.replace('package:', '').trim())
      .filter(p => p.length > 0);

    // Ambil status proses yang aktif
    const psRaw = await runAdbCommand('ps -A');
    const runningApps = [];

    for (const pkg of packages) {
      if (psRaw && psRaw.includes(pkg)) {
        runningApps.push({ packageName: pkg });
      }
      if (runningApps.length >= 10) break; // Batasi maksimal 10 untuk performa
    }
    return runningApps;
  } catch (err) {
    return [];
  }
}

// Fungsi parsing data sistem dari ADB
async function getDeviceMetrics() {
  try {
    // 1. Ambil Data RAM
    const memRaw = await runAdbCommand('cat /proc/meminfo');
    let ramTotal = 0, ramFree = 0, ramAvailable = 0;
    if (memRaw) {
      const totalMatch = memRaw.match(/MemTotal:\s+(\d+)\s+kB/);
      const availMatch = memRaw.match(/MemAvailable:\s+(\d+)\s+kB/);
      if (totalMatch) ramTotal = Math.round(parseInt(totalMatch[1]) / 1024);
      if (availMatch) ramAvailable = Math.round(parseInt(availMatch[1]) / 1024);
    }
    const ramUsed = ramTotal - ramAvailable;
    const ramUsagePercent = ramTotal ? Math.round((ramUsed / ramTotal) * 100) : 0;

    // 2. Ambil Data Storage
    const storageRaw = await runAdbCommand('df -k /data');
    let storageTotal = 0, storageUsed = 0, storageAvail = 0;
    if (storageRaw) {
      const lines = storageRaw.split('\n');
      if (lines.length > 1) {
        const parts = lines[1].split(/\s+/);
        if (parts.length >= 4) {
          storageTotal = (parseFloat(parts[1]) / (1024 * 1024)).toFixed(2);
          storageUsed = (parseFloat(parts[2]) / (1024 * 1024)).toFixed(2);
          storageAvail = (parseFloat(parts[3]) / (1024 * 1024)).toFixed(2);
        }
      }
    }
    const storagePercent = storageTotal > 0 ? Math.round((storageUsed / storageTotal) * 100) : 0;

    // 3. Ambil Baterai & Suhu
    const batteryRaw = await runAdbCommand('dumpsys battery');
    let temp = 0, level = 0;
    if (batteryRaw) {
      const tempMatch = batteryRaw.match(/temperature:\s+(\d+)/);
      const levelMatch = batteryRaw.match(/level:\s+(\d+)/);
      if (tempMatch) temp = (parseInt(tempMatch[1]) / 10).toFixed(1);
      if (levelMatch) level = parseInt(levelMatch[1]);
    }

    // 4. Ambil Running Apps
    const apps = await getRunningApps();

    return {
      connected: !!memRaw,
      ram: { total: ramTotal, used: ramUsed, free: ramAvailable, percent: ramUsagePercent },
      storage: { total: storageTotal, used: storageUsed, free: storageAvail, percent: storagePercent },
      battery: { level, temp },
      apps
    };
  } catch (err) {
    return { connected: false };
  }
}

// Endpoint untuk melakukan Force Stop Aplikasi
app.post('/api/force-stop', async (req, res) => {
  const { packageName } = req.body;
  if (!packageName) return res.status(400).json({ success: false, message: 'Package name required' });

  const result = await runAdbCommand(`am force-stop ${packageName}`);
  res.json({ success: true, message: `Aplikasi ${packageName} berhasil dihentikan.` });
});

// Socket connection
io.on('connection', (socket) => {
  console.log('Dashboard terhubung di browser.');

  const interval = setInterval(async () => {
    const data = await getDeviceMetrics();
    socket.emit('metrics', data);
  }, 2500);

  socket.on('disconnect', () => {
    clearInterval(interval);
  });
});

const PORT = 3000;
server.listen(PORT, () => {
  console.log(`\nMonitor HP + Task Manager Berjalan di: http://localhost:${PORT}`);
});