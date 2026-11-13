const clients = new Set();

// Express middleware that turns a request into a Server-Sent-Events stream.
function stream(req, res) {
  res.setHeader('Content-Type', 'text/event-stream');
  // no-transform compression middleware ko rok deta hai - warna SSE events
  // buffer ho kar late pahunchte hain.
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  res.write('event: connected\ndata: {"ok":true}\n\n');

  const heartbeat = setInterval(() => res.write(': ping\n\n'), 25000);

  clients.add(res);

  req.on('close', () => {
    clearInterval(heartbeat);
    clients.delete(res);
  });
}

function broadcast(event, payload) {
  const data = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const client of clients) {
    try {
      client.write(data);
    } catch {
      clients.delete(client);
    }
  }
}

module.exports = { stream, broadcast };