import { parentPort, workerData } from "node:worker_threads";
import fs from "node:fs";

const regexes = workerData.terms.map((source) => new RegExp(source, "i"));
const matched = [];
for (const file of workerData.files) {
  try {
    const source = fs.readFileSync(file, "utf8");
    if (regexes.every((regex) => regex.test(source))) matched.push(file);
  } catch {
    // A session file may disappear while a search is in flight.
  }
}
parentPort.postMessage({ matched });
