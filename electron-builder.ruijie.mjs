import { readFileSync } from "node:fs";
import { parse } from "yaml";

// electron-builder's `extends` concatenates publish arrays: the upstream feed
// would remain first. Load the common config and REPLACE that array instead.
const upstream = parse(readFileSync(new URL("./electron-builder.yml", import.meta.url), "utf8"));
export default {
  ...upstream,
  publish: [{ provider: "github", owner: "WYunS", repo: "OpenMausBot" }],
};
