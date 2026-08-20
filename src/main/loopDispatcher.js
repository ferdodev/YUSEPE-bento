/**
 * src/main/loopDispatcher.js
 * --------------------------------------------------------------
 * El repartidor del loop: vigila `.ybento/loop/` y pega los mensajes
 * pendientes en la terminal de su destinatario.
 *
 * Es la pieza que hace que el loop no se corte. Los agentes postean con
 * el CLI (`ybento enviar`), que corre en *otro proceso*; si nadie mirara
 * el directorio, un agente que ya terminó su turno y volvió al prompt se
 * quedaría dormido para siempre esperando un mensaje que nunca va a ir a
 * buscar. Acá Bento lo despierta escribiéndole en el pty.
 *
 * Dos decisiones que sostienen todo lo demás:
 *
 *   1. **Un mensaje por vuelta y por agente.** Pegarle tres mensajes de
 *      corrido a un agente le inunda el prompt y los procesa mezclados.
 *      Como al recibir se marca `working`, el resto de su bandeja espera
 *      sola hasta que vuelva a `waiting`: la serialización sale gratis
 *      del gate de estado, sin cola aparte.
 *
 *   2. **El vínculo nombre -> ptyId vive en memoria, no en el disco.**
 *      El ptyId muere con la terminal; la identidad (`@claudio`) no. Si
 *      se persistiera, al reiniciar Bento el repartidor le escribiría a
 *      un pty que ya no existe. `status.json` guarda el `tileId` (que
 *      sirve para la UI) y acá se guarda el ptyId del momento.
 * --------------------------------------------------------------
 */
import {
  crossedMessages, formatForTerminal, listMessages, markDelivered,
  normalizeName, pendingDeliveries, readHead, watchLoop,
} from './loopOps.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Cada cuánto se revisa igual, por si `fs.watch` se pierde un evento.
 * Configurable por dispatcher: los tests lo suben para que sólo corran las
 * vueltas que piden a mano y no dependan del reloj.
 */
const POLL_MS = 1500;

/** Espera tras un cambio antes de repartir, para no repartir a medias. */
const DEBOUNCE_MS = 120;

/**
 * Pausa entre pegar el texto y mandar el Enter.
 *
 * No es una precaución: sin esto el loop no es autónomo. Los agentes corren
 * en TUIs (Claude Code, opencode) que detectan ráfagas de input como
 * *pegado* — si el `\r` llega en la misma escritura que el texto, lo
 * absorben como parte del contenido pegado en vez de leerlo como un Enter,
 * y el mensaje queda escrito en el prompt esperando que un humano lo
 * envíe a mano. Mandarlo aparte, con la ventana de pegado ya cerrada, lo
 * convierte en una pulsación de tecla de verdad.
 *
 * 250ms es holgado a propósito: las ventanas de detección de pegado andan
 * en decenas de milisegundos, y acá pasarse no cuesta nada (una ronda del
 * loop tarda minutos) mientras que quedarse corto rompe la autonomía.
 */
const SUBMIT_DELAY_MS = 250;

/** Shells que, si están en primer plano, significan "acá no hay agente". */
const SHELL_NAMES = new Set([
  'sh', 'bash', 'zsh', 'fish', 'dash', 'ksh', 'tcsh', 'csh',
  'powershell.exe', 'pwsh.exe', 'cmd.exe',
]);

/** Saca `-zsh` -> `zsh`, `/bin/bash` -> `bash`. */
function shellName(raw) {
  return String(raw || '').split(/[\\/]/).pop().replace(/^-/, '').toLowerCase();
}

/**
 * ¿Esa terminal está en el prompt del shell (y no dentro de un TUI)?
 *
 * Se exporta porque hace falta fuera del reparto: antes de tipearle un
 * `export` a una terminal hay que saber si lo va a leer un shell o si va a
 * terminar escrito adentro del prompt del agente como si fuera un mensaje.
 */
export function looksLikeShell({ process: foreground, shell } = {}) {
  const name = shellName(foreground);
  if (!name) return false;
  return SHELL_NAMES.has(name) || name === shellName(shell);
}

