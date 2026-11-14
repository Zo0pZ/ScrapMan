"use strict";

/* ScrapMan — HTTP plumbing shared by the verify-collector service.
 * Extracted from server.js unchanged; no routing or business logic lives here. */

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization"
};

function sendJSON(res, statusCode, payload) {
  res.writeHead(statusCode, { "Content-Type": "application/json", ...CORS_HEADERS });
  res.end(JSON.stringify(payload));
}

function readJSONBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1e6) req.destroy(); // guard against absurdly large bodies
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

/* The Stripe webhook needs the raw, unparsed bytes: the signature is computed over
   the exact payload, so any parse-then-reserialise would invalidate it. */
function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => {
      chunks.push(chunk);
      if (chunks.reduce((n, c) => n + c.length, 0) > 1e6) req.destroy();
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

module.exports = { CORS_HEADERS, sendJSON, readJSONBody, readRawBody };
