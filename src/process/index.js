const rgb = (r, g, b, msg) => `\x1b[38;2;${r};${g};${b}m${msg}\x1b[0m`;
const log = (...args) => console.log(`[${rgb(88, 101, 242, 'arRPC')} > ${rgb(237, 66, 69, 'process')}]`, ...args);

import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const DetectableDB = require('./detectable.json');

import * as Natives from './native/index.js';
const Native = Natives[process.platform];


const timestamps = {}, names = {}, pids = {}, cache = {};
export default class ProcessServer {
  constructor(handlers) {
    if (!Native) return; // log('unsupported platform:', process.platform);

    this.handlers = handlers;

    this.scan = this.scan.bind(this);

    this.scan();
    setInterval(this.scan, 5000);

    log('started');
  }

  async scan() {
    // const startTime = performance.now();
    const processes = await Native.getProcesses();
    const ids = [];

    // log(`got processed in ${(performance.now() - startTime).toFixed(2)}ms`);

    for (const [ pid, _path, args, _cwdPath = '' ] of processes) {
      const path = _path.toLowerCase().replaceAll('\\', '/');
      
      // the cache key includes every dependency of the DetectableDB scan
      const cacheKey = `${path}\0${args}`;
      
      var detected = [];
      if (cache[cacheKey] !== undefined) {
        detected = cache[cacheKey].detected;
      }
      else {
        const cwdPath = _cwdPath.toLowerCase().replaceAll('\\', '/');
        const toCompare = [];
        const splitPath = path.split('/');
        for (let i = 1; i < splitPath.length || i == 1; i++) {
          toCompare.push(splitPath.slice(-i).join('/'));
        }

        // add more possible tweaked paths for less false negatives
        // remove 64bit identifiers-ish
        for (const p of toCompare.slice()) {
          toCompare.push(p.replace('64', ''));
          toCompare.push(p.replace('.x64', ''));
          toCompare.push(p.replace('x64', ''));
          toCompare.push(p.replace('_64', ''));
        }

        // add program extensions expected in detectable.json
	      for (const p of toCompare.slice()) {
          toCompare.push(p + ".exe");
          toCompare.push(p + ".app");
        }
        
        const isActive = x => {
          if (x.is_launcher) return false;
          if (
            x.name[0] === '>'
              ? x.name.substring(1) !== toCompare[0]
              : !toCompare.some(y => x.name === y || `${cwdPath}/${y}`.includes(`/${x.name}`))
          ) return false;
          if (args && x.arguments) return args.join(" ").indexOf(x.arguments) > -1;
          return true;
        }
        
        for (const { executables, id, name } of DetectableDB) {
          if (executables?.some(isActive)) {
            detected.push({ executables, id, name });
          }
        }
        
        cache[cacheKey] = {"detected": detected};
      }
      
      for (const { executables, id, name } of detected) {
        names[id] = name;
        pids[id] = pid;

        ids.push(id);
        if (!timestamps[id]) {
          log('detected game!', name);
          timestamps[id] = Date.now();
        }

        // Resending this on evry scan is intentional, so that in the case that arRPC scans
        // processes before Discord, existing activities will be sent
        this.handlers.message({
          socketId: id
        }, {
          cmd: 'SET_ACTIVITY',
          args: {
            activity: {
              application_id: id,
              name,
              timestamps: {
                start: timestamps[id]
              }
            },
            pid
          }
        });
      }
    }

    for (const id in timestamps) {
      if (!ids.includes(id)) {
        log('lost game!', names[id]);
        delete timestamps[id];

        this.handlers.message({
          socketId: id
        }, {
          cmd: 'SET_ACTIVITY',
          args: {
            activity: null,
            pid: pids[id]
          }
        });
      }
    }

    // log(`finished scan in ${(performance.now() - startTime).toFixed(2)}ms`);
    // process.stdout.write(`\r${' '.repeat(100)}\r[${rgb(88, 101, 242, 'arRPC')} > ${rgb(237, 66, 69, 'process')}] scanned (took ${(performance.now() - startTime).toFixed(2)}ms)`);
  }
}