/**
 * @param {object} opts
 * @param {(ptyId: string, data: string) => void} opts.writeToPty
 * @param {(ptyId: string) => ({ process: string, shell: string }|null)} [opts.probePty]
 *   sonda de presencia: qué proceso está en primer plano de ese pty
 * @param {(info: object) => void} [opts.onDelivered] aviso para la UI
 * @param {() => void} [opts.onChange] algo cambió en el disco (lo dispara
 *   la vigilancia, para que el panel de mensajes se refresque solo)
 * @param {(info: object) => void} [opts.onPresence] un agente apareció o se fue
 */
export function createDispatcher({
  writeToPty,
  probePty = null,
  onDelivered = () => {},
  onChange = () => {},
  onPresence = () => {},
  submitDelayMs = SUBMIT_DELAY_MS,
  pollMs = POLL_MS,
  // Los tests que cuentan entregas la apagan: si no, sus propias escrituras
  // disparan vueltas de fondo y el conteo depende del reloj.
  watchFs = true,
} = {}) {
  /** nombre de agente -> ptyId (efímero, ver cabecera) */
  const bindings = new Map();

  /** nombre -> { present, foreground, checkedAt } — efímero, como el binding. */
  const presence = new Map();

  let cwd = null;
  let unwatch = null;
  let poll = null;
  let debounce = null;

  /**
   * Las vueltas se encadenan en vez de descartarse.
   *
   * Antes, una vuelta que llegaba con otra en curso se devolvía vacía. Con
   * un tick corto casi nunca pasaba; al agregarle una lectura de git la
   * ventana se ensanchó y empezaron a perderse vueltas. Encolar es lo
   * correcto igual: "repartí ahora" tiene que repartir, no coincidir con
   * un hueco libre.
   */
  let chain = Promise.resolve([]);

  /**
   * Asocia un agente con la terminal donde está corriendo.
   * Sin binding no se le entrega nada: el mensaje queda en su bandeja.
   */
  function bind(name, ptyId) {
    bindings.set(normalizeName(name), ptyId);
  }

  function unbind(name) {
    const id = normalizeName(name);
    bindings.delete(id);
    presence.delete(id);
  }

  /**
   * ¿Sigue habiendo un agente escuchando en esa terminal?
   *
   * Sin esto, cuando el proceso del agente termina la terminal vuelve al
   * prompt, nosotros le pegamos igual, avanzamos el cursor... y el mensaje
   * queda leído por nadie. Peor: silenciosamente, porque en el panel se ve
   * entregado.
   *
   * El detector es el proceso en primer plano del pty: si es el shell,
   * significa que el agente ya no está corriendo ahí. Cuando Claude Code u
   * opencode están vivos, el primer plano es su propio proceso.
   *
   * Ante la duda (sin sonda disponible, o el pty no sabe responder) se
   * asume presente: preferimos entregar de más antes que dejar mudo un
   * loop que en realidad estaba sano.
   */
  function checkPresence(name, ptyId) {
    if (!probePty) return true;

    let info = null;
    try {
      info = probePty(ptyId);
    } catch {
      return true;
    }
    if (!info || !info.process) return true;

    const foreground = shellName(info.process);
    const present = !looksLikeShell(info);

    const previous = presence.get(name);
    presence.set(name, { present, foreground, checkedAt: new Date().toISOString() });
    if (!previous || previous.present !== present) {
      onPresence({ agent: name, present, foreground });
    }
    return present;
  }

  /** Estado de presencia conocido, para pintarlo en el panel. */
  function presenceSnapshot() {
    return Object.fromEntries(presence);
  }

  function boundAgents() {
    return [...bindings.keys()];
  }

  /**
   * Una vuelta de reparto. Devuelve lo que entregó — los tests miran esto,
   * y la UI lo usa para pintar el mensaje como enviado.
   */
  async function runTick() {
    if (!cwd) return [];

    const ready = await pendingDeliveries(cwd);
    const delivered = [];
    // Se lee una vez por vuelta y sólo si hay algo que entregar: hace
    // falta el hilo completo para detectar cruces.
    const all = ready.length ? await listMessages(cwd) : [];
    // Una lectura de HEAD por vuelta, no por mensaje: sirve para avisar
    // que un reporte describe un árbol que ya avanzó.
    const head = ready.length ? await readHead(cwd) : null;

    for (const { agent, messages } of ready) {
      const ptyId = bindings.get(agent.name);
      if (!ptyId) continue; // sin terminal asociada: se queda en la bandeja

      // Si el agente ya no está corriendo en esa terminal, NO se entrega
      // y el cursor no avanza: el mensaje sigue pendiente y aparece como
      // tal en el panel. Un mensaje sin leer es recuperable; uno marcado
      // como entregado que nadie leyó, no.
      if (!checkPresence(agent.name, ptyId)) continue;

      // Sólo el más viejo: el resto espera a que vuelva a `waiting`.
      const message = messages[0];

      // Dos escrituras separadas, no una: ver SUBMIT_DELAY_MS. El texto
      // primero, y el Enter después de que el TUI del agente haya cerrado
      // su ventana de detección de pegado.
      writeToPty(ptyId, formatForTerminal(message, {
        crossed: crossedMessages(all, message),
        head,
      }));
      if (submitDelayMs > 0) await sleep(submitDelayMs);
      writeToPty(ptyId, '\r');

      // El cursor avanza *después* de escribir: si Bento se cae en el
      // medio, el mensaje se reintenta en vez de perderse.
      await markDelivered(cwd, agent.name, message.id);

      delivered.push({ agent: agent.name, message });
      onDelivered({ agent: agent.name, message });
    }

    return delivered;
  }

  /** Encola una vuelta detrás de la que esté corriendo. */
  function tick() {
    chain = chain.then(runTick, runTick);
    return chain;
  }

  /** Reparte enseguida, agrupando ráfagas de cambios. */
  function schedule() {
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(() => {
      debounce = null;
      onChange();
      tick();
    }, DEBOUNCE_MS);
  }

  /**
   * Arranca a vigilar el workspace. Idempotente: llamarlo de nuevo con
   * otro cwd mueve la vigilancia (es lo que pasa al cambiar de perfil).
   */
  function start(nextCwd) {
    stop();
    cwd = nextCwd;
    if (!cwd) return;

    // `fs.watch` es el camino rápido, pero se pierde eventos según el SO y
    // no existe hasta que exista la carpeta. El intervalo es la red: hace
    // que el loop ande igual, sólo que con hasta POLL_MS de demora.
    if (watchFs) {
      try {
        unwatch = watchLoop(cwd, schedule);
      } catch {
        unwatch = null;
      }
    }
    poll = setInterval(() => {
      // Si la carpeta apareció después de arrancar, enganchamos el watch.
      if (watchFs && !unwatch) {
        try { unwatch = watchLoop(cwd, schedule); } catch { /* sigue el poll */ }
      }
      // `fs.watch` puede perder eventos en Windows (Explorer, Search Indexer,
      // antivirus). `onChange` acá garantiza que la sidebar se refresca aunque
      // watchLoop no haya avisado — mismo intervalo que el tick, sin coste extra.
      onChange();
      tick();
    }, pollMs);

    if (watchFs) schedule();
  }

  function stop() {
    if (debounce) { clearTimeout(debounce); debounce = null; }
    if (poll) { clearInterval(poll); poll = null; }
    if (unwatch) { try { unwatch(); } catch { /* noop */ } unwatch = null; }
    cwd = null;
  }

  /**
   * Corta todo, incluidas las asociaciones (al cerrar la app).
   *
   * Espera la vuelta que esté en curso: `stop()` sólo cancela los timers,
   * pero un reparto ya arrancado sigue escribiendo en `.ybento/loop/`
   * después. Sin esperarlo, quien limpie detrás (un test que borra su
   * carpeta temporal, o la app cerrando el workspace) corre contra una
   * escritura a medio hacer.
   */
  async function dispose() {
    stop();
    await chain.catch(() => {});
    bindings.clear();
    presence.clear();
  }

  return {
    bind, unbind, boundAgents, tick, start, stop, dispose,
    presence: presenceSnapshot,
  };
}
