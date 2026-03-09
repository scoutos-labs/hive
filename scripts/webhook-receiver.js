const http = require('http');
const fs = require('fs');
const path = '/Users/mastercontrol/.openclaw/workspace/hive/webhook-events.log';
const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', c => body += c.toString());
  req.on('end', () => {
    const record = {
      ts: new Date().toISOString(),
      method: req.method,
      url: req.url,
      headers: req.headers,
      body: body ? JSON.parse(body) : null,
    };
    fs.appendFileSync(path, JSON.stringify(record) + '\n');
    res.writeHead(200, {'content-type':'application/json'});
    res.end(JSON.stringify({ok:true}));
  });
});
server.listen(8787, '127.0.0.1', () => console.log('receiver listening 8787'));
