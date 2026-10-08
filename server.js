"use strict";

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const PORT = Number(process.env.PORT) || 3000;
const WAIT_MS = 5000;
const CRASH_PAUSE_MS = 3000;
const GROWTH_RATE = 0.19;
const ROOT = __dirname;
const clients = new Set();
const roundHistory = [];

let roundNumber = 1;
let phase = "waiting";
let phaseStartedAt = Date.now();
let crashMultiplier = chooseCrashPoint();

function chooseCrashPoint() {
  return Math.min(100, Math.max(1.01, 1.01 + Math.pow(Math.random(), 3.15) * 98.99));
}

function advanceGame(now) {
  let transitions = 0;
  while (transitions < 10) {
    if (phase === "waiting" && now - phaseStartedAt >= WAIT_MS) {
      phaseStartedAt += WAIT_MS;
      phase = "flight";
      transitions += 1;
    } else if (phase === "flight") {
      const flightDuration = Math.log(crashMultiplier) / GROWTH_RATE * 1000;
      if (now - phaseStartedAt >= flightDuration) {
        phaseStartedAt += flightDuration;
        phase = "crashed";
        roundHistory.unshift(crashMultiplier);
        roundHistory.splice(10);
        transitions += 1;
      } else {
        break;
      }
    } else if (phase === "crashed" && now - phaseStartedAt >= CRASH_PAUSE_MS) {
      phaseStartedAt += CRASH_PAUSE_MS;
      phase = "waiting";
      roundNumber += 1;
      crashMultiplier = chooseCrashPoint();
      transitions += 1;
    } else {
      break;
    }
  }
}

function getGameState(now = Date.now()) {
  advanceGame(now);
  const elapsedSeconds = Math.max(0, (now - phaseStartedAt) / 1000);
  return {
    phase,
    roundNumber,
    phaseStartedAt,
    serverNow: now,
    crashMultiplier,
    currentMultiplier: phase === "flight"
      ? Math.min(crashMultiplier, Math.exp(elapsedSeconds * GROWTH_RATE))
      : phase === "crashed" ? crashMultiplier : 1,
    onlineCount: clients.size,
    roundHistory
  };
}

function broadcastState() {
  const message = `data: ${JSON.stringify(getGameState())}\n\n`;
  for (const response of clients) {
    if (!response.write(message)) clients.delete(response);
  }
}

function serveFile(request, response) {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
  } catch {
    response.writeHead(400).end("Bad request");
    return;
  }
  if (pathname === "/") pathname = "/index.html";
  const filePath = path.resolve(ROOT, `.${pathname}`);
  if (filePath !== ROOT && !filePath.startsWith(ROOT + path.sep)) {
    response.writeHead(403).end("Forbidden");
    return;
  }
  fs.readFile(filePath, (error, content) => {
    if (error) {
      response.writeHead(error.code === "ENOENT" ? 404 : 500).end("File not found");
      return;
    }
    const extension = path.extname(filePath).toLowerCase();
    const contentTypes = {
      ".css": "text/css; charset=utf-8",
      ".html": "text/html; charset=utf-8",
      ".js": "text/javascript; charset=utf-8",
      ".mp3": "audio/mpeg"
    };
    response.writeHead(200, {
      "Content-Type": contentTypes[extension] || "application/octet-stream",
      "X-Content-Type-Options": "nosniff"
    });
    response.end(content);
  });
}

const server = http.createServer((request, response) => {
  if (request.method === "GET" && request.url === "/events") {
    response.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive"
    });
    response.write(`data: ${JSON.stringify(getGameState())}\n\n`);
    clients.add(response);
    broadcastState();
    response.on("close", () => {
      clients.delete(response);
      broadcastState();
    });
    return;
  }
  if (request.method !== "GET") {
    response.writeHead(405, { Allow: "GET" }).end("Method not allowed");
    return;
  }
  serveFile(request, response);
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Mazari Aviator server listening on port ${PORT}`);
});

setInterval(broadcastState, 100);
