import net from 'node:net';
import http from 'node:http';

const ports = [8443, 8080, 2001, 50000];
const connections = [];

for (const port of ports) {
  const server = net.createServer((socket) => {
    const info = {
      timestamp: new Date().toISOString(),
      localPort: port,
      remoteAddress: socket.remoteAddress,
      remotePort: socket.remotePort,
    };
    console.log(`>>> [PORT ${port}] Incoming connection from ${info.remoteAddress}:${info.remotePort}`);
    connections.push(info);

    socket.write(`HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nConnection: close\r\n\r\nOK-PORT-${port}\n`);
    socket.end();
  });

  server.on('error', (err) => {
    console.error(`[PORT ${port}] Server error:`, err.message);
  });

  // Try binding 0.0.0.0, fallback to 103.170.1.125 if in use
  server.listen(port, '0.0.0.0', () => {
    console.log(`[PORT ${port}] Listening on 0.0.0.0:${port}`);
  });
}

// Local inspection server on 127.0.0.1:55555
const inspectServer = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ active: true, totalConnections: connections.length, connections }));
});
inspectServer.listen(55555, '127.0.0.1', () => {
  console.log('[MONITOR] Inspection server listening on 127.0.0.1:55555');
});

process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));
