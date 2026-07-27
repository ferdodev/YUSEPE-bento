#!/usr/bin/env node
/**
 * src/cli/ybento.mjs
 * --------------------------------------------------------------
 * Ejecutable del CLI `ybento`. Todo lo interesante vive en `run.js`;
 * esto sólo conecta el proceso real (argv, cwd, env, stdout/stderr) con
 * esa función y traduce el resultado a un código de salida.
 *
 * `.mjs` a propósito: el package.json del proyecto no declara
 * "type": "module", así que la extensión es lo que hace que Node lo lea
 * como ESM al correrlo suelto desde la terminal de un agente.
 * --------------------------------------------------------------
 */
import { run } from './run.js';

/** Todo lo que venga por stdin (heredoc, pipe, redirección de archivo). */
async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

const code = await run(process.argv.slice(2), {
  cwd: process.cwd(),
  env: process.env,
  out: (text) => process.stdout.write(text),
  err: (text) => process.stderr.write(text),
  readStdin,
  // Si stdin es una terminal, nadie está canalizando nada: `enviar` sin
  // texto es un error de uso y no debe quedarse esperando input para siempre.
  isTTY: Boolean(process.stdin.isTTY),
});

process.exit(code);
